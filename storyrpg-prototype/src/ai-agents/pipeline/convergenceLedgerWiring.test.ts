/**
 * Phase 4 wiring tests (Plan Part 6 + Part 10): the CONVERGENCE_LEDGER flag
 * gates whether a ledger is built and fed into the charge map.
 *
 * These assert the gating contract the SeasonPlannerAgent relies on:
 *  - flag OFF → no ledger / no charge is derived (behavior byte-identical to
 *    before this phase);
 *  - flag ON  → a ledger is built and yields a non-empty charge map that the
 *    allocator can read via BudgetContext.
 *
 * The flag itself is read by {@link consequenceFlags}; the build + charge are the
 * pure helpers the agent composes. We exercise that composition here without the
 * full agent so the test is fast and deterministic.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { consequenceFlags } from './consequenceFlags';
import { buildConvergenceLedger } from './convergenceLedgerBuilder';
import { computeChargeMap } from './chargeMap';
import type { SeasonScenePlan } from '../../types/scenePlan';
import type { ThreadLedger } from '../../types/narrativeThread';

function plan(): SeasonScenePlan {
  const ids = ['s0', 's1', 's2'];
  return {
    scenes: ids.map((id, i) => ({
      id,
      episodeNumber: 1,
      order: i,
      kind: 'standard' as const,
      title: id,
      dramaticPurpose: 'x',
      narrativeRole: 'development' as const,
      locations: [],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
    })),
    byEpisode: { 1: ids },
    setupPayoffEdges: [{ from: 's0', to: 's2', span: 'same_episode' }],
  };
}

const threadLedger: ThreadLedger = {
  threads: [
    {
      id: 'vale-breaking',
      kind: 'promise',
      priority: 'major',
      label: 'Vale breaking',
      description: '',
      plants: [{ sceneId: 's0', beatId: 'p' }],
      payoffs: [{ sceneId: 's2', beatId: 'q' }],
      status: 'planned',
    },
  ],
};

/**
 * Mirror the SeasonPlannerAgent's flag-gated composition: build the ledger and
 * derive the charge map ONLY when the flag is on.
 */
function deriveCharge(p: SeasonScenePlan, tl?: ThreadLedger): {
  ledger?: ReturnType<typeof buildConvergenceLedger>;
  charge?: Map<string, number>;
} {
  if (!consequenceFlags().ledger) return {};
  const ledger = buildConvergenceLedger(p, { threadLedger: tl });
  const charge = computeChargeMap(p, ledger).charge;
  return { ledger, charge };
}

describe('Phase 4 — CONVERGENCE_LEDGER flag gating', () => {
  afterEach(() => {
    delete process.env.CONVERGENCE_LEDGER;
  });

  it('flag OFF: no ledger is built and no charge is derived (unchanged)', () => {
    delete process.env.CONVERGENCE_LEDGER;
    expect(consequenceFlags().ledger).toBe(false);
    const out = deriveCharge(plan(), threadLedger);
    expect(out.ledger).toBeUndefined();
    expect(out.charge).toBeUndefined();
  });

  it('flag ON: a ledger is built and yields a non-empty charge map', () => {
    process.env.CONVERGENCE_LEDGER = '1';
    expect(consequenceFlags().ledger).toBe(true);
    const out = deriveCharge(plan(), threadLedger);
    expect(out.ledger).toBeDefined();
    expect(out.ledger!.edges.length).toBeGreaterThan(0);
    // The major promise + setup edge converge on s2 → it carries charge.
    expect((out.charge!.get('s2') ?? 0)).toBeGreaterThan(0);
  });

  it('flag ON tolerates an absent ThreadLedger (setup edges still charge)', () => {
    process.env.CONVERGENCE_LEDGER = '1';
    const out = deriveCharge(plan(), undefined);
    expect(out.ledger!.edges).toHaveLength(1); // the lone setup edge
    expect((out.charge!.get('s2') ?? 0)).toBeGreaterThan(0);
  });
});
