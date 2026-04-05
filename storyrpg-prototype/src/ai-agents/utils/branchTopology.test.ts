import { describe, expect, it } from 'vitest';
import { analyzeBranchTopology } from './branchTopology';

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
