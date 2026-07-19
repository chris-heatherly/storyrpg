import type { CompileEpisodeRequest } from '../pipeline/episodeCompiler';
import { createHash } from 'node:crypto';
import type { GenerationManifest } from '../pipeline/generationPreflight';
import type { GenerationIdentityResolution } from '../launch/compileGenerationBrief';

type EndingMode = 'single' | 'multiple';

export const WORKER_JOB_PROTOCOL_VERSION = 2 as const;
export const VARIANT_BATCH_PROTOCOL_VERSION = 1 as const;
export const MAX_VARIANTS_PER_BATCH = 4 as const;

export type WorkerMode = 'analysis' | 'generation' | 'image-generation' | 'compile-episode';

export type GenerationRunContext =
  | { kind: 'standard' }
  | {
      kind: 'variant';
      batchId: string;
      variantId: string;
      ordinal: number;
      total: number;
      sharedAnalysisHash?: string;
      sharedSeasonPlanHash?: string;
    };

export type ResumeCheckpointPayload = {
  steps?: Record<string, { status?: string }>;
  outputs?: Record<string, unknown>;
};

export type WorkerPayload = {
  protocolVersion: typeof WORKER_JOB_PROTOCOL_VERSION;
  mode: WorkerMode;
  config: Record<string, unknown>;
  externalJobId?: string;
  friendlyName?: string;
  processTitle?: string;
  resultPath: string;
  /** Immutable hash of hydrated provider/model/media/council settings. */
  jobConfigHash?: string;
  resumeCheckpoint?: ResumeCheckpointPayload;
  analysisInput?: {
    sourceText: string;
    title: string;
    prompt?: string;
    preferences?: {
      targetScenesPerEpisode?: number;
      targetChoicesPerEpisode?: number;
      pacing?: 'tight' | 'moderate' | 'expansive';
      endingMode?: EndingMode;
    };
  };
  generationInput?: {
    brief: Record<string, unknown>;
    identityResolution?: GenerationIdentityResolution;
    sourceAnalysis?: Record<string, unknown>;
    episodeRange?: { start: number; end: number; specific?: number[] };
    manifest: GenerationManifest;
    runContext?: GenerationRunContext;
  };
  imageGenerationInput?: {
    outputDirectory: string;
    targetEpisodeNumber?: number;
    mode?: 'full' | 'spot';
    targetSlots?: Array<{ episodeNumber: number; sceneId: string; beatId: string }>;
    skipEncounterImages?: boolean;
    skipCover?: boolean;
    skipCharacterRefs?: boolean;
    skipVisualContractValidation?: boolean;
  };
  compileEpisodeInput?: {
    outputDirectory: string;
    request: CompileEpisodeRequest;
  };
};

export type WorkerJobStartPayload = Omit<
  WorkerPayload,
  | 'protocolVersion'
  | 'mode'
  | 'externalJobId'
  | 'friendlyName'
  | 'processTitle'
  | 'resultPath'
  | 'jobConfigHash'
  | 'resumeCheckpoint'
>;

export type WorkerLaunchMetadata = {
  launchServiceVersion: number;
  providerPolicy: 'configured' | 'gemini-only';
  configHash?: string;
  manifestHash?: string;
};

type WorkerJobStartRequestBase = {
  protocolVersion: typeof WORKER_JOB_PROTOCOL_VERSION;
  idempotencyKey: string;
  storyTitle: string;
  episodeCount?: number;
  resumeFromJobId?: string;
};

export type WorkerJobStartRequest =
  | (WorkerJobStartRequestBase & {
      mode: 'analysis';
      payload: Pick<WorkerJobStartPayload, 'config' | 'analysisInput'> & Required<Pick<WorkerJobStartPayload, 'analysisInput'>>;
      launchMetadata: WorkerLaunchMetadata;
    })
  | (WorkerJobStartRequestBase & {
      mode: 'generation';
      payload: Pick<WorkerJobStartPayload, 'config' | 'generationInput'> & Required<Pick<WorkerJobStartPayload, 'generationInput'>>;
      launchMetadata: WorkerLaunchMetadata;
    })
  | (WorkerJobStartRequestBase & {
      mode: 'image-generation';
      payload: Pick<WorkerJobStartPayload, 'config' | 'imageGenerationInput'> & Required<Pick<WorkerJobStartPayload, 'imageGenerationInput'>>;
      launchMetadata?: WorkerLaunchMetadata;
    })
  | (WorkerJobStartRequestBase & {
      mode: 'compile-episode';
      payload: Pick<WorkerJobStartPayload, 'config' | 'compileEpisodeInput'> & Required<Pick<WorkerJobStartPayload, 'compileEpisodeInput'>>;
      launchMetadata?: WorkerLaunchMetadata;
    });

export type WorkerJobStartResponse = {
  success: boolean;
  jobId: string;
  friendlyName?: string;
  processTitle?: string;
  deduped?: boolean;
  status?: string;
};

