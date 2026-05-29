import { describe, it, expect } from 'vitest';
import { repairLostSceneGraphBranches, type RepairEpisode, type RepairBlueprint } from './branchRepair';
import { SceneGraphBranchValidator } from '../validators/SceneGraphBranchValidator';

// Mirrors the real endsong episode-1 failure: blueprint plans a branch at
// scene-1 (branches + leadsTo [scene-2, scene-3]) but assembly produced a
// choice-point beat with ZERO choices, so no choice carried nextSceneId.
function endsongLikeBlueprint(): RepairBlueprint {
  return {
    scenes: [
      { id: 'scene-1', leadsTo: ['scene-2', 'scene-3'], choicePoint: { branches: true } },
      { id: 'scene-2', leadsTo: ['scene-3'], choicePoint: { branches: false } },
      { id: 'scene-3', leadsTo: ['scene-4'] },
      { id: 'scene-4', leadsTo: ['scene-5'] },
      { id: 'scene-5', leadsTo: [] },
    ],
  };
}

function episodeWithEmptyBranchBeat(): RepairEpisode {
  return {
    scenes: [
      { id: 'scene-1', name: 'Dawn and Discord', beats: [{ id: 'beat-5', isChoicePoint: true, choices: [] }] },
      { id: 'scene-2', name: 'The Main Road', beats: [{ id: 'b', choices: [] }] },
      { id: 'scene-3', name: 'The Hidden Route', beats: [{ id: 'b', choices: [] }] },
      { id: 'scene-4', name: 'Encounter', beats: [{ id: 'b', choices: [] }] },
      { id: 'scene-5', name: 'Aftermath', beats: [{ id: 'b', choices: [] }] },
    ],
  };
}

describe('repairLostSceneGraphBranches', () => {
  // Each branch must route THROUGH a choice-bridge beat: choice.nextBeatId -> a
  // beat with isChoiceBridge + nextSceneId (no raw choice.nextSceneId, which the
  // validator rejects when requireChoiceBridge is on).
  function branchTargetsVia(scene: { beats?: any[] }): Set<string> {
    const beats = scene.beats || [];
    const targets = new Set<string>();
    for (const beat of beats) {
      for (const choice of beat.choices || []) {
        expect(choice.nextSceneId, 'branch choices must not use a raw nextSceneId').toBeFalsy();
        const bridge = beats.find((b: any) => b.id === choice.nextBeatId);
        if (bridge?.isChoiceBridge && bridge.nextSceneId) targets.add(bridge.nextSceneId);
      }
    }
    return targets;
  }

  it('synthesizes bridge-routed branch choices when the branch beat has none (the endsong ep1 case)', () => {
    const episode = episodeWithEmptyBranchBeat();
    const wired = repairLostSceneGraphBranches(episode, endsongLikeBlueprint());

    expect(wired).toBe(1);
    const scene1 = episode.scenes![0];
    const beat = scene1.beats!.find((b) => b.isChoicePoint)!;
    expect(beat.choices!.length).toBeGreaterThanOrEqual(2);
    // both distinct forward targets reachable via choice-bridge beats
    expect(branchTargetsVia(scene1)).toEqual(new Set(['scene-2', 'scene-3']));
    // and a bridge beat exists for each
    expect((scene1.beats || []).filter((b) => b.isChoiceBridge).length).toBeGreaterThanOrEqual(2);
  });

  it('wires existing target-less choices through bridges instead of synthesizing', () => {
    const episode: RepairEpisode = {
      scenes: [
        {
          id: 'scene-1',
          beats: [{ id: 'beat-5', isChoicePoint: true, choices: [
            { id: 'c1', text: 'Press forward' },
            { id: 'c2', text: 'Hold back' },
          ] }],
        },
        { id: 'scene-2', beats: [] },
        { id: 'scene-3', beats: [] },
      ],
    };
    const wired = repairLostSceneGraphBranches(episode, {
      scenes: [
        { id: 'scene-1', leadsTo: ['scene-2', 'scene-3'], choicePoint: { branches: true } },
        { id: 'scene-2', leadsTo: [] },
        { id: 'scene-3', leadsTo: [] },
      ],
    });

    expect(wired).toBe(1);
    const scene1 = episode.scenes![0];
    const choices = scene1.beats![0].choices!;
    expect(choices).toHaveLength(2); // reused, not synthesized
    expect(choices.every((c) => !!c.nextBeatId && !c.nextSceneId)).toBe(true);
    expect(branchTargetsVia(scene1)).toEqual(new Set(['scene-2', 'scene-3']));
  });

  it('is a no-op when the episode already has a scene-graph branch', () => {
    const episode: RepairEpisode = {
      scenes: [
        { id: 'scene-1', beats: [{ id: 'b', isChoicePoint: true, choices: [{ id: 'c', nextSceneId: 'scene-2' }] }] },
        { id: 'scene-2', beats: [] },
      ],
    };
    expect(repairLostSceneGraphBranches(episode, {
      scenes: [{ id: 'scene-1', leadsTo: ['scene-2', 'scene-3'], choicePoint: { branches: true } }],
    })).toBe(0);
  });

  it('produces branches that satisfy the real SceneGraphBranchValidator (requireChoiceBridge)', () => {
    const episode = episodeWithEmptyBranchBeat();
    const blueprint = endsongLikeBlueprint();
    const opts = { requireSceneGraphBranching: true, minSceneGraphBranchesPerEpisode: 1 };

    // Before repair: the planned branch was lost → validator fails.
    const before = new SceneGraphBranchValidator().validateEpisode(episode as any, blueprint as any, opts);
    expect(before.valid).toBe(false);

    repairLostSceneGraphBranches(episode, blueprint);

    // After repair: branches route through bridge beats → no branch errors,
    // including no missing_choice_bridge (requireChoiceBridge defaults on).
    const after = new SceneGraphBranchValidator().validateEpisode(episode as any, blueprint as any, opts);
    const branchErrors = after.issues.filter(
      (i) => i.severity === 'error' &&
        ['lost_branch_during_assembly', 'missing_scene_graph_branch', 'missing_choice_bridge', 'invalid_branch_target', 'backward_or_self_branch'].includes(i.type),
    );
    expect(branchErrors).toEqual([]);
    expect(after.metrics.sceneGraphBranchChoiceCount).toBeGreaterThanOrEqual(1);
  });

  it('does not wire backward/self/missing targets (needs ≥2 distinct forward targets)', () => {
    const episode: RepairEpisode = {
      scenes: [
        { id: 'scene-1', beats: [] },
        { id: 'scene-2', beats: [{ id: 'b', isChoicePoint: true, choices: [] }] },
      ],
    };
    // scene-2 leadsTo scene-1 (backward) + missing-scene → no valid forward branch
    expect(repairLostSceneGraphBranches(episode, {
      scenes: [{ id: 'scene-2', leadsTo: ['scene-1', 'nope'], choicePoint: { branches: true } }],
    })).toBe(0);
  });
});
