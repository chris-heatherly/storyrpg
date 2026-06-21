import { describe, it, expect } from 'vitest';
import {
  applyBlueprintRequiredSetupSkipRepairsToChoiceSets,
  repairBlueprintRequiredSetupSkips,
  repairInvalidBranchTargets,
  repairInvalidBranchTargetsInChoiceSets,
  repairLostSceneGraphBranches,
  repairRequiredSetupSkips,
  repairRequiredSetupSkipsInChoiceSets,
  type RepairEpisode,
  type RepairBlueprint,
} from './branchRepair';
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

  it('retargets a choice bridge that skips required setup to the first skipped setup scene', () => {
    const episode: RepairEpisode = {
      scenes: [
        {
          id: 's1-1',
          beats: [{
            id: 's1-1-b6',
            choices: [{ id: 's1-1-b6-c2', nextBeatId: 's1-1-b6-c2-bridge' }],
          }, {
            id: 's1-1-b6-c2-bridge',
            isChoiceBridge: true,
            nextSceneId: 'treatment-enc-1-1',
          }],
        },
        { id: 's1-2', beats: [{ id: 'b', choices: [] }] },
        { id: 's1-3', beats: [{ id: 'b', choices: [] }] },
        { id: 'treatment-enc-1-1', beats: [] },
      ],
    };
    const blueprint: RepairBlueprint = {
      scenes: [
        { id: 's1-1', leadsTo: ['s1-2', 'treatment-enc-1-1'], choicePoint: { branches: true } },
        { id: 's1-2', leadsTo: ['s1-3'] },
        { id: 's1-3', leadsTo: ['treatment-enc-1-1'] },
        { id: 'treatment-enc-1-1', leadsTo: [] },
      ],
    };

    const repaired = repairRequiredSetupSkips(episode, [{
      type: 'path_missing_required_setup',
      sceneId: 's1-1',
      beatId: 's1-1-b6',
      choiceId: 's1-1-b6-c2',
      targetSceneId: 'treatment-enc-1-1',
      skippedSceneIds: ['s1-2', 's1-3'],
    }], blueprint);

    expect(repaired).toBe(1);
    expect(episode.scenes![0].beats![1].nextSceneId).toBe('s1-2');
    expect(episode.scenes![0].beats![1].repairedRequiredSetupSkip).toBe(true);
    expect(blueprint.scenes![0].leadsTo).toEqual(['s1-2']);
  });

  it('retargets the source choice set so durable assembly cannot recreate the skipped bridge', () => {
    const choiceSets = [{
      sceneId: 's1-1',
      choices: [
        { id: 's1-1-b6-c1', nextSceneId: 's1-2' },
        { id: 's1-1-b6-c2', nextSceneId: 'treatment-enc-1-1' },
      ],
    }];
    const blueprint: RepairBlueprint = {
      scenes: [
        { id: 's1-1', leadsTo: ['s1-2', 'treatment-enc-1-1'], choicePoint: { branches: true } },
        { id: 's1-2', leadsTo: ['s1-3'] },
        { id: 's1-3', leadsTo: ['treatment-enc-1-1'] },
        { id: 'treatment-enc-1-1', leadsTo: [] },
      ],
    };

    const repaired = repairRequiredSetupSkipsInChoiceSets(choiceSets, [{
      type: 'path_missing_required_setup',
      sceneId: 's1-1',
      beatId: 's1-1-b6',
      choiceId: 's1-1-b6-c2',
      targetSceneId: 'treatment-enc-1-1',
      skippedSceneIds: ['s1-2', 's1-3'],
    }], blueprint);

    expect(repaired).toBe(1);
    expect(choiceSets[0].choices[1].nextSceneId).toBe('s1-2');
    expect(choiceSets[0].choices[1].repairedRequiredSetupSkip).toBe(true);
    expect(blueprint.scenes![0].leadsTo).toEqual(['s1-2']);
  });

  it('collapses blueprint sibling targets that would skip an encounter setup scene', () => {
    const blueprint: RepairBlueprint = {
      scenes: [
        { id: 's1-1', leadsTo: ['s1-2'] },
        { id: 's1-2', leadsTo: ['s1-3'] },
        { id: 's1-3', leadsTo: ['s1-4'] },
        { id: 's1-4', leadsTo: ['enc-1-1', 's1-6'], choicePoint: { branches: true } },
        { id: 'enc-1-1', name: 'combat encounter', leadsTo: ['s1-6'], isEncounter: true },
        { id: 's1-6', leadsTo: [] },
      ],
    };
    const choiceSets = [{
      sceneId: 's1-4',
      choices: [
        { id: 's1-4-b7-c1', nextSceneId: 'enc-1-1' },
        { id: 's1-4-b7-c2', nextSceneId: 's1-6' },
      ],
    }];

    const repairs = repairBlueprintRequiredSetupSkips(blueprint);
    const repairedChoices = applyBlueprintRequiredSetupSkipRepairsToChoiceSets(choiceSets, repairs);

    expect(repairs).toEqual([{
      sceneId: 's1-4',
      fromTargetSceneId: 's1-6',
      toTargetSceneId: 'enc-1-1',
      skippedSceneIds: ['enc-1-1'],
    }]);
    expect(blueprint.scenes![3].leadsTo).toEqual(['enc-1-1']);
    expect(blueprint.scenes![3].choicePoint?.branches).toBe(false);
    expect(repairedChoices).toBe(1);
    expect(choiceSets[0].choices.map((choice) => choice.nextSceneId)).toEqual(['enc-1-1', 'enc-1-1']);
    expect(choiceSets[0].choices[1].repairedRequiredSetupSkip).toBe(true);
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

  it('retargets missing final-scene choice routes to episode-end', () => {
    const episode: RepairEpisode = {
      scenes: [
        { id: 's1', beats: [{ id: 'b1', choices: [{ id: 'c1', nextSceneId: 'scene_7_blog_post_romance' }] }] },
      ],
    };
    const blueprint: RepairBlueprint = { scenes: [{ id: 's1', leadsTo: [] }] };

    const repaired = repairInvalidBranchTargets(episode, [{
      type: 'invalid_branch_target',
      sceneId: 's1',
      beatId: 'b1',
      choiceId: 'c1',
      targetSceneId: 'scene_7_blog_post_romance',
    }], blueprint);

    expect(repaired).toBe(1);
    expect(episode.scenes![0].beats![0].choices![0].nextSceneId).toBe('episode-end');
    expect(episode.scenes![0].beats![0].choices![0].repairedInvalidBranchTarget).toBe(true);
  });

  it('retargets missing source choice-set routes so reassembly stays repaired', () => {
    const choiceSets = [{
      sceneId: 's1',
      choices: [{ id: 'c1', nextSceneId: 'scene_7_blog_post_romance' }],
    }];
    const episode: RepairEpisode = { scenes: [{ id: 's1', beats: [] }] };
    const blueprint: RepairBlueprint = { scenes: [{ id: 's1', leadsTo: [] }] };

    const repaired = repairInvalidBranchTargetsInChoiceSets(choiceSets, [{
      type: 'invalid_branch_target',
      sceneId: 's1',
      beatId: 'b1',
      choiceId: 'c1',
      targetSceneId: 'scene_7_blog_post_romance',
    }], episode, blueprint);

    expect(repaired).toBe(1);
    expect(choiceSets[0].choices[0].nextSceneId).toBe('episode-end');
    expect(choiceSets[0].choices[0].repairedInvalidBranchTarget).toBe(true);
  });
});
