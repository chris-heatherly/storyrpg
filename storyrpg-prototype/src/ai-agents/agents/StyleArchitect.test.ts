import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StyleArchitect } from './StyleArchitect';

const BASE_CONFIG = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.4,
};

function mockLlmResponse(architect: StyleArchitect, response: string | Error) {
  const spy = vi.spyOn(architect as any, 'callLLM');
  if (response instanceof Error) {
    spy.mockRejectedValue(response);
  } else {
    spy.mockResolvedValue(response);
  }
  return spy;
}

describe('StyleArchitect.expand', () => {
  beforeEach(() => {
    StyleArchitect.clearCache();
  });

  it('returns a structured profile when the LLM emits valid JSON', async () => {
    const architect = new StyleArchitect(BASE_CONFIG);
    mockLlmResponse(
      architect,
      JSON.stringify({
        name: 'romance novel cover',
        renderingTechnique: 'soft-focus painterly illustration',
        colorPhilosophy: 'warm pastel palette',
        lightingApproach: 'golden-hour glow',
        lineWeight: 'no hard outlines, painterly edges',
        compositionStyle: 'centered romantic tableau',
        moodRange: 'tender, yearning, warm',
        positiveVocabulary: ['soft focus', 'warm pastel', 'golden glow'],
        inappropriateVocabulary: ['chiaroscuro', 'grimdark'],
        genreNegatives: ['photorealism'],
      }),
    );

    const profile = await architect.expand({ artStyle: 'romance novel cover' });
    expect(profile.name).toBe('romance novel cover');
    expect(profile.family).toBe('unknown');
    expect(profile.renderingTechnique).toBe('soft-focus painterly illustration');
    expect(profile.positiveVocabulary).toEqual(['soft focus', 'warm pastel', 'golden glow']);
    expect(profile.inappropriateVocabulary).toEqual(['chiaroscuro', 'grimdark']);
    expect(profile.genreNegatives).toEqual(['photorealism']);
  });

  it('falls back to the verbatim profile when the LLM call throws', async () => {
    const architect = new StyleArchitect(BASE_CONFIG);
    mockLlmResponse(architect, new Error('upstream timeout'));

    const profile = await architect.expand({ artStyle: 'romance novel cover' });
    expect(profile.family).toBe('unknown');
    expect(profile.name).toContain('romance novel');
    expect(profile.positiveVocabulary).not.toContain('cinematic');
    expect(profile.positiveVocabulary).not.toContain('dramatic');
  });

  it('caches the result so the second call does not re-hit the LLM', async () => {
    const architect = new StyleArchitect(BASE_CONFIG);
    const spy = mockLlmResponse(
      architect,
      JSON.stringify({
        name: 'ink zine',
        renderingTechnique: 'crude ink hatching',
        colorPhilosophy: 'two-tone spot inks',
        lightingApproach: 'graphic blacks and whites',
        lineWeight: 'scratchy variable ink',
        compositionStyle: 'zine panel layout',
        moodRange: 'punk and restless',
        positiveVocabulary: ['ink', 'zine', 'spot color'],
      }),
    );

    const first = await architect.expand({ artStyle: 'ink zine' });
    const second = await architect.expand({ artStyle: 'ink zine' });
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns a safe profile for empty strings without hitting the LLM', async () => {
    const architect = new StyleArchitect(BASE_CONFIG);
    const spy = vi.spyOn(architect as any, 'callLLM');
    const profile = await architect.expand({ artStyle: '' });
    expect(profile.family).toBe('unknown');
    expect(spy).not.toHaveBeenCalled();
  });
});
