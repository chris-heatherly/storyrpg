import type { PipelineConfig } from '../config';
import type { FullCreativeBrief } from '../pipeline/FullStoryPipeline';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { GeneratorLlmProvider } from '../../config/generatorLlmOptions';
import {
  resolveTaskAssignments,
  type TaskModelOverrides,
} from '../../config/modelFamilies';
import {
  buildPipelineConfig,
  type BuildPipelineConfigInput,
  type PipelineConfigExtras,
} from '../config/buildPipelineConfig';
import {
  WORKER_JOB_PROTOCOL_VERSION,
  type WorkerJobStartRequest,
} from '../server/workerPayload';
import {
  assertGenerationPreflight,
  buildGenerationManifest,
  generationArtifactHash,
  normalizeRequestedEpisodes,
} from '../pipeline/generationPreflight';

export const GENERATION_LAUNCH_SERVICE_VERSION = 1 as const;
export type ProviderPolicy = 'configured' | 'gemini-only';
export type AnalysisWorkerJobStartRequest = Extract<WorkerJobStartRequest, { mode: 'analysis' }>;
export type GenerationWorkerJobStartRequest = Extract<WorkerJobStartRequest, { mode: 'generation' }>;

export type GeneratorPipelineConfigInput = Omit<BuildPipelineConfigInput, 'taskAssignments'> & {
  modelFamily: GeneratorLlmProvider;
  taskModelOverrides?: TaskModelOverrides;
};

export interface PreparedGenerationJob {
  request: GenerationWorkerJobStartRequest;
  brief: FullCreativeBrief;
  configHash: string;
  manifestHash: string;
  launchServiceVersion: typeof GENERATION_LAUNCH_SERVICE_VERSION;
}

function wireClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function assertProviderPolicy(config: PipelineConfig, policy: ProviderPolicy): void {
  if (policy !== 'gemini-only') return;
  const nonGeminiAgents = Object.entries(config.agents || {})
    .filter(([, agent]) => agent && typeof agent === 'object' && 'provider' in agent)
    .filter(([, agent]) => (agent as { provider?: string }).provider !== 'gemini')
    .map(([name, agent]) => `${name}:${String((agent as { provider?: string }).provider || 'missing')}`);
  const memoryProvider = config.memory?.llm?.provider;
  if (memoryProvider && memoryProvider !== 'gemini') nonGeminiAgents.push(`memory:${memoryProvider}`);
  if (nonGeminiAgents.length > 0) {
    throw new Error(`Gemini-only launch contains non-Gemini routes: ${nonGeminiAgents.join(', ')}`);
  }
}

export function buildGeneratorPipelineConfig(
  input: GeneratorPipelineConfigInput,
  extras?: PipelineConfigExtras,
  providerPolicy: ProviderPolicy = 'configured',
): PipelineConfig {
  const taskAssignments = resolveTaskAssignments(input.modelFamily, input.taskModelOverrides);
  taskAssignments.image = { provider: input.imageLlmProvider, model: input.imageLlmModel };
  taskAssignments.video = { provider: input.videoLlmProvider, model: input.videoLlmModel };
  const config = buildPipelineConfig({ ...input, taskAssignments }, extras);
  assertProviderPolicy(config, providerPolicy);
  return config;
}

export function prepareAnalysisJob(input: {
  config: PipelineConfig;
  sourceText: string;
  title: string;
  prompt?: string;
  preferences?: {
    targetScenesPerEpisode?: number;
    targetChoicesPerEpisode?: number;
    pacing?: 'tight' | 'moderate' | 'expansive';
    endingMode?: 'single' | 'multiple';
  };
  providerPolicy?: ProviderPolicy;
  runId: string;
}): AnalysisWorkerJobStartRequest {
  assertProviderPolicy(input.config, input.providerPolicy || 'configured');
  return deepFreeze({
    protocolVersion: WORKER_JOB_PROTOCOL_VERSION,
    mode: 'analysis',
    payload: {
      config: wireClone(input.config) as unknown as Record<string, unknown>,
      analysisInput: {
        sourceText: input.sourceText,
        title: input.title,
        prompt: input.prompt,
        preferences: input.preferences,
      },
    },
    idempotencyKey: `analysis:${input.title}:${generationArtifactHash({ sourceText: input.sourceText, prompt: input.prompt, preferences: input.preferences })}:${input.runId}`,
    storyTitle: input.title,
    episodeCount: 1,
    launchMetadata: {
      launchServiceVersion: GENERATION_LAUNCH_SERVICE_VERSION,
      providerPolicy: input.providerPolicy || 'configured',
      configHash: generationArtifactHash(input.config),
    },
  });
}

export function prepareGenerationJob(input: {
  config: PipelineConfig;
  brief: FullCreativeBrief;
  sourceAnalysis?: SourceMaterialAnalysis | null;
  seasonPlan?: SeasonPlan | null;
  requestedEpisodes: number[];
  providerPolicy?: ProviderPolicy;
  runId: string;
  resumeFromJobId?: string;
}): PreparedGenerationJob {
  assertProviderPolicy(input.config, input.providerPolicy || 'configured');
  const requestedEpisodes = normalizeRequestedEpisodes(
    input.requestedEpisodes.length > 0
      ? {
          start: Math.min(...input.requestedEpisodes),
          end: Math.max(...input.requestedEpisodes),
          specific: input.requestedEpisodes,
        }
      : undefined,
    input.brief.episode.number,
  );
  const episodeRange = {
    start: Math.min(...requestedEpisodes),
    end: Math.max(...requestedEpisodes),
    specific: requestedEpisodes,
  };
  const brief: FullCreativeBrief = {
    ...input.brief,
    ...(input.seasonPlan ? { seasonPlan: input.seasonPlan } : {}),
  };
  const manifest = buildGenerationManifest({
    sourceAnalysis: input.sourceAnalysis,
    seasonPlan: input.seasonPlan,
    requestedEpisodes,
  });
  brief.generationManifest = manifest;
  assertGenerationPreflight({
    brief,
    sourceAnalysis: input.sourceAnalysis,
    episodeRange,
    manifest,
    fallbackEpisode: brief.episode.number,
  });

  const configHash = generationArtifactHash(input.config);
  const manifestHash = generationArtifactHash(manifest);
  const request: WorkerJobStartRequest = {
    protocolVersion: WORKER_JOB_PROTOCOL_VERSION,
    mode: 'generation',
    payload: {
      config: wireClone(input.config) as unknown as Record<string, unknown>,
      generationInput: {
        brief: wireClone(brief) as unknown as Record<string, unknown>,
        sourceAnalysis: input.sourceAnalysis
          ? wireClone(input.sourceAnalysis) as unknown as Record<string, unknown>
          : undefined,
        episodeRange,
        manifest: wireClone(manifest),
      },
    },
    idempotencyKey: `generation:${brief.story.title}:${manifestHash}:${input.runId}`,
    storyTitle: brief.story.title || 'Untitled Story',
    episodeCount: requestedEpisodes.length,
    resumeFromJobId: input.resumeFromJobId,
    launchMetadata: {
      launchServiceVersion: GENERATION_LAUNCH_SERVICE_VERSION,
      providerPolicy: input.providerPolicy || 'configured',
      configHash,
      manifestHash,
    },
  };
  return {
    brief,
    configHash,
    manifestHash,
    launchServiceVersion: GENERATION_LAUNCH_SERVICE_VERSION,
    request: deepFreeze(request),
  };
}
