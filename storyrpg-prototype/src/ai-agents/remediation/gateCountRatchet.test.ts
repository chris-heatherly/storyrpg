/**
 * Blocking-gate count ratchet (R5 of the 2026-07-06 reliability plan).
 *
 * FINDING (pipeline-reliability review): the pipeline runs LLM output through
 * a serial gauntlet of blocking gates, and the dominant historical fix for a
 * new failure class was ADDING another gate — which grows the failure surface
 * and compounds run-abort probability (observed run success ~22%). Like the
 * monolith-size ratchet, this test freezes the count: it may go DOWN
 * (consolidating detectors into existing final-contract validators with
 * repair routes), but a change that grows it fails CI.
 *
 * If you are adding a new failure class:
 *  1. Fold detection into an EXISTING final-contract validator (new issue
 *     type, not a new gate), give it a router rule + repair handler, and add
 *     the class to repairRouteCoverage.test.ts.
 *  2. If a new flag is genuinely unavoidable, retire or consolidate a
 *     blocking gate in the same change so the count does not grow — or make
 *     the new gate 'soft'/'remediation'/'infra' (those are not ratcheted).
 */

import { describe, expect, it } from 'vitest';
import { GATE_REGISTRY } from './gateRegistry';

// Baselines at ratchet introduction (2026-07-06). Lower is better.
const MAX_BLOCKING_GATES = 62;
const MAX_DEFAULT_ON_BLOCKING_GATES = 43;

describe('blocking-gate count ratchet', () => {
  it(`registers at most ${MAX_BLOCKING_GATES} blocking gates (consolidate, do not accrete)`, () => {
    const blocking = GATE_REGISTRY.filter((gate) => gate.kind === 'blocking');
    expect(
      blocking.length,
      `Blocking gate count grew past the ratchet (${blocking.length} > ${MAX_BLOCKING_GATES}). ` +
      'Fold the new failure class into an existing final-contract validator with a repair route ' +
      '(see repairRouteCoverage.test.ts) instead of adding an abort door — or retire a gate in the same change.',
    ).toBeLessThanOrEqual(MAX_BLOCKING_GATES);
  });

  it(`enables at most ${MAX_DEFAULT_ON_BLOCKING_GATES} blocking gates by default`, () => {
    const defaultOnBlocking = GATE_REGISTRY.filter((gate) => gate.kind === 'blocking' && gate.defaultOn);
    expect(
      defaultOnBlocking.length,
      `Default-ON blocking gate count grew past the ratchet (${defaultOnBlocking.length} > ${MAX_DEFAULT_ON_BLOCKING_GATES}).`,
    ).toBeLessThanOrEqual(MAX_DEFAULT_ON_BLOCKING_GATES);
  });

  it('documents the current counts so intentional reductions update the baseline', () => {
    const blocking = GATE_REGISTRY.filter((gate) => gate.kind === 'blocking');
    const defaultOn = blocking.filter((gate) => gate.defaultOn);
    // When these drop, lower the MAX_* constants above to lock in the win.
    expect(blocking.length).toBeGreaterThan(0);
    expect(defaultOn.length).toBeGreaterThan(0);
  });
});
