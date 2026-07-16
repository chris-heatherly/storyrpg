import { SeasonPlannerAgent } from '../agents/SeasonPlannerAgent';
import { SemanticContractCompilerAgent } from '../agents/SemanticContractCompilerAgent';
import { AgentConfig, PipelineConfig } from '../config';
import {
  FullCreativeBrief,
  FullPipelineResult,
  FullStoryPipeline,
  PipelineEvent,
  SourceAnalysisResult,
} from '../pipeline/FullStoryPipeline';
import type { EndingMode, SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { SeasonPlan } from '../../types/seasonPlan';
import { compileAndApplyNarrativeContracts } from '../pipeline/narrativeContractCompiler';
import {
  assertGenerationPreflight,
  type GenerationManifest,
} from '../pipeline/generationPreflight';

type StoryAnalysisPreferences = {
  targetScenesPerEpisode?: number;
  targetChoicesPerEpisode?: number;
  pacing?: 'tight' | 'moderate' | 'expansive';
  endingMode?: EndingMode;
};

type ResumeCheckpoint = {
  steps?: Record<string, { status?: string }>;
  outputs?: Record<string, unknown>;
};

type PipelineHookOptions = {
  onPipelineCreated?: (pipeline: FullStoryPipeline) => void;
  onEvent?: (event: PipelineEvent) => void;
  onImageJobEvent?: (event: unknown) => void;
  onVideoJobEvent?: (event: unknown) => void;
};

export interface StoryAnalysisRequest extends PipelineHookOptions {
  config?: PipelineConfig;
  sourceText: string;
  title: string;
  prompt?: string;
  preferences?: StoryAnalysisPreferences;
  resumeCheckpoint?: ResumeCheckpoint;
  externalJobId?: string;
  onSourceAnalysisComplete?: (result: SourceAnalysisResult) => void;
}

export interface StoryAnalysisResponse {
  pipeline: FullStoryPipeline;
  analysisResult: SourceAnalysisResult;
  sourceAnalysis: SourceMaterialAnalysis;
  seasonPlan?: SeasonPlan;
  seasonPlanError?: string;
}

/** Analysis-mode workers may only complete once the Generator can start a run. */
export function assertAnalysisGenerationReady(
  result: Pick<StoryAnalysisResponse, 'seasonPlan' | 'seasonPlanError'>,
): asserts result is Pick<StoryAnalysisResponse, 'seasonPlan' | 'seasonPlanError'> & { seasonPlan: SeasonPlan } {
  if (!result.seasonPlan) {
    throw new Error(result.seasonPlanError || 'Source analysis completed without a valid season plan.');
  }
}

export interface StoryGenerationRequest extends PipelineHookOptions {
  config?: PipelineConfig;
  brief: FullCreativeBrief;
  sourceAnalysis?: SourceMaterialAnalysis;
  episodeRange?: { start: number; end: number; specific?: number[] };
  manifest?: GenerationManifest;
  resumeCheckpoint?: ResumeCheckpoint;
  externalJobId?: string;
}

export interface StoryGenerationResponse {
  pipeline: FullStoryPipeline;
  result: FullPipelineResult;
}

export interface ImageGenerationBatchRequest extends PipelineHookOptions {
  config?: PipelineConfig;
  outputDirectory: string;
  targetEpisodeNumber?: number;
  mode?: 'full' | 'spot';
  targetSlots?: Array<{ episodeNumber: number; sceneId: string; beatId: string }>;
  skipEncounterImages?: boolean;
  skipCover?: boolean;
  skipCharacterRefs?: boolean;
  skipVisualContractValidation?: boolean;
  resumeCheckpoint?: ResumeCheckpoint;
  externalJobId?: string;
}

const DEFAULT_ANALYSIS_PREFERENCES: StoryAnalysisPreferences = {
  targetScenesPerEpisode: 6,
  targetChoicesPerEpisode: 4,
  pacing: 'moderate',
};

function getSeasonPlannerConfig(config?: PipelineConfig): AgentConfig {
  const plannerConfig = config?.agents?.storyArchitect;
  if (plannerConfig) {
    return plannerConfig;
  }

  return {
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    apiKey: '',
    maxTokens: 32768,
    temperature: 0.7,
  };
}

function wirePipeline(pipeline: FullStoryPipeline, hooks: PipelineHookOptions): void {
  hooks.onPipelineCreated?.(pipeline);
  pipeline.onEvent((event) => hooks.onEvent?.(event));
  pipeline.imageService?.onEvent((event: unknown) => hooks.onImageJobEvent?.(event));
  pipeline.videoService?.onEvent((event: unknown) => hooks.onVideoJobEvent?.(event));
}

export async function runStoryAnalysis(request: StoryAnalysisRequest): Promise<StoryAnalysisResponse> {
  const pipeline = new FullStoryPipeline(request.config);
  if (request.externalJobId) {
    pipeline.setExternalJobId(request.externalJobId);
  }
  wirePipeline(pipeline, request);

  const preferences = request.preferences || DEFAULT_ANALYSIS_PREFERENCES;
  const sourceAlreadyDone = request.resumeCheckpoint?.steps?.source_analysis?.status === 'completed';
  const resumedAnalysis = request.resumeCheckpoint?.outputs?.source_analysis as SourceAnalysisResult | undefined;

  const analysisResult = sourceAlreadyDone && resumedAnalysis
    ? resumedAnalysis
    : await pipeline.analyzeSourceMaterial(
        request.sourceText,
        request.title,
        preferences,
        request.prompt,
      );
  if (!sourceAlreadyDone) request.onSourceAnalysisComplete?.(analysisResult);

  const seasonAlreadyDone = request.resumeCheckpoint?.steps?.season_plan?.status === 'completed';
  const resumedPlanResult = request.resumeCheckpoint?.outputs?.season_plan as
    | { success?: boolean; data?: SeasonPlan; error?: string }
    | undefined;

  const seasonPlanner = new SeasonPlannerAgent(getSeasonPlannerConfig(request.config));
  let seasonPlanResult = seasonAlreadyDone && resumedPlanResult
    ? resumedPlanResult
    : await seasonPlanner.execute({
        sourceAnalysis: analysisResult.analysis,
        preferences,
        storyCircleBlocking: request.config?.generation?.storyCircleBlocking,
      });

  if (seasonPlanResult.success && seasonPlanResult.data?.scenePlan) {
    try {
      // Artifact payloads may be recursively frozen. Canonical compilation has
      // runtime-only projection repairs, so it always receives an isolated copy.
      const workingPlan = JSON.parse(JSON.stringify(seasonPlanResult.data)) as SeasonPlan;
      let scenePlan = workingPlan.scenePlan!;
      if (!scenePlan.narrativeContractGraph) {
        scenePlan = compileAndApplyNarrativeContracts(workingPlan, scenePlan);
      }
      if (!scenePlan.semanticEventIr) {
        const semanticCompiler = new SemanticContractCompilerAgent(getSeasonPlannerConfig(request.config));
        const semanticResult = await semanticCompiler.execute(scenePlan);
        if (!semanticResult.success || !semanticResult.data) {
          throw new Error(semanticResult.error || 'Semantic contract compiler returned no IR.');
        }
        scenePlan = { ...scenePlan, semanticEventIr: semanticResult.data };
      }
      // F1.1 (Treatment Fidelity Plan): compile season secrets into
      // reveal-timing contracts once at analysis; downstream compilation turns
      // them into forbidden semantic atoms on every pre-reveal episode.
      // Best-effort — absence means no enforcement, never a failed analysis.
      if (!scenePlan.revealContracts) {
        const revealCompiler = new SemanticContractCompilerAgent(getSeasonPlannerConfig(request.config));
        const analysis = analysisResult.analysis;
        const episodes = (analysis?.episodeBreakdown ?? []).map((episode) => ({
          number: episode.episodeNumber,
          title: episode.title,
          summary: [episode.synopsis, episode.sourceSummary].filter(Boolean).join(' '),
        }));
        const seasonGuidance = analysis?.treatmentSeasonGuidance;
        const npcSecretNotes = (seasonGuidance?.npcGuidance ?? [])
          .filter((npc) => npc.secretOrContradiction?.trim())
          .map((npc) => `${npc.name}: ${npc.secretOrContradiction}`);
        const revealContracts = await revealCompiler.compileRevealContracts({
          episodes,
          npcSecretNotes,
          audiencePromise: seasonGuidance?.audiencePromise,
        });
        scenePlan = { ...scenePlan, revealContracts };
        if (revealContracts.length > 0) {
          console.log(`[Analysis] Compiled ${revealContracts.length} reveal-timing contract(s): ${revealContracts.map((contract) => `${contract.id}→ep${contract.revealEpisode}`).join(', ')}`);
        }
      }
      // G5 (treatment-gap analysis 2026-07-15): bind each episode's "live
      // season anchors" to their owning scene + a reader-visible planting
      // action. Downstream: advisory realization atoms on the owning scene,
      // and the first-sighting cast-order preflight. Best-effort like reveals.
      if (!scenePlan.anchorContracts) {
        const anchorCompiler = new SemanticContractCompilerAgent(getSeasonPlannerConfig(request.config));
        const analysis = analysisResult.analysis;
        const castNames = (analysis?.treatmentSeasonGuidance?.npcGuidance ?? [])
          .map((npc) => npc.name)
          .filter((name): name is string => Boolean(name?.trim()));
        const anchorContracts: import('../../types/narrativeContract').NarrativeAnchorContract[] = [];
        for (const episode of analysis?.episodeBreakdown ?? []) {
          const guidance = (episode as {
            treatmentGuidance?: { endingPressure?: string; encounterAftermath?: string; synopsis?: string };
          }).treatmentGuidance;
          const likelyConsequence = guidance?.endingPressure ?? guidance?.encounterAftermath ?? '';
          if (!likelyConsequence.trim()) continue;
          const scenes = scenePlan.scenes
            .filter((scene) => scene.episodeNumber === episode.episodeNumber)
            .map((scene) => ({ id: scene.id, order: scene.order, summary: `${scene.title}: ${scene.dramaticPurpose}` }));
          if (scenes.length === 0) continue;
          anchorContracts.push(...await anchorCompiler.compileAnchorContracts({
            episodeNumber: episode.episodeNumber,
            episodeOutline: [episode.synopsis, guidance?.synopsis].filter(Boolean).join(' '),
            likelyConsequence,
            scenes,
            castNames,
          }));
        }
        scenePlan = { ...scenePlan, anchorContracts };
        if (anchorContracts.length > 0) {
          console.info(`[Analysis] Compiled ${anchorContracts.length} season-anchor contract(s): ${anchorContracts.map((anchor) => `${anchor.anchorName}→${anchor.owningSceneId}`).join(', ')}`);
        }
      }
      scenePlan = compileAndApplyNarrativeContracts(workingPlan, scenePlan);
      workingPlan.scenePlan = scenePlan;
      for (const episode of workingPlan.episodes ?? []) {
        episode.plannedScenes = scenePlan.scenes
          .filter((scene) => scene.episodeNumber === episode.episodeNumber)
          .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
      }
      workingPlan.notes ??= [];
      const semanticNote = `Semantic contract IR: ${scenePlan.semanticEventIr?.events.length ?? 0} depiction events compiled by ${scenePlan.semanticEventIr?.provider}/${scenePlan.semanticEventIr?.model}.`;
      if (!workingPlan.notes.includes(semanticNote)) workingPlan.notes.push(semanticNote);
      seasonPlanResult = { ...seasonPlanResult, data: workingPlan };
    } catch (error) {
      seasonPlanResult = {
        success: false,
        error: `[SemanticContractIRGate] ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    pipeline,
    analysisResult,
    sourceAnalysis: analysisResult.analysis,
    seasonPlan: seasonPlanResult.success ? seasonPlanResult.data : undefined,
    seasonPlanError: seasonPlanResult.success ? undefined : seasonPlanResult.error,
  };
}

export async function runStoryGeneration(request: StoryGenerationRequest): Promise<StoryGenerationResponse> {
  assertGenerationPreflight({
    brief: request.brief,
    sourceAnalysis: request.sourceAnalysis,
    episodeRange: request.episodeRange,
    manifest: request.manifest ?? request.brief.generationManifest,
    fallbackEpisode: request.brief.episode?.number || 1,
  });
  const effectiveConfig = request.config?.generation?.assetGenerationMode === 'story-only'
    ? {
        ...request.config,
        imageGen: request.config.imageGen ? { ...request.config.imageGen, enabled: false } : { enabled: false },
        videoGen: request.config.videoGen ? { ...request.config.videoGen, enabled: false } : request.config.videoGen,
      }
    : request.config;
  const pipeline = new FullStoryPipeline(effectiveConfig);
  if (request.externalJobId) {
    pipeline.setExternalJobId(request.externalJobId);
  }
  wirePipeline(pipeline, request);

  const result = request.sourceAnalysis
    ? await pipeline.generateMultipleEpisodes(
        request.brief,
        request.sourceAnalysis,
        request.episodeRange || { start: 1, end: Math.max(1, request.brief.episode?.number || 1) },
        request.resumeCheckpoint,
      )
    : await pipeline.generate(request.brief, request.resumeCheckpoint);

  return {
    pipeline,
    result,
  };
}

export async function runImageGenerationBatch(request: ImageGenerationBatchRequest): Promise<StoryGenerationResponse> {
  const isSpotMode = request.mode === 'spot' || Boolean(request.targetSlots?.length);
  const effectiveConfig = request.config
    ? {
        ...request.config,
        generation: {
          ...request.config.generation,
          assetGenerationMode: 'image-only' as const,
        },
        imageGen: request.config.imageGen
          ? { ...request.config.imageGen, enabled: true, strategy: 'all-beats' as const }
          : { enabled: true, strategy: 'all-beats' as const },
      }
    : request.config;
  const pipeline = new FullStoryPipeline(effectiveConfig);
  if (request.externalJobId) {
    pipeline.setExternalJobId(request.externalJobId);
  }
  wirePipeline(pipeline, request);

  const result = isSpotMode
    ? await pipeline.generateTargetedBeatImagesForDraft(request.outputDirectory, request.targetSlots || [], {
        skipEncounterImages: request.skipEncounterImages ?? true,
        skipCover: request.skipCover ?? true,
        skipCharacterRefs: request.skipCharacterRefs ?? true,
        skipVisualContractValidation: request.skipVisualContractValidation ?? true,
      })
    : await pipeline.generateImagesForDraft(request.outputDirectory, request.resumeCheckpoint, {
        targetEpisodeNumber: request.targetEpisodeNumber,
      });

  return {
    pipeline,
    result,
  };
}
