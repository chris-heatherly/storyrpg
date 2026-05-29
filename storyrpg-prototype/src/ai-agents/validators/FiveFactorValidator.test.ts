import { describe, expect, it } from 'vitest';
import { FiveFactorValidator } from './FiveFactorValidator';
import type { AgentConfig } from '../config';
import type { FiveFactorInput } from '../../types/validation';

// Empty apiKey keeps validate() on the pure heuristic path (no LLM fetch).
const agentConfig: AgentConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: '',
  maxTokens: 1024,
  temperature: 0.3,
};

function makeInput(overrides: Partial<FiveFactorInput> = {}): FiveFactorInput {
  return {
    choiceId: 'choice-1',
    choiceType: 'dilemma',
    choiceText: 'Confront the captain.',
    consequences: [],
    context: 'Tense standoff on the bridge.',
    ...overrides,
  };
}

describe('FiveFactorValidator', () => {
  it('passes a dilemma whose consequences touch multiple factors with no issues', () => {
    const validator = new FiveFactorValidator(agentConfig);

    return validator
      .validate(
        makeInput({
          choiceId: 'tell-truth',
          choiceText: 'Tell Mira the truth and steady your aim.',
          consequences: [
            { type: 'relationship', npcId: 'mira', dimension: 'trust', change: 2 },
            { type: 'attribute', attribute: 'resolve', change: 1 },
          ],
        })
      )
      .then((result) => {
        expect(result.passed).toBe(true);
        // relationship -> relationship; attribute -> process + identity = 3 factors
        expect(result.factorCount).toBe(3);
        expect(result.impact.relationship).toBe(true);
        expect(result.impact.process).toBe(true);
        expect(result.impact.identity).toBe(true);
        // Multiple factors: no richness suggestion, no errors.
        expect(result.issues).toEqual([]);
      });
  });

  it('emits a richness suggestion (not an error) when only one factor is affected', async () => {
    const validator = new FiveFactorValidator(agentConfig);

    const result = await validator.validate(
      makeInput({
        choiceId: 'grab-key',
        choiceText: 'Pocket the brass key.',
        consequences: [{ type: 'addItem', itemId: 'brass-key', name: 'Brass Key', description: 'Opens the vault.' }],
      })
    );

    expect(result.passed).toBe(true);
    expect(result.factorCount).toBe(1);
    expect(result.impact.outcome).toBe(true);

    const errors = result.issues.filter((i) => i.level === 'error');
    expect(errors).toEqual([]);

    const suggestion = result.issues.find((i) => i.level === 'suggestion');
    expect(suggestion).toBeDefined();
    expect(suggestion?.message).toContain('OUTCOME');
    expect(suggestion?.category).toBe('five_factor');
  });

  it('blocks a dilemma choice that affects zero factors with an error-level issue', async () => {
    const validator = new FiveFactorValidator(agentConfig);

    const result = await validator.validate(
      makeInput({
        choiceId: 'shrug',
        choiceType: 'dilemma',
        choiceText: 'Shrug and say nothing.',
        consequences: [],
      })
    );

    expect(result.passed).toBe(false);
    expect(result.factorCount).toBe(0);

    const error = result.issues.find((i) => i.level === 'error');
    expect(error).toBeDefined();
    expect(error?.category).toBe('five_factor');
    expect(error?.message).toContain('no meaningful impact');
    expect(error?.location.choiceId).toBe('shrug');
  });

  it('exempts expression choices from the five-factor requirement', async () => {
    const validator = new FiveFactorValidator(agentConfig);

    const result = await validator.validate(
      makeInput({
        choiceId: 'wave',
        choiceType: 'expression',
        choiceText: 'Wave politely.',
        consequences: [],
      })
    );

    expect(result.passed).toBe(true);
    expect(result.factorCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it('countFactors counts only the affected factors', () => {
    const validator = new FiveFactorValidator(agentConfig);

    expect(
      validator.countFactors({
        outcome: true,
        process: false,
        information: true,
        relationship: false,
        identity: false,
      })
    ).toBe(2);
  });
});
