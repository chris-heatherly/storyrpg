import { describe, expect, it } from 'vitest';
import { DEFAULT_GENERATION_SETTINGS, normalizeGenerationSettings } from './generatorRuntimeSettings';

describe('normalizeGenerationSettings Story Council migration', () => {
  it('migrates the old Quality Council toggle and routing mode', () => {
    const settings = normalizeGenerationSettings({
      qualityCouncilEnabled: true,
      qualityCouncilMode: 'repair-routing',
      qualityCouncilRunRoutePlaytest: false,
      qualityCouncilMaxCalls: 11,
    });

    expect(settings.storyCouncilEnabled).toBe(true);
    expect(settings.storyCouncilMode).toBe('select-and-repair');
    expect(settings.storyCouncilRunRoutePlaytest).toBe(false);
    expect(settings.storyCouncilMaxCalls).toBe(11);
    expect(settings).not.toHaveProperty('qualityCouncilEnabled');
    expect(settings).not.toHaveProperty('qualityCouncilMode');
  });

  it('preserves canonical Story Council settings', () => {
    const settings = normalizeGenerationSettings({
      ...DEFAULT_GENERATION_SETTINGS,
      storyCouncilEnabled: true,
      storyCouncilMode: 'select',
      storyCouncilCandidateCount: 4,
      storyCouncilSynthesisPolicy: 'never',
    });

    expect(settings.storyCouncilMode).toBe('select');
    expect(settings.storyCouncilCandidateCount).toBe(4);
    expect(settings.storyCouncilSynthesisPolicy).toBe('never');
  });
});
