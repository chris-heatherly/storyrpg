import { describe, expect, it } from 'vitest';
import { GATE_DEFAULTS } from './gateDefaults';
import { GATE_REGISTRY, validateGateRegistry, type GateSpec } from './gateRegistry';

describe('gate registry policy (repair-first, CI-enforced)', () => {
  it('the live registry is compliant with GATE_DEFAULTS — completeness, no drift, repair-first', () => {
    const violations = validateGateRegistry(GATE_DEFAULTS);
    // Print the violations on failure so the fix is obvious from CI output.
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it('flags an unregistered gate (a new flag cannot ship unclassified)', () => {
    const violations = validateGateRegistry({ ...GATE_DEFAULTS, GATE_BRAND_NEW_THING: true });
    expect(violations.some((v) => v.gateId === 'GATE_BRAND_NEW_THING' && v.problem.includes('not registered'))).toBe(true);
  });

  it('flags defaultOn drift between registry and GATE_DEFAULTS', () => {
    const flipped = { ...GATE_DEFAULTS, GATE_REQUIRED_BEAT_REALIZATION: false };
    const violations = validateGateRegistry(flipped);
    expect(violations.some((v) => v.gateId === 'GATE_REQUIRED_BEAT_REALIZATION' && v.problem.includes('drift'))).toBe(true);
  });

  it('the repair-first rule fires for a default-ON blocking season-final gate without repair or exception', () => {
    const offender: GateSpec = { id: 'GATE_TEST_OFFENDER', placement: 'season-final', kind: 'blocking', defaultOn: true };
    GATE_REGISTRY.push(offender);
    try {
      const violations = validateGateRegistry({ ...GATE_DEFAULTS, GATE_TEST_OFFENDER: true });
      expect(violations.some((v) => v.gateId === 'GATE_TEST_OFFENDER' && v.problem.includes('repair-first policy'))).toBe(true);
    } finally {
      GATE_REGISTRY.pop();
    }
  });

  it('does NOT fire the repair-first rule for plan/scene/episode placements or shadow (defaultOn=false) gates', () => {
    const planGate: GateSpec = { id: 'GATE_TEST_PLAN', placement: 'plan', kind: 'blocking', defaultOn: true };
    const shadowGate: GateSpec = { id: 'GATE_TEST_SHADOW', placement: 'season-final', kind: 'blocking', defaultOn: false };
    GATE_REGISTRY.push(planGate, shadowGate);
    try {
      const violations = validateGateRegistry({ ...GATE_DEFAULTS, GATE_TEST_PLAN: true, GATE_TEST_SHADOW: false });
      expect(violations.filter((v) => v.gateId.startsWith('GATE_TEST_'))).toEqual([]);
    } finally {
      GATE_REGISTRY.pop();
      GATE_REGISTRY.pop();
    }
  });

  it('every policy exception is substantive and names a planned fix', () => {
    const exceptions = GATE_REGISTRY.filter((g) => g.policyException);
    // Exceptions are allowed but must stay rare and explicit.
    expect(exceptions.length).toBeLessThanOrEqual(4);
    for (const g of exceptions) {
      expect(g.policyException!.length).toBeGreaterThanOrEqual(40);
      expect(g.policyException).toMatch(/Planned fix/);
    }
  });
});
