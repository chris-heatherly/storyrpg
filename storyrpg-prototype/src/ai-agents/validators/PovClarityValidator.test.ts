import { describe, expect, it } from 'vitest';

import { hasPlayerReference, PovClarityValidator } from './PovClarityValidator';
import type { SceneContent } from '../agents/SceneWriter';

function scene(text: string, extras: Partial<SceneContent['beats'][number]> = {}): SceneContent {
  return {
    sceneId: 'scene-1',
    sceneName: 'Test Scene',
    beats: [{ id: 'beat-1', text, ...extras }],
    startingBeatId: 'beat-1',
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
  };
}

describe('PovClarityValidator', () => {
  it('passes when the opening beat uses second-person language', () => {
    const result = new PovClarityValidator().validateScene(
      scene('You step into the lantern light as Mara lowers her blade.'),
    );

    expect(result.passed).toBe(true);
    expect(result.shouldRegenerate).toBe(false);
  });

  it('passes when the opening beat uses a player template', () => {
    const result = new PovClarityValidator().validateScene(
      scene('{{player.name}} catches the falling map before Eros can burn it.'),
    );

    expect(result.passed).toBe(true);
  });

  it('fails when the opening beat is only NPC or environment exposition', () => {
    const result = new PovClarityValidator().validateScene(
      scene('Mara stands under the broken arch while rain gathers in the street.'),
    );

    expect(result.passed).toBe(false);
    expect(result.shouldRegenerate).toBe(true);
    expect(result.issues[0].issue).toContain('Opening beat does not establish');
  });

  it('flags ambiguous multi-character pronoun-heavy openings', () => {
    const result = new PovClarityValidator().validateScene(
      scene('He watches her cross the room, and she waits until they all look away.'),
      { characterNames: ['Alex', 'Mara'] },
    );

    expect(result.passed).toBe(false);
    expect(result.issues.some(issue => issue.issue.includes('pronouns'))).toBe(true);
  });

  it('passes source-styled narration when the player anchor is explicit', () => {
    const result = new PovClarityValidator().validateScene(
      scene('Rain turns the harbor lights into bruises as your hand closes around the letter.'),
    );

    expect(result.passed).toBe(true);
  });

  it('detects supported player references consistently', () => {
    expect(hasPlayerReference('{{player.they}} hold the line.')).toBe(true);
    expect(hasPlayerReference('Your shadow reaches the door first.')).toBe(true);
    expect(hasPlayerReference('Mara reaches the door first.')).toBe(false);
  });

  it('warns on a non-opening beat that flips into third person (gen-5 POV break)', () => {
    const sc: SceneContent = {
      sceneId: 'scene-1',
      sceneName: 'Test Scene',
      beats: [
        { id: 'beat-1', text: 'You hit publish at 4:47am and close the laptop.' } as SceneContent['beats'][number],
        { id: 'beat-2', text: 'Kylie hits publish at 11:47 PM. She wakes to 84,000. She stares at the screen.' } as SceneContent['beats'][number],
      ],
      startingBeatId: 'beat-1',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    };
    const result = new PovClarityValidator().validateScene(sc, { protagonistName: 'Kylie' });
    // Opening beat is fine (second person), so no error / no regen…
    expect(result.shouldRegenerate).toBe(false);
    // …but the third-person payoff beat is surfaced as an advisory warning.
    const povBreak = result.issues.find((i) => i.beatId === 'beat-2' && i.severity === 'warning');
    expect(povBreak).toBeDefined();
    expect(povBreak!.issue).toContain('third person');
  });

  it('does not flag an occasional self-naming beat that still addresses you', () => {
    const sc: SceneContent = {
      sceneId: 'scene-1',
      sceneName: 'Test Scene',
      beats: [
        { id: 'beat-1', text: 'You step into the light.' } as SceneContent['beats'][number],
        { id: 'beat-2', text: 'You sign it: Kylie Marinescu, and slide it across to her.' } as SceneContent['beats'][number],
      ],
      startingBeatId: 'beat-1',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    };
    const result = new PovClarityValidator().validateScene(sc, { protagonistName: 'Kylie' });
    expect(result.issues.some((i) => i.beatId === 'beat-2')).toBe(false);
  });
});
