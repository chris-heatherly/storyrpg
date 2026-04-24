import { describe, expect, it } from 'vitest';
import { buildBeatImagePrompt } from './beatPromptBuilder';

describe('buildBeatImagePrompt', () => {
  it('defaults beat prompts to one full-screen continuous image', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-1',
        beatText: 'Mara steps between the guard and the broken gate.',
        beatIndex: 0,
        totalBeats: 2,
        visualMoment: 'Mara steps between the guard and the broken gate.',
        primaryAction: 'steps forward with one hand raised',
        emotionalRead: 'Mara is afraid but resolved',
        relationshipDynamic: 'Mara protects the protagonist by taking the nearer danger',
        mustShowDetail: 'the broken gate behind them',
        foregroundCharacterNames: ['Mara'],
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Gate',
        genre: 'fantasy',
        tone: 'urgent',
        artStyle: 'inked watercolor',
      },
    );

    expect(prompt.prompt).toContain('One full-screen continuous image');
    expect(prompt.prompt).toContain('single camera');
    expect(prompt.negativePrompt).toContain('comic panels');
    expect(prompt.negativePrompt).toContain('split-screen');
    expect(prompt.negativePrompt).toContain('multi-panel');
  });

  it('applies the same single-image guard to establishing shots', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-1',
        beatText: 'Rain hammers the empty courtyard.',
        beatIndex: 0,
        totalBeats: 1,
        shotType: 'establishing',
        visualMoment: 'Rain hammers the empty courtyard.',
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Courtyard',
        genre: 'mystery',
        tone: 'somber',
        artStyle: 'noir wash',
      },
    );

    expect(prompt.prompt).toContain('One full-screen continuous image');
    expect(prompt.negativePrompt).toContain('storyboard cells');
  });
});
