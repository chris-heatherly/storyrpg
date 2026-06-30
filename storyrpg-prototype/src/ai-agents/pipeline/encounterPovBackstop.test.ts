import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import {
  applyEncounterPovBackstop,
  findEncounterPovBreaks,
  protagonistFromStory,
} from './encounterPovBackstop';

function storyWithEncounter(
  storyletText: string,
  npcs?: Array<Record<string, unknown>>,
  extraEncounter: Record<string, unknown> = {},
): Story {
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
              ...extraEncounter,
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

  it('repairs second-person residue even after the protagonist name is gone', () => {
    const story = storyWithEncounter('', undefined, {
      description: 'Walking home through Cișmigiu at 1am, you are pinned to a willow by a shadow — and a second figure in a charcoal suit drops the attacker, walks her home, kisses her hand at the threshold, declines to come in, and vanishes.',
    });
    const res = applyEncounterPovBackstop(story);
    expect(res.coerced).toBe(1);
    const encounter = story.episodes[0].scenes[0].encounter as any;
    expect(encounter.description).toBe('Walking home through Cișmigiu at 1am, you are pinned to a willow by a shadow — and a second figure in a charcoal suit drops the attacker, walks you home, kisses your hand at the threshold, declines to come in, and vanishes.');
  });

  it('repairs encounter stakes victory/defeat fields scanned by the final contract', () => {
    const story = storyWithEncounter('', undefined, {
      stakes: {
        victory: 'Kylie survives and a new, dark romantic possibility opens.',
        defeat: 'Kylie is overwhelmed, losing her sense of safety in the new city.',
      },
    });
    const res = applyEncounterPovBackstop(story);
    expect(res.residualBreaks).toEqual([]);
    const stakes = (story.episodes[0].scenes[0].encounter as any).stakes;
    expect(stakes.victory).toBe('You survive and a new, dark romantic possibility opens.');
    expect(stakes.defeat).toBe('You are overwhelmed, losing your sense of safety in the new city.');
  });

  it('prefers the roster protagonist over an unsafe provided name', () => {
    const story = storyWithEncounter('Kylie straightens her collar.', undefined, {
      phases: [{
        id: 'phase-1',
        beats: [{
          id: 'beat-1',
          setupText: 'The Cișmigiu paths are dead quiet. A second figure steps from the fog.',
        }],
      }],
    });
    const res = applyEncounterPovBackstop(story, { name: 'The', pronouns: 'she/her' });
    expect(res.coerced).toBe(1);
    const encounter = story.episodes[0].scenes[0].encounter as any;
    expect(encounter.phases[0].beats[0].setupText).toBe('The Cișmigiu paths are dead quiet. A second figure steps from the fog.');
    expect(encounter.storylets.victory.beats[0].text).toBe('You straighten your collar.');
  });

  it('leaves imperative choice labels untouched while repairing encounter description prose', () => {
    const story = storyWithEncounter('', undefined, {
      description: 'Kylie is pinned to a willow by a shadow, walks her home, and kisses her hand.',
      phases: [{
        id: 'phase-1',
        beats: [{
          id: 'beat-1',
          setupText: 'The shadow digs her claws into the bark. The stranger extends his hand.',
          choices: [{
            id: 'c1',
            text: "Twist violently out of the shadow's grip just as the suited man strikes.",
            approach: 'aggressive',
            outcomes: {
              success: { narrativeText: 'Kylie steadies her breath and keeps moving.' },
              complicated: { narrativeText: 'Kylie lets him walk her home.' },
              failure: { narrativeText: 'Kylie touches her bruised throat.' },
            },
          }],
        }],
      }],
    });
    const res = applyEncounterPovBackstop(story);
    expect(res.residualBreaks).toEqual([]);
    const encounter = story.episodes[0].scenes[0].encounter as any;
    expect(encounter.description).toBe('You are pinned to a willow by a shadow, walks you home, and kisses your hand.');
    expect(encounter.phases[0].beats[0].setupText).toBe('The shadow digs her claws into the bark. The stranger extends his hand.');
    expect(encounter.phases[0].beats[0].choices[0].text).toBe("Twist violently out of the shadow's grip just as the suited man strikes.");
    expect(encounter.phases[0].beats[0].choices[0].outcomes.complicated.narrativeText).toBe('You let him walk you home.');
  });

  it('repairs encounter choice text that names the protagonist as a separate person', () => {
    const story = storyWithEncounter('', undefined, {
      phases: [{
        id: 'phase-1',
        beats: [{
          id: 'beat-1',
          choices: [{
            id: 'c1',
            text: "Refuse the seat and demand Kylie's location.",
            approach: 'defiant',
            outcomes: {
              success: { narrativeText: 'Victor answers without looking away.' },
            },
          }],
        }],
      }],
    });

    expect(findEncounterPovBreaks(story)).toContain("Refuse the seat and demand Kylie's location.");
    const res = applyEncounterPovBackstop(story);
    expect(res.residualBreaks).toEqual([]);
    const choice = (story.episodes[0].scenes[0].encounter as any).phases[0].beats[0].choices[0];
    expect(choice.text).toBe('Refuse the seat and demand answers.');
  });

  it('repairs visual and cost support fields that feed reader packaging', () => {
    const story = storyWithEncounter('', undefined, {
      phases: [{
        id: 'phase-1',
        beats: [{
          id: 'beat-1',
          choices: [{
            id: 'c1',
            text: 'Hold still.',
            outcomes: {
              success: {
                narrativeText: 'Kylie steadies her breath.',
                visualMoment: "Kylie's favorite scarf is torn, her neck bruised.",
                visualContract: { visibleCost: "Kylie's throat is bruised." },
                cost: { visibleComplication: "Kylie's bruise will be hard to hide." },
              },
            },
          }],
        }],
      }],
    });

    expect(findEncounterPovBreaks(story).length).toBeGreaterThan(0);
    const res = applyEncounterPovBackstop(story);
    expect(res.residualBreaks).toEqual([]);
    const success = (story.episodes[0].scenes[0].encounter as any).phases[0].beats[0].choices[0].outcomes.success;
    expect(success.visualMoment).toBe('Your favorite scarf is torn, your neck bruised.');
    expect(success.visualContract.visibleCost).toBe('Your throat is bruised.');
    expect(success.cost.visibleComplication).toBe('Your bruise will be hard to hide.');
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
