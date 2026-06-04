import { describe, expect, it } from 'vitest';
import { shouldFailStakesScore } from './ChoiceAuthor';

/**
 * Bucket C soft-gate proof for ChoiceAuthor's LLM-judged stakes score.
 *
 * `shouldFailStakesScore` is the extracted pure decision at the threshold seam in
 * ChoiceAuthor.validateChoiceQuality. A `true` return is what triggers the
 * (noisy) revision/regeneration; `false` degrades to advisory (keep original
 * choices). These tests assert default behavior is unchanged and that, with the
 * GATE_JUDGE_STABILIZATION opt-in on, a borderline score no longer triggers
 * regeneration. No LLM is involved — the judge score is supplied directly.
 */
describe('shouldFailStakesScore (Bucket C judge-stabilization seam)', () => {
  const failThreshold = 60; // ChoiceAuthor.minStakesScore
  const margin = 5; // ChoiceAuthor.stakesHysteresisMargin

  describe('GATE_JUDGE_STABILIZATION unset (default-off)', () => {
    const stabilizationEnabled = false;

    it('preserves the historical hard gate: borderline scores still fail/regenerate', () => {
      // 57 is in the borderline band [55, 60) — with stabilization OFF it must
      // still be treated as a failure (unchanged behavior).
      expect(shouldFailStakesScore(57, failThreshold, margin, stabilizationEnabled)).toBe(true);
      // Just-below threshold also fails.
      expect(shouldFailStakesScore(59, failThreshold, margin, stabilizationEnabled)).toBe(true);
    });

    it('passes scores at or above the threshold', () => {
      expect(shouldFailStakesScore(60, failThreshold, margin, stabilizationEnabled)).toBe(false);
      expect(shouldFailStakesScore(72, failThreshold, margin, stabilizationEnabled)).toBe(false);
    });
  });

  describe('GATE_JUDGE_STABILIZATION on', () => {
    const stabilizationEnabled = true;

    it('does NOT trigger regeneration for a borderline score within the margin band', () => {
      // 57 in [55, 60) is treated as judge noise -> pass -> no revision.
      expect(shouldFailStakesScore(57, failThreshold, margin, stabilizationEnabled)).toBe(false);
      // Lower edge of the band (55) is not strictly below 55 -> pass.
      expect(shouldFailStakesScore(55, failThreshold, margin, stabilizationEnabled)).toBe(false);
    });

    it('still fails (regenerates) for a score clearly below the margin band', () => {
      // 54 < 60 - 5 (55) => genuine failure, revision still triggers.
      expect(shouldFailStakesScore(54, failThreshold, margin, stabilizationEnabled)).toBe(true);
      expect(shouldFailStakesScore(30, failThreshold, margin, stabilizationEnabled)).toBe(true);
    });

    it('passes scores at or above the threshold (unchanged)', () => {
      expect(shouldFailStakesScore(60, failThreshold, margin, stabilizationEnabled)).toBe(false);
      expect(shouldFailStakesScore(88, failThreshold, margin, stabilizationEnabled)).toBe(false);
    });
  });

  it('flag toggles the verdict for exactly the borderline-band scores', () => {
    // The only scores whose verdict changes between off/on are the band
    // [failThreshold - margin, failThreshold): off => fail, on => pass.
    for (const score of [55, 56, 57, 58, 59]) {
      expect(shouldFailStakesScore(score, failThreshold, margin, false)).toBe(true);
      expect(shouldFailStakesScore(score, failThreshold, margin, true)).toBe(false);
    }
    // Outside the band, the flag does not change the verdict.
    for (const score of [40, 54, 60, 75]) {
      expect(shouldFailStakesScore(score, failThreshold, margin, false)).toBe(
        shouldFailStakesScore(score, failThreshold, margin, true),
      );
    }
  });
});
