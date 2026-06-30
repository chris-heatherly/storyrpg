import { describe, expect, it } from 'vitest';
import { deriveEpisodeContextOut } from './episodeContext';
import type { Episode } from '../../../types';

describe('deriveEpisodeContextOut', () => {
  it('ignores malformed consequences without throwing while deriving context artifacts', () => {
    const episode = {
      id: 'ep-test',
      number: 1,
      title: 'Test',
      scenes: [
        {
          id: 'scene-1',
          name: 'Scene 1',
          beats: [
            {
              id: 'beat-1',
              text: 'You choose.',
              choices: [
                {
                  id: 'choice-1',
                  text: 'Act',
                  consequences: [
                    { type: 'setFlag', value: true },
                    { type: 'setScore', value: 2 },
                    { type: 'addTag' },
                    { type: 'relationship', dimension: 'trust', change: 1 },
                    { type: 'setFlag', flag: 'valid_flag', value: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Episode;

    const contextOut = deriveEpisodeContextOut({ storyId: 'story', episode });

    expect(contextOut.flagsIntroduced).toEqual(['valid_flag']);
    expect(contextOut.scoresChanged).toEqual([]);
    expect(contextOut.tagsIntroduced).toEqual([]);
    expect(contextOut.relationshipDeltas).toEqual([]);
  });
});
