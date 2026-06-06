/**
 * Unit tests for the Convergence Ledger charge aggregation.
 *
 * `aggregateCharge` sums `edge.magnitude` by `edge.to`, deterministically — the
 * single read path the allocator, ThreadPlanner, and BranchManager all share.
 */

import { describe, expect, it } from 'vitest';
import { aggregateCharge } from './convergenceLedger';
import type { ConvergenceEdge, ConvergenceLedger } from './convergenceLedger';

function edge(opts: Partial<ConvergenceEdge> & Pick<ConvergenceEdge, 'to' | 'magnitude'>): ConvergenceEdge {
  return {
    from: 'plant',
    source: 'thread',
    anchorId: 'anchor-1',
    ...opts,
  };
}

function ledgerOf(edges: ConvergenceEdge[]): ConvergenceLedger {
  const nodes = Array.from(new Set(edges.flatMap((e) => [e.from, e.to])));
  return { nodes, edges };
}

describe('aggregateCharge', () => {
  it('sums magnitude by destination scene', () => {
    const ledger = ledgerOf([
      edge({ from: 'a', to: 'payoff', magnitude: 0.4 }),
      edge({ from: 'b', to: 'payoff', magnitude: 0.3 }),
      edge({ from: 'c', to: 'other', magnitude: 0.5 }),
    ]);
    const charge = aggregateCharge(ledger);
    expect(charge.get('payoff')).toBeCloseTo(0.7, 10);
    expect(charge.get('other')).toBeCloseTo(0.5, 10);
  });

  it('returns an empty map for a ledger with no edges', () => {
    const charge = aggregateCharge({ nodes: ['x'], edges: [] });
    expect(charge.size).toBe(0);
  });

  it('only includes scenes that have inbound edges', () => {
    const ledger = ledgerOf([edge({ from: 'a', to: 'b', magnitude: 1 })]);
    const charge = aggregateCharge(ledger);
    expect(charge.has('b')).toBe(true);
    expect(charge.has('a')).toBe(false);
  });

  it('is deterministic: same ledger yields the same map', () => {
    const ledger = ledgerOf([
      edge({ from: 'a', to: 'z', magnitude: 0.2, source: 'relationship' }),
      edge({ from: 'b', to: 'z', magnitude: 0.6, source: 'skill', gateLevel: 4, overcomesPriorFailure: true }),
    ]);
    const first = aggregateCharge(ledger);
    const second = aggregateCharge(ledger);
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
    expect(first.get('z')).toBeCloseTo(0.8, 10);
  });
});
