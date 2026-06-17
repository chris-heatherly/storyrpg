import { describe, it, expect } from 'vitest';
import { normalizeOnShowFlagConsequences } from './consequenceNormalization';

describe('normalizeOnShowFlagConsequences', () => {
  it('rewrites an onShow condition-form flag set to the canonical setFlag', () => {
    const onShow = [
      { type: 'relationship', character: 'Mika', dimension: 'affection', modification: 2 },
      { type: 'flag', flag: 'kylie_is_hopeful', value: true },
    ];
    const out = normalizeOnShowFlagConsequences(onShow) as Array<Record<string, unknown>>;
    expect(out[0].type).toBe('relationship'); // untouched
    expect(out[1]).toEqual({ type: 'setFlag', flag: 'kylie_is_hopeful', value: true });
  });

  it('returns the same reference when there is nothing to fix', () => {
    const onShow = [{ type: 'setFlag', flag: 'x', value: true }];
    expect(normalizeOnShowFlagConsequences(onShow)).toBe(onShow);
  });

  it('passes through non-arrays and undefined unchanged', () => {
    expect(normalizeOnShowFlagConsequences(undefined)).toBeUndefined();
    expect(normalizeOnShowFlagConsequences(null)).toBeNull();
  });
});
