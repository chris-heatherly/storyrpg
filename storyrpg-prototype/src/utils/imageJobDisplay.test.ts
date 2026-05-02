import { describe, expect, it } from 'vitest';
import { collapseImageJobAttempts, countVisibleImageJobs } from './imageJobDisplay';
import type { ImageJob } from '../stores/imageJobStore';

function makeJob(partial: Partial<ImageJob> & Pick<ImageJob, 'id' | 'identifier'>): ImageJob {
  return {
    prompt: '',
    status: 'completed',
    progress: 100,
    startTime: 1000,
    attempts: 0,
    maxRetries: 3,
    ...partial,
  };
}

describe('imageJobDisplay', () => {
  it('collapses text artifact retry attempts into the latest visible job', () => {
    const jobs = [
      makeJob({
        id: 'encounter-a-1000',
        identifier: 'encounter-a',
        startTime: 1000,
        metadata: { baseIdentifier: 'encounter-a' },
      }),
      makeJob({
        id: 'encounter-a-textfix1-2000',
        identifier: 'encounter-a-textfix1',
        startTime: 2000,
        imageUrl: '/fixed.png',
        metadata: { baseIdentifier: 'encounter-a', regeneration: 1 },
      }),
    ];

    const visible = collapseImageJobAttempts(jobs);

    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('encounter-a-textfix1-2000');
    expect(visible[0].imageUrl).toBe('/fixed.png');
    expect(visible[0].metadata?.supersededAttemptCount).toBe(1);
  });

  it('keeps distinct image slots visible', () => {
    const jobs = [
      makeJob({ id: 'beat-1-1000', identifier: 'beat-1' }),
      makeJob({ id: 'beat-2-2000', identifier: 'beat-2', startTime: 2000 }),
    ];

    expect(collapseImageJobAttempts(jobs).map((job) => job.identifier)).toEqual(['beat-1', 'beat-2']);
    expect(countVisibleImageJobs({ a: jobs[0], b: jobs[1] })).toBe(2);
  });

  it('uses the identifier suffix when retry metadata is unavailable', () => {
    const jobs = [
      makeJob({ id: 'scene-a-1000', identifier: 'scene-a', startTime: 1000 }),
      makeJob({ id: 'scene-a-textfix1-2000', identifier: 'scene-a-textfix1', startTime: 2000 }),
    ];

    expect(collapseImageJobAttempts(jobs)).toHaveLength(1);
  });
});
