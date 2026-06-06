/**
 * Unit tests for the expected-skill curve (Plan Part 5 §Competence loop step 5;
 * Part 11 #7). The curve estimates a min/expected/max BAND per skill per spine
 * position — never the flat median player — for the no-dead-wall check and the
 * difficulty curve.
 *
 * Covered: baseline-only (no growth) → all bands equal; mandatory growth lifts
 * all three bands; optional growth lifts max fully, expected by engagement, min
 * not at all; band reflects only growth at/before the queried position;
 * determinism (independent of input ordering).
 */

import { describe, expect, it } from 'vitest';
import {
  buildExpectedSkillCurve,
  DEFAULT_OPTIONAL_ENGAGEMENT,
} from './expectedSkillCurve';

describe('buildExpectedSkillCurve', () => {
  it('baseline only: all three bands equal the baseline at every position', () => {
    const curve = buildExpectedSkillCurve({
      baselines: [{ skill: 'infiltration', level: 2 }],
      growth: [],
    });
    expect(curve.bandAt('infiltration', 1)).toEqual({ min: 2, expected: 2, max: 2 });
    expect(curve.bandAt('infiltration', 9)).toEqual({ min: 2, expected: 2, max: 2 });
    // Unknown skill defaults to a 0 baseline.
    expect(curve.bandAt('unknown', 3)).toEqual({ min: 0, expected: 0, max: 0 });
  });

  it('mandatory growth lifts min, expected, and max equally', () => {
    const curve = buildExpectedSkillCurve({
      baselines: [{ skill: 'infiltration', level: 1 }],
      growth: [{ skill: 'infiltration', position: 4, delta: 2 }],
    });
    // Before the growth lands: baseline.
    expect(curve.bandAt('infiltration', 3)).toEqual({ min: 1, expected: 1, max: 1 });
    // At/after: all bands +2.
    expect(curve.bandAt('infiltration', 4)).toEqual({ min: 3, expected: 3, max: 3 });
    expect(curve.bandAt('infiltration', 6)).toEqual({ min: 3, expected: 3, max: 3 });
  });

  it('optional growth lifts max fully, expected by engagement, min not at all', () => {
    const curve = buildExpectedSkillCurve({
      baselines: [{ skill: 'infiltration', level: 1 }],
      growth: [
        { skill: 'infiltration', position: 4, delta: 2, optional: true },
      ],
    });
    const band = curve.bandAt('infiltration', 4);
    expect(band.min).toBe(1); // skipper stays at baseline
    expect(band.max).toBe(3); // completionist gains the full +2
    expect(band.expected).toBeCloseTo(1 + 2 * DEFAULT_OPTIONAL_ENGAGEMENT); // 2.0
  });

  it('respects a per-step engagement override for optional growth', () => {
    const curve = buildExpectedSkillCurve({
      baselines: [{ skill: 'infiltration', level: 0 }],
      growth: [{ skill: 'infiltration', position: 2, delta: 4, optional: true, engagement: 0.25 }],
    });
    const band = curve.bandAt('infiltration', 2);
    expect(band.min).toBe(0);
    expect(band.expected).toBeCloseTo(1); // 4 * 0.25
    expect(band.max).toBe(4);
  });

  it('accumulates multiple steps in spine order and is order-independent', () => {
    const a = buildExpectedSkillCurve({
      baselines: [{ skill: 's', level: 0 }],
      growth: [
        { skill: 's', position: 3, delta: 1 },
        { skill: 's', position: 6, delta: 2, optional: true },
        { skill: 's', position: 1, delta: 1 },
      ],
    });
    const b = buildExpectedSkillCurve({
      baselines: [{ skill: 's', level: 0 }],
      growth: [
        { skill: 's', position: 6, delta: 2, optional: true },
        { skill: 's', position: 1, delta: 1 },
        { skill: 's', position: 3, delta: 1 },
      ],
    });
    // Same band regardless of input order (deterministic).
    for (const pos of [1, 3, 6, 9]) {
      expect(a.bandAt('s', pos)).toEqual(b.bandAt('s', pos));
    }
    // At pos 6: mandatory +1 (@1) +1 (@3) = +2 in all bands, optional +2 max / +1 expected.
    expect(a.bandAt('s', 6)).toEqual({ min: 2, expected: 3, max: 4 });
  });
});
