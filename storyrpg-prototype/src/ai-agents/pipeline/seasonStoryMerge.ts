import type { Episode, Story } from '../../types';

export type SeasonStoryMergeMode = 'append' | 'replace';

export interface SeasonStoryMergeResult {
  story: Story;
  replacedEpisodeNumbers: number[];
  appendedEpisodeNumbers: number[];
}

function getEpisodeNumber(episode: Episode): number {
  return typeof episode.number === 'number' ? episode.number : Number.NaN;
}

/**
 * Merge newly generated season episodes into an existing playable story.
 * Existing episodes are preserved unless the generated batch explicitly
 * includes the same episode number.
 */
export function mergeSeasonEpisodes(existingStory: Story | undefined, generatedStory: Story): SeasonStoryMergeResult {
  if (!existingStory) {
    const generatedNumbers = (generatedStory.episodes || [])
      .map(getEpisodeNumber)
      .filter((n) => Number.isFinite(n));
    return {
      story: {
        ...generatedStory,
        episodes: [...(generatedStory.episodes || [])].sort((a, b) => getEpisodeNumber(a) - getEpisodeNumber(b)),
      },
      replacedEpisodeNumbers: [],
      appendedEpisodeNumbers: generatedNumbers,
    };
  }

  const byNumber = new Map<number, Episode>();
  const replacedEpisodeNumbers: number[] = [];
  const appendedEpisodeNumbers: number[] = [];

  for (const episode of existingStory.episodes || []) {
    const episodeNumber = getEpisodeNumber(episode);
    if (!Number.isFinite(episodeNumber)) continue;
    byNumber.set(episodeNumber, episode);
  }

  for (const episode of generatedStory.episodes || []) {
    const episodeNumber = getEpisodeNumber(episode);
    if (!Number.isFinite(episodeNumber)) continue;
    if (byNumber.has(episodeNumber)) {
      replacedEpisodeNumbers.push(episodeNumber);
    } else {
      appendedEpisodeNumbers.push(episodeNumber);
    }
    byNumber.set(episodeNumber, episode);
  }

  const episodes = Array.from(byNumber.values()).sort((a, b) => getEpisodeNumber(a) - getEpisodeNumber(b));
  const coverImage = existingStory.coverImage || generatedStory.coverImage || '';

  return {
    story: {
      ...existingStory,
      // Allow top-level metadata/art/style changes from the newest run while
      // preserving the existing story identity and accumulated episodes.
      ...generatedStory,
      id: existingStory.id,
      title: existingStory.title || generatedStory.title,
      coverImage,
      outputDir: existingStory.outputDir || generatedStory.outputDir,
      episodes,
    },
    replacedEpisodeNumbers,
    appendedEpisodeNumbers,
  };
}
