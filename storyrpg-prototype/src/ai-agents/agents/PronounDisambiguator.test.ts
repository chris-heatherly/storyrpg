import { describe, expect, it } from 'vitest';
import { normalizeDisambiguation } from './PronounDisambiguator';

const inputs = [
  'Kylie watches Victor lift his glass.',
  'She tells him the truth.',
];

describe('normalizeDisambiguation', () => {
  it('keeps only rewrites whose original is an input sentence and is actually changed', () => {
    const out = normalizeDisambiguation(
      {
        rewrites: [
          { original: 'Kylie watches Victor lift his glass.', rewritten: 'Kylie watches Victor lift his own glass.' },
          { original: 'She tells him the truth.', rewritten: 'She tells him the truth.' }, // no-op → dropped
          { original: 'A sentence we never sent.', rewritten: 'hallucinated' }, // not an input → dropped
        ],
      },
      inputs,
    );
    expect(out.rewrites).toHaveLength(1);
    expect(out.rewrites[0].rewritten).toBe('Kylie watches Victor lift his own glass.');
  });

  it('trims and dedupes by original (first rewrite wins)', () => {
    const out = normalizeDisambiguation(
      {
        rewrites: [
          { original: '  Kylie watches Victor lift his glass.  ', rewritten: 'first' },
          { original: 'Kylie watches Victor lift his glass.', rewritten: 'second' },
        ],
      },
      inputs,
    );
    expect(out.rewrites).toEqual([{ original: 'Kylie watches Victor lift his glass.', rewritten: 'first' }]);
  });

  it('is robust to missing/garbage input', () => {
    expect(normalizeDisambiguation(undefined, inputs).rewrites).toEqual([]);
    expect(normalizeDisambiguation({ rewrites: [{ original: 1 as never, rewritten: 'x' }] }, inputs).rewrites).toEqual([]);
  });
});
