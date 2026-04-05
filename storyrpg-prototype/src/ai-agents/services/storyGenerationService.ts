import { SeasonPlannerAgent } from '../agents/SeasonPlannerAgent';
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
}

export interface StoryAnalysisResponse {
  pipeline: FullStoryPipeline;
  analysisResult: SourceAnalysisResult;
  sourceAnalysis: SourceMaterialAnalysis;
  seasonPlan?: SeasonPlan;
  seasonPlanError?: string;
}

export interface StoryGenerationRequest extends PipelineHookOptions {
  config?: PipelineConfig;
  brief: FullCreativeBrief;
  sourceAnalysis?: SourceMaterialAnalysis;
  episodeRange?: { start: number; end: number; specific?: number[] };
  resumeCheckpoint?: ResumeCheckpoint;
  externalJobId?: string;
}

export interface StoryGenerationResponse {
  pipeline: FullStoryPipeline;
  result: FullPipelineResult;
}

const DEFAULT_ANALYSIS_PREFERENCES: StoryAnalysisPreferences = {
  targetScenesPerEpisode: 8,
  targetChoicesPerEpisode: 4,
  pacing: 'moderate',
};

function getSeasonPlannerConfig(config?: PipelineConfig): AgentConfig {
  const plannerConfig = config?.agents?.storyArchitect;
  if (plannerConfig) {
    return plannerConfig;
  }

  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
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

  const seasonAlreadyDone = request.resumeCheckpoint?.steps?.season_plan?.status === 'completed';
  const resumedPlanResult = request.resumeCheckpoint?.outputs?.season_plan as
    | { success?: boolean; data?: SeasonPlan; error?: string }
    | undefined;

  const seasonPlanner = new SeasonPlannerAgent(getSeasonPlannerConfig(request.config));
  const seasonPlanResult = seasonAlreadyDone && resumedPlanResult
    ? resumedPlanResult
    : await seasonPlanner.execute({
        sourceAnalysis: analysisResult.analysis,
        preferences,
      });

  return {
    pipeline,
    analysisResult,
    sourceAnalysis: analysisResult.analysis,
    seasonPlan: seasonPlanResult.success ? seasonPlanResult.data : undefined,
    seasonPlanError: seasonPlanResult.success ? undefined : seasonPlanResult.error,
  };
}

export async function runStoryGeneration(request: StoryGenerationRequest): Promise<StoryGenerationResponse> {
  const pipeline = new FullStoryPipeline(request.config);
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
