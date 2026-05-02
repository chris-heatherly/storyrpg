import type { ImageJob } from '../stores/imageJobStore';

const TEXT_FIX_SUFFIX = /-textfix\d+$/i;

const statusRank: Record<ImageJob['status'], number> = {
  failed: 0,
  pending: 1,
  processing: 2,
  completed: 3,
};

function getTextFixAttempt(value?: string): number {
  if (!value) return 0;
  const match = value.match(/-textfix(\d+)$/i);
  return match ? Number(match[1]) || 0 : 0;
}

export function getImageJobDisplayKey(job: ImageJob): string {
  const baseIdentifier = typeof job.metadata?.baseIdentifier === 'string'
    ? job.metadata.baseIdentifier
    : undefined;
  const identifier = job.identifier || job.id;
  return baseIdentifier || identifier.replace(TEXT_FIX_SUFFIX, '');
}

function getAttemptNumber(job: ImageJob): number {
  const regeneration = Number(job.metadata?.regeneration);
  if (Number.isFinite(regeneration) && regeneration > 0) return regeneration;
  return Math.max(getTextFixAttempt(job.identifier), getTextFixAttempt(job.id));
}

function shouldReplaceImageJob(current: ImageJob, candidate: ImageJob): boolean {
  const currentAttempt = getAttemptNumber(current);
  const candidateAttempt = getAttemptNumber(candidate);
  if (candidateAttempt !== currentAttempt) return candidateAttempt > currentAttempt;

  const currentRank = statusRank[current.status] ?? 0;
  const candidateRank = statusRank[candidate.status] ?? 0;
  if (candidateRank !== currentRank) return candidateRank > currentRank;

  return candidate.startTime >= current.startTime;
}

export function collapseImageJobAttempts(jobs: ImageJob[]): ImageJob[] {
  const groups = new Map<string, { representative: ImageJob; count: number }>();

  for (const job of jobs) {
    const key = getImageJobDisplayKey(job);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { representative: job, count: 1 });
      continue;
    }

    existing.count += 1;
    if (shouldReplaceImageJob(existing.representative, job)) {
      existing.representative = job;
    }
  }

  return Array.from(groups.values())
    .map(({ representative, count }) => count > 1
      ? {
          ...representative,
          metadata: {
            ...representative.metadata,
            supersededAttemptCount: count - 1,
          },
        }
      : representative)
    .sort((a, b) => a.startTime - b.startTime);
}

export function countVisibleImageJobs(jobs: Record<string, ImageJob>): number {
  return collapseImageJobAttempts(Object.values(jobs)).length;
}
