/**
 * Unit tests for the CompetenceReachabilityValidator (Plan Part 9 no-dead-wall
 * guard; Part 5 §Competence loop, Part 11 #7).
 *
 * Covered:
 *  - a wall unreachable before its required payoff ERRORS (dead wall);
 *  - adding a growth path (+ a return) makes a winnable-later wall legal;
 *  - winnable-now (expected already ≥ gate) is fine;
 *  - dangling-growth detection (a gain that gates no wall);
 *  - fail-forward-gap detection (a failure arm that leads nowhere);
 *  - anchorless roadblock errors;
 *  - flag-OFF parity is exercised at the wiring level (see SeasonPlannerAgent);
 *    the validator itself is pure and unconditional, so we test it directly.
 */

import { describe, expect, it } from 'vitest';
import {
  CompetenceReachabilityValidator,
  type CompetenceReachabilityContext,
} from './CompetenceReachabilityValidator';
import type { ConsequenceTier, PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import type { SkillRoadblock } from '../pipeline/convergenceLedgerBuilder';

/** Build a plan from (sceneId, episodeNumber, tier) tuples. */
function planOf(
  scenes: { id: string; ep: number; tier?: ConsequenceTier; kind?: 'standard' | 'encounter' }[],
): SeasonScenePlan {
  const planned: PlannedScene[] = scenes.map((s, i) => ({
    id: s.id,
    episodeNumber: s.ep,
    order: i,
    kind: s.kind ?? 'standard',
    title: s.id,
    dramaticPurpose: 'x',
    narrativeRole: 'development',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    consequenceTier: s.tier,
  }));
  const byEpisode: Record<number, string[]> = {};
  for (const s of planned) (byEpisode[s.episodeNumber] ??= []).push(s.id);
  return { scenes: planned, byEpisode, setupPayoffEdges: [] };
}

const validator = new CompetenceReachabilityValidator();

function errorsOf(plan: SeasonScenePlan, ctx: CompetenceReachabilityContext): string[] {
  return validator
    .validate(plan, ctx)
    .issues.filter((i) => i.severity === 'error')
    .map((i) => i.message);
}

describe('CompetenceReachabilityValidator — winnability (no dead walls)', () => {
  // A wall at E6 gated at level 4; baseline 1, no growth before E6.
  const wallAtE6: SkillRoadblock = {
    source: 'skill',
    anchorId: 'milestone:infiltration-test',
    skill: 'infiltration',
    from: 'e3-test',
    to: 'e6-wall',
    gateLevel: 4,
  };
  const plan = planOf([
    { id: 'e3-test', ep: 3 },
    { id: 'e4-side', ep: 4 },
    { id: 'e6-wall', ep: 6, tier: 'branch' },
  ]);

  it('ERRORS when no growth path reaches the gate before its required payoff (dead wall)', () => {
    const errs = errorsOf(plan, {
      roadblocks: [wallAtE6],
      baselines: [{ skill: 'infiltration', level: 1 }],
      growth: [], // no growth — max stays at 1, never reaches 4
    });
    expect(errs.some((m) => /Dead wall/.test(m))).toBe(true);
  });

  it('adding a growth path + a return opportunity makes the winnable-later wall legal', () => {
    const errs = errorsOf(plan, {
      // The overcome flag = the return opportunity.
      roadblocks: [{ ...wallAtE6, overcomesPriorFailure: true }],
      baselines: [{ skill: 'infiltration', level: 1 }],
      // Side strand at E4 grows infiltration to the gate before E6.
      growth: [{ skill: 'infiltration', position: 4, delta: 3, optional: true }],
    });
    expect(errs).toHaveLength(0);
  });

  it('winnable-later but NO return opportunity is illegal', () => {
    const errs = errorsOf(plan, {
      roadblocks: [wallAtE6], // overcomesPriorFailure not set → no return
      baselines: [{ skill: 'infiltration', level: 1 }],
      growth: [{ skill: 'infiltration', position: 4, delta: 3, optional: true }],
    });
    expect(errs.some((m) => /no return opportunity/.test(m))).toBe(true);
  });

  it('winnable-now (expected already ≥ gate) produces no error', () => {
    const errs = errorsOf(plan, {
      roadblocks: [{ ...wallAtE6, gateLevel: 2 }],
      baselines: [{ skill: 'infiltration', level: 2 }],
      growth: [],
    });
    expect(errs).toHaveLength(0);
  });
});

describe('CompetenceReachabilityValidator — dangling growth', () => {
  it('flags a skill gain that gates no downstream wall', () => {
    const plan = planOf([{ id: 'e2-side', ep: 2 }]);
    const result = validator.validate(plan, {
      roadblocks: [],
      growth: [{ skill: 'lockpicking', position: 2, delta: 2, optional: true }],
    });
    const warns = result.issues.filter((i) => i.severity === 'warning').map((i) => i.message);
    expect(warns.some((m) => /Dangling growth.*lockpicking/.test(m))).toBe(true);
  });

  it('does NOT flag growth that DOES gate a wall', () => {
    const plan = planOf([
      { id: 'e2-side', ep: 2 },
      { id: 'e5-wall', ep: 5, tier: 'branchlet' },
    ]);
    const result = validator.validate(plan, {
      roadblocks: [
        {
          source: 'skill',
          anchorId: 'm:lock',
          skill: 'lockpicking',
          from: 'e2-side',
          to: 'e5-wall',
          gateLevel: 2,
          overcomesPriorFailure: true,
        },
      ],
      baselines: [{ skill: 'lockpicking', level: 0 }],
      growth: [{ skill: 'lockpicking', position: 2, delta: 2, optional: true }],
    });
    const dangling = result.issues.filter((i) => /Dangling growth/.test(i.message));
    expect(dangling).toHaveLength(0);
  });
});

describe('CompetenceReachabilityValidator — fail-forward gaps', () => {
  it('ERRORS when a failure arm leads nowhere', () => {
    const plan = planOf([{ id: 'e3-fight', ep: 3, kind: 'encounter' }]);
    const errs = errorsOf(plan, {
      roadblocks: [],
      failForwardArms: [
        { sceneId: 'e3-fight', arm: 'defeat', leadsTo: '' },
        { sceneId: 'e3-fight', arm: 'partial', leadsTo: 'e4-aftermath' },
      ],
    });
    expect(errs.some((m) => /Fail-forward gap.*defeat/.test(m))).toBe(true);
    // The arm that continues does not error.
    expect(errs.some((m) => /partial/.test(m))).toBe(false);
  });
});

describe('CompetenceReachabilityValidator — anchorless walls', () => {
  it('ERRORS on a roadblock with no anchorId', () => {
    const plan = planOf([{ id: 'e2-wall', ep: 2, tier: 'branch' }]);
    const errs = errorsOf(plan, {
      roadblocks: [
        { source: 'skill', anchorId: '  ', skill: 'x', from: 'e1', to: 'e2-wall', gateLevel: 1 },
      ],
      baselines: [{ skill: 'x', level: 5 }],
    });
    expect(errs.some((m) => /no anchorId/.test(m))).toBe(true);
  });
});
