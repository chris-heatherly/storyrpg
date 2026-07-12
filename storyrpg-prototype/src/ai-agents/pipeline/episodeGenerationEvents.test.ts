import { describe, expect, it, vi } from 'vitest';
import { emitEpisodeGenerationStart, handleEpisodeGenerationFailure } from './episodeGenerationEvents';

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
});
