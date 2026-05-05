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
  projectId?: string;
  resumeFromJobId?: string;
  projectJobIds?: string[];
  attemptCount?: number;
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
  imageStats?: {
    generatedFiles?: number;
    referenceFiles?: number;
    storyFiles?: number;
    resolvedSlots?: number;
    totalSlots?: number;
    missingSlots?: number;
  };
  generatedImageCount?: number;
  referenceImageCount?: number;
  storyImageCount?: number;
  resolvedImageSlotCount?: number;
  totalImageSlotCount?: number;
  missingImageSlotCount?: number;
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
          etaSeconds: typeof value.telemetry.etaSeconds === 'number'
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
    projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
    resumeFromJobId: typeof value.resumeFromJobId === 'string' ? value.resumeFromJobId : undefined,
    projectJobIds: Array.isArray(value.projectJobIds)
      ? value.projectJobIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    attemptCount: typeof value.attemptCount === 'number' ? value.attemptCount : undefined,
    storyTitle: value.storyTitle,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    status: value.status,
    currentPhase: value.currentPhase,
    progress: value.progress,
    episodeCount: value.episodeCount,
    currentEpisode: value.currentEpisode,
    etaSeconds: typeof value.etaSeconds === 'number' ? value.etaSeconds : undefined,
    phaseProgress: typeof value.phaseProgress === 'number' ? value.phaseProgress : undefined,
    currentItem: typeof value.currentItem === 'number' ? value.currentItem : undefined,
    totalItems: typeof value.totalItems === 'number' ? value.totalItems : undefined,
    subphaseLabel: typeof value.subphaseLabel === 'string' ? value.subphaseLabel : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    outputDir: typeof value.outputDir === 'string' ? value.outputDir : undefined,
    imageStats: isRecord(value.imageStats)
      ? {
          generatedFiles: typeof value.imageStats.generatedFiles === 'number' ? value.imageStats.generatedFiles : undefined,
          referenceFiles: typeof value.imageStats.referenceFiles === 'number' ? value.imageStats.referenceFiles : undefined,
          storyFiles: typeof value.imageStats.storyFiles === 'number' ? value.imageStats.storyFiles : undefined,
          resolvedSlots: typeof value.imageStats.resolvedSlots === 'number' ? value.imageStats.resolvedSlots : undefined,
          totalSlots: typeof value.imageStats.totalSlots === 'number' ? value.imageStats.totalSlots : undefined,
          missingSlots: typeof value.imageStats.missingSlots === 'number' ? value.imageStats.missingSlots : undefined,
        }
      : undefined,
    generatedImageCount: typeof value.generatedImageCount === 'number' ? value.generatedImageCount : undefined,
    referenceImageCount: typeof value.referenceImageCount === 'number' ? value.referenceImageCount : undefined,
    storyImageCount: typeof value.storyImageCount === 'number' ? value.storyImageCount : undefined,
    resolvedImageSlotCount: typeof value.resolvedImageSlotCount === 'number' ? value.resolvedImageSlotCount : undefined,
    totalImageSlotCount: typeof value.totalImageSlotCount === 'number' ? value.totalImageSlotCount : undefined,
    missingImageSlotCount: typeof value.missingImageSlotCount === 'number' ? value.missingImageSlotCount : undefined,
    events: normalizedEvents,
    checkpoint: isRecord(value.checkpoint) ? value.checkpoint as GenerationJobCheckpoint : undefined,
  };
}

export function getGenerationJobResumeSourceId(job: GenerationJob): string | undefined {
  return job.resumeFromJobId || job.checkpoint?.resumeContext?.resumeFromJobId;
}

export function getGenerationJobProjectId(job: GenerationJob, jobs: GenerationJob[]): string {
  if (job.projectId) return job.projectId;

  const byId = new Map(jobs.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>([job.id]);
  let cursor: GenerationJob | undefined = job;

  while (cursor) {
    const sourceId = getGenerationJobResumeSourceId(cursor);
    if (!sourceId || seen.has(sourceId)) break;
    seen.add(sourceId);
    const source = byId.get(sourceId);
    if (!source) return sourceId;
    if (source.projectId) return source.projectId;
    cursor = source;
  }

  return cursor?.id || job.id;
}

function getJobTime(job: GenerationJob, field: 'startedAt' | 'updatedAt'): number {
  const parsed = new Date(job[field]).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isActiveGenerationJob(job: GenerationJob): boolean {
  return job.status === 'running' || job.status === 'pending';
}

export function getVisibleGenerationJobs(jobs: GenerationJob[]): GenerationJob[] {
  const groups = new Map<string, GenerationJob[]>();

  for (const job of jobs) {
    const projectId = getGenerationJobProjectId(job, jobs);
    const group = groups.get(projectId) || [];
    group.push(job);
    groups.set(projectId, group);
  }

  return Array.from(groups.entries()).map(([projectId, attempts]) => {
    const sortedByUpdated = [...attempts].sort((a, b) => getJobTime(b, 'updatedAt') - getJobTime(a, 'updatedAt'));
    const activeAttempt = sortedByUpdated.find(isActiveGenerationJob);
    const visible = activeAttempt || sortedByUpdated[0];
    const sortedByStarted = [...attempts].sort((a, b) => getJobTime(a, 'startedAt') - getJobTime(b, 'startedAt'));

    return {
      ...visible,
      projectId,
      projectJobIds: sortedByUpdated.map((attempt) => attempt.id),
      attemptCount: attempts.length,
      startedAt: sortedByStarted[0]?.startedAt || visible.startedAt,
    };
  }).sort((a, b) => getJobTime(b, 'updatedAt') - getJobTime(a, 'updatedAt'));
}
