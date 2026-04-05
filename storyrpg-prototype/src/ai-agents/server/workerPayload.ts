type EndingMode = 'single' | 'multiple';

export type WorkerMode = 'analysis' | 'generation';

export type ResumeCheckpointPayload = {
  steps?: Record<string, { status?: string }>;
  outputs?: Record<string, unknown>;
};

export type WorkerPayload = {
  mode: WorkerMode;
  config: Record<string, unknown>;
  externalJobId?: string;
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

export function assertValidWorkerPayload(value: unknown): asserts value is WorkerPayload {
  if (!isRecord(value)) {
    throw new Error('Worker payload must be an object.');
  }
  if (value.mode !== 'analysis' && value.mode !== 'generation') {
    throw new Error('Worker payload mode must be "analysis" or "generation".');
  }
  if (!isRecord(value.config)) {
    throw new Error('Worker payload is missing a valid config object.');
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
}
