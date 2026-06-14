/**
 * Gate registry (refactor R7, 2026-06-11 — phase 4 of the pipeline
 * decomposition; codifies the repair-first policy from the failure-cycle audit).
 *
 * Every quality gate is registered with WHERE it runs (placement), WHAT it is
 * (kind), and HOW a hit gets fixed (repair). The promotion policy that was
 * previously discipline ("a gate may only block at the season-final contract
 * if it has a repair handler, an autofix, or judge confirmation") is enforced
 * MECHANICALLY by `validateGateRegistry` + its unit test:
 *
 *   - every GATE_DEFAULTS flag must be registered (a new gate cannot ship
 *     unclassified);
 *   - the registry's `defaultOn` must match GATE_DEFAULTS (no silent drift);
 *   - a default-ON BLOCKING gate at `season-final` placement must declare a
 *     repair route — or carry an explicit, written `policyException` (which
 *     this registry surfaces rather than hides).
 *
 * Rationale: the 2026-06-11 audit found 20 runs (median 73 min each) killed at
 * the final contract by gates with no repair path — including two gates
 * promoted that same morning on offline evidence alone. This registry makes
 * that class of incident a failing unit test instead of a postmortem.
 */

import { GATE_DEFAULTS, isGateEnabled } from './gateDefaults';

/** Where in the run the gate executes. */
export type GatePlacement =
  | 'plan'          // before any prose is generated — blocking here is cheap fail-fast
  | 'scene'         // at scene/encounter generation time — regen is one scene
  | 'episode'       // at episode assembly/seal — regen is one episode's element
  | 'season-final'; // the final contract — a block here costs the whole run

export type GateKind =
  | 'blocking'     // can escalate findings to run-blocking errors when on
  | 'soft'         // advisory/degrade-only; never aborts
  | 'remediation'  // an autofix/regen pass, not a detector
  | 'infra';       // wiring/arming flags (judge, repair loop, shadow plumbing)

export type GateRepair =
  | 'autofix'       // deterministic in-place fix
  | 'regen'         // LLM regeneration route wired
  | 'judge'         // LLM judge confirmation before blocking
  | 'judge+regen';  // both: judge filters false positives, regen fixes confirmed hits

export interface GateSpec {
  id: string;
  placement: GatePlacement;
  kind: GateKind;
  /** Mirror of GATE_DEFAULTS[id]; drift-checked by validateGateRegistry. */
  defaultOn: boolean;
  /** How a hit gets fixed. Required for default-ON blocking season-final gates. */
  repair?: GateRepair;
  /**
   * Written justification for violating the repair-first policy. Presence
   * makes the violation EXPLICIT and auditable instead of failing the test;
   * each exception should name its planned fix.
   */
  policyException?: string;
}

