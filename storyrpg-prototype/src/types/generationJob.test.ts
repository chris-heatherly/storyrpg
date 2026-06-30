import { describe, expect, it } from 'vitest';
import type { GenerationJob } from './generationJob';
import { getVisibleGenerationJobs } from './generationJob';

function job(overrides: Partial<GenerationJob> & Pick<GenerationJob, 'id' | 'startedAt' | 'updatedAt'>): GenerationJob {
  return {
    storyTitle: 'Bite Me',
    status: 'failed',
    currentPhase: 'processing',
    progress: 100,
    episodeCount: 3,
    currentEpisode: 1,
    ...overrides,
  };
}

describe('getVisibleGenerationJobs', () => {
  it('represents a resume project with the newest started attempt, not an older patched source', () => {
    const visible = getVisibleGenerationJobs([
      job({
        id: 'source',
        projectId: 'project-a',
        startedAt: '2026-06-21T23:10:00.000Z',
        updatedAt: '2026-06-22T03:10:00.000Z',
        error: 'No resume payload stored for this job',
      }),
      job({
        id: 'latest-failed',
        projectId: 'project-a',
        resumeFromJobId: 'source',
        startedAt: '2026-06-22T02:56:00.000Z',
        updatedAt: '2026-06-22T03:03:00.000Z',
        error: 'Final story contract failed with 2 blocking issue(s)',
      }),
    ]);

    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('latest-failed');
    expect(visible[0].projectJobIds).toEqual(['latest-failed', 'source']);
    expect(visible[0].attemptCount).toBe(2);
  });

  it('still prefers an active attempt over a newer terminal attempt', () => {
    const visible = getVisibleGenerationJobs([
      job({
        id: 'newer-failed',
        projectId: 'project-a',
        startedAt: '2026-06-22T02:56:00.000Z',
        updatedAt: '2026-06-22T03:03:00.000Z',
      }),
      job({
        id: 'running',
        projectId: 'project-a',
        status: 'running',
        startedAt: '2026-06-22T02:00:00.000Z',
        updatedAt: '2026-06-22T02:05:00.000Z',
        progress: 40,
      }),
    ]);

    expect(visible[0].id).toBe('running');
  });
});
