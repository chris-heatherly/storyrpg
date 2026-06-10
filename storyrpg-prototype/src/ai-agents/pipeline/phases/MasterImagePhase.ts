/**
 * Master Image Phase
 *
 * Generates the canonical visual anchors for a story run: multi-view
 * character reference sheets (with optional expression sheets, body
 * vocabulary, and silhouette profiles) for major characters, and master
 * environment shots for major locations.
 *
 * Faithful port of FullStoryPipeline.runMasterImageGeneration (pure move):
 * same eligibility rules (D1 supporting-character promotion), same identity
 * drift audit/invalidation (D5/D8), same anchor-character-first ordering with
 * Promise.allSettled parallelism, same events. generateCharacterReferenceSheet
 * moves along with it and stays publicly callable for the monolith's
 * hydrate-or-generate resume paths.
 */

import { CharacterProfile, CharacterBible } from '../../agents/CharacterDesigner';
import { WorldBible } from '../../agents/WorldBuilder';
import {
  ImageAgentTeam,
  GeneratedReferenceSheet,
  GeneratedExpressionSheet,
  CharacterReferenceSheetRequest,
  computeCharacterIdentityFingerprint,
} from '../../agents/image-team/ImageAgentTeam';
import { ImageGenerationService } from '../../services/imageGenerationService';
import { ImagePrompt } from '../../images/imageTypes';
import { getReferenceStrategy } from '../../images/referenceStrategy';
import { buildFashionPrimaryClothing } from '../../images/characterFashionStyle';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import type { CharacterVisualReference } from '../../utils/pipelineOutputWriter';
import type { CharacterReferenceMode } from '../../config';
import { PipelineContext } from './index';

// ========================================
// INPUT & CONTEXT TYPES
// ========================================

/**
 * The slice of FullCreativeBrief the master-image phase actually reads.
 * FullCreativeBrief satisfies this structurally, so the monolith passes its
 * brief through unchanged.
 */
export interface MasterImageBrief {
  story: { genre: string; tone: string };
  protagonist: { id: string };
  world: { keyLocations: Array<{ id: string; importance: 'major' | 'minor' | 'backdrop' }> };
  characterReferenceImages?: Record<string, Array<{ data: string; mimeType: string }>>;
  characterReferenceSettings?: Record<string, { referenceMode: CharacterReferenceMode }>;
}

export interface MasterImagePhaseInput {
  characterBible: CharacterBible;
  worldBible: WorldBible;
  brief: MasterImageBrief;
}

