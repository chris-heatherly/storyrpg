import { describe, expect, it } from 'vitest';
import { KNOWN_TINT_FLAGS } from '../../engine/identityEngine';
import { normalizeTintFlag, isKnownTint, canonicalTintVocabulary } from './tintVocabulary';
import { foldTintFlagIntoConsequences, normalizeConsequence } from '../pipeline/choiceAssembly';
import type { Consequence } from '../../types';

describe('tintVocabulary (G12: authored tints matched 0/28 engine keys)', () => {
  it('canonical keys pass through unchanged', () => {
    for (const flag of KNOWN_TINT_FLAGS) {
      expect(normalizeTintFlag(flag)).toBe(flag);
      expect(isKnownTint(flag)).toBe(true);
    }
  });

  it('normalizes the exact adjective forms G12 shipped', () => {
    expect(normalizeTintFlag('tint:bold')).toBe('tint:boldness');
    expect(normalizeTintFlag('tint:pragmatic')).toBe('tint:pragmatism');
    expect(normalizeTintFlag('tint:honest')).toBe('tint:honesty');
  });

  it('normalizes the old ChoiceAuthor fallback set and prompt examples', () => {
    for (const legacy of ['tint:personal', 'tint:connected', 'tint:conflicted', 'tint:decisive', 'tint:reckless', 'tint:cunning', 'tint:defiant']) {
      expect(isKnownTint(legacy)).toBe(true);
    }
  });

  it('coerces loose tint prefixes into cosmetic tint namespace', () => {
    expect(normalizeTintFlag('tint_honest')).toBe('tint:honesty');
    expect(normalizeTintFlag('tint-mika-favored')).toBe('tint:mika-favored');
  });

  it('leaves unmapped tints unchanged but reports them unknown', () => {
    expect(normalizeTintFlag('tint:wistful-about-trains')).toBe('tint:wistful-about-trains');
    expect(isKnownTint('tint:wistful-about-trains')).toBe(false);
  });

  it('does not touch non-tint flags', () => {
    expect(normalizeTintFlag('kylie_drank_the_dark_wine')).toBe('kylie_drank_the_dark_wine');
  });

  it('vocabulary export matches the engine map', () => {
    expect(canonicalTintVocabulary()).toEqual(KNOWN_TINT_FLAGS);
  });
});

describe('assembly seam normalization', () => {
  it('foldTintFlagIntoConsequences emits the canonical flag and dedupes against it', () => {
    const folded = foldTintFlagIntoConsequences([], 'tint:bold')!;
    expect(folded).toEqual([{ type: 'setFlag', flag: 'tint:boldness', value: true }]);
    // Already-canonical consequence present → no duplicate even when tintFlag is the alias.
    const again = foldTintFlagIntoConsequences(folded, 'tint:bold')!;
    expect(again).toHaveLength(1);
  });

  it('normalizeConsequence canonicalizes authored tint setFlags', () => {
    const c = normalizeConsequence({ type: 'setFlag', flag: 'tint:honest', value: true } as Consequence);
    expect((c as { flag?: string }).flag).toBe('tint:honesty');
    const untouched = normalizeConsequence({ type: 'setFlag', flag: 'met_charcoal_suit_man', value: true } as Consequence);
    expect((untouched as { flag?: string }).flag).toBe('met_charcoal_suit_man');
  });
});
