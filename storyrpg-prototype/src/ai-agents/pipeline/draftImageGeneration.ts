/**
 * Draft-image generation cluster (refactor R4, 2026-06-11).
 *
 * Faithful port of FullStoryPipeline.generateImagesForDraft /
 * generateTargetedBeatImagesForDraft (pure move) — the single-image /
 * targeted-beat regeneration entry points used by the generator UI.
 * generateImagesForDraft re-runs the image phase over a story-only output
 * directory (resume scan, per-episode generation, cover art, binding repair,
 * final package). generateTargetedBeatImagesForDraft spot-backfills specific
 * beat images without touching the rest of the run. The image-phase internals
 * they orchestrate (resume scan, episode/encounter generation, registry
 * seeding, finalization) stay owned by the monolith and are injected via the
 * deps; run-scoped state (events, checkpoints, telemetry, asset registry) is
 * accessor-backed so the cluster resets and reads the same run state.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { PipelineConfig } from '../config';
import { Story, Scene, Beat, Episode } from '../../types';
import { WorldBible } from '../agents/WorldBuilder';
import { CharacterBible } from '../agents/CharacterDesigner';
import { resolveCharacterProfile } from '../utils/characterProfileResolver';
import { SceneContent } from '../agents/SceneWriter';
import { ChoiceSet } from '../agents/ChoiceAuthor';
import { EncounterStructure } from '../agents/EncounterArchitect';
import { ImagePrompt } from '../images/imageTypes';
import {
  ImageGenerationService,
  ReferenceImage,
  type EncounterImageDiagnostic,
} from '../services/imageGenerationService';
import {
  ensureDirectory,
  savePipelineOutputs,
  saveEarlyDiagnostic,
  loadEarlyDiagnosticSync,
  writeFinalStoryPackage,
  OutputManifest,
  type VisualPlanningOutputs,
  type EncounterImageRunDiagnostic,
} from '../utils/pipelineOutputWriter';
import { assembleStoryAssetsFromRegistry } from '../images/storyAssetAssembler';
import type { StoryboardV2Result } from '../images/storyboard-v2/StoryboardV2Pipeline';
import { storyBeatBaseIdentifier } from '../images/storyImageSlotManifest';
import { buildBeatImagePrompt } from '../images/beatPromptBuilder';
import { AssetRegistry } from '../images/assetRegistry';
import { JobCancelledError } from '../utils/jobTracker';
import { LocalWorkerQueue } from '../utils/concurrency';
import { PipelineTelemetry } from '../utils/pipelineTelemetry';
import { PipelineError } from './errors';
import type { PipelineEvent } from './events';
import type { DraftImageEntry } from './draftImageEntry';
// Type-only import — erased at runtime, so no runtime cycle with the monolith.
import type { FullCreativeBrief, FullPipelineResult, CheckpointData } from './FullStoryPipeline';

type EpisodeImageResults = { beatImages: Map<string, string>; sceneImages: Map<string, string> };

type EncounterImageResults = {
  encounterImages: Map<string, {
    setupImages: Map<string, string>;
    outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
  }>;
  storyletImages: Map<string, Map<string, Map<string, string>>>;
  storyletFailures?: string[];
};

export interface DraftImageGenerationDeps {
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  resetCollectedVisualPlanning: () => void;
  hydrateSeasonImageStyleFromStoryPackage: (
    storyPackage?: { generator?: Record<string, unknown>; story?: Story } | Story | null,
  ) => void;
  applyActiveImageStyleToRuntime: () => void;
  loadContinuationStory: (
    outputDirectory: string | undefined,
    resumeCheckpoint?: { steps?: Record<string, { status?: string }>; outputs?: Record<string, unknown> },
  ) => Story | undefined;
  saveDraftImageManifest: (outputDirectory: string | undefined, story: Story) => Promise<void>;
  scanExistingImagesForResume: (
    outputDirectory: string,
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
    brief: FullCreativeBrief,
    options?: { targetEpisodeNumber?: number },
  ) => Promise<{
    totalSlots: number;
    resolvedSlotsBefore: number;
    resolvedSlotsAfter: number;
    hydratedReferenceSheets: number;
    plannedReferenceCharacterIds: string[];
    generatedReferenceCharacterIds: string[];
    missingReferenceCharacterIds: string[];
    missingSlotIds: string[];
    completedEncounterBaseIdentifiersByScene: Record<string, string[]>;
  }>;
  checkCancellation: () => Promise<void>;
  sceneContentFromStoryScene: (scene: Scene) => SceneContent;
  useStoryboardV2ImagePipeline: () => boolean;
  measurePhase: <T>(phase: string, fn: () => Promise<T>) => Promise<T>;
  runStoryboardV2ImageGeneration: (
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    encounters: Map<string, EncounterStructure>,
    outputDirectory?: string,
  ) => Promise<{
    imageResults: EpisodeImageResults;
    encounterImageResults: EncounterImageResults;
    diagnostics?: StoryboardV2Result['diagnostics'];
  }>;
  runEpisodeImageGeneration: (
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    outputDirectory?: string,
    options?: { skipColorScriptAndStyleBible?: boolean; missingSlotIds?: string[] },
  ) => Promise<EpisodeImageResults>;
  runEncounterProviderPreflight: (outputDirectory?: string) => Promise<void>;
  generateEncounterImages: (
    encounters: Map<string, EncounterStructure>,
    characterBible: CharacterBible,
    brief: FullCreativeBrief,
    outputDirectory?: string,
  ) => Promise<EncounterImageResults & { storyletFailures: string[] }>;
  toEncounterRunDiagnostics: (entries: EncounterImageDiagnostic[]) => EncounterImageRunDiagnostic[];
  seedAssetRegistryFromResults: (
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    encounters: Map<string, EncounterStructure>,
    imageResults?: EpisodeImageResults,
    encounterImageResults?: {
      encounterImages: Map<string, {
        setupImages: Map<string, string>;
        outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
      }>;
      storyletImages?: Map<string, Map<string, Map<string, string>>>;
    },
  ) => void;
  generateStoryCoverArt: (
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    worldBible: WorldBible,
    outputDirectory?: string,
  ) => Promise<string | undefined>;
  resolveGeneratedStoryPlayerTemplates: (story: Story, brief: FullCreativeBrief) => Story;
  /** Stays on the monolith: also called by finalizeImageRunFromRegistry. */
  auditStoryVisualContractPersistence: (story: Story) => {
    passed: boolean;
    sceneCount: number;
    scenesWithSequencePlan: number;
    nonEstablishingBeatCount: number;
    nonEstablishingBeatsWithCoveragePlan: number;
    missingScenePlanIds: string[];
    missingCoverageBeatIds: string[];
  };
  repairBoundImageReferences: (story: Story, outputDirectory: string) => Promise<{
    generatedAt: string;
    checked: number;
    repaired: Array<{ path: string; from: string; to: string }>;
    unresolved: Array<{ path: string; value: string; filePath: string }>;
  }>;
  buildImageManifestFromStory: (story: Story) => ReturnType<DraftImageEntry['buildImageManifestFromStory']>;
  getCollectedVisualPlanningForSave: () => VisualPlanningOutputs | undefined;
  buildStoryGeneratorMetadata: () => Record<string, unknown>;
  getRemediationSummary: () => { attempted: number; succeeded: number; degraded: number };
  finalizeImageRunFromRegistry: (
    outputDirectory: string,
    story: Story,
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    choiceSets: ChoiceSet[],
    encounters: EncounterStructure[],
    encounterImageDiagnostics?: EncounterImageRunDiagnostic[],
    terminalReason?: 'cancelled' | 'failed' | 'completed',
    startTime?: number,
  ) => Promise<Story>;
  servedUrlForGeneratedImagePath: (imagePath: string) => string;
  // Run-scoped services/state (accessor-backed by the monolith; the writable
  // fields below are reset by these entry points, so they carry live setters).
  readonly config: PipelineConfig;
  readonly imageService: ImageGenerationService;
  readonly imageWorkerQueue: LocalWorkerQueue;
  readonly assetRegistry: AssetRegistry;
  events: PipelineEvent[];
  checkpoints: CheckpointData[];
  telemetry: PipelineTelemetry;
  pipelineStartedAtMs: number;
  completedPhases: Set<string>;
}