export interface MasterImagePhaseDeps {
  imageAgentTeam: Pick<
    ImageAgentTeam,
    | 'auditIdentityDrift'
    | 'invalidateStaleReferenceSheets'
    | 'hasReferenceSheet'
    | 'getReferenceSheet'
    | 'setReferenceSheetIdentityFingerprint'
    | 'generateLocationMasterPrompt'
    | 'generateFullCharacterReferenceWithSilhouette'
    | 'generateFullCharacterReferences'
    | 'generateExpressionSheetImages'
    | 'generateCharacterReferenceSheet'
    | 'generateCharacterMasterPrompt'
  >;
  imageService: Pick<
    ImageGenerationService,
    'generateImage' | 'generateImageBatch' | 'getMidjourneySettings' | 'setReferenceSheetStyleAnchor'
  >;
  checkCancellation: () => Promise<void>;
  emitPhaseProgress: (phase: string, done: number, total: number, source: string, message?: string) => void;
  /** Disk-cache hydration for a character's reference sheet (resume path). */
  hydrateReferenceSheetFromDisk: (char: CharacterProfile) => Promise<boolean>;
  /** Cross-run character knowledge memory (no-ops when memory is disabled). */
  readCharacterMemory: (characterName: string) => Promise<string | null>;
  writeCharacterMemory: (opts: {
    characterName: string;
    characterId: string;
    visionAnalysisSucceeded: boolean;
    physicalTraits: Record<string, any>;
    hadUserReferenceImages: boolean;
    userRefCount: number;
    generationSucceeded: boolean;
    artStyle?: string;
  }) => Promise<void>;
  shouldAttachCompositeCharacterRefs: () => boolean;
  /** Run-scoped accumulators owned by the pipeline; mutated in place. */
  locationMasterShots: Map<string, { data: string; mimeType: string }>;
  characterReferences: Map<string, CharacterVisualReference>;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class MasterImagePhase {
  readonly name = 'master_images';

  constructor(private readonly deps: MasterImagePhaseDeps) {}

  /**
   * Run master image generation for core characters and locations
   * Now generates full reference sheets for characters (multi-view) for better consistency
   */
  async run(input: MasterImagePhaseInput, context: PipelineContext): Promise<void> {
    const { characterBible, worldBible, brief } = input;
    const { imageAgentTeam, imageService } = this.deps;
    // D5: Before spending any budget on master images, drop reference sheets
    // whose stored identity fingerprint no longer matches the current
    // character profile. This catches the "author rewrote the character's
    // appearance between episodes" case — the cached anchor would otherwise
    // keep pinning new images to the old look. Freshly-generated sheets get
    // fingerprinted below; pre-D5 cached sheets adopt their current
    // fingerprint on first seen so drift detection starts from now.
    // D8: Under QA_MODE=fast/full, emit a structured drift audit BEFORE
    // invalidating. The audit is a pure fingerprint comparison (no LLM, no
    // image diff) so it's free to run. Operators can use the report to
    // decide whether downstream scenes should be regenerated too.
    const qaModeForDrift = context.config.imageGen?.qa?.qaMode ?? 'off';
    if (qaModeForDrift !== 'off') {
      const driftReport = imageAgentTeam.auditIdentityDrift(characterBible.characters);
      if (driftReport.length > 0) {
        context.emit({
          type: 'debug',
          phase: 'images',
          message: `D8 identity-drift audit (${qaModeForDrift}): ${driftReport.length} character(s) drifted — ${driftReport
            .map((d) => `${d.characterName}:${d.reason}`)
            .join(', ')}`,
        });
      }
    }

    const invalidated = imageAgentTeam.invalidateStaleReferenceSheets(characterBible.characters);
    if (invalidated.length > 0) {
      context.emit({
        type: 'debug',
        phase: 'images',
        message: `D5: invalidated ${invalidated.length} stale reference sheet(s) due to identity change: ${invalidated.join(', ')}`,
      });
    }

    // D1: Promote recurring non-protagonist characters to master reference
    // sheets. In addition to major/core importance, we now include
    // `supporting` characters — the writer typically tags characters that
    // appear in multiple scenes at this tier, so they benefit most from a
    // stable identity anchor. Minor one-off characters are still skipped to
    // avoid wasting generation budget on throwaway appearances.
    const majorCharacters = characterBible.characters.filter((char) =>
      char.importance === 'major' ||
      char.importance === 'core' ||
      char.importance === 'supporting' ||
      char.id === brief.protagonist.id
    );
    const majorLocations = worldBible.locations.filter((loc) => {
      const briefLoc = brief.world.keyLocations.find((location) => location.id === loc.id);
      return briefLoc?.importance === 'major';
    });
    const totalMasterAssets = majorCharacters.length + majorLocations.length;
    let completedMasterAssets = 0;
    if (totalMasterAssets > 0) {
      this.deps.emitPhaseProgress('master_images', 0, totalMasterAssets, 'master-assets', 'Preparing master reference generation...');
    }

    // Generate reference sheets for major characters (deduplicate by ID to prevent double composites)
    const processedCharIds = new Set<string>();

    // Collect eligible characters first so we can parallelize the bulk work.
    // The single character who runs serially first establishes the
    // global style anchor (`setReferenceSheetStyleAnchor`) that subsequent
    // characters use as a consistency reference. Protagonist is preferred
    // so the anchor reflects the story's primary visual lead; otherwise
    // the first eligible character wins, matching prior behaviour.
    type EligibleChar = { char: CharacterProfile; userRefImages: Array<{ data: string; mimeType: string }> };
    const eligibleCharacters: EligibleChar[] = [];
    for (const char of characterBible.characters) {
      if (processedCharIds.has(char.id)) {
        console.warn(`[Pipeline] Skipping duplicate character ID "${char.id}" (${char.name}) — already generated reference sheet.`);
        continue;
      }
      // D1: treat "supporting" the same as "major" for reference-sheet eligibility.
      const isMajor = char.importance === 'major' ||
        char.importance === 'core' ||
        char.importance === 'supporting' ||
        char.id === brief.protagonist.id;
      const userRefImages = this.findUserReferenceImages(char, brief);
      const hasUserRefs = userRefImages.length > 0;

      if (hasUserRefs && !isMajor) {
        context.emit({ type: 'debug', phase: 'images',
          message: `Promoting "${char.name}" to reference-sheet generation (user provided ${userRefImages.length} reference image(s))` });
      }

      if (isMajor || hasUserRefs) {
        processedCharIds.add(char.id);
        eligibleCharacters.push({ char, userRefImages: hasUserRefs ? userRefImages : [] });
      }
    }

    // Process a single eligible character — handles progress emission,
    // identity fingerprinting, and cancellation. Errors are caught inside
    // `generateCharacterReferenceSheet`, but we wrap the body in its own
    // try/catch anyway: when multiple characters run in parallel via
    // `Promise.allSettled`, we want any rogue rejection to become a logged
    // warning instead of leaking into the worker's unhandledRejection hook
    // and killing the pipeline.
    const processCharacter = async ({ char, userRefImages }: EligibleChar): Promise<void> => {
      try {
        await this.deps.checkCancellation();
        if (imageAgentTeam.hasReferenceSheet(char.id) || await this.deps.hydrateReferenceSheetFromDisk(char)) {
          context.emit({
            type: 'debug',
            phase: 'reference_sheet',
            message: `Skipping reference generation for ${char.name}; existing reference sheet is already available.`,
          });
          return;
        }
        await this.generateCharacterReferenceSheet(char, brief, userRefImages.length > 0 ? userRefImages : undefined, context);
        // D5: tag the freshly-generated reference sheet with the identity
        // fingerprint that produced it so future runs can detect drift and
        // invalidate at the top of this phase (see `invalidateStaleReferenceSheets`).
        const fingerprint = computeCharacterIdentityFingerprint(char);
        imageAgentTeam.setReferenceSheetIdentityFingerprint(char.id, fingerprint);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Pipeline] Character reference generation for "${char.name}" failed (${msg}); continuing with remaining characters.`);
        context.emit({
          type: 'warning',
          phase: 'reference_sheet',
          message: `Character reference generation failed for ${char.name}: ${msg}`,
        });
      } finally {
        if (totalMasterAssets > 0) {
          completedMasterAssets += 1;
          this.deps.emitPhaseProgress(
            'master_images',
            completedMasterAssets,
            totalMasterAssets,
            'master-assets',
            `Master character reference complete for ${char.name}`
          );
        }
      }
    };

    if (eligibleCharacters.length > 0) {
      // Pick the style-anchor character: prefer the protagonist, else fall
      // back to the first eligible character. This one must run before the
      // others so `setReferenceSheetStyleAnchor` is stamped with the chosen
      // lead's front view before other characters' generation kicks off.
      const anchorIdx = Math.max(
        0,
        eligibleCharacters.findIndex(({ char }) => char.id === brief.protagonist.id),
      );
      const [anchorEntry] = eligibleCharacters.splice(anchorIdx, 1);
      await processCharacter(anchorEntry);

      // Remaining characters run in parallel — `ImageGenerationService`
      // routes through `ProviderThrottle`, which enforces the per-provider
      // concurrency cap (e.g. Gemini: 6) and min-request interval. Firing
      // all characters concurrently here cuts wall-clock time from
      // O(N_characters × per_char_time) to roughly `per_char_time`.
      //
      // `Promise.allSettled` (not `Promise.all`) is critical here: if one
      // character's generation throws, we must still await the others to
      // completion. Otherwise their eventual rejection becomes an
      // unhandled promise rejection, which the worker's `unhandledRejection`
      // handler converts into a pipeline-fatal `worker_error`.
      if (eligibleCharacters.length > 0) {
        await Promise.allSettled(eligibleCharacters.map(processCharacter));
      }
    }

    // Generate master shots for major locations (batch when possible)
    const locationBatchItems: { prompt: ImagePrompt; identifier: string; metadata?: any; locName: string }[] = [];
    for (const loc of worldBible.locations) {
      const briefLoc = brief.world.keyLocations.find(l => l.id === loc.id);
      if (briefLoc?.importance === 'major') {
        context.emit({ type: 'agent_start', agent: 'ImageAgentTeam', message: `Planning master environment shot for ${loc.name}...` });
        try {
          const promptRes = await withTimeout(imageAgentTeam.generateLocationMasterPrompt({
            locationId: loc.id,
            name: loc.name,
            description: loc.fullDescription,
            type: loc.type,
            genre: brief.story.genre,
            tone: brief.story.tone
          }), PIPELINE_TIMEOUTS.llmAgent, `LocationMasterPrompt(${loc.id})`);
          if (promptRes.success && promptRes.data) {
            locationBatchItems.push({
              prompt: promptRes.data,
              identifier: `master_loc_${loc.id}`,
              metadata: { type: 'master' as const },
              locName: loc.name,
            });
          }
        } catch (err) {
          console.warn(`[Pipeline] Failed to generate master prompt for ${loc.name}:`, err);
        }
      }
    }

    if (locationBatchItems.length > 0) {
      context.emit({ type: 'agent_start', agent: 'ImageService', message: `Generating ${locationBatchItems.length} location master shots...` });
      const batchResults = await withTimeout(imageService.generateImageBatch(
        locationBatchItems.map(item => ({ prompt: item.prompt, identifier: item.identifier, metadata: item.metadata }))
      ), PIPELINE_TIMEOUTS.storyboard, 'locationImageBatch');
      for (let i = 0; i < batchResults.length; i++) {
        const locItem = locationBatchItems[i];
        const locResult = batchResults[i];
        context.emit({ type: 'debug', phase: 'images', message: `Generated master shot for ${locItem.locName}` });
        if (locResult?.imageData && locResult?.mimeType) {
          const locId = locItem.identifier.replace('master_loc_', '');
          this.deps.locationMasterShots.set(locId, { data: locResult.imageData, mimeType: locResult.mimeType });
        }
        if (totalMasterAssets > 0) {
          completedMasterAssets += 1;
          this.deps.emitPhaseProgress(
            'master_images',
            completedMasterAssets,
            totalMasterAssets,
            'master-assets',
            `Master location reference complete for ${locItem.locName}`
          );
        }
      }
    }
  }

  /**
   * Generate a complete character reference sheet with multiple views
   * This creates the canonical visual reference for a character
   */
  async generateCharacterReferenceSheet(
    char: CharacterProfile,
    brief: MasterImageBrief,
    userReferenceImages: Array<{ data: string; mimeType: string }> | undefined,
    context: PipelineContext,
  ): Promise<GeneratedReferenceSheet | null> {
    const { imageAgentTeam, imageService } = this.deps;
    if (imageAgentTeam.hasReferenceSheet(char.id) || await this.deps.hydrateReferenceSheetFromDisk(char)) {
      context.emit({
        type: 'debug',
        phase: 'reference_sheet',
        message: `Reference generation skipped for ${char.name}; existing hydrated reference is available.`,
      });
      return imageAgentTeam.getReferenceSheet(char.id) || null;
    }
    const isMajorCharacter = char.importance === 'major' || char.importance === 'core' || char.id === brief.protagonist.id;

    context.emit({
      type: 'agent_start',
      agent: 'CharacterReferenceSheetAgent',
      message: `Generating ${isMajorCharacter ? 'full' : 'basic'} reference for ${char.name} (${char.role})...`
    });

    try {
      // Read any prior character knowledge from memory
      const priorKnowledge = await this.deps.readCharacterMemory(char.name);
      if (priorKnowledge) {
        context.emit({ type: 'debug', phase: 'images', message: `Found prior character knowledge for ${char.name} in memory` });
      }

      // Build the reference sheet request from character profile.
      //
      // Per-provider reference strategy (see `referenceStrategy.ts`) is the
      // source of truth for *which artifacts are worth generating at all*.
      // User-facing toggles (`generateExpressionSheets`, etc.) can only
      // narrow the strategy — they never override it upward. This is how we
      // stop paying for composite / three-quarter / profile / expression
      // sheets on providers that only need a clean front identity anchor.
      const refStrategy = getReferenceStrategy(context.config.imageGen?.provider);
      const userWantsCharRefs = context.config.generation?.generateCharacterRefs ?? true;
      const userWantsBodyVocab = context.config.generation?.generateBodyVocabulary ?? isMajorCharacter;
      const userWantsExpressions = context.config.generation?.generateExpressionSheets ?? false;
      const generateCharRefs = userWantsCharRefs && refStrategy.generateViews.length > 0;
      const generateBodyVocab = userWantsBodyVocab && refStrategy.generateBodyVocabulary;
      const generateExpressions =
        userWantsExpressions && refStrategy.generateExpressions && isMajorCharacter;
      const generateSilhouette = refStrategy.generateSilhouette;
      const expressionTier = char.id === brief.protagonist.id ? 'core' as const : 'minimal' as const;

      // Surface the resolved strategy so an operator can verify at a glance
      // that front-only providers are running the trimmed path and not
      // paying for ignored artifacts.
      context.emit({
        type: 'debug',
        phase: 'images',
        message:
          `Reference strategy for ${char.name} (provider=${context.config.imageGen?.provider || 'placeholder'}): ` +
          `views=[${refStrategy.generateViews.join(',') || 'none'}] ` +
          `composite=${refStrategy.generateComposite} ` +
          `expressions=${generateExpressions} ` +
          `bodyVocab=${generateBodyVocab} ` +
          `silhouette=${generateSilhouette}`,
      });

      // Use the first user-provided image as the primary reference for the sheet request
      // All images are passed to the image generation team for multi-reference consistency
      const primaryUserRef = userReferenceImages?.[0];

      // Determine reference mode for this character (face-only vs full-appearance)
      // Look up by character ID first, then by name, then by lowercase name
      const refSettings = brief.characterReferenceSettings;
      const referenceMode: CharacterReferenceMode =
        refSettings?.[char.id]?.referenceMode ||
        refSettings?.[char.name]?.referenceMode ||
        refSettings?.[char.name.toLowerCase()]?.referenceMode ||
        'face-only';

      if (referenceMode === 'full-appearance') {
        context.emit({ type: 'debug', phase: 'images', message: `Reference mode for ${char.name}: FULL APPEARANCE (clothing from reference image)` });
      }

      // Start with story-based physical traits
      let physicalTraits = this.extractPhysicalTraits(char);
      // Start with story-based clothing (may be overridden by vision in full-appearance mode)
      let clothingInfo = this.extractClothingInfo(char);

      // If user provided a reference image, analyze it with a vision LLM
      // face-only: overrides face/hair/body/skin, clothing stays from story
      // full-appearance: overrides everything including clothing
      let visionAnalysisSucceeded = false;
      if (primaryUserRef) {
        context.emit({ type: 'debug', phase: 'images', message: `Analyzing reference image for ${char.name} (${referenceMode})...` });
        const visionResult = await this.analyzeReferenceImageTraits(primaryUserRef, char.name, referenceMode, context);
        if (visionResult) {
          visionAnalysisSucceeded = true;
          const visionTraits = visionResult.physicalTraits;
          physicalTraits = {
            ...physicalTraits,
            ...(visionTraits.age ? { age: visionTraits.age } : {}),
            ...(visionTraits.height ? { height: visionTraits.height } : {}),
            ...(visionTraits.build ? { build: visionTraits.build } : {}),
            ...(visionTraits.hairColor ? { hairColor: visionTraits.hairColor } : {}),
            ...(visionTraits.hairStyle ? { hairStyle: visionTraits.hairStyle } : {}),
            ...(visionTraits.eyeColor ? { eyeColor: visionTraits.eyeColor } : {}),
            ...(visionTraits.skinTone ? { skinTone: visionTraits.skinTone } : {}),
            ...(visionTraits.distinguishingFeatures && visionTraits.distinguishingFeatures.length > 0
              ? { distinguishingFeatures: visionTraits.distinguishingFeatures }
              : {}),
          };

          if (referenceMode === 'full-appearance' && visionResult.clothingInfo) {
            clothingInfo = {
              primary: visionResult.clothingInfo.primary,
              accessories: visionResult.clothingInfo.accessories,
              colorPalette: visionResult.clothingInfo.colorPalette,
            };
            context.emit({ type: 'debug', phase: 'images', message: `Clothing for ${char.name} overridden from reference image: ${clothingInfo.primary}` });
          } else {
            context.emit({ type: 'debug', phase: 'images', message: `Physical traits for ${char.name} updated from reference image (clothing from story)` });
          }
        } else {
          // Vision analysis FAILED but we still have reference images.
          // Strip face/hair/body traits that would conflict with the reference images.
          // Keep only role, gender, and clothing — let the reference images drive the face.
          context.emit({ type: 'warning', phase: 'images', message: `Vision analysis failed for ${char.name} — stripping conflicting physical traits so reference images drive the face` });
          physicalTraits = {
            ...physicalTraits,
            hairColor: undefined,
            hairStyle: undefined,
            eyeColor: undefined,
            skinTone: undefined,
            distinguishingFeatures: [
              '[IDENTITY FROM REFERENCE IMAGE — do not invent facial features, match the reference photo exactly]',
            ],
          };
        }
      }

      // Determine --ow weight based on reference mode
      const mjSettings = imageService.getMidjourneySettings();
      const omniWeightOverride = referenceMode === 'full-appearance'
        ? mjSettings.fullAppearanceOmniWeight
        : undefined; // undefined = use default refSheetOmniWeight

      const request: CharacterReferenceSheetRequest = {
        characterId: char.id,
        name: char.name,
        pronouns: char.pronouns,
        description: char.fullBackground || char.overview,
        role: char.role,
        physicalTraits: physicalTraits,
        clothing: clothingInfo,
        personality: char.voiceProfile?.writingGuidance || char.overview,
        backgroundTraits: char.fullBackground || char.overview, // For body vocabulary derivation
        genre: brief.story.genre,
        tone: brief.story.tone,
        artStyle: context.config.artStyle,
        // Expression references are generated selectively for major recurring characters.
        includeExpressions: generateCharRefs && generateExpressions,
        expressionTier,
        // Body vocabulary and silhouette for major characters - now configurable.
        // The per-provider strategy (see `referenceStrategy.ts`) can zero these
        // out for providers that don't meaningfully consume them (e.g. gpt-image-2).
        includeBodyVocabulary: generateCharRefs && generateBodyVocab && isMajorCharacter,
        includeSilhouetteProfile: generateCharRefs && isMajorCharacter && generateSilhouette,
        // User-provided reference image for visual guidance (primary image)
        userReferenceImage: primaryUserRef,
        // All user reference images (for multi-reference generation)
        userReferenceImages: userReferenceImages,
        // Prior knowledge from memory (past generation insights)
        priorKnowledge: priorKnowledge || undefined,
      };

      if (userReferenceImages && userReferenceImages.length > 0) {
        context.emit({ type: 'debug', phase: 'images', message: `Using ${userReferenceImages.length} user-provided reference image(s) for ${char.name}` });
      }

      // Use full reference generation for major characters
      if (isMajorCharacter) {
        const fullRefResult = await withTimeout(
          imageAgentTeam.generateFullCharacterReferenceWithSilhouette(request),
          PIPELINE_TIMEOUTS.storyboard, `CharacterRefSheet(${char.name})`
        );

        if (fullRefResult.errors.length > 0 && !fullRefResult.poseSheet) {
          console.error(`[Pipeline] Failed to generate full reference for ${char.name}:`, fullRefResult.errors);
          return this.fallbackToSinglePortrait(char, brief, context);
        }

        // Log what was generated
        const generated: string[] = [];
        if (fullRefResult.poseSheet) generated.push('pose sheet');
        if (fullRefResult.expressionSheet) generated.push(`${fullRefResult.expressionSheet.expressions?.length || 0} expressions`);
        if (fullRefResult.bodyVocabulary) generated.push('body vocabulary');
        if (fullRefResult.silhouetteProfile) generated.push('silhouette profile');
        context.emit({ type: 'debug', phase: 'images', message: `Full reference for ${char.name}: ${generated.join(', ')}` });

        if (fullRefResult.silhouetteProfile?.silhouetteHooks) {
          context.emit({ type: 'debug', phase: 'images', message: `Silhouette hooks: ${fullRefResult.silhouetteProfile.silhouetteHooks.join(', ')}` });
        }

        // Generate the actual images from pose sheet
        if (fullRefResult.poseSheet) {
          context.emit({
            type: 'agent_start',
            agent: 'ImageAgentTeam',
            message: `Generating ${fullRefResult.poseSheet.views.length} reference images for ${char.name}...`
          });

          // Wrap the image service to inject omniWeightOverride when in full-appearance mode
          const imageServiceWithOwOverride = omniWeightOverride
            ? {
                generateImage: (prompt: any, identifier: string, metadata?: any, refImages?: any[]) =>
                  imageService.generateImage(prompt, identifier, { ...metadata, omniWeightOverride }, refImages),
              }
            : imageService;

          // Reference generation scope is driven by the per-provider
          // strategy (see `referenceStrategy.ts`):
          //   - Gemini / Atlas: front view + derived face crop
          //   - Midjourney:     composite only (drives --cref); skip views
          //   - gpt-image-2:    front view + derived face crop; no composite, no expressions
          //   - Stable Diffusion: three-view pack (routed via IP-Adapter)
          // Per-provider filtering in imageGenerationService + filterRefsForProvider
          // then decides which of these artifacts reach each downstream call.
          const progressCb = (status: string, index: number, total: number) => {
            context.emit({
              type: 'checkpoint',
              phase: 'reference_sheet',
              message: `${char.name}: Generating character references (${status})`,
              data: { characterId: char.id, viewType: status, progress: index / total }
            });
          };
          const generatedSheet = await withTimeout(
            imageAgentTeam.generateFullCharacterReferences(
              fullRefResult.poseSheet,
              imageServiceWithOwOverride,
              progressCb,
              primaryUserRef,
              userReferenceImages,
              {
                allowedViews: refStrategy.generateViews,
                generateComposite: refStrategy.generateComposite,
              },
            ),
            PIPELINE_TIMEOUTS.storyboard,
            `FullCharacterReferences(${char.name})`,
          );

          context.emit({
            type: 'agent_complete',
            agent: 'CharacterReferenceSheetAgent',
            message: `Character references complete for ${char.name}: ${generatedSheet.generatedImages.size} artifact(s)`,
            data: {
              characterId: char.id,
              viewCount: generatedSheet.generatedImages.size,
              visualAnchors: generatedSheet.visualAnchors,
              hasBodyVocabulary: !!fullRefResult.bodyVocabulary,
              hasSilhouetteProfile: !!fullRefResult.silhouetteProfile,
              silhouetteHooks: fullRefResult.silhouetteProfile?.silhouetteHooks
            }
          });

          // Store first character's ref sheet as style anchor for subsequent characters.
          // Prefer the full-body front view over the face crop so the anchor
          // carries costume and palette information, not just the face.
          const compositeAnchorImg = this.deps.shouldAttachCompositeCharacterRefs()
            ? generatedSheet.generatedImages.get('composite')
            : undefined;
          const anchorImg = generatedSheet.generatedImages.get('front')
            || compositeAnchorImg
            || generatedSheet.generatedImages.get('face');
          if (anchorImg?.imageData && anchorImg?.mimeType) {
            imageService.setReferenceSheetStyleAnchor(anchorImg.imageData, anchorImg.mimeType);
          }

          let generatedExprSheet: GeneratedExpressionSheet | undefined = undefined;
          if (generateExpressions && fullRefResult.expressionSheet) {
            const poseSheetImages = Array.from(generatedSheet.generatedImages.entries())
              .filter(([viewType, image]) =>
                ['front', 'three-quarter', 'profile'].includes(viewType) && !!image.imageData && !!image.mimeType
              )
              .map(([viewType, image]) => ({
                data: image.imageData!,
                mimeType: image.mimeType!,
                name: viewType,
              }));

            const expressionProgress = (expressionName: string, index: number, total: number) => {
              context.emit({
                type: 'checkpoint',
                phase: 'expression_sheet',
                message: `${char.name}: Generating expression reference ${index}/${total} (${expressionName})`,
                data: { characterId: char.id, expressionName, progress: index / total }
              });
            };

            generatedExprSheet = await withTimeout(
              imageAgentTeam.generateExpressionSheetImages(
                fullRefResult.expressionSheet,
                imageServiceWithOwOverride,
                poseSheetImages,
                expressionProgress,
                primaryUserRef,
                userReferenceImages,
                {
                  visualAnchors: generatedSheet.visualAnchors,
                  colorPalette: generatedSheet.colorPalette,
                }
              ),
              PIPELINE_TIMEOUTS.storyboard,
              `ExpressionRefSheet(${char.name})`
            );
          }

          // Store the collected visual reference for saving
          this.deps.characterReferences.set(char.id, {
            characterId: char.id,
            characterName: char.name,
            poseSheet: generatedSheet,
            expressionSheet: fullRefResult.expressionSheet,
            generatedExpressionSheet: generatedExprSheet,
            bodyVocabulary: fullRefResult.bodyVocabulary,
            silhouetteProfile: fullRefResult.silhouetteProfile
          });

          // Write character knowledge to memory (non-blocking)
          this.deps.writeCharacterMemory({
            characterName: char.name,
            characterId: char.id,
            visionAnalysisSucceeded,
            physicalTraits: request.physicalTraits,
            hadUserReferenceImages: !!userReferenceImages?.length,
            userRefCount: userReferenceImages?.length || 0,
            generationSucceeded: generatedSheet.generatedImages.size > 0,
            artStyle: context.config.artStyle,
          }).catch(() => {});

          return generatedSheet;
        }

        // poseSheet was null despite no errors — fall through to simpler generation
        console.warn(`[Pipeline] Major character ${char.name} had no poseSheet from full reference; falling back to simpler generation.`);
      }

      // For non-major characters (or major characters whose full-reference planning returned no poseSheet), use simpler generation
      const sheetRes = await withTimeout(
        imageAgentTeam.generateCharacterReferenceSheet(request),
        PIPELINE_TIMEOUTS.llmAgent, `CharacterRefSheetPlan(${char.name})`
      );

      if (!sheetRes.success || !sheetRes.data) {
        console.error(`[Pipeline] Failed to generate reference sheet plan for ${char.name}:`, sheetRes.error);
        return this.fallbackToSinglePortrait(char, brief, context);
      }

      const sheet = sheetRes.data;
      context.emit({ type: 'debug', phase: 'images', message: `Reference sheet planned for ${char.name}: ${sheet.views.length} views` });

      // Wrap the image service to inject omniWeightOverride when in full-appearance mode
      const imageServiceWithOwOverrideSimple = omniWeightOverride
        ? {
            generateImage: (prompt: any, identifier: string, metadata?: any, refImages?: any[]) =>
              imageService.generateImage(prompt, identifier, { ...metadata, omniWeightOverride }, refImages),
          }
        : imageService;

      const simpleProgressCb = (status: string, index: number, total: number) => {
        context.emit({
          type: 'checkpoint',
          phase: 'reference_sheet',
          message: `${char.name}: Generating character references (${status})`,
          data: { characterId: char.id, viewType: status, progress: index / total }
        });
      };
      const generatedSheet = await withTimeout(
        imageAgentTeam.generateFullCharacterReferences(
          sheet,
          imageServiceWithOwOverrideSimple,
          simpleProgressCb,
          primaryUserRef,
          userReferenceImages,
          {
            allowedViews: refStrategy.generateViews,
            generateComposite: refStrategy.generateComposite,
          },
        ),
        PIPELINE_TIMEOUTS.storyboard,
        `FullCharacterReferences(${char.name})`,
      );

      context.emit({
        type: 'agent_complete',
        agent: 'CharacterReferenceSheetAgent',
        message: `Character references complete for ${char.name}: ${generatedSheet.generatedImages.size} artifact(s)`,
        data: {
          characterId: char.id,
          viewCount: generatedSheet.generatedImages.size,
          visualAnchors: generatedSheet.visualAnchors
        }
      });

      // Store first character's ref sheet as style anchor for subsequent characters.
      // Prefer the full-body front view over the face crop so the anchor
      // carries costume and palette information, not just the face.
      const compositeAnchorImg = this.deps.shouldAttachCompositeCharacterRefs()
        ? generatedSheet.generatedImages.get('composite')
        : undefined;
      const anchorImg = generatedSheet.generatedImages.get('front')
        || compositeAnchorImg
        || generatedSheet.generatedImages.get('face');
      if (anchorImg?.imageData && anchorImg?.mimeType) {
        imageService.setReferenceSheetStyleAnchor(anchorImg.imageData, anchorImg.mimeType);
      }

      // Write character knowledge to memory (non-blocking)
      this.deps.writeCharacterMemory({
        characterName: char.name,
        characterId: char.id,
        visionAnalysisSucceeded,
        physicalTraits: request.physicalTraits,
        hadUserReferenceImages: !!userReferenceImages?.length,
        userRefCount: userReferenceImages?.length || 0,
        generationSucceeded: generatedSheet.generatedImages.size > 0,
        artStyle: context.config.artStyle,
      }).catch(() => {});

      return generatedSheet;

    } catch (err) {
      console.error(`[Pipeline] Failed to generate reference sheet for ${char.name}:`, err);
      return this.fallbackToSinglePortrait(char, brief, context);
    }
  }

  /**
   * Find user-provided reference images for a character using fuzzy name matching.
   * Tries: exact id, exact name, lowercase name, then partial/substring matches
   * against all keys in characterReferenceImages.
   */
  private findUserReferenceImages(
    char: CharacterProfile,
    brief: MasterImageBrief
  ): Array<{ data: string; mimeType: string }> {
    const refMap = brief.characterReferenceImages;
    if (!refMap || Object.keys(refMap).length === 0) {
      console.log(`[Pipeline] findUserReferenceImages("${char.name}"): no characterReferenceImages in brief`);
      return [];
    }

    const refKeys = Object.keys(refMap);
    console.log(`[Pipeline] findUserReferenceImages("${char.name}", id="${char.id}"): checking against ${refKeys.length} ref key(s): ${refKeys.map(k => `"${k}"(${refMap[k]?.length || 0} imgs)`).join(', ')}`);

    // 1. Exact matches (id, name, lowercase name)
    if (refMap[char.id]?.length) {
      console.log(`[Pipeline] ✅ Matched "${char.name}" by exact ID "${char.id}" → ${refMap[char.id].length} image(s)`);
      return refMap[char.id];
    }
    if (refMap[char.name]?.length) {
      console.log(`[Pipeline] ✅ Matched "${char.name}" by exact name → ${refMap[char.name].length} image(s)`);
      return refMap[char.name];
    }
    if (refMap[char.name.toLowerCase()]?.length) {
      console.log(`[Pipeline] ✅ Matched "${char.name}" by lowercase name "${char.name.toLowerCase()}" → ${refMap[char.name.toLowerCase()].length} image(s)`);
      return refMap[char.name.toLowerCase()];
    }

    // 2. Fuzzy matching: normalize both sides and check substring containment
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const charNorm = normalize(char.name);
    const charParts = charNorm.split(' ').filter(p => p.length > 1);

    for (const [key, images] of Object.entries(refMap)) {
      if (!images?.length) continue;
      const keyNorm = normalize(key);

      if (charNorm.includes(keyNorm) || keyNorm.includes(charNorm)) {
        console.log(`[Pipeline] ✅ Fuzzy match: user ref key "${key}" ↔ character "${char.name}" (substring) → ${images.length} image(s)`);
        return images;
      }

      const keyParts = keyNorm.split(' ').filter(p => p.length > 1);
      const overlap = charParts.some(cp => keyParts.includes(cp));
      if (overlap) {
        console.log(`[Pipeline] ✅ Fuzzy match: user ref key "${key}" ↔ character "${char.name}" (word overlap) → ${images.length} image(s)`);
        return images;
      }
    }

    console.log(`[Pipeline] ❌ No reference images matched for "${char.name}" (id="${char.id}")`);
    return [];
  }

  /**
   * Fallback: Generate a single portrait if reference sheet generation fails.
   * Always allowed even in fail-fast mode — ref sheets are an enhancement,
   * not a hard requirement, and the portrait fallback is the recovery path.
   */
  private async fallbackToSinglePortrait(
    char: CharacterProfile,
    brief: MasterImageBrief,
    context: PipelineContext,
  ): Promise<null> {
    const { imageAgentTeam, imageService } = this.deps;
    console.warn(`[Pipeline] Falling back to single portrait for ${char.name}`);
    context.emit({
      type: 'warning',
      phase: 'reference_sheet',
      message: `Character reference generation failed for ${char.name}; attempting portrait fallback`,
    });
    context.emit({ type: 'agent_start', agent: 'ImageAgentTeam', message: `Generating single portrait for ${char.name} (fallback)...` });

    try {
      const promptRes = await withTimeout(imageAgentTeam.generateCharacterMasterPrompt({
        characterId: char.id,
        name: char.name,
        description: char.fullBackground || char.overview,
        role: char.role,
        genre: brief.story.genre,
        tone: brief.story.tone
      }), PIPELINE_TIMEOUTS.llmAgent, `CharacterMasterPrompt(${char.name})`);

      if (promptRes.success && promptRes.data) {
        await withTimeout(imageService.generateImage(
          promptRes.data,
          `master_char_${char.id}`,
          { type: 'master' }
        ), PIPELINE_TIMEOUTS.imageGeneration, `masterPortrait(${char.name})`);
        context.emit({ type: 'debug', phase: 'images', message: `Generated fallback portrait for ${char.name}` });
      }
    } catch (err) {
      console.warn(`[Pipeline] Failed to generate fallback portrait for ${char.name}:`, err);
    }

    return null;
  }

  /**
   * Analyze a user-provided reference image to extract physical traits using a vision LLM.
   * Returns structured physical traits that override the story's text-based descriptions.
   * In 'face-only' mode: extracts face, eyes, hair, skin, body type — leaves clothing to the story.
   * In 'full-appearance' mode: also extracts clothing, accessories, and outfit details.
   */
  private async analyzeReferenceImageTraits(
    image: { data: string; mimeType: string },
    characterName: string,
    referenceMode: CharacterReferenceMode,
    ctx: PipelineContext,
  ): Promise<{ physicalTraits: CharacterReferenceSheetRequest['physicalTraits']; clothingInfo?: { primary: string; accessories?: string[]; colorPalette?: string[] } } | null> {
    try {
      const modeLabel = referenceMode === 'full-appearance' ? 'full appearance (including clothing)' : 'physical traits only';
      ctx.emit({ type: 'debug', phase: 'images', message: `Analyzing reference image for ${characterName} — mode: ${modeLabel}...` });

      // Use a lightweight BaseAgent subclass for the vision call
      const { BaseAgent } = await import('../../agents/BaseAgent');

      class VisionAnalyzer extends BaseAgent {
        constructor(config: any) { super('VisionAnalyzer', config); }
        protected getAgentSpecificPrompt(): string { return ''; }
        async execute(_input: any): Promise<any> { throw new Error('Use callLLM directly'); }
      }

      const analyzer = new VisionAnalyzer({
        ...ctx.config.agents.storyArchitect,
        maxTokens: 1024,
        temperature: 0.2, // Low temp for factual description
      });

      // Build the vision prompt based on reference mode
      const clothingFields = referenceMode === 'full-appearance'
        ? `
  "clothing": "detailed description of the outfit/clothing visible (e.g. 'rumpled brown trench coat over dark button-up shirt, loosened tie')",
  "accessories": ["array of visible accessories like 'leather watch', 'silver ring', 'worn messenger bag'"],
  "clothingColorPalette": ["array of dominant clothing colors like 'dark brown', 'charcoal', 'cream'"],
  "clothingSummary": "A 1-2 sentence description of the complete outfit suitable for an image generation prompt",`
        : '';

      const clothingRule = referenceMode === 'full-appearance'
        ? '- ALSO describe clothing, jewelry, hats, accessories, and outfit details in the clothing fields.'
        : '- Do NOT describe clothing, jewelry, hats, or accessories.';

      const summaryInstruction = referenceMode === 'full-appearance'
        ? 'A 1-2 sentence physical description suitable for an image generation prompt, covering face, hair, body, and skin. Clothing is described separately in clothingSummary.'
        : 'A 1-2 sentence physical description suitable for an image generation prompt, covering face, hair, body, and skin. Do NOT mention clothing.';

      const userInstruction = referenceMode === 'full-appearance'
        ? `Analyze this reference image for the character "${characterName}". Extract their physical traits AND clothing/outfit details.`
        : `Analyze this reference image for the character "${characterName}". Extract their physical traits only — no clothing or accessories.`;

      const messages = [
        {
          role: 'system' as const,
          content: `You are a visual character analyst. You examine reference images and extract traits based on the requested mode.

Return a JSON object with ONLY these fields (omit any you can't determine):
{
  "age": "estimated age or age range (e.g. 'mid-30s', 'elderly', 'young adult')",
  "height": "apparent height if determinable (e.g. 'tall', 'average', 'short')",
  "build": "body type (e.g. 'athletic', 'slim', 'stocky', 'muscular', 'heavyset')",
  "hairColor": "hair color (e.g. 'dark brown', 'platinum blonde', 'salt-and-pepper')",
  "hairStyle": "hair style (e.g. 'short cropped', 'long wavy', 'braided', 'bald')",
  "eyeColor": "eye color if visible (e.g. 'blue', 'dark brown', 'green')",
  "skinTone": "skin tone (e.g. 'fair', 'olive', 'dark brown', 'tan')",
  "faceShape": "face shape (e.g. 'angular', 'round', 'square jaw', 'heart-shaped')",
  "distinguishingFeatures": ["array of notable physical features like 'prominent cheekbones', 'stubble', 'freckles', 'scar across left eye', 'dimpled chin'"],${clothingFields}
  "physicalSummary": "${summaryInstruction}"
}

CRITICAL:
- Describe WHAT YOU SEE in the image, not what you imagine.
${clothingRule}
- Do NOT invent traits you cannot see (e.g. don't guess eye color if the image is too small).
- Return ONLY valid JSON, no markdown fences.`,
        },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: userInstruction },
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: image.mimeType,
                data: image.data,
              }
            }
          ]
        }
      ];

      let response: string;
      let jsonMatch: RegExpMatchArray | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        response = await (analyzer as any).callLLM(messages);
        jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) break;
        console.warn(`[Pipeline] Vision analysis for ${characterName} attempt ${attempt}: No JSON found. Raw response (first 500 chars): ${response.substring(0, 500)}`);
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      if (!jsonMatch) {
        console.error(`[Pipeline] Vision analysis for ${characterName}: No JSON after 2 attempts`);
        ctx.emit({ type: 'warning', phase: 'images', message: `Vision analysis failed for ${characterName} — reference images will still be passed directly to image generation` });
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[Pipeline] Vision analysis for ${characterName} (${referenceMode}):`, JSON.stringify(parsed).substring(0, 400));

      ctx.emit({ type: 'debug', phase: 'images', message: `Reference image analysis for ${characterName} (${referenceMode}): ${parsed.physicalSummary || 'done'}` });

      const physicalTraits = {
        age: parsed.age,
        height: parsed.height,
        build: parsed.build,
        hairColor: parsed.hairColor,
        hairStyle: parsed.hairStyle,
        eyeColor: parsed.eyeColor,
        skinTone: parsed.skinTone,
        distinguishingFeatures: [
          ...(parsed.distinguishingFeatures || []),
          ...(parsed.faceShape ? [`${parsed.faceShape} face`] : []),
          // Store the full summary for use in prompt building
          ...(parsed.physicalSummary ? [`[REF_SUMMARY: ${parsed.physicalSummary}]`] : []),
        ],
      };

      // Extract clothing info when in full-appearance mode
      const clothingInfo = referenceMode === 'full-appearance' && parsed.clothing
        ? {
            primary: parsed.clothingSummary || parsed.clothing,
            accessories: parsed.accessories,
            colorPalette: parsed.clothingColorPalette,
          }
        : undefined;

      if (clothingInfo) {
        ctx.emit({ type: 'debug', phase: 'images', message: `Clothing from reference for ${characterName}: ${clothingInfo.primary}` });
      }

      return { physicalTraits, clothingInfo };
    } catch (error) {
      console.error(`[Pipeline] Failed to analyze reference image for ${characterName}:`, error);
      ctx.emit({ type: 'debug', phase: 'images', message: `Reference image analysis failed for ${characterName}: ${error}` });
      return null;
    }
  }

  /**
   * Extract physical traits from a character profile for reference sheet generation
   */
  private extractPhysicalTraits(char: CharacterProfile): CharacterReferenceSheetRequest['physicalTraits'] {
    // Try to parse physical traits from the character's description/background
    const text = `${char.fullBackground || ''} ${char.overview || ''}`.toLowerCase();

    const traits: CharacterReferenceSheetRequest['physicalTraits'] = {};

    // Simple extraction patterns - in production, the CharacterDesigner could provide structured data
    const agePatterns = [/(\d+)[\s-]*(year|yr)/i, /(young|middle-aged|elderly|teen|child|adult)/i];
    const heightPatterns = [/(tall|short|average height|petite)/i];
    const buildPatterns = [/(muscular|slim|slender|stocky|athletic|heavyset|lithe)/i];
    const hairColorPatterns = [/(blonde?|brunette|red|black|white|gray|silver|auburn|ginger)[\s-]*(hair)?/i];
    const hairStylePatterns = [/(long|short|curly|straight|wavy|braided?|bald|mohawk|ponytail)/i];
    const eyeColorPatterns = [/(blue|green|brown|hazel|gray|amber|violet|golden?)[\s-]*(eyes?)/i];

    for (const pattern of agePatterns) {
      const match = text.match(pattern);
      if (match) { traits.age = match[1] || match[0]; break; }
    }

    for (const pattern of heightPatterns) {
      const match = text.match(pattern);
      if (match) { traits.height = match[1]; break; }
    }

    for (const pattern of buildPatterns) {
      const match = text.match(pattern);
      if (match) { traits.build = match[1]; break; }
    }

    for (const pattern of hairColorPatterns) {
      const match = text.match(pattern);
      if (match) { traits.hairColor = match[1]; break; }
    }

    for (const pattern of hairStylePatterns) {
      const match = text.match(pattern);
      if (match) { traits.hairStyle = match[1]; break; }
    }

    for (const pattern of eyeColorPatterns) {
      const match = text.match(pattern);
      if (match) { traits.eyeColor = match[1]; break; }
    }

    // Look for distinguishing features
    const distinguishingPatterns = [
      /(scar on \w+)/i, /(tattoo)/i, /(glasses)/i, /(freckles)/i,
      /(beard)/i, /(mustache)/i, /(eyepatch)/i, /(missing \w+)/i
    ];
    const features: string[] = [];
    for (const pattern of distinguishingPatterns) {
      const match = text.match(pattern);
      if (match) features.push(match[0]);
    }
    if (features.length > 0) traits.distinguishingFeatures = features;

    return traits;
  }

  /**
   * Extract clothing info from a character profile
   */
  private extractClothingInfo(char: CharacterProfile): CharacterReferenceSheetRequest['clothing'] | undefined {
    const fashion = char.fashionStyle;
    const fashionPrimary = buildFashionPrimaryClothing(char);
    if (fashionPrimary) {
      return {
        primary: fashionPrimary,
        accessories: fashion?.accessories?.length ? fashion.accessories : undefined,
        colorPalette: fashion?.colorPalette?.length ? fashion.colorPalette : undefined,
      };
    }

    const text = `${char.typicalAttire || ''} ${char.fullBackground || ''} ${char.overview || ''}`.toLowerCase();

    // Simple extraction - look for clothing mentions
    const clothingPatterns = [
      /(wears? [\w\s]+)/i,
      /(dressed in [\w\s]+)/i,
      /([\w\s]+ robes?)/i,
      /(armor)/i,
      /(uniform)/i,
      /(cloak)/i,
      /(dress)/i,
      /(suit)/i
    ];

    for (const pattern of clothingPatterns) {
      const match = text.match(pattern);
      if (match) {
        return { primary: match[0].trim() };
      }
    }

    return undefined;
  }
}
