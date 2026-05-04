import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_QA_CONFIG, resolveImageQaConfig } from './imageQaConfig';

describe('image QA config', () => {
  it('defaults story-beat prompts to the restored LLM path with full QA', () => {
    expect(DEFAULT_IMAGE_QA_CONFIG).toMatchObject({
      promptMode: 'llm',
      qaMode: 'full',
      compareCanonical: 'llm',
    });
    expect(resolveImageQaConfig({})).toMatchObject({
      promptMode: 'llm',
      qaMode: 'full',
      compareCanonical: 'llm',
    });
  });

  it('keeps deterministic and compare overrides explicit', () => {
    expect(resolveImageQaConfig({
      EXPO_PUBLIC_IMAGE_PROMPT_MODE: 'deterministic',
      EXPO_PUBLIC_IMAGE_QA_MODE: 'fast',
      EXPO_PUBLIC_IMAGE_PROMPT_COMPARE_CANONICAL: 'deterministic',
      EXPO_PUBLIC_IMAGE_COMPARE_MAX_BEATS: '3',
    })).toEqual({
      promptMode: 'deterministic',
      qaMode: 'fast',
      compareCanonical: 'deterministic',
      compareMaxBeats: 3,
    });
  });
});
