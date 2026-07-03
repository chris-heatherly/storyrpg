import { describe, expect, it } from 'vitest';
import { IncrementalSensitivityChecker, IncrementalValidationRunner } from './IncrementalValidators';
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

describe('IncrementalSensitivityChecker — military vs personal "assault"', () => {
  const sceneWith = (text: string): SceneContent =>
    makeScene({ beats: [{ id: 'b1', text }] });

  it('does NOT flag military "assault" as M-rated trauma (the war-prose false positive)', () => {
    const checker = new IncrementalSensitivityChecker('T');
    const result = checker.checkScene(sceneWith('The assault resumes. Between assault waves the fort breathes.'));
    expect(result.passed).toBe(true);
    expect(result.ratingImplication).toBeUndefined();
  });

  it('still flags "sexual assault" as exceeding a T target', () => {
    const checker = new IncrementalSensitivityChecker('T');
    const result = checker.checkScene(sceneWith('The report described a sexual assault.'));
    expect(result.passed).toBe(false);
    expect(result.ratingImplication).toBe('M');
  });
});

describe('IncrementalSensitivityChecker — innocent "cock-" words (Scunthorpe FPs)', () => {
  const sceneWith = (text: string): SceneContent =>
    makeScene({ beats: [{ id: 'b1', text }] });

  it('does NOT flag "cocktail" as strong language (bite-me 2026-07-03 scene-lock false positive)', () => {
    const checker = new IncrementalSensitivityChecker('T');
    const result = checker.checkScene(sceneWith('You sip a cocktail sharp with lime as Mika and Stela debate vintage band tees.'));
    expect(result.passed).toBe(true);
    expect(result.flags.filter((f) => f.category === 'language')).toHaveLength(0);
  });

  it('still flags the bare profanity as strong language', () => {
    const checker = new IncrementalSensitivityChecker('T');
    const result = checker.checkScene(sceneWith('He grabs his cock and laughs.'));
    expect(result.flags.some((f) => f.category === 'language' && f.severity === 'strong')).toBe(true);
  });
});

describe('IncrementalValidationRunner — sensitivity is advisory, not a hard block', () => {
  it('records sensitivity flags without changing overallPassed (no silent contract dead-end)', async () => {
    const runner = new IncrementalValidationRunner([], [], []);
    const cleanText = makeScene().beats[0].text;
    const clean = await runner.validateScene(makeScene(), undefined, []);
    // Same otherwise-clean scene, with genuinely M-rated personal trauma appended.
    const flagged = await runner.validateScene(
      makeScene({ beats: [{ id: 'beat-1', text: `${cleanText} It was rape, plain and unspeakable.` }] }),
      undefined,
      [],
    );
    // Sensitivity DID flag the content...
    expect(flagged.sensitivity?.passed).toBe(false);
    // ...but it did not add a contract block beyond whatever the clean scene already had.
    expect(flagged.overallPassed).toBe(clean.overallPassed);
  });
});
