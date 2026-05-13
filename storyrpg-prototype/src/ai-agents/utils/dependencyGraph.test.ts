import { describe, it, expect } from 'vitest';
import { buildSceneDependencyGraph, buildTopologicalWaves } from './dependencyGraph';
import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';

function makeScene(overrides: Partial<SceneBlueprint> & { id: string }): SceneBlueprint {
  return {
    name: overrides.id,
    description: overrides.id,
    purpose: 'progression',
    leadsTo: overrides.leadsTo ?? [],
    requires: overrides.requires ?? [],
    ...overrides,
  } as SceneBlueprint;
}

function makeBlueprint(scenes: SceneBlueprint[]): EpisodeBlueprint {
  return {
    id: 'ep-1',
    title: 'Dependency test blueprint',
    synopsis: 'fixture',
    scenes,
  } as unknown as EpisodeBlueprint;
}

describe('dependencyGraph', () => {
  it('orders scenes by leadsTo into wave-based topological layers', () => {
    // A -> B, A -> C, B -> D, C -> D
    const blueprint = makeBlueprint([
      makeScene({ id: 'a', leadsTo: ['b', 'c'] }),
      makeScene({ id: 'b', leadsTo: ['d'] }),
      makeScene({ id: 'c', leadsTo: ['d'] }),
      makeScene({ id: 'd' }),
    ]);
    const waves = buildTopologicalWaves(blueprint);

    expect(waves.map((w) => w.sceneIds)).toEqual([
      ['a'],
      ['b', 'c'],
      ['d'],
    ]);
  });

  it('honors `requires` edges in addition to `leadsTo`', () => {
    // A and B are independent but D requires both
    const blueprint = makeBlueprint([
      makeScene({ id: 'a' }),
      makeScene({ id: 'b' }),
      makeScene({ id: 'd', requires: ['a', 'b'] }),
    ]);
    const waves = buildTopologicalWaves(blueprint);

    expect(waves).toHaveLength(2);
    expect(waves[0].sceneIds.sort()).toEqual(['a', 'b']);
    expect(waves[1].sceneIds).toEqual(['d']);
  });

  it('detects cycles and returns no waves', () => {
    // A -> B -> C -> A
    const blueprint = makeBlueprint([
      makeScene({ id: 'a', leadsTo: ['b'] }),
      makeScene({ id: 'b', leadsTo: ['c'] }),
      makeScene({ id: 'c', leadsTo: ['a'] }),
    ]);

    const graph = buildSceneDependencyGraph(blueprint);
    expect(graph.hasCycle).toBe(true);
    expect(graph.cycleReason).toContain('cycle');

    const waves = buildTopologicalWaves(blueprint);
    expect(waves).toEqual([]);
  });

  it('returns a single wave when every scene is independent', () => {
    const blueprint = makeBlueprint([
      makeScene({ id: 'a' }),
      makeScene({ id: 'b' }),
      makeScene({ id: 'c' }),
    ]);
    const waves = buildTopologicalWaves(blueprint);

    expect(waves).toHaveLength(1);
    expect(waves[0].sceneIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('produces stable ordering within a wave (sorted by scene id)', () => {
    const blueprint = makeBlueprint([
      makeScene({ id: 'zz' }),
      makeScene({ id: 'aa' }),
      makeScene({ id: 'mm' }),
    ]);
    const waves = buildTopologicalWaves(blueprint);
    expect(waves[0].sceneIds).toEqual(['aa', 'mm', 'zz']);
  });
});