export type GenerationWorkerJobStartRequest = Extract<WorkerJobStartRequest, { mode: 'generation' }>;

export interface VariantBatchStartRequest {
  version: typeof VARIANT_BATCH_PROTOCOL_VERSION;
  kind: 'variant-batch';
  idempotencyKey: string;
  storyTitle: string;
  variantCount: number;
  requests: GenerationWorkerJobStartRequest[];
}

export interface VariantBatchChildStartResponse {
  jobId: string;
  variantId: string;
  ordinal: number;
  friendlyName?: string;
  processTitle?: string;
}

export interface VariantBatchStartResponse {
  success: boolean;
  batchId: string;
  children: VariantBatchChildStartResponse[];
  deduped?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stableConfigJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableConfigJson(record[key])}`).join(',')}}`;
}

export function computeWorkerJobConfigHash(mode: WorkerMode, config: Record<string, unknown>): string {
  return createHash('sha256').update(stableConfigJson({ mode, config })).digest('hex');
}

export function assertWorkerJobConfigHash(payload: WorkerPayload): void {
  if (!payload.jobConfigHash) throw new Error('Worker payload is missing immutable jobConfigHash.');
  const actual = computeWorkerJobConfigHash(payload.mode, payload.config);
  if (actual !== payload.jobConfigHash) {
    throw new Error(`Worker job config hash mismatch: expected ${payload.jobConfigHash}, received ${actual}.`);
  }
}

function isResumeCheckpoint(value: unknown): value is ResumeCheckpointPayload | undefined {
  if (value == null) return true;
  if (!isRecord(value)) return false;
  return (
    (value.steps == null || isRecord(value.steps))
    && (value.outputs == null || isRecord(value.outputs))
  );
}

function isValidTargetSlot(value: unknown): value is { episodeNumber: number; sceneId: string; beatId: string } {
  if (!isRecord(value)) return false;
  return (
    typeof value.episodeNumber === 'number'
    && Number.isFinite(value.episodeNumber)
    && value.episodeNumber >= 1
    && typeof value.sceneId === 'string'
    && value.sceneId.length > 0
    && typeof value.beatId === 'string'
    && value.beatId.length > 0
  );
}

function isValidGenerationRunContext(value: unknown): value is GenerationRunContext | undefined {
  if (value == null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === 'standard') return true;
  return value.kind === 'variant'
    && typeof value.batchId === 'string'
    && value.batchId.length > 0
    && typeof value.variantId === 'string'
    && value.variantId.length > 0
    && typeof value.ordinal === 'number'
    && Number.isInteger(value.ordinal)
    && value.ordinal >= 1
    && typeof value.total === 'number'
    && Number.isInteger(value.total)
    && value.total >= 2
    && value.total <= MAX_VARIANTS_PER_BATCH
    && value.ordinal <= value.total
    && (value.sharedAnalysisHash == null || typeof value.sharedAnalysisHash === 'string')
    && (value.sharedSeasonPlanHash == null || typeof value.sharedSeasonPlanHash === 'string');
}

function isValidGenerationManifest(value: unknown): value is GenerationManifest {
  if (!isRecord(value)) return false;
  const validSourceKinds = ['invent', 'authored', 'authored_lite', 'derived_from_lite'];
  return (
    value.version === 1
    && typeof value.sourceKind === 'string'
    && validSourceKinds.includes(value.sourceKind)
    && Array.isArray(value.requestedEpisodes)
    && value.requestedEpisodes.length > 0
    && value.requestedEpisodes.every((episode) => typeof episode === 'number' && Number.isInteger(episode) && episode > 0)
    && (value.sourceAnalysisHash == null || typeof value.sourceAnalysisHash === 'string')
    && (value.seasonPlanId == null || typeof value.seasonPlanId === 'string')
    && (value.seasonPlanHash == null || typeof value.seasonPlanHash === 'string')
    && (value.narrativeGraphHash == null || typeof value.narrativeGraphHash === 'string')
    && (value.compilerVersion == null || typeof value.compilerVersion === 'string')
  );
}

