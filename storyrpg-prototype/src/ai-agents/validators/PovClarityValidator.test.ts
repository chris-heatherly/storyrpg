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
});
