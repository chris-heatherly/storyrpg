/**
 * Phase 6 (`GATE_CHARGE_MATERIALIZATION`) — episode-time charge materialization
 * (Plan Part 9, the intent→materialization second pass).
 *
 * The plan-time validators reason over INTENT; this one is the BACKSTOP that, once
 * `ChoiceAuthor` has written the real {@link Consequence}[], confirms each ledger
 * edge's promised charge actually MATERIALIZED — a consequence of the edge's
 * source family really moves the dimension toward its threshold (`edge.materialized`).
 *
 * Covered:
 *  - an edge with a matching authored relationship/flag delta materializes;
 *  - a heavy-tier unit with NO matching delta is flagged a hollow branch (error);
 *  - the annotated ledger carries `materialized` and the input ledger is untouched;
 *  - encounters and bare-score edges never escalate to a hollow-branch error
 *    (story-first guardrails: Part 7 #1 stat cap, encounter outcome-tree exemption);
 *  - direction-aware matching (a delta moving the WRONG way does not materialize);
 *  - the gate helper: flag OFF → advisory (no throw); flag ON → hollow branch throws.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  ChargeMaterializationValidator,
  edgeKey,
  type ChargeMaterializationContext,
} from './ChargeMaterializationValidator';
import { runChargeMaterializationGate } from '../pipeline/chargeMaterializationGate';
import type { ConvergenceEdge, ConvergenceLedger } from '../../types/convergenceLedger';
import type { ConsequenceTier, PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import type { Consequence } from '../../types/consequences';

// --- builders -------------------------------------------------------------

function scene(
  id: string,
  episodeNumber: number,
  opts: { kind?: 'standard' | 'encounter'; tier?: ConsequenceTier } = {},
): PlannedScene {
  return {
    id,
    episodeNumber,
    order: 0,
    kind: opts.kind ?? 'standard',
    title: id,
    dramaticPurpose: 'x',
    narrativeRole: 'development',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    consequenceTier: opts.tier,
  };
}

function plan(scenes: PlannedScene[]): SeasonScenePlan {
  const byEpisode: Record<number, string[]> = {};
  for (const s of scenes) {
    (byEpisode[s.episodeNumber] ??= []).push(s.id);
  }
  return { scenes, byEpisode, setupPayoffEdges: [] };
}

function ledger(edges: ConvergenceEdge[]): ConvergenceLedger {
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  return { nodes: [...nodes], edges };
}

function ctx(
  episodeNumber: number,
  sceneConsequences: { sceneId: string; consequences: Consequence[] }[],
  targets?: ChargeMaterializationContext['targets'],
): ChargeMaterializationContext {
  return { episodeNumber, sceneConsequences, targets };
}

afterEach(() => {
  delete process.env.GATE_CHARGE_MATERIALIZATION;
});

// --- materialization: positive cases -------------------------------------

describe('ChargeMaterializationValidator — materialization', () => {
  it('materializes a relationship edge when a matching authored delta moves the dimension', () => {
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branch' })]);
    const e: ConvergenceEdge = {
      from: 's0',
      to: 'payoff',
      source: 'relationship',
      magnitude: 3,
      anchorId: 'relationship:vale:trust',
    };
    const l = ledger([e]);

    const v = new ChargeMaterializationValidator();
    const res = v.validate(
      p,
      l,
      ctx(
        1,
        [{ sceneId: 'payoff', consequences: [{ type: 'relationship', npcId: 'vale', dimension: 'trust', change: -15 }] }],
        { [edgeKey(e)]: { dimension: 'vale:trust', direction: -1 } },
      ),
    );

    expect(res.valid).toBe(true);
    const annotated = res.ledger.edges.find((x) => x.to === 'payoff');
    expect(annotated?.materialized).toBe(true);
    // Heavy edge that materialized → no hollow-branch error.
    expect(res.issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('materializes a flag edge by source-family presence when no target is supplied', () => {
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branchlet' })]);
    const e: ConvergenceEdge = {
      from: 's0',
      to: 'payoff',
      source: 'flag',
      magnitude: 2,
      anchorId: 'flag:informant-concealed',
    };
    const res = new ChargeMaterializationValidator().validate(
      p,
      ledger([e]),
      ctx(1, [{ sceneId: 'payoff', consequences: [{ type: 'setFlag', flag: 'informant-concealed', value: true }] }]),
    );
    expect(res.ledger.edges[0].materialized).toBe(true);
    expect(res.valid).toBe(true);
  });

  it('does NOT mutate the input ledger (pure annotation on a copy)', () => {
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branch' })]);
    const e: ConvergenceEdge = { from: 's0', to: 'payoff', source: 'flag', magnitude: 2, anchorId: 'a' };
    const l = ledger([e]);
    new ChargeMaterializationValidator().validate(
      p,
      l,
      ctx(1, [{ sceneId: 'payoff', consequences: [{ type: 'setFlag', flag: 'x', value: true }] }]),
    );
    expect(l.edges[0].materialized).toBeUndefined();
  });
});

// --- hollow branch --------------------------------------------------------

describe('ChargeMaterializationValidator — hollow branch', () => {
  it('flags a heavy unit whose promised charge never materializes as a hollow branch (error)', () => {
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branch' })]);
    const e: ConvergenceEdge = {
      from: 's0',
      to: 'payoff',
      source: 'relationship',
      magnitude: 3,
      anchorId: 'relationship:vale:trust',
    };
    const res = new ChargeMaterializationValidator().validate(
      p,
      ledger([e]),
      // No relationship consequence authored on the payoff scene.
      ctx(1, [{ sceneId: 'payoff', consequences: [{ type: 'setFlag', flag: 'unrelated', value: true }] }]),
    );

    expect(res.valid).toBe(false);
    const errors = res.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Hollow branch');
    expect(res.ledger.edges[0].materialized).toBe(false);
  });

  it('a relationship delta moving the WRONG direction does not materialize (direction-aware)', () => {
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branch' })]);
    const e: ConvergenceEdge = {
      from: 's0',
      to: 'payoff',
      source: 'relationship',
      magnitude: 3,
      anchorId: 'relationship:vale:trust',
    };
    const res = new ChargeMaterializationValidator().validate(
      p,
      ledger([e]),
      ctx(
        1,
        // trust rising, but the promised crossing is a betrayal (falling).
        [{ sceneId: 'payoff', consequences: [{ type: 'relationship', npcId: 'vale', dimension: 'trust', change: +10 }] }],
        { [edgeKey(e)]: { dimension: 'vale:trust', direction: -1 } },
      ),
    );
    expect(res.valid).toBe(false);
    expect(res.ledger.edges[0].materialized).toBe(false);
  });

  it('does NOT escalate an encounter (heavy by invariant) to a hollow-branch error', () => {
    const p = plan([scene('s0', 1), scene('enc', 1, { kind: 'encounter', tier: 'branch' })]);
    const e: ConvergenceEdge = { from: 's0', to: 'enc', source: 'relationship', magnitude: 3, anchorId: 'a' };
    const res = new ChargeMaterializationValidator().validate(
      p,
      ledger([e]),
      ctx(1, [{ sceneId: 'enc', consequences: [] }]),
    );
    // Advisory warning at most, never an error (encounter outcome-tree exemption).
    expect(res.valid).toBe(true);
    expect(res.issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('does NOT escalate a bare score edge to a hollow-branch error (stat cap, Part 7 #1)', () => {
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branch' })]);
    const e: ConvergenceEdge = { from: 's0', to: 'payoff', source: 'score', magnitude: 3, anchorId: 'score:suspicion' };
    const res = new ChargeMaterializationValidator().validate(
      p,
      ledger([e]),
      ctx(1, [{ sceneId: 'payoff', consequences: [] }]),
    );
    expect(res.valid).toBe(true);
    expect(res.issues.some((i) => i.severity === 'error')).toBe(false);
    expect(res.ledger.edges[0].materialized).toBe(false);
  });

  it('ignores edges whose payoff lands in a different episode', () => {
    const p = plan([scene('s0', 1), scene('payoff', 2, { tier: 'branch' })]);
    const e: ConvergenceEdge = { from: 's0', to: 'payoff', source: 'relationship', magnitude: 3, anchorId: 'a' };
    const res = new ChargeMaterializationValidator().validate(
      p,
      ledger([e]),
      // Checking episode 1; the edge lands in episode 2 → not examined.
      ctx(1, []),
    );
    expect(res.valid).toBe(true);
    expect(res.ledger.edges[0].materialized).toBeUndefined();
  });
});

// --- determinism ----------------------------------------------------------

describe('ChargeMaterializationValidator — determinism', () => {
  it('same input yields the same result and annotations', () => {
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branch' })]);
    const e: ConvergenceEdge = { from: 's0', to: 'payoff', source: 'relationship', magnitude: 3, anchorId: 'a' };
    const build = () =>
      new ChargeMaterializationValidator().validate(
        p,
        ledger([e]),
        ctx(1, [{ sceneId: 'payoff', consequences: [{ type: 'setFlag', flag: 'x', value: true }] }]),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

// --- gate helper (flag OFF advisory / flag ON blocking) -------------------

describe('runChargeMaterializationGate — flag gating', () => {
  const hollowSetup = () => {
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branch' })]);
    const e: ConvergenceEdge = {
      from: 's0',
      to: 'payoff',
      source: 'relationship',
      magnitude: 3,
      anchorId: 'relationship:vale:trust',
    };
    return {
      p,
      l: ledger([e]),
      c: ctx(1, [{ sceneId: 'payoff', consequences: [{ type: 'setFlag', flag: 'unrelated', value: true }] }]),
    };
  };

  it('flag OFF: a hollow branch is advisory — does NOT throw, returns blocking:false', () => {
    delete process.env.GATE_CHARGE_MATERIALIZATION;
    const { p, l, c } = hollowSetup();
    const outcome = runChargeMaterializationGate(p, l, c);
    expect(outcome.blocking).toBe(false);
    expect(outcome.result.valid).toBe(false); // still reported advisory
    expect(outcome.result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('flag ON: a hollow branch THROWS (blocks for repair)', () => {
    process.env.GATE_CHARGE_MATERIALIZATION = '1';
    const { p, l, c } = hollowSetup();
    expect(() => runChargeMaterializationGate(p, l, c)).toThrow(/Hollow branch|hollow branch/);
  });

  it('flag ON: a fully-materialized episode does NOT throw', () => {
    process.env.GATE_CHARGE_MATERIALIZATION = '1';
    const p = plan([scene('s0', 1), scene('payoff', 1, { tier: 'branch' })]);
    const e: ConvergenceEdge = { from: 's0', to: 'payoff', source: 'flag', magnitude: 2, anchorId: 'a' };
    const c = ctx(1, [{ sceneId: 'payoff', consequences: [{ type: 'setFlag', flag: 'x', value: true }] }]);
    const outcome = runChargeMaterializationGate(p, ledger([e]), c);
    expect(outcome.blocking).toBe(true);
    expect(outcome.result.valid).toBe(true);
  });
});
