import { describe, expect, it } from 'vitest';
import { flagSceneForCritic, sceneCriticFlags } from './sceneCriticFlags';
import type { SceneContent } from '../agents/SceneWriter';

function scene(): SceneContent {
  return {
    sceneId: 's1-1',
    sceneName: 'Club Door',
    beats: [],
    startingBeatId: 'b1',
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
  } as unknown as SceneContent;
}

describe('sceneCriticFlags', () => {
  it('is empty for an untagged scene', () => {
    expect(sceneCriticFlags(scene())).toEqual([]);
  });

  it('records distinct reasons and dedupes repeats', () => {
    const sc = scene();
    flagSceneForCritic(sc, 'incremental-validation-regen');
    flagSceneForCritic(sc, 'incremental-validation-regen');
    flagSceneForCritic(sc, 'realization-retry');
    expect(sceneCriticFlags(sc)).toEqual(['incremental-validation-regen', 'realization-retry']);
  });
});