export class DraftImageGeneration {
  constructor(private deps: DraftImageGenerationDeps) {}

  private applySceneVisualContractsToStoryScenes(storyScenes: Scene[] | undefined, sceneContents: SceneContent[]): {
    sceneCount: number;
    scenePlansPersisted: number;
    beatCount: number;
    beatCoveragePlansPersisted: number;
    missingSceneIds: string[];
  } {
    const report = {
      sceneCount: storyScenes?.length || 0,
      scenePlansPersisted: 0,
      beatCount: 0,
      beatCoveragePlansPersisted: 0,
      missingSceneIds: [] as string[],
    };
    const contentBySceneId = new Map((sceneContents || []).map((content) => [content.sceneId, content]));

    for (const scene of storyScenes || []) {
      const content = contentBySceneId.get(scene.id);
      if (!content) {
        report.missingSceneIds.push(scene.id);
        continue;
      }
      if (content.sceneVisualSequencePlan) {
        scene.sceneVisualSequencePlan = content.sceneVisualSequencePlan;
        report.scenePlansPersisted += 1;
      }
      if (content.sequenceIntent) {
        scene.sequenceIntent = {
          ...(scene.sequenceIntent || {}),
          ...content.sequenceIntent,
        };
      }

      const contentBeatById = new Map((content.beats || []).map((beat) => [beat.id, beat]));
      for (const beat of scene.beats || []) {
        report.beatCount += 1;
        const contentBeat = contentBeatById.get(beat.id);
        if (!contentBeat) continue;
        if (contentBeat.sequenceIntent) {
          beat.sequenceIntent = {
            ...(beat.sequenceIntent || {}),
            ...contentBeat.sequenceIntent,
          };
        }
        if (contentBeat.dramaticIntent) {
          beat.dramaticIntent = {
            ...(beat.dramaticIntent || {}),
            ...contentBeat.dramaticIntent,
          };
        }
        if (contentBeat.coveragePlan) {
          beat.coveragePlan = contentBeat.coveragePlan;
          report.beatCoveragePlansPersisted += 1;
        }
      }
    }

    return report;
  }

