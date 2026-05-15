import { describe, expect, it } from 'vitest';
import type { Episode, Story } from '../../types';
import { mergeSeasonEpisodes } from './seasonStoryMerge';

function episode(number: number, title = `Episode ${number}`): Episode {
  return {
    id: `episode-${number}`,
    number,
    title,
    synopsis: `${title} synopsis`,
    coverImage: `generated-stories/test/episode-${number}.jpg`,
    scenes: [],
    startingSceneId: '',
  };
}

function story(episodes: Episode[]): Story {
  return {
    id: 'season-one',
    title: 'Season One',
    genre: 'Fantasy',
    synopsis: 'A test season',
    coverImage: 'generated-stories/test/cover.jpg',
    initialState: {
      attributes: { charm: 10, wit: 10, courage: 10, empathy: 10, resolve: 10, resourcefulness: 10 },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes,
    outputDir: 'generated-stories/test/',
  };
}

describe('mergeSeasonEpisodes', () => {
  it('sorts and appends generated future episodes', () => {
    const result = mergeSeasonEpisodes(story([episode(1), episode(2), episode(3), episode(4), episode(5)]), story([
      episode(10),
      episode(6),
      episode(7),
      episode(9),
      episode(8),
    ]));

    expect(result.story.episodes.map((ep) => ep.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.appendedEpisodeNumbers.sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10]);
    expect(result.replacedEpisodeNumbers).toEqual([]);
  });

  it('preserves existing episodes unless the generated batch includes the same number', () => {
    const originalTwo = episode(2, 'Original Two');
    const replacementTwo = episode(2, 'Replacement Two');
    const result = mergeSeasonEpisodes(story([episode(1), originalTwo, episode(3)]), story([
      replacementTwo,
      episode(4),
    ]));

    expect(result.story.episodes.map((ep) => ep.title)).toEqual([
      'Episode 1',
      'Replacement Two',
      'Episode 3',
      'Episode 4',
    ]);
    expect(result.replacedEpisodeNumbers).toEqual([2]);
    expect(result.appendedEpisodeNumbers).toEqual([4]);
  });

  it('returns a sorted generated story when there is no existing story', () => {
    const result = mergeSeasonEpisodes(undefined, story([episode(3), episode(1), episode(2)]));

    expect(result.story.episodes.map((ep) => ep.number)).toEqual([1, 2, 3]);
    expect(result.appendedEpisodeNumbers).toEqual([3, 1, 2]);
  });
});
