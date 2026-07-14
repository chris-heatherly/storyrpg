import { describe, expect, it } from 'vitest';

import { evaluatePlannedSceneRepairCandidate } from './plannedScenePlanRepair';

function plan(sceneId: string, valid = true) {
  return {
    episodes: [{ episodeNumber: 1 }],
    scenePlan: {
      sourceHash: 'source',
      scenes: [{ id: sceneId, episodeNumber: 1 }],
      narrativeContractGraph: {
        sourceHash: 'graph',
        compilerVersion: 'test',
        validation: { passed: valid, issues: [] },
      },
      episodeEventPlans: {
        1: {
          episodeNumber: 1,
          sceneOrder: [sceneId],
          validation: { passed: valid, issues: [] },
        },
      },
    },
  } as never;
}

describe('planned scene repair transaction', () => {
  it('rejects byte-identical rebuilds as fixpoints', () => {
    const original = plan('scene-a');
    expect(evaluatePlannedSceneRepairCandidate({ original, candidate: structuredClone(original), episodeNumber: 1 }))
      .toMatchObject({ refreshed: false, status: 'fixpoint' });
  });

  it('accepts only a changed candidate with valid graph and episode plan', () => {
    expect(evaluatePlannedSceneRepairCandidate({
      original: plan('scene-a'),
      candidate: plan('scene-b'),
      episodeNumber: 1,
    })).toMatchObject({ refreshed: true, status: 'repaired' });
    expect(evaluatePlannedSceneRepairCandidate({
      original: plan('scene-a'),
      candidate: plan('scene-b', false),
      episodeNumber: 1,
    })).toMatchObject({ refreshed: false, status: 'invalid_candidate' });
  });
});
