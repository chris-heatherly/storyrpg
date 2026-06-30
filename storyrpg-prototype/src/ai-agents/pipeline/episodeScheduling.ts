export type EpisodeDependencyMode = 'sequential' | 'independent';

export type EpisodeParallelismDisabledReason =
  | 'season_canon_enabled';

export interface EpisodeParallelismResolution {
  enabled: boolean;
  requested: boolean;
  disabledReason?: EpisodeParallelismDisabledReason;
}

export function resolveEpisodeParallelism(input: {
  episodeParallelismEnabled?: boolean;
  dependencyMode?: EpisodeDependencyMode;
  seasonCanonEnabled: boolean;
}): EpisodeParallelismResolution {
  const requested = input.episodeParallelismEnabled === true && input.dependencyMode === 'independent';
  if (requested && input.seasonCanonEnabled) {
    return {
      enabled: false,
      requested,
      disabledReason: 'season_canon_enabled',
    };
  }
  return {
    enabled: requested,
    requested,
  };
}
