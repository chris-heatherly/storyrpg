import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { NarrativeFailureModeValidator } from '../validators/NarrativeFailureModeValidator';
import { buildTenseDriftRepairHandler, repairLiveActionTense } from './tenseDriftRepairHandler';

function storyWithTenseDrift(): Story {
  return {
    id: 'st',
    title: 'T',
    episodes: [{
      id: 'ep-1',
      number: 1,
      scenes: [{
        id: 's1-1',
        name: 'Opening',
        beats: [{
          id: 's1-1-beat8-payoff-1',
          text: 'Before he turned, you saw it: a flicker of something in his eyes—calculation, perhaps even pity—and then it was gone, smoothed over by that impeccable calm.',
        }],
      }],
    }],
  } as unknown as Story;
}

describe('repairLiveActionTense', () => {
  it('rewrites common live-action past-tense drift into present tense', () => {
    const result = repairLiveActionTense(
      'Before he turned, you saw it: a flicker, and then it was gone. Your glass clicked against theirs.',
    );

    expect(result.changed).toBe(true);
    expect(result.value).toContain('Before he turns, you see it');
    expect(result.value).toContain('it is gone');
    expect(result.value).toContain('Your glass clicks');
  });
});

describe('buildTenseDriftRepairHandler', () => {
  it('repairs the beat named by a NarrativeFailureModeValidator tense-drift blocker', async () => {
    const story = storyWithTenseDrift();
    const handler = buildTenseDriftRepairHandler();

    const result = await handler({
      story,
      blockingIssues: [{
        type: 'prose_style_violation',
        severity: 'error',
        validator: 'NarrativeFailureModeValidator',
        sceneId: 's1-1',
        beatId: 's1-1-beat8-payoff-1',
        message: '[Tense drift] Beat "s1-1-beat8-payoff-1" appears to narrate live action in past tense: "Before he turned, you saw it..."',
      }],
    });

    expect(result.changed).toBe(true);
    const text = (story as any).episodes[0].scenes[0].beats[0].text;
    expect(text).toContain('Before he turns, you see it');
    expect(text).toContain('it is gone');

    const validation = new NarrativeFailureModeValidator().validate({ story });
    expect(validation.issues.filter((issue) => issue.code === 'tense_drift')).toEqual([]);
  });
});
