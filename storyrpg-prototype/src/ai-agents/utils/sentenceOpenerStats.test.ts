import { describe, it, expect } from 'vitest';
import {
  splitSentences,
  openerWord,
  isSecondPersonOpener,
  longestSecondPersonRun,
  analyzeStory,
  MONOTONY_RUN_THRESHOLD,
} from './sentenceOpenerStats';
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

describe('sentenceOpenerStats helpers', () => {
  it('splits sentences and reads the opener word past quotes/dashes', () => {
    const ss = splitSentences('You run. "Stop," she says. The door slams.');
    expect(ss.length).toBe(3);
    expect(openerWord(ss[0])).toBe('You');
    expect(openerWord(ss[1])).toBe('Stop');
    expect(openerWord(ss[2])).toBe('The');
  });

  it('detects second-person openers including contractions', () => {
    expect(isSecondPersonOpener('You')).toBe(true);
    expect(isSecondPersonOpener('Your')).toBe(true);
    expect(isSecondPersonOpener("You're")).toBe(true);
    expect(isSecondPersonOpener('The')).toBe(false);
    expect(isSecondPersonOpener('Young')).toBe(false); // non-pronoun "you…" word must NOT count
    expect(isSecondPersonOpener('Youth')).toBe(false);
  });

  it('measures the longest consecutive second-person run', () => {
    expect(longestSecondPersonRun(splitSentences('You go. You stop. The wind. You wait.'))).toBe(2);
    expect(longestSecondPersonRun(splitSentences('You go. You stop. You wait.'))).toBe(3);
    expect(longestSecondPersonRun(splitSentences('The wind howls. Mika waits.'))).toBe(0);
  });
});

describe('analyzeStory', () => {
  it('counts second-person openers across beats and outcome tiers', () => {
    const stats = analyzeStory(storyWith('You wait. The room is cold.', { success: 'Mika nods.', partial: 'You fail.', failure: 'The line goes dead.' }));
    expect(stats.totalSentences).toBe(5);
    expect(stats.secondPersonOpenings).toBe(2);
    expect(stats.byBucket.beat.sentences).toBe(2);
    expect(stats.byBucket.outcome.sentences).toBe(3);
    expect(stats.secondPersonRatio).toBeCloseTo(2 / 5);
  });

  it('flags a beat with a monotony run at the threshold', () => {
    const stats = analyzeStory(storyWith('You save the file. You close the laptop. You go out.'));
    expect(stats.longestRun).toBe(MONOTONY_RUN_THRESHOLD);
    expect(stats.monotonyPassages).toHaveLength(1);
    expect(stats.monotonyPassages[0].bucket).toBe('beat');
    expect(stats.monotonyPassages[0].where).toBe('b1');
  });

  it('does not flag a varied beat that still uses second person', () => {
    const stats = analyzeStory(storyWith('The lavender smell clings. You set down the keys. Two suitcases wait like witnesses.'));
    expect(stats.monotonyPassages).toHaveLength(0);
    expect(stats.secondPersonOpenings).toBe(1);
  });

  it('flags a monotonous outcome tier scoped to the choice + tier', () => {
    const stats = analyzeStory(storyWith('The door opens.', {
      success: 'You take the card. You clock the squeeze. You let the thought dissolve.',
    }));
    expect(stats.monotonyPassages).toHaveLength(1);
    expect(stats.monotonyPassages[0].bucket).toBe('outcome');
    expect(stats.monotonyPassages[0].where).toBe('c1:success');
  });
});
