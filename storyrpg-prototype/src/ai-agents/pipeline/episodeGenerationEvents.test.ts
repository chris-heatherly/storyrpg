import { describe, expect, it, vi } from 'vitest';
import { commitEpisodeGenerationAfterLock, emitEpisodeGenerationStart, handleEpisodeGenerationFailure } from './episodeGenerationEvents';

describe('episode generation events', () => {
  it('emits stable phase identity for a pending episode', () => {
    const emit = vi.fn();
    emitEpisodeGenerationStart(emit, 2, 'The Door');
    expect(emit).toHaveBeenCalledWith({
      type: 'phase_start',
      phase: 'episode_2',
      message: 'Generating Episode 2: The Door',
    });
  });

  it('records advisory failures and rethrows strict failures', () => {
    const emit = vi.fn();
    const results: Array<{ episodeNumber: number; title: string; success: boolean; error?: string }> = [];
    expect(handleEpisodeGenerationFailure({
      error: new Error('provider timeout'), episodeNumber: 1, title: 'Arrival', strict: false, results, emit,
    })).toBeNull();
    expect(results).toEqual([{ episodeNumber: 1, title: 'Arrival', success: false, error: 'provider timeout' }]);
    expect(() => handleEpisodeGenerationFailure({
      error: new Error('hard failure'), episodeNumber: 2, title: 'Threshold', strict: true, results, emit,
    })).toThrow('hard failure');
  });

  it('publishes a successful episode only after its incremental lock succeeds', async () => {
    const collections = {
      episodes: [] as string[], results: [] as Array<{ episodeNumber: number; title: string; success: boolean }>,
      artifacts: [] as string[], qaReports: [] as string[], bestPracticesReports: [] as string[],
    };
    await expect(commitEpisodeGenerationAfterLock({
      episode: 'episode-1', result: { episodeNumber: 1, title: 'Arrival', success: true }, artifact: 'artifact-1',
      qaReport: 'qa-1', bestPracticesReport: 'bp-1', lockEpisode: async () => { throw new Error('incremental contract failed'); },
      ...collections,
    })).rejects.toThrow('incremental contract failed');
    expect(collections).toEqual({ episodes: [], results: [], artifacts: [], qaReports: [], bestPracticesReports: [] });

    await commitEpisodeGenerationAfterLock({
      episode: 'episode-1', result: { episodeNumber: 1, title: 'Arrival', success: true }, artifact: 'artifact-1',
      qaReport: 'qa-1', bestPracticesReport: 'bp-1', lockEpisode: async () => undefined,
      ...collections,
    });
    expect(collections).toEqual({
      episodes: ['episode-1'], results: [{ episodeNumber: 1, title: 'Arrival', success: true }],
      artifacts: ['artifact-1'], qaReports: ['qa-1'], bestPracticesReports: ['bp-1'],
    });
  });
});
