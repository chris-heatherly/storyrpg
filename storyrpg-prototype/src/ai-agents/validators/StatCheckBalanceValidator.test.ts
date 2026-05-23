import { describe, expect, it } from 'vitest';
import { StatCheckBalanceValidator } from './StatCheckBalanceValidator';

describe('StatCheckBalanceValidator', () => {
  it('flags malformed weights and unsupported extreme checks', () => {
    const validator = new StatCheckBalanceValidator();
    const result = validator.validate({
      choices: [
        {
          id: 'bad-check',
          text: 'Try it',
          statCheck: { skillWeights: { persuasion: 0.8, perception: 0.8 }, difficulty: 75 },
        } as any,
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('skillWeights');
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('Extreme stat check');
  });

  it('accepts supported hard checks with prepared advantage and failure residue', () => {
    const validator = new StatCheckBalanceValidator();
    const result = validator.validate({
      choices: [
        {
          id: 'supported-hard-check',
          text: 'Lean on the promise',
          statCheck: {
            skillWeights: { persuasion: 1 },
            difficulty: 72,
            modifiers: [
              {
                id: 'kept-promise',
                condition: { type: 'flag', flag: 'kept_promise', value: true },
                delta: 15,
                reason: 'Promise creates leverage.',
                hint: 'The promise still gives you a way in.',
              },
            ],
          },
          failureResidue: { kind: 'damaged_trust', description: 'The promise becomes harder to use again.' },
        } as any,
      ],
    });

    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });
});
