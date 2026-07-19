import { describe, expect, it } from 'vitest';
import {
  ABORT_CLASS_BY_ISSUE_TYPE,
  CORE_ABORT_GROUP_CEILING,
  applyFinalContractAbortTriage,
  coreAbortGroupCount,
  resolveFinalContractAbortClass,
  type TriagableIssue,
} from './finalContractAbortPolicy';

describe('finalContractAbortPolicy (the ≤15 blocking set)', () => {
  it('keeps the core abort surface within the audit ceiling', () => {
    // The compounding-gate math only improves if the core stays SMALL. Growing
    // this number is a policy decision, not a code change — it requires the
    // same shadow-evidence bar as any blocking promotion.
    expect(coreAbortGroupCount()).toBeLessThanOrEqual(CORE_ABORT_GROUP_CEILING);
  });

  it('classifies the audit-named core classes as core', () => {
    // Structural/graph, stub/leak prose, POV — the four classes the
    // reliability audit names as genuinely unshippable.
    for (const type of [
      'broken_navigation',
      'beat_id_collision',
      'missing_requested_episode',
      'empty_scene',
      'placeholder_scene',
      'unsafe_fallback_prose',
      'outcome_text_stub',
      'planning_register_prose',
      'echo_summary_variant',
      'pov_break',
      'encounter_pov_break',
      'pov_anchor_missing',
    ] as const) {
      expect(ABORT_CLASS_BY_ISSUE_TYPE[type], type).toBe('core');
    }
  });

  it('classifies the fidelity/craft/ledger surface as ship_with_cap', () => {
    // The demotion targets: the family that dominates real firing volume
    // (49k+ shadow findings) and the recorded run-killers that are quality
    // defects, not unshippable ones.
    for (const type of [
      'treatment_field_utilization_violation',
      'treatment_event_ledger_violation',
      'season_promise_realization_violation',
      'character_treatment_realization_violation',
      'scene_turn_realization_violation',
      'duplicate_high_pressure_event',
      'scene_location_event_mismatch',
      'continuity_error',
      'route_duplicate_event',
      'unset_flag_condition',
      'npc_pronoun_inconsistency',
      'sentence_opener_monotony',
    ] as const) {
      expect(ABORT_CLASS_BY_ISSUE_TYPE[type], type).toBe('ship_with_cap');
    }
  });

  it('escalates semantic findings with forbidden atoms to core, missing-only to ship_with_cap', () => {
    // The deferredRealization asymmetry: presence of forbidden meaning on the
    // page is unshippable; absence of required meaning is a quality defect
    // (and the single most common recorded run-killer: SEMANTIC_REALIZATION_
    // MISSING, 18 of 47 tracked failures).
    expect(resolveFinalContractAbortClass({
      type: 'semantic_realization_violation',
      matchedForbiddenAtoms: ['event:ep1-u3:forbidden:1'],
    })).toBe('core');
    expect(resolveFinalContractAbortClass({
      type: 'semantic_realization_violation',
      missingEvidenceAtoms: ['event:ep1-u3:semantic:2'],
    } as never)).toBe('ship_with_cap');
    expect(resolveFinalContractAbortClass({
      type: 'semantic_realization_violation',
      matchedForbiddenAtoms: [],
    })).toBe('ship_with_cap');
  });

  it('splits qa_blocker_present by emitting validator: mechanics leaks core, QA aggregates capped', () => {
    expect(resolveFinalContractAbortClass({
      type: 'qa_blocker_present',
      validator: 'MechanicsLeakageValidator',
    })).toBe('core');
    expect(resolveFinalContractAbortClass({
      type: 'qa_blocker_present',
      validator: 'QARunner',
    })).toBe('ship_with_cap');
  });

  it('fails closed on unknown issue types', () => {
    // A future check that never got classified must abort, not silently ship.
    expect(resolveFinalContractAbortClass({ type: 'some_future_unclassified_type' })).toBe('core');
  });
});

describe('applyFinalContractAbortTriage', () => {
  const issue = (type: string, extra: Partial<TriagableIssue> = {}): TriagableIssue =>
    ({ type, severity: 'error', ...extra } as TriagableIssue);

  it('demotes non-core-only residue to tagged warnings and passes the report', () => {
    // Reconstructs the r117/r118 shape: unrepaired fidelity/craft residue was
    // the whole abort. Under triage the run ships with the defects recorded.
    const report = {
      passed: false,
      blockingIssues: [
        issue('duplicate_high_pressure_event'),
        issue('treatment_event_ledger_violation'),
        issue('semantic_realization_violation', { missingEvidenceAtoms: ['event:ep1-u3:semantic:2'] }),
      ],
      warnings: [issue('sentence_opener_monotony', { severity: 'warning' })],
    };

    const result = applyFinalContractAbortTriage(report, { strict: false });

    expect(result.demotedCount).toBe(3);
    expect(report.passed).toBe(true);
    expect(report.blockingIssues).toEqual([]);
    expect(report.warnings).toHaveLength(4);
    const demoted = report.warnings!.filter((w) => w.demotedFromBlocking);
    expect(demoted).toHaveLength(3);
    for (const w of demoted) expect(w.severity).toBe('warning');
    // The pre-existing warning is untouched.
    expect(report.warnings!.find((w) => w.type === 'sentence_opener_monotony')?.demotedFromBlocking).toBeUndefined();
  });

  it('still aborts when any core-class residue remains — mixed residue is not demoted', () => {
    const report = {
      passed: false,
      blockingIssues: [
        issue('treatment_event_ledger_violation'),
        issue('broken_navigation'),
      ],
      warnings: [],
    };

    const result = applyFinalContractAbortTriage(report, { strict: false });

    expect(result.demotedCount).toBe(0);
    expect(result.coreResidueTypes).toEqual(['broken_navigation']);
    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toHaveLength(2);
  });

  it('escalates forbidden-atom semantic residue to a core abort', () => {
    const report = {
      passed: false,
      blockingIssues: [
        issue('semantic_realization_violation', { matchedForbiddenAtoms: ['event:ep1:forbidden:1'] }),
      ],
      warnings: [],
    };

    const result = applyFinalContractAbortTriage(report, { strict: false });

    expect(result.coreResidueTypes).toEqual(['semantic_realization_violation']);
    expect(report.passed).toBe(false);
  });

  it('strict mode (GATE_STRICT_CONTRACT) leaves the report untouched', () => {
    const report = {
      passed: false,
      blockingIssues: [issue('duplicate_high_pressure_event')],
      warnings: [],
    };

    const result = applyFinalContractAbortTriage(report, { strict: true });

    expect(result.demotedCount).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toHaveLength(1);
  });

  it('is a no-op on an already-passing report', () => {
    const report = { passed: true, blockingIssues: [], warnings: [] };
    const result = applyFinalContractAbortTriage(report, { strict: false });
    expect(result.demotedCount).toBe(0);
    expect(report.passed).toBe(true);
  });
});
