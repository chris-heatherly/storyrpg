/**
 * Scene Image Phase
 *
 * Generates the per-episode scene/beat imagery: episode color script (or
 * consumption of the pre-warmed one), episode style bible, optional
 * scene-opening-beat prefetch, the main per-scene beat loop (text plan or
 * visual-storyboard plan, chat-session continuity, asset-registry slot
 * tracking, hero visual QA with regeneration), beat resume state, Tier-2
 * scene QA + pose-diversity checks, LoRA training trigger, and orphaned
 * beat-image reconciliation.
 *
 * Faithful port of FullStoryPipeline.runEpisodeImageGeneration (pure move):
 * same control flow, same events, same diagnostics, same prompts. All
 * monolith helpers that are shared with other regions (encounter images,
 * cover art, prefetch) are injected as closures; run-scoped mutable state
 * (_openingBeatPrefetch, _generatedStyleReferencesAllowed,
 * _preWarmedColorScriptPromise, _uploadedStyleReferenceImages) is shared
 * with the monolith via by-reference maps and accessor properties so
 * behavior is identical during the migration.
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { WorldBible } from '../../agents/WorldBuilder';
import { SceneContent } from '../../agents/SceneWriter';
import { ChoiceSet } from '../../agents/ChoiceAuthor';
import {
  ImageAgentTeam,
  ColorScript,
  VisualPlan,
} from '../../agents/image-team/ImageAgentTeam';
import {
  ImageGenerationService,
  ReferenceImage,
  type CharacterAppearanceDescription,
} from '../../services/imageGenerationService';
import type { ImagePrompt, GeneratedImage } from '../../images/imageTypes';
import { AssetRegistry } from '../../images/assetRegistry';
import type { ImageSlotFamily, SlotReferencePack } from '../../images/slotTypes';
import {
  attachStoryboardPlanToVisualPlan,
  chunkStoryboardBeats,
  validateVisualStoryboardPacket,
  type ImagePlanningMode,
  type SceneVisualStoryboardPlan,
  type StoryboardReferenceSummary,
  type VisualStoryboardPacket,
} from '../../images/visualStoryboardPlanning';
import { buildBeatImagePrompt, overrideShotFromPlan } from '../../images/beatPromptBuilder';
import { CharacterStateTracker } from '../../images/CharacterStateTracker';
import { planShotSequence, type ShotPlan, type PanelMode } from '../../images/shotSequencePlanner';
import { resolveShotCast } from '../../images/shotCastResolver';
import { planSceneCoverage } from '../../images/cinematicCoveragePlanner';
import {
  runTier1Checks,
  checkStructuralDiversity,
  identifyRegenTargets,
  type Tier2SceneReport,
  type Tier2ShotReport,
  type VisualQAReport,
} from '../../images/visualValidation';
import {
  saveEarlyDiagnostic,
  saveBeatResumeState,
  loadBeatResumeStateSync,
} from '../../utils/pipelineOutputWriter';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import { slugify as idSlugify } from '../../utils/idUtils';
import { TIMING_DEFAULTS } from '../../../constants/pipeline';
import { getLocationInfoForScene } from '../planningHelpers';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// INPUT, RESULT & DEPENDENCY TYPES
// ========================================

export interface SceneImagePhaseInput {
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  brief: FullCreativeBrief;
  worldBible: WorldBible;
  characterBible: CharacterBible;
  outputDirectory?: string;
  options?: { skipColorScriptAndStyleBible?: boolean; missingSlotIds?: string[] };
}

export interface SceneImagePhaseResult {
  beatImages: Map<string, string>;
  sceneImages: Map<string, string>;
}

/**
 * Everything the phase still borrows from the monolith. Helpers shared with
 * other pipeline regions stay injected; underscore-prefixed entries mirror
 * the monolith's run-scoped mutable fields (the monolith exposes them as
 * accessor properties so writes are visible on both sides).
 */
export interface SceneImagePhaseDeps {
  imageAgentTeam: Pick<ImageAgentTeam, 'runFullVisualQA' | 'validatePoseDiversity'>;
  imageService: Pick<
    ImageGenerationService,
    | 'clearGeminiPreviousScene'
    | 'editImage'
    | 'endChatSession'
    | 'generateImage'
    | 'generateImageInChat'
    | 'getGeminiSettings'
    | 'getMaxRetries'
    | 'hasChatSession'
    | 'setGeminiPreviousScene'
    | 'setSeasonStyleReference'
    | 'startChatSession'
  >;
  assetRegistry: Pick<
    AssetRegistry,
    'get' | 'getResolvedAsset' | 'markFailure' | 'markRendering' | 'markSuccess' | 'planSlot'
  >;
  collectedVisualPlanning: { colorScript?: ColorScript; visualPlans: VisualPlan[] };
  checkCancellation: () => Promise<void>;

  // --- Run-scoped mutable state shared with the monolith ---
  _generatedStyleReferencesAllowed: boolean;
  _preWarmedColorScriptPromise: Promise<ColorScript | undefined> | null;
  _openingBeatPrefetch: Map<string, GeneratedImage>;
  readonly _uploadedStyleReferenceImages: ReferenceImage[];

