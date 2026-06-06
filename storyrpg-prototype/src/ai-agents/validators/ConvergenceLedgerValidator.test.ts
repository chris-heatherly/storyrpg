/**
 * Unit tests for the ConvergenceLedgerValidator (Plan Part 9, plan-time pass).
 *
 * Covers: forward-only edges; the anchorless-above-cap error; charge-coverage
 * (an uncharged heavy-tier scene is flagged, encounters exempt); and the
 * major-promise-detonation check (a major promise that fizzles into a light tier
 * is flagged).
 */

import { describe, expect, it } from 'vitest';
import { ConvergenceLedgerValidator } from './ConvergenceLedgerValidator';
import { STAT_CHARGE_CAP } from '../pipeline/chargeMap';
import type {
  ConsequenceTier,
  PlannedScene,
  SeasonScenePlan,
} from '../../types/scenePlan';
import type {
  ConvergenceEdge,
  ConvergenceLedger,
} from '../../types/convergenceLedger';
import type { ThreadLedger, NarrativeThread } from '../../types/narrativeThread';

interface SceneSpec {
  id: string;
  tier?: ConsequenceTier;
  kind?: 'standard' | 'encounter';
}

function planWith(scenes: SceneSpec[]): SeasonScenePlan {
  return {
    scenes: scenes.map((s, i): PlannedScene => ({
      id: s.id,
      episodeNumber: 1,
      order: i,
      kind: (s.kind ?? 'standard') as PlannedScene['kind'],
      title: s.id,
      dramaticPurpose: 'x',
      narrativeRole: 'development',
      locations: [],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
      consequenceTier: s.tier,
    })),
    byEpisode: { 1: scenes.map((s) => s.id) },
    setupPayoffEdges: [],
  };
}

function ledgerWith(edges: ConvergenceEdge[]): ConvergenceLedger {
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  return { nodes: [...nodes], edges };
}

function anchoredEdge(from: string, to: string): ConvergenceEdge {
  return { from, to, source: 'thread', magnitude: 3, anchorId: 't' };
}

function promiseThread(over: Partial<NarrativeThread> & Pick<NarrativeThread, 'id'>): NarrativeThread {
  return {
    kind: 'promise',
    priority: 'major',
    label: over.id,
    description: '',
    plants: [],
    payoffs: [],
    status: 'planned',
    ...over,
  };
}

const errors = (r: { issues: { severity: string; location?: string; message: string }[] }) =>
  r.issues.filter((i) => i.severity === 'error');

describe('ConvergenceLedgerValidator — forward-only edges', () => {
  it('passes when every edge points forward in time', () => {
    const plan = planWith([{ id: 'a' }, { id: 'b' }]);
    const ledger = ledgerWith([anchoredEdge('a', 'b')]);
    const result = new ConvergenceLedgerValidator().validate(plan, ledger);
    expect(errors(result)).toHaveLength(0);
  });

  it('flags a backward (or self) edge as an error', () => {
    const plan = planWith([{ id: 'a' }, { id: 'b' }]);
    const ledger = ledgerWith([anchoredEdge('b', 'a')]); // b is later than a
    const result = new ConvergenceLedgerValidator().validate(plan, ledger);
    expect(errors(result).some((i) => /forward in time/.test(i.message))).toBe(true);
  });
});

describe('ConvergenceLedgerValidator — anchorless charge', () => {
  it('errors on an anchorless edge above the stat cap', () => {
    const plan = planWith([{ id: 'a' }, { id: 'b' }]);
    const ledger = ledgerWith([
      { from: 'a', to: 'b', source: 'score', magnitude: STAT_CHARGE_CAP + 1, anchorId: '' },
    ]);
    const result = new ConvergenceLedgerValidator().validate(plan, ledger);
    expect(errors(result).some((i) => /no anchorId/.test(i.message))).toBe(true);
  });
});

describe('ConvergenceLedgerValidator — charge coverage', () => {
  it('flags an uncharged heavy-tier branch (no inbound anchored edge)', () => {
    const plan = planWith([
      { id: 'a' },
      { id: 'branch', tier: 'branch' }, // heavy, but nothing points into it
    ]);
    const ledger = ledgerWith([]);
    const result = new ConvergenceLedgerValidator().validate(plan, ledger);
    expect(
      errors(result).some((i) => i.location === 'chargeCoverage:branch'),
    ).toBe(true);
  });

  it('passes a heavy-tier scene that has an inbound anchored edge', () => {
    const plan = planWith([{ id: 'a' }, { id: 'branch', tier: 'branch' }]);
    const ledger = ledgerWith([anchoredEdge('a', 'branch')]);
    const result = new ConvergenceLedgerValidator().validate(plan, ledger);
    expect(errors(result).some((i) => i.location === 'chargeCoverage:branch')).toBe(false);
  });

  it('exempts encounters from charge coverage (heavy by invariant)', () => {
    const plan = planWith([{ id: 'a' }, { id: 'enc', tier: 'branch', kind: 'encounter' }]);
    const ledger = ledgerWith([]);
    const result = new ConvergenceLedgerValidator().validate(plan, ledger);
    expect(errors(result).some((i) => i.location === 'chargeCoverage:enc')).toBe(false);
  });
});

describe('ConvergenceLedgerValidator — major promise detonation', () => {
  it('flags a major promise that fizzles into a light tier', () => {
    const plan = planWith([{ id: 'a' }, { id: 'pay', tier: 'tint' }]);
    const ledger = ledgerWith([anchoredEdge('a', 'pay')]);
    const threadLedger: ThreadLedger = {
      threads: [
        promiseThread({
          id: 'vale-breaking',
          plants: [{ sceneId: 'a', beatId: 'p' }],
          payoffs: [{ sceneId: 'pay', beatId: 'q' }],
        }),
      ],
    };
    const result = new ConvergenceLedgerValidator().validate(plan, ledger, { threadLedger });
    expect(
      errors(result).some((i) => i.location === 'promiseDetonation:vale-breaking'),
    ).toBe(true);
  });

  it('passes a major promise that detonates at a heavy tier', () => {
    const plan = planWith([{ id: 'a' }, { id: 'pay', tier: 'branch' }]);
    const ledger = ledgerWith([anchoredEdge('a', 'pay')]);
    const threadLedger: ThreadLedger = {
      threads: [
        promiseThread({
          id: 'vale-breaking',
          plants: [{ sceneId: 'a', beatId: 'p' }],
          payoffs: [{ sceneId: 'pay', beatId: 'q' }],
        }),
      ],
    };
    const result = new ConvergenceLedgerValidator().validate(plan, ledger, { threadLedger });
    expect(
      errors(result).some((i) => i.location === 'promiseDetonation:vale-breaking'),
    ).toBe(false);
  });

  it('does not fire promise-detonation when no ThreadLedger is supplied', () => {
    const plan = planWith([{ id: 'a' }, { id: 'pay', tier: 'tint' }]);
    const ledger = ledgerWith([anchoredEdge('a', 'pay')]);
    const result = new ConvergenceLedgerValidator().validate(plan, ledger);
    expect(errors(result).some((i) => /promiseDetonation/.test(i.location ?? ''))).toBe(false);
  });
});