  async generateImagesForDraft(
    outputDirectory: string,
    resumeCheckpoint?: { steps?: Record<string, { status?: string }>; outputs?: Record<string, unknown> },
    options: { targetEpisodeNumber?: number } = {},
  ): Promise<FullPipelineResult> {
    this.deps.events = [];
    this.deps.checkpoints = [];
    this.deps.telemetry = new PipelineTelemetry();
    this.deps.pipelineStartedAtMs = Date.now();
    this.deps.completedPhases = new Set<string>();
    this.deps.resetCollectedVisualPlanning();
    const startTime = Date.now();

    const normalizedOutputDir = outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`;
    await ensureDirectory(normalizedOutputDir);

    const brief = loadEarlyDiagnosticSync<FullCreativeBrief>(normalizedOutputDir, '00-input-brief.json');
    const worldBible = loadEarlyDiagnosticSync<WorldBible>(normalizedOutputDir, '01-world-bible.json');
    const characterBible = loadEarlyDiagnosticSync<CharacterBible>(normalizedOutputDir, '02-character-bible.json');
    const storyPackage = loadEarlyDiagnosticSync<{ generator?: Record<string, unknown>; story?: Story } | Story>(normalizedOutputDir, 'story.json');
    this.deps.hydrateSeasonImageStyleFromStoryPackage(storyPackage);
    this.deps.applyActiveImageStyleToRuntime();
    const story = this.deps.loadContinuationStory(normalizedOutputDir, resumeCheckpoint);
    const savedChoiceSets = loadEarlyDiagnosticSync<ChoiceSet[]>(normalizedOutputDir, '05-choice-sets.json') || [];
    const savedEncounters = loadEarlyDiagnosticSync<EncounterStructure[]>(normalizedOutputDir, '05b-encounters.json') || [];

    if (!brief || !worldBible || !characterBible || !story) {
      throw new PipelineError('Image-only generation requires a story-only output directory with brief, world bible, character bible, and story files.', 'images', {
        context: { outputDirectory: normalizedOutputDir, failureKind: 'image_only_missing_draft' },
      });
    }

	    story.imagesStatus = 'running';
	    await this.deps.saveDraftImageManifest(normalizedOutputDir, story);

		    if (!this.deps.config.imageGen?.enabled) {
		      this.deps.config.imageGen = { ...(this.deps.config.imageGen || {}), enabled: true };
		    }
	    this.deps.config.imageGen = {
	      ...(this.deps.config.imageGen || {}),
	      enabled: true,
		      strategy: 'all-beats',
		    };
		    this.deps.imageService.setOutputDirectory(`${normalizedOutputDir}images/`);
	    const imageResumeScan = await this.deps.scanExistingImagesForResume(
	      normalizedOutputDir,
	      story,
	      characterBible,
	      savedEncounters,
	      brief,
	      options,
	    );
	    this.deps.emit({
	      type: 'debug',
	      phase: 'images',
	      message: `Image resume scan resolved ${imageResumeScan.resolvedSlotsAfter}/${imageResumeScan.totalSlots} planned slots from disk; ${imageResumeScan.missingSlotIds.length} still missing.`,
	      data: imageResumeScan,
	    });

    const allEncounterDiagnostics: EncounterImageRunDiagnostic[] = [];
	    try {
	      if (imageResumeScan.missingSlotIds.length === 0) {
	        this.deps.emit({
	          type: 'phase_complete',
	          phase: 'images',
	          message: 'Image resume scan found every planned slot already generated; skipping image API calls.',
	        });
	      } else {
	        this.deps.emit({
	          type: 'debug',
	          phase: 'images',
	          message: 'Image-only resume will skip style-bible/master preflight and generate only unresolved story, encounter, and storylet slots.',
	          data: { missingSlotIds: imageResumeScan.missingSlotIds.slice(0, 100) },
	        });
	        for (const episode of story.episodes || []) {
	          await this.deps.checkCancellation();
	          if (options.targetEpisodeNumber != null && episode.number !== options.targetEpisodeNumber) {
	            this.deps.emit({
	              type: 'debug',
	              phase: 'images',
	              message: `Image-only run skipping episode ${episode.number}; target is episode ${options.targetEpisodeNumber}.`,
	            });
	            continue;
	          }
	          const missingForEpisode = imageResumeScan.missingSlotIds.some((slotId) => slotId.includes(`episode-${episode.number}-`));
	          if (!missingForEpisode) {
	            this.deps.emit({
	              type: 'debug',
	              phase: 'images',
	              message: `Image-only resume skipping episode ${episode.number}; all image slots are already resolved.`,
	            });
	            continue;
	          }
	          const episodeBrief: FullCreativeBrief = {
	            ...brief,
	            episode: {
	              ...(brief.episode || {}),
	              number: episode.number,
	              title: episode.title,
	              synopsis: episode.synopsis,
	            },
	          } as FullCreativeBrief;
	          const sceneContents = (episode.scenes || []).map((scene) => this.deps.sceneContentFromStoryScene(scene));
	          const choiceSets = savedChoiceSets.filter((choiceSet: any) => {
	            if (!choiceSet?.sceneId) return true;
	            return episode.scenes?.some((scene) => scene.id === choiceSet.sceneId);
	          });
		        const encounterMap = new Map<string, EncounterStructure>();
		        for (const encounter of savedEncounters) {
		          if (episode.scenes?.some((scene) => scene.id === encounter.sceneId)) {
		            encounterMap.set(encounter.sceneId, encounter);
		          }
		        }
		        if (encounterMap.size === 0) {
		          for (const scene of episode.scenes || []) {
		            if (scene.encounter) {
		              encounterMap.set(scene.id, {
		                ...(scene.encounter as unknown as EncounterStructure),
		                sceneId: scene.id,
		              });
		            }
		          }
		          if (encounterMap.size > 0) {
		            this.deps.emit({
		              type: 'debug',
		              phase: 'encounter_images',
		              message: `Image-only run recovered ${encounterMap.size} encounter(s) from embedded story scenes because 05b-encounters.json was unavailable.`,
		            });
		          }
		        }

	          this.deps.emit({ type: 'phase_start', phase: 'images', message: `Generating missing scene visuals for episode ${episode.number}...` });
	          let imageResults: { beatImages: Map<string, string>; sceneImages: Map<string, string> };
	          let encounterImageResults: { encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>; storyletImages: Map<string, Map<string, Map<string, string>>>; storyletFailures?: string[] } | undefined;
	          if (this.deps.useStoryboardV2ImagePipeline()) {
	            const storyboardResult = await this.deps.imageWorkerQueue.run(() =>
	              this.deps.measurePhase(
	                'storyboard_v2_image_generation',
	                () => this.deps.runStoryboardV2ImageGeneration(sceneContents, choiceSets, episodeBrief, characterBible, encounterMap, normalizedOutputDir),
	              )
	            );
	            imageResults = storyboardResult.imageResults;
	            encounterImageResults = storyboardResult.encounterImageResults;
	            const persistence = this.applySceneVisualContractsToStoryScenes(episode.scenes, sceneContents);
	            await saveEarlyDiagnostic(normalizedOutputDir, `episode-${episode.number}-visual-contract-persistence.json`, {
	              pipelineMode: 'storyboard-v2',
	              episodeNumber: episode.number,
	              persistence,
	              sequenceDiagnostics: storyboardResult.diagnostics?.sequenceDiagnostics,
	              specificityAudits: storyboardResult.diagnostics?.specificityAudits,
	              characterNormalizationDiagnostics: storyboardResult.diagnostics?.characterNormalizationDiagnostics,
	            });
	          } else {
	            imageResults = await this.deps.imageWorkerQueue.run(() =>
	              this.deps.measurePhase(
	                'episode_image_generation',
	                () => this.deps.runEpisodeImageGeneration(
	                  sceneContents,
	                  choiceSets,
	                  episodeBrief,
		                  worldBible,
		                  characterBible,
		                  normalizedOutputDir,
		                  { skipColorScriptAndStyleBible: true, missingSlotIds: imageResumeScan.missingSlotIds },
		                )
	              )
	            );
	          }

	          if (!this.deps.useStoryboardV2ImagePipeline() && encounterMap.size > 0) {
	            this.deps.imageService.clearEncounterDiagnostics();
	            await this.deps.runEncounterProviderPreflight(normalizedOutputDir);
	            encounterImageResults = await this.deps.imageWorkerQueue.run(() =>
	              this.deps.measurePhase(
	                'encounter_image_generation',
	                () => this.deps.generateEncounterImages(encounterMap, characterBible, episodeBrief, normalizedOutputDir)
	              )
	            );
	            allEncounterDiagnostics.push(...this.deps.toEncounterRunDiagnostics(this.deps.imageService.getEncounterDiagnostics()));
	          }

	          this.deps.seedAssetRegistryFromResults(episodeBrief, sceneContents, encounterMap, imageResults, encounterImageResults);
	          await saveEarlyDiagnostic(normalizedOutputDir, '08-registry-state.json', this.deps.assetRegistry.toSnapshot());
	        }
	      }

      const coverUrl = options.targetEpisodeNumber == null
        ? await this.deps.generateStoryCoverArt(brief, characterBible, worldBible, normalizedOutputDir)
        : undefined;
      let finalStory = this.deps.resolveGeneratedStoryPlayerTemplates(
        assembleStoryAssetsFromRegistry(story, this.deps.assetRegistry),
        brief,
      );
      if (coverUrl) finalStory.coverImage = coverUrl;
      finalStory.outputDir = normalizedOutputDir;
      const visualContractPersistence = this.deps.auditStoryVisualContractPersistence(finalStory);
      await saveEarlyDiagnostic(normalizedOutputDir, 'visual-contract-persistence-report.json', visualContractPersistence);
      if (this.deps.useStoryboardV2ImagePipeline() && !visualContractPersistence.passed) {
        throw new PipelineError(
          `Storyboard v2 visual contract persistence failed: ${visualContractPersistence.missingScenePlanIds.length} scene plan(s) and ${visualContractPersistence.missingCoverageBeatIds.length} beat coverage plan(s) missing from final story.`,
          'images',
          {
            context: {
              failureKind: 'visual_contract_persistence',
              stepId: 'storyboard_v2_contract_persistence',
              resumeFromStepId: 'image_generation',
              outputDirectory: normalizedOutputDir,
              visualContractPersistence,
            },
          }
        );
      }
      const imageIntegrity = await this.deps.repairBoundImageReferences(finalStory, normalizedOutputDir);
      const finalImageManifest = this.deps.buildImageManifestFromStory(finalStory);
      finalStory.imagesStatus = imageIntegrity.unresolved.length > 0
        ? 'failed'
        : finalImageManifest.imagesStatus;
      await saveEarlyDiagnostic(normalizedOutputDir, 'image-integrity-report.json', imageIntegrity);
      if (imageIntegrity.repaired.length > 0 || imageIntegrity.unresolved.length > 0) {
        this.deps.emit({
          type: imageIntegrity.unresolved.length > 0 ? 'warning' : 'debug',
          phase: 'images',
          message: `Image binding integrity repaired ${imageIntegrity.repaired.length} reference(s); ${imageIntegrity.unresolved.length} unresolved.`,
          data: imageIntegrity,
        });
      }
      await this.deps.saveDraftImageManifest(normalizedOutputDir, finalStory);

      const visualPlanningOutputs = this.deps.getCollectedVisualPlanningForSave();
      const outputManifest = await savePipelineOutputs(normalizedOutputDir, {
        brief,
        worldBible,
        characterBible,
        choiceSets: savedChoiceSets,
        encounters: savedEncounters,
        finalStory,
        generator: this.deps.buildStoryGeneratorMetadata(),
        visualPlanning: visualPlanningOutputs,
        encounterImageDiagnostics: allEncounterDiagnostics,
        llmLedger: this.deps.telemetry.getLlmLedger() ?? undefined,
        remediationSummary: this.deps.getRemediationSummary(),
      }, Date.now() - startTime);

      this.deps.emit({ type: 'phase_complete', phase: 'images', message: 'Image batch complete and bound into final story.' });
      return {
        success: true,
        story: finalStory,
        worldBible,
        characterBible,
        choiceSets: savedChoiceSets,
        encounters: savedEncounters,
        checkpoints: this.deps.checkpoints,
        events: this.deps.events,
        duration: Date.now() - startTime,
        outputDirectory: normalizedOutputDir,
        outputManifest,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.deps.finalizeImageRunFromRegistry(
        normalizedOutputDir,
        story,
        brief,
        worldBible,
        characterBible,
        savedChoiceSets,
        savedEncounters,
        allEncounterDiagnostics,
        error instanceof JobCancelledError ? 'cancelled' : 'failed',
        startTime,
      ).catch((finalizeErr) => {
        this.deps.emit({
          type: 'warning',
          phase: 'images',
          message: `Failed to finalize partial image run from registry: ${finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr)}`,
        });
      });
      if (error instanceof JobCancelledError) {
        throw error;
      }
      if (error instanceof PipelineError) {
        throw error;
      }
      throw new PipelineError(`Image-only generation failed: ${msg}`, 'images', {
        context: { outputDirectory: normalizedOutputDir, failureKind: 'image_generation' },
        originalError: error instanceof Error ? error : undefined,
      });
    }
  }

  async generateTargetedBeatImagesForDraft(
    outputDirectory: string,
    targetSlots: Array<{ episodeNumber: number; sceneId: string; beatId: string }>,
    options: {
      skipEncounterImages?: boolean;
      skipCover?: boolean;
      skipCharacterRefs?: boolean;
      skipVisualContractValidation?: boolean;
    } = {},
  ): Promise<FullPipelineResult> {
    this.deps.events = [];
    this.deps.checkpoints = [];
    this.deps.telemetry = new PipelineTelemetry();
    this.deps.pipelineStartedAtMs = Date.now();
    this.deps.completedPhases = new Set<string>();
    this.deps.resetCollectedVisualPlanning();
    const startTime = Date.now();

    if (!Array.isArray(targetSlots) || targetSlots.length === 0) {
      throw new PipelineError('Spot image backfill requires at least one target slot.', 'images', {
        context: { failureKind: 'spot_backfill_missing_targets' },
      });
    }

    const normalizedOutputDir = outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`;
    await ensureDirectory(normalizedOutputDir);

