/**
 * Unit tests for the configurable `strict` flag on treatment extraction
 * (Phase 0 / Step 0.2). Default OFF: structural integrity issues surface as
 * warnings. Strict ON: non-contiguous numbering and heading-count > parsed-count
 * throw a TreatmentValidationError. Behavior with strict off is unchanged.
 */

import { describe, expect, it } from 'vitest';
import { TreatmentValidationError, validateExtractedTreatment } from './treatmentExtraction';
import type { ExtractedTreatment } from './treatmentExtraction';

/** A markdown body with two episode headings but only one parsed episode. */
const HEADINGS_OUTNUMBER_PARSED = `## Episode Outline
### Episode 1: One
### Episode 2: Two
`;

function parsedWith(episodeNumbers: number[]): Pick<
  ExtractedTreatment,
  'episodes' | 'branches' | 'endings' | 'seasonGuidance'
> {
  const episodes: ExtractedTreatment['episodes'] = {};
  for (const n of episodeNumbers) {
    episodes[n] = {
      authoredTitle: `Episode ${n}`,
      episodePromise: 'p',
      cliffhangerQuestion: 'q',
    } as ExtractedTreatment['episodes'][number];
  }
  return { episodes, branches: [], endings: [], seasonGuidance: undefined };
}

describe('validateExtractedTreatment strict flag', () => {
  it('default (strict off) returns a warning for non-contiguous numbering', () => {
    const warnings = validateExtractedTreatment('', parsedWith([1, 3]));
    expect(warnings.some((w) => /not contiguous/i.test(w))).toBe(true);
  });

  it('strict on throws on non-contiguous numbering', () => {
    expect(() => validateExtractedTreatment('', parsedWith([1, 3]), undefined, true)).toThrow(
      TreatmentValidationError,
    );
  });

  it('strict on throws when headings outnumber parsed episodes', () => {
    expect(() =>
      validateExtractedTreatment(
        HEADINGS_OUTNUMBER_PARSED,
        parsedWith([1]),
        { episodeSection: HEADINGS_OUTNUMBER_PARSED },
        true,
      ),
    ).toThrow(/episode heading/i);
  });

  it('strict on does NOT throw for a clean contiguous treatment', () => {
    expect(() => validateExtractedTreatment('', parsedWith([1, 2, 3]), undefined, true)).not.toThrow();
  });
});
