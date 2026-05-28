import { describe, expect, it } from 'vitest';
import type { Episode, Story } from '../../types';
import { MicroEpisodeSeasonValidator } from './MicroEpisodeSeasonValidator';

function makeEpisode(
  number: number,
  options: {
    isMilestoneEncounter?: boolean;
    hasEncounter?: boolean;
  } = {}
): Episode {
  return {
    id: `episode-${number}`,
    number,
    title: `Episode ${number}`,
    synopsis: 'Scene-length episode fixture.',
    coverImage: '',
    episodeStructureMode: 'sceneEpisodes',
    routeMeta: {
      kind: 'master',
      spineIndex: number,
      displayLabel: `${number}`,
      ...(options.isMilestoneEncounter !== undefined
        ? { isMilestoneEncounter: options.isMilestoneEncounter }
        : {}),
    },
    startingSceneId: 'scene-1',
    scenes: [{
      id: 'scene-1',
      name: 'Scene',
      startingBeatId: 'beat-1',
      beats: [{ id: 'beat-1', text: 'The scene turns.' }],
      ...(options.hasEncounter ? { encounter: { phases: [], storylets: {} } as any } : {}),
    }],
  };
}

function makeStory(episodes: Episode[]): Story {
  return {
    id: 'story',
    title: 'Story',
    genre: 'Drama',
    synopsis: 'Fixture.',
    coverImage: '',
    initialState: {
      attributes: {
        charm: 0,
        wit: 0,
        courage: 0,
        empathy: 0,
        resolve: 0,
        resourcefulness: 0,
      },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes,
  };
}

describe('MicroEpisodeSeasonValidator encounter cadence', () => {
  it('respects explicit treatment-authored non-milestone sceneEpisodes on cadence boundaries', () => {
    const story = makeStory([
      makeEpisode(1),
      makeEpisode(2),
      makeEpisode(3),
      makeEpisode(4),
      makeEpisode(5),
      makeEpisode(6, { isMilestoneEncounter: false }),
    ]);

    const result = new MicroEpisodeSeasonValidator().validateStory(story);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('still fails an explicitly marked milestone encounter when no encounter is assembled', () => {
    const story = makeStory([
      makeEpisode(1),
      makeEpisode(2),
      makeEpisode(3),
      makeEpisode(4),
      makeEpisode(5),
      makeEpisode(6, { isMilestoneEncounter: true }),
    ]);

    const result = new MicroEpisodeSeasonValidator().validateStory(story);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      type: 'encounter_cadence',
      episodeId: 'episode-6',
    });
  });

  it('keeps cadence fallback for generated plans without explicit route metadata', () => {
    const story = makeStory([
      makeEpisode(1),
      makeEpisode(2),
      makeEpisode(3),
      makeEpisode(4),
      makeEpisode(5),
      {
        ...makeEpisode(6),
        routeMeta: {
          kind: 'master',
          spineIndex: 6,
          displayLabel: '6',
        },
      },
    ]);

    const result = new MicroEpisodeSeasonValidator().validateStory(story);

    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('cadence 6');
  });
});
