/**
 * Unit tests for the dramatic-charge pre-pass (Plan Part 4, Layer E).
 *
 * Covers computeChargeParts (setup in-degree + ledger split by source lane),
 * computeChargeMap (combination, normalization, and the stat cap), and the
 * story-first guardrail that a bare meter crossing (`source: 'score'`) can never,
 * on its own, reach TAU_CHARGE.
 */

import { describe, expect, it } from 'vitest';
import {
  computeChargeParts,
  computeChargeMap,
  TAU_CHARGE,
  STAT_CHARGE_CAP,
} from './chargeMap';
import type { SeasonScenePlan, SetupPayoffEdge } from '../../types/scenePlan';
import type { ConvergenceLedger, ConvergenceEdge } from '../../types/convergenceLedger';

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

function edge(from: string, to: string): SetupPayoffEdge {
  return { from, to, span: 'same_episode' };
}

function ledger(edges: ConvergenceEdge[]): ConvergenceLedger {
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  return { nodes: [...nodes], edges };
}

describe('computeChargeParts', () => {
  it('accumulates setup in-degree as narrative-intent charge at the payoff scene', () => {
    const plan = planWith(
      [edge('a', 'pay'), edge('b', 'pay'), edge('c', 'other')],
      ['a', 'b', 'c', 'pay', 'other'],
    );
    const parts = computeChargeParts(plan);
    expect(parts.get('pay')!.narrativeIntentCharge).toBe(2);
    expect(parts.get('pay')!.statTrajectoryCharge).toBe(0);
    expect(parts.get('other')!.narrativeIntentCharge).toBe(1);
    // Plant-only scenes never receive inbound charge.
    expect(parts.get('a')).toBeUndefined();
  });

  it('routes a ledger `score` edge to the stat lane and everything else to intent', () => {
    const plan = planWith([], ['plant', 'pay']);
    const l = ledger([
      { from: 'plant', to: 'pay', source: 'thread', magnitude: 1, anchorId: 't1' },
      { from: 'plant', to: 'pay', source: 'relationship', magnitude: 0.5, anchorId: 'r1' },
      { from: 'plant', to: 'pay', source: 'score', magnitude: 0.8, anchorId: 's1' },
    ]);
    const parts = computeChargeParts(plan, l);
    expect(parts.get('pay')!.statTrajectoryCharge).toBe(0.8);
    // thread (1) + relationship (0.5) = 1.5 intent.
    expect(parts.get('pay')!.narrativeIntentCharge).toBeCloseTo(1.5, 9);
  });

  it('intent + stat lanes always sum back to the aggregateCharge inbound total', () => {
    const plan = planWith([], ['p', 'q']);
    const l = ledger([
      { from: 'p', to: 'q', source: 'identity', magnitude: 0.7, anchorId: 'i1' },
      { from: 'p', to: 'q', source: 'score', magnitude: 0.4, anchorId: 's1' },
    ]);
    const parts = computeChargeParts(plan, l);
    const { narrativeIntentCharge, statTrajectoryCharge } = parts.get('q')!;
    expect(narrativeIntentCharge + statTrajectoryCharge).toBeCloseTo(1.1, 9);
  });
});

