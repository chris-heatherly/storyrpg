import { describe, expect, it } from 'vitest';
import { resolveEpisodeParallelism } from './episodeScheduling';

describe('resolveEpisodeParallelism', () => {
  it('disables requested parallelism when season canon is enabled', () => {
    expect(resolveEpisodeParallelism({
      episodeParallelismEnabled: true,
      dependencyMode: 'independent',
      seasonCanonEnabled: true,
    })).toEqual({
      enabled: false,
      requested: true,
      disabledReason: 'season_canon_enabled',
    });
  });

  it('allows independent parallelism when season canon is explicitly off', () => {
    expect(resolveEpisodeParallelism({
      episodeParallelismEnabled: true,
      dependencyMode: 'independent',
      seasonCanonEnabled: false,
    })).toEqual({
      enabled: true,
      requested: true,
    });
  });

  it('does not request parallelism outside independent mode', () => {
    expect(resolveEpisodeParallelism({
      episodeParallelismEnabled: true,
      dependencyMode: 'sequential',
      seasonCanonEnabled: false,
    })).toEqual({
      enabled: false,
      requested: false,
    });
  });
});