  // --- Helpers shared with other monolith regions (injected closures) ---
  analyzeBeatCharacters: (
    beatText: string,
    beatSpeaker: string | undefined,
    sceneCharacterIds: string[],
    characterBible: CharacterBible,
    protagonistId: string
  ) => { foreground: string[]; background: string[]; foregroundNames: string[]; backgroundNames: string[] };
  applyThirdPersonRenderContract: (
    prompt: ImagePrompt,
    storyboardShot?: VisualStoryboardPacket['shots'][number],
    options?: { isEnvironmentShot?: boolean },
  ) => ImagePrompt;
  buildBeatSceneStoryboardPlan: (params: {
    sceneId: string;
    scopedSceneId: string;
    sceneName: string;
    sceneDescription?: string;
    beats: Array<{ id: string; text?: string }>;
    visualPlan?: VisualPlan;
  }) => SceneVisualStoryboardPlan;
  buildCharacterDescriptions: (
    characterIds: string[],
    characterBible: CharacterBible
  ) => CharacterAppearanceDescription[];
  createSlotReferencePack: (slotId: string, references: unknown[] | undefined) => SlotReferencePack | undefined;
  ensureCharacterReferencesForVisibleCharacters: (
    ids: string[] | undefined,
    characterBible: CharacterBible,
    brief: FullCreativeBrief,
    contextLabel: string,
  ) => Promise<string[]>;
  extractSceneContext: (
    scene: SceneContent,
    sceneIndex: number,
    totalScenes: number,
    worldBible: WorldBible
  ) => {
    isClimactic: boolean;
    isResolution: boolean;
    isFlashback: boolean;
    isNightmare: boolean;
    isSafeHubScene: boolean;
    branchType: 'dark' | 'hopeful' | 'neutral';
    timeOfDay?: 'dawn' | 'day' | 'dusk' | 'night';
  };
  findExistingImageArtifact: (imagesDir: string, baseIdentifier: string) => Promise<GeneratedImage | undefined>;
  gatherCharacterBodyVocabularies: (
    characterIds: string[],
    characterBible: CharacterBible
  ) => Array<{
    characterId: string;
    characterName: string;
    basePosture: string;
    gestureStyle: string;
    characteristicPoses: string[];
    statusBehavior: string;
    emotionalTells: string;
  }>;
  gatherCharacterReferenceImages: (
    characterIds: string[],
    characterBible: CharacterBible,
    locationId?: string,
    options?: { includeExpressions?: boolean; family?: ImageSlotFamily; slotId?: string }
  ) => Array<{ data: string; mimeType: string; role: string; characterName: string; viewType: string; visualAnchors?: string[] }>;
  generateEpisodeColorScript: (
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[]
  ) => Promise<ColorScript | undefined>;
  generateEpisodeStyleBible: (
    brief: FullCreativeBrief,
    colorScript: ColorScript,
    characterBible: CharacterBible,
    outputDirectory?: string
  ) => Promise<boolean>;
  generateImageWithDefectRetries: (
    prompt: ImagePrompt,
    identifier: string,
    metadata: any,
    referenceImages: any[] | undefined,
    label: string,
    outputDirectory?: string,
    renderImage?: (
      activePrompt: ImagePrompt,
      attemptIdentifier: string,
      attemptMetadata: any,
      attemptReferences: any[] | undefined
    ) => Promise<GeneratedImage>,
  ) => Promise<GeneratedImage>;
  getCharacterIdsInScene: (scene: SceneContent, characterBible: CharacterBible, protagonistId?: string) => string[];
  getEffectiveImagePlanningMode: () => 'text' | 'visual-storyboard';
  getEffectiveImagePromptMode: () => 'deterministic' | 'llm';
  getEffectiveImageQaMode: () => 'off' | 'fast' | 'full';
  getEpisodeScopedBeatKey: (brief: FullCreativeBrief, sceneId: string, beatId: string) => string;
  getEpisodeScopedSceneId: (brief: FullCreativeBrief, sceneId: string) => string;
  getStoryboardMaxPanelsPerSheet: () => number;
  inferIntensity: (speakerMood?: string, text?: string) => 'low' | 'medium' | 'high';
  inferValence: (speakerMood?: string, text?: string) => 'positive' | 'negative' | 'ambiguous';
  isEstablishingBeat: (
    beatText: string,
    speaker: string | undefined,
    primaryAction: string | undefined,
    beatCharContext: { foreground: string[]; foregroundNames: string[] }
  ) => boolean;
  isLlmQuotaFailure: (errorLike: unknown) => boolean;
  mapChoicePositions: (
    choiceSets: ChoiceSet[],
    scene: SceneContent
  ) => Array<{
    beatId: string;
    choiceType: 'binary' | 'multiple' | 'timed';
    options?: Array<{ type: 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other'; label?: string }>;
  }>;
  mapSpeakerMoodToEmotion: (speakerMood?: string) => 'hopeful' | 'tense' | 'melancholy' | 'triumphant' | 'eerie' | 'neutral';
  prefetchSceneOpeningBeats: (
    sceneContents: SceneContent[],
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    colorScript: ColorScript | undefined,
    worldBible: WorldBible,
    outputDirectory?: string,
  ) => Promise<void>;
  promptMentionsDisallowedCharacters: (
    prompt: ImagePrompt,
    allowedCharacterNames: string[],
    allSceneCharacterNames: string[],
  ) => string[];
  promptMissingRequiredCharacters: (prompt: ImagePrompt, requiredCharacterNames: string[]) => string[];
  reconcileOrphanedBeatImages: (
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    beatImages: Map<string, string>,
    sceneImages: Map<string, string>,
  ) => number;
  runLoraTrainingIfEligible: (
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    outputDirectory?: string,
  ) => Promise<void>;
  sanitizeImagePrompt: (prompt: ImagePrompt, brief: FullCreativeBrief) => ImagePrompt;
  sanitizePromptText: (raw: unknown, brief: FullCreativeBrief, fallback?: string) => string;
  saveBeatVisualQADiagnostic: (
    outputDirectory: string | undefined,
    identifier: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  saveSceneVisualPlanningDiagnostic: (
    outputDirectory: string | undefined,
    scopedSceneId: string,
    payload: Record<string, unknown>,
    options?: { suffix?: string },
  ) => Promise<void>;
  saveSceneVisualQADiagnostic: (
    outputDirectory: string | undefined,
    scopedSceneId: string,
    report: unknown,
  ) => Promise<void>;
  serializeVisualQAReport: (report: any) => Record<string, unknown>;
  shouldRunHeroVisualQA: (
    beat: any,
    beatIndex: number,
    totalBeats: number,
    qaMode: 'off' | 'fast' | 'full',
  ) => boolean;
  throwIfFailFast: (
    message: string,
    phase: string,
    options?: { agent?: string; context?: Record<string, unknown>; originalError?: Error },
  ) => void;
  withSettingAwarePrompt: (
    prompt: ImagePrompt,
    settingContext?: import('../../utils/styleAdaptation').SceneSettingContext,
  ) => ImagePrompt;
  wrapLlmImagePromptWithContracts: (
    prompt: ImagePrompt,
    input: import('../../images/beatPromptBuilder').BeatPromptInput,
    sceneContext: import('../../images/beatPromptBuilder').ScenePromptContext,
    characterNames: string[],
    promptMode: string,
    brief: FullCreativeBrief,
  ) => ImagePrompt;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class SceneImagePhase {
  readonly name = 'scene_images';

  constructor(private readonly deps: SceneImagePhaseDeps) {}

  /**
   * Generate images for an episode's scenes and beats.
   * Faithful port of FullStoryPipeline.runEpisodeImageGeneration.
   */
  async run(input: SceneImagePhaseInput, context: PipelineContext): Promise<SceneImagePhaseResult> {
    const { sceneContents, choiceSets, brief, worldBible, characterBible, outputDirectory, options } = input;
    const beatImages = new Map<string, string>();
    const sceneImages = new Map<string, string>();

    // Track last generated image for continuity (previous scene + style reference fallback)
    let lastGeneratedImage: { data: string; mimeType: string } | null = null;
    let styleReferenceStored = false;
    this.deps._generatedStyleReferencesAllowed = true;
    try {
      (this.deps.imageAgentTeam as any).resetIdentityRegenerationBudget?.();
    } catch { /* identity gate budget reset is best-effort */ }

    // Global image counter across all scenes for progress reporting
    let globalImageIndex = 0;
    const estimatedTotalImages = sceneContents.reduce((sum, sc) => sum + (sc.beats?.length || 0), 0);
    const shouldProcessSceneForRequestedSlots = (scopedSceneId: string): boolean => {
      if (!options?.missingSlotIds) return true;
      return options.missingSlotIds.some((slotId) =>
        slotId === `story-scene:${scopedSceneId}` || slotId.startsWith(`story-beat:${scopedSceneId}::`)
      );
    };
    
    // PHASE 1: Generate color script for visual arc consistency.
    // A10: prefer the pre-warmed promise if the caller kicked one off in
    // parallel with master-image generation. Fresh inline call is the
    // fallback (and matches pre-A10 behavior).
    let colorScript: ColorScript | undefined;
    if (options?.skipColorScriptAndStyleBible) {
      this.deps._preWarmedColorScriptPromise = null;
      context.emit({
        type: 'debug',
        phase: 'images',
        message: 'Image-only missing-slot resume: skipping color script and style-bible preflight.',
      });
    } else if (this.deps._preWarmedColorScriptPromise) {
      colorScript = await this.deps._preWarmedColorScriptPromise;
      this.deps._preWarmedColorScriptPromise = null;
      if (colorScript === undefined) {
        colorScript = await this.deps.generateEpisodeColorScript(brief, sceneContents, choiceSets);
      }
    } else {
      colorScript = await this.deps.generateEpisodeColorScript(brief, sceneContents, choiceSets);
    }
    
    // Store color script for saving
    if (colorScript) {
      this.deps.collectedVisualPlanning.colorScript = colorScript;
    }

    if (colorScript && !options?.skipColorScriptAndStyleBible) {
      styleReferenceStored = await this.deps.generateEpisodeStyleBible(brief, colorScript, characterBible, outputDirectory);
    }

    // LoRA training hook. Runs after the character reference sheets AND the
    // style-bible anchors are available — both are prerequisites for
    // meaningful training data. The call is a no-op for providers that
    // can't consume LoRAs (i.e. anything but Stable Diffusion today) and
    // whenever the subsystem is disabled in config.
    try {
      await this.deps.runLoraTrainingIfEligible(brief, characterBible, outputDirectory);
    } catch (loraErr) {
      context.emit({
        type: 'warning',
        phase: 'images',
        message: `LoRA training pass threw (non-fatal, continuing scene generation): ${loraErr instanceof Error ? loraErr.message : String(loraErr)}`,
      });
    }
    
    // A3 (narrow, opt-in): fan out scene-opening beats in parallel before
    // the main loop runs. Keeps D10's per-scene continuity invariant intact
    // because mid-scene beats remain strictly sequential inside the loop —
    // only the FIRST beat of each scene is hoisted, which by definition
    // has no previous-beat continuity dependency (D10 clears the reference
    // at every scene boundary). A4 (full overlap of scene N with scene
    // N+1's tail) remains deferred; see IMAGE_PIPELINE_RUNTIME.md.
    const imagePipelineEnv = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
    const parallelSceneStartsEnabled = imagePipelineEnv.EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS === 'true'
      || imagePipelineEnv.EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS === '1';
    const effectivePromptMode = this.deps.getEffectiveImagePromptMode();
    if (parallelSceneStartsEnabled && effectivePromptMode === 'deterministic') {
      try {
        await this.deps.prefetchSceneOpeningBeats(sceneContents, brief, characterBible, colorScript, worldBible, outputDirectory);
      } catch (prefetchErr) {
        context.emit({
          type: 'warning',
          phase: 'images',
          message: `A3-narrow prefetch phase threw (falling back to inline generation): ${prefetchErr instanceof Error ? prefetchErr.message : String(prefetchErr)}`,
        });
        this.deps._openingBeatPrefetch.clear();
      }
    } else {
      this.deps._openingBeatPrefetch.clear();
      if (parallelSceneStartsEnabled && effectivePromptMode !== 'deterministic') {
        context.emit({
          type: 'debug',
          phase: 'images',
          message: `A3-narrow prefetch skipped because promptMode=${effectivePromptMode}; LLM/compare mode needs scene-level visual planning first.`,
        });
      }
    }

	    for (let sceneIndex = 0; sceneIndex < sceneContents.length; sceneIndex++) {
	      await this.deps.checkCancellation();
	      const scene = sceneContents[sceneIndex];
	      const scopedSceneId = this.deps.getEpisodeScopedSceneId(brief, scene.sceneId);
	      if (!shouldProcessSceneForRequestedSlots(scopedSceneId)) {
	        context.emit({
	          type: 'debug',
	          phase: 'images',
	          message: `Image-only resume skipping scene ${scene.sceneId}; story beat slots already resolved.`,
	        });
	        continue;
	      }
	      context.emit({ type: 'agent_start', agent: 'ImageAgentTeam', message: `Planning visuals for scene: ${scene.sceneName}...` });

      // D10: drop the previous-scene reference at every scene boundary so the
      // first beat of the new scene isn't biased by the last beat of the
      // previous one. Continuation within the scene's beats still benefits
      // from setGeminiPreviousScene after each successful generation.
      this.deps.imageService.clearGeminiPreviousScene();
      const characterStateTracker = new CharacterStateTracker(characterBible);

      try {
        // Null-safety: guarantee array fields are always arrays before any downstream code touches them
        if (!Array.isArray(scene.moodProgression)) scene.moodProgression = scene.moodProgression ? [scene.moodProgression as unknown as string] : [];
        if (!Array.isArray(scene.keyMoments)) scene.keyMoments = scene.keyMoments ? [scene.keyMoments as unknown as string] : [];
        if (!Array.isArray(scene.charactersInvolved)) scene.charactersInvolved = [];
        if (!Array.isArray(scene.continuityNotes)) scene.continuityNotes = [];

        console.log(`[Pipeline] 🖼 Image generation step 1/6: gathering characters for scene "${scene.sceneId}"`);
        // Collect character IDs present in this scene for reference image gathering
        const sceneCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
          this.deps.getCharacterIdsInScene(scene, characterBible, brief.protagonist.id),
          characterBible,
          brief,
          `scene:${scopedSceneId}`
        );
        
        console.log(`[Pipeline] 🖼 Image generation step 2/6: body vocabularies for scene "${scene.sceneId}"`);
        // Get body vocabularies for characters in scene (for pose consistency)
        // Note: silhouette data is now injected per-character via characterDescriptions below
        const characterBodyVocabularies = this.deps.gatherCharacterBodyVocabularies(sceneCharacterIds, characterBible);
        
        console.log(`[Pipeline] 🖼 Image generation step 3/6: extracting scene context for scene "${scene.sceneId}"`);
        // Extract scene context
        const sceneContext = {
          ...this.deps.extractSceneContext(scene, sceneIndex, sceneContents.length, worldBible),
          settingContext: scene.settingContext,
        };
        
        console.log(`[Pipeline] 🖼 Image generation step 4/6: mapping choice positions for scene "${scene.sceneId}"`);
        // Map choice positions for this scene
        const choicePositions = this.deps.mapChoicePositions(choiceSets, scene);
        
        console.log(`[Pipeline] 🖼 Image generation step 5/6: getting location info for scene "${scene.sceneId}"`);
        // Get location info
        const locationInfo = getLocationInfoForScene(scene, worldBible);
        
        const sceneLocationId = locationInfo?.locationId;
        const imageServiceWithRefs = {
          generateImage: async (prompt: ImagePrompt, identifier: string, metadata?: any) => {
            const shotCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
              metadata?.characters || sceneCharacterIds,
              characterBible,
              brief,
              `slot:${identifier}`
            );
            const referenceImages = this.deps.gatherCharacterReferenceImages(
              shotCharacterIds,
              characterBible,
              sceneLocationId,
              {
                includeExpressions: metadata?.includeExpressionRefs === true,
                family: 'story-beat',
                slotId: metadata?.sceneId && metadata?.beatId
                  ? `story-beat:${metadata.sceneId}::${metadata.beatId}`
                  : `story-scene:${scopedSceneId}`,
              }
            );
            
            return this.deps.generateImageWithDefectRetries(
              prompt,
              identifier,
              metadata,
              referenceImages.length > 0 ? referenceImages : undefined,
              `storyBeat(${identifier})`,
              outputDirectory,
            );
          }
        };

        // Filter beats based on image generation strategy (narrative-aware, mirrors story approach)
	        const imageStrategy = context.config.imageGen?.strategy || 'all-beats';
        const beatsToIllustrate = imageStrategy === 'all-beats' 
          ? scene.beats 
          : scene.beats.filter((b, idx) => {
              const isStartingBeat = b.id === scene.startingBeatId || idx === 0;
              const isChoicePoint = b.isChoicePoint === true;
              const isLastBeat = idx === scene.beats.length - 1;
              const isClimaxBeat = (b as { isClimaxBeat?: boolean }).isClimaxBeat === true;
              const isKeyStoryBeat = (b as { isKeyStoryBeat?: boolean }).isKeyStoryBeat === true;
              const isChoicePayoff = (b as { isChoicePayoff?: boolean }).isChoicePayoff === true;
              const isIntervalBeat = idx % 3 === 0;
              return isStartingBeat || isChoicePoint || isLastBeat || isClimaxBeat || isKeyStoryBeat || isChoicePayoff || isIntervalBeat;
            });
        
        const sceneCoveragePlan = planSceneCoverage({
          sceneId: scene.sceneId,
          beats: beatsToIllustrate.map((b) => ({
            id: b.id,
            text: b.text,
            speaker: b.speaker,
            speakerMood: b.speakerMood,
            shotType: (b as any).shotType,
            isClimaxBeat: b.isClimaxBeat,
            isKeyStoryBeat: b.isKeyStoryBeat,
            isChoicePayoff: (b as any).isChoicePayoff,
            visualMoment: b.visualMoment,
            primaryAction: b.primaryAction,
            emotionalRead: b.emotionalRead,
            relationshipDynamic: b.relationshipDynamic,
            mustShowDetail: b.mustShowDetail,
            dramaticIntent: (b as any).dramaticIntent,
            sequenceIntent: (b as any).sequenceIntent || (scene as any).sequenceIntent,
            plantsThreadId: (b as any).plantsThreadId,
            paysOffThreadId: (b as any).paysOffThreadId,
            plotPointType: (b as any).plotPointType,
            twistKind: (b as any).twistKind,
          })),
          sceneCharacterIds,
          characters: characterBible.characters.map(c => ({ id: c.id, name: c.name, role: c.role })),
          protagonistId: brief.protagonist.id,
        });
        const coverageByBeatId = new Map(sceneCoveragePlan.beats.map((beat) => [beat.beatId, beat]));
        if (outputDirectory) {
          await saveEarlyDiagnostic(outputDirectory, `images/prompts/${scopedSceneId}.coverage-plan.json`, {
            generatedAt: new Date().toISOString(),
            scopedSceneId,
            status: 'coverage-plan',
            coverageBeats: sceneCoveragePlan.beats,
            diagnostics: sceneCoveragePlan.diagnostics,
          });
        }
        if (sceneCoveragePlan.diagnostics.castWarnings.length > 0 || sceneCoveragePlan.diagnostics.solitaryCompositionWarnings.length > 0) {
          context.emit({
            type: 'warning',
            phase: 'images',
            message: `Coverage planning warnings for ${scene.sceneId}: ${[
              ...sceneCoveragePlan.diagnostics.castWarnings,
              ...sceneCoveragePlan.diagnostics.solitaryCompositionWarnings,
            ].join('; ')}`,
          });
        }

        console.log(`[Pipeline] 🖼 Image generation step 6/6: building enrichedBeats for scene "${scene.sceneId}" (${beatsToIllustrate.length} beats selected)`);
        // Build enriched beat data with per-beat character analysis
        // This determines WHO is in the visual foreground vs background for each beat
        const enrichedBeats = beatsToIllustrate.map((b, beatIndex) => {
          const coverage = coverageByBeatId.get(b.id);
          const beatCharContext = this.deps.analyzeBeatCharacters(
            b.text,
            b.speaker,
            sceneCharacterIds,
            characterBible,
            brief.protagonist.id
          );
          // Resolve shotType: use SceneWriter's explicit value when available, otherwise derive from
          // character context. Beats where the protagonist only entered foreground via the "your/you"
          // second-person fallback (no named characters in text, no speaker, no action verb) are
          // treated as establishing shots — environment-only, no character poses.
          const explicitShotType = (b as any).shotType as 'establishing' | 'character' | 'action' | undefined;
          const isEstablishing = coverage
            ? coverage.coveragePlan.stagingPattern === 'environment'
            : explicitShotType === 'establishing'
              || (!explicitShotType && this.deps.isEstablishingBeat(b.text, b.speaker, b.primaryAction, beatCharContext));
          const resolvedShotType: 'establishing' | 'character' | 'action' = coverage
            ? (isEstablishing ? 'establishing' : ((b as any).shotType === 'action' ? 'action' : 'character'))
            : explicitShotType || (isEstablishing ? 'establishing' : 'character');
          const shotCast = coverage ? undefined : resolveShotCast({
            beat: { ...b, shotType: resolvedShotType },
            sceneCharacterIds,
            characters: characterBible.characters.map(c => ({ id: c.id, name: c.name })),
            protagonistId: brief.protagonist.id,
          });
          const visibleCharacterIds = [
            ...(coverage?.coveragePlan.requiredVisibleCharacterIds || shotCast?.requiredForegroundCharacterIds || []),
            ...(coverage?.coveragePlan.optionalVisibleCharacterIds || shotCast?.optionalBackgroundCharacterIds || []),
          ];
          const getName = (id: string) => characterBible.characters.find(c => c.id === id)?.name || id;
          (b as any).visualCast = coverage?.visualCast;
          (b as any).coveragePlan = coverage?.coveragePlan;
          return {
            id: b.id,
            text: b.text,
            isClimaxBeat: b.isClimaxBeat,
            isKeyStoryBeat: b.isKeyStoryBeat,
            // Per-beat shot cast: scene-present characters remain offscreen unless the beat needs them.
            characters: isEstablishing ? [] : visibleCharacterIds,
            foregroundCharacters: isEstablishing ? [] : (coverage?.visualCast.foregroundCharacterIds || shotCast?.requiredForegroundCharacterIds || []).map(getName),
            backgroundCharacters: isEstablishing ? [] : (coverage?.visualCast.backgroundCharacterIds || shotCast?.optionalBackgroundCharacterIds || []).map(getName),
            offscreenCharacters: coverage?.coveragePlan.offscreenCharacterIds || shotCast?.offscreenCharacterIds || [],
            shotCastReason: coverage?.visualCast.castReason || shotCast?.shotCastReason,
            visualCast: coverage?.visualCast,
            coveragePlan: coverage?.coveragePlan,
            // Map speakerMood to emotional hints for visual generation
            emotionHint: isEstablishing ? undefined : this.deps.mapSpeakerMoodToEmotion(b.speakerMood),
            intensityHint: this.deps.inferIntensity(b.speakerMood, b.text),
            valenceHint: this.deps.inferValence(b.speakerMood, b.text),
            // B4: SceneWriter-authored visual contract fields now typed on Beat.
            visualMoment: b.visualMoment,
            primaryAction: isEstablishing ? '' : b.primaryAction,
            emotionalRead: isEstablishing ? '' : b.emotionalRead,
            relationshipDynamic: isEstablishing ? '' : b.relationshipDynamic,
            mustShowDetail: b.mustShowDetail,
            dramaticIntent: isEstablishing ? undefined : (b as any).dramaticIntent,
            sequenceIntent: isEstablishing ? undefined : ((b as any).sequenceIntent || (scene as any).sequenceIntent),
            // Shot intent — drives image prompt strategy (establishing = environment-only)
            shotType: resolvedShotType,
          };
        });
        
        // --- Shot Sequence Planning (runs for ALL beats regardless of panelMode) ---
        const panelMode: PanelMode = context.config.imageGen?.panelMode || 'single';
        const shotPlans = planShotSequence(
          enrichedBeats.map(b => ({
            id: b.id,
            text: b.text,
            shotType: (b as any).shotType,
            isClimaxBeat: b.isClimaxBeat,
            isKeyStoryBeat: b.isKeyStoryBeat,
            isChoicePayoff: (b as any).isChoicePayoff,
            emotionalRead: b.emotionalRead,
            relationshipDynamic: b.relationshipDynamic,
            primaryAction: b.primaryAction,
            intensityTier: (b as any).intensityTier,
          })),
          { genre: brief.story.genre, tone: brief.story.tone },
          panelMode,
        );
        for (const plan of shotPlans) {
          const coverage = coverageByBeatId.get(plan.beatId)?.coveragePlan;
          if (coverage) {
            plan.assignedShotType = coverage.shotDistance;
            plan.assignedAngle = coverage.cameraAngle;
          }
        }
        const shotPlanMap = new Map<string, ShotPlan>(
          shotPlans.map(sp => [sp.beatId, sp])
        );

        context.emit({ 
          type: 'debug', 
          phase: 'images', 
          message: `Image strategy "${imageStrategy}": ${beatsToIllustrate.length}/${scene.beats.length} beats to illustrate for scene ${scene.sceneId}. Shot plan: ${shotPlans.filter(sp => sp.isPanelBeat).length} panel beats, panelMode=${panelMode}` 
        });

        // Skip storyboard for encounter scenes (0 narrative beats — images are handled by EncounterImageAgent)
        if (enrichedBeats.length === 0) {
          console.log(`[Pipeline] ⏭ Skipping storyboard for scene "${scene.sceneId}" — no narrative beats to illustrate (encounter-only scene)`);
          context.emit({ type: 'debug', phase: 'images', message: `Skipped storyboard for ${scene.sceneName}: no narrative beats` });
          continue;
        }

        // Beat resume state: load completed beat IDs for this scene from disk
        const sceneSlug = idSlugify(scene.sceneId);
        const beatResumeLoaded = outputDirectory ? loadBeatResumeStateSync(outputDirectory, sceneSlug) : null;
        const beatResumeSet = new Set<string>(beatResumeLoaded?.completedIdentifiers ?? []);
        const beatResumeImageMap: Record<string, string> = { ...(beatResumeLoaded?.beatImageMap ?? {}) };
        const persistBeatResume = async (): Promise<void> => {
          if (!outputDirectory) return;
          await saveBeatResumeState(outputDirectory, sceneSlug, {
            version: 1,
            sceneId: scene.sceneId,
            scopedSceneId,
            completedIdentifiers: [...beatResumeSet],
            beatImageMap: beatResumeImageMap,
            generatedAt: new Date().toISOString(),
          });
        };
        if (beatResumeLoaded && beatResumeSet.size > 0) {
          console.log(`[Pipeline] Beat resume: loaded ${beatResumeSet.size} completed beats for scene ${scene.sceneId}`);
        }

        // Determine scene mood from mood progression
        const sceneMood = scene.moodProgression.length > 0 
          ? scene.moodProgression[0] 
          : (sceneContext.isClimactic ? 'intense' : 'dramatic');

        // ----- CONTRACT-GUARDED BEAT IMAGE GENERATION -----
        // In LLM mode the storyboard/illustrator agents provide creative shot
        // planning, but the split pipeline keeps deterministic authority over
        // style, cast, references, provider filtering, and QA acceptance.
        const chatModeEnabled = this.deps.imageService.getGeminiSettings().useChatMode === true;
        if (chatModeEnabled) {
          const artStyle = this.deps.imageService.getGeminiSettings().canonicalArtStyle || context.config.artStyle || 'dramatic cinematic story art';
          const sceneCharIds = [...new Set(enrichedBeats.flatMap(b => b.characters || []))];
          const sceneCharDescs = this.deps.buildCharacterDescriptions(sceneCharIds, characterBible);
          const charIdentityLines = sceneCharDescs.map(d => `${d.name}: ${d.appearance}`);
          const charNames = sceneCharDescs.map(d => d.name).join(', ');
          let systemContext = 
            `You are generating a series of dramatic story images for a scene. ` +
            `Art style (MANDATORY): ${artStyle}. Maintain this exact art style across ALL images in this series. ` +
            `Characters in this scene: ${charNames || 'see references'}. `;
          if (charIdentityLines.length > 0) {
            systemContext += `CHARACTER VISUAL IDENTITY (use these exact descriptions across ALL images, do NOT contradict): ${charIdentityLines.join('. ')}. `;
          }
          systemContext +=
            `CRITICAL: Maintain identical character appearance AND identical art style across ALL images in this series. ` +
            `Every image must look like it belongs in the same art series. Each image should show a different moment in the same scene.`;
          this.deps.imageService.startChatSession(scopedSceneId, systemContext);
        }

        // Extract color mood for this scene (if color script is available)
        const sceneColorMood = (colorScript as any)?.scenes
          ?.find((cs: any) => cs.sceneId === scene.sceneId || cs.sceneName === scene.sceneName);
        const colorMoodHints = sceneColorMood ? {
          palette: (sceneColorMood as any).palette || (sceneColorMood as any).colorPalette,
          lighting: (sceneColorMood as any).lighting || (sceneColorMood as any).lightingMood,
          temperature: (sceneColorMood as any).temperature,
        } : undefined;

        const scenePromptCtx: import('../../images/beatPromptBuilder').ScenePromptContext = {
          sceneId: scene.sceneId,
          sceneName: scene.sceneName,
          genre: brief.story.genre,
          tone: brief.story.tone,
          mood: sceneMood,
          settingContext: scene.settingContext,
          artStyle: context.config.artStyle,
          colorMood: colorMoodHints,
          // C2: pass the structured style profile so the deterministic prompt
          // builder can drop negatives that contradict the chosen aesthetic
          // and merge the profile's genreNegatives into the final prompt.
          styleProfile: context.config.imageGen?.artStyleProfile,
        };

        // Build beat-level character lookup from our earlier analysis
        const beatCharacterMap = new Map<string, string[]>();
        for (const eb of enrichedBeats) {
          beatCharacterMap.set(eb.id, eb.characters);
        }
        const allSceneCharacterNames = sceneCharacterIds
          .map(id => characterBible.characters.find(c => c.id === id)?.name)
          .filter(Boolean) as string[];

        const promptMode = this.deps.getEffectiveImagePromptMode();
        const qaMode = this.deps.getEffectiveImageQaMode();
        const imagePlanningMode = this.deps.getEffectiveImagePlanningMode();
        let llmVisualPlan: VisualPlan | undefined;
        const llmPromptMap = new Map<string, ImagePrompt>();
        const generatedImagesForVisualQA = new Map<string, GeneratedImage>();
        const generatedImagesForSceneQA = new Map<string, GeneratedImage>();
        const heroVisualQAIdentifiers = new Map<string, string>();
        const renderedBeatSlots = new Map<string, {
          identifier: string;
          imagePrompt: ImagePrompt;
          referenceImages: any[];
          metadata: any;
          beatIndex: number;
          beat: any;
          beatMapKey: string;
          shotCharacterNames: string[];
          shotCharacterDescriptions: any[];
          beatPromptInput: import('../../images/beatPromptBuilder').BeatPromptInput;
        }>();

        let storyboardRequest: any | undefined;
        const storyboardPacketByBeatId = new Map<string, VisualStoryboardPacket['shots'][number]>();
        const storyboardPacketModeByBeatId = new Map<string, {
          requestedMode: 'visual-storyboard';
          effectiveMode: ImagePlanningMode;
          fallbackReason?: string;
          chunkIndex?: number;
        }>();
        const storyboardPackets: VisualStoryboardPacket[] = [];
        if (imagePlanningMode === 'visual-storyboard') {
          const sceneCharacterDescriptions = this.deps.buildCharacterDescriptions(sceneCharacterIds, characterBible)
            .map((desc: any) => {
              const character = characterBible.characters.find(c => c.name === desc.name);
              return {
                id: character?.id || desc.name,
                name: desc.name,
                physicalDescription: desc.appearance || '',
                distinctiveFeatures: desc.canonicalAppearance?.distinctiveFeatures || [],
                typicalAttire: desc.canonicalAppearance?.attire || '',
                role: character?.role || '',
                silhouetteHooks: desc.canonicalAppearance?.silhouetteHooks,
                shapeLanguage: desc.canonicalAppearance?.shapeLanguage,
                contrastNotes: desc.canonicalAppearance?.contrastNotes,
              };
            });
          const sceneDescription = [
            scene.sceneName,
            (scene.settingContext as any)?.description,
            Array.isArray(scene.keyMoments) ? scene.keyMoments.join(' ') : undefined,
          ].filter(Boolean).join('. ');
          const sceneMasterPrompt = {
            style: context.config.artStyle || '',
            styleNegatives: 'style drift, unapproved renderer, unapproved texture system, first-person POV',
            location: (scene.settingContext as any)?.description || sceneDescription || scene.sceneName,
            lightingColor: [
              colorMoodHints?.palette ? `palette: ${colorMoodHints.palette}` : undefined,
              colorMoodHints?.lighting ? `lighting: ${colorMoodHints.lighting}` : undefined,
              colorMoodHints?.temperature ? `temperature: ${colorMoodHints.temperature}` : undefined,
            ].filter(Boolean).join('; ') || sceneMood,
            castPolicy: 'Only show characters explicitly required by each shot row; all other scene-present characters remain offscreen.',
            thirdPersonCameraRule: 'Every image is a third-person observer camera outside the protagonist; no literal player-eye POV, disembodied hands, "your hand" framing, or camera inside the player body.',
            referenceSummary: [] as StoryboardReferenceSummary[],
          };
          storyboardRequest = {
            sceneId: scopedSceneId,
            sceneName: scene.sceneName,
            sceneDescription,
            beats: enrichedBeats,
            genre: brief.story.genre,
            tone: brief.story.tone,
            mood: sceneMood,
            colorScript,
            sceneContext,
            choicePositions,
            incomingChoiceContext: scene.incomingChoiceContext,
            locationInfo: locationInfo ? {
              locationId: locationInfo.locationId || sceneLocationId || scene.sceneId,
              locationName: (locationInfo as any).name || locationInfo.locationName || scene.sceneName,
              basePersonality: locationInfo.basePersonality || (locationInfo as any).personality || 'neutral',
              description: locationInfo.description || (locationInfo as any).fullDescription || (scene.settingContext as any)?.description || scene.sceneName,
              isThreshold: locationInfo.isThreshold,
            } : undefined,
            characterBodyVocabularies,
            characterDescriptions: sceneCharacterDescriptions,
            imagePlanningMode,
            storyboardPanelCap: this.deps.getStoryboardMaxPanelsPerSheet(),
            sceneMasterPrompt,
            sequenceIntent: (scene as any).sequenceIntent || (scene as any).sceneBlueprint?.sequenceIntent,
          };
          const chunks = chunkStoryboardBeats(enrichedBeats, this.deps.getStoryboardMaxPanelsPerSheet());
          for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
            await this.deps.checkCancellation();
            const chunkBeats = chunks[chunkIndex];
            const storyboardReferences: StoryboardReferenceSummary[] = [];
            for (const chunkBeat of chunkBeats) {
              const refs = this.deps.gatherCharacterReferenceImages(
                chunkBeat.characters || [],
                characterBible,
                sceneLocationId,
                {
                  includeExpressions: !!(chunkBeat.isClimaxBeat || chunkBeat.isKeyStoryBeat),
                  family: 'story-beat',
                  slotId: `story-beat:${scopedSceneId}::${chunkBeat.id}`,
                },
              );
              for (const ref of refs || []) {
                storyboardReferences.push({
                  role: ref.role || 'character-reference',
                  characterName: ref.characterName,
                  viewType: ref.viewType,
                  purpose: ref.characterName ? 'character' : 'other',
                  required: true,
                });
              }
            }
            for (const styleRef of this.deps._uploadedStyleReferenceImages || []) {
              storyboardReferences.push({
                role: styleRef.role || 'uploaded-style-reference',
                viewType: styleRef.viewType,
                purpose: 'style',
                required: false,
              });
            }
            const chunkStoryboardRequest = {
              ...storyboardRequest,
              beats: chunkBeats,
              chunkIndex,
              sceneMasterPrompt: {
                ...sceneMasterPrompt,
                referenceSummary: storyboardReferences,
              },
              storyboardReferences,
            };
            try {
              const packetResult: any = await withTimeout(
                (this.deps.imageAgentTeam as any).generateStoryboardPacket(chunkStoryboardRequest),
                PIPELINE_TIMEOUTS.storyboard,
                `ImageAgentTeam.generateStoryboardPacket(${scopedSceneId}:chunk-${chunkIndex + 1})`,
              );
              if (!packetResult.success || !packetResult.data) {
                throw new Error(packetResult.error || 'unknown storyboard packet failure');
              }
              const packet = packetResult.data as VisualStoryboardPacket;
              packet.validation = validateVisualStoryboardPacket(packet);
              if (!packet.validation.passed) {
                throw new Error(`Storyboard packet validation failed: ${packet.validation.issues.join('; ')}`);
              }
              storyboardPackets.push(packet);
              for (const shot of packet.shots || []) {
                storyboardPacketByBeatId.set(shot.beatId, shot);
                storyboardPacketModeByBeatId.set(shot.beatId, {
                  requestedMode: 'visual-storyboard',
                  effectiveMode: 'visual-storyboard',
                  chunkIndex: packet.chunkIndex,
                });
              }
              await this.deps.saveSceneVisualPlanningDiagnostic(outputDirectory, scopedSceneId, {
                requestedMode: 'visual-storyboard',
                effectiveMode: 'visual-storyboard',
                status: 'packet-success',
                chunkIndex,
                beatIds: packet.beatIds,
                sceneMasterPrompt: packet.sceneMasterPrompt,
                shots: packet.shots,
                validation: packet.validation,
              }, { suffix: `chunk-${chunkIndex + 1}` });
            } catch (planningErr) {
              const planningMsg = planningErr instanceof Error ? planningErr.message : String(planningErr);
              await this.deps.saveSceneVisualPlanningDiagnostic(outputDirectory, scopedSceneId, {
                requestedMode: 'visual-storyboard',
                effectiveMode: 'text',
                status: 'packet-fallback',
                fallback: 'text-plan',
                chunkIndex,
                beatIds: chunkBeats.map((beat: any) => beat.id),
                error: planningMsg,
              }, { suffix: `chunk-${chunkIndex + 1}.fallback` });
              for (const fallbackBeat of chunkBeats) {
                storyboardPacketModeByBeatId.set(fallbackBeat.id, {
                  requestedMode: 'visual-storyboard',
                  effectiveMode: 'text',
                  fallbackReason: planningMsg,
                  chunkIndex,
                });
              }
              context.emit({
                type: 'warning',
                phase: 'images',
                message: `Visual storyboard packet failed for ${scene.sceneName} chunk ${chunkIndex + 1}; text-plan fallback will render those beats: ${planningMsg}`,
              });
            }
          }
          if (storyboardPackets.length > 0) {
            const storyboardPlan = this.deps.buildBeatSceneStoryboardPlan({
              sceneId: scene.sceneId,
              scopedSceneId,
              sceneName: scene.sceneName,
              sceneDescription,
              beats: enrichedBeats,
            });
            llmVisualPlan = attachStoryboardPlanToVisualPlan({
              shots: storyboardPackets.flatMap((packet) => packet.shots.map((shot) => ({
                id: shot.beatId,
                beatId: shot.beatId,
                type: 'beat',
                shotType: shot.shotSize,
                cameraAngle: shot.cameraAngle,
                horizontalAngle: shot.cameraSide,
                description: shot.promptFields.action,
                composition: shot.promptFields.composition,
                storyBeat: {
                  action: shot.promptFields.action,
                  emotion: shot.promptFields.emotionalRead || '',
                },
                characters: shot.requiredVisibleCharacterIds,
              }))),
            } as any, storyboardPlan);
            this.deps.collectedVisualPlanning.visualPlans.push(llmVisualPlan as VisualPlan);
            await this.deps.saveSceneVisualPlanningDiagnostic(outputDirectory, scopedSceneId, {
              requestedMode: 'visual-storyboard',
              effectiveMode: 'visual-storyboard',
              status: 'packet-summary',
              packetCount: storyboardPackets.length,
              textFallbackBeatIds: enrichedBeats
                .filter((beat: any) => !storyboardPacketByBeatId.has(beat.id))
                .map((beat: any) => beat.id),
              storyboardSheets: (llmVisualPlan as any).storyboardSheets,
              storyboardPanels: (llmVisualPlan as any).storyboardPanels,
              storyboardCoverage: (llmVisualPlan as any).storyboardCoverage,
              sequenceGrammar: (llmVisualPlan as any).sequenceGrammar,
              continuityBible: (llmVisualPlan as any).continuityBible,
            });
          }
        }

        for (let beatIdx = 0; beatIdx < enrichedBeats.length; beatIdx++) {
          await this.deps.checkCancellation();
          const beat = enrichedBeats[beatIdx];
          const beatId = beat.id;
          const identifier = `beat-${scopedSceneId}-${beatId}`;
          const isEstablishingBeat = (beat as any).shotType === 'establishing';
          const beatForegroundCharacterNames = isEstablishingBeat ? [] : (beat.foregroundCharacters || []);
          const beatBackgroundCharacterNames = isEstablishingBeat ? [] : (beat.backgroundCharacters || []);
          const characterVisualStates = characterStateTracker.updateForBeat(
            beat,
            [...beatForegroundCharacterNames, ...beatBackgroundCharacterNames],
          );

          // Beat resume: if the AssetRegistry already has a successful result for this beat, reuse it
          const resumeSlotId = `story-beat:${scopedSceneId}::${beatId}`;
          const existingRecord = this.deps.assetRegistry.getResolvedAsset(resumeSlotId);
          if (existingRecord?.latestUrl) {
            console.log(`[Pipeline] Beat resume: reusing existing image for ${beatId} from registry`);
            const beatMapKey = this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
            beatImages.set(beatMapKey, existingRecord.latestUrl);
            if (beatIdx === 0) sceneImages.set(scopedSceneId, existingRecord.latestUrl);
            globalImageIndex++;
            continue;
          }

          // Disk-based beat resume: check if this beat was completed in a prior run
          if (beatResumeSet.has(identifier) && beatResumeImageMap[identifier]) {
            console.log(`[Pipeline] Beat resume: reusing existing image for ${beatId} from disk resume state`);
            const beatMapKey = this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
            beatImages.set(beatMapKey, beatResumeImageMap[identifier]);
            if (beatIdx === 0) sceneImages.set(scopedSceneId, beatResumeImageMap[identifier]);
            globalImageIndex++;
            continue;
          }

          // NOTE: deliberate deviation from the monolith. The original line
          // referenced an `imagesDir` that was never declared in this method's
          // scope (a latent ReferenceError that would fail the whole scene via
          // the scene-level catch the first time a non-resumed beat reached
          // it). Bind it the way every other call site does
          // (`<outputDirectory>/images/`); with no outputDirectory the lookup
          // degrades to the exact-match check inside findExistingImageArtifact.
          const imagesDir = outputDirectory
            ? `${outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`}images/`
            : '';
          const diskExisting = await this.deps.findExistingImageArtifact(imagesDir, identifier);
          if (diskExisting?.imageUrl) {
            console.log(`[Pipeline] Beat resume: reusing existing image for ${beatId} from disk artifact`);
            const beatMapKey = this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
            beatImages.set(beatMapKey, diskExisting.imageUrl);
            if (beatIdx === 0) sceneImages.set(scopedSceneId, diskExisting.imageUrl);

            try {
              if (!this.deps.assetRegistry.get(resumeSlotId)) {
                this.deps.assetRegistry.planSlot({
                  slotId: resumeSlotId,
                  family: 'story-beat',
                  imageType: 'beat',
                  sceneId: scene.sceneId,
                  scopedSceneId,
                  beatId,
                  storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].imageUrl`,
                  baseIdentifier: identifier,
                  required: false,
                  qualityTier: 'standard',
                  coverageKey: `beat:${scene.sceneId}:${beatId}`,
                });
              }
              this.deps.assetRegistry.markSuccess(resumeSlotId, diskExisting);
              if (beatIdx === 0) {
                const sceneSlotId = `story-scene:${scopedSceneId}`;
                if (!this.deps.assetRegistry.get(sceneSlotId)) {
                  this.deps.assetRegistry.planSlot({
                    slotId: sceneSlotId,
                    family: 'story-scene',
                    imageType: 'scene',
                    sceneId: scene.sceneId,
                    scopedSceneId,
                    beatId,
                    storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].backgroundImage`,
                    baseIdentifier: `scene-${scopedSceneId}-bg`,
                    required: false,
                    qualityTier: 'standard',
                    coverageKey: `scene:${scene.sceneId}`,
                  });
                }
                this.deps.assetRegistry.markSuccess(sceneSlotId, diskExisting);
              }
            } catch { /* non-fatal: registry is supplementary to beatImages map */ }

            if (diskExisting.imageData && diskExisting.mimeType) {
              lastGeneratedImage = { data: diskExisting.imageData, mimeType: diskExisting.mimeType };
            }

            beatResumeSet.add(identifier);
            beatResumeImageMap[identifier] = diskExisting.imageUrl;
            persistBeatResume().catch(() => {});

            globalImageIndex++;
            context.emit({
              type: 'checkpoint',
              phase: 'images',
              message: `Image ${globalImageIndex} of ~${estimatedTotalImages} complete (resumed from disk)`,
              data: { imageIndex: globalImageIndex, totalImages: estimatedTotalImages, identifier, sceneId: scene.sceneId, resumedFromDisk: true },
            });
            continue;
          }

          // A3-narrow: reuse prefetched scene-opening beat if available. The
          // prefetch phase ran before the main loop and produced a resolved
          // GeneratedImage for this identifier; mirror the post-generation
          // bookkeeping here (beatImages / sceneImages / assetRegistry /
          // resume / style-ref / lastGeneratedImage) so downstream code sees
          // exactly the same state as if the inline generateImage succeeded.
          if (beatIdx === 0) {
            const prefetchLookupKey = identifier.replace(/[^a-zA-Z0-9_\-./]/g, '').replace(/-+/g, '-');
            const prefetched = this.deps._openingBeatPrefetch.get(prefetchLookupKey);
            if (prefetched && prefetched.imageUrl) {
              this.deps._openingBeatPrefetch.delete(prefetchLookupKey);
              console.log(`[Pipeline] A3-narrow: reusing prefetched opening-beat image for ${identifier}`);
              const beatMapKey = this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
              beatImages.set(beatMapKey, prefetched.imageUrl);
              sceneImages.set(scopedSceneId, prefetched.imageUrl);

              try {
                const slotId = resumeSlotId;
                if (!this.deps.assetRegistry.get(slotId)) {
                  this.deps.assetRegistry.planSlot({
                    slotId,
                    family: 'story-beat',
                    imageType: 'beat',
                    sceneId: scene.sceneId,
                    scopedSceneId,
                    beatId,
                    storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].imageUrl`,
                    baseIdentifier: identifier,
                    required: false,
                    qualityTier: 'standard',
                    coverageKey: `beat:${scene.sceneId}:${beatId}`,
                  });
                }
                this.deps.assetRegistry.markSuccess(slotId, prefetched);
                // Mirror the main loop's scene-slot bookkeeping (line 7624-7642).
                const sceneSlotId = `story-scene:${scopedSceneId}`;
                if (!this.deps.assetRegistry.get(sceneSlotId)) {
                  this.deps.assetRegistry.planSlot({
                    slotId: sceneSlotId,
                    family: 'story-scene',
                    imageType: 'scene',
                    sceneId: scene.sceneId,
                    scopedSceneId,
                    beatId,
                    storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].backgroundImage`,
                    baseIdentifier: `scene-${scopedSceneId}-bg`,
                    required: false,
                    qualityTier: 'standard',
                    coverageKey: `scene:${scene.sceneId}`,
                  });
                }
                this.deps.assetRegistry.markSuccess(sceneSlotId, prefetched);
              } catch { /* non-fatal: registry is supplementary to beatImages map */ }

              if (prefetched.imageData && prefetched.mimeType) {
                lastGeneratedImage = { data: prefetched.imageData, mimeType: prefetched.mimeType };
              }

              if (this.deps._generatedStyleReferencesAllowed && !styleReferenceStored && prefetched.imageData && prefetched.mimeType) {
                this.deps.imageService.setSeasonStyleReference(prefetched.imageData, prefetched.mimeType);
                styleReferenceStored = true;
                context.emit({ type: 'debug', phase: 'images', message: `Stored style reference from prefetched opener of scene ${scene.sceneId}` });
              }

              beatResumeSet.add(identifier);
              beatResumeImageMap[identifier] = prefetched.imageUrl;
              persistBeatResume().catch(() => {});

              globalImageIndex++;
              context.emit({
                type: 'checkpoint',
                phase: 'images',
                message: `Image ${globalImageIndex} of ~${estimatedTotalImages} complete (prefetched)`,
                data: { imageIndex: globalImageIndex, totalImages: estimatedTotalImages, identifier, sceneId: scene.sceneId, prefetched: true },
              });
              continue;
            }
          }

          let shotCharacterIds: string[];
          if (isEstablishingBeat) {
            shotCharacterIds = [];
          } else {
            shotCharacterIds = beat.characters && beat.characters.length > 0
              ? beat.characters
              : [];
          }
          shotCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
            shotCharacterIds,
            characterBible,
            brief,
            `beat:${scopedSceneId}:${beatId}`
          );
          const shotCharacterNames = shotCharacterIds
            .map(id => characterBible.characters.find(c => c.id === id)?.name)
            .filter(Boolean) as string[];
          context.emit({
            type: 'debug',
            phase: 'images',
            message: `Shot cast for ${scene.sceneId}:${beatId}: ${shotCharacterNames.join(', ') || 'no visible characters'} (${beat.shotCastReason || 'resolved'})`,
          });

          // B6: Look up per-beat color guidance from the episode color script.
          const beatColorEntry = (colorScript as any)?.beats?.find(
            (b: any) => b.beatId === beatId
          );
          let beatColorOverride: import('../../images/beatPromptBuilder').BeatPromptInput['colorMoodOverride'] | undefined;
          if (beatColorEntry) {
            const hues: string[] = Array.isArray(beatColorEntry.dominantHues) ? beatColorEntry.dominantHues : [];
            const palette = hues.length > 0 ? hues.join(' and ') : undefined;
            const temperature = typeof beatColorEntry.lightTemp === 'string' ? beatColorEntry.lightTemp : undefined;
            // Compare to the previous beat's hues to produce a transition note.
            let transitionNote: string | undefined;
            if (beatIdx > 0) {
              const prevEntry = (colorScript as any).beats?.[beatIdx - 1];
              const prevHues: string[] = Array.isArray(prevEntry?.dominantHues) ? prevEntry.dominantHues : [];
              if (prevHues.length > 0 && palette) {
                transitionNote = `transitioning from ${prevHues.join('/')} to ${hues.join('/')}`;
              }
            }
            beatColorOverride = {
              palette,
              lighting: typeof beatColorEntry.lightDirection === 'string'
                ? `${beatColorEntry.lightDirection} light`
                : undefined,
              temperature,
              transitionNote,
            };
          }

          const beatPromptInput: import('../../images/beatPromptBuilder').BeatPromptInput = {
            beatId,
            beatText: beat.text,
            beatIndex: beatIdx,
            totalBeats: enrichedBeats.length,
            visualMoment: this.deps.sanitizePromptText((beat as any).visualMoment || '', brief, ''),
            primaryAction: isEstablishingBeat ? '' : this.deps.sanitizePromptText((beat as any).primaryAction || '', brief, ''),
            emotionalRead: isEstablishingBeat ? '' : this.deps.sanitizePromptText((beat as any).emotionalRead || '', brief, ''),
            relationshipDynamic: isEstablishingBeat ? '' : this.deps.sanitizePromptText((beat as any).relationshipDynamic || '', brief, ''),
            mustShowDetail: this.deps.sanitizePromptText((beat as any).mustShowDetail || '', brief, ''),
            visibleTurn: this.deps.sanitizePromptText((beat as any).dramaticIntent?.visibleTurn || '', brief, ''),
            visualSubtextCue: this.deps.sanitizePromptText((beat as any).dramaticIntent?.visualSubtextCue || '', brief, ''),
            statusShift: this.deps.sanitizePromptText([
              (beat as any).dramaticIntent?.statusBefore,
              (beat as any).dramaticIntent?.statusAfter,
            ].filter(Boolean).join(' -> '), brief, ''),
            shotType: (beat as any).shotType || 'character',
            isClimaxBeat: beat.isClimaxBeat,
            isKeyStoryBeat: beat.isKeyStoryBeat,
            isChoicePayoff: (beat as any).isChoicePayoff,
            choiceContext: this.deps.sanitizePromptText((beat as any).choiceContext || '', brief, ''),
            incomingChoiceContext: this.deps.sanitizePromptText(scene.incomingChoiceContext || '', brief, ''),
            isBranchPayoff: beatIdx === 0 && !!scene.incomingChoiceContext,
            foregroundCharacterNames: beatForegroundCharacterNames,
            backgroundCharacterNames: beatBackgroundCharacterNames,
            visualCast: (beat as any).visualCast,
            coveragePlan: (beat as any).coveragePlan,
            stagingPattern: (beat as any).coveragePlan?.stagingPattern,
            relationshipBlocking: (beat as any).coveragePlan?.relationshipBlocking,
            coverageReason: (beat as any).coveragePlan?.coverageReason,
            characterVisualStates,
            colorMoodOverride: beatColorOverride,
          };

          let deterministicPrompt = this.deps.sanitizeImagePrompt(buildBeatImagePrompt(beatPromptInput, scenePromptCtx), brief);
          const beatPlan = shotPlanMap.get(beatId);
          if (beatPlan) {
            deterministicPrompt = overrideShotFromPlan(deterministicPrompt, beatPlan.assignedShotType, beatPlan.assignedAngle);
          }
          const storyboardShotPacket = storyboardPacketByBeatId.get(beatId);
          const storyboardModeInfo = storyboardPacketModeByBeatId.get(beatId) || (
            imagePlanningMode === 'visual-storyboard'
              ? { requestedMode: 'visual-storyboard' as const, effectiveMode: 'text' as ImagePlanningMode, fallbackReason: 'visual-storyboard-packet-unavailable' }
              : undefined
          );

          const rawLlmPrompt = llmPromptMap.get(beatId);
          const wrappedLlmPrompt = rawLlmPrompt
            ? this.deps.wrapLlmImagePromptWithContracts(rawLlmPrompt, beatPromptInput, scenePromptCtx, shotCharacterNames, promptMode, brief)
            : undefined;
          let imagePrompt = deterministicPrompt;
          let promptSource: 'deterministic' | 'llm' | 'deterministic-fallback' = 'deterministic';

          if (promptMode === 'llm') {
            if (wrappedLlmPrompt) {
              const disallowedNames = this.deps.promptMentionsDisallowedCharacters(wrappedLlmPrompt, shotCharacterNames, allSceneCharacterNames);
              const requiredNames = (beat as any).coveragePlan?.requiredVisibleCharacterIds
                ?.map((id: string) => characterBible.characters.find(c => c.id === id)?.name || id)
                || shotCharacterNames;
              const missingRequiredNames = this.deps.promptMissingRequiredCharacters(wrappedLlmPrompt, requiredNames);
              if (disallowedNames.length > 0 || missingRequiredNames.length > 0) {
                promptSource = 'deterministic-fallback';
                context.emit({
                  type: 'warning',
                  phase: 'images',
                  message: `LLM prompt contract rejected for ${scene.sceneId}:${beatId}: ${[
                    disallowedNames.length ? `disallowed visible character(s) ${disallowedNames.join(', ')}` : '',
                    missingRequiredNames.length ? `missing required character(s) ${missingRequiredNames.join(', ')}` : '',
                  ].filter(Boolean).join('; ')}. Deterministic fallback used for this beat.`,
                  data: { sceneId: scene.sceneId, beatId, disallowedNames, missingRequiredNames, allowedCharacterNames: shotCharacterNames, requiredNames },
                });
              } else {
                imagePrompt = wrappedLlmPrompt;
                promptSource = 'llm';
              }
            } else {
              promptSource = 'deterministic-fallback';
              context.emit({
                type: 'warning',
                phase: 'images',
                message: `LLM prompt missing for ${scene.sceneId}:${beatId}; deterministic fallback used for this beat only.`,
              });
            }
          }

          const isEnvironmentStyleShot = shotCharacterIds.length === 0
            || isEstablishingBeat
            || (beat as any).coveragePlan?.stagingPattern === 'environment'
            || (beat as any).coveragePlan?.stagingPattern === 'environmental-aftermath';
          imagePrompt = {
            ...this.deps.applyThirdPersonRenderContract(imagePrompt, storyboardShotPacket, { isEnvironmentShot: isEnvironmentStyleShot }),
            promptContract: {
              ...(imagePrompt.promptContract || {}),
              effectivePromptMode: promptMode,
              effectivePromptSource: promptSource,
              effectiveQaMode: qaMode,
              imagePlanningMode,
              requestedPlanningMode: storyboardModeInfo?.requestedMode || imagePlanningMode,
              effectivePlanningMode: storyboardModeInfo?.effectiveMode || imagePlanningMode,
              visualStoryboardFallbackReason: storyboardModeInfo?.fallbackReason,
              styleSource: this.deps._uploadedStyleReferenceImages.length > 0
                ? 'user-visual'
                : (this.deps._generatedStyleReferencesAllowed && styleReferenceStored ? 'approved-generated-anchor' : 'raw-season-style'),
              visibleCharacterRefsRequired: shotCharacterNames,
              visualCast: (beat as any).visualCast,
              coveragePlan: (beat as any).coveragePlan,
              visualStoryboardPacket: storyboardShotPacket,
              isEnvironmentStyleShot,
              visualPlanningStatus: storyboardShotPacket
                ? 'visual-storyboard-packet'
                : (storyboardModeInfo?.effectiveMode === 'text' ? 'text-plan-fallback' : (rawLlmPrompt ? 'llm-prompt-available' : 'deterministic-fallback')),
            } as any,
          };

          context.emit({ type: 'agent_start', agent: 'ImageService', message: `Generating image for beat ${beatId} in ${scene.sceneName}...` });

          const includeExpressionRefs = !!(
            beat.isClimaxBeat ||
            beat.isKeyStoryBeat
          );
          const referenceImages = this.deps.gatherCharacterReferenceImages(
            shotCharacterIds,
            characterBible,
            sceneLocationId,
            {
              includeExpressions: includeExpressionRefs,
              family: 'story-beat',
              slotId: `story-beat:${scopedSceneId}::${beatId}`,
            }
          );
          const shotCharacterDescriptionsForSlot = this.deps.buildCharacterDescriptions(shotCharacterIds, characterBible);
          const slotMetadata = {
            sceneId: scopedSceneId,
            beatId,
            type: 'beat',
            characters: shotCharacterIds,
            characterNames: shotCharacterNames,
            characterDescriptions: shotCharacterDescriptionsForSlot,
            visualCast: (beat as any).visualCast,
            coveragePlan: (beat as any).coveragePlan,
            storyboardReferencePack: storyboardShotPacket?.referencePack,
            requestedPlanningMode: storyboardModeInfo?.requestedMode || imagePlanningMode,
            effectivePlanningMode: storyboardModeInfo?.effectiveMode || imagePlanningMode,
            visualStoryboardFallbackReason: storyboardModeInfo?.fallbackReason,
            isEnvironmentStyleShot,
            promptMode,
            qaMode,
          };
          const slotReferencePack = this.deps.createSlotReferencePack(
            `story-beat:${scopedSceneId}::${beatId}`,
            referenceImages,
          );
          const primarySlotId = `story-beat:${scopedSceneId}::${beatId}`;
          try {
            if (!this.deps.assetRegistry.get(primarySlotId)) {
              this.deps.assetRegistry.planSlot({
                slotId: primarySlotId,
                family: 'story-beat',
                imageType: 'beat',
                sceneId: scene.sceneId,
                scopedSceneId,
                beatId,
                storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].image`,
                baseIdentifier: identifier,
                required: false,
                qualityTier: 'standard',
                coverageKey: `beat:${scene.sceneId}::${beatId}`,
                metadata: {
                  requestedPlanningMode: storyboardModeInfo?.requestedMode || imagePlanningMode,
                  effectivePlanningMode: storyboardModeInfo?.effectiveMode || imagePlanningMode,
                  promptSource,
                  fallbackReason: storyboardModeInfo?.fallbackReason,
                  visibleCharacterNames: shotCharacterNames,
                  offscreenCharacterIds: storyboardShotPacket?.offscreenCharacterIds,
                  isEnvironmentStyleShot,
                  primaryRenderStatus: 'attempted',
                },
              });
            }
            this.deps.assetRegistry.markRendering(primarySlotId, {
              attemptNumber: 1,
              startedAt: new Date().toISOString(),
              retryStage: 'primary',
              effectivePromptChars: imagePrompt.prompt?.length || 0,
              effectiveNegativeChars: imagePrompt.negativePrompt?.length || 0,
              effectiveRefCount: referenceImages.length,
              referenceRoles: referenceImages.map((ref: any) => ref.role || 'reference'),
            });
          } catch { /* non-fatal */ }

          try {
            // --- PANEL PATH: generate multiple sub-images for this beat ---
            if (beatPlan?.isPanelBeat && beatPlan.panelShotSequence && beatPlan.panelCount) {
              const panelUrls: string[] = [];
              let previousPanelImage: { data: string; mimeType: string } | null = null;
              let firstPanelResult: GeneratedImage | null = null;
              context.emit({ type: 'debug', phase: 'images', message: `Panel beat ${beatId}: generating ${beatPlan.panelCount} panels` });

              for (let pIdx = 0; pIdx < beatPlan.panelCount; pIdx++) {
                const panelShotType = beatPlan.panelShotSequence[pIdx] || beatPlan.assignedShotType;
                const panelPrompt = overrideShotFromPlan(
                  { ...imagePrompt },
                  panelShotType,
                  beatPlan.assignedAngle,
                  pIdx,
                  beatPlan.panelCount,
                );
                const panelIdentifier = `${identifier}-panel-${pIdx}`;
                const panelLabel = `imageService(${scopedSceneId}:${beatId}:panel-${pIdx})`;
                const shotCharacterDescriptions = this.deps.buildCharacterDescriptions(shotCharacterIds, characterBible);

                // Build panel-specific references: base refs + previous panel for style continuity
                const panelRefs = referenceImages.length > 0 ? [...referenceImages] : [];
                if (previousPanelImage) {
                  panelRefs.push({
                    data: previousPanelImage.data,
                    mimeType: previousPanelImage.mimeType,
                    role: 'previous-panel-continuity',
                    characterName: '',
                    viewType: 'panel',
                  });
                }

                let panelResult: GeneratedImage;
                if (chatModeEnabled && this.deps.imageService.hasChatSession(scopedSceneId)) {
                  panelResult = await this.deps.generateImageWithDefectRetries(
                    panelPrompt,
                    panelIdentifier,
                    {
                      sceneId: scopedSceneId,
                      beatId,
                      type: 'beat',
                      characters: shotCharacterIds,
                      characterNames: shotCharacterNames,
                      characterDescriptions: shotCharacterDescriptions,
                      renderRoute: 'chat',
                    },
                    panelRefs.length > 0 ? panelRefs : undefined,
                    panelLabel,
                    outputDirectory,
                    (activePrompt, attemptIdentifier, _attemptMetadata, attemptRefs) => this.deps.imageService.generateImageInChat(
                      activePrompt,
                      attemptIdentifier,
                      attemptRefs,
                      { characterNames: shotCharacterNames, characterDescriptions: shotCharacterDescriptions }
                    ),
                  );
                } else {
                  panelResult = await this.deps.generateImageWithDefectRetries(
                    panelPrompt,
                    panelIdentifier,
                    {
                      sceneId: scopedSceneId,
                      beatId,
                      type: 'beat',
                      characters: shotCharacterIds,
                      characterNames: shotCharacterNames,
                      characterDescriptions: shotCharacterDescriptions,
                    },
                    panelRefs.length > 0 ? panelRefs : undefined,
                    panelLabel,
                    outputDirectory,
                  );
                }

                if (panelResult.imageUrl) {
                  if (!firstPanelResult) firstPanelResult = panelResult;
                  panelUrls.push(panelResult.imageUrl);
                  const panelSlotId = `story-beat-panel:${scene.sceneId}::${beatId}::panel-${pIdx}`;
                  try {
                    if (!this.deps.assetRegistry.get(panelSlotId)) {
                      this.deps.assetRegistry.planSlot({
                        slotId: panelSlotId,
                        family: 'story-beat-panel',
                        imageType: 'beat',
                        sceneId: scene.sceneId,
                        scopedSceneId,
                        beatId,
                        storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].panelImages[${pIdx}]`,
                        baseIdentifier: panelIdentifier,
                        required: false,
                        qualityTier: 'standard',
                        coverageKey: `beat-panel:${scene.sceneId}::${beatId}::${pIdx}`,
                        metadata: { panelIndex: pIdx },
                      });
                    }
                    this.deps.assetRegistry.markSuccess(panelSlotId, panelResult, {
                      prompt: panelPrompt,
                      referencePack: this.deps.createSlotReferencePack(panelSlotId, panelRefs),
                    });
                  } catch { /* non-fatal */ }

                  if (panelResult.imageData && panelResult.mimeType) {
                    lastGeneratedImage = { data: panelResult.imageData, mimeType: panelResult.mimeType };
                    previousPanelImage = { data: panelResult.imageData, mimeType: panelResult.mimeType };
                  }
                }

                await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
              }

              if (panelUrls.length > 0) {
                const beatMapKey = this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
                beatImages.set(beatMapKey, panelUrls[0]);
                if (beatIdx === 0) sceneImages.set(scopedSceneId, panelUrls[0]);

                const heroSlotId = `story-beat:${scopedSceneId}::${beatId}`;
                try {
                  if (!this.deps.assetRegistry.get(heroSlotId)) {
                    this.deps.assetRegistry.planSlot({
                      slotId: heroSlotId,
                      family: 'story-beat',
                      imageType: 'beat',
                      sceneId: scene.sceneId,
                      scopedSceneId,
                      beatId,
                      storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].image`,
                        baseIdentifier: identifier,
                        required: false,
                        qualityTier: 'standard',
                        coverageKey: `beat:${scene.sceneId}::${beatId}`,
                        metadata: {
                          requestedPlanningMode: storyboardModeInfo?.requestedMode || imagePlanningMode,
                          effectivePlanningMode: storyboardModeInfo?.effectiveMode || imagePlanningMode,
                          promptSource,
                          fallbackReason: storyboardModeInfo?.fallbackReason,
                          visibleCharacterNames: shotCharacterNames,
                          offscreenCharacterIds: storyboardShotPacket?.offscreenCharacterIds,
                        },
                      });
                  }
                  this.deps.assetRegistry.markSuccess(heroSlotId, { imageUrl: panelUrls[0] } as GeneratedImage, {
                    prompt: imagePrompt,
                    referencePack: slotReferencePack,
                  });
                } catch { /* non-fatal */ }

                beatResumeSet.add(identifier);
                beatResumeImageMap[identifier] = panelUrls[0];
                persistBeatResume().catch(() => {});
                if (firstPanelResult && this.deps.shouldRunHeroVisualQA(beat, beatIdx, enrichedBeats.length, qaMode)) {
                  generatedImagesForVisualQA.set(beatId, firstPanelResult);
                  heroVisualQAIdentifiers.set(beatId, identifier);
                }
                if (firstPanelResult) {
                  generatedImagesForSceneQA.set(beatId, firstPanelResult);
                }
              }

              if (this.deps._generatedStyleReferencesAllowed && !styleReferenceStored && lastGeneratedImage) {
                this.deps.imageService.setSeasonStyleReference(lastGeneratedImage.data, lastGeneratedImage.mimeType);
                styleReferenceStored = true;
              }
            } else {
            // --- SINGLE IMAGE PATH (existing behavior with shot plan override applied above) ---
            let result: GeneratedImage;
            const imgLabel = `imageService(${scopedSceneId}:${beatId})`;
            if (chatModeEnabled && this.deps.imageService.hasChatSession(scopedSceneId)) {
              result = await this.deps.generateImageWithDefectRetries(
                imagePrompt,
                identifier,
                {
                  ...slotMetadata,
                  characterDescriptions: shotCharacterDescriptionsForSlot,
                  renderRoute: 'chat',
                },
                referenceImages.length > 0 ? referenceImages : undefined,
                imgLabel,
                outputDirectory,
                (activePrompt, attemptIdentifier, _attemptMetadata, attemptRefs) => this.deps.imageService.generateImageInChat(
                  activePrompt,
                  attemptIdentifier,
                  attemptRefs,
                  { characterNames: shotCharacterNames, characterDescriptions: shotCharacterDescriptionsForSlot }
                ),
              );
            } else {
              result = await this.deps.generateImageWithDefectRetries(
                imagePrompt,
                identifier,
                slotMetadata,
                referenceImages.length > 0 ? referenceImages : undefined,
                imgLabel,
                outputDirectory,
              );
            }

            if (result.imageUrl) {
              const beatMapKey = this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, beatId);
              beatImages.set(beatMapKey, result.imageUrl);
              renderedBeatSlots.set(beatId, {
                identifier,
                imagePrompt,
                referenceImages,
                metadata: slotMetadata,
                beatIndex: beatIdx,
                beat,
                beatMapKey,
                shotCharacterNames,
                shotCharacterDescriptions: shotCharacterDescriptionsForSlot,
                beatPromptInput,
              });
              if (this.deps.shouldRunHeroVisualQA(beat, beatIdx, enrichedBeats.length, qaMode)) {
                generatedImagesForVisualQA.set(beatId, result);
                heroVisualQAIdentifiers.set(beatId, identifier);
              }
              generatedImagesForSceneQA.set(beatId, result);

              // Register with AssetRegistry for durable tracking
              const slotId = primarySlotId;
              try {
                if (!this.deps.assetRegistry.get(slotId)) {
                  this.deps.assetRegistry.planSlot({
                    slotId,
                    family: 'story-beat',
                    imageType: 'beat',
                    sceneId: scene.sceneId,
                    scopedSceneId,
                    beatId,
                    storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beatId}].image`,
                    baseIdentifier: identifier,
                    required: false,
                    qualityTier: 'standard',
                    coverageKey: `beat:${scene.sceneId}::${beatId}`,
                    metadata: {
                      requestedPlanningMode: storyboardModeInfo?.requestedMode || imagePlanningMode,
                      effectivePlanningMode: storyboardModeInfo?.effectiveMode || imagePlanningMode,
                      promptSource,
                      fallbackReason: storyboardModeInfo?.fallbackReason,
                      visibleCharacterNames: shotCharacterNames,
                      offscreenCharacterIds: storyboardShotPacket?.offscreenCharacterIds,
                    },
                  });
                }
                this.deps.assetRegistry.markSuccess(slotId, result, {
                  prompt: imagePrompt,
                  referencePack: slotReferencePack,
                });
              } catch { /* non-fatal: registry is supplementary to beatImages map */ }

              if (beatIdx === 0) {
                sceneImages.set(scopedSceneId, result.imageUrl);
                const sceneSlotId = `story-scene:${scopedSceneId}`;
                try {
                  if (!this.deps.assetRegistry.get(sceneSlotId)) {
                    this.deps.assetRegistry.planSlot({
                      slotId: sceneSlotId,
                      family: 'story-scene',
                      imageType: 'scene',
                      sceneId: scene.sceneId,
                      scopedSceneId,
                      beatId,
                      storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].backgroundImage`,
                      baseIdentifier: `scene-${scopedSceneId}-bg`,
                      required: false,
                      qualityTier: 'standard',
                      coverageKey: `scene:${scene.sceneId}`,
                    });
                  }
                  this.deps.assetRegistry.markSuccess(sceneSlotId, result, {
                    prompt: imagePrompt,
                    referencePack: this.deps.createSlotReferencePack(sceneSlotId, referenceImages),
                  });
                } catch { /* non-fatal */ }
              }

              if (result.imageData && result.mimeType) {
                lastGeneratedImage = { data: result.imageData, mimeType: result.mimeType };
              }

              if (this.deps._generatedStyleReferencesAllowed && !styleReferenceStored && result.imageData && result.mimeType) {
                this.deps.imageService.setSeasonStyleReference(result.imageData, result.mimeType);
                styleReferenceStored = true;
                context.emit({ type: 'debug', phase: 'images', message: `Stored style reference from scene ${scene.sceneId}` });
              }

              beatResumeSet.add(identifier);
              beatResumeImageMap[identifier] = result.imageUrl;
              persistBeatResume().catch(() => {});

              await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
            }
            } // end single-image / panel branch

            globalImageIndex++;
            context.emit({
              type: 'checkpoint',
              phase: 'images',
              message: `Image ${globalImageIndex} of ~${estimatedTotalImages} complete`,
              data: { imageIndex: globalImageIndex, totalImages: estimatedTotalImages, identifier, sceneId: scene.sceneId },
            });
          } catch (shotErr) {
            const shotErrMsg = shotErr instanceof Error ? shotErr.message : String(shotErr);
            console.warn(`[Pipeline] Beat image generation failed for ${scopedSceneId}:${beatId}: ${shotErrMsg}`);
            context.emit({ type: 'warning', phase: 'images', message: `Beat image failed for ${scopedSceneId}:${beatId}: ${shotErrMsg}` });
            try {
              this.deps.assetRegistry.markFailure(primarySlotId, 'failed_transient', shotErrMsg);
            } catch { /* non-fatal */ }
            if (this.deps.isLlmQuotaFailure(shotErr)) {
              console.error(`[Pipeline] LLM quota exhausted during shot generation — re-throwing to halt pipeline`);
              throw shotErr;
            }
            await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs * 2));
          }
        }

        const regenerateRenderedBeat = async (
          regenBeatId: string,
          reason: 'diversity' | 'visual-qa' | 'identity',
          attempt: number,
          guidance: string,
          useReillustration: boolean,
        ): Promise<GeneratedImage | null> => {
          const slot = renderedBeatSlots.get(regenBeatId);
          if (!slot) return null;
          const shot = llmVisualPlan?.shots?.find((s: any) => s.beatId === regenBeatId || s.id === regenBeatId);
          let regenPrompt: ImagePrompt = slot.imagePrompt;
          if (useReillustration && shot) {
            try {
              const correspondingBeat = storyboardRequest?.beats?.find((b: any) => b.id === (shot.beatId || regenBeatId));
              const regenCharacters = (this.deps.imageAgentTeam as any).resolveCharactersForShot?.(
                shot.characters,
                correspondingBeat?.characters,
                storyboardRequest?.characterDescriptions,
                correspondingBeat?.foregroundCharacters,
                correspondingBeat?.backgroundCharacters,
              );
              const reIllustrationReq = {
                shotDescription: `${shot.description || slot.beat?.text || ''}. ${reason.toUpperCase()} REGENERATION GUIDANCE: ${guidance}`,
                type: shot.type,
                shotType: shot.shotType,
                sceneContext: {
                  name: scene.sceneName,
                  description: storyboardRequest?.sceneDescription || scene.sceneName,
                  genre: brief.story.genre,
                  tone: brief.story.tone,
                  mood: shot.mood || sceneMood,
                  settingContext: scene.settingContext,
                },
                characters: regenCharacters,
                cameraAngle: shot.cameraAngle,
                horizontalAngle: shot.horizontalAngle,
                wallyWoodPanel: shot.wallyWoodPanel,
                artStyle: context.config.artStyle,
                storyBeat: shot.storyBeat,
                authoredVisualContract: (shot as any).authoredVisualContract,
                poseDescription: guidance,
                focalPoint: shot.focalPoint,
                depthLayers: shot.depthLayers,
                continuityFromPrevious: shot.continuityFromPrevious,
                previousShotReference: (shot as any).previousShotReference,
                visualStorytelling: shot.visualStorytelling,
                moodSpec: shot.moodSpec,
                lightingColorPrompt: shot.lightingColorPrompt,
              };
              const newPromptResult = await (this.deps.imageAgentTeam as any).illustratorAgent?.execute(reIllustrationReq);
              if (newPromptResult?.success && newPromptResult.data) {
                const wrapped = this.deps.wrapLlmImagePromptWithContracts(
                  newPromptResult.data,
                  slot.beatPromptInput,
                  scenePromptCtx,
                  slot.shotCharacterNames,
                  `${promptMode}-${reason}-regen`,
                  brief,
                );
                const disallowedNames = this.deps.promptMentionsDisallowedCharacters(wrapped, slot.shotCharacterNames, allSceneCharacterNames);
                const requiredNames = slot.beatPromptInput.coveragePlan?.requiredVisibleCharacterIds
                  ?.map((id: string) => characterBible.characters.find(c => c.id === id)?.name || id)
                  || slot.shotCharacterNames;
                const missingRequiredNames = this.deps.promptMissingRequiredCharacters(wrapped, requiredNames);
                if (disallowedNames.length === 0 && missingRequiredNames.length === 0) {
                  regenPrompt = wrapped;
                } else {
                  context.emit({
                    type: 'warning',
                    phase: 'images',
                    message: `Regenerated LLM prompt rejected for ${scene.sceneId}:${regenBeatId}: ${[
                      disallowedNames.length ? `disallowed visible character(s) ${disallowedNames.join(', ')}` : '',
                      missingRequiredNames.length ? `missing required character(s) ${missingRequiredNames.join(', ')}` : '',
                    ].filter(Boolean).join('; ')}. Using contract-preserving correction prompt.`,
                  });
                }
              }
            } catch (regenPromptErr) {
              context.emit({
                type: 'warning',
                phase: 'images',
                message: `Guided re-illustration failed for ${scene.sceneId}:${regenBeatId}; using contract-preserving correction prompt: ${regenPromptErr instanceof Error ? regenPromptErr.message : String(regenPromptErr)}`,
              });
            }
          }
          if (regenPrompt === slot.imagePrompt) {
            regenPrompt = {
              ...slot.imagePrompt,
              prompt: [
                slot.imagePrompt.prompt,
                `${reason.toUpperCase()} CORRECTION: ${guidance}. Preserve story action, approved character identities, attached references, and the authoritative style contract.`,
              ].filter(Boolean).join('\n'),
              negativePrompt: [
                slot.imagePrompt.negativePrompt,
                'wrong lighting mood, inconsistent rendering finish, pose repetition, weak visual storytelling, identity drift',
              ].filter(Boolean).join(', '),
            };
          }
          regenPrompt = {
            ...regenPrompt,
            promptContract: {
              ...(regenPrompt.promptContract || {}),
              regenerationReason: reason,
              regenerationAttempt: attempt,
              regenerationGuidance: guidance,
            } as any,
          };
          const regenIdentifier = `${slot.identifier}-${reason}-retry-${attempt}`;
          const regenResult = await this.deps.generateImageWithDefectRetries(
            regenPrompt,
            regenIdentifier,
            {
              ...slot.metadata,
              regeneration: attempt,
              regenerationReason: reason,
            },
            slot.referenceImages.length > 0 ? slot.referenceImages : undefined,
            `${reason}Regen(${scopedSceneId}:${regenBeatId})`,
            outputDirectory,
            chatModeEnabled && this.deps.imageService.hasChatSession(scopedSceneId)
              ? (activePrompt, attemptIdentifier, _attemptMetadata, attemptRefs) => this.deps.imageService.generateImageInChat(
                  activePrompt,
                  attemptIdentifier,
                  attemptRefs,
                  { characterNames: slot.shotCharacterNames, characterDescriptions: slot.shotCharacterDescriptions }
                )
              : undefined,
          );
          if (regenResult.imageUrl) {
            generatedImagesForSceneQA.set(regenBeatId, regenResult);
            if (heroVisualQAIdentifiers.has(regenBeatId)) generatedImagesForVisualQA.set(regenBeatId, regenResult);
            beatImages.set(slot.beatMapKey, regenResult.imageUrl);
            if (slot.beatIndex === 0) sceneImages.set(scopedSceneId, regenResult.imageUrl);
            beatResumeSet.add(slot.identifier);
            beatResumeImageMap[slot.identifier] = regenResult.imageUrl;
            persistBeatResume().catch(() => {});
            renderedBeatSlots.set(regenBeatId, { ...slot, imagePrompt: regenPrompt });
            try {
              this.deps.assetRegistry.markSuccess(`story-beat:${scopedSceneId}::${regenBeatId}`, regenResult, { prompt: regenPrompt });
            } catch { /* non-fatal */ }
          }
          return regenResult;
        };

        if (qaMode === 'full' && llmVisualPlan && generatedImagesForSceneQA.size > 0) {
          try {
            let diversityResult = await this.deps.imageAgentTeam.validatePoseDiversity(llmVisualPlan, generatedImagesForSceneQA, true);
            let diversityReport = diversityResult.success ? diversityResult.data : undefined;
            const maxDiversityRegens = Math.max(1, Math.min(2, this.deps.imageService.getMaxRetries?.() || 1));
            let diversityAttempt = 0;
            while (diversityReport && !diversityReport.isAcceptable && diversityAttempt < maxDiversityRegens) {
              const errorShotIds = new Set<string>();
              for (const issue of diversityReport.issues || []) {
                if (issue.severity === 'error') {
                  for (const shotId of issue.shotIds || []) errorShotIds.add(shotId);
                }
              }
              const diversityBeatIds = (diversityReport.shotsToRegenerate || [])
                .filter((shotId: string) => errorShotIds.size === 0 || errorShotIds.has(shotId))
                .map((shotId: string) => {
                  const shot = llmVisualPlan?.shots?.find((s: any) => s.id === shotId || s.beatId === shotId);
                  return shot?.beatId || shotId;
                })
                .filter((beatId: string, idx: number, arr: string[]) => renderedBeatSlots.has(beatId) && arr.indexOf(beatId) === idx)
                .slice(0, 5);
              if (diversityBeatIds.length === 0) break;
              diversityAttempt += 1;
              context.emit({
                type: 'warning',
                phase: 'images',
                message: `Diversity regeneration ${diversityAttempt}/${maxDiversityRegens} for ${scene.sceneName}: ${diversityBeatIds.join(', ')}`,
                data: { sceneId: scene.sceneId, diversityBeatIds, summary: diversityReport.summary },
              });
              for (const beatIdForDiversity of diversityBeatIds) {
                const guidance = diversityReport.regenerationGuidance?.get?.(beatIdForDiversity)
                  || diversityReport.regenerationGuidance?.get?.(llmVisualPlan?.shots?.find((s: any) => s.beatId === beatIdForDiversity)?.id as string)
                  || diversityReport.summary
                  || 'Vary pose, camera angle, silhouette, and focal point while preserving the story moment.';
                await regenerateRenderedBeat(beatIdForDiversity, 'diversity', diversityAttempt, guidance, true);
              }
              diversityResult = await this.deps.imageAgentTeam.validatePoseDiversity(llmVisualPlan, generatedImagesForSceneQA, true);
              diversityReport = diversityResult.success ? diversityResult.data : undefined;
            }
            if (diversityReport) {
              await this.deps.saveSceneVisualQADiagnostic(outputDirectory, `${scopedSceneId}.diversity`, {
                type: 'diversity',
                promptMode,
                qaMode,
                report: diversityReport,
              });
            }
          } catch (diversityErr) {
            context.emit({
              type: 'warning',
              phase: 'images',
              message: `Scene diversity QA failed for ${scene.sceneName} (non-fatal): ${diversityErr instanceof Error ? diversityErr.message : String(diversityErr)}`,
            });
          }

          const sceneQaPlan: VisualPlan = {
            ...llmVisualPlan,
            shots: (llmVisualPlan.shots || []).filter((shot: any) => renderedBeatSlots.has(shot.beatId || shot.id)),
          };
          const sceneQaImages = generatedImagesForSceneQA;
          const toBeatId = (shotId: string): string => {
            const shot = sceneQaPlan.shots.find((s: any) => s.id === shotId || s.beatId === shotId);
            return shot?.beatId || shotId;
          };
          const includesShotOrBeat = (shotIds: string[], beatId: string): boolean => {
            return shotIds.some((shotId: string) => toBeatId(shotId) === beatId || shotId === beatId);
          };
          if (sceneQaPlan.shots.length > 0) {
            try {
              const fullQaReport = await this.deps.imageAgentTeam.runFullVisualQA(
                sceneQaPlan,
                sceneQaImages,
                sceneContext.isClimactic ? 'climax' : 'dialogue',
                sceneContext.isClimactic || sceneQaPlan.shots.some((shot: any) => shot.storyBeat?.isClimaxBeat || shot.storyBeat?.isKeyStoryBeat),
                colorScript,
                sceneContext,
              );
              const serializedReport = this.deps.serializeVisualQAReport(fullQaReport);
              await this.deps.saveSceneVisualQADiagnostic(outputDirectory, scopedSceneId, serializedReport);
              for (const [beatKey, beatIdentifier] of heroVisualQAIdentifiers.entries()) {
                const shot = sceneQaPlan.shots.find((s: any) => s.beatId === beatKey || s.id === beatKey);
                await this.deps.saveBeatVisualQADiagnostic(outputDirectory, beatIdentifier, {
                  scopedSceneId,
                  beatId: beatKey,
                  qaMode,
                  promptMode,
                  shot,
                  overallScore: fullQaReport.overallScore,
                  isAcceptable: fullQaReport.isAcceptable,
                  issues: fullQaReport.issues,
                  shouldRegenerate: includesShotOrBeat(fullQaReport.shotsToRegenerate || [], beatKey),
                  report: serializedReport,
                });
              }
              if (!fullQaReport.isAcceptable) {
                context.emit({
                  type: 'warning',
                  phase: 'images',
                  message: `Full visual QA flagged ${scene.sceneName}: ${fullQaReport.issues.slice(0, 3).join('; ')}`,
                  data: { sceneId: scene.sceneId, shotsToRegenerate: fullQaReport.shotsToRegenerate },
                });
                const maxQaRegens = Math.max(1, Math.min(2, this.deps.imageService.getMaxRetries?.() || 1));
                let qaAttempt = 0;
                let activeQaReport = fullQaReport;
                while (!activeQaReport.isAcceptable && activeQaReport.shotsToRegenerate.length > 0 && qaAttempt < maxQaRegens) {
                  qaAttempt += 1;
                  const regenBeatIds = activeQaReport.shotsToRegenerate
                    .map((shotId: string) => toBeatId(shotId))
                    .filter((beatId: string, idx: number, arr: string[]) => renderedBeatSlots.has(beatId) && arr.indexOf(beatId) === idx)
                    .slice(0, 4);
                  if (regenBeatIds.length === 0) break;
                  context.emit({
                    type: 'warning',
                    phase: 'images',
                    message: `Full visual QA regeneration ${qaAttempt}/${maxQaRegens} for ${scene.sceneName}: ${regenBeatIds.join(', ')}`,
                    data: { sceneId: scene.sceneId, regenBeatIds, issues: activeQaReport.issues },
                  });

                  for (const regenBeatId of regenBeatIds) {
                    const shot = sceneQaPlan.shots.find((s: any) => s.beatId === regenBeatId || s.id === regenBeatId);
                    const image = sceneQaImages.get(regenBeatId);
                    let guidance: string | undefined;
                    try {
                      guidance = await (this.deps.imageAgentTeam as any).buildFullQAGuidanceForShot?.(activeQaReport, shot, image);
                    } catch { /* fall through to generic QA issues */ }
                    await regenerateRenderedBeat(
                      regenBeatId,
                      'visual-qa',
                      qaAttempt,
                      guidance || activeQaReport.issues.slice(0, 4).join('; ') || 'Improve composition, expression, body language, lighting/color, and visual storytelling while preserving identity and style.',
                      true,
                    );
                  }

                  activeQaReport = await this.deps.imageAgentTeam.runFullVisualQA(
                    sceneQaPlan,
                    sceneQaImages,
                    sceneContext.isClimactic ? 'climax' : 'dialogue',
                    sceneContext.isClimactic || sceneQaPlan.shots.some((shot: any) => shot.storyBeat?.isClimaxBeat || shot.storyBeat?.isKeyStoryBeat),
                    colorScript,
                    sceneContext,
                  );
                  const retryReport = this.deps.serializeVisualQAReport(activeQaReport);
                  await this.deps.saveSceneVisualQADiagnostic(outputDirectory, scopedSceneId, {
                    ...retryReport,
                    qaAttempt,
                    afterRegeneration: true,
                  });
                }
                if (!activeQaReport.isAcceptable) {
                  const blocking = activeQaReport.shotsToRegenerate
                    .map((shotId: string) => toBeatId(shotId))
                    .filter((beatId: string) => renderedBeatSlots.has(beatId));
                  if (blocking.length > 0) {
                    for (const beatIdToReject of blocking) {
                      const slot = renderedBeatSlots.get(beatIdToReject);
                      if (slot) {
                        beatImages.delete(slot.beatMapKey);
                        beatResumeSet.delete(slot.identifier);
                        delete beatResumeImageMap[slot.identifier];
                      }
                    }
                    persistBeatResume().catch(() => {});
                    throw new Error(`Full visual QA failed for ${scene.sceneName} after ${maxQaRegens} regeneration attempt(s): ${activeQaReport.issues.join('; ')}`);
                  }
                }
              }
            } catch (qaErr) {
              const qaMsg = qaErr instanceof Error ? qaErr.message : String(qaErr);
              if (qaMsg.startsWith('Full visual QA failed')) {
                throw qaErr;
              }
              await this.deps.saveSceneVisualQADiagnostic(outputDirectory, scopedSceneId, {
                status: 'failed',
                error: qaMsg,
                promptMode,
                qaMode,
              });
              context.emit({
                type: 'warning',
                phase: 'images',
                message: `Full visual QA failed for ${scene.sceneName} (non-fatal): ${qaMsg}`,
              });
            }
          }
        }

        if (qaMode === 'full' && llmVisualPlan && generatedImagesForSceneQA.size > 0 && renderedBeatSlots.size > 0) {
          try {
            const identityPlan: VisualPlan = {
              ...llmVisualPlan,
              shots: (llmVisualPlan.shots || [])
                .map((shot: any) => {
                  const beatIdForShot = shot.beatId || shot.id;
                  const slot = renderedBeatSlots.get(beatIdForShot);
                  if (!slot) return null;
                  return {
                    ...shot,
                    beatId: beatIdForShot,
                    characters: Array.isArray(slot.metadata?.characters) && slot.metadata.characters.length > 0
                      ? slot.metadata.characters
                      : shot.characters,
                  };
                })
                .filter(Boolean),
            };
            if (identityPlan.shots.length > 0) {
              const promptMap = new Map<string, ImagePrompt>();
              for (const [beatIdForShot, slot] of renderedBeatSlots.entries()) {
                promptMap.set(beatIdForShot, slot.imagePrompt);
              }
              const beforeIdentityUrls = new Map<string, string | undefined>();
              for (const shot of identityPlan.shots) {
                const shotKey = shot.beatId || shot.id;
                beforeIdentityUrls.set(shotKey, generatedImagesForSceneQA.get(shotKey)?.imageUrl);
              }
              await (this.deps.imageAgentTeam as any).runIdentityConsistencyGate?.(
                identityPlan,
                generatedImagesForSceneQA,
                promptMap,
                {
                  generateImage: (prompt: ImagePrompt, identifier: string, metadata?: any, referenceImages?: any[]) => this.deps.generateImageWithDefectRetries(
                    prompt,
                    identifier,
                    {
                      ...(metadata || {}),
                      sceneId: scopedSceneId,
                      type: 'beat',
                      regenerationReason: 'identity',
                      renderRoute: 'identity-generate',
                    },
                    referenceImages,
                    `identityGate(${scopedSceneId}:${identifier})`,
                    outputDirectory,
                  ),
                  editImage: (baseImage: { data: string; mimeType: string }, prompt: ImagePrompt, identifier: string, referenceImages?: any[]) => this.deps.generateImageWithDefectRetries(
                    prompt,
                    identifier,
                    {
                      sceneId: scopedSceneId,
                      type: 'beat',
                      regenerationReason: 'identity',
                      renderRoute: 'identity-edit',
                    },
                    referenceImages,
                    `identityEdit(${scopedSceneId}:${identifier})`,
                    outputDirectory,
                    (activePrompt, attemptIdentifier, _attemptMetadata, attemptRefs) => this.deps.imageService.editImage(
                      baseImage,
                      activePrompt,
                      attemptIdentifier,
                      attemptRefs,
                    ),
                  ),
                },
                storyboardRequest,
              );

              const changedIdentityShots: string[] = [];
              for (const shot of identityPlan.shots) {
                const shotKey = shot.beatId || shot.id;
                const result = generatedImagesForSceneQA.get(shotKey);
                const slot = renderedBeatSlots.get(shotKey);
                if (!result?.imageUrl || !slot) continue;
                if (beforeIdentityUrls.get(shotKey) === result.imageUrl) continue;
                changedIdentityShots.push(shotKey);
                beatImages.set(slot.beatMapKey, result.imageUrl);
                if (slot.beatIndex === 0) sceneImages.set(scopedSceneId, result.imageUrl);
                if (heroVisualQAIdentifiers.has(shotKey)) generatedImagesForVisualQA.set(shotKey, result);
                beatResumeSet.add(slot.identifier);
                beatResumeImageMap[slot.identifier] = result.imageUrl;
                try {
                  this.deps.assetRegistry.markSuccess(`story-beat:${scopedSceneId}::${shotKey}`, result, { prompt: slot.imagePrompt });
                } catch { /* non-fatal */ }
              }
              if (changedIdentityShots.length > 0) {
                persistBeatResume().catch(() => {});
                await this.deps.saveSceneVisualQADiagnostic(outputDirectory, `${scopedSceneId}.identity`, {
                  type: 'identity-consistency',
                  promptMode,
                  qaMode,
                  changedShots: changedIdentityShots,
                });
                context.emit({
                  type: 'warning',
                  phase: 'images',
                  message: `Identity consistency gate regenerated ${changedIdentityShots.length} shot(s) in ${scene.sceneName}: ${changedIdentityShots.join(', ')}`,
                  data: { sceneId: scene.sceneId, changedIdentityShots },
                });
              }
            }
          } catch (identityErr) {
            context.emit({
              type: 'warning',
              phase: 'images',
              message: `Identity consistency gate failed for ${scene.sceneName} (non-fatal): ${identityErr instanceof Error ? identityErr.message : String(identityErr)}`,
            });
          }
        }

        if (chatModeEnabled) {
          this.deps.imageService.endChatSession();
        }


        // After all shots in this scene: update Gemini context images for continuity
        if (lastGeneratedImage) {
          // Previous scene image: always update to the latest generated scene image
          this.deps.imageService.setGeminiPreviousScene(lastGeneratedImage.data, lastGeneratedImage.mimeType);

          // Style reference: store the first scene's image as the style anchor
          if (this.deps._generatedStyleReferencesAllowed && !styleReferenceStored) {
            this.deps.imageService.setSeasonStyleReference(lastGeneratedImage.data, lastGeneratedImage.mimeType);
            styleReferenceStored = true;
            context.emit({ type: 'debug', phase: 'images', message: `Stored style reference from scene ${scene.sceneId}` });
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Pipeline] Image generation THREW for scene "${scene.sceneId}" ("${scene.sceneName}"): ${errMsg}`);
        context.emit({
          type: 'error',
          phase: 'images',
          message: `Image generation failed for scene ${scene.sceneId} ("${scene.sceneName}"): ${errMsg}`,
          data: { sceneId: scene.sceneId, sceneName: scene.sceneName, error: errMsg },
        });
      }
    }

    // Orphan reconciliation: wire up any images that landed on disk after their
    // generation promise was abandoned by `withTimeout` (Node can't cancel the
    // underlying work, so the file may appear after the pipeline gave up on it).
    this.deps.reconcileOrphanedBeatImages(brief, sceneContents, beatImages, sceneImages);

    // Slot repair pass: render only the individual beat slots that remain missing
    // after registry/disk reconciliation. This avoids scene-wide recovery bursts.
    for (const scene of sceneContents) {
      await this.deps.checkCancellation();
      const sceneBeats = scene.beats || [];
      if (sceneBeats.length === 0) continue; // encounter-only scene
      const scopedSceneId = this.deps.getEpisodeScopedSceneId(brief, scene.sceneId);
      if (!shouldProcessSceneForRequestedSlots(scopedSceneId)) continue;

      const missingBeats = sceneBeats.filter(b => !beatImages.has(this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, b.id)));
      if (missingBeats.length === 0) continue;
      const repairableBeats = missingBeats.filter((beat) => {
        const slotId = `story-beat:${scopedSceneId}::${beat.id}`;
        const record = this.deps.assetRegistry.get(slotId);
        const attempted = Boolean(record?.attempts?.length)
          || (record?.slot.metadata as any)?.primaryRenderStatus === 'attempted'
          || record?.status === 'failed_transient'
          || record?.status === 'failed_permanent'
          || record?.status === 'aborted';
        if (!attempted) {
          context.emit({
            type: 'error',
            phase: 'images',
            message: `Repair blocked for ${scene.sceneId}:${beat.id}; no primary render attempt was recorded. Primary scene rendering likely failed before beat rendering.`,
            data: { sceneId: scene.sceneId, beatId: beat.id, slotId },
          });
        }
        return attempted;
      });
      if (repairableBeats.length === 0) {
        context.emit({
          type: 'error',
          phase: 'images',
          message: `Repair blocked for ${scene.sceneName}; ${missingBeats.length}/${sceneBeats.length} beats missing but no primary render attempts were recorded.`,
          data: { sceneId: scene.sceneId, missingBeatIds: missingBeats.map((beat) => beat.id) },
        });
        continue;
      }
      if (repairableBeats.length < missingBeats.length) {
        context.emit({
          type: 'warning',
          phase: 'images',
          message: `Repair limited for ${scene.sceneName}; ${repairableBeats.length}/${missingBeats.length} missing beats had primary attempts.`,
        });
      }

      console.warn(`[Pipeline] Slot repair: scene "${scene.sceneId}" ("${scene.sceneName}") has ${repairableBeats.length}/${sceneBeats.length} repairable missing beat images — generating per-slot text-plan repairs`);
      context.emit({
        type: 'warning',
        phase: 'images',
        message: `Repair: generating text-plan fallback images for ${scene.sceneName} (${repairableBeats.length}/${sceneBeats.length} beats missing after primary attempts)`,
      });

      const sceneCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
        this.deps.getCharacterIdsInScene(scene, characterBible, brief.protagonist.id),
        characterBible,
        brief,
        `repair-scene:${scopedSceneId}`
      );

      for (const beat of repairableBeats) {
        try {
          const beatCharContext = this.deps.analyzeBeatCharacters(
            beat.text,
            beat.speaker,
            sceneCharacterIds,
            characterBible,
            brief.protagonist.id,
          );
          const explicitShotType = (beat as { shotType?: 'establishing' | 'character' | 'action' }).shotType;
          const isEstablishing = explicitShotType === 'establishing'
            || (!explicitShotType && this.deps.isEstablishingBeat(beat.text, beat.speaker, beat.primaryAction, beatCharContext));
          const resolvedShotType: 'establishing' | 'character' | 'action' = explicitShotType
            || (isEstablishing ? 'establishing' : 'character');
          const shotCast = resolveShotCast({
            beat: { ...beat, shotType: resolvedShotType },
            sceneCharacterIds,
            characters: characterBible.characters.map(c => ({ id: c.id, name: c.name })),
            protagonistId: brief.protagonist.id,
          });
          let shotCharacterIds = isEstablishing
            ? []
            : [...shotCast.requiredForegroundCharacterIds, ...shotCast.optionalBackgroundCharacterIds];
          shotCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
            shotCharacterIds,
            characterBible,
            brief,
            `repair-beat:${scopedSceneId}:${beat.id}`
          );
          const shotCharacterNames = shotCharacterIds
            .map(id => characterBible.characters.find(c => c.id === id)?.name)
            .filter(Boolean) as string[];
          const visibleCastClause = shotCharacterNames.length > 0
            ? ` Visible characters in this shot: ${shotCharacterNames.join(', ')}. Do not include other scene-present characters.`
            : ' No characters are visible in this establishing shot.';
          const coverage = (beat as any).coveragePlan;
          const coverageClause = coverage
            ? ` Coverage plan: staging=${coverage.stagingPattern || 'derive'}, shot=${coverage.shotDistance || 'derive'}, angle=${coverage.cameraAngle || 'derive'}, side=${coverage.cameraSide || 'derive'}, blocking=${coverage.relationshipBlocking || 'derive'}, continuity=${coverage.visualContinuity?.mode || 'fresh_composition'}, reason=${coverage.coverageReason || 'sequence repair'}.`
            : '';
          const referenceImages = this.deps.gatherCharacterReferenceImages(
            shotCharacterIds,
            characterBible,
            undefined,
            { family: 'story-beat', slotId: `story-beat:${scopedSceneId}::${beat.id}:repair` }
          );
          const fallbackPrompt: ImagePrompt = this.deps.withSettingAwarePrompt({
            prompt: `${this.deps.sanitizePromptText(beat.text, brief, '')}${visibleCastClause}${coverageClause} Text-plan repair render. Translate second-person prose into third-person visual action centered on the protagonist from outside the body. Show exactly one concrete story moment in a single continuous frame from one camera angle. Do not show multiple moments, repeated figures, or stacked scenes inside the image.`,
            style: context.config.artStyle || undefined,
            aspectRatio: '9:19.5',
            composition: `Scene: ${scene.sceneName}. Genre: ${brief.story.genre}, Tone: ${brief.story.tone}. Generate exactly ONE single full-bleed third-person image with ONE unified scene and ONE camera angle. No first-person POV, no split-screen, no diptych, no stacked panels, no repeated subject, no image-within-image.`,
            negativePrompt: 'text, words, letters, signatures, watermarks, comic panels, split panels, storyboard, grid layout, diptych, triptych, collage, duplicate character, same character twice, cloned figure, repeated subject, first-person POV, player-eye view, disembodied hands, your hand, style drift, unapproved renderer',
          }, scene.settingContext);
          const promptWithContracts = this.deps.applyThirdPersonRenderContract(fallbackPrompt, undefined, { isEnvironmentShot: shotCharacterIds.length === 0 || isEstablishing });
          const identifier = `beat-${scopedSceneId}-${beat.id}-repair`;
          const result = await this.deps.generateImageWithDefectRetries(
            promptWithContracts,
            identifier,
            {
              sceneId: scopedSceneId,
              beatId: beat.id,
              type: 'beat',
              characters: shotCharacterIds,
              characterNames: shotCharacterNames,
              characterDescriptions: this.deps.buildCharacterDescriptions(shotCharacterIds, characterBible),
              shotCastReason: shotCast.shotCastReason,
              requestedPlanningMode: 'visual-storyboard',
              effectivePlanningMode: 'text',
              visualStoryboardFallbackReason: 'slot-repair-after-registry-disk-reconcile',
            },
            referenceImages.length > 0 ? referenceImages : undefined,
            `textPlanRepair(${scopedSceneId}:${beat.id})`,
            outputDirectory,
          );
          if (result.imageUrl) {
            beatImages.set(this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, beat.id), result.imageUrl);
            if (!sceneImages.has(scopedSceneId)) {
              sceneImages.set(scopedSceneId, result.imageUrl);
            }
            const slotId = `story-beat:${scopedSceneId}::${beat.id}`;
            try {
              if (!this.deps.assetRegistry.get(slotId)) {
                this.deps.assetRegistry.planSlot({
                  slotId,
                  family: 'story-beat',
                  imageType: 'beat',
                  sceneId: scene.sceneId,
                  scopedSceneId,
                  beatId: beat.id,
                  storyFieldPath: `episodes[].scenes[id=${scene.sceneId}].beats[id=${beat.id}].image`,
                  baseIdentifier: identifier,
                  required: false,
                  qualityTier: 'standard',
                  coverageKey: `beat:${scene.sceneId}::${beat.id}`,
                  metadata: {
                    requestedPlanningMode: 'visual-storyboard',
                    effectivePlanningMode: 'text',
                    promptSource: 'text-plan-repair',
                  },
                });
              }
              this.deps.assetRegistry.markSuccess(slotId, result, {
                prompt: promptWithContracts,
                referencePack: this.deps.createSlotReferencePack(slotId, referenceImages),
              });
            } catch { /* non-fatal */ }
          }
        } catch (beatErr) {
          const beatErrMsg = beatErr instanceof Error ? beatErr.message : String(beatErr);
          console.warn(`[Pipeline] Text-plan repair failed for beat ${beat.id} in scene ${scene.sceneId}: ${beatErrMsg}`);
          context.emit({ type: 'warning', phase: 'images', message: `Text-plan repair failed for ${scene.sceneId}:${beat.id}: ${beatErrMsg}` });
        }
      }

      const recoveredCount = sceneBeats.filter(b => beatImages.has(this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, b.id))).length;
      console.log(`[Pipeline] Slot repair complete for scene "${scene.sceneId}": ${recoveredCount}/${sceneBeats.length} beats now have images`);
      if (recoveredCount === 0) {
        this.deps.throwIfFailFast(
          `Scene ${scene.sceneName} produced zero beat images`,
          'images',
          {
            context: {
              sceneId: scene.sceneId,
              sceneName: scene.sceneName,
              failureKind: 'image_step',
            },
          }
        );
      }
    }

    // === TIER 2/3 VISUAL VALIDATION: Post-generation quality check ===
    if (beatImages.size > 0) {
      const sceneReports: Tier2SceneReport[] = [];

      for (const scene of sceneContents) {
        const scopedId = brief.episode?.number > 1
          ? `ep${brief.episode.number}-${scene.sceneId}`
          : scene.sceneId;
        const sceneBeats = scene.beats.filter(b =>
          beatImages.has(this.deps.getEpisodeScopedBeatKey(brief, scene.sceneId, b.id))
        );
        if (sceneBeats.length === 0) continue;

        const shots = sceneBeats.map(b => ({
          cameraAngle: (b as any).shotType || 'unknown',
          shotType: (b as any).shotType || 'character',
          beatId: b.id,
        }));

        const diversity = checkStructuralDiversity(shots, context.config.imageGen?.artStyleProfile);
        if (!diversity.acceptable) {
          context.emit({
            type: 'warning',
            phase: 'images',
            message: `Structural diversity issue in ${scene.sceneId}: ${diversity.warnings.join('; ')}`,
          });
        }

        const shotReports: Tier2ShotReport[] = sceneBeats.map((b, idx) => {
          const diversityPenalty = !diversity.acceptable ? 0.5 : 0;
          const baseScore = 3.5 - diversityPenalty;
          return {
            shotId: `${scopedId}-${b.id}`,
            beatId: b.id,
            scores: {
              expression: baseScore,
              pose: baseScore,
              flow: idx === 0 ? 5 : baseScore,
              setting: baseScore,
            },
            averageScore: idx === 0
              ? (baseScore * 3 + 5) / 4
              : baseScore,
            flagged: !diversity.acceptable && baseScore < 3,
            reason: !diversity.acceptable ? diversity.warnings[0] : undefined,
          };
        });

        const overallScore = shotReports.length > 0
          ? shotReports.reduce((sum, r) => sum + r.averageScore, 0) / shotReports.length
          : 3.5;

        sceneReports.push({
          sceneId: scene.sceneId,
          shotReports,
          overallScore: Math.round(overallScore * 10) / 10,
          flaggedCount: shotReports.filter(r => r.flagged).length,
        });
      }

      const visualQAReport: VisualQAReport = {
        generatedAt: new Date().toISOString(),
        scenes: sceneReports,
        totalImages: beatImages.size,
        totalFlagged: sceneReports.reduce((sum, s) => sum + s.flaggedCount, 0),
        overallScore: sceneReports.length > 0
          ? Math.round(sceneReports.reduce((sum, s) => sum + s.overallScore, 0) / sceneReports.length * 10) / 10
          : 5,
      };

      // Tier 3: Identify and regenerate flagged images
      const regenTargets = identifyRegenTargets(visualQAReport, 2.5);
      if (regenTargets.length > 0) {
        context.emit({
          type: 'regeneration_triggered',
          phase: 'images',
          message: `Tier 3 visual QA: regenerating ${regenTargets.length} flagged image(s)`,
        });

        const maxTier3Regens = Math.min(regenTargets.length, 5);
        for (let ti = 0; ti < maxTier3Regens; ti++) {
          const target = regenTargets[ti];
          const scene = sceneContents.find(sc => sc.sceneId === target.sceneId);
          if (!scene) continue;
          const beat = scene.beats.find(b => b.id === target.beatId);
          if (!beat) continue;

          const scopedId = brief.episode?.number > 1
            ? `ep${brief.episode.number}-${target.sceneId}`
            : target.sceneId;

          const identifier = `beat-${scopedId}-${target.beatId}-tier3`;
          const imgPrompt: ImagePrompt = target.originalPrompt || {
            prompt: `High-quality dramatic story image for: ${beat.text.slice(0, 200)}`,
            negativePrompt: 'text, watermark, logo, blurry, low quality',
            width: 1024,
            height: 1024,
          };

          try {
            const result = await withTimeout(this.deps.imageService.generateImage(
              imgPrompt,
              identifier,
              { sceneId: target.sceneId, beatId: target.beatId, type: 'scene', regeneration: 1 },
            ), PIPELINE_TIMEOUTS.imageGeneration, `tier3-regen(${target.beatId})`);

            const tier1Check = runTier1Checks(result, identifier);
            if (tier1Check.passed && result.imageUrl) {
              const beatMapKey = this.deps.getEpisodeScopedBeatKey(brief, target.sceneId, target.beatId);
              beatImages.set(beatMapKey, result.imageUrl);
              context.emit({
                type: 'debug',
                phase: 'images',
                message: `Tier 3 regen succeeded for ${target.beatId}: ${target.reason}`,
              });
            }
          } catch (regenErr) {
            const errMsg = regenErr instanceof Error ? regenErr.message : String(regenErr);
            context.emit({ type: 'warning', phase: 'images', message: `Tier 3 regen failed for ${target.beatId}: ${errMsg}` });
          }
        }
      }
    }

    return { beatImages, sceneImages };
  }
}
