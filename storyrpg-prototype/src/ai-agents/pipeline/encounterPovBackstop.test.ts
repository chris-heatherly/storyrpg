import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import {
  applyEncounterPovBackstop,
  findEncounterPovBreaks,
  protagonistFromStory,
} from './encounterPovBackstop';

function storyWithEncounter(storyletText: string, npcs?: Array<Record<string, unknown>>): Story {
  return {
    npcs: npcs ?? [
      { id: 'p', name: 'Kylie Marinescu', role: 'protagonist', pronouns: 'she/her' },
      { id: 'v', name: 'Victor', role: 'antagonist', pronouns: 'he/him' },
    ],
    episodes: [
      {
        id: 'ep1',
        number: 1,
        scenes: [
          {
            id: 's1',
            encounter: {
              storylets: {
                victory: { beats: [{ id: 'b1', text: storyletText }] },
              },
            },
          },
        ],
      },
    ],
  } as unknown as Story;
}

describe('encounterPovBackstop (WS0.3)', () => {
  it('resolves the protagonist from the roster role', () => {
    const story = storyWithEncounter('You win.');
    expect(protagonistFromStory(story)?.name).toBe('Kylie Marinescu');
  });

  it('detects a third-person protagonist break in encounter prose', () => {
    const story = storyWithEncounter('Kylie straightens her collar as Victor watches.');
    expect(findEncounterPovBreaks(story).length).toBe(1);
  });

  it('coerces the break to second person in place (verb agreement) and clears residue', () => {
    const story = storyWithEncounter('Kylie straightens her collar. She has become the story.');
    const res = applyEncounterPovBackstop(story);
    expect(res.coerced).toBe(1);
    expect(res.residualBreaks).toEqual([]);
    const fixed = (story.episodes[0].scenes[0] as { encounter: { storylets: { victory: { beats: { text: string }[] } } } })
      .encounter.storylets.victory.beats[0].text;
    expect(fixed).toBe('You straighten your collar. You have become the story.');
  });

  it('leaves NPC-only prose untouched', () => {
    const story = storyWithEncounter('Victor pours the champagne, his gaze steady.');
    const res = applyEncounterPovBackstop(story);
    expect(res.coerced).toBe(0);
    expect(res.residualBreaks).toEqual([]);
  });

  it('is idempotent (running twice changes nothing the second time)', () => {
    const story = storyWithEncounter('Kylie straightens her collar.');
    applyEncounterPovBackstop(story);
    const second = applyEncounterPovBackstop(story);
    expect(second.coerced).toBe(0);
  });

  it('no protagonist role → no-op', () => {
    const story = storyWithEncounter('Kylie straightens her collar.', [
      { id: 'v', name: 'Victor', role: 'antagonist', pronouns: 'he/him' },
    ]);
    expect(applyEncounterPovBackstop(story).coerced).toBe(0);
  });
});