describe('computeChargeMap (combination + normalization + stat cap)', () => {
  it('a scene with many converging anchored plants is highly charged (≥ TAU_CHARGE)', () => {
    const plan = planWith(
      [edge('a', 'pay'), edge('b', 'pay'), edge('c', 'pay')],
      ['a', 'b', 'c', 'pay'],
    );
    const { charge } = computeChargeMap(plan);
    expect(charge.get('pay')!).toBeGreaterThanOrEqual(TAU_CHARGE);
  });

  it('a single light plant stays below TAU_CHARGE (not enough to charge a fork)', () => {
    const plan = planWith([edge('a', 'pay')], ['a', 'pay']);
    const { charge } = computeChargeMap(plan);
    expect(charge.get('pay')!).toBeLessThan(TAU_CHARGE);
  });

  it('STAT CAP: a bare `score` crossing alone can NEVER reach TAU_CHARGE', () => {
    const plan = planWith([], ['plant', 'pay']);
    // A huge score magnitude with no narrative object behind it.
    const l = ledger([
      { from: 'plant', to: 'pay', source: 'score', magnitude: 1000, anchorId: 's1' },
    ]);
    const { charge } = computeChargeMap(plan, l);
    const value = charge.get('pay')!;
    expect(value).toBeLessThan(TAU_CHARGE);
    // It is clamped to the stat cap fraction of TAU_CHARGE.
    expect(value).toBeLessThanOrEqual(STAT_CHARGE_CAP + 1e-9);
  });

  it('a major anchored thread edge clears TAU_CHARGE on its own', () => {
    const plan = planWith([], ['plant', 'pay']);
    const l = ledger([
      { from: 'plant', to: 'pay', source: 'thread', magnitude: 2, anchorId: 'promise-1' },
    ]);
    const { charge } = computeChargeMap(plan, l);
    expect(charge.get('pay')!).toBeGreaterThanOrEqual(TAU_CHARGE);
  });

  it('is deterministic: identical input yields an identical map', () => {
    const build = () => {
      const plan = planWith([edge('a', 'pay'), edge('b', 'pay')], ['a', 'b', 'pay']);
      const l = ledger([
        { from: 'a', to: 'pay', source: 'thread', magnitude: 1, anchorId: 't' },
        { from: 'b', to: 'pay', source: 'score', magnitude: 0.3, anchorId: 's' },
      ]);
      return computeChargeMap(plan, l).charge;
    };
    const m1 = build();
    const m2 = build();
    expect([...m1.entries()].sort()).toEqual([...m2.entries()].sort());
  });

  it('charge values stay within [0,1]', () => {
    const plan = planWith(
      Array.from({ length: 20 }, (_, i) => edge(`p${i}`, 'pay')),
      [...Array.from({ length: 20 }, (_, i) => `p${i}`), 'pay'],
    );
    const { charge } = computeChargeMap(plan);
    for (const v of charge.values()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  // --- Regression: setup-edge charge must NOT be double-counted (review HIGH) ---
  it('does not double-count a setup edge that the ledger also carries', () => {
    // A ledger is the comprehensive artifact and already carries the plan's setup
    // edges (as source:setupPayoff). The standalone plan.setupPayoffEdges loop must
    // be skipped when a ledger is supplied, or the payoff scene's intent doubles.
    const plan = planWith([edge('plant', 'pay')], ['plant', 'pay']);
    const sameEdgeInLedger = ledger([
      { from: 'plant', to: 'pay', source: 'setupPayoff', magnitude: 1, anchorId: 'setup:plant' },
    ]);
    const withLedger = computeChargeParts(plan, sameEdgeInLedger);
    const withoutLedger = computeChargeParts(plan);
    expect(withLedger.get('pay')!.narrativeIntentCharge).toBe(1);
    expect(withoutLedger.get('pay')!.narrativeIntentCharge).toBe(1);
  });

  // --- Regression: charge is a FORWARD flow (review LOW) -----------------------
  it('ignores a backward ledger edge (payoff precedes plant in reading order)', () => {
    const plan = planWith([], ['early', 'late']);
    const backward = ledger([
      // from 'late' (order 1) to 'early' (order 0) — backward; must add no charge.
      { from: 'late', to: 'early', source: 'thread', magnitude: 5, anchorId: 't' },
    ]);
    const parts = computeChargeParts(plan, backward);
    expect(parts.get('early')?.narrativeIntentCharge ?? 0).toBe(0);
  });

  it('ignores a backward setup edge when no ledger is supplied', () => {
    const plan = planWith([{ from: 'late', to: 'early', span: 'same_episode' }], ['early', 'late']);
    const parts = computeChargeParts(plan);
    expect(parts.get('early')?.narrativeIntentCharge ?? 0).toBe(0);
  });
});
