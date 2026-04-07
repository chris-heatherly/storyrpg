import { describe, it, expect } from 'vitest';
import { BlueprintGrowthCritic } from './BlueprintGrowthCritic';
import { GrowthNarrativeCritic, type GrowthNarrativeCriticInput } from './GrowthNarrativeCritic';

const config = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

// -----------------------------------------------------------------------
// BlueprintGrowthCritic.parseJsonResponse
// -----------------------------------------------------------------------

describe('BlueprintGrowthCritic.parseJsonResponse', () => {
  const critic = new BlueprintGrowthCritic(config);
  const parse = (raw: string) => (critic as any).parseJsonResponse(raw);

  it('extracts valid JSON from clean string', () => {
    const result = parse('{"passed": true, "issues": [], "summary": "All good"}');
    expect(result).toEqual({ passed: true, issues: [], summary: 'All good' });
  });

  it('extracts JSON surrounded by markdown fences and text', () => {
    const raw = `Here is my analysis:\n\`\`\`json\n{"passed": false, "issues": [{"severity": "warning", "scene": "s1", "message": "Missing growth", "suggestion": "Add training"}], "summary": "Needs work"}\n\`\`\`\nDone.`;
    const result = parse(raw);
    expect(result).not.toBeNull();
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].scene).toBe('s1');
  });

  it('returns null for malformed JSON', () => {
    const result = parse('{bad json here}');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parse('');
    expect(result).toBeNull();
  });

  it('returns null for string without braces', () => {
    const result = parse('No JSON content here at all');
    expect(result).toBeNull();
  });
});

// -----------------------------------------------------------------------
// GrowthNarrativeCritic — early exit
// -----------------------------------------------------------------------

describe('GrowthNarrativeCritic.execute', () => {
  const critic = new GrowthNarrativeCritic(config);

  it('returns passed:true with no issues when scenes is empty', async () => {
    const input: GrowthNarrativeCriticInput = { scenes: [] };
    const result = await critic.execute(input);
    expect(result.success).toBe(true);
    expect(result.data.passed).toBe(true);
    expect(result.data.issues).toHaveLength(0);
    expect(result.data.summary).toContain('No growth scenes');
  });
});

// -----------------------------------------------------------------------
// GrowthNarrativeCritic.parseJsonResponse (same pattern, verify independently)
// -----------------------------------------------------------------------

describe('GrowthNarrativeCritic.parseJsonResponse', () => {
  const critic = new GrowthNarrativeCritic(config);
  const parse = (raw: string) => (critic as any).parseJsonResponse(raw);

  it('extracts valid JSON', () => {
    const result = parse('{"passed": true, "issues": [], "summary": "Great"}');
    expect(result).toEqual({ passed: true, issues: [], summary: 'Great' });
  });

  it('returns null for garbage input', () => {
    expect(parse('not json {{')).toBeNull();
  });
});
