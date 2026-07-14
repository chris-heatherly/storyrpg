import { describe, expect, it } from 'vitest';

import { buildSingleEpisodeBreakdownJsonSchema } from './sourceAnalysisSchema';

describe('sourceAnalysisSchema', () => {
  it('binds a focused episode outline to complete structured output', () => {
    const schema = buildSingleEpisodeBreakdownJsonSchema();
    const root = schema.schema as any;

    expect(schema.maxOutputTokens).toBe(8192);
    expect(root.required).toEqual(expect.arrayContaining([
      'episodeNumber',
      'title',
      'synopsis',
      'narrativeArc',
      'storyCircleRole',
    ]));
    expect(root.properties.narrativeArc.required).toEqual(['setup', 'conflict', 'resolution']);
  });
});