    const brief = loadEarlyDiagnosticSync<FullCreativeBrief>(normalizedOutputDir, '00-input-brief.json');
    const worldBible = loadEarlyDiagnosticSync<WorldBible>(normalizedOutputDir, '01-world-bible.json');
    const characterBible = loadEarlyDiagnosticSync<CharacterBible>(normalizedOutputDir, '02-character-bible.json');
    const storyPackage = loadEarlyDiagnosticSync<{ generator?: Record<string, unknown>; story?: Story } | Story>(normalizedOutputDir, 'story.json');
    this.deps.hydrateSeasonImageStyleFromStoryPackage(storyPackage);
    this.deps.applyActiveImageStyleToRuntime();
    const packagedStory = ((storyPackage as any)?.story || storyPackage) as Story | undefined;
    const story = packagedStory?.episodes?.length
      ? packagedStory
      : this.deps.loadContinuationStory(normalizedOutputDir);

    if (!brief || !worldBible || !characterBible || !story) {
      throw new PipelineError('Spot image backfill requires an output directory with brief, world bible, character bible, and story files.', 'images', {
        context: { outputDirectory: normalizedOutputDir, failureKind: 'spot_backfill_missing_draft' },
      });
    }

    this.deps.config.imageGen = {
      ...(this.deps.config.imageGen || {}),
      enabled: true,
    };
    this.deps.imageService.setOutputDirectory(`${normalizedOutputDir}images/`);
    this.deps.emit({
      type: 'phase_start',
      phase: 'images',
      message: `Spot image backfill: generating ${targetSlots.length} targeted beat image(s).`,
      data: { targetSlots, options },
    });

