import { describe, expect, it } from 'vitest';
import { normalizeOutcomeVariants } from './OutcomeVariantAuthor';

describe('normalizeOutcomeVariants', () => {
  const requested = ['victory', 'partialVictory', 'defeat'];

  it('keeps only requested outcomes with non-empty text', () => {
    const out = normalizeOutcomeVariants(
      {
        variants: [
          { outcome: 'victory', text: 'She stands easy.' },
          { outcome: 'partialVictory', text: '   ' },            // empty → dropped
          { outcome: 'escape', text: 'never requested' },        // not requested → dropped
        ],
      },
      requested,
    );
    expect(out.variants).toEqual([{ outcome: 'victory', text: 'She stands easy.' }]);
  });

  it('dedupes by outcome (first wins) and trims text', () => {
    const out = normalizeOutcomeVariants(
      {
        variants: [
          { outcome: 'defeat', text: '  first  ' },
          { outcome: 'defeat', text: 'second' },
        ],
      },
      requested,
    );
    expect(out.variants).toEqual([{ outcome: 'defeat', text: 'first' }]);
  });

  it('is robust to missing/garbage input', () => {
    expect(normalizeOutcomeVariants(undefined, requested).variants).toEqual([]);
    expect(normalizeOutcomeVariants({ variants: [{ outcome: 1 as never, text: 'x' }] }, requested).variants).toEqual([]);
  });
});
