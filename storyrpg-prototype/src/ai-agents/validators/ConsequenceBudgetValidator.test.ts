import { describe, it, expect } from 'vitest';
import { ConsequenceBudgetValidator } from './ConsequenceBudgetValidator';

describe('ConsequenceBudgetValidator', () => {
  describe('classifyConsequence', () => {
    const validator = new ConsequenceBudgetValidator();

    it('classifies a plain setFlag as callback', () => {
      expect(validator.classifyConsequence({ type: 'setFlag', flag: 'met_npc' })).toBe(
        'callback'
      );
    });

    // D1: honor the flag prefix so the budget reflects the pipeline's flag semantics.
    it('classifies a tint: setFlag as tint (was wrongly callback)', () => {
      expect(validator.classifyConsequence({ type: 'setFlag', flag: 'tint:warmth' })).toBe('tint');
    });

    it('classifies route_/treatment_branch_ setFlags as branch', () => {
      expect(validator.classifyConsequence({ type: 'setFlag', flag: 'route_north' })).toBe('branch');
      expect(validator.classifyConsequence({ type: 'setFlag', flag: 'treatment_branch_trust' })).toBe('branch');
    });

    it('end-to-end: a tint: consequence yields tint allocation > 0 (the metric the regen showed at 0)', () => {
      const { allocation } = validator.calculateAllocation({
        choices: [
          { id: 'c1', choiceType: 'expression', consequences: [{ type: 'setFlag', flag: 'tint:honest' }] },
          { id: 'c2', choiceType: 'strategic', consequences: [{ type: 'setFlag', flag: 'met_npc' }] },
        ],
      } as any);
      expect(allocation.tint).toBeGreaterThan(0);
      expect(allocation.callback).toBeGreaterThan(0);
    });

    it('classifies small relationship changes as callback', () => {
      expect(
        validator.classifyConsequence({ type: 'relationship', change: 5 })
      ).toBe('callback');
    });

    it('classifies mid relationship changes as tint', () => {
      expect(
        validator.classifyConsequence({ type: 'relationship', change: 20 })
      ).toBe('tint');
    });

    it('classifies large score changes as branch', () => {
      expect(
        validator.classifyConsequence({ type: 'changeScore', change: 40 })
      ).toBe('branch');
    });
  });

  describe('classifyByChoiceType', () => {
    const validator = new ConsequenceBudgetValidator();

    it('forces expression choices to callback regardless of payload', () => {
      expect(
        validator.classifyByChoiceType(
          { type: 'changeScore', change: 40 },
          'expression'
        )
      ).toBe('callback');
    });

    it('upgrades dilemma callbacks to branchlet', () => {
      expect(
        validator.classifyByChoiceType({ type: 'setFlag', flag: 'x' }, 'dilemma')
      ).toBe('branchlet');
    });

    it('upgrades branching callbacks to tint', () => {
      expect(
        validator.classifyByChoiceType(
          { type: 'setFlag', flag: 'x' },
          'branch',
          true
        )
      ).toBe('tint');
    });
  });

  describe('validate', () => {
    it('passes when there are no consequences', async () => {
      const validator = new ConsequenceBudgetValidator();
      const result = await validator.validate({
        choices: [{ id: 'c1', choiceType: 'expression', consequences: [] }],
      });
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('flags extreme over-allocation of a category', async () => {
      const validator = new ConsequenceBudgetValidator({ budgetTolerance: 10 });
      const choices = Array.from({ length: 10 }, (_, i) => ({
        id: `c${i}`,
        choiceType: 'expression',
        consequences: [{ type: 'setFlag', flag: `f${i}` }],
      }));

      const result = await validator.validate({ choices });

      expect(result.allocation.callback).toBeGreaterThan(90);
      expect(
        result.issues.some(
          (i) =>
            i.message.includes('CALLBACK') && i.message.includes('over-allocated')
        )
      ).toBe(true);
    });
  });

  describe('suggestCategory', () => {
    const validator = new ConsequenceBudgetValidator();

    it('recommends callback for expression choices', () => {
      expect(
        validator.suggestCategory('expression', 'setFlag', {
          callback: 0,
          tint: 0,
          branchlet: 0,
          branch: 0,
        })
      ).toBe('callback');
    });

    it('fills the largest deficit relative to target allocation', () => {
      // Targets are callback:60, tint:25, branchlet:10, branch:5.
      // With an over-allocated callback and empty others, tint has the
      // largest positive deficit (25 - 0) and should be chosen.
      expect(
        validator.suggestCategory('branch', 'changeScore', {
          callback: 100,
          tint: 0,
          branchlet: 0,
          branch: 0,
        })
      ).toBe('tint');
    });

    it('upgrades dilemma suggestions away from callback/tint', () => {
      expect(
        validator.suggestCategory('dilemma', 'setFlag', {
          callback: 0,
          tint: 0,
          branchlet: 0,
          branch: 0,
        })
      ).toBe('branchlet');
    });
  });
});
