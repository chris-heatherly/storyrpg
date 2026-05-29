import { describe, it, expect } from 'vitest';
import { repairLostSceneGraphBranches, type RepairEpisode, type RepairBlueprint } from './branchRepair';

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
  it('synthesizes branch choices when the branch beat has none (the endsong ep1 case)', () => {
    const episode = episodeWithEmptyBranchBeat();
    const wired = repairLostSceneGraphBranches(episode, endsongLikeBlueprint());

    expect(wired).toBe(1);
    const beat = episode.scenes![0].beats!.find((b) => b.isChoicePoint)!;
    const targets = (beat.choices || []).map((c) => c.nextSceneId).filter(Boolean);
    // both distinct forward targets are now reachable via nextSceneId
    expect(new Set(targets)).toEqual(new Set(['scene-2', 'scene-3']));
    expect(beat.choices!.length).toBeGreaterThanOrEqual(2);
  });

  it('wires existing choices that lost their nextSceneId instead of synthesizing', () => {
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
    const choices = episode.scenes![0].beats![0].choices!;
    expect(choices).toHaveLength(2); // no synthesis needed
    expect(new Set(choices.map((c) => c.nextSceneId))).toEqual(new Set(['scene-2', 'scene-3']));
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
