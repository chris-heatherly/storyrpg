/**
 * Abort-class taxonomy for the final contract (reliability audit Phase 2, the
 * "≤15 blocking set" tranche, 2026-07-18).
 *
 * Pass rate is arithmetic: ~300-500 blocking check applications per run means
 * 0.995^400 ≈ 13% — the observed success rate. This module splits unrepaired
 * final-contract residue into a small CORE of genuinely unshippable classes
 * (still aborts) and everything else (ships with a quality-score cap). The
 * triage happens at the ABORT DECISION, after the repair loop fully exhausts —
 * detection and repair behavior are untouched; findings stay blocking through
 * every repair round so repair still triggers. Only the final disposition of
 * what repair could not fix changes.
 *
 * CORE follows the audit's four named classes — structural integrity,
 * reader-safety (placeholder/stub/fallback prose + design leaks), POV
 * corruption, graph reachability — plus the established semantic asymmetry
 * (deferredRealization.ts): PRESENCE of forbidden meaning on the page is
 * critical; ABSENCE of required meaning is a quality defect, not an
 * unshippable one.
 *
 * The ≤15 ceiling is counted over CORE GROUPS (coherent defect classes), not
 * individual issue-type literals; the completeness test in
 * finalContractAbortPolicy.test.ts enforces both the ceiling and table
 * exhaustiveness (a new FinalStoryContractIssueType member fails to compile
 * until classified here).
 */

import type {
  FinalStoryContractIssueType,
} from './FinalStoryContractValidator';

export type FinalContractAbortClass = 'core' | 'ship_with_cap';

/** Coherent unshippable-defect classes; the audit's ≤15 ceiling counts these. */
export type CoreAbortGroup =
  | 'graph_integrity'      // navigation/routing/id corruption — the runtime cannot traverse it correctly
  | 'missing_content'      // whole episodes/encounters absent or unplayable
  | 'stub_prose'           // placeholder/template/fallback text shipped as story
  | 'malformed_prose'      // mechanically broken reader-facing text
  | 'design_leak'          // planning/mechanics/design notes visible to the player
  | 'pov_collapse'         // second-person contract broken
  | 'forbidden_meaning';   // a semantic atom the contract FORBIDS is present on the page

const CORE_GROUP_BY_TYPE: Partial<Record<FinalStoryContractIssueType, CoreAbortGroup>> = {
  // graph_integrity
  broken_navigation: 'graph_integrity',
  routing_contradiction: 'graph_integrity',
  beat_id_collision: 'graph_integrity',
  choice_bridge_skips_required_setup: 'graph_integrity',
  choice_bridge_sibling_leak: 'graph_integrity',
  // missing_content
  missing_requested_episode: 'missing_content',
  partial_season_scope: 'missing_content',
  missing_runtime_encounter: 'missing_content',
  invalid_encounter: 'missing_content',
  // stub_prose
  empty_scene: 'stub_prose',
  empty_encounter_scene: 'stub_prose',
  placeholder_scene: 'stub_prose',
  outcome_text_stub: 'stub_prose',
  unsafe_fallback_prose: 'stub_prose',
  encounter_template_collapse: 'stub_prose',
  // malformed_prose
  encounter_malformed_prose: 'malformed_prose',
  encounter_prose_integrity: 'malformed_prose',
  // design_leak (qa_blocker_present joins via the validator special case below)
  echo_summary_variant: 'design_leak',
  planning_register_prose: 'design_leak',
  // pov_collapse
  pov_break: 'pov_collapse',
  encounter_pov_break: 'pov_collapse',
  pov_anchor_missing: 'pov_collapse',
  ambiguous_protagonist_pronoun: 'pov_collapse',
  // forbidden_meaning (semantic_realization_violation joins via the
  // matchedForbiddenAtoms special case below — the type alone is not core)
};

/**
 * Exhaustive classification. Compiler-checked: adding a member to
 * FinalStoryContractIssueType without classifying it here fails the build.
 * Types with a core group above are 'core'; every fidelity/craft/pacing/
 * ledger/continuity class ships with a cap.
 */
