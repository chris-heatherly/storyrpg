import { describe, expect, it } from 'vitest';
import { findBeatIdCollisions, collidingSceneIds } from './beatIdCollisions';

const ep = (scenes: Array<{ id: string; beatIds: string[] }>) => ({
  scenes: scenes.map((s) => ({ id: s.id, beats: s.beatIds.map((id) => ({ id })) })),
});

describe('findBeatIdCollisions', () => {
  it('detects an exact cross-scene duplicate', () => {
    const collisions = findBeatIdCollisions(ep([
      { id: 'scene-1', beatIds: ['beat-1', 'beat-2'] },
      { id: 'scene-2', beatIds: ['beat-1'] },
    ]));
    expect(collisions).toEqual([
      expect.objectContaining({ sceneId: 'scene-1', beatId: 'beat-1', otherSceneId: 'scene-2', kind: 'exact' }),
    ]);
  });

  it('detects the audit hierarchical-prefix case (beat-2b vs beat-2b-1)', () => {
    const collisions = findBeatIdCollisions(ep([
      { id: 'scene-1', beatIds: ['beat-1', 'beat-2', 'beat-2b'] },
      { id: 'scene-2b', beatIds: ['beat-2b-1', 'beat-2b-2', 'beat-2b-3'] },
    ]));
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0]).toMatchObject({ kind: 'prefix' });
    expect(collidingSceneIds(ep([
      { id: 'scene-1', beatIds: ['beat-2b'] },
      { id: 'scene-2b', beatIds: ['beat-2b-1'] },
    ]))).toEqual(new Set(['scene-1', 'scene-2b']));
  });

  it('ignores within-scene duplicates and non-colliding ids', () => {
    expect(findBeatIdCollisions(ep([
      { id: 'scene-1', beatIds: ['beat-1', 'beat-2'] },
      { id: 'scene-2', beatIds: ['beat-3', 'beat-4'] },
    ]))).toEqual([]);
    // "beat-2b" vs "beat-2" is NOT a hierarchical prefix (needs the '-' separator)
    expect(findBeatIdCollisions(ep([
      { id: 'scene-1', beatIds: ['beat-2'] },
      { id: 'scene-2', beatIds: ['beat-2b'] },
    ]))).toEqual([]);
  });
});
