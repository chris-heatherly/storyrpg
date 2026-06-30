import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_QA_CONFIG, resolveImageQaConfig } from './imageQaConfig';

describe('image QA config', () => {
  it('defaults story-beat prompts to the restored LLM path with full QA', () => {
    expect(DEFAULT_IMAGE_QA_CONFIG).toMatchObject({
      promptMode: 'llm',
      qaMode: 'full',
    });
    expect(resolveImageQaConfig({})).toMatchObject({
      promptMode: 'llm',
      qaMode: 'full',
    });
  });

  it('keeps deterministic overrides explicit', () => {
    expect(resolveImageQaConfig({
      EXPO_PUBLIC_IMAGE_PROMPT_MODE: 'deterministic',
      EXPO_PUBLIC_IMAGE_QA_MODE: 'fast',
    })).toEqual({
      promptMode: 'deterministic',
      qaMode: 'fast',
    });
  });

  it('normalizes retired compare prompt mode to llm', () => {
    expect(resolveImageQaConfig({
      EXPO_PUBLIC_IMAGE_PROMPT_MODE: 'compare',
      EXPO_PUBLIC_IMAGE_QA_MODE: 'fast',
    })).toEqual({
      promptMode: 'llm',
      qaMode: 'fast',
    });
  });
});
