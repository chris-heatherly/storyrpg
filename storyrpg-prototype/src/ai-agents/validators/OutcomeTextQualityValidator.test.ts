import { describe, it, expect } from 'vitest';
import { OutcomeTextQualityValidator } from './OutcomeTextQualityValidator';
import type { Story } from '../../types';

function storyWithChoice(choice: Record<string, unknown>): Story {
  return {
    id: 's', title: 't', genre: 'fantasy', synopsis: '', coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [{ id: 'char-victor', name: 'Victor', pronouns: 'he/him' }] as never,
    episodes: [{
      id: 'ep-1', number: 1, title: 'E1', synopsis: '', coverImage: '', startingSceneId: 's1',
      scenes: [{
        id: 's1', name: 'Scene', startingBeatId: 'b1',
        beats: [{ id: 'b1', text: 'x', choices: [choice] }],
      }],
    }],
  } as unknown as Story;
}

const run = (choice: Record<string, unknown>, properNouns?: string[]) =>
  new OutcomeTextQualityValidator().validate({ story: storyWithChoice(choice), properNouns });

describe('OutcomeTextQualityValidator', () => {
  it('flags the scaffold-leak fallback fingerprint', () => {
    const res = run({
      id: 'c3', text: 'Set the line.',
      stakes: { want: 'reclaim the writer position', cost: 'victor gets a post about himself' },
      outcomeTexts: {
        success: 'It works — you get what you reached for: reclaim the writer position.',
        partial: 'You get part of what you wanted, but it costs you: victor gets a post about himself.',
        failure: 'It slips away from you, and victor gets a post about himself.',
      },
    });
    expect(res.valid).toBe(false);
    expect(res.issues.filter((i) => /authoring-scaffold stub/.test(i.message)).length).toBe(3);
  });

  it('flags an echo of the want/cost annotation', () => {
    const res = run({
      id: 'c1', text: 'Do it.',
      stakes: { want: 'establish that the blog is not negotiable', cost: 'a real and lasting cost lands here' },
      outcomeTexts: {
        success: 'establish that the blog is not negotiable',
        partial: 'A tense, distinct middle outcome plays out across the room.',
        failure: 'A different, distinct failure beat where everything goes wrong fast.',
      },
    });
    expect(res.issues.some((i) => /restates the stakes want/.test(i.message))).toBe(true);
  });

  it('flags identical tiers', () => {
    const res = run({
      id: 'c2', text: 'Try.',
      outcomeTexts: { success: 'The door opens.', partial: 'The door opens slowly enough to matter.', failure: 'The door opens.' },
    });
    expect(res.issues.some((i) => /identical/.test(i.message))).toBe(true);
  });

  it('flags a sentence-initial lowercased proper noun', () => {
    const res = run({
      id: 'c4', text: 'Go.',
      outcomeTexts: {
        success: 'You hold the line and the room shifts. victor reads every word before he answers.',
        partial: 'A distinct partial beat unfolds with its own texture and consequence.',
        failure: 'A wholly different failure where the moment closes against you.',
      },
    }, ['Victor']);
    expect(res.issues.some((i) => i.severity === 'warning' && /lowercased proper noun/.test(i.message))).toBe(true);
  });

  it('passes clean, distinct, authored outcomes', () => {
    const res = run({
      id: 'c5', text: 'Step in.',
      stakes: { want: 'protect her without a word', cost: 'you reveal more than you meant to' },
      outcomeTexts: {
        success: 'You move before you decide to, and the blade meets your forearm instead of her throat.',
        partial: 'You reach her in time, but the cut you take will be hard to explain later.',
        failure: 'You are a half-step slow; the steel finds her shoulder and the room goes silent.',
      },
    });
    expect(res.valid).toBe(true);
    expect(res.issues).toHaveLength(0);
  });
});

describe('OutcomeTextQualityValidator — G12 fallback pool', () => {
  it('flags shipped ChoiceAuthor fallback stubs', () => {
    const story = {
      episodes: [{ id: 'ep1', scenes: [{ id: 's1', beats: [{ id: 'b1', choices: [{
        id: 'c3',
        text: 'Ask him outright who he is.',
        outcomeTexts: {
          success: 'For once it goes your way, a little cleaner than you expected.',
          partial: 'It works, mostly, though something slips loose in the doing and you notice.',
          failure: 'You come back with less than you brought.',
        },
      }] }] }] }],
    } as any;
    const result = new OutcomeTextQualityValidator().validate({ story });
    const fallbackIssues = result.issues.filter((i) => i.message.includes('fallback stub'));
    expect(fallbackIssues).toHaveLength(3);
    expect(result.valid).toBe(false);
  });
});
