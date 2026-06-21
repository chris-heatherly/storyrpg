import { describe, expect, it } from 'vitest';
import { buildStakesReportJsonSchema, buildVoiceReportJsonSchema } from './qaReportSchemas';

describe('qaReportSchemas', () => {
  it('defines deterministic voice and stakes QA shapes for structured LLM calls', () => {
    const voice = buildVoiceReportJsonSchema();
    const stakes = buildStakesReportJsonSchema();

    expect(voice.name).toBe('voice_report');
    expect(voice.maxOutputTokens).toBe(2048);
    expect((voice.schema as any).required).toContain('overallScore');
    expect((voice.schema as any).additionalProperties).toBe(false);
    expect((voice.schema as any).properties.issues.items.required).toContain('suggestion');

    expect(stakes.name).toBe('stakes_report');
    expect(stakes.maxOutputTokens).toBe(2048);
    expect((stakes.schema as any).required).toContain('metrics');
    expect((stakes.schema as any).additionalProperties).toBe(false);
    expect((stakes.schema as any).properties.choiceSetAnalysis.items.required).toContain('stakesScore');
  });
});