export function assertValidWorkerPayload(value: unknown): asserts value is WorkerPayload {
  if (!isRecord(value)) {
    throw new Error('Worker payload must be an object.');
  }
  if (value.protocolVersion !== WORKER_JOB_PROTOCOL_VERSION) {
    throw new Error(`Worker payload protocolVersion must be ${WORKER_JOB_PROTOCOL_VERSION}.`);
  }
  if (value.mode !== 'analysis' && value.mode !== 'generation' && value.mode !== 'image-generation' && value.mode !== 'compile-episode') {
    throw new Error('Worker payload mode must be "analysis", "generation", "image-generation", or "compile-episode".');
  }
  if (!isRecord(value.config)) {
    throw new Error('Worker payload is missing a valid config object.');
  }
  if (value.friendlyName != null && typeof value.friendlyName !== 'string') {
    throw new Error('Worker payload friendlyName must be a string when provided.');
  }
  if (value.processTitle != null && typeof value.processTitle !== 'string') {
    throw new Error('Worker payload processTitle must be a string when provided.');
  }
  if (typeof value.resultPath !== 'string' || value.resultPath.length === 0) {
    throw new Error('Worker payload is missing resultPath.');
  }
  if (value.jobConfigHash != null && (typeof value.jobConfigHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.jobConfigHash))) {
    throw new Error('Worker payload jobConfigHash must be a SHA-256 hex string.');
  }
  if (!isResumeCheckpoint(value.resumeCheckpoint)) {
    throw new Error('Worker payload resumeCheckpoint is malformed.');
  }

  if (value.mode === 'analysis') {
    if (!isRecord(value.analysisInput)) {
      throw new Error('analysisInput is required for analysis mode.');
    }
    if (typeof value.analysisInput.sourceText !== 'string' || typeof value.analysisInput.title !== 'string') {
      throw new Error('analysisInput must include sourceText and title.');
    }
  }

  if (value.mode === 'generation') {
    if (!isRecord(value.generationInput)) {
      throw new Error('generationInput is required for generation mode.');
    }
    if (!isValidGenerationRunContext(value.generationInput.runContext)) {
      throw new Error('generationInput.runContext is malformed.');
    }
    if (!isRecord(value.generationInput.brief)) {
      throw new Error('generationInput.brief is required for generation mode.');
    }
    if (!isValidGenerationManifest(value.generationInput.manifest)) {
      throw new Error('generationInput.manifest is malformed.');
    }
  }

  if (value.mode === 'image-generation') {
    if (!isRecord(value.imageGenerationInput)) {
      throw new Error('imageGenerationInput is required for image-generation mode.');
    }
    if (typeof value.imageGenerationInput.outputDirectory !== 'string' || value.imageGenerationInput.outputDirectory.length === 0) {
      throw new Error('imageGenerationInput.outputDirectory is required for image-generation mode.');
    }
    if (
      value.imageGenerationInput.targetEpisodeNumber != null
      && (
        typeof value.imageGenerationInput.targetEpisodeNumber !== 'number'
        || !Number.isFinite(value.imageGenerationInput.targetEpisodeNumber)
        || value.imageGenerationInput.targetEpisodeNumber < 1
      )
    ) {
      throw new Error('imageGenerationInput.targetEpisodeNumber must be a positive number.');
    }
    if (
      value.imageGenerationInput.mode != null
      && value.imageGenerationInput.mode !== 'full'
      && value.imageGenerationInput.mode !== 'spot'
    ) {
      throw new Error('imageGenerationInput.mode must be "full" or "spot".');
    }
    if (value.imageGenerationInput.targetSlots != null) {
      if (!Array.isArray(value.imageGenerationInput.targetSlots)) {
        throw new Error('imageGenerationInput.targetSlots must be an array.');
      }
      if (value.imageGenerationInput.targetSlots.length === 0) {
        throw new Error('imageGenerationInput.targetSlots must include at least one target slot.');
      }
      if (!value.imageGenerationInput.targetSlots.every(isValidTargetSlot)) {
        throw new Error('imageGenerationInput.targetSlots entries must include positive episodeNumber, sceneId, and beatId.');
      }
    }
  }

  if (value.mode === 'compile-episode') {
    if (!isRecord(value.compileEpisodeInput)) {
      throw new Error('compileEpisodeInput is required for compile-episode mode.');
    }
    if (typeof value.compileEpisodeInput.outputDirectory !== 'string' || value.compileEpisodeInput.outputDirectory.length === 0) {
      throw new Error('compileEpisodeInput.outputDirectory is required for compile-episode mode.');
    }
    if (!isRecord(value.compileEpisodeInput.request)) {
      throw new Error('compileEpisodeInput.request is required for compile-episode mode.');
    }
    if (typeof value.compileEpisodeInput.request.storyRunId !== 'string' || value.compileEpisodeInput.request.storyRunId.length === 0) {
      throw new Error('compileEpisodeInput.request.storyRunId is required for compile-episode mode.');
    }
    if (
      typeof value.compileEpisodeInput.request.episodeNumber !== 'number'
      || !Number.isFinite(value.compileEpisodeInput.request.episodeNumber)
      || value.compileEpisodeInput.request.episodeNumber < 1
    ) {
      throw new Error('compileEpisodeInput.request.episodeNumber must be a positive number.');
    }
    if (
      typeof value.compileEpisodeInput.request.totalEpisodes !== 'number'
      || !Number.isFinite(value.compileEpisodeInput.request.totalEpisodes)
      || value.compileEpisodeInput.request.totalEpisodes < 1
    ) {
      throw new Error('compileEpisodeInput.request.totalEpisodes must be a positive number.');
    }
  }
}
