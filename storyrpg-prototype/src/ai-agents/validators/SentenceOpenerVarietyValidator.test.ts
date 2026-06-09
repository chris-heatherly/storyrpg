import { describe, it, expect } from 'vitest';
import { SentenceOpenerVarietyValidator } from './SentenceOpenerVarietyValidator';
import type { Story } from '../../types';

function storyWith(beatText: string, outcome?: { success?: string; partial?: string; failure?: string }): Story {
  return {
    id: 's', title: 't', genre: 'fantasy', synopsis: '', coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep-1', number: 1, title: 'E1', synopsis: '', coverImage: '', startingSceneId: 's1',
      scenes: [{
        id: 's1', name: 'Scene', startingBeatId: 'b1',
        beats: [{
          id: 'b1', text: beatText,
          choices: outcome ? [{ id: 'c1', text: 'Do it.', outcomeTexts: outcome }] : undefined,
        }],
      }],
    }],
  } as unknown as Story;
}

const run = (story: Story) => new SentenceOpenerVarietyValidator().validate({ story });

describe('SentenceOpenerVarietyValidator', () => {
  it('flags a beat that stacks 3 consecutive "You" openers', () => {
    const res = run(storyWith('You save the file. You close the laptop. You go out.'));
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].severity).toBe('warning');
    expect(res.issues[0].message).toMatch(/consecutive sentences with "You/);
  });

  it('flags a monotonous outcome tier and names the choice', () => {
    const res = run(storyWith('The door opens.', {
      success: 'You take the card. You clock the squeeze. You let the thought dissolve.',
    }));
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].message).toMatch(/Choice "c1:success"/);
  });

  it('does not flag varied prose that still uses second person', () => {
    const res = run(storyWith('The lavender clings to everything. You set down the keys. Two suitcases wait like witnesses. Somewhere a pipe ticks.'));
    expect(res.issues).toHaveLength(0);
    expect(res.valid).toBe(true);
  });

  it('does not flag two consecutive "You" openers (below threshold)', () => {
    const res = run(storyWith('You wait. You listen. The hallway stays silent.'));
    expect(res.issues).toHaveLength(0);
  });
});