    const fs = await import('fs/promises');
    const nodePath = await import('path');
    const imageDir = `${normalizedOutputDir}images/`;
    const promptDir = `${imageDir}prompts/`;
    await ensureDirectory(promptDir);
    await fs.mkdir(promptDir, { recursive: true });

    const uniqueTargets = Array.from(new Map(
      targetSlots.map(slot => [`${slot.episodeNumber}::${slot.sceneId}::${slot.beatId}`, slot])
    ).values());
    const characterById = new Map((characterBible.characters || []).map((character: any) => [character.id, character]));
    const missingSlotRecords: any[] = [];
    const reportTargets: any[] = [];
    const resolveProviderCredentialError = (): string | null => {
      const imageConfig = this.deps.config.imageGen || {};
      const provider = String(imageConfig.provider || 'nano-banana');
      const env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {};
      if (
        (provider === 'nano-banana' || provider === 'gemini')
        && !(imageConfig.geminiApiKey || imageConfig.apiKey || env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY)
      ) {
        return 'Gemini API key is required for nano-banana image generation.';
      }
      if (
        (provider === 'openai' || provider === 'dall-e' || provider === 'gpt-image')
        && !(imageConfig.openaiApiKey || env.OPENAI_API_KEY || env.EXPO_PUBLIC_OPENAI_API_KEY)
      ) {
        return 'OpenAI API key is required for OpenAI image generation.';
      }
      if (
        provider === 'atlas-cloud'
        && !(imageConfig.atlasCloudApiKey || env.EXPO_PUBLIC_ATLAS_CLOUD_API_KEY || env.ATLAS_CLOUD_API_KEY)
      ) {
        return 'Atlas Cloud API key is required for Atlas Cloud image generation.';
      }
      return null;
    };
    const providerCredentialError = resolveProviderCredentialError();

