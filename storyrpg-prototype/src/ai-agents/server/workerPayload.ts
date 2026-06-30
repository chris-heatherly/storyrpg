import type { CompileEpisodeRequest } from '../pipeline/episodeCompiler';

type EndingMode = 'single' | 'multiple';

export type WorkerMode = 'analysis' | 'generation' | 'image-generation' | 'compile-episode';

export type ResumeCheckpointPayload = {
  steps?: Record<string, { status?: string }>;
  outputs?: Record<string, unknown>;
};

export type WorkerPayload = {
  mode: WorkerMode;
  config: Record<string, unknown>;
  externalJobId?: string;
  friendlyName?: string;
  processTitle?: string;
  resultPath: string;
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
    sourceAnalysis?: Record<string, unknown>;
    episodeRange?: { start: number; end: number; specific?: number[] };
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

export type WorkerJobStartPayload = Omit<WorkerPayload, 'mode' | 'resumeCheckpoint'>;

export type WorkerJobStartRequest = {
  mode: WorkerMode;
  payload: WorkerJobStartPayload;
  idempotencyKey: string;
  storyTitle: string;
  episodeCount?: number;
  resumeFromJobId?: string;
};

export type WorkerJobStartResponse = {
  success: boolean;
  jobId: string;
  friendlyName?: string;
  processTitle?: string;
  deduped?: boolean;
  status?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

export function assertValidWorkerPayload(value: unknown): asserts value is WorkerPayload {
  if (!isRecord(value)) {
    throw new Error('Worker payload must be an object.');
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
    if (!isRecord(value.generationInput.brief)) {
      throw new Error('generationInput.brief is required for generation mode.');
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