export const GATE_REGISTRY: GateSpec[] = [
  // ── Wave 1: deterministic in-place autofixes (episode assembly) ──
  { id: 'GATE_NPC_DEPTH', placement: 'episode', kind: 'remediation', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_CHOICE_IMPACT', placement: 'episode', kind: 'remediation', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_STAT_CHECK_BALANCE', placement: 'episode', kind: 'remediation', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_ARC_DELTA', placement: 'episode', kind: 'remediation', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_MECHANICS_LEAKAGE', placement: 'episode', kind: 'remediation', defaultOn: true, repair: 'autofix' },

  // ── Wave 2: correctness hard-gates ──
  { id: 'GATE_WITNESS_ID_INTEGRITY', placement: 'episode', kind: 'blocking', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_RELATIONSHIP_ID_INTEGRITY', placement: 'episode', kind: 'blocking', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_WITNESS_SCENE_PRESENCE', placement: 'episode', kind: 'blocking', defaultOn: true, repair: 'autofix' },
  {
    id: 'GATE_DESIGN_NOTE_LEAK', placement: 'season-final', kind: 'blocking', defaultOn: true,
    policyException:
      'Deterministic detector with a zero-false-positive shadow profile (2026-06-06 corpus); a design-note leak is an unshippable fiction-first violation. Planned fix: add meta-narration stripping to the scene-prose repair handler so hits repair instead of aborting.',
  },

  // ── Wave 3: bounded LLM soft-gates (never abort) ──
  { id: 'GATE_JUDGE_STABILIZATION', placement: 'episode', kind: 'soft', defaultOn: true },
  { id: 'GATE_CLIFFHANGER', placement: 'episode', kind: 'soft', defaultOn: true },

  // ── Repair / judge infrastructure (the routes other gates rely on) ──
  { id: 'GATE_SCENE_REQUIRED_BEAT_CHECK', placement: 'scene', kind: 'remediation', defaultOn: true, repair: 'regen' },
  { id: 'GATE_FINAL_CONTRACT_REPAIR', placement: 'season-final', kind: 'infra', defaultOn: true },
  { id: 'GATE_FINAL_CONTRACT_SCENE_REGEN', placement: 'season-final', kind: 'infra', defaultOn: true },
  { id: 'GATE_FINAL_CONTRACT_OUTCOME_REGEN', placement: 'season-final', kind: 'infra', defaultOn: true },
  { id: 'GATE_FIDELITY_JUDGE_CONFIRM', placement: 'season-final', kind: 'infra', defaultOn: true },
  { id: 'GATE_RECONVERGENCE_RESIDUE_REPAIR', placement: 'episode', kind: 'remediation', defaultOn: true, repair: 'regen' },
  { id: 'GATE_TREATMENT_SOURCED_ARM', placement: 'season-final', kind: 'infra', defaultOn: true },

  // ── Wave 4: plan-time gates (blocking is cheap fail-fast before prose) ──
  { id: 'GATE_SETUP_PAYOFF', placement: 'plan', kind: 'blocking', defaultOn: true },
  { id: 'GATE_CALLBACK_COVERAGE', placement: 'plan', kind: 'blocking', defaultOn: true },
  { id: 'GATE_CHOICE_DENSITY', placement: 'plan', kind: 'blocking', defaultOn: true },
  { id: 'GATE_CONSEQUENCE_BUDGET', placement: 'plan', kind: 'blocking', defaultOn: true },
  { id: 'GATE_PROP_INTRODUCTION', placement: 'plan', kind: 'blocking', defaultOn: false, repair: 'autofix' },
  { id: 'GATE_CHOICE_DISTRIBUTION', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_ARC_PRESSURE', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_BRANCH_FANOUT', placement: 'plan', kind: 'blocking', defaultOn: true },
  { id: 'GATE_TREATMENT_SEED_ONPAGE', placement: 'plan', kind: 'blocking', defaultOn: true },

  // ── Wave 5: final-contract-class gates ──
  { id: 'GATE_DUPLICATE_ESTABLISHING_BEAT', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_PROTAGONIST_PRONOUN', placement: 'season-final', kind: 'blocking', defaultOn: false, repair: 'regen' },
  { id: 'GATE_NPC_PRONOUN', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_OUTCOME_TEXT_QUALITY', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_SENTENCE_OPENER_VARIETY', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_ENCOUNTER_SETPIECE_DEPTH', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_REFERENCED_EVENT_PRESENCE', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_REQUIRED_BEAT_REALIZATION', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'judge+regen' },
  { id: 'GATE_SCENE_TRANSITION_CONTINUITY', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_CHARACTER_INTRODUCTION', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_CHOICE_TYPE_CONFORMANCE', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_SKILL_PLAN_CONFORMANCE', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_FLAG_CONTRACT', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_WITNESS_BAKE', placement: 'episode', kind: 'remediation', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_ENCOUNTER_OUTCOME_VARIANT', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_CONTINUITY_REMEDIATION', placement: 'episode', kind: 'remediation', defaultOn: false, repair: 'regen' },
  { id: 'GATE_QA_CRITICAL_BLOCK', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_ENDING_REACHABILITY', placement: 'season-final', kind: 'blocking', defaultOn: false },

  // ── §4 treatment-fidelity dispatch ──
  // WS1 (2026-06-12): relocated from season-final to plan placement — the
  // validator's inputs are plan-vs-treatment only, so a mismatch now fails
  // before any generation is spent (runPlanTimeFidelityChecks). The
  // season-final dispatch remains as a regression net for mid-run plan drift.
  { id: 'GATE_AUTHORED_EPISODE_CONFORMANCE', placement: 'plan', kind: 'blocking', defaultOn: true },
  {
    id: 'GATE_ENCOUNTER_ANCHOR_CONTENT', placement: 'season-final', kind: 'blocking', defaultOn: true,
    policyException:
      'Encounter-scene prose realization; the scene-prose repair handler currently skips encounter scenes. Planned fix: extend the judge-confirmation set + add an encounter-regen repair route, then drop this exception.',
  },
  { id: 'GATE_INFORMATION_LEDGER_SCHEDULE', placement: 'season-final', kind: 'blocking', defaultOn: false },
  { id: 'GATE_SIGNATURE_DEVICE_PRESENCE', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'judge+regen' },
  // WS1 (2026-06-12): relocated from season-final to plan placement — anchors
  // are fully known before generation (see GATE_AUTHORED_EPISODE_CONFORMANCE).
  { id: 'GATE_SEVEN_POINT_ANCHOR_CONFORMANCE', placement: 'plan', kind: 'blocking', defaultOn: true },
  { id: 'GATE_SIGNATURE_PRESENCE_STRICT', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'judge+regen' },
];

/** All registered gates that execute at the given placement. */
export function gatesAtPlacement(placement: GatePlacement): GateSpec[] {
  return GATE_REGISTRY.filter((g) => g.placement === placement);
}

const placementWarned = new Set<string>();

/**
 * Placement-aware gate check (adoption A6 — the registry's runtime teeth).
 *
 * Use this where a gate's check/enforcement EXECUTES, declaring the placement
 * of the call site. Enablement resolution is identical to `isGateEnabled`
 * (env override > rolled-out default) — behavior never changes — but when an
 * ENABLED gate executes somewhere other than its registered placement, a
 * one-shot console.warn surfaces the drift (mis-registered registry entry, or
 * a gate that quietly moved). Disabled gates never warn: their placement is
 * moot at runtime.
 *
 * Sites that merely CONSULT another placement's flag (e.g. the season-final
 * contract asking whether the episode-level continuity remediation is armed
 * to decide escalation) should keep plain `isGateEnabled`.
 */
export function isGateEnabledAt(flag: string, placement: GatePlacement): boolean {
  const enabled = isGateEnabled(flag);
  if (!enabled) return false;
  const key = `${flag}@${placement}`;
  if (!placementWarned.has(key)) {
    const spec = GATE_REGISTRY.find((g) => g.id === flag);
    if (!spec) {
      placementWarned.add(key);
      console.warn(`[gateRegistry] Gate "${flag}" executed at "${placement}" but is not in GATE_REGISTRY — classify it before shipping.`);
    } else if (spec.placement !== placement) {
      placementWarned.add(key);
      console.warn(`[gateRegistry] Gate "${flag}" executed at "${placement}" but is registered at "${spec.placement}" — fix the registry entry or the call site.`);
    }
  }
  return enabled;
}

/** Test hook: clear the one-shot placement-drift warning latch. */
export function resetGatePlacementWarnings(): void {
  placementWarned.clear();
}

export interface GateRegistryViolation {
  gateId: string;
  problem: string;
}

/**
 * Enforce registry completeness, default-drift, and the repair-first policy.
 * Returns violations (empty = compliant). The unit test pins this to
 * GATE_DEFAULTS so CI fails the moment a gate ships unregistered, drifts from
 * its registered default, or goes default-ON blocking at season-final without
 * a repair route or a written exception.
 */
export function validateGateRegistry(defaults: Record<string, boolean> = GATE_DEFAULTS): GateRegistryViolation[] {
  const violations: GateRegistryViolation[] = [];
  const registered = new Map(GATE_REGISTRY.map((g) => [g.id, g]));

  for (const id of Object.keys(defaults)) {
    if (!registered.has(id)) {
      violations.push({ gateId: id, problem: 'present in GATE_DEFAULTS but not registered — classify it (placement/kind/repair) before shipping' });
    }
  }
  for (const spec of GATE_REGISTRY) {
    if (!(spec.id in defaults)) {
      violations.push({ gateId: spec.id, problem: 'registered but missing from GATE_DEFAULTS — stale registry entry' });
      continue;
    }
    if (defaults[spec.id] !== spec.defaultOn) {
      violations.push({ gateId: spec.id, problem: `defaultOn drift: registry says ${spec.defaultOn}, GATE_DEFAULTS says ${defaults[spec.id]} — update both together` });
    }
    if (spec.policyException !== undefined && spec.policyException.trim().length < 40) {
      violations.push({ gateId: spec.id, problem: 'policyException must be a substantive written rationale (>= 40 chars) naming the planned fix' });
    }
    const violatesRepairFirst =
      spec.kind === 'blocking' && spec.defaultOn && spec.placement === 'season-final' && !spec.repair && !spec.policyException;
    if (violatesRepairFirst) {
      violations.push({
        gateId: spec.id,
        problem: 'repair-first policy: a default-ON blocking gate at season-final must declare a repair route (autofix/regen/judge) or carry a written policyException',
      });
    }
  }
  return violations;
}
