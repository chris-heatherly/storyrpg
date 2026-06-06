import { describe, it, expect } from 'vitest';
import {
  SevenPointAnchorConformanceValidator,
  SevenPointAnchorConformanceInput,
} from './SevenPointAnchorConformanceValidator';

/**
 * Canonical ENDSONG-style anchoring (Plan §7 item 2): plotTurn1 at Ep3, pinch1 at
 * Ep4, midpoint at Ep6, pinch2 at Ep7, climax at Ep10. Hook on Ep1, resolution on
 * the finale Ep10 alongside the climax is intentionally avoided here to keep one
 * beat per episode.
 */
function honoredInput(
  overrides?: Partial<SevenPointAnchorConformanceInput>,
): SevenPointAnchorConformanceInput {
  return {
    beatEpisodeAnchors: {
      hook: 1,
      plotTurn1: 3,
      pinch1: 4,
      midpoint: 6,
      pinch2: 7,
      climax: 10,
    },
    episodes: [
      { episodeNumber: 1, structuralRole: ['hook'] },
      { episodeNumber: 2, structuralRole: ['rising'] },
      { episodeNumber: 3, structuralRole: ['plotTurn1'] },
      { episodeNumber: 4, structuralRole: ['pinch1'] },
      { episodeNumber: 5, structuralRole: ['rising'] },
      { episodeNumber: 6, structuralRole: ['midpoint'] },
      { episodeNumber: 7, structuralRole: ['pinch2'] },
      { episodeNumber: 8, structuralRole: ['rising'] },
      { episodeNumber: 9, structuralRole: ['falling'] },
      { episodeNumber: 10, structuralRole: ['climax'] },
    ],
    ...overrides,
  };
}

describe('SevenPointAnchorConformanceValidator', () => {
  it('PASSES when every authored beat→episode anchor is honored 1:1', () => {
    const validator = new SevenPointAnchorConformanceValidator();
    const result = validator.validate(honoredInput());
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it('is a clean no-op pass when there are no authored anchors (non-treatment source)', () => {
    const validator = new SevenPointAnchorConformanceValidator();
    const result = validator.validate({
      beatEpisodeAnchors: undefined,
      episodes: [{ episodeNumber: 1, structuralRole: ['hook'] }],
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('FAILS (blocking) when an anchored beat is placed on the wrong episode (re-cut)', () => {
    const validator = new SevenPointAnchorConformanceValidator();
    // plotTurn1 authored on Ep3 but the final season put it on Ep2 (the ENDSONG
    // re-cut symptom the plan describes).
    const recut = honoredInput({
      episodes: [
        { episodeNumber: 1, structuralRole: ['hook'] },
        { episodeNumber: 2, structuralRole: ['plotTurn1'] }, // wrong episode
        { episodeNumber: 3, structuralRole: ['rising'] }, // should carry plotTurn1
        { episodeNumber: 4, structuralRole: ['pinch1'] },
        { episodeNumber: 5, structuralRole: ['rising'] },
        { episodeNumber: 6, structuralRole: ['midpoint'] },
        { episodeNumber: 7, structuralRole: ['pinch2'] },
        { episodeNumber: 8, structuralRole: ['rising'] },
        { episodeNumber: 9, structuralRole: ['falling'] },
        { episodeNumber: 10, structuralRole: ['climax'] },
      ],
    });
    const result = validator.validate(recut);
    expect(result.valid).toBe(false);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('plotTurn1');
    expect(errors[0].message).toContain('Ep3');
    expect(errors[0].message).toContain('Ep2');
  });

  it('FAILS (blocking) when an anchored episode does not exist in the final season', () => {
    const validator = new SevenPointAnchorConformanceValidator();
    const result = validator.validate(
      honoredInput({
        beatEpisodeAnchors: { climax: 12 }, // no episode 12
        episodes: [
          { episodeNumber: 1, structuralRole: ['hook'] },
          { episodeNumber: 10, structuralRole: ['climax'] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.message.includes('no episode 12'))).toBe(true);
  });

  it('FAILS (blocking) when an anchored beat ALSO appears on another episode (duplicated)', () => {
    const validator = new SevenPointAnchorConformanceValidator();
    const duplicated = honoredInput({
      episodes: honoredInput().episodes.map((ep) =>
        ep.episodeNumber === 5 ? { ...ep, structuralRole: ['climax'] } : ep,
      ),
    });
    const result = validator.validate(duplicated);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.severity === 'error' && i.message.includes('climax') && i.message.includes('Ep5'),
      ),
    ).toBe(true);
  });

  it('WARNS (non-blocking) when an anchored beat is carried by no episode at all', () => {
    const validator = new SevenPointAnchorConformanceValidator();
    const missing = honoredInput({
      episodes: honoredInput().episodes.map((ep) =>
        ep.episodeNumber === 6 ? { ...ep, structuralRole: ['rising'] } : ep,
      ),
    });
    const result = validator.validate(missing);
    // midpoint dropped off every episode → warning, still valid (not blocking).
    expect(result.valid).toBe(true);
    expect(
      result.issues.some((i) => i.severity === 'warning' && i.message.includes('midpoint')),
    ).toBe(true);
  });
});
