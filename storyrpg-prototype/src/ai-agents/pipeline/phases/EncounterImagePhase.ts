/**
 * Encounter Image Phase
 *
 * Generates encounter imagery for an episode: per-encounter slot manifests
 * (setup beats, choice-outcome trees with nested situations, storylets),
 * optional visual-storyboard planning, the per-encounter generation loop with
 * provider policy + resume state (registry, disk artifacts, run-state files),
 * the text-artifact QA policy with retry identifiers, the missing-slot retry
 * pass over the choice tree, and storylet outcome images.
 *
 * Faithful port of FullStoryPipeline.generateEncounterImages (pure move):
 * same control flow, same events, same diagnostics, same prompts. Monolith
 * helpers shared with other pipeline regions (scene images, cover art,
 * prefetch) are injected as closures; encounter-exclusive helpers moved here
 * as private methods. Wiring images into assembled scenes
 * (wireEncounterTreeImages) and the provider preflight stay in the monolith
 * with their callers.
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { EncounterStructure } from '../../agents/EncounterArchitect';
import { EncounterImageAgent } from '../../agents/image-team/EncounterImageAgent';
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
import type { ImageSlotFamily } from '../../images/slotTypes';
import type { EncounterOutcome, EncounterVisualContract } from '../../../types';
import {
  ENCOUNTER_TREE_MAX_DEPTH,
  buildEncounterSlotManifest,
  collectMissingSlotsFromManifest,
  encounterOutcomeIdentifier,
  encounterOutcomeRetryIdentifier,
  encounterSetupFallbackIdentifier,
  encounterSetupIdentifier,
  encounterSituationIdentifier,
  encounterSituationKey,
  encounterSituationRetryIdentifier,
  legacyEncounterSituationIdentifier,
  legacyEncounterSituationKey,
  legacyEncounterSituationRetryIdentifier,
  sanitizeEncounterIdentifier,
} from '../../encounters/encounterSlotManifest';
import { EncounterProviderPolicy } from '../../encounters/encounterProviderPolicy';
import {
  buildStoryletSlotManifest,
  collectMissingStoryletSlotsFromManifest,
  storyletAggressiveRetryIdentifier,
  storyletRetryIdentifier,
  type StoryletSlot,
} from '../../encounters/storyletSlotManifest';
import { getEncounterBeats } from '../../utils/encounterImageCoverage';
import { slugify as idSlugify } from '../../utils/idUtils';
import {
  loadEncounterResumeStateSync,
  saveEarlyDiagnostic,
  saveEncounterResumeState,
} from '../../utils/pipelineOutputWriter';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import {
  resolveSceneSettingContext,
  type SceneSettingContext,
} from '../../utils/styleAdaptation';
import { TIMING_DEFAULTS } from '../../../constants/pipeline';
import {
  attachStoryboardPlanToVisualPlan,
  buildSceneVisualStoryboardPlan,
  visualPlanSlotsFromEncounterManifest,
  visualPlanSlotsFromStoryletManifest,
} from '../../images/visualStoryboardPlanning';
import { PipelineError } from '../errors';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// INPUT, RESULT & DEPENDENCY TYPES
// ========================================

export interface EncounterImagePhaseInput {
  encounters: Map<string, EncounterStructure>;
  characterBible: CharacterBible;
  brief: FullCreativeBrief;
  outputDirectory?: string;
}

export interface EncounterImagePhaseResult {
  encounterImages: Map<string, {
    setupImages: Map<string, string>;  // beatId -> URL
    outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;  // choiceId -> URLs
  }>;
  storyletImages: Map<string, Map<string, Map<string, string>>>;
  storyletFailures: string[];
}

/**
 * Everything the phase still borrows from the monolith. Helpers shared with
 * other pipeline regions stay injected as closures; the service/agent
 * instances are passed by reference so diagnostics and provider state stay
 * shared with the rest of the run.
 */
export interface EncounterImagePhaseDeps {
  imageService: ImageGenerationService;
  encounterImageAgent: Pick<EncounterImageAgent, 'cinematicDescriptionToPrompt'>;
  imageAgentTeam: Pick<
    ImageAgentTeam,
    'validateBodyLanguage' | 'validateExpressions' | 'validateVisualStorytelling'
  >;
  collectedVisualPlanning: { colorScript?: ColorScript; visualPlans: VisualPlan[] };
  checkCancellation: () => Promise<void>;