export const ABORT_CLASS_BY_ISSUE_TYPE: Record<FinalStoryContractIssueType, FinalContractAbortClass> = {
  empty_scene: 'core',
  empty_encounter_scene: 'core',
  placeholder_scene: 'core',
  invalid_encounter: 'core',
  missing_runtime_encounter: 'core',
  broken_navigation: 'core',
  routing_contradiction: 'core',
  choice_bridge_skips_required_setup: 'core',
  choice_count_contract: 'ship_with_cap',
  supernatural_canon_contradiction: 'ship_with_cap',
  beat_id_collision: 'core',
  encounter_template_collapse: 'core',
  encounter_malformed_prose: 'core',
  encounter_one_click_win: 'ship_with_cap',
  encounter_clock_coverage_gap: 'ship_with_cap',
  missing_requested_episode: 'core',
  failed_incremental_validation: 'ship_with_cap',
  unrepaired_callback_debt: 'ship_with_cap',
  callback_opportunity_advisory: 'ship_with_cap',
  planned_residue_debt: 'ship_with_cap',
  obligation_ledger_debt: 'ship_with_cap',
  source_role_mismatch: 'ship_with_cap',
  partial_season_scope: 'core',
  treatment_fidelity_violation: 'ship_with_cap',
  ambiguous_protagonist_pronoun: 'core',
  npc_pronoun_inconsistency: 'ship_with_cap',
  outcome_text_stub: 'core',
  echo_summary_variant: 'core',
  planning_register_prose: 'core',
  prose_style_violation: 'ship_with_cap',
  unset_flag_condition: 'ship_with_cap',
  promised_clue_absent: 'ship_with_cap',
  choice_type_plan_nonconformance: 'ship_with_cap',
  consequence_tier_plan_nonconformance: 'ship_with_cap',
  skill_plan_nonconformance: 'ship_with_cap',
  sentence_opener_monotony: 'ship_with_cap',
  encounter_prose_integrity: 'core',
  encounter_pov_break: 'core',
  pov_break: 'core',
  pov_anchor_missing: 'core',
  protagonist_as_npc: 'ship_with_cap',
  encounter_outcome_desync: 'ship_with_cap',
  continuity_error: 'ship_with_cap',
  transition_continuity_violation: 'ship_with_cap',
  scene_turn_realization_violation: 'ship_with_cap',
  // Special-cased in resolveFinalContractAbortClass: forbidden atoms present
  // escalate to core; missing-only atoms (the #1 recorded run-killer) ship
  // with a cap per audit Phase 2 item 4.
  semantic_realization_violation: 'ship_with_cap',
  mechanic_pressure_violation: 'ship_with_cap',
  treatment_field_utilization_violation: 'ship_with_cap',
  treatment_event_ledger_violation: 'ship_with_cap',
  season_promise_realization_violation: 'ship_with_cap',
  character_treatment_realization_violation: 'ship_with_cap',
  narrative_failure_mode_violation: 'ship_with_cap',
  duplicate_high_pressure_event: 'ship_with_cap',
  scene_location_event_mismatch: 'ship_with_cap',
  route_chronology_violation: 'ship_with_cap',
  choice_bridge_sibling_leak: 'core',
  route_duplicate_event: 'ship_with_cap',
  unsafe_fallback_prose: 'core',
  role_fidelity_violation: 'ship_with_cap',
  // Special-cased below: MechanicsLeakageValidator emissions are design leaks
  // (core); QARunner/best-practices aggregates are craft signals.
  qa_blocker_present: 'ship_with_cap',
};

export interface AbortClassifiableIssue {
  type: FinalStoryContractIssueType | string;
  validator?: string;
  matchedForbiddenAtoms?: string[];
}

/**
 * The abort-time triage decision. Fail-closed: an unknown type (future drift,
 * merged sub-validator types not in the union) aborts as core — a new check
 * must be explicitly classified before it can ship-with-cap.
 */
export function resolveFinalContractAbortClass(issue: AbortClassifiableIssue): FinalContractAbortClass {
  if (issue.type === 'semantic_realization_violation') {
    return (issue.matchedForbiddenAtoms?.length ?? 0) > 0 ? 'core' : 'ship_with_cap';
  }
  if (issue.type === 'qa_blocker_present') {
    return issue.validator === 'MechanicsLeakageValidator' ? 'core' : 'ship_with_cap';
  }
  return ABORT_CLASS_BY_ISSUE_TYPE[issue.type as FinalStoryContractIssueType] ?? 'core';
}

/** Distinct core groups — the number the audit's ≤15 ceiling governs. */
export function coreAbortGroupCount(): number {
  const groups = new Set<CoreAbortGroup>(Object.values(CORE_GROUP_BY_TYPE));
  groups.add('forbidden_meaning'); // joins via the semantic special case
  return groups.size;
}

export const CORE_ABORT_GROUP_CEILING = 15;

export interface TriagableIssue extends AbortClassifiableIssue {
  severity: 'error' | 'warning';
  demotedFromBlocking?: boolean;
}

export interface TriagableReport {
  passed: boolean;
  blockingIssues: TriagableIssue[];
  warnings?: TriagableIssue[];
}

export interface AbortTriageResult {
  /** Issues demoted to ship-with-cap warnings this call (0 when the report already passed, strict mode, or core residue forced the abort). */
  demotedCount: number;
  demotedTypes: string[];
  /** Core-class residue that forces the abort; empty when the run ships. */
  coreResidueTypes: string[];
}

/**
 * Abort-time triage: called AFTER the repair loop fully exhausts, never
 * before — findings stay blocking through every repair round so repair
 * behavior is untouched. When no core-class residue remains, the surviving
 * blockers are demoted in place to `demotedFromBlocking` warnings and the
 * report passes; the quality score then caps on them
 * (unrepaired_contract_* in qualityScoring) and the ledger bands off `ship`.
 * With `strict` (GATE_STRICT_CONTRACT=1) the report is left untouched.
 */
export function applyFinalContractAbortTriage(
  report: TriagableReport,
  options: { strict: boolean },
): AbortTriageResult {
  if (report.passed || options.strict) {
    return { demotedCount: 0, demotedTypes: [], coreResidueTypes: [] };
  }
  const coreResidue = report.blockingIssues.filter(
    (issue) => resolveFinalContractAbortClass(issue) === 'core',
  );
  if (coreResidue.length > 0) {
    return {
      demotedCount: 0,
      demotedTypes: [],
      coreResidueTypes: [...new Set(coreResidue.map((issue) => String(issue.type)))],
    };
  }
  const demoted = report.blockingIssues.map((issue) => ({
    ...issue,
    severity: 'warning' as const,
    demotedFromBlocking: true,
  }));
  report.warnings = [...(report.warnings ?? []), ...demoted];
  report.blockingIssues = [];
  report.passed = true;
  return {
    demotedCount: demoted.length,
    demotedTypes: demoted.map((issue) => String(issue.type)),
    coreResidueTypes: [],
  };
}
