import { describe, expect, it } from 'vitest';
import { buildEpisodeStateSnapshot } from './episodeStateSnapshot';

const episode = (number: number, flags: string[], scores: string[] = []) => ({
  number,
  scenes: [
    {
      beats: [
        {
          choices: [
            {
              consequences: [
                ...flags.map((flag) => ({ type: 'setFlag', flag, value: true })),
                ...scores.map((score) => ({ type: 'setScore', score, amount: 1 })),
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('buildEpisodeStateSnapshot', () => {
  it('collects trackable flags + scores an episode sets', () => {
    const snap = buildEpisodeStateSnapshot(episode(1, ['lysandra_trusted', 'tint:warm', 'route_x'], ['resolve']), ['p1']);
    expect(snap.afterEpisode).toBe(1);
    expect(snap.flags).toEqual(['lysandra_trusted']); // tint:/route_ excluded
    expect(snap.scores).toEqual(['resolve']);
    expect(snap.openPromiseIds).toEqual(['p1']);
  });

  it('accumulates onto the prior snapshot (cumulative season state)', () => {
    const ep1 = buildEpisodeStateSnapshot(episode(1, ['a']), ['p1']);
    const ep2 = buildEpisodeStateSnapshot(episode(2, ['b']), ['p2', 'p1'], ep1);
    expect(ep2.afterEpisode).toBe(2);
    expect(ep2.flags).toEqual(['a', 'b']);
    expect(ep2.openPromiseIds).toEqual(['p1', 'p2']);
  });
});