  // --- Helpers shared with other monolith regions (injected closures) ---
  buildCharacterDescriptions: (
    characterIds: string[],
    characterBible: CharacterBible
  ) => CharacterAppearanceDescription[];
  ensureCharacterReferencesForVisibleCharacters: (
    ids: string[] | undefined,
    characterBible: CharacterBible,
    brief: FullCreativeBrief,
    contextLabel: string,
  ) => Promise<string[]>;
  gatherCharacterReferenceImages: (
    characterIds: string[],
    characterBible: CharacterBible,
    locationId?: string,
    options?: { includeExpressions?: boolean; family?: ImageSlotFamily; slotId?: string }
  ) => Array<{ data: string; mimeType: string; role: string; characterName: string; viewType: string; visualAnchors?: string[] }>;
  getEffectiveImagePlanningMode: () => 'text' | 'visual-storyboard';
  getEffectiveImagePromptMode: () => 'deterministic' | 'llm';
  getEffectiveImageQaMode: () => 'off' | 'fast' | 'full';
  getEpisodeScopedSceneId: (brief: FullCreativeBrief, sceneId: string) => string;
  getStoryboardMaxPanelsPerSheet: () => number;
  isLlmQuotaFailure: (errorLike: unknown) => boolean;
  normalizeNarrativeText: (raw: unknown, fallback?: string) => string;
  resolvePlayerTemplates: (text: string, brief: FullCreativeBrief) => string;
  sanitizeImagePrompt: (prompt: ImagePrompt, brief: FullCreativeBrief) => ImagePrompt;
  saveSceneVisualPlanningDiagnostic: (
    outputDirectory: string | undefined,
    scopedSceneId: string,
    payload: Record<string, unknown>,
    options?: { suffix?: string },
  ) => Promise<void>;
  scrubPromptArtifacts: (text: string) => string;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class EncounterImagePhase {
  readonly name = 'encounter_images';

  constructor(private readonly deps: EncounterImagePhaseDeps) {}

  /**
   * Generate images for encounter beats and outcomes.
   * Creates setup images and outcome-specific images (success/complicated/failure)
   * for each choice, plus storylet outcome images.
   * Faithful port of FullStoryPipeline.generateEncounterImages.
   */
  async run(input: EncounterImagePhaseInput, context: PipelineContext): Promise<EncounterImagePhaseResult> {
    const { encounters, characterBible, brief, outputDirectory } = input;
    const encounterImages = new Map<string, {
      setupImages: Map<string, string>;
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
    }>();

    const emptyStoryletImages = new Map<string, Map<string, Map<string, string>>>();
    const storyletFailures: string[] = [];

    if (!context.config.imageGen?.enabled) {
      console.log('[Pipeline] Encounter image generation skipped: imageGen not enabled');
      context.emit({ type: 'debug', phase: 'encounter_images', message: 'Encounter image generation skipped: imageGen not enabled' });
      return { encounterImages, storyletImages: emptyStoryletImages, storyletFailures };
    }
    if (encounters.size === 0) {
      console.log('[Pipeline] Encounter image generation skipped: no encounters found');
      context.emit({ type: 'debug', phase: 'encounter_images', message: 'Encounter image generation skipped: no encounters in this episode' });
      return { encounterImages, storyletImages: emptyStoryletImages, storyletFailures };
    }

    context.emit({ type: 'phase_start', phase: 'encounter_images', message: `Generating images for ${encounters.size} encounters` });

    let globalEncounterImageIndex = 0;
    let totalEncounterImages = 0;

    const encounterManifestShots: { identifier: string; beatId?: string; sceneId: string; description: string }[] = [];
    for (const [sid, enc] of encounters) {
      const scopedSid = this.deps.getEpisodeScopedSceneId(brief, sid);
      const m = buildEncounterSlotManifest(enc, sid, scopedSid, ENCOUNTER_TREE_MAX_DEPTH);
      totalEncounterImages += m.slots.length;
      if (m.truncatedPaths.length > 0) {
        console.warn(
          `[Pipeline] Encounter ${sid}: ${m.truncatedPaths.length} subtree(s) truncated at max depth ${ENCOUNTER_TREE_MAX_DEPTH} (paths: ${m.truncatedPaths.slice(0, 8).join('; ')})`
        );
      }
      for (const s of m.slots) {
        encounterManifestShots.push({
          identifier: s.baseIdentifier,
          beatId: s.beatId,
          sceneId: sid,
          description: `${s.kind}${s.tier ? `:${s.tier}` : ''}`,
        });
      }
      const storyletManifest = buildStoryletSlotManifest(enc.storylets, sid, scopedSid);
      totalEncounterImages += storyletManifest.slots.length;
      for (const s of storyletManifest.slots) {
        encounterManifestShots.push({
          identifier: s.baseIdentifier,
          beatId: s.beatId,
          sceneId: sid,
          description: `storylet:${s.outcomeName}`,
        });
      }
    }
    context.emit({
      type: 'checkpoint', phase: 'image_manifest',
      message: `Encounter image manifest: ${encounterManifestShots.length} planned shots`,
      data: { manifestType: 'encounter', shots: encounterManifestShots },
    });
    const persistEncounterRunState = async (
      sceneId: string,
      phase: string,
      setupImages: Map<string, string>,
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>,
      failedImages: string[],
      imagesGenerated: number,
      imagesAttempted: number,
      completedBaseIdentifiers?: string[],
      missingManifestKeys?: string[],
    ): Promise<void> => {
      if (!outputDirectory) return;
      const textFixResolutions = this.deps.imageService
        .getEncounterDiagnostics()
        .filter((entry) => entry.baseIdentifier && entry.resolvedIdentifier && entry.baseIdentifier !== entry.resolvedIdentifier)
        .slice(-50)
        .map((entry) => ({
          baseIdentifier: entry.baseIdentifier,
          resolvedIdentifier: entry.resolvedIdentifier,
          status: entry.status,
        }));
      await saveEarlyDiagnostic(outputDirectory, `08a-encounter-run-state-${idSlugify(sceneId)}.json`, {
        generatedAt: new Date().toISOString(),
        sceneId,
        phase,
        imagesGenerated,
        imagesAttempted,
        setupImageKeys: Array.from(setupImages.keys()),
        outcomeImageKeys: Array.from(outcomeImages.keys()),
        failedImages: failedImages.slice(-50),
        completedBaseIdentifiers: completedBaseIdentifiers?.slice(-200),
        missingManifestKeys: missingManifestKeys?.slice(0, 100),
        textFixResolutions,
      });
    };

    for (const [sceneId, encounter] of encounters) {
      const scopedSceneId = this.deps.getEpisodeScopedSceneId(brief, sceneId);
      const setupImages = new Map<string, string>();
      const outcomeImages = new Map<string, { success?: string; complicated?: string; failure?: string }>();

      const slotManifest = buildEncounterSlotManifest(encounter, sceneId, scopedSceneId, ENCOUNTER_TREE_MAX_DEPTH);
      if (slotManifest.truncatedPaths.length > 0) {
        console.warn(
          `[Pipeline] Encounter ${sceneId}: ${slotManifest.truncatedPaths.length} subtree(s) not expanded beyond depth ${ENCOUNTER_TREE_MAX_DEPTH}`
        );
      }
      if (this.deps.getEffectiveImagePlanningMode() === 'visual-storyboard') {
        const storyletManifestForPlanning = buildStoryletSlotManifest(encounter.storylets, sceneId, scopedSceneId);
        const storyboardPlan = buildSceneVisualStoryboardPlan({
          sceneId,
          scopedSceneId,
          sceneName: `${sceneId} encounter`,
          sceneDescription: (encounter as { description?: string }).description || encounter.encounterType || sceneId,
          slots: [
            ...visualPlanSlotsFromEncounterManifest(slotManifest.slots),
            ...visualPlanSlotsFromStoryletManifest(storyletManifestForPlanning.slots),
          ],
          panelCap: this.deps.getStoryboardMaxPanelsPerSheet(),
          branchAware: true,
        });
        const encounterVisualPlan = attachStoryboardPlanToVisualPlan({
          sceneId: scopedSceneId,
          imagePlanningMode: 'visual-storyboard',
          rhythmPattern: 'Action Sequence',
          shots: storyboardPlan.panels
            .filter((panel) => !panel.contextOnly)
            .map((panel) => ({
              id: panel.slotId,
              beatId: panel.beatId || panel.slotId,
              description: panel.encounterPathId || panel.slotId,
              type: panel.sequenceRole === 'aftermath' ? 'outcome' : 'action',
              shotType: panel.sequenceRole === 'establishing' ? 'LS' : panel.sequenceRole === 'insert' ? 'CU' : 'MS',
              cameraAngle: panel.sequenceRole === 'confrontation' ? 'Low' : 'Eye-level',
              horizontalAngle: 'Three-quarter',
              wallyWoodPanel: panel.sequenceRole,
              pose: {
                lineOfAction: 'diagonal',
                weightDistribution: panel.sequenceRole === 'aftermath' ? 'backward' : 'forward',
                armPosition: 'gesture-mid',
                torsoTwist: 'twisted-left',
                emotionalQuality: panel.sequenceRole === 'aftermath' ? 'contracted' : 'dynamic',
              },
              poseDescription: `Encounter ${panel.sequenceRole} panel for ${panel.slotId}`,
              lighting: { direction: 'side', quality: 'dramatic', temperature: 'mixed', contrast: 'high' },
              lightingDescription: 'Branch-aware dramatic light preserving the encounter setup geography.',
              storyBeat: {
                action: panel.encounterPathId || panel.slotId,
                emotion: panel.sequenceRole,
              },
              mood: panel.sequenceRole,
              composition: 'Branch-aware cinematic staging; preserve parent-state continuity.',
              focalPoint: panel.beatId || panel.slotId,
              depthLayers: 'Foreground pressure, midground action, background encounter geography.',
              storyboardPanel: panel,
              sequenceRole: panel.sequenceRole,
              continuityFrom: panel.continuityFrom,
              continuityTo: panel.continuityTo,
            })),
          diversityCheck: {
            lineOfActionVariety: true,
            weightVariety: true,
            angleVariety: true,
            poseRepetition: [],
          },
          transitionAnalysis: {
            transitionSequence: [],
            rhythmDescription: storyboardPlan.sequenceGrammar.cameraProgression,
            closureLoadProgression: storyboardPlan.sequenceGrammar.silentReadabilityGoal,
          },
        } as any, storyboardPlan);
        this.deps.collectedVisualPlanning.visualPlans.push(encounterVisualPlan as any);
        await this.deps.saveSceneVisualPlanningDiagnostic(outputDirectory, scopedSceneId, {
          promptMode: this.deps.getEffectiveImagePromptMode(),
          qaMode: this.deps.getEffectiveImageQaMode(),
          imagePlanningMode: 'visual-storyboard',
          status: 'encounter-structured-storyboard',
          encounterSlotCount: slotManifest.slots.length,
          storyletSlotCount: storyletManifestForPlanning.slots.length,
          storyboardSheets: storyboardPlan.sheets,
          storyboardPanels: storyboardPlan.panels,
          storyboardCoverage: storyboardPlan.coverage,
          sequenceGrammar: storyboardPlan.sequenceGrammar,
          continuityBible: storyboardPlan.continuityBible,
          truncatedPaths: slotManifest.truncatedPaths,
        });
      }

      const encounterPolicy = new EncounterProviderPolicy(this.deps.imageService, {
        maxConsecutiveFailuresBeforeAbort: context.config.imageGen?.encounterMaxConsecutiveFailuresBeforeAbort ?? 0,
      });

      const resumeLoaded = outputDirectory ? loadEncounterResumeStateSync(outputDirectory, idSlugify(sceneId)) : null;
      const resumeSet = new Set<string>(resumeLoaded?.completedBaseIdentifiers ?? []);
      const persistResume = async (): Promise<void> => {
        if (!outputDirectory) return;
        await saveEncounterResumeState(outputDirectory, idSlugify(sceneId), {
          version: 1,
          sceneId,
          scopedSceneId,
          completedBaseIdentifiers: [...resumeSet],
          generatedAt: new Date().toISOString(),
        });
      };
      const markResumeDone = async (baseId: string): Promise<void> => {
        if (!resumeSet.has(baseId)) {
          resumeSet.add(baseId);
          await persistResume();
        }
      };

      const onEncounterSlotFailure = async (err: unknown): Promise<void> => {
        encounterPolicy.onSlotFailure(err);
        const d = encounterPolicy.getBackoffDelayMs();
        if (d > 0) await new Promise(r => setTimeout(r, d));
        if (encounterPolicy.shouldAbortHard()) {
          throw new PipelineError(
            `Encounter image generation aborted after repeated failures for ${sceneId}`,
            'encounter_images',
            {
              agent: 'EncounterImageAgent',
              context: { sceneId, encounterId: encounter.id || `${sceneId}-encounter`, failureKind: 'encounter_consecutive_failures' },
            },
          );
        }
      };

      context.emit({ type: 'agent_start', agent: 'EncounterImageAgent', message: `Generating images for encounter in ${sceneId}` });

      let imagesGenerated = 0;
      let imagesAttempted = 0;
      const failedImages: string[] = [];

      try {
      // Gather character references and physical descriptions for this encounter
      const encounterCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
        [
          ...(encounter.npcStates?.map(npc => npc.npcId || npc.name).filter(Boolean) || []),
          brief.protagonist.id,
        ],
        characterBible,
        brief,
        `encounter:${scopedSceneId}`
      );
      const referenceImages = this.deps.gatherCharacterReferenceImages(
        encounterCharacterIds,
        characterBible,
        undefined,
        {
          includeExpressions: this.shouldUseExpressionReferencesForEncounter(encounter),
          family: 'encounter-setup',
          slotId: `encounter:${scopedSceneId}`,
        }
      );
      const encounterCharacterDescriptions = this.deps.buildCharacterDescriptions(encounterCharacterIds, characterBible);
      const encounterCharacterNames = encounterCharacterIds
        .map(id => characterBible.characters.find(c => c.id === id)?.name)
        .filter(Boolean) as string[];

      // Use sceneId as encounterId since EncounterStructure.id is optional
      const encounterId = encounter.id || `${sceneId}-encounter`;
      const encounterBeats = getEncounterBeats(encounter);
      const encFirstBeat = encounter.beats?.[0];
      const encounterSettingContext = resolveSceneSettingContext({
        sceneName: sceneId,
        sceneDescription: encFirstBeat?.setupText || encFirstBeat?.description,
        authoredLocationId: undefined,
        authoredLocationName: undefined,
        authoredLocationType: undefined,
        worldPremise: brief.world.premise,
        worldTimePeriod: brief.world.timePeriod,
        worldTechnologyLevel: brief.world.technologyLevel,
        worldMagicSystem: brief.world.magicSystem,
      });
      console.log(`[Pipeline] Encounter ${encounterId}: ${encounterBeats.length} beats, ${encounter.npcStates?.length || 0} NPCs, ${referenceImages.length} reference images`);
      
      // Generate images for each beat (skip if beats is empty/undefined)
      for (const beat of encounterBeats) {
        await this.deps.checkCancellation();
        // Generate setup image — use cinematicSetup if available, otherwise create from setupText or fallback
        // Build characterStates from encounter participants for fallback cinematic descriptions
        const fallbackCharacterStates = [
          { characterId: brief.protagonist.id || 'protagonist', pose: 'ready stance', expression: 'determined', position: 'center frame' },
          ...(encounter.npcStates || []).map(npc => ({
            characterId: npc.npcId || npc.name || 'npc',
            pose: 'facing protagonist',
            expression: npc.initialDisposition || 'neutral',
            position: 'opposite side',
          })),
        ];

        // Ensure we have SOME text for the scene description
        const setupDescription = this.deps.resolvePlayerTemplates(
          this.deps.normalizeNarrativeText(
            (beat as any).setupText ?? (beat as any).description,
            `${(beat as any).name} - ${encounter.encounterType} encounter in ${sceneId}`
          ),
          brief
        );

        const cinematicSetup = (beat as any).cinematicSetup || (setupDescription ? {
          sceneDescription: this.makeEncounterVisualSceneDescription(setupDescription),
          focusSubject: 'protagonist',
          secondaryElements: encounter.npcStates?.map(npc => npc.name || npc.npcId) || [],
          cameraAngle: this.inferEncounterCameraAngle(setupDescription, 'setup'),
          shotType: 'tension_hold' as const,
          mood: this.inferEncounterMood(setupDescription, 'setup'),
          lightingDirection: 'dramatic side lighting',
          colorPalette: 'contextual to genre',
          characterStates: fallbackCharacterStates,
        } : null);
        
        if (cinematicSetup) {
          const setupVisualContract = (beat as any).visualContract || this.buildEncounterVisualContract(setupDescription, 'setup');
          const setupPrompt = this.deps.encounterImageAgent.cinematicDescriptionToPrompt({
            encounterId,
            beatId: beat.id,
            cinematicDescription: cinematicSetup,
            encounterPhase: 'setup',
            visualContract: setupVisualContract,
            genre: brief.story.genre,
            artStyle: context.config.artStyle,
            settingContext: encounterSettingContext,
          });

          console.log(`[Pipeline] Generating encounter setup image for beat ${beat.id} in ${sceneId}`);
          imagesAttempted++;
          const setupBaseId = encounterSetupIdentifier(scopedSceneId, beat.id);
          try {
            const generated = await this.generateEncounterImageWithTextArtifactPolicy(
              setupPrompt,
              setupBaseId,
              { sceneId: scopedSceneId, beatId: beat.id, type: 'encounter-setup', characters: encounterCharacterIds, characterNames: encounterCharacterNames, characterDescriptions: encounterCharacterDescriptions },
              referenceImages.length > 0 ? referenceImages : undefined,
              `setup:${beat.id}`,
              1,
              {
                preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
                resumeCompleted: resumeSet,
                resumeBaseIdentifier: setupBaseId,
                resumeAlternateBaseIdentifiers: [encounterSetupFallbackIdentifier(scopedSceneId, beat.id)],
              },
            );
            const result = generated.result;

            if (result.imageUrl) {
              if (generated.artifactStatus !== 'accepted_clean') {
                console.warn(
                  `[Pipeline] Encounter setup image for beat ${beat.id} accepted with artifact status=${generated.artifactStatus} after ${generated.attempts} attempt(s)`
                );
              }
              setupImages.set(beat.id, result.imageUrl);
              imagesGenerated++;
              globalEncounterImageIndex++;
              encounterPolicy.onSlotSuccess();
              await markResumeDone(setupBaseId);
              context.emit({
                type: 'checkpoint', phase: 'encounter_images',
                message: `Encounter image ${globalEncounterImageIndex} of ~${totalEncounterImages} complete`,
                data: { imageIndex: globalEncounterImageIndex, totalImages: totalEncounterImages, identifier: `encounter-setup-${scopedSceneId}-${beat.id}` },
              });
              if (result.imageData && result.mimeType) {
                this.deps.imageService.setGeminiPreviousScene(result.imageData, result.mimeType);
              }
            } else {
              console.warn(`[Pipeline] Encounter setup image for beat ${beat.id} returned no URL`);
              failedImages.push(`setup:${beat.id}`);
              await onEncounterSlotFailure(new Error('no_image_url'));
            }
          } catch (setupErr) {
            const msg = setupErr instanceof Error ? setupErr.message : String(setupErr);
            console.error(`[Pipeline] Encounter setup image FAILED for beat ${beat.id} in ${sceneId}: ${msg}`);
            failedImages.push(`setup:${beat.id}:${msg}`);
            if (setupErr instanceof PipelineError) throw setupErr;
            await onEncounterSlotFailure(setupErr);
          }

          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
        } else {
          // NEVER skip: always generate with a minimal fallback description
          console.warn(`[Pipeline] No cinematicSetup or setupText for beat ${beat.id} — generating with minimal fallback`);
          const minimalDescription = `${encounter.encounterType || 'dramatic'} encounter scene - ${brief.protagonist.name} in ${sceneId}`;
          const minimalPrompt = this.deps.encounterImageAgent.cinematicDescriptionToPrompt({
            encounterId,
            beatId: beat.id,
            cinematicDescription: {
              sceneDescription: minimalDescription,
              focusSubject: 'protagonist',
              secondaryElements: encounter.npcStates?.map(npc => npc.name || npc.npcId) || [],
              cameraAngle: 'medium shot' as any,
              shotType: 'tension_hold' as const,
              mood: 'tense_uncertainty' as const,
              lightingDirection: 'dramatic side lighting',
              colorPalette: 'contextual to genre',
              characterStates: fallbackCharacterStates,
            },
            encounterPhase: 'setup',
            genre: brief.story.genre,
            artStyle: context.config.artStyle,
            settingContext: encounterSettingContext,
          });
          imagesAttempted++;
          const setupBaseId = encounterSetupIdentifier(scopedSceneId, beat.id);
          const setupFbId = encounterSetupFallbackIdentifier(scopedSceneId, beat.id);
          try {
            const generated = await this.generateEncounterImageWithTextArtifactPolicy(
              minimalPrompt,
              setupFbId,
              { sceneId: scopedSceneId, beatId: beat.id, type: 'encounter-setup', characters: encounterCharacterIds, characterNames: encounterCharacterNames, characterDescriptions: encounterCharacterDescriptions },
              referenceImages.length > 0 ? referenceImages : undefined,
              `setup-fallback:${beat.id}`,
              1,
              {
                preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
                resumeCompleted: resumeSet,
                resumeBaseIdentifier: setupBaseId,
                resumeAlternateBaseIdentifiers: [setupFbId],
              },
            );
            const result = generated.result;
            if (result.imageUrl) {
              if (generated.artifactStatus !== 'accepted_clean') {
                console.warn(
                  `[Pipeline] Encounter fallback setup image for beat ${beat.id} accepted with artifact status=${generated.artifactStatus} after ${generated.attempts} attempt(s)`
                );
              }
              setupImages.set(beat.id, result.imageUrl);
              imagesGenerated++;
              globalEncounterImageIndex++;
              encounterPolicy.onSlotSuccess();
              await markResumeDone(setupBaseId);
              context.emit({
                type: 'checkpoint', phase: 'encounter_images',
                message: `Encounter image ${globalEncounterImageIndex} of ~${totalEncounterImages} complete`,
                data: { imageIndex: globalEncounterImageIndex, totalImages: totalEncounterImages, identifier: `encounter-setup-fallback-${scopedSceneId}-${beat.id}` },
              });
            } else {
              failedImages.push(`setup-fallback:${beat.id}`);
              await onEncounterSlotFailure(new Error('no_image_url'));
            }
          } catch (fallbackErr) {
            const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            console.error(`[Pipeline] Fallback setup image FAILED for beat ${beat.id}: ${msg}`);
            failedImages.push(`setup-fallback:${beat.id}:${msg}`);
            if (fallbackErr instanceof PipelineError) throw fallbackErr;
            await onEncounterSlotFailure(fallbackErr);
          }
          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
        }

        // Generate outcome images for each choice (including recursive nextSituation trees)
        const treeCounters = { imagesGenerated, imagesAttempted, globalIndex: globalEncounterImageIndex, total: totalEncounterImages };
        await this.generateEncounterTreeImages(
          beat.choices || [],
          '',
          sceneId,
          encounterId,
          beat.id,
          {
            referenceImages,
            characterIds: encounterCharacterIds,
            characterNames: encounterCharacterNames,
            characterDescriptions: encounterCharacterDescriptions,
            brief,
            encounter,
            settingContext: encounterSettingContext,
          },
          { setupImages, outcomeImages },
          treeCounters,
          failedImages,
          encounterPolicy,
          resumeSet,
          markResumeDone,
          onEncounterSlotFailure,
          context,
        );
        imagesGenerated = treeCounters.imagesGenerated;
        imagesAttempted = treeCounters.imagesAttempted;
        globalEncounterImageIndex = treeCounters.globalIndex;
        await persistEncounterRunState(
          sceneId,
          `beat:${beat.id}`,
          setupImages,
          outcomeImages,
          failedImages,
          imagesGenerated,
          imagesAttempted,
          [...resumeSet],
          collectMissingSlotsFromManifest(slotManifest, setupImages, outcomeImages),
        );
      }

      // === ENCOUNTER IMAGE RETRY PASS ===
      // Retries run whenever required manifest slots remain unresolved, even if failedImages bookkeeping missed them.
      const preRetryMissing = collectMissingSlotsFromManifest(slotManifest, setupImages, outcomeImages);
      if (preRetryMissing.length > 0) {
        console.log(`[Pipeline] Starting retry pass for ${preRetryMissing.length} unresolved encounter slots in ${sceneId}...`);
        context.emit({ type: 'checkpoint', phase: 'encounter_images', message: `Retrying ${preRetryMissing.length} unresolved encounter slots for ${sceneId}` });

        const retryCounters = { imagesGenerated, imagesAttempted, globalIndex: globalEncounterImageIndex, total: totalEncounterImages };
        let totalRetried = 0;
        let totalRecovered = 0;

        for (const beat of encounterBeats) {
          if (!beat.choices?.length) continue;
          const retryResult = await this.retryMissingEncounterTreeImages(
            beat.choices,
            '',
            sceneId,
            encounterId,
            beat.id,
            {
              referenceImages,
              characterIds: encounterCharacterIds,
              characterNames: encounterCharacterNames,
              characterDescriptions: encounterCharacterDescriptions,
              brief,
              encounter,
              settingContext: encounterSettingContext,
            },
            { setupImages, outcomeImages },
            retryCounters,
            encounterPolicy,
            resumeSet,
            markResumeDone,
            onEncounterSlotFailure,
            context,
          );
          totalRetried += retryResult.retried;
          totalRecovered += retryResult.recovered;
        }

        imagesGenerated = retryCounters.imagesGenerated;
        imagesAttempted = retryCounters.imagesAttempted;
        globalEncounterImageIndex = retryCounters.globalIndex;

        if (totalRetried > 0) {
          console.log(`[Pipeline] Retry pass for ${sceneId}: ${totalRecovered}/${totalRetried} recovered`);
        }
        await persistEncounterRunState(
          sceneId,
          'post-retry',
          setupImages,
          outcomeImages,
          failedImages,
          imagesGenerated,
          imagesAttempted,
          [...resumeSet],
          collectMissingSlotsFromManifest(slotManifest, setupImages, outcomeImages),
        );
      }

      // === ENCOUNTER IMAGE COMPLETENESS CHECK (non-fatal) ===
      // Log missing slots and continue — they are persisted in the run-state
      // file and AssetRegistry for later retry. Storylet generation proceeds
      // regardless so a single missing encounter outcome never kills the pipeline.
      const postRetryMissing = collectMissingSlotsFromManifest(slotManifest, setupImages, outcomeImages);
      if (postRetryMissing.length > 0) {
        const missingSummary = postRetryMissing.slice(0, 20).join(', ');
        const fullMsg = `Encounter ${sceneId}: ${postRetryMissing.length} encounter images still missing after retries (continuing): ${missingSummary}`;
        console.warn(`[Pipeline] ENCOUNTER IMAGE GAP (non-fatal): ${fullMsg}`);
        context.emit({ type: 'warning', phase: 'encounter_images', message: fullMsg });
      }

      encounterImages.set(sceneId, { setupImages, outcomeImages });
      await persistEncounterRunState(
        sceneId,
        'complete',
        setupImages,
        outcomeImages,
        failedImages,
        imagesGenerated,
        imagesAttempted,
        [...resumeSet],
        postRetryMissing,
      );

      const successRate = imagesAttempted > 0 ? `${imagesGenerated}/${imagesAttempted}` : '0/0';
      console.log(`[Pipeline] Encounter images for ${sceneId}: ${successRate} succeeded (${setupImages.size} setup, ${outcomeImages.size} outcome sets)`);

      context.emit({
        type: 'agent_complete',
        agent: 'EncounterImageAgent',
        message: `Generated ${imagesGenerated}/${imagesAttempted} images for encounter in ${sceneId}`,
      });
      } catch (encErr) {
        if (this.deps.isLlmQuotaFailure(encErr)) throw encErr;
        if (encErr instanceof PipelineError) throw encErr;
        const encErrMsg = encErr instanceof Error ? encErr.message : String(encErr);
        const stack = encErr instanceof Error ? encErr.stack : '';
        console.error(`[Pipeline] Encounter image generation CRASHED for ${sceneId}: ${encErrMsg}`);
        console.error(`[Pipeline] Stack: ${stack}`);
        console.error(`[Pipeline] Progress before crash: ${imagesGenerated} generated, ${imagesAttempted} attempted, failures: [${failedImages.join(', ')}]`);
        throw new PipelineError(
          `Encounter image generation crashed for ${sceneId}: ${encErrMsg}`,
          'encounter_images',
          {
            agent: 'EncounterImageAgent',
            context: { sceneId, imagesGenerated, imagesAttempted, failedImages: failedImages.slice(0, 50) },
            originalError: encErr instanceof Error ? encErr : undefined,
          }
        );
      }
    }

    // === STORYLET IMAGES ===
    // Storylets now use the same reliability model as encounter-tree slots:
    // manifest, resume, provider policy, and manifest-based completeness.
    const storyletImages = new Map<string, Map<string, Map<string, string>>>();

    for (const [sceneId, encounter] of encounters) {
      const scopedSceneId = this.deps.getEpisodeScopedSceneId(brief, sceneId);
      const storylets = encounter.storylets;
      if (!storylets) continue;

      const storyletManifest = buildStoryletSlotManifest(storylets, sceneId, scopedSceneId);
      if (storyletManifest.slots.length === 0) continue;

      const sceneStoryletImages = new Map<string, Map<string, string>>();
      const encounterCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
        Array.from(new Set([...(encounter.npcStates?.map(npc => npc.npcId || npc.name).filter(Boolean) || []), brief.protagonist.id])),
        characterBible,
        brief,
        `storylet:${scopedSceneId}`
      );
      const referenceImages = this.deps.gatherCharacterReferenceImages(
        encounterCharacterIds,
        characterBible,
        undefined,
        {
          includeExpressions: this.shouldUseExpressionReferencesForEncounter(encounter),
          family: 'storylet-aftermath',
          slotId: `storylet:${scopedSceneId}`,
        }
      );
      const encounterCharacterDescriptions = this.deps.buildCharacterDescriptions(encounterCharacterIds, characterBible);
      const encounterCharacterNames = encounterCharacterIds
        .map(id => characterBible.characters.find(c => c.id === id)?.name)
        .filter(Boolean) as string[];
      const storyletFirstBeat = encounter.beats?.[0];
      const encounterSettingContext = resolveSceneSettingContext({
        sceneName: sceneId,
        sceneDescription: storyletFirstBeat?.setupText || storyletFirstBeat?.description,
        authoredLocationId: undefined,
        authoredLocationName: undefined,
        authoredLocationType: undefined,
        worldPremise: brief.world.premise,
        worldTimePeriod: brief.world.timePeriod,
        worldTechnologyLevel: brief.world.technologyLevel,
        worldMagicSystem: brief.world.magicSystem,
      });

      const resumeLoaded = outputDirectory ? loadEncounterResumeStateSync(outputDirectory, idSlugify(sceneId)) : null;
      const resumeSet = new Set<string>(resumeLoaded?.completedBaseIdentifiers ?? []);
      const persistResume = async (): Promise<void> => {
        if (!outputDirectory) return;
        await saveEncounterResumeState(outputDirectory, idSlugify(sceneId), {
          version: 1,
          sceneId,
          scopedSceneId,
          completedBaseIdentifiers: [...resumeSet],
          generatedAt: new Date().toISOString(),
        });
      };
      const markResumeDone = async (baseId: string): Promise<void> => {
        if (!resumeSet.has(baseId)) {
          resumeSet.add(baseId);
          await persistResume();
        }
      };

      const storyletPolicy = new EncounterProviderPolicy(this.deps.imageService, {
        maxConsecutiveFailuresBeforeAbort: context.config.imageGen?.encounterMaxConsecutiveFailuresBeforeAbort ?? 0,
      });
      const onStoryletSlotFailure = async (err: unknown): Promise<void> => {
        storyletPolicy.onSlotFailure(err);
        const d = storyletPolicy.getBackoffDelayMs();
        if (d > 0) await new Promise(r => setTimeout(r, d));
        if (storyletPolicy.shouldAbortHard()) {
          throw new PipelineError(
            `Storylet image generation aborted after repeated failures for ${sceneId}`,
            'encounter_images',
            {
              agent: 'EncounterImageAgent',
              context: { sceneId, encounterId: encounter.id || `${sceneId}-encounter`, failureKind: 'storylet_consecutive_failures' },
            },
          );
        }
      };

      const toneMoodMap: Record<string, string> = {
        triumphant: 'victorious, triumphant aftermath, warm heroic lighting',
        bittersweet: 'quiet bittersweet aftermath, mixed emotions, muted tones',
        tense: 'tense uneasy aftermath, characters still on edge, harsh shadows',
        desperate: 'desperate failed aftermath, exhausted and defeated, cold dark tones',
        relieved: 'relieved escape aftermath, barely survived, shaky breath',
        somber: 'somber defeated aftermath, heavy silence, dark desaturated palette',
      };
      const partialVictoryStoryletCost = storylets.partialVictory?.cost;

      const persistStoryletRunState = async (phase: string): Promise<void> => {
        if (!outputDirectory) return;
        await saveEarlyDiagnostic(outputDirectory, `08a-storylet-run-state-${idSlugify(sceneId)}.json`, {
          generatedAt: new Date().toISOString(),
          sceneId,
          phase,
          completedBaseIdentifiers: [...resumeSet].slice(-300),
          outcomes: Array.from(sceneStoryletImages.entries()).map(([outcomeName, beatImages]) => ({
            outcomeName,
            beatIds: Array.from(beatImages.keys()),
          })),
          missingCoverageKeys: collectMissingStoryletSlotsFromManifest(storyletManifest, sceneStoryletImages).slice(0, 100),
        });
      };

      const getOutcomeBeatImages = (outcomeName: string): Map<string, string> => {
        const existing = sceneStoryletImages.get(outcomeName);
        if (existing) return existing;
        const created = new Map<string, string>();
        sceneStoryletImages.set(outcomeName, created);
        return created;
      };

      const buildStoryletPrompt = (
        slot: StoryletSlot,
        stage: 'primary' | 'retry' | 'aggressive',
      ): ImagePrompt => {
        const beatDesc = this.deps.resolvePlayerTemplates(
          this.deps.normalizeNarrativeText(slot.beat.text ?? '', `${slot.outcomeName} aftermath`),
          brief
        );
        const sanitizedBeatDesc = this.deps.scrubPromptArtifacts(beatDesc);
        const visualContract = (slot.beat.visualContract as any) || this.buildEncounterVisualContract(sanitizedBeatDesc, 'resolution');
        const costForSlot = (slot.beat.cost || slot.storyletCost || partialVictoryStoryletCost) as any;
        if (slot.outcomeName === 'partialVictory' && costForSlot && !visualContract.visibleCost) {
          visualContract.visibleCost = costForSlot?.visibleComplication;
        }
        const aggressive = stage !== 'primary';
        const tone = slot.storyletTone;
        return this.deps.sanitizeImagePrompt(this.deps.encounterImageAgent.cinematicDescriptionToPrompt({
          encounterId: encounter.id || `${sceneId}-encounter`,
          beatId: slot.beatId,
          encounterPhase: 'resolution',
          outcomeType: slot.outcomeName as EncounterOutcome,
          cost: slot.outcomeName === 'partialVictory' ? costForSlot : undefined,
          cinematicDescription: {
            sceneDescription: sanitizedBeatDesc,
            focusSubject: brief.protagonist.name,
            secondaryElements: aggressive ? encounterCharacterNames.filter(name => name !== brief.protagonist.name).slice(0, 2) : encounterCharacterNames.filter(name => name !== brief.protagonist.name),
            cameraAngle: 'reaction_shot',
            shotType: 'consequence',
            mood: aggressive
              ? 'tense_uncertainty'
              : tone === 'triumphant' ? 'triumphant' : tone === 'relieved' ? 'relief' : tone === 'somber' ? 'desperate' : 'tense_uncertainty',
            lightingDirection: toneMoodMap[tone] || 'dramatic aftermath',
            colorPalette: aggressive ? 'muted aftermath tones' : 'storylet aftermath palette grounded in the encounter tone',
            characterStates: [
              {
                characterId: brief.protagonist.id || 'protagonist',
                pose: aggressive ? 'aftermath posture' : 'after the decisive turn',
                expression: aggressive ? 'processing the cost' : tone,
                position: 'center frame'
              },
            ],
          },
          visualContract,
          genre: brief.story.genre,
          artStyle: context.config.artStyle,
          settingContext: encounterSettingContext,
        }), brief);
      };

      const attemptStoryletSlot = async (
        slot: StoryletSlot,
        stage: 'primary' | 'retry' | 'aggressive',
        pass: number = 0,
      ): Promise<void> => {
        const beatImages = getOutcomeBeatImages(slot.outcomeName);
        if (beatImages.has(slot.beatId)) return;

        const identifier = stage === 'primary'
          ? slot.baseIdentifier
          : stage === 'retry'
            ? storyletRetryIdentifier(scopedSceneId, slot.outcomeName, slot.beatId)
            : storyletAggressiveRetryIdentifier(scopedSceneId, slot.outcomeName, slot.beatId, pass);
        const qaIdentifier = stage === 'primary'
          ? `storylet:${scopedSceneId}:${slot.outcomeName}:${slot.beatId}`
          : stage === 'retry'
            ? `retry:storylet:${scopedSceneId}:${slot.outcomeName}:${slot.beatId}`
            : `retry2:storylet:${scopedSceneId}:${slot.outcomeName}:${slot.beatId}:${pass}`;
        const prompt = buildStoryletPrompt(slot, stage);

        try {
          const generated = await this.generateEncounterImageWithTextArtifactPolicy(
            prompt,
            identifier,
            {
              sceneId: scopedSceneId,
              beatId: slot.beatId,
              type: 'storylet-aftermath',
              outcomeType: slot.outcomeName as EncounterOutcome,
              characters: encounterCharacterIds,
              characterNames: encounterCharacterNames,
              characterDescriptions: encounterCharacterDescriptions,
            },
            referenceImages.length > 0 ? referenceImages : undefined,
            qaIdentifier,
            1,
            {
              preferAtlasFirst: storyletPolicy.consumePreferAtlasFirst(),
              resumeCompleted: resumeSet,
              resumeBaseIdentifier: slot.baseIdentifier,
              resumeAlternateBaseIdentifiers: identifier === slot.baseIdentifier ? undefined : [identifier],
            },
          );

          if (generated.result.imageUrl) {
            beatImages.set(slot.beatId, generated.result.imageUrl);
            globalEncounterImageIndex++;
            storyletPolicy.onSlotSuccess();
            await markResumeDone(slot.baseIdentifier);
            context.emit({
              type: 'checkpoint',
              phase: 'encounter_images',
              message: `Encounter image ${globalEncounterImageIndex} of ~${totalEncounterImages} complete`,
              data: { imageIndex: globalEncounterImageIndex, totalImages: totalEncounterImages, identifier },
            });
          } else {
            await onStoryletSlotFailure(new Error('no_image_url'));
          }
        } catch (err) {
          if (err instanceof PipelineError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Pipeline] Storylet image failed for ${sceneId}/${slot.outcomeName}/${slot.beatId}: ${msg}`);
          context.emit({ type: 'warning', phase: 'encounter_images', message: `Storylet image failed for ${sceneId}/${slot.outcomeName}/${slot.beatId}: ${msg}` });
          await onStoryletSlotFailure(err);
        }

        await new Promise(resolve => setTimeout(resolve, stage === 'aggressive' ? TIMING_DEFAULTS.rateLimitDelayMs * 2 : TIMING_DEFAULTS.rateLimitDelayMs));
      };

      for (const slot of storyletManifest.slots) {
        await attemptStoryletSlot(slot, 'primary');
      }
      await persistStoryletRunState('primary');

      let missingSlots = storyletManifest.slots.filter(slot => !sceneStoryletImages.get(slot.outcomeName)?.has(slot.beatId));
      if (missingSlots.length > 0) {
        console.log(`[Pipeline] Retrying ${missingSlots.length} missing storylet images for ${sceneId}`);
        for (const slot of missingSlots) {
          await attemptStoryletSlot(slot, 'retry');
        }
        await persistStoryletRunState('retry');
      }

      for (let pass = 0; pass < 2; pass++) {
        missingSlots = storyletManifest.slots.filter(slot => !sceneStoryletImages.get(slot.outcomeName)?.has(slot.beatId));
        if (missingSlots.length === 0) break;
        console.warn(`[Pipeline] ${missingSlots.length} storylet images still missing for ${sceneId} after retry — aggressive pass ${pass + 1}`);
        for (const slot of missingSlots) {
          await attemptStoryletSlot(slot, 'aggressive', pass);
        }
        await persistStoryletRunState(`aggressive-${pass + 1}`);
      }

      // Last-resort recovery: for any slots still missing after all retries,
      // generate with a drastically simplified prompt, no reference images,
      // and no QA validation. This ensures every storylet beat gets an image.
      const recoverySlots = storyletManifest.slots.filter(slot => !sceneStoryletImages.get(slot.outcomeName)?.has(slot.beatId));
      if (recoverySlots.length > 0) {
        console.warn(`[Pipeline] ${recoverySlots.length} storylet images still missing for ${sceneId} — running last-resort recovery`);
        for (const slot of recoverySlots) {
          const beatImages = getOutcomeBeatImages(slot.outcomeName);
          if (beatImages.has(slot.beatId)) continue;
          const beatDesc = this.deps.resolvePlayerTemplates(
            this.deps.normalizeNarrativeText(slot.beat.text ?? '', `${slot.outcomeName} aftermath`),
            brief
          );
          const tone = slot.storyletTone;
          const moodHint = toneMoodMap[tone] || 'dramatic aftermath';
          const artStyle = context.config.artStyle || 'cinematic illustration';
          const recoveryPromptText = `${artStyle} style. ${moodHint}. ${beatDesc.slice(0, 300)}`;
          const recoveryPrompt: ImagePrompt = this.deps.sanitizeImagePrompt({
            prompt: recoveryPromptText,
            style: artStyle,
            aspectRatio: '16:9',
          }, brief);
          const recoveryId = sanitizeEncounterIdentifier(`storylet-${scopedSceneId}-${slot.outcomeName}-${slot.beatId}-recovery`);
          try {
            const result = await withTimeout(this.deps.imageService.generateImage(
              recoveryPrompt,
              recoveryId,
              {
                sceneId: scopedSceneId,
                beatId: slot.beatId,
                type: 'storylet-aftermath',
                characters: encounterCharacterIds,
                characterNames: encounterCharacterNames,
                characterDescriptions: encounterCharacterDescriptions,
              },
              undefined,
            ), PIPELINE_TIMEOUTS.imageGeneration, `storyletRecovery(${recoveryId})`);
            if (result.imageUrl) {
              beatImages.set(slot.beatId, result.imageUrl);
              globalEncounterImageIndex++;
              storyletPolicy.onSlotSuccess();
              await markResumeDone(slot.baseIdentifier);
              console.log(`[Pipeline] Storylet recovery succeeded for ${sceneId}/${slot.outcomeName}/${slot.beatId}`);
              context.emit({
                type: 'checkpoint', phase: 'encounter_images',
                message: `Encounter image ${globalEncounterImageIndex} of ~${totalEncounterImages} complete (recovery)`,
                data: { imageIndex: globalEncounterImageIndex, totalImages: totalEncounterImages, identifier: recoveryId },
              });
            } else {
              console.error(`[Pipeline] Storylet recovery returned no URL for ${sceneId}/${slot.outcomeName}/${slot.beatId}`);
            }
          } catch (recoveryErr) {
            const msg = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
            console.error(`[Pipeline] Storylet recovery FAILED for ${sceneId}/${slot.outcomeName}/${slot.beatId}: ${msg}`);
          }
          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
        }
        await persistStoryletRunState('recovery');
      }

      const finalMissingKeys = collectMissingStoryletSlotsFromManifest(storyletManifest, sceneStoryletImages);
      if (finalMissingKeys.length > 0) {
        const missingByOutcome = new Map<string, string[]>();
        for (const slot of storyletManifest.slots) {
          if (sceneStoryletImages.get(slot.outcomeName)?.has(slot.beatId)) continue;
          const existing = missingByOutcome.get(slot.outcomeName) || [];
          existing.push(slot.beatId);
          missingByOutcome.set(slot.outcomeName, existing);
        }
        for (const [outcomeName, beatIds] of missingByOutcome) {
          const msg = `Storylet ${sceneId}/${outcomeName}: ${beatIds.length} beats still missing images after all retries + recovery: ${beatIds.join(', ')}`;
          console.error(`[Pipeline] STORYLET IMAGE FAILURE: ${msg}`);
          context.emit({ type: 'error', phase: 'encounter_images', message: msg });
          storyletFailures.push(msg);
        }
      }

      if (sceneStoryletImages.size > 0) {
        storyletImages.set(sceneId, sceneStoryletImages);
      }
    }

    context.emit({ type: 'phase_complete', phase: 'encounter_images', message: `Encounter image generation complete` });

    return { encounterImages, storyletImages, storyletFailures };
  }

  /**
   * Recursively generate outcome images for an encounter choice tree.
   * Traverses choices → outcomes → nextSituation → choices → ... producing
   * an image for every outcome and every nested situation node.
   */
  private async generateEncounterTreeImages(
    choices: Array<{ id: string; text?: string; outcomes?: Record<string, any> }>,
    pathPrefix: string,
    sceneId: string,
    encounterId: string,
    beatId: string,
    context: {
      referenceImages: ReferenceImage[];
      characterIds: string[];
      characterNames: string[];
      characterDescriptions: CharacterAppearanceDescription[];
      brief: FullCreativeBrief;
      encounter: EncounterStructure;
      settingContext?: SceneSettingContext;
    },
    maps: {
      setupImages: Map<string, string>;
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
    },
    counters: { imagesGenerated: number; imagesAttempted: number; globalIndex: number; total: number },
    failedImages: string[],
    encounterPolicy: EncounterProviderPolicy,
    resumeSet: Set<string>,
    markResumeDone: (baseId: string) => Promise<void>,
    onEncounterSlotFailure: (err: unknown) => Promise<void>,
    pipelineContext: PipelineContext,
    depth: number = 0,
  ): Promise<void> {
    if (depth > ENCOUNTER_TREE_MAX_DEPTH) {
      console.warn(`[Pipeline] Encounter tree depth limit (${ENCOUNTER_TREE_MAX_DEPTH}) reached at ${pathPrefix} — skipping deeper nodes`);
      return;
    }

    const { referenceImages, characterIds, characterNames, characterDescriptions, brief, encounter, settingContext } = context;
    const scopedSceneId = this.deps.getEpisodeScopedSceneId(brief, sceneId);

    const makeFallbackCinematic = (narrativeText: string | undefined, tier: 'success' | 'complicated' | 'failure') => {
      if (!narrativeText) return null;
      const moodMap = { success: 'triumphant' as const, complicated: 'tense_uncertainty' as const, failure: 'desperate' as const };
      const expressionMap = { success: 'triumphant', complicated: 'strained', failure: 'pained' };
      const poseMap = { success: 'victorious follow-through', complicated: 'bracing', failure: 'recoiling' };
      return {
        sceneDescription: this.makeEncounterVisualSceneDescription(narrativeText),
        focusSubject: 'protagonist',
        secondaryElements: encounter.npcStates?.map(npc => npc.name || npc.npcId) || [],
        cameraAngle: this.inferEncounterCameraAngle(narrativeText, tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising'),
        shotType: 'consequence' as const,
        mood: this.inferEncounterMood(narrativeText, tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising') || moodMap[tier],
        lightingDirection: tier === 'success' ? 'warm front lighting' : tier === 'failure' ? 'harsh side lighting' : 'neutral fill',
        colorPalette: tier === 'success' ? 'warm tones' : tier === 'failure' ? 'cold desaturated' : 'muted mixed',
        characterStates: [
          { characterId: brief.protagonist.id || 'protagonist', pose: poseMap[tier], expression: expressionMap[tier], position: 'center frame' },
          ...(encounter.npcStates || []).map(npc => ({
            characterId: npc.npcId || npc.name || 'npc',
            pose: tier === 'success' ? 'staggering back' : tier === 'failure' ? 'pressing advantage' : 'locked in struggle',
            expression: tier === 'success' ? 'shocked' : tier === 'failure' ? 'confident' : 'straining',
            position: 'opposite side',
          })),
        ],
      };
    };

    for (const choice of choices) {
      if (!choice.outcomes) continue;

      const choiceMapKey = pathPrefix ? `${pathPrefix}::${choice.id}` : choice.id;
      const choiceOutcomes: { success?: string; complicated?: string; failure?: string } = {};
      let previousOutcomeTier: 'success' | 'complicated' | 'failure' | undefined;

      for (const tier of ['success', 'complicated', 'failure'] as const) {
        await this.deps.checkCancellation();
        const outcomeData = choice.outcomes[tier];
        if (!outcomeData) continue;

        const outcomeText = this.deps.resolvePlayerTemplates(
          this.deps.normalizeNarrativeText(
            outcomeData.narrativeText,
            `${this.deps.normalizeNarrativeText(choice.text, 'choice')} - ${tier} result`
          ),
          brief
        );
        const outcomeVisualContract = outcomeData.visualContract || this.buildEncounterVisualContract(
          outcomeText,
          tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising'
        );
        if (outcomeData.encounterOutcome === 'partialVictory' && outcomeData.cost && !outcomeVisualContract.visibleCost) {
          outcomeVisualContract.visibleCost = outcomeData.cost.visibleComplication;
        }

        const cinematic = outcomeData.cinematicDescription
          || makeFallbackCinematic(outcomeText, tier)
          || makeFallbackCinematic(`${encounter.encounterType || 'dramatic'} encounter - ${tier} outcome for ${brief.protagonist.name}`, tier)!;

        const outcomeBaseId = encounterOutcomeIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
        counters.imagesAttempted++;
        try {
          const outcomePrompt = this.deps.encounterImageAgent.cinematicDescriptionToPrompt({
            encounterId,
            beatId,
            choiceId: choiceMapKey,
            outcomeTier: tier,
            outcomeType: outcomeData.encounterOutcome,
            cost: outcomeData.cost,
            cinematicDescription: cinematic,
            encounterPhase: tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising',
            previousOutcomeTier,
            visualContract: outcomeVisualContract,
            genre: brief.story.genre,
            artStyle: pipelineContext.config.artStyle,
            settingContext,
          });

          const generated = await this.generateEncounterImageWithTextArtifactPolicy(
            outcomePrompt,
            outcomeBaseId,
            { sceneId: scopedSceneId, beatId, choiceId: choiceMapKey, type: 'encounter-outcome', tier, outcomeType: outcomeData.encounterOutcome, characters: characterIds, characterNames, characterDescriptions },
            referenceImages.length > 0 ? referenceImages : undefined,
            `${tier}:${beatId}:${choiceMapKey}`,
            1,
            {
              preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
              resumeCompleted: resumeSet,
              resumeBaseIdentifier: outcomeBaseId,
            },
          );
          const result = generated.result;

          if (result.imageUrl) {
            if (generated.artifactStatus !== 'accepted_clean') {
              console.warn(
                `[Pipeline] Encounter ${tier} image for ${choiceMapKey} accepted with artifact status=${generated.artifactStatus} after ${generated.attempts} attempt(s)`
              );
            }
            choiceOutcomes[tier] = result.imageUrl;
            counters.imagesGenerated++;
            counters.globalIndex++;
            encounterPolicy.onSlotSuccess();
            await markResumeDone(outcomeBaseId);
            pipelineContext.emit({
              type: 'checkpoint', phase: 'encounter_images',
              message: `Encounter image ${counters.globalIndex} of ~${counters.total} complete (depth ${depth})`,
              data: { imageIndex: counters.globalIndex, totalImages: counters.total, identifier: outcomeBaseId },
            });
            previousOutcomeTier = tier;
          } else {
            failedImages.push(`${tier}:${choiceMapKey}`);
            await onEncounterSlotFailure(new Error('no_image_url'));
          }
        } catch (outcomeErr) {
          const msg = outcomeErr instanceof Error ? outcomeErr.message : String(outcomeErr);
          console.error(`[Pipeline] Encounter ${tier} image FAILED for ${choiceMapKey} in ${sceneId}: ${msg}`);
          failedImages.push(`${tier}:${choiceMapKey}:${msg}`);
          if (outcomeErr instanceof PipelineError) throw outcomeErr;
          await onEncounterSlotFailure(outcomeErr);
        }

        await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));

        // Recurse into nextSituation if present
        const nextSituation = outcomeData.nextSituation;
        if (nextSituation && nextSituation.choices && nextSituation.choices.length > 0) {
          const situationKey = encounterSituationKey(beatId, choiceMapKey, tier);
          const legacySituationKey = legacyEncounterSituationKey(choiceMapKey, tier);
          const sitText = this.deps.resolvePlayerTemplates(
            this.deps.normalizeNarrativeText(
              nextSituation.setupText,
              `Next situation after ${tier} outcome`
            ),
            brief
          );

          const sitCinematic = nextSituation.cinematicSetup || {
            sceneDescription: this.makeEncounterVisualSceneDescription(sitText),
            focusSubject: 'protagonist',
            secondaryElements: encounter.npcStates?.map(npc => npc.name || npc.npcId) || [],
            cameraAngle: this.inferEncounterCameraAngle(sitText, 'setup'),
            shotType: 'tension_hold' as const,
            mood: this.inferEncounterMood(sitText, 'setup'),
            lightingDirection: 'dramatic side lighting',
            colorPalette: 'contextual to genre',
            characterStates: [
              { characterId: brief.protagonist.id || 'protagonist', pose: 'ready stance', expression: 'determined', position: 'center frame' },
              ...(encounter.npcStates || []).map(npc => ({
                characterId: npc.npcId || npc.name || 'npc',
                pose: 'facing protagonist',
                expression: npc.initialDisposition || 'neutral',
                position: 'opposite side',
              })),
            ],
          };

          const sitBaseId = encounterSituationIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
          const legacySitBaseId = legacyEncounterSituationIdentifier(scopedSceneId, choiceMapKey, tier);
          counters.imagesAttempted++;
          try {
            const sitVisualContract = nextSituation.visualContract || this.buildEncounterVisualContract(sitText, 'setup');
            const sitPrompt = this.deps.encounterImageAgent.cinematicDescriptionToPrompt({
              encounterId,
              beatId,
              cinematicDescription: sitCinematic,
              encounterPhase: 'setup',
              visualContract: sitVisualContract,
              genre: brief.story.genre,
              artStyle: pipelineContext.config.artStyle,
              settingContext,
            });

            const generated = await this.generateEncounterImageWithTextArtifactPolicy(
              sitPrompt,
              sitBaseId,
              { sceneId: scopedSceneId, beatId, type: 'encounter-setup', characters: characterIds, characterNames, characterDescriptions },
              referenceImages.length > 0 ? referenceImages : undefined,
              `situation:${choiceMapKey}::${tier}`,
              1,
              {
                preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
                resumeCompleted: resumeSet,
                resumeBaseIdentifier: sitBaseId,
                resumeAlternateBaseIdentifiers: [legacySitBaseId],
              },
            );

            if (generated.result.imageUrl) {
              maps.setupImages.set(situationKey, generated.result.imageUrl);
              maps.setupImages.set(legacySituationKey, generated.result.imageUrl);
              counters.imagesGenerated++;
              counters.globalIndex++;
              encounterPolicy.onSlotSuccess();
              await markResumeDone(sitBaseId);
              pipelineContext.emit({
                type: 'checkpoint', phase: 'encounter_images',
                message: `Encounter image ${counters.globalIndex} of ~${counters.total} complete (situation depth ${depth + 1})`,
                data: { imageIndex: counters.globalIndex, totalImages: counters.total, identifier: sitBaseId },
              });
              if (generated.result.imageData && generated.result.mimeType) {
                this.deps.imageService.setGeminiPreviousScene(generated.result.imageData, generated.result.mimeType);
              }
            } else {
              failedImages.push(`situation:${choiceMapKey}::${tier}`);
              await onEncounterSlotFailure(new Error('no_image_url'));
            }
          } catch (sitErr) {
            const msg = sitErr instanceof Error ? sitErr.message : String(sitErr);
            console.error(`[Pipeline] Encounter situation image FAILED for ${situationKey} in ${sceneId}: ${msg}`);
            failedImages.push(`situation:${situationKey}:${msg}`);
            if (sitErr instanceof PipelineError) throw sitErr;
            await onEncounterSlotFailure(sitErr);
          }

          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));

          // Recurse into the nextSituation's choices
          const nestedPathPrefix = `${choiceMapKey}::${tier}`;
          console.log(`[Pipeline] Recursing into nextSituation at depth ${depth + 1}: ${nestedPathPrefix} (${nextSituation.choices.length} choices)`);
          await this.generateEncounterTreeImages(
            nextSituation.choices,
            nestedPathPrefix,
            sceneId,
            encounterId,
            beatId,
            context,
            maps,
            counters,
            failedImages,
            encounterPolicy,
            resumeSet,
            markResumeDone,
            onEncounterSlotFailure,
            pipelineContext,
            depth + 1,
          );
        }
      }

      if (Object.keys(choiceOutcomes).length > 0) {
        maps.outcomeImages.set(choiceMapKey, choiceOutcomes);
      }
    }
  }

  /**
   * Shared QA check for encounter images: validates text artifacts using Gemini vision.
   * Returns the validated image result, or null if the image fails QA and retry also fails.
   * Applies the same minimum QA that episode images receive.
   */
  private async validateEncounterImage(
    result: { imageUrl?: string; imageData?: string; mimeType?: string },
    identifier: string,
    prompt?: ImagePrompt,
    metadata?: {
      sceneId: string;
      beatId: string;
      type: 'encounter-setup' | 'encounter-outcome' | 'storylet-aftermath';
      characters: string[];
      characterNames: string[];
      characterDescriptions: CharacterAppearanceDescription[];
      choiceId?: string;
      tier?: 'success' | 'complicated' | 'failure';
      outcomeType?: EncounterOutcome;
    },
    allowDiegeticText: boolean = false,
    maxRetries: number = 2
  ): Promise<{ passed: boolean; result: typeof result }> {
    if (!result.imageData || !result.mimeType) {
      return { passed: true, result };
    }

    const textCheck = await withTimeout(this.deps.imageService.checkImageForTextArtifacts(
      result.imageData,
      result.mimeType,
      allowDiegeticText
    ), PIPELINE_TIMEOUTS.imageGeneration, `textArtifactCheck(${identifier})`);

    if (!textCheck.hasText) {
      // Continue to visual readability checks below.
    } else {
      console.warn(`[Pipeline] Encounter image ${identifier} has text artifact: ${textCheck.description}. Will be flagged for observability.`);
      return { passed: false, result };
    }

    if (!prompt || !metadata) {
      return { passed: true, result };
    }

    const focalCharacterName = metadata.characterNames[0] || 'protagonist';
    const focalEmotion = prompt.emotionalCore || prompt.keyExpression || 'determined tension';
    const expressionTargets = prompt.keyExpression || prompt.emotionalCore ? [{
      characterName: focalCharacterName,
      emotion: focalEmotion,
      intensity: metadata.type === 'encounter-outcome' ? 'intense' as const : 'moderate' as const,
      reason: prompt.visualNarrative || prompt.prompt,
    }] : [];

    const actingTargets = prompt.keyBodyLanguage || prompt.keyGesture ? [{
      characterName: focalCharacterName,
      intent: metadata.type === 'encounter-outcome'
        ? (metadata.tier === 'failure' ? 'protect_self' : metadata.tier === 'success' ? 'challenge' : 'process')
        : 'observe',
      primaryEmotion: focalEmotion,
      intensity: metadata.type === 'encounter-outcome' ? 'intense' as const : 'moderate' as const,
      status: metadata.type === 'encounter-outcome' && metadata.tier === 'success' ? 'dominant' as const : 'equal' as const,
      relationalStance: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'guarded' as const : 'open' as const,
      spatialRelation: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'withdrawing' as const : 'approaching' as const,
      bodyLanguage: {
        spine: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'curved_forward' : 'upright',
        shoulderState: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'raised_tense' : 'open_tense',
        chestDirection: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'closed_inward' : 'open_forward',
        weightDistribution: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'back' : 'forward',
        stanceWidth: metadata.type === 'encounter-outcome' ? 'wide_confident' : 'normal',
        feetDirection: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'away_from_target' : 'toward_target',
        headPosition: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'chin_down' : 'chin_up',
        neckTension: 'tense',
        gazeDirection: metadata.type === 'encounter-outcome' && metadata.tier === 'failure' ? 'averted' : 'direct_contact',
        armPosition: prompt.keyGesture?.includes('reach') ? 'reaching_out' : 'gesturing',
        handState: prompt.keyGesture?.includes('grip') ? 'gripping_object' : 'gesturing_emphatic',
        gestureSize: metadata.type === 'encounter-outcome' ? 'moderate' : 'small_contained',
        spatialDistance: metadata.characterNames.length > 1 ? 'personal' : undefined,
        bodyOrientation: metadata.characterNames.length > 1 ? 'angled_toward' : undefined,
      },
      reason: prompt.keyBodyLanguage || prompt.keyGesture,
    }] : [];

    const hardFailures: string[] = [];

    if (metadata?.outcomeType === 'partialVictory') {
      if (!prompt?.prompt?.toLowerCase().includes('partial victory rule')) {
        hardFailures.push('partialVictory prompt is missing costly-success guardrails');
      }
      if (!prompt?.prompt?.toLowerCase().includes('visible complication')) {
        hardFailures.push('partialVictory prompt does not describe the visible cost');
      }
    }

    if (expressionTargets.length > 0) {
      const expressionCheck = await this.deps.imageAgentTeam.validateExpressions(
        identifier,
        result.imageData,
        result.mimeType,
        expressionTargets as any,
        prompt.emotionalCore,
        false
      );
      if (expressionCheck.success && expressionCheck.data && !expressionCheck.data.isAcceptable) {
        hardFailures.push(`expression readability: ${expressionCheck.data.issues.join(', ')}`);
      }
    }

    if (actingTargets.length > 0) {
      const bodyCheck = await this.deps.imageAgentTeam.validateBodyLanguage(
        identifier,
        result.imageData,
        result.mimeType,
        actingTargets as any,
        {
          expectedPowerDynamic: metadata.type === 'encounter-outcome' ? 'shifting' : 'balanced',
          expectedEmotionalDistance: metadata.characterNames.length > 1 ? 'close' : 'neutral',
          isConflictScene: metadata.type !== 'storylet-aftermath',
        }
      );
      if (bodyCheck.success && bodyCheck.data && !bodyCheck.data.isAcceptable) {
        hardFailures.push(`body language: ${bodyCheck.data.issues.join(', ')}`);
      }
    }

    const storyCheck = await this.deps.imageAgentTeam.validateVisualStorytelling(
      identifier,
      result.imageData,
      result.mimeType,
      {
        beatId: metadata.beatId,
        clarity: 'instant_read',
        pacing: metadata.type === 'encounter-outcome' ? 'peak' : metadata.type === 'storylet-aftermath' ? 'aftermath' : 'hold',
        choiceTelegraph: prompt.visualNarrative || prompt.prompt,
      } as any,
      undefined,
      undefined,
      undefined,
      { action: prompt.keyGesture || prompt.visualNarrative || prompt.prompt, emotion: focalEmotion },
      undefined
    );
    if (storyCheck.success && storyCheck.data && !storyCheck.data.isAcceptable) {
      hardFailures.push(`storytelling clarity: ${storyCheck.data.criticalIssues.join(', ')}`);
    }

    if (hardFailures.length > 0) {
      console.warn(`[Pipeline] Encounter image ${identifier} failed visual QA: ${hardFailures.join(' | ')}`);
      return { passed: false, result };
    }

    return { passed: true, result };
  }

  private strengthenPromptForTextArtifacts(prompt: ImagePrompt, attempt: number): ImagePrompt {
    const strengthened = { ...prompt };
    const banTextDirective =
      attempt === 0
        ? 'Do not overlay any narrative text, dialog, captions, sound effects, or onomatopoeia on the image. Text on in-world objects (signs, clothing, screens) is fine.'
        : 'CRITICAL: absolutely no narrative text, dialog, speech bubbles, captions, sound effects, or onomatopoeia overlaid on the image.';
    strengthened.prompt = `${this.deps.scrubPromptArtifacts(strengthened.prompt || '')} ${banTextDirective}`.trim();
    strengthened.negativePrompt = `${strengthened.negativePrompt || ''}, caption text, dialog text, narrative text, speech bubbles, thought bubbles, sound effect text, onomatopoeia, chapter title, character name labels, credits, watermarks`.trim();
    return strengthened;
  }

  private async generateEncounterImageWithTextArtifactPolicy(
    prompt: ImagePrompt,
    identifier: string,
    metadata: {
      sceneId: string;
      beatId: string;
      type: 'encounter-setup' | 'encounter-outcome' | 'storylet-aftermath';
      characters: string[];
      characterNames: string[];
      characterDescriptions: CharacterAppearanceDescription[];
      choiceId?: string;
      tier?: 'success' | 'complicated' | 'failure';
      outcomeType?: EncounterOutcome;
    },
    referenceImages: ReferenceImage[] | undefined,
    qaIdentifier: string,
    maxTextArtifactRetries = 1,
    encounterGenOptions?: {
      preferAtlasFirst?: boolean;
      resumeCompleted?: Set<string>;
      resumeBaseIdentifier?: string;
      resumeAlternateBaseIdentifiers?: string[];
    }
  ): Promise<{
    result: GeneratedImage;
    artifactStatus: 'accepted_clean' | 'accepted_after_retry' | 'accepted_with_artifact';
    attempts: number;
    resolvedIdentifier: string;
  }> {
    if (
      encounterGenOptions?.resumeBaseIdentifier &&
      encounterGenOptions.resumeCompleted?.has(encounterGenOptions.resumeBaseIdentifier)
    ) {
      const tryIds = [
        identifier,
        ...(encounterGenOptions.resumeAlternateBaseIdentifiers || []),
      ];
      for (const cand of tryIds) {
        const existing = this.deps.imageService.findExistingGeneratedImage(cand);
        if (existing?.imageUrl) {
          return {
            result: { prompt, imageUrl: existing.imageUrl, imagePath: existing.imagePath },
            artifactStatus: 'accepted_clean',
            attempts: 0,
            resolvedIdentifier: cand,
          };
        }
      }
    }

    let attemptPrompt = prompt;
    let lastResult: GeneratedImage | null = null;
    let lastIdentifier = identifier;

    for (let attempt = 0; attempt <= maxTextArtifactRetries; attempt++) {
      const attemptIdentifier = attempt === 0 ? identifier : `${identifier}-textfix${attempt}`;
      lastIdentifier = attemptIdentifier;
      const result = await withTimeout(this.deps.imageService.generateImage(
        attemptPrompt,
        attemptIdentifier,
        {
          ...metadata,
          baseIdentifier: encounterGenOptions?.resumeBaseIdentifier || identifier,
          resolvedIdentifier: attemptIdentifier,
          regeneration: attempt > 0 ? attempt : undefined,
          preferAtlasFirst: !!encounterGenOptions?.preferAtlasFirst && attempt === 0,
        },
        referenceImages
      ), PIPELINE_TIMEOUTS.imageGeneration, `encounterImage(${attemptIdentifier})`);
      lastResult = result;

      if (!result.imageUrl) continue;
      const qa = await this.validateEncounterImage(result, `${qaIdentifier}:attempt-${attempt + 1}`, attemptPrompt, metadata, true);
      if (qa.passed) {
        return {
          result,
          artifactStatus: attempt === 0 ? 'accepted_clean' : 'accepted_after_retry',
          attempts: attempt + 1,
          resolvedIdentifier: attemptIdentifier,
        };
      }

      if (attempt < maxTextArtifactRetries) {
        attemptPrompt = this.strengthenPromptForTextArtifacts(prompt, attempt);
      }
    }

    if (!lastResult) {
      throw new Error(`Encounter image generation failed for ${qaIdentifier}`);
    }

    return {
      result: lastResult,
      artifactStatus: 'accepted_with_artifact',
      attempts: maxTextArtifactRetries + 1,
      resolvedIdentifier: lastIdentifier,
    };
  }

  private makeEncounterVisualSceneDescription(narrativeText: string): string {
    const cleaned = (narrativeText || '').trim();
    if (!cleaned) return 'A high-stakes encounter moment with visible action and reaction.';
    return `${cleaned} Show the exact moment of action and reaction, with clear body language and cause/effect in frame.`;
  }

  private inferEncounterCameraAngle(
    text: string,
    phase: 'setup' | 'rising' | 'peak' | 'resolution'
  ): 'wide_establishing' | 'medium_action' | 'close_dramatic' | 'low_heroic' | 'high_vulnerability' | 'dutch_chaos' | 'over_shoulder' | 'reaction_shot' {
    const lowered = (text || '').toLowerCase();
    if (phase === 'setup') return 'wide_establishing';
    if (/(strikes?|lunges?|explodes?|impact|collides?)/.test(lowered)) return 'close_dramatic';
    if (/(stagger|retreat|falls?|wounded|defeat|recoil)/.test(lowered)) return 'high_vulnerability';
    if (phase === 'peak') return 'low_heroic';
    if (phase === 'resolution') return 'reaction_shot';
    return 'medium_action';
  }

  private inferEncounterMood(
    text: string,
    phase: 'setup' | 'rising' | 'peak' | 'resolution'
  ): 'anticipation' | 'dynamic_action' | 'triumphant' | 'desperate' | 'tense_uncertainty' | 'relief' | 'dread' {
    const lowered = (text || '').toLowerCase();
    if (phase === 'setup') return 'anticipation';
    if (/(victory|wins?|overpower|breakthrough)/.test(lowered)) return 'triumphant';
    if (/(fail|wound|desperate|panic|collapse|overwhelmed)/.test(lowered)) return 'desperate';
    if (phase === 'peak') return 'dynamic_action';
    if (phase === 'resolution') return 'relief';
    return 'tense_uncertainty';
  }

  private buildEncounterVisualContract(
    text: string,
    phase: 'setup' | 'rising' | 'peak' | 'resolution'
  ): EncounterVisualContract {
    const cleaned = (text || '').trim();
    const action = cleaned.match(/\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|lowers?|clenches?|releases?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?)\b/i)?.[0];
    const detail = cleaned.match(/\b(key|blade|blood|door|map|weapon|wound|fist|hands?|letter|ring|gun|knife|tear|glance)\b/i)?.[0];
    const fallbackAction = action
      ? `protagonist ${action}`
      : phase === 'setup'
        ? 'protagonist claims a position in the contested space'
        : phase === 'peak'
          ? 'protagonist commits to the decisive move with hands and body engaged'
          : phase === 'resolution'
            ? 'protagonist releases or guards the decisive object as the outcome lands'
            : 'protagonist shifts stance and forces the pressure into a visible new shape';
    const fallbackCue = detail
      ? `the ${detail} as the decisive visual clue`
      : phase === 'resolution'
        ? 'changed distance, released tension, and one concrete body cue that proves the outcome'
        : 'a clear shift in stance, distance, or object control that proves the encounter turn';
    const shotDescription = phase === 'setup'
      ? 'establishing medium-wide frame with relational spacing'
      : phase === 'peak'
        ? 'tight dramatic frame at the decisive instant'
        : phase === 'resolution'
          ? 'reaction-driven medium close shot with aftermath readable in posture'
          : 'medium shot that keeps bodies, faces, and pressure readable';
    return {
      visualMoment: cleaned || 'A tense encounter moment frozen at the decisive instant.',
      primaryAction: fallbackAction,
      emotionalRead: phase === 'peak'
        ? 'faces and posture show maximum strain and commitment'
        : phase === 'resolution'
          ? 'visible aftermath in breathing, gaze, and shoulder release/tension'
          : 'emotion reads through eyes, jaw, and weight shift',
      relationshipDynamic: phase === 'setup'
        ? 'opponents sizing each other up with contested space'
        : 'clear pressure exchange between protagonist and opposition',
      mustShowDetail: detail
        ? `the ${detail} as the decisive visual clue`
        : fallbackCue,
      keyExpression: phase === 'resolution'
        ? 'aftermath visible in the eyes and mouth'
        : phase === 'peak'
          ? 'strain, focus, and emotional commitment readable at a glance'
          : 'emotion clear in the face before the next move lands',
      keyGesture: action ? `hands and body clearly readable during "${action}"` : fallbackCue,
      keyBodyLanguage: phase === 'setup'
        ? 'stance and spacing define the power balance'
        : 'posture and weight shift show who is pressing and who is yielding',
      shotDescription,
      emotionalCore: phase === 'resolution' ? 'aftermath and cost' : phase === 'peak' ? 'decision under pressure' : 'rising interpersonal tension',
      visualNarrative: cleaned || 'The image should clearly communicate the encounter turn without needing caption text.',
      includeExpressionRefs: phase !== 'setup',
    };
  }

  private shouldUseExpressionReferencesForEncounter(
    encounter: Pick<EncounterStructure, 'encounterType' | 'encounterStyle'>,
    visualContract?: EncounterVisualContract
  ): boolean {
    if (visualContract?.includeExpressionRefs) return true;
    const type = (encounter.encounterType || '').toLowerCase();
    const style = (encounter.encounterStyle || '').toLowerCase();
    return ['social', 'romantic', 'dramatic', 'negotiation', 'investigation', 'mixed'].includes(type)
      || ['social', 'romantic', 'dramatic', 'mystery'].includes(style);
  }


  /**
   * Retry pass: walk the encounter choice tree and retry generation for any
   * outcome or situation image still missing from the maps after the initial pass.
   * Uses simplified prompts but preserves reference images for character identity.
   */
  private async retryMissingEncounterTreeImages(
    choices: Array<{ id: string; text?: string; outcomes?: Record<string, any> }>,
    pathPrefix: string,
    sceneId: string,
    encounterId: string,
    beatId: string,
    context: {
      referenceImages: ReferenceImage[];
      characterIds: string[];
      characterNames: string[];
      characterDescriptions: CharacterAppearanceDescription[];
      brief: FullCreativeBrief;
      encounter: EncounterStructure;
      settingContext?: SceneSettingContext;
    },
    maps: {
      setupImages: Map<string, string>;
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
    },
    counters: { imagesGenerated: number; imagesAttempted: number; globalIndex: number; total: number },
    encounterPolicy: EncounterProviderPolicy,
    resumeSet: Set<string>,
    markResumeDone: (baseId: string) => Promise<void>,
    onEncounterSlotFailure: (err: unknown) => Promise<void>,
    pipelineContext: PipelineContext,
    depth: number = 0,
  ): Promise<{ retried: number; recovered: number }> {
    let retried = 0;
    let recovered = 0;
    if (depth > ENCOUNTER_TREE_MAX_DEPTH) return { retried, recovered };

    const { referenceImages, characterIds, characterNames, characterDescriptions, brief, encounter, settingContext } = context;
    const scopedSceneId = this.deps.getEpisodeScopedSceneId(brief, sceneId);
    const hasRefs = referenceImages.length > 0;

    for (const choice of choices) {
      if (!choice.outcomes) continue;
      const choiceMapKey = pathPrefix ? `${pathPrefix}::${choice.id}` : choice.id;
      const existingOutcomes = maps.outcomeImages.get(choiceMapKey) || {};

      for (const tier of ['success', 'complicated', 'failure'] as const) {
        await this.deps.checkCancellation();
        const outcomeData = choice.outcomes[tier];
        if (!outcomeData) continue;
        if (existingOutcomes[tier]) continue;

        retried++;
        const retryOutcomeId = encounterOutcomeRetryIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
        const outcomeBaseId = encounterOutcomeIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
        const narrativeText = this.deps.resolvePlayerTemplates(
          this.deps.normalizeNarrativeText(outcomeData.narrativeText, `${tier} outcome`),
          brief,
        );

        const moodMap = { success: 'triumphant' as const, complicated: 'tense_uncertainty' as const, failure: 'desperate' as const };
        const simpleCinematic = {
          sceneDescription: narrativeText || `${encounter.encounterType || 'dramatic'} encounter - ${tier} outcome`,
          focusSubject: 'protagonist',
          secondaryElements: [] as string[],
          cameraAngle: 'medium_action' as const,
          shotType: 'consequence' as const,
          mood: moodMap[tier],
          lightingDirection: tier === 'success' ? 'warm front lighting' : tier === 'failure' ? 'harsh side lighting' : 'neutral fill',
          colorPalette: tier === 'success' ? 'warm tones' : tier === 'failure' ? 'cold desaturated' : 'muted mixed',
          characterStates: [
            { characterId: brief.protagonist.id || 'protagonist', pose: 'center frame', expression: 'determined', position: 'center' },
          ],
        };

        try {
          console.log(`[Pipeline] RETRY: Generating ${tier} image for ${choiceMapKey} (simplified prompt, ${hasRefs ? referenceImages.length + ' refs' : 'no refs'})`);
          const retryPrompt = this.deps.encounterImageAgent.cinematicDescriptionToPrompt({
            encounterId,
            beatId,
            choiceId: choiceMapKey,
            outcomeTier: tier,
            cinematicDescription: simpleCinematic,
            encounterPhase: tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising',
            visualContract: outcomeData.visualContract || this.buildEncounterVisualContract(narrativeText, tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising'),
            genre: brief.story.genre,
            artStyle: pipelineContext.config.artStyle,
            settingContext,
          });

          const generated = await this.generateEncounterImageWithTextArtifactPolicy(
            retryPrompt,
            retryOutcomeId,
            { sceneId: scopedSceneId, beatId, choiceId: choiceMapKey, type: 'encounter-outcome', tier, characters: characterIds, characterNames, characterDescriptions },
            hasRefs ? referenceImages : undefined,
            `retry:${tier}:${beatId}:${choiceMapKey}`,
            1,
            {
              preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
              resumeCompleted: resumeSet,
              resumeBaseIdentifier: outcomeBaseId,
              resumeAlternateBaseIdentifiers: [retryOutcomeId],
            },
          );

          if (generated.result.imageUrl) {
            const current = maps.outcomeImages.get(choiceMapKey) || {};
            current[tier] = generated.result.imageUrl;
            maps.outcomeImages.set(choiceMapKey, current);
            counters.imagesGenerated++;
            counters.globalIndex++;
            recovered++;
            encounterPolicy.onSlotSuccess();
            await markResumeDone(outcomeBaseId);
            console.log(`[Pipeline] RETRY SUCCESS: ${tier} image for ${choiceMapKey} recovered`);
          } else {
            console.warn(`[Pipeline] RETRY FAILED: ${tier} image for ${choiceMapKey} returned no URL`);
            await onEncounterSlotFailure(new Error('no_image_url'));
          }
        } catch (retryErr) {
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error(`[Pipeline] RETRY FAILED: ${tier} image for ${choiceMapKey}: ${msg}`);
          if (retryErr instanceof PipelineError) throw retryErr;
          await onEncounterSlotFailure(retryErr);
        }

        await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
      }

      for (const tier of ['success', 'complicated', 'failure'] as const) {
        const outcomeData = choice.outcomes[tier];
        if (!outcomeData?.nextSituation) continue;
        const nextSituation = outcomeData.nextSituation;
        if (!nextSituation.choices || nextSituation.choices.length === 0) continue;

        const situationKey = encounterSituationKey(beatId, choiceMapKey, tier);
        const legacySituationKey = legacyEncounterSituationKey(choiceMapKey, tier);
        if (!maps.setupImages.has(situationKey) && !maps.setupImages.has(legacySituationKey)) {
          retried++;
          const sitRetryId = encounterSituationRetryIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
          const sitBaseId = encounterSituationIdentifier(scopedSceneId, beatId, choiceMapKey, tier);
          const legacySitRetryId = legacyEncounterSituationRetryIdentifier(scopedSceneId, choiceMapKey, tier);
          const legacySitBaseId = legacyEncounterSituationIdentifier(scopedSceneId, choiceMapKey, tier);
          const sitText = this.deps.resolvePlayerTemplates(
            this.deps.normalizeNarrativeText(nextSituation.setupText, `Next situation after ${tier}`),
            brief,
          );

          try {
            console.log(`[Pipeline] RETRY: Generating situation image for ${situationKey} (${hasRefs ? referenceImages.length + ' refs' : 'no refs'})`);
            const sitPrompt = this.deps.encounterImageAgent.cinematicDescriptionToPrompt({
              encounterId,
              beatId,
              cinematicDescription: {
                sceneDescription: sitText || `Continuation of ${encounter.encounterType || 'dramatic'} encounter`,
                focusSubject: 'protagonist',
                secondaryElements: [],
                cameraAngle: 'medium_action' as const,
                shotType: 'tension_hold' as const,
                mood: 'tense_uncertainty' as const,
                lightingDirection: 'dramatic side lighting',
                colorPalette: 'contextual to genre',
                characterStates: [
                  { characterId: brief.protagonist.id || 'protagonist', pose: 'ready stance', expression: 'determined', position: 'center frame' },
                ],
              },
              encounterPhase: 'setup',
              visualContract: nextSituation.visualContract || this.buildEncounterVisualContract(sitText, 'setup'),
              genre: brief.story.genre,
              artStyle: pipelineContext.config.artStyle,
              settingContext,
            });

            const generated = await this.generateEncounterImageWithTextArtifactPolicy(
              sitPrompt,
              sitRetryId,
              { sceneId: scopedSceneId, beatId, type: 'encounter-setup', characters: characterIds, characterNames, characterDescriptions },
              hasRefs ? referenceImages : undefined,
              `retry:situation:${choiceMapKey}::${tier}`,
              1,
              {
                preferAtlasFirst: encounterPolicy.consumePreferAtlasFirst(),
                resumeCompleted: resumeSet,
                resumeBaseIdentifier: sitBaseId,
                resumeAlternateBaseIdentifiers: [sitRetryId, legacySitRetryId, legacySitBaseId],
              },
            );

            if (generated.result.imageUrl) {
              maps.setupImages.set(situationKey, generated.result.imageUrl);
              maps.setupImages.set(legacySituationKey, generated.result.imageUrl);
              counters.imagesGenerated++;
              counters.globalIndex++;
              recovered++;
              encounterPolicy.onSlotSuccess();
              await markResumeDone(sitBaseId);
              console.log(`[Pipeline] RETRY SUCCESS: Situation image for ${situationKey} recovered`);
            } else {
              await onEncounterSlotFailure(new Error('no_image_url'));
            }
          } catch (retryErr) {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.error(`[Pipeline] RETRY FAILED: Situation image for ${situationKey}: ${msg}`);
            if (retryErr instanceof PipelineError) throw retryErr;
            await onEncounterSlotFailure(retryErr);
          }

          await new Promise(resolve => setTimeout(resolve, TIMING_DEFAULTS.rateLimitDelayMs));
        }

        const nestedPrefix = `${choiceMapKey}::${tier}`;
        const nestedResult = await this.retryMissingEncounterTreeImages(
          nextSituation.choices,
          nestedPrefix,
          sceneId,
          encounterId,
          beatId,
          context,
          maps,
          counters,
          encounterPolicy,
          resumeSet,
          markResumeDone,
          onEncounterSlotFailure,
          pipelineContext,
          depth + 1,
        );
        retried += nestedResult.retried;
        recovered += nestedResult.recovered;
      }
    }

    return { retried, recovered };
  }
}