    const characterForToken = (token?: string) =>
      resolveCharacterProfile(characterBible.characters, token);
    const collectCharacterIds = (beat: any): string[] => {
      const values = [
        ...(beat.visualCast?.foregroundCharacterIds || []),
        ...(beat.visualCast?.backgroundCharacterIds || []),
        ...(beat.visualCast?.activeCharacterIds || []),
        ...(beat.coveragePlan?.requiredVisibleCharacterIds || []),
        ...(beat.coveragePlan?.optionalVisibleCharacterIds || []),
        ...(beat.coveragePlan?.focalCharacterIds || []),
      ];
      const ids = values
        .map((value: string) => characterForToken(value)?.id)
        .filter((value): value is string => Boolean(value));
      if (ids.length === 0 && /\b(you|your|{{player\.)\b/i.test(beat.text || '') && brief.protagonist?.id) {
        ids.push(characterForToken(brief.protagonist.id)?.id || brief.protagonist.id);
      }
      return Array.from(new Set(ids));
    };
    const readReferenceImage = async (character: any): Promise<ReferenceImage | undefined> => {
      const candidates = [
        `${imageDir}ref_${character.id}_front.png`,
        `${imageDir}ref_${character.id}_front.jpg`,
        `${imageDir}ref_${character.id}_front.webp`,
      ];
      for (const candidate of candidates) {
        try {
          const data = await fs.readFile(candidate);
          const ext = nodePath.extname(candidate).toLowerCase();
          return {
            data: data.toString('base64'),
            mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png',
            role: 'character-reference',
            characterId: character.id,
            characterName: character.name,
            viewType: 'front',
            url: this.deps.servedUrlForGeneratedImagePath(candidate),
          };
        } catch {
          // Try the next candidate.
        }
      }
      return undefined;
    };
    const buildPrompt = (params: { episode: Episode; scene: Scene; beat: Beat; beatIndex: number; characterIds: string[] }): ImagePrompt => {
      const { episode, scene, beat, beatIndex, characterIds } = params;
      const characterNames = characterIds
        .map(id => characterById.get(id)?.name)
        .filter(Boolean);
      const prompt = buildBeatImagePrompt({
        beatId: beat.id,
        beatText: beat.text || '',
        beatIndex,
        totalBeats: scene.beats?.length || 1,
        visualMoment: (beat as any).visualMoment,
        primaryAction: (beat as any).primaryAction,
        emotionalRead: (beat as any).emotionalRead,
        relationshipDynamic: (beat as any).relationshipDynamic,
        mustShowDetail: (beat as any).mustShowDetail,
        visibleTurn: (beat as any).visibleTurn,
        visualSubtextCue: (beat as any).visualSubtextCue,
        statusShift: (beat as any).statusShift,
        shotType: (beat as any).shotType,
        isClimaxBeat: (beat as any).isClimaxBeat,
        isKeyStoryBeat: (beat as any).isKeyStoryBeat,
        isChoicePayoff: (beat as any).isChoicePayoff || (beat as any).isChoiceBridge,
        foregroundCharacterNames: characterNames,
        visualCast: (beat as any).visualCast,
        coveragePlan: (beat as any).coveragePlan,
        stagingPattern: (beat as any).coveragePlan?.stagingPattern,
        relationshipBlocking: (beat as any).coveragePlan?.relationshipBlocking,
        coverageReason: (beat as any).coveragePlan?.coverageReason,
      }, {
        sceneId: scene.id,
        sceneName: scene.name || scene.id,
        genre: brief.story?.genre || 'interactive fiction',
        tone: brief.story?.tone || (episode as Episode & { tone?: string }).tone || 'dramatic',
        mood: Array.isArray((scene as any).moodProgression) ? (scene as any).moodProgression.join(', ') : (scene as any).mood,
        settingContext: (scene as any).settingContext,
        artStyle: this.deps.config.artStyle || this.deps.config.imageGen?.gemini?.canonicalArtStyle,
        styleProfile: this.deps.config.imageGen?.artStyleProfile,
      });

      return prompt;
    };

    for (const target of uniqueTargets) {
      const episode = (story.episodes || []).find(candidate => candidate.number === target.episodeNumber);
      const scene = episode?.scenes?.find(candidate => candidate.id === target.sceneId);
      const beatIndex = scene?.beats?.findIndex(candidate => candidate.id === target.beatId) ?? -1;
      const beat = beatIndex >= 0 ? scene?.beats?.[beatIndex] : undefined;
      const scopedSceneId = `episode-${target.episodeNumber}-${target.sceneId}`;
      const slotId = `story-beat:${scopedSceneId}::${target.beatId}`;
      const previousUrl = (beat as any)?.image || '';
      const missingRecord: {
        slotId: string; family: string; episodeNumber: number; sceneId: string;
        beatId: string; fieldPath: string; reason: string; status: string;
        previousUrl: string | undefined; generatedUrl?: string; error?: string;
      } = {
        slotId,
        family: 'story-beat',
        episodeNumber: target.episodeNumber,
        sceneId: target.sceneId,
        beatId: target.beatId,
        fieldPath: `episodes[].scenes[id=${target.sceneId}].beats[id=${target.beatId}].image`,
        reason: previousUrl ? 'targeted_regeneration_requested' : 'missing_targeted_beat_image',
        status: 'pending',
        previousUrl,
      };
      missingSlotRecords.push(missingRecord);

      if (!episode || !scene || !beat) {
        missingRecord.status = 'error';
        const error = `Target beat not found: episode ${target.episodeNumber}, scene ${target.sceneId}, beat ${target.beatId}`;
        reportTargets.push({ ...target, status: 'error', error, previousUrl });
        continue;
      }

      const characterIds = collectCharacterIds(beat as any);
      const characters = characterIds.map(id => characterById.get(id)).filter(Boolean);
      const references: ReferenceImage[] = [];
      const warnings: string[] = [];
      if (options.skipCharacterRefs === false) {
        warnings.push('Spot backfill does not regenerate missing character references; using already available references only.');
      }
      for (const character of characters) {
        const ref = await readReferenceImage(character);
        if (ref) {
          references.push(ref);
        } else {
          warnings.push(`No existing reference image found for ${character.name || character.id}; rendering without regenerating references.`);
        }
      }

      const prompt = buildPrompt({ episode, scene, beat, beatIndex, characterIds });
      const identifier = `${storyBeatBaseIdentifier(scopedSceneId, target.beatId)}-spot-${Date.now()}`;
      let generatedUrl = '';
      let imagePath = '';
      let promptPath = `${promptDir}${identifier}.json`;
      const metadata = {
        type: 'beat',
        sceneId: target.sceneId,
        beatId: target.beatId,
        baseIdentifier: identifier,
        characterNames: characters.map((character: any) => character.name).filter(Boolean),
        characterDescriptions: characters.map((character: any) => ({
          id: character.id,
          name: character.name,
          description: character.physicalDescription || character.description || character.overview || '',
          appearance: character.physicalDescription || character.description || character.overview || '',
        })),
        regeneration: previousUrl ? 1 : undefined,
      };
      await fs.writeFile(promptPath, JSON.stringify({
        identifier,
        metadata,
        prompt,
        references: references.map(ref => ({
          role: ref.role,
          characterId: ref.characterId,
          characterName: ref.characterName,
          viewType: ref.viewType,
          url: ref.url,
        })),
      }, null, 2));
      try {
        if (providerCredentialError) throw new Error(providerCredentialError);
        const result = await this.deps.imageService.generateImage(prompt, identifier, metadata as Parameters<ImageGenerationService['generateImage']>[2], references);
        generatedUrl = result.imageUrl || (result.imagePath ? this.deps.servedUrlForGeneratedImagePath(result.imagePath) : '');
        imagePath = result.imagePath || '';
        if (!generatedUrl) throw new Error('Image provider did not return an image URL.');
        (beat as any).image = generatedUrl;
        missingRecord.status = 'patched';
        missingRecord.generatedUrl = generatedUrl;
        reportTargets.push({
          ...target,
          status: 'patched',
          previousUrl,
          generatedUrl,
          imagePath,
          promptPath,
          referencesUsed: references.map(ref => ref.characterName || ref.characterId || ref.role),
          warnings,
          patchedStoryPackage: true,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        missingRecord.status = 'error';
        missingRecord.error = msg;
        reportTargets.push({
          ...target,
          status: 'error',
          previousUrl,
          promptPath,
          referencesUsed: references.map(ref => ref.characterName || ref.characterId || ref.role),
          warnings,
          error: msg,
          patchedStoryPackage: false,
        });
      }
    }

    const failed = reportTargets.filter(target => target.status === 'error');
    const patchedCount = reportTargets.filter(target => target.status === 'patched').length;

    await saveEarlyDiagnostic(normalizedOutputDir, 'missing-image-slots.json', {
      generatedAt: new Date().toISOString(),
      mode: 'spot',
      slots: missingSlotRecords,
    });
    await saveEarlyDiagnostic(normalizedOutputDir, 'spot-image-backfill-report.json', {
      generatedAt: new Date().toISOString(),
      mode: 'spot',
      options: {
        skipEncounterImages: options.skipEncounterImages !== false,
        skipCover: options.skipCover !== false,
        skipCharacterRefs: options.skipCharacterRefs !== false,
        skipVisualContractValidation: options.skipVisualContractValidation !== false,
      },
      targets: reportTargets,
    });
    let outputManifest: Awaited<ReturnType<typeof writeFinalStoryPackage>> | undefined;
    if (patchedCount > 0) {
      story.outputDir = normalizedOutputDir;
      const manifest = this.deps.buildImageManifestFromStory(story);
      story.imagesStatus = failed.length > 0
        ? 'partial'
        : manifest.imagesStatus === 'pending'
          ? 'partial'
          : manifest.imagesStatus;
      await this.deps.saveDraftImageManifest(normalizedOutputDir, story);
      outputManifest = await writeFinalStoryPackage(normalizedOutputDir, story, {
        generator: (storyPackage as any)?.generator || this.deps.buildStoryGeneratorMetadata(),
      });
    }

    this.deps.emit({
      type: failed.length > 0 ? 'warning' : 'phase_complete',
      phase: 'images',
      message: failed.length > 0
        ? `Spot image backfill patched ${reportTargets.length - failed.length}/${reportTargets.length} target beat image(s).`
        : `Spot image backfill patched ${reportTargets.length} target beat image(s).`,
      data: { targets: reportTargets },
    });

    return {
      success: failed.length === 0,
      story,
      worldBible,
      characterBible,
      choiceSets: loadEarlyDiagnosticSync<ChoiceSet[]>(normalizedOutputDir, '05-choice-sets.json') || [],
      encounters: loadEarlyDiagnosticSync<EncounterStructure[]>(normalizedOutputDir, '05b-encounters.json') || [],
      checkpoints: this.deps.checkpoints,
      events: this.deps.events,
      duration: Date.now() - startTime,
      outputDirectory: normalizedOutputDir,
      outputManifest: outputManifest as unknown as OutputManifest,
      error: failed.length > 0 ? failed.map(target => target.error).join(' ') : undefined,
    };
  }
}
