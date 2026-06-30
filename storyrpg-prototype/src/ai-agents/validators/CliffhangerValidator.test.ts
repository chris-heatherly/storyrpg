import { describe, expect, it } from 'vitest';

import { CliffhangerValidator } from './CliffhangerValidator';
import type { Episode } from '../../types';
import type { CliffhangerPlan } from '../../types/seasonPlan';

const validator = new CliffhangerValidator({
  provider: 'anthropic',
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0,
});

function episodeWithFinalText(text: string): Episode {
  return {
    id: 'episode-1',
    number: 1,
    title: 'The Door in the Ashes',
    synopsis: 'A test episode.',
    coverImage: '',
    startingSceneId: 'scene-1',
    scenes: [
      {
        id: 'scene-1',
        name: 'Aftermath',
        startingBeatId: 'beat-1',
        beats: [{ id: 'beat-1', text }],
      },
    ],
  };
}

const highShockPlan: CliffhangerPlan = {
  type: 'shock',
  intensity: 'high',
  hook: 'the mentor signs the enemy name in blood on the same blue letter',
  setup: 'The blue letter and enemy name were planted earlier.',
  resolvedEpisodeTension: 'The protagonist survives the tribunal',
  newOpenQuestion: 'Why was the mentor connected to the enemy all along?',
  emotionalCharge: 'shock and betrayal',
  nextEpisodePressure: 'The next episode must investigate the mentor.',
  style: 'serialized_tv',
};

describe('CliffhangerValidator', () => {
  it('rejects soft resolved endings', () => {
    const result = validator.quickAnalyze(
      episodeWithFinalText('The tribunal was over, and everyone was finally safe. Peace at last settled over the room, and nothing else mattered.'),
      highShockPlan,
    );

    expect(['weak', 'missing']).toContain(result.quality);
    expect(result.weaknesses.some(w => w.includes('resolved'))).toBe(true);
  });

  it('accepts role-appropriate high-intensity shock hooks', () => {
    const result = validator.quickAnalyze(
      episodeWithFinalText('The protagonist survived the tribunal, but the victory curdled when the same blue letter slid from the mentor\'s sleeve. In wet blood, the mentor had signed the enemy name, and every promise from dawn meant something else.'),
      highShockPlan,
    );

    expect(['good', 'excellent']).toContain(result.quality);
    expect(result.strengths.some(s => s.includes('planned hook'))).toBe(true);
  });

  it('analyzes the authored final beat instead of terminal choice bridges', () => {
    const episode = episodeWithFinalText('The protagonist survived the tribunal, but the victory curdled when the same blue letter slid from the mentor\'s sleeve. In wet blood, the mentor had signed the enemy name, and every promise from dawn meant something else.');
    episode.scenes[0].beats.push({
      id: 'bridge-decline',
      text: 'You step away and carry the decision into tomorrow.',
      isChoiceBridge: true,
      sourceChoiceId: 'decline',
      nextSceneId: 'episode-end',
    } as never);

    const result = validator.quickAnalyze(episode, highShockPlan);

    expect(['good', 'excellent']).toContain(result.quality);
    expect(result.finalBeatText).toContain('blue letter');
  });
});
