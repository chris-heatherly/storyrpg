import { describe, it, expect } from 'vitest';
import {
  applyIdentityShifts,
  computeIdentityGrowth,
  createIdentityProfile,
  getDominantTraits,
  identityMeetsCondition,
} from './identityEngine';
import { DEFAULT_IDENTITY_PROFILE } from '../types';
import type { Consequence } from '../types';

describe('identityEngine.applyIdentityShifts', () => {
  it('shifts mercy_justice toward mercy when tint:mercy is set', () => {
    const next = applyIdentityShifts(createIdentityProfile(), [
      { type: 'setFlag', flag: 'tint:mercy', value: true },
    ]);
    expect(next.mercy_justice).toBe(-15);
  });

  it('shifts mercy_justice toward justice when tint:justice is set', () => {
    const next = applyIdentityShifts(createIdentityProfile(), [
      { type: 'setFlag', flag: 'tint:justice', value: true },
    ]);
    expect(next.mercy_justice).toBe(15);
  });

  it('ignores setFlag consequences whose value is false', () => {
    const next = applyIdentityShifts(createIdentityProfile(), [
      { type: 'setFlag', flag: 'tint:mercy', value: false },
    ]);
    expect(next).toEqual(DEFAULT_IDENTITY_PROFILE);
  });

  it('applies compound tints (compassion hits mercy_justice and heart_head)', () => {
    const next = applyIdentityShifts(createIdentityProfile(), [
      { type: 'setFlag', flag: 'tint:compassion', value: true },
    ]);
    expect(next.mercy_justice).toBe(-10);
    expect(next.heart_head).toBe(-10);
  });

  it('clamps accumulated shifts to the [-100, 100] window', () => {
    const consequences: Consequence[] = Array.from({ length: 10 }, () => ({
      type: 'setFlag',
      flag: 'tint:justice',
      value: true,
    }));
    const next = applyIdentityShifts(createIdentityProfile(), consequences);
    expect(next.mercy_justice).toBe(100);
  });

  it('infers smaller identity shifts from addTag keywords', () => {
    const next = applyIdentityShifts(createIdentityProfile(), [
      { type: 'addTag', tag: 'bold adventurer' },
    ]);
    expect(next.cautious_bold).toBe(5);
  });

  it('ignores unknown tint flags', () => {
    const next = applyIdentityShifts(createIdentityProfile(), [
      { type: 'setFlag', flag: 'tint:definitely-not-a-known-tint', value: true },
    ]);
    expect(next).toEqual(DEFAULT_IDENTITY_PROFILE);
  });
});

describe('identityEngine.getDominantTraits', () => {
  it('returns an empty list for a neutral profile', () => {
    expect(getDominantTraits(createIdentityProfile())).toEqual([]);
  });

  it('reports dominant traits only once the threshold is exceeded', () => {
    const traits = getDominantTraits({
      ...DEFAULT_IDENTITY_PROFILE,
      mercy_justice: -30,
      cautious_bold: 40,
      honest_deceptive: -25,
    });
    expect(traits).toEqual(expect.arrayContaining(['merciful', 'bold', 'forthright']));
    expect(traits).toHaveLength(3);
  });

  it('does not report traits exactly at the neutral line', () => {
    const traits = getDominantTraits({ ...DEFAULT_IDENTITY_PROFILE, mercy_justice: 24 });
    expect(traits).toEqual([]);
  });
});

describe('identityEngine.identityMeetsCondition', () => {
  const profile = { ...DEFAULT_IDENTITY_PROFILE, mercy_justice: -30 };

  it('honors < comparisons', () => {
    expect(identityMeetsCondition(profile, 'mercy_justice', '<', -20)).toBe(true);
    expect(identityMeetsCondition(profile, 'mercy_justice', '<', -40)).toBe(false);
  });

  it('honors >=, ==, and != comparisons', () => {
    expect(identityMeetsCondition(profile, 'mercy_justice', '>=', -30)).toBe(true);
    expect(identityMeetsCondition(profile, 'mercy_justice', '==', -30)).toBe(true);
    expect(identityMeetsCondition(profile, 'mercy_justice', '!=', 0)).toBe(true);
  });
});

describe('identityEngine.computeIdentityGrowth', () => {
  it('returns no growth when no dimension moved at least 10 points', () => {
    const current = { ...DEFAULT_IDENTITY_PROFILE, cautious_bold: 5 };
    expect(computeIdentityGrowth(current, DEFAULT_IDENTITY_PROFILE)).toEqual({});
  });

  it('awards +1 to the positive attribute when a dimension moves up by >= 10', () => {
    const current = { ...DEFAULT_IDENTITY_PROFILE, cautious_bold: 15 };
    expect(computeIdentityGrowth(current, DEFAULT_IDENTITY_PROFILE)).toEqual({ courage: 1 });
  });

  it('awards +1 to the negative attribute when a dimension moves down by >= 10', () => {
    const current = { ...DEFAULT_IDENTITY_PROFILE, cautious_bold: -15 };
    expect(computeIdentityGrowth(current, DEFAULT_IDENTITY_PROFILE)).toEqual({ wit: 1 });
  });

  it('caps each dimension contribution at +3', () => {
    const current = { ...DEFAULT_IDENTITY_PROFILE, cautious_bold: 99 };
    expect(computeIdentityGrowth(current, DEFAULT_IDENTITY_PROFILE)).toEqual({ courage: 3 });
  });

  it('aggregates growth across multiple dimensions', () => {
    // cautious_bold +20 → courage +2; idealism_pragmatism +20 → resourcefulness +2.
    const current = {
      ...DEFAULT_IDENTITY_PROFILE,
      cautious_bold: 20,
      idealism_pragmatism: 20,
    };
    const growth = computeIdentityGrowth(current, DEFAULT_IDENTITY_PROFILE);
    expect(growth.courage).toBe(2);
    expect(growth.resourcefulness).toBe(2);
  });

  it('stacks contributions when multiple dimensions map to the same attribute', () => {
    // cautious_bold +20 → courage +2; honest_deceptive -20 → courage +2 (negative mapping).
    const current = {
      ...DEFAULT_IDENTITY_PROFILE,
      cautious_bold: 20,
      honest_deceptive: -20,
    };
    const growth = computeIdentityGrowth(current, DEFAULT_IDENTITY_PROFILE);
    expect(growth.courage).toBe(4);
  });
});
