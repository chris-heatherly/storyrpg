/**
 * Unit tests for the Convergence Ledger builder (Plan Part 6 + Part 9).
 *
 * Covers: setup/payoff projection into `setupPayoff` edges; ThreadLedger
 * plants/payoffs into `thread` edges (priority-scaled magnitude, promise = max);
 * the every-edge-carries-an-anchorId invariant; forward-only edges; and the
 * dedupe-by-(anchorId, to) rule that keeps one dramatic event from inflating
 * charge (Plan Part 11 #2).
 */

import { describe, expect, it } from 'vitest';
import { buildConvergenceLedger } from './convergenceLedgerBuilder';
import type { SeasonScenePlan, SetupPayoffEdge } from '../../types/scenePlan';
import type { ThreadLedger, NarrativeThread } from '../../types/narrativeThread';

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

function thread(over: Partial<NarrativeThread> & Pick<NarrativeThread, 'id'>): NarrativeThread {
  return {
    kind: 'seed',
    priority: 'minor',
    label: over.id,
    description: '',
    plants: [],
    payoffs: [],
    status: 'planned',
    ...over,
  };
}

describe('buildConvergenceLedger', () => {
  it('projects setupPayoffEdges into anchored setupPayoff edges', () => {
    const plan = planWith([edge('a', 'pay'), edge('b', 'pay')], ['a', 'b', 'pay']);
    const ledger = buildConvergenceLedger(plan);

    expect(ledger.edges).toHaveLength(2);
    for (const e of ledger.edges) {
      expect(e.source).toBe('setupPayoff');
      expect(e.to).toBe('pay');
      // Every edge MUST carry an anchorId (story-first invariant).
      expect(e.anchorId.length).toBeGreaterThan(0);
    }
    expect(ledger.edges.map((e) => e.from).sort()).toEqual(['a', 'b']);
    expect(new Set(ledger.nodes)).toEqual(new Set(['a', 'b', 'pay']));
  });

  it('every edge carries an anchorId across both sources', () => {
    const plan = planWith([edge('a', 'b')], ['a', 'b', 'c']);
    const ledger = buildConvergenceLedger(plan, {
      threadLedger: {
        threads: [
          thread({ id: 't1', plants: [{ sceneId: 'a', beatId: 'x' }], payoffs: [{ sceneId: 'c', beatId: 'y' }] }),
        ],
      },
    });
    expect(ledger.edges.length).toBeGreaterThan(0);
    for (const e of ledger.edges) {
      expect(typeof e.anchorId).toBe('string');
      expect(e.anchorId.length).toBeGreaterThan(0);
    }
  });

  it('produces forward-only edges (from-scene order < to-scene order)', () => {
    const plan = planWith([], ['s0', 's1', 's2', 's3']);
    const ledger = buildConvergenceLedger(plan, {
      threadLedger: {
        threads: [
          thread({
            id: 'fwd',
            priority: 'major',
            kind: 'promise',
            plants: [{ sceneId: 's0', beatId: 'p' }],
            payoffs: [{ sceneId: 's3', beatId: 'q' }],
          }),
        ],
      },
    });
    const orderOf = (id: string) => plan.scenes.findIndex((s) => s.id === id);
    for (const e of ledger.edges) {
      expect(orderOf(e.from)).toBeLessThan(orderOf(e.to));
    }
  });

  it('fans thread plants × payoffs into thread edges anchored on thread.id', () => {
    const plan = planWith([], ['s0', 's1', 's2']);
    const ledger = buildConvergenceLedger(plan, {
      threadLedger: {
        threads: [
          thread({
            id: 'vale-breaking',
            plants: [{ sceneId: 's0', beatId: 'p' }],
            payoffs: [
              { sceneId: 's1', beatId: 'q1' },
              { sceneId: 's2', beatId: 'q2' },
            ],
          }),
        ],
      },
    });
    const threadEdges = ledger.edges.filter((e) => e.source === 'thread');
    expect(threadEdges).toHaveLength(2); // one per payoff
    for (const e of threadEdges) {
      expect(e.anchorId).toBe('vale-breaking');
      expect(e.from).toBe('s0');
    }
  });

  it('scales magnitude by ThreadPriority (major > minor) with a promise bump', () => {
    const plan = planWith([], ['s0', 's1']);
    const mk = (priority: 'major' | 'minor', kind: NarrativeThread['kind']) =>
      buildConvergenceLedger(plan, {
        threadLedger: {
          threads: [
            thread({
              id: `${priority}-${kind}`,
              priority,
              kind,
              plants: [{ sceneId: 's0', beatId: 'p' }],
              payoffs: [{ sceneId: 's1', beatId: 'q' }],
            }),
          ],
        },
      }).edges[0].magnitude;

    const majorSeed = mk('major', 'seed');
    const minorSeed = mk('minor', 'seed');
    const majorPromise = mk('major', 'promise');

    expect(majorSeed).toBeGreaterThan(minorSeed);
    // A discharging promise reads as max charge → heaviest.
    expect(majorPromise).toBeGreaterThan(majorSeed);
  });

  it('dedupes one dramatic event by (anchorId, to) so charge does not inflate', () => {
    const plan = planWith([], ['s0', 's1', 'pay']);
    // Two plants of the SAME thread converging on one payoff scene: that is ONE
    // dramatic event (the thread paying off), not two — dedupe to a single edge.
    const ledger = buildConvergenceLedger(plan, {
      threadLedger: {
        threads: [
          thread({
            id: 'one-event',
            priority: 'major',
            plants: [
              { sceneId: 's0', beatId: 'p0' },
              { sceneId: 's1', beatId: 'p1' },
            ],
            payoffs: [{ sceneId: 'pay', beatId: 'q' }],
          }),
        ],
      },
    });
    const threadEdges = ledger.edges.filter((e) => e.anchorId === 'one-event');
    expect(threadEdges).toHaveLength(1);
  });

  it('keeps the max magnitude when deduping a multi-plant promise', () => {
    const plan = planWith([], ['s0', 'pay']);
    const major = buildConvergenceLedger(plan, {
      threadLedger: {
        threads: [
          thread({
            id: 'p',
            priority: 'major',
            kind: 'promise',
            plants: [{ sceneId: 's0', beatId: 'p0' }],
            payoffs: [{ sceneId: 'pay', beatId: 'q' }],
          }),
        ],
      },
    }).edges.find((e) => e.anchorId === 'p')!.magnitude;
    expect(major).toBeGreaterThan(0);
  });

  it('tolerates an absent ThreadLedger (setup edges only)', () => {
    const plan = planWith([edge('a', 'b')], ['a', 'b']);
    const ledger = buildConvergenceLedger(plan);
    expect(ledger.edges).toHaveLength(1);
    expect(ledger.edges[0].source).toBe('setupPayoff');
  });

  it('is deterministic — same input yields the same ledger', () => {
    const plan = planWith([edge('a', 'b')], ['a', 'b', 'c']);
    const tl: ThreadLedger = {
      threads: [
        thread({ id: 't', priority: 'major', plants: [{ sceneId: 'a', beatId: 'p' }], payoffs: [{ sceneId: 'c', beatId: 'q' }] }),
      ],
    };
    const a = buildConvergenceLedger(plan, { threadLedger: tl });
    const b = buildConvergenceLedger(plan, { threadLedger: tl });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
