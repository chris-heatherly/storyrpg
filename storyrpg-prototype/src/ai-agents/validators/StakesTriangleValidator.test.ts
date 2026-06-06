import { describe, expect, it } from 'vitest';
import { StakesTriangleValidator } from './StakesTriangleValidator';
import type { AgentConfig } from '../config';
import type { StakesTriangleInput } from '../../types/validation';

// Empty apiKey forces the validator down its pure, non-LLM paths
// (structural checks + basic length-based scoring) so no network call occurs.
const offlineConfig: AgentConfig = {
  provider: 'anthropic',
  model: 'test-model',
  apiKey: '',
  maxTokens: 1024,
  temperature: 0.3,
};

describe('StakesTriangleValidator', () => {
  it('passes expression choices with a perfect score and no issues', async () => {
    const input: StakesTriangleInput = {
      choiceId: 'wave',
      choiceType: 'expression',
      choiceText: 'Wave politely at the guard.',
      context: 'A quiet hallway scene.',
    };

    const result = await new StakesTriangleValidator(offlineConfig).validate(input);

    expect(result.passed).toBe(true);
    expect(result.score.overall).toBe(100);
    expect(result.issues).toEqual([]);
  });

  it('flags a dilemma choice missing all stakes with a blocking error', async () => {
    const input: StakesTriangleInput = {
      choiceId: 'betray',
      choiceType: 'dilemma',
      choiceText: 'Turn on the captain.',
      context: 'A mutiny is brewing below decks.',
    };

    const result = await new StakesTriangleValidator(offlineConfig).validate(input);

    expect(result.passed).toBe(false);
    expect(result.score.overall).toBe(0);
    expect(result.issues).toHaveLength(1);

    const issue = result.issues[0];
    expect(issue.level).toBe('error');
    expect(issue.category).toBe('stakes_triangle');
    expect(issue.message).toContain('WANT');
    expect(issue.message).toContain('COST');
    expect(issue.message).toContain('IDENTITY');
    expect(issue.location.choiceId).toBe('betray');
  });

  it('reports per-component scores for a partially-stocked dilemma', async () => {
    const input: StakesTriangleInput = {
      choiceId: 'half',
      choiceType: 'dilemma',
      choiceText: 'Hand over the map.',
      want: 'Keep the crew alive.',
      cost: 'Lose the only route home.',
      // identity intentionally omitted
      context: 'The crew is cornered.',
    };

    const result = await new StakesTriangleValidator(offlineConfig).validate(input);

    expect(result.passed).toBe(false);
    expect(result.score.want).toBe(50);
    expect(result.score.cost).toBe(50);
    expect(result.score.identity).toBe(0);
    expect(result.issues[0].message).toContain('IDENTITY');
    expect(result.issues[0].message).not.toContain('WANT');
  });

  it('passes a well-described non-dilemma choice via basic scoring', async () => {
    const input: StakesTriangleInput = {
      choiceId: 'truth',
      choiceType: 'relationship',
      choiceText: 'Tell Mira the truth about the sabotage.',
      want: 'Earn Mira\'s trust by being honest even when it hurts.',
      cost: 'Risk her turning the rest of the crew against you for good.',
      identity: 'Reveals whether you are someone who hides behind comfortable lies.',
      context: 'Mira just asked you point blank what happened in the engine room.',
    };

    const result = await new StakesTriangleValidator(offlineConfig).validate(input);

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.score.want).toBeGreaterThanOrEqual(60);
    expect(result.score.cost).toBeGreaterThanOrEqual(60);
    expect(result.score.identity).toBeGreaterThanOrEqual(60);
    expect(result.score.overall).toBeGreaterThanOrEqual(60);
  });
});

  // Fix 4: placeholder stakes sentinels must fail basic (offline) scoring so the
  // choice is regenerated, instead of passing on length alone.
  it('forces a 0 score on un-authored placeholder cost/identity sentinels', async () => {
    const input: StakesTriangleInput = {
      choiceId: 'placeholder',
      choiceType: 'strategic',
      choiceText: 'Decide how to handle the standoff.',
      context: 'A tense negotiation.',
      want: 'Advance the goal of The Standoff',
      cost: 'Each option forfeits a different advantage.',
      identity: 'The choice reveals the protagonist under pressure.',
    };

    const result = await new StakesTriangleValidator(offlineConfig).validate(input);

    expect(result.score.cost).toBe(0);
    expect(result.score.identity).toBe(0);
    expect(result.score.want).toBe(0);
    expect(result.passed).toBe(false);
  });
