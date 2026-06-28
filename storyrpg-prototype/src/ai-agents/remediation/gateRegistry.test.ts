import { afterEach, describe, expect, it, vi } from 'vitest';
import { GATE_DEFAULTS } from './gateDefaults';
import {
  GATE_REGISTRY,
  gateExecutionsAtPlacement,
  gatesAtPlacement,
  isGateEnabledAt,
  qualityGatesAtPlacement,
  resetGatePlacementWarnings,
  validateGateRegistry,
  type GateSpec,
} from './gateRegistry';

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

  it('does NOT treat a season-final regression-net gate as a primary final blocker', () => {
    const regressionNetGate: GateSpec = {
      id: 'GATE_TEST_REGRESSION_NET',
      placement: 'scene',
      auditPlacements: ['season-final'],
      finalRole: 'regression-net',
      kind: 'blocking',
      defaultOn: true,
    };
    GATE_REGISTRY.push(regressionNetGate);
    try {
      const violations = validateGateRegistry({ ...GATE_DEFAULTS, GATE_TEST_REGRESSION_NET: true });
      expect(violations.filter((v) => v.gateId === 'GATE_TEST_REGRESSION_NET')).toEqual([]);
    } finally {
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

describe('isGateEnabledAt (placement-aware execution, adoption A6)', () => {
  afterEach(() => {
    resetGatePlacementWarnings();
    vi.restoreAllMocks();
    delete process.env.GATE_TEST_PLACEMENT_PROBE;
  });

  it('resolves enablement identically to isGateEnabled and stays silent at the registered placement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // GATE_OUTCOME_TEXT_QUALITY: default-ON, primary scene gate.
    expect(isGateEnabledAt('GATE_OUTCOME_TEXT_QUALITY', 'scene')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns ONCE when an enabled gate executes away from its registered placement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isGateEnabledAt('GATE_OUTCOME_TEXT_QUALITY', 'episode')).toBe(true);
    expect(isGateEnabledAt('GATE_OUTCOME_TEXT_QUALITY', 'episode')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('registered at "scene"');
  });

  it('stays silent when an enabled gate executes at an audit placement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isGateEnabledAt('GATE_OUTCOME_TEXT_QUALITY', 'season-final')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never warns for a disabled gate (placement is moot at runtime)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // GATE_NPC_PRONOUN: default-OFF, registered season-final.
    expect(isGateEnabledAt('GATE_NPC_PRONOUN', 'plan')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about an enabled-but-unregistered gate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.GATE_TEST_PLACEMENT_PROBE = '1';
    expect(isGateEnabledAt('GATE_TEST_PLACEMENT_PROBE', 'episode')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('not in GATE_REGISTRY');
  });

  it('gatesAtPlacement enumerates the registered gates for routing', () => {
    const seasonFinal = gatesAtPlacement('season-final').map((g) => g.id);
    expect(seasonFinal).toContain('GATE_ENCOUNTER_OUTCOME_VARIANT');
    expect(seasonFinal).not.toContain('GATE_OUTCOME_TEXT_QUALITY');
    expect(gatesAtPlacement('plan').map((g) => g.id)).toContain('GATE_SETUP_PAYOFF');
    const all = (['plan', 'scene', 'episode', 'season-final'] as const).flatMap((p) => gatesAtPlacement(p));
    expect(all.length).toBe(GATE_REGISTRY.length);
  });

  it('gateExecutionsAtPlacement includes primary and audit execution routes', () => {
    const finalExecutions = gateExecutionsAtPlacement('season-final').map((g) => g.id);
    expect(finalExecutions).toContain('GATE_OUTCOME_TEXT_QUALITY');
    expect(finalExecutions).toContain('GATE_ENCOUNTER_OUTCOME_VARIANT');
    expect(gatesAtPlacement('scene').map((g) => g.id)).toContain('GATE_OUTCOME_TEXT_QUALITY');
  });

  it('quality placement counts exclude repair infrastructure', () => {
    const finalQuality = qualityGatesAtPlacement('season-final').map((g) => g.id);
    expect(finalQuality).toContain('GATE_ENCOUNTER_OUTCOME_VARIANT');
    expect(finalQuality).not.toContain('GATE_FINAL_CONTRACT_REPAIR');
    expect(gatesAtPlacement('season-final').map((g) => g.id)).toContain('GATE_FINAL_CONTRACT_REPAIR');
  });

  it('every gate the final-contract validator enforces is registered for final execution', () => {
    // These are the enforcement sites in FinalStoryContractValidator.ts that
    // execute at season-final. Some are now primary earlier gates with
    // season-final audit placement, so final execution may be primary or audit.
    const enforced = [
      'GATE_ENCOUNTER_POV',
      'GATE_RESIDUE_CONSUME',
      'GATE_ENCOUNTER_SKILL_REBALANCE',
      'GATE_ENCOUNTER_PROSE_INTEGRITY',
      'GATE_PROTAGONIST_PRONOUN',
      'GATE_NPC_PRONOUN',
      'GATE_OUTCOME_TEXT_QUALITY',
      'GATE_PLANNING_REGISTER_PROSE',
      'GATE_PROSE_STYLE_CONSISTENCY',
      'GATE_FLAG_CONTRACT',
      'GATE_DESIGN_NOTE_LEAK',
      'GATE_SENTENCE_OPENER_VARIETY',
      'GATE_REFERENCED_EVENT_PRESENCE',
      'GATE_CHOICE_TYPE_CONFORMANCE',
      'GATE_CONSEQUENCE_TIER_CONFORMANCE',
      'GATE_SKILL_PLAN_CONFORMANCE',
      'GATE_ENCOUNTER_OUTCOME_VARIANT',
      'GATE_QA_CRITICAL_BLOCK',
    ];
    const byId = new Map(GATE_REGISTRY.map((g) => [g.id, g]));
    for (const id of enforced) {
      const spec = byId.get(id);
      expect(
        spec?.placement === 'season-final' || spec?.auditPlacements?.includes('season-final'),
        `${id} final execution route`,
      ).toBe(true);
    }
  });
});
