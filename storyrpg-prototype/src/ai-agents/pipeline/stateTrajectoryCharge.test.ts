/**
 * Phase 5 (`CHARGE_STATS`) — state-trajectory charge tests
 * (Plan Part 5 value/trajectory duality + Part 4 + Part 7 #1 stat cap).
 *
 * The trajectory = charge half of the duality: a planned relationship / identity
 * / score trajectory CROSSING a threshold near a scene projects into a
 * `relationship`/`identity`/`score` edge anchored on the arc target. These tests
 * exercise the full builder → charge-map path so they prove behavior the
 * allocator actually reads.
 *
 * Covered:
 *  - flag OFF → crossings ignored; ledger byte-identical to Phase 4 (unchanged);
 *  - flag ON  → a relationship crossing ELEVATES a scene (clears TAU_CHARGE);
 *  - the STAT CAP: a `score` crossing ALONE (no narrative anchor) can never
 *    cross the major threshold (Part 7 #1 — stats confirm, never manufacture);
 *  - DEDUPE: an event that moves a relationship AND an identity is ONE dramatic
 *    event (co-moving signals cluster by eventId — Part 11 #2);
 *  - determinism.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildConvergenceLedger,
  type StateTrajectoryCrossing,
} from './convergenceLedgerBuilder';
import { computeChargeMap, TAU_CHARGE } from './chargeMap';
import type { SeasonScenePlan, SetupPayoffEdge } from '../../types/scenePlan';

function planWith(edges: SetupPayoffEdge[], sceneIds: string[]): SeasonScenePlan {
  return {
    scenes: sceneIds.map((id, i) => ({
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
    byEpisode: { 1: sceneIds },
    setupPayoffEdges: edges,
  };
}

const relCrossing: StateTrajectoryCrossing = {
  source: 'relationship',
  anchorId: 'vale-trust',
  from: 's0',
  to: 'pay',
};

const scoreCrossing: StateTrajectoryCrossing = {
  source: 'score',
  anchorId: 'suspicion',
  from: 's0',
  to: 'pay',
};

afterEach(() => {
  delete process.env.CHARGE_STATS;
});

describe('Phase 5 — flag gating (CHARGE_STATS)', () => {
  it('flag OFF: trajectory crossings are ignored — ledger identical to Phase 4', () => {
    delete process.env.CHARGE_STATS;
    const plan = planWith([{ from: 's0', to: 'pay', span: 'same_episode' }], ['s0', 'pay']);

    const withCrossings = buildConvergenceLedger(plan, {
      trajectoryCrossings: [relCrossing, scoreCrossing],
    });
    const without = buildConvergenceLedger(plan);

    // Byte-identical: crossings contributed nothing.
    expect(JSON.stringify(withCrossings)).toBe(JSON.stringify(without));
    // Only the setup edge survives.
    expect(withCrossings.edges).toHaveLength(1);
    expect(withCrossings.edges[0].source).toBe('setupPayoff');
  });

  it('flag ON: a relationship crossing projects into an anchored relationship edge', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    const ledger = buildConvergenceLedger(plan, { trajectoryCrossings: [relCrossing] });

    const relEdges = ledger.edges.filter((e) => e.source === 'relationship');
    expect(relEdges).toHaveLength(1);
    expect(relEdges[0]).toMatchObject({ from: 's0', to: 'pay', anchorId: 'vale-trust' });
    // Story-first: every edge carries an anchorId.
    expect(relEdges[0].anchorId.length).toBeGreaterThan(0);
  });
});

describe('Phase 5 — Rule 1 (trajectory crossing elevates)', () => {
  it('a relationship crossing alone elevates its scene to/over TAU_CHARGE', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    const ledger = buildConvergenceLedger(plan, { trajectoryCrossings: [relCrossing] });
    const { charge } = computeChargeMap(plan, ledger);
    // Relationship = the richest charge source: a crossing earns a major on its own.
    expect(charge.get('pay')!).toBeGreaterThanOrEqual(TAU_CHARGE);
  });

  it('an identity-axis crossing alone also elevates its scene', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    const ledger = buildConvergenceLedger(plan, {
      trajectoryCrossings: [
        { source: 'identity', anchorId: 'honest_deceptive', from: 's0', to: 'pay' },
      ],
    });
    const { charge } = computeChargeMap(plan, ledger);
    expect(charge.get('pay')!).toBeGreaterThanOrEqual(TAU_CHARGE);
  });
});

describe('Phase 5 — stat cap (Part 7 #1): a score crossing cannot manufacture a major', () => {
  it('a score crossing ALONE (no narrative anchor) stays strictly below TAU_CHARGE', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    // Even with an enormous magnitude, a bare meter can only CONFIRM, never drive.
    const ledger = buildConvergenceLedger(plan, {
      trajectoryCrossings: [{ ...scoreCrossing, magnitude: 1000 }],
    });
    const { charge } = computeChargeMap(plan, ledger);
    expect(charge.get('pay')!).toBeLessThan(TAU_CHARGE);
  });

  it('a score crossing routes to the stat lane (capped), relationship to the intent lane', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    const ledger = buildConvergenceLedger(plan, {
      trajectoryCrossings: [relCrossing, scoreCrossing],
    });
    const { parts } = computeChargeMap(plan, ledger);
    const p = parts.get('pay')!;
    expect(p.statTrajectoryCharge).toBeGreaterThan(0); // the score crossing
    expect(p.narrativeIntentCharge).toBeGreaterThan(0); // the relationship crossing
  });

  it('a score crossing can CONFIRM but a relationship crossing already crosses the threshold', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    const withScore = computeChargeMap(
      plan,
      buildConvergenceLedger(plan, { trajectoryCrossings: [relCrossing, scoreCrossing] }),
    ).charge.get('pay')!;
    const withoutScore = computeChargeMap(
      plan,
      buildConvergenceLedger(plan, { trajectoryCrossings: [relCrossing] }),
    ).charge.get('pay')!;
    // The score confirms (does not reduce) but the relationship already earned it.
    expect(withScore).toBeGreaterThanOrEqual(withoutScore);
    expect(withoutScore).toBeGreaterThanOrEqual(TAU_CHARGE);
  });
});

describe('Phase 5 — dedupe co-moving signals (Part 11 #2)', () => {
  it('a relationship AND an identity moved by ONE event collapse to a single edge', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    const ledger = buildConvergenceLedger(plan, {
      trajectoryCrossings: [
        { source: 'relationship', anchorId: 'vale-trust', from: 's0', to: 'pay', eventId: 'vale-betrayal' },
        { source: 'identity', anchorId: 'honest_deceptive', from: 's0', to: 'pay', eventId: 'vale-betrayal' },
      ],
    });
    const trajEdges = ledger.edges.filter(
      (e) => e.source === 'relationship' || e.source === 'identity',
    );
    // ONE dramatic event → ONE edge (the richest source, relationship, survives).
    expect(trajEdges).toHaveLength(1);
    expect(trajEdges[0].source).toBe('relationship');
  });

  it('the deduped event is not double-counted in charge', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    const coMoving = computeChargeMap(
      plan,
      buildConvergenceLedger(plan, {
        trajectoryCrossings: [
          { source: 'relationship', anchorId: 'vale-trust', from: 's0', to: 'pay', eventId: 'e1' },
          { source: 'identity', anchorId: 'honest_deceptive', from: 's0', to: 'pay', eventId: 'e1' },
        ],
      }),
    ).charge.get('pay')!;
    const single = computeChargeMap(
      plan,
      buildConvergenceLedger(plan, { trajectoryCrossings: [relCrossing] }),
    ).charge.get('pay')!;
    // A relationship+identity tip is one event — same charge as the relationship alone.
    expect(coMoving).toBeCloseTo(single, 9);
  });

  it('UNRELATED crossings (no shared eventId) are NOT clustered — both contribute', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([], ['s0', 'pay']);
    const ledger = buildConvergenceLedger(plan, {
      trajectoryCrossings: [
        { source: 'relationship', anchorId: 'vale-trust', from: 's0', to: 'pay' },
        { source: 'identity', anchorId: 'honest_deceptive', from: 's0', to: 'pay' },
      ],
    });
    const trajEdges = ledger.edges.filter(
      (e) => e.source === 'relationship' || e.source === 'identity',
    );
    expect(trajEdges).toHaveLength(2);
  });
});

describe('Phase 5 — determinism', () => {
  it('same (plan, crossings) yields the same ledger', () => {
    process.env.CHARGE_STATS = '1';
    const plan = planWith([{ from: 's0', to: 'pay', span: 'same_episode' }], ['s0', 'pay']);
    const crossings: StateTrajectoryCrossing[] = [
      { source: 'relationship', anchorId: 'vale-trust', from: 's0', to: 'pay', eventId: 'e1' },
      { source: 'identity', anchorId: 'honest_deceptive', from: 's0', to: 'pay', eventId: 'e1' },
      { source: 'score', anchorId: 'suspicion', from: 's0', to: 'pay' },
    ];
    const a = buildConvergenceLedger(plan, { trajectoryCrossings: crossings });
    const b = buildConvergenceLedger(plan, { trajectoryCrossings: crossings });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
