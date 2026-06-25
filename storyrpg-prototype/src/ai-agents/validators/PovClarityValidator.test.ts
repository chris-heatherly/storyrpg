import { describe, expect, it } from 'vitest';

import { hasPlayerReference, PovClarityValidator, coerceFirstPersonNarrationToSecond } from './PovClarityValidator';
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

  it('findThirdPersonProtagonistTexts flags encounter-outcome prose narrated in third person', () => {
    const validator = new PovClarityValidator();
    const texts = [
      'You clock the door before he does.', // second person — in register
      'Kylie smiles back and lets her keep it, filing the whole exchange somewhere useful.', // 3rd-person protagonist
      'Mika watches you from across the booth.', // NPC 3rd person + "you" — fine
      'Kylie has the thread now, and she is not letting go.', // 3rd-person protagonist
    ];
    const hits = validator.findThirdPersonProtagonistTexts(texts, 'Kylie');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toContain('Kylie smiles back');
  });

  it('findThirdPersonProtagonistTexts returns nothing when every text addresses you', () => {
    const validator = new PovClarityValidator();
    const hits = validator.findThirdPersonProtagonistTexts(
      ['You take the card.', 'Your pulse steadies as Aethavyr turns away.', ''],
      'Aethavyr',
    );
    expect(hits).toEqual([]);
  });

  it('does not treat protagonist direct address inside dialogue as third-person narration', () => {
    const validator = new PovClarityValidator();
    const hits = validator.findThirdPersonProtagonistTexts(
      [
        "He withdraws his hand, raising it in mock surrender. 'A warning, Kylie. The world is rarely kind to the devoted.' He respects the boundary, though the danger remains.",
      ],
      'Kylie',
    );
    expect(hits).toEqual([]);
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

// bite-me-g16 ep2 cliffhanger coda shipped in first person — nothing detected it.
describe('first-person POV detection (bite-me-g16 coda)', () => {
  const v = new PovClarityValidator();

  it('detects first-person narration', () => {
    const hits = v.findFirstPersonProtagonistTexts([
      'The sun glints off the coffee mug beside my laptop. My thumb hovers, and I have to choose which one is real.',
    ]);
    expect(hits).toHaveLength(1);
  });

  it('does NOT flag first-person inside quoted dialogue', () => {
    const hits = v.findFirstPersonProtagonistTexts([
      'You hesitate. "I would like that very much," Victor says, and you believe him.',
    ]);
    expect(hits).toHaveLength(0);
  });

  it('does NOT let an orphan closing quote invert later dialogue masking', () => {
    const hits = v.findFirstPersonProtagonistTexts([
      'It\'s not working." Mika snaps her laptop shut. "Three dates, three disasters. I\'m done waiting." She slides a card toward you.',
    ]);
    expect(hits).toHaveLength(0);
  });

  it('does NOT flag clean second-person narration', () => {
    const hits = v.findFirstPersonProtagonistTexts([
      'You set down your glass. Your thumb hovers over the keyboard.',
    ]);
    expect(hits).toHaveLength(0);
  });
});

describe('coerceFirstPersonNarrationToSecond', () => {
  it('rewrites first-person narration to second person, sentence-capitalized', () => {
    const { text, changed } = coerceFirstPersonNarrationToSecond(
      'The light hits my laptop. My thumb hovers, and I have to choose.',
    );
    expect(changed).toBe(true);
    expect(text).toBe('The light hits your laptop. Your thumb hovers, and you have to choose.');
  });

  it('leaves quoted dialogue untouched', () => {
    const { text } = coerceFirstPersonNarrationToSecond('You freeze. "I will find you," he says.');
    expect(text).toContain('"I will find you,"');
    expect(text.startsWith('You freeze.')).toBe(true);
  });

  it('is a no-op on clean second-person prose', () => {
    const { text, changed } = coerceFirstPersonNarrationToSecond('You step into the light.');
    expect(changed).toBe(false);
    expect(text).toBe('You step into the light.');
  });
});
