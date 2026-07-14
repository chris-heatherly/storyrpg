/**
 * Season-plan gate frontier enforcement (R2.3).
 * Episodes within the generation frontier (+1) may hard-block; beyond that, shadow only.
 */
export function createSeasonGateEnforcement(input: {
  episodeNumber: number;
  generatedThroughEpisode: number;
}): () => boolean {
  const frontier = Math.max(1, input.generatedThroughEpisode) + 1;
  return () => input.episodeNumber <= frontier;
}
