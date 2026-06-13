import { describe, expect, it } from 'vitest';
import {
  analyzeBranchTopology,
  buildBranchSkeleton,
  enumerateBranchPaths,
  type TopologyScene,
} from './branchTopology';

describe('analyzeBranchTopology', () => {
  it('finds unreachable scenes, dead ends, and reconvergence points deterministically', () => {
    const blueprint: any = {
      startingSceneId: 'scene-1',
      endingSceneId: 'scene-4',
      scenes: [
        { id: 'scene-1', leadsTo: ['scene-2', 'scene-3'] },
        { id: 'scene-2', leadsTo: ['scene-4'] },
        { id: 'scene-3', leadsTo: ['scene-4'] },
        { id: 'scene-4', leadsTo: [] },
        { id: 'scene-5', leadsTo: [] },
        { id: 'scene-6', leadsTo: [] },
      ],
    };

    const result = analyzeBranchTopology(blueprint);

    expect(result.reconvergenceSceneIds).toContain('scene-4');
    expect(result.unreachableSceneIds).toEqual(expect.arrayContaining(['scene-5', 'scene-6']));
    expect(result.deadEndSceneIds).toContain('scene-5');
    expect(result.deadEndSceneIds).toContain('scene-6');
  });
});

describe('enumerateBranchPaths', () => {
  const scenes: TopologyScene[] = [
    { id: 's1', leadsTo: ['s2', 's3'] },
    { id: 's2', leadsTo: ['s4'] },
    { id: 's3', leadsTo: ['s4'] },
    { id: 's4', leadsTo: [] },
  ];

  it('enumerates each distinct path through the graph', () => {
    const { paths, truncated } = enumerateBranchPaths(scenes, 's1');
    expect(truncated).toBe(false);
    expect(paths.map((p) => p.sceneSequence)).toEqual([
      ['s1', 's2', 's4'],
      ['s1', 's3', 's4'],
    ]);
    expect(paths[0]).toMatchObject({ startSceneId: 's1', endSceneId: 's4' });
  });

  it('is cycle-guarded (a repeated scene terminates the path)', () => {
    const cyclic: TopologyScene[] = [
      { id: 'a', leadsTo: ['b'] },
      { id: 'b', leadsTo: ['a', 'c'] },
      { id: 'c', leadsTo: [] },
    ];
    const { paths } = enumerateBranchPaths(cyclic, 'a');
    // a→b→a is pruned (a already on trail); a→b→c terminates cleanly.
    expect(paths.some((p) => p.sceneSequence.join('>') === 'a>b>c')).toBe(true);
    for (const p of paths) {
      expect(new Set(p.sceneSequence).size).toBe(p.sceneSequence.length);
    }
  });

  it('falls back to the first scene when startingSceneId is missing', () => {
    const { paths } = enumerateBranchPaths(scenes, 'does-not-exist');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].startSceneId).toBe('s1');
  });
});

describe('buildBranchSkeleton', () => {
  it('marks scenes reached by ≥2 paths as reconvergence points with their path ids', () => {
    const scenes: TopologyScene[] = [
      { id: 's1', leadsTo: ['s2', 's3'] },
      { id: 's2', leadsTo: ['s4'] },
      { id: 's3', leadsTo: ['s4'] },
      { id: 's4', leadsTo: [] },
    ];
    const skeleton = buildBranchSkeleton(scenes, 's1');

    expect(skeleton.paths).toHaveLength(2);
    const reconv = skeleton.reconvergence.find((r) => r.sceneId === 's4');
    expect(reconv).toBeDefined();
    expect(reconv!.incomingSceneIds.sort()).toEqual(['s2', 's3']);
    expect(reconv!.incomingPathIds.sort()).toEqual(['path-1', 'path-2']);
    // s1/s2/s3 are single-path, not reconvergence points.
    expect(skeleton.reconvergence.map((r) => r.sceneId)).toEqual(['s4']);
  });

  it('produces no reconvergence for a linear graph', () => {
    const scenes: TopologyScene[] = [
      { id: 'a', leadsTo: ['b'] },
      { id: 'b', leadsTo: ['c'] },
      { id: 'c', leadsTo: [] },
    ];
    const skeleton = buildBranchSkeleton(scenes, 'a');
    expect(skeleton.paths).toHaveLength(1);
    expect(skeleton.reconvergence).toHaveLength(0);
  });
});
