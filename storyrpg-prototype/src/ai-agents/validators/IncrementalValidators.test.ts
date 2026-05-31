import { describe, expect, it } from 'vitest';
import { IncrementalValidationRunner } from './IncrementalValidators';
import type { SceneContent } from '../agents/SceneWriter';

function makeScene(overrides: Partial<SceneContent> = {}): SceneContent {
  return {
    sceneId: 'scene-1',
    sceneName: 'Test Scene',
    locationId: 'loc-1',
    beats: [
      {
        id: 'beat-1',
        text: 'The protagonist steps into the quiet room and takes stock of the situation.',
      },
    ],
    startingBeatId: 'beat-1',
    moodProgression: ['calm'],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
    ...overrides,
  } as SceneContent;
}

describe('IncrementalValidationRunner.validateScene zero-beat guard', () => {
  it('fails a non-encounter scene that has no authored beats', async () => {
    const runner = new IncrementalValidationRunner([], [], []);
    const result = await runner.validateScene(makeScene({ beats: [] }), undefined, []);

    expect(result.emptyScene).toBe(true);
    expect(result.overallPassed).toBe(false);
    expect(result.regenerationRequested).toBe('scene');
  });

  it('does not flag a scene that has authored beats', async () => {
    const runner = new IncrementalValidationRunner([], [], []);
    const result = await runner.validateScene(makeScene(), undefined, []);

    expect(result.emptyScene).toBeFalsy();
  });
});
