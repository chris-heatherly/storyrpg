import { describe, expect, it } from 'vitest';
import { buildOutcomeTextVariants, hasIdenticalSuccessFailureProse } from './outcomeVariants';

describe('buildOutcomeTextVariants', () => {
  it('returns undefined when there are no outcomeTexts', () => {
    expect(buildOutcomeTextVariants(undefined, 'base')).toBeUndefined();
  });

  it('emits both success and failure variants when both differ from the base', () => {
    const v = buildOutcomeTextVariants({ success: 'won', partial: 'meh', failure: 'lost' }, 'base')!;
    expect(v.map((x) => x.condition.flag)).toEqual(['_outcome_success', '_outcome_failure']);
    expect(v.map((x) => x.text)).toEqual(['won', 'lost']);
  });

  it('keeps BOTH when success and failure are identical to each other but differ from base', () => {
    const v = buildOutcomeTextVariants({ success: 'same', failure: 'same' }, 'base')!;
    expect(v).toHaveLength(2); // each still needed to override the base on its outcome
  });

  it('drops a variant whose prose equals the base text (runtime no-op)', () => {
    const v = buildOutcomeTextVariants({ success: 'base', failure: 'lost' }, 'base')!;
    expect(v.map((x) => x.condition.flag)).toEqual(['_outcome_failure']);
  });

  it('returns undefined when all outcomes equal the base (all no-ops)', () => {
    expect(buildOutcomeTextVariants({ success: 'base', partial: 'base', failure: 'base' }, 'base')).toBeUndefined();
  });
});

describe('hasIdenticalSuccessFailureProse', () => {
  it('flags identical success/failure', () => {
    expect(hasIdenticalSuccessFailureProse({ success: 'x', failure: 'x' })).toBe(true);
  });
  it('does not flag differing prose', () => {
    expect(hasIdenticalSuccessFailureProse({ success: 'x', failure: 'y' })).toBe(false);
  });
});
