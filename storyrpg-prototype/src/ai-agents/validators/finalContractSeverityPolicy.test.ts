import { afterEach, describe, expect, it } from 'vitest';

import { resolveFinalContractSeverity } from './finalContractSeverityPolicy';

// Direct tests for the single error-vs-warning chokepoint of the final
// contract (audit 2026-07-01 item 4.5/M12 — it had no dedicated tests, and its
// unconditional craft_critic downgrade was undocumented behavior).

afterEach(() => {
  delete process.env.GATE_RELATIONSHIP_PACING;
  delete process.env.GATE_RELATIONSHIP_ARC_LEDGER;
});

describe('resolveFinalContractSeverity', () => {
  it('never escalates a warning-severity finding', () => {
    expect(
      resolveFinalContractSeverity({ requestedSeverity: 'warning', findingClass: 'runtime_contract' }),
    ).toBe('warning');
  });

  it('runtime_contract errors always block', () => {
    expect(
      resolveFinalContractSeverity({ requestedSeverity: 'error', findingClass: 'runtime_contract' }),
    ).toBe('error');
  });

  it('craft_critic and shadow_advisory are ALWAYS downgraded to warning — even at error severity', () => {
    // Deliberate policy: craft judgments never abort a run on their own, no
    // matter which gate emitted them. Documented here because gates registered
    // as "blocking" that emit through the craft_critic class can therefore
    // never actually block via this path (e.g. the
    // GATE_FAILURE_MODE_AUDIT_REALIZATION fallback class).
    expect(
      resolveFinalContractSeverity({ requestedSeverity: 'error', findingClass: 'craft_critic' }),
    ).toBe('warning');
    expect(
      resolveFinalContractSeverity({ requestedSeverity: 'error', findingClass: 'shadow_advisory' }),
    ).toBe('warning');
  });

  it('authored_contract blocks only when treatment-sourced WITH a concrete obligation', () => {
    expect(
      resolveFinalContractSeverity({
        requestedSeverity: 'error',
        findingClass: 'authored_contract',
        treatmentSourced: true,
        repairTarget: { sceneId: 's1-2' },
      }),
    ).toBe('error');
    // Treatment-sourced but nothing concrete to repair against → warning.
    expect(
      resolveFinalContractSeverity({
        requestedSeverity: 'error',
        findingClass: 'authored_contract',
        treatmentSourced: true,
        sourceKind: 'heuristic',
      }),
    ).toBe('warning');
    // Not treatment-sourced → warning regardless of target.
    expect(
      resolveFinalContractSeverity({
        requestedSeverity: 'error',
        findingClass: 'authored_contract',
        treatmentSourced: false,
        repairTarget: { sceneId: 's1-2' },
      }),
    ).toBe('warning');
  });

  it('authored_contract treats treatment/plan sourceKind as concrete', () => {
    expect(
      resolveFinalContractSeverity({
        requestedSeverity: 'error',
        findingClass: 'authored_contract',
        treatmentSourced: true,
        sourceKind: 'treatment',
      }),
    ).toBe('error');
  });

  it('repairable_contract blocks only when its gate is ON and declares repair/exception', () => {
    // GATE_RELATIONSHIP_ARC_LEDGER is registered default-ON with repair: 'regen'.
    // (GATE_RELATIONSHIP_PACING, the previous example here, merged into it and
    // is shadowed default-OFF as of 2026-07-02.)
    expect(
      resolveFinalContractSeverity({
        requestedSeverity: 'error',
        findingClass: 'repairable_contract',
        gateId: 'GATE_RELATIONSHIP_ARC_LEDGER',
      }),
    ).toBe('error');
    // Same finding with the gate forced OFF → downgraded.
    process.env.GATE_RELATIONSHIP_ARC_LEDGER = '0';
    expect(
      resolveFinalContractSeverity({
        requestedSeverity: 'error',
        findingClass: 'repairable_contract',
        gateId: 'GATE_RELATIONSHIP_ARC_LEDGER',
      }),
    ).toBe('warning');
    // No gate at all → downgraded.
    expect(
      resolveFinalContractSeverity({
        requestedSeverity: 'error',
        findingClass: 'repairable_contract',
      }),
    ).toBe('warning');
  });
});
