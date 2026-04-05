export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PipelineEventData {
  type:
    | 'phase_start'
    | 'phase_complete'
    | 'agent_start'
    | 'agent_complete'
    | 'error'
    | 'checkpoint'
    | 'debug'
    | 'warning'
    | 'incremental_validation'
    | 'regeneration_triggered'
    | 'validation_aggregated';
  phase?: string;
  agent?: string;
  message: string;
  timestamp: string;
  telemetry?: {
    overallProgress?: number;
    phaseProgress?: number;
    currentItem?: number;
    totalItems?: number;
    subphaseLabel?: string;
    etaSeconds?: number | null;
    elapsedSeconds?: number;
  };
}

export interface GenerationJobCheckpoint {
  briefJson?: string;
  completedPhases?: string[];
  lastSuccessfulPhase?: string;
  sourceAnalysisJson?: string;
  blueprintsJson?: string;
  scenesJson?: string;
  isResumable?: boolean;
  resumeHint?: string;
  failureContext?: {
    message?: string;
    failurePhase?: string;
    failureStepId?: string;
    failureKind?: string;
    failureArtifactKey?: string;
    resumeFromStepId?: string;
    resumePatchableInputs?: string[];
    context?: Record<string, unknown>;
    patchedPayload?: Record<string, unknown>;
    patchedOutputs?: Record<string, unknown>;
    timestamp?: string;
  };
  resumeContext?: {
    mode?: string;
    requestPayload?: Record<string, unknown>;
    storyTitle?: string;
    episodeCount?: number;
    resumeFromJobId?: string;
    resumedAt?: string;
    changedInputs?: string[];
    changedOutputs?: string[];
  };
  outputs?: Record<string, unknown>;
}

export interface GenerationJob {
  id: string;
  storyTitle: string;
  startedAt: string;
  updatedAt: string;
  status: JobStatus;
  currentPhase: string;
  progress: number;
  episodeCount: number;
  currentEpisode: number;
  etaSeconds?: number | null;
  phaseProgress?: number;
  currentItem?: number;
  totalItems?: number;
  subphaseLabel?: string;
  error?: string;
  outputDir?: string;
  events?: PipelineEventData[];
  checkpoint?: GenerationJobCheckpoint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isJobStatus(value: unknown): value is JobStatus {
  return value === 'pending'
    || value === 'running'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled';
}

export function normalizePipelineEventData(value: unknown): PipelineEventData | null {
  if (!isRecord(value) || typeof value.message !== 'string' || typeof value.timestamp !== 'string' || typeof value.type !== 'string') {
    return null;
  }
  return {
    type: value.type as PipelineEventData['type'],
    phase: typeof value.phase === 'string' ? value.phase : undefined,
    agent: typeof value.agent === 'string' ? value.agent : undefined,
    message: value.message,
    timestamp: value.timestamp,
    telemetry: isRecord(value.telemetry)
      ? {
          overallProgress: typeof value.telemetry.overallProgress === 'number' ? value.telemetry.overallProgress : undefined,
          phaseProgress: typeof value.telemetry.phaseProgress === 'number' ? value.telemetry.phaseProgress : undefined,
          currentItem: typeof value.telemetry.currentItem === 'number' ? value.telemetry.currentItem : undefined,
          totalItems: typeof value.telemetry.totalItems === 'number' ? value.telemetry.totalItems : undefined,
          subphaseLabel: typeof value.telemetry.subphaseLabel === 'string' ? value.telemetry.subphaseLabel : undefined,
          etaSeconds: typeof value.telemetry.etaSeconds === 'number' || value.telemetry.etaSeconds === null
            ? value.telemetry.etaSeconds
            : undefined,
          elapsedSeconds: typeof value.telemetry.elapsedSeconds === 'number' ? value.telemetry.elapsedSeconds : undefined,
        }
      : undefined,
  };
}

export function normalizeGenerationJob(value: unknown): GenerationJob | null {
  if (!isRecord(value)) return null;
  if (!isJobStatus(value.status)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.storyTitle !== 'string'
    || typeof value.startedAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || typeof value.currentPhase !== 'string'
    || typeof value.progress !== 'number'
    || typeof value.episodeCount !== 'number'
    || typeof value.currentEpisode !== 'number'
  ) {
    return null;
  }

  const normalizedEvents = Array.isArray(value.events)
    ? value.events
        .map((event) => normalizePipelineEventData(event))
        .filter((event): event is PipelineEventData => event !== null)
    : undefined;

  return {
    id: value.id,
    storyTitle: value.storyTitle,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    status: value.status,
    currentPhase: value.currentPhase,
    progress: value.progress,
    episodeCount: value.episodeCount,
    currentEpisode: value.currentEpisode,
    etaSeconds: typeof value.etaSeconds === 'number' || value.etaSeconds === null ? value.etaSeconds : undefined,
    phaseProgress: typeof value.phaseProgress === 'number' ? value.phaseProgress : undefined,
    currentItem: typeof value.currentItem === 'number' ? value.currentItem : undefined,
    totalItems: typeof value.totalItems === 'number' ? value.totalItems : undefined,
    subphaseLabel: typeof value.subphaseLabel === 'string' ? value.subphaseLabel : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    outputDir: typeof value.outputDir === 'string' ? value.outputDir : undefined,
    events: normalizedEvents,
    checkpoint: isRecord(value.checkpoint) ? value.checkpoint as GenerationJobCheckpoint : undefined,
  };
}
