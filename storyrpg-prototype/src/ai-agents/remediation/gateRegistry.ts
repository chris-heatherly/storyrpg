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

export type GateLifecycle =
  | 'plan-contract'
  | 'scene-contract'
  | 'episode-contract'
  | 'story-contract'
  | 'repair-infra';

export type GateFinalRole =
  | 'primary'
  | 'regression-net'
  | 'repair-router'
  | 'none';

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
  /** Placements where the gate may still execute as an audit/regression net. */
  auditPlacements?: GatePlacement[];
  /** Lifecycle owner for reporting and policy checks. */
  lifecycle?: GateLifecycle;
  /** What role, if any, this gate plays at the final contract. */
  finalRole?: GateFinalRole;
  /** How a hit gets fixed. Required for default-ON blocking season-final gates. */
  repair?: GateRepair;
  /**
   * Written justification for violating the repair-first policy. Presence
   * makes the violation EXPLICIT and auditable instead of failing the test;
   * each exception should name its planned fix.
   */
  policyException?: string;
}

function defaultLifecycle(spec: Pick<GateSpec, 'placement' | 'kind'>): GateLifecycle {
  if (spec.kind === 'infra') return 'repair-infra';
  if (spec.placement === 'plan') return 'plan-contract';
  if (spec.placement === 'scene') return 'scene-contract';
  if (spec.placement === 'episode') return 'episode-contract';
  return 'story-contract';
}

function defaultFinalRole(spec: Pick<GateSpec, 'placement' | 'kind'> & { auditPlacements?: GatePlacement[] }): GateFinalRole {
  if (spec.kind === 'infra') return 'repair-router';
  if (spec.placement === 'season-final') return 'primary';
  return spec.auditPlacements?.includes('season-final') ? 'regression-net' : 'none';
}

function withGateMetadata(spec: GateSpec): GateSpec {
  return {
    ...spec,
    lifecycle: spec.lifecycle ?? defaultLifecycle(spec),
    finalRole: spec.finalRole ?? defaultFinalRole(spec),
  };
}

const RAW_GATE_REGISTRY = [
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
  // echo_summary_variant leaks now REPAIR (buildDesignNoteLeakStripHandler strips the
  // bogus feedback-cue textVariant) instead of aborting — the planned fix the prior
  // policyException referenced is implemented.
  { id: 'GATE_DESIGN_NOTE_LEAK', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'autofix' },

  // ── Wave 3: bounded LLM soft-gates (never abort) ──
  { id: 'GATE_JUDGE_STABILIZATION', placement: 'episode', kind: 'soft', defaultOn: true },
  { id: 'GATE_CLIFFHANGER', placement: 'episode', kind: 'soft', defaultOn: true },

  // ── Repair / judge infrastructure (the routes other gates rely on) ──
  { id: 'GATE_SCENE_REQUIRED_BEAT_CHECK', placement: 'scene', kind: 'remediation', defaultOn: true, repair: 'regen' },
  // Escalation switch for the above: hard-abort the run at scene time when the
  // realization retry still misses (two-tier policy: default is warn + defer
  // to the season-final realization gate's bounded repair).
  { id: 'GATE_SCENE_REALIZATION_ABORT', placement: 'scene', kind: 'blocking', defaultOn: false },
  // No-boilerplate abort split (2026-07-06): controls ONLY the 'template'
  // (EncounterArchitect build-collapse) abort at encounter generation time.
  // Registry-fallback (deterministic-injection) hits never abort — they get
  // the targeted cost-field re-author and defer to the final contract's
  // unsafe_fallback_prose net (repair: encounterCostRepairHandler +
  // scene-prose rewrite).
  { id: 'GATE_ENCOUNTER_TEMPLATE_ABORT', placement: 'scene', kind: 'blocking', defaultOn: true, repair: 'regen' },
  // Scene-time narration-tense check: a scene written wholesale in past tense
  // gets one SceneWriter retry with tense feedback at write time, where the
  // fix costs one scene instead of final-contract repair rounds.
  { id: 'GATE_SCENE_TENSE_CHECK', placement: 'scene', kind: 'remediation', defaultOn: true, repair: 'regen' },
  // Flag-gated SceneCritic rewrite: a targeted critic pass over scenes that
  // failed incremental voice/POV validation or needed a realization retry
  // (criticFlags), capped at 3/episode. Not a detector — cost-bounded polish.
  { id: 'GATE_SCENE_CRITIC_ON_FLAG', placement: 'scene', kind: 'remediation', defaultOn: true, repair: 'regen' },
  { id: 'GATE_CHOICE_OUTCOME_TIER_REAUTHOR', placement: 'scene', kind: 'remediation', defaultOn: true, repair: 'regen' },
  { id: 'GATE_FINAL_CONTRACT_REPAIR', placement: 'season-final', lifecycle: 'repair-infra', finalRole: 'repair-router', kind: 'infra', defaultOn: true },
  // Carry the still-failing contract's repaired candidate across resumes so
  // repair rounds accumulate instead of resetting (fail-open; see gateDefaults).
  { id: 'GATE_REPAIR_CARRYFORWARD', placement: 'season-final', lifecycle: 'repair-infra', finalRole: 'repair-router', kind: 'infra', defaultOn: true },
  { id: 'GATE_FINAL_CONTRACT_SCENE_REGEN', placement: 'season-final', lifecycle: 'repair-infra', finalRole: 'repair-router', kind: 'infra', defaultOn: true },
  { id: 'GATE_FINAL_CONTRACT_OUTCOME_REGEN', placement: 'season-final', lifecycle: 'repair-infra', finalRole: 'repair-router', kind: 'infra', defaultOn: true },
  { id: 'GATE_FIDELITY_JUDGE_CONFIRM', placement: 'season-final', lifecycle: 'repair-infra', finalRole: 'repair-router', kind: 'infra', defaultOn: true },
  { id: 'GATE_ROUTE_RESTAGE_ARBITER', placement: 'season-final', lifecycle: 'repair-infra', finalRole: 'repair-router', kind: 'infra', defaultOn: true },
  { id: 'GATE_RECONVERGENCE_RESIDUE_REPAIR', placement: 'episode', kind: 'remediation', defaultOn: true, repair: 'regen' },
  { id: 'GATE_TREATMENT_SOURCED_ARM', placement: 'season-final', lifecycle: 'repair-infra', finalRole: 'repair-router', kind: 'infra', defaultOn: true },

  // ── Wave 4: plan-time gates (blocking is cheap fail-fast before prose) ──
  { id: 'GATE_SETUP_PAYOFF', placement: 'plan', auditPlacements: ['season-final'], kind: 'blocking', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_CALLBACK_COVERAGE', placement: 'plan', auditPlacements: ['season-final'], kind: 'blocking', defaultOn: true, repair: 'autofix' },
  // R2.1: craft density/budget/pressure demoted from default-ON hard abort →
  // QualityScore / advisory (re-enable via env). No repair route existed.
  { id: 'GATE_CHOICE_DENSITY', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_CONSEQUENCE_BUDGET', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_PROP_INTRODUCTION', placement: 'plan', kind: 'blocking', defaultOn: false, repair: 'autofix' },
  { id: 'GATE_CHOICE_DISTRIBUTION', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_ARC_PRESSURE', placement: 'plan', kind: 'blocking', defaultOn: false },

  // ── 2026-07-01 audit 4.2: formerly unregistered live flags (see gateDefaults) ──
  { id: 'GATE_SEASON_BUDGETS', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_CHARGE_MATERIALIZATION', placement: 'episode', kind: 'blocking', defaultOn: false },
  { id: 'GATE_INTENSITY_DISTRIBUTION', placement: 'scene', kind: 'blocking', defaultOn: false },
  { id: 'GATE_MECHANICS_LEAKAGE_REGEN', placement: 'scene', kind: 'remediation', defaultOn: false, repair: 'regen' },
  { id: 'GATE_REGEN_CHOICES', placement: 'scene', kind: 'remediation', defaultOn: false, repair: 'regen' },
  { id: 'GATE_TREATMENT_FIDELITY', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_THEME_PRESSURE', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_EPISODE_PRESSURE', placement: 'plan', kind: 'blocking', defaultOn: false },
  // R2.1: craft fanout demoted — score/advisory until a plan-repair route lands.
  { id: 'GATE_BRANCH_FANOUT', placement: 'plan', kind: 'blocking', defaultOn: false },
  { id: 'GATE_SCENE_CONSTRUCTION_PREFLIGHT', placement: 'plan', kind: 'blocking', defaultOn: true, repair: 'regen' },
  // Bounded architecture re-run when the SceneConstructionGate blocks content
  // generation (2026-07-07: the gate's error said "Re-run architecture…" but no
  // code path did — one preflight hit hard-aborted the run and discarded the
  // cached analysis + season plan). One StoryArchitect + branch-analysis re-run,
  // then one content retry; a second gate hit still aborts.
  { id: 'GATE_SCENE_CONSTRUCTION_ARCH_RETRY', placement: 'plan', kind: 'remediation', defaultOn: true, repair: 'regen' },
  // Generic-planner-turn re-author (2026-07-07: s1-7's role-scaffold turn was
  // guaranteed to block the final contract, but the defect is blueprint metadata
  // the scene-prose repair loop explicitly skips). Two surfaces, one gate:
  // architecture-time re-author in StoryArchitect (fail-fast, before any prose)
  // and a final-contract turn-contract repair handler (derives the turn from the
  // scene's already-written prose).
  { id: 'GATE_SCENE_TURN_REAUTHOR', placement: 'plan', auditPlacements: ['season-final'], kind: 'remediation', defaultOn: true, repair: 'regen' },
  // Deterministic demote-to-aftermath repair for duplicate-sensitive event
  // ownership on non-encounter-capable scenes (2026-07-04: SceneConstructionGate
  // duplicate-ownership conflicts were the largest hard-abort surface with no
  // retry path on the deterministic planned-blueprint route).
  { id: 'GATE_OWNERSHIP_AFTERMATH_DEMOTION', placement: 'plan', kind: 'remediation', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_TREATMENT_SEED_ONPAGE', placement: 'plan', auditPlacements: ['season-final'], kind: 'blocking', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_DRAMATIC_STRUCTURE', placement: 'plan', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_SCENE_TURN_CONTRACT', placement: 'plan', kind: 'blocking', defaultOn: true, repair: 'regen' },

  // ── Wave 5: final-contract-class gates ──
  { id: 'GATE_DUPLICATE_ESTABLISHING_BEAT', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_PROTAGONIST_PRONOUN', placement: 'season-final', kind: 'blocking', defaultOn: false, repair: 'regen' },
  { id: 'GATE_NPC_PRONOUN', placement: 'season-final', kind: 'blocking', defaultOn: false },
  // WS0.3: deterministic name-anchored coercion (with verb agreement) repairs the break in
  // place, so this is blocking + autofix — residue the coercion can't safely clear (same-gender
  // NPC ambiguity) is reported for the EncounterArchitect regen route.
  { id: 'GATE_ENCOUNTER_POV', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'autofix' },
  // Opening-anchor POV (first prose beat must anchor the player with you/your or
  // {{player.name}}). Moved from the scene-lock gate — where a stale scene-time
  // failure hard-aborted the run with no repair route (2026-07-05T23-54-17) — to
  // the final contract, where a blocking finding routes to a same-scene rewrite.
  { id: 'GATE_POV_ANCHOR', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'regen' },
  // bite-me-g22/g23: malformed second-person encounter prose ("you rooftop",
  // "You kiss takes"). Shadow by default until nested encounter outcome repair
  // can clear the gate without a season-final abort.
  { id: 'GATE_ENCOUNTER_PROSE_INTEGRITY', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: false, repair: 'regen' },
  { id: 'GATE_PLANNING_REGISTER_PROSE', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_PROSE_STYLE_CONSISTENCY', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  // WS1.4: deterministic in-place reassignment of over-cap dominant-skill slots.
  { id: 'GATE_ENCOUNTER_SKILL_REBALANCE', placement: 'season-final', kind: 'remediation', defaultOn: false, repair: 'autofix' },
  // WS1.3: a dropped cold open routes to the existing season-final scene regen to re-author the opening.
  { id: 'GATE_COLD_OPEN_REALIZATION', placement: 'season-final', kind: 'blocking', defaultOn: false, repair: 'regen' },
  { id: 'GATE_OUTCOME_TEXT_QUALITY', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'autofix' },
  { id: 'GATE_SENTENCE_OPENER_VARIETY', placement: 'season-final', kind: 'blocking', defaultOn: false, repair: 'regen' },
  // R5 honesty fix (2026-07-06): this entry previously claimed `repair: 'autofix'`
  // but no autofix exists — a collapsed sustained set piece is missing encounter
  // STRUCTURE (phases / tension-curve points), which no prose rewrite or
  // deterministic fix can add at the final contract. The gateRepairRouter now
  // classifies its findings as architectural (blueprint_rebalance) instead of the
  // unclassified diagnostic_stop fall-through.
  { id: 'GATE_ENCOUNTER_SETPIECE_DEPTH', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, policyException: 'No final-contract repair can add encounter phases/tension-curve structure; findings are honestly classified architectural (blueprint_rebalance). The generative half is EncounterArchitect\'s sustained-set-piece beat floor at encounter build time. Planned fix: an encounter-structure repair handler that scaffolds the missing phases deterministically and has the LLM author their prose (shift-left candidate, R5 audit 2026-07-06).' },
  { id: 'GATE_REFERENCED_EVENT_PRESENCE', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'judge+regen' },
  { id: 'GATE_REQUIRED_BEAT_REALIZATION', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'judge+regen' },
  { id: 'GATE_TREATMENT_SEED_REALIZATION', placement: 'episode', auditPlacements: ['season-final'], lifecycle: 'episode-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_SCENE_TRANSITION_CONTINUITY', placement: 'episode', auditPlacements: ['season-final'], lifecycle: 'episode-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_SCENE_CHARACTER_AVAILABILITY', placement: 'season-final', kind: 'blocking', defaultOn: false, repair: 'regen' },
  { id: 'GATE_SCENE_TURN_REALIZATION', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_EPISODE_STORY_CIRCLE_REALIZATION', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: false, repair: 'regen' },
  { id: 'GATE_SCENE_TURN_CLUSTER_REPAIR', placement: 'season-final', lifecycle: 'repair-infra', finalRole: 'repair-router', kind: 'infra', defaultOn: true, repair: 'regen' },
  { id: 'GATE_NARRATIVE_MECHANIC_PRESSURE', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_TREATMENT_FIELD_UTILIZATION', placement: 'plan', auditPlacements: ['season-final'], lifecycle: 'plan-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_SEASON_PROMISE_REALIZATION', placement: 'plan', auditPlacements: ['season-final'], lifecycle: 'plan-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_CHARACTER_TREATMENT_REALIZATION', placement: 'plan', auditPlacements: ['season-final'], lifecycle: 'plan-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_FAILURE_MODE_AUDIT_REALIZATION', placement: 'plan', auditPlacements: ['season-final'], lifecycle: 'plan-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_CHARACTER_INTRODUCTION', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_FLAG_CONTRACT', placement: 'season-final', kind: 'blocking', defaultOn: false },
  // WS0.2: deterministic generative half (inject a flag-gated read for every unread
  // consequential set-flag), so this is remediation + autofix, not a blocking abort.
  { id: 'GATE_RESIDUE_CONSUME', placement: 'episode', auditPlacements: ['season-final'], lifecycle: 'episode-contract', finalRole: 'regression-net', kind: 'remediation', defaultOn: false, repair: 'autofix' },
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
  // Audit 2026-07-01 item 4.4 planned fix implemented (R5, 2026-07-06): the
  // gateRepairRouter now routes scene-localized drift findings from this gate to
  // the final-contract scene-prose/cluster repair; genuinely architectural
  // findings (episode-list mismatch) are classified blueprint_rebalance instead
  // of the unclassified diagnostic_stop dead end. Primary enforcement remains
  // plan placement (cheap fail-fast before prose).
  { id: 'GATE_AUTHORED_EPISODE_CONFORMANCE', placement: 'plan', auditPlacements: ['season-final'], lifecycle: 'plan-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  // Repair-first: the fidelity judge refutes FPs (it is a treatment-fidelity finding) and the
  // scene-prose repair handler now re-authors the encounter's phase/storylet prose to depict a
  // confirmed-missing central conflict / required beat (bite-me-g18), so this no longer hard-aborts.
  { id: 'GATE_ENCOUNTER_ANCHOR_CONTENT', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'judge+regen' },
  // Audit 2026-07-01 item 4.4 planned fix implemented (R5, 2026-07-06): the
  // gateRepairRouter routes scene-localized drift findings to scene-prose/cluster
  // repair; schedule findings with no scene target (reveal-before-setup ordering,
  // dropped reveals) are classified episode_replan — honest architecture, not the
  // unclassified diagnostic_stop dead end. Primary enforcement remains plan
  // placement (cheap fail-fast before prose).
  {
    id: 'GATE_INFORMATION_LEDGER_SCHEDULE',
    placement: 'plan',
    auditPlacements: ['season-final'],
    lifecycle: 'plan-contract',
    finalRole: 'regression-net',
    kind: 'blocking',
    defaultOn: true,
    repair: 'regen',
  },
  { id: 'GATE_SIGNATURE_DEVICE_PRESENCE', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'judge+regen' },
  { id: 'GATE_SCENE_SPATIAL_UNIT', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_RELATIONSHIP_ARC_LEDGER', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_THEMATIC_SQUARE_TURN', placement: 'season-final', kind: 'blocking', defaultOn: true, repair: 'regen' },
  // WS1 (2026-06-12): relocated from season-final to plan placement — anchors
  // are fully known before generation (see GATE_AUTHORED_EPISODE_CONFORMANCE).
  // Audit 2026-07-01 item 4.4 planned fix implemented (R5, 2026-07-06): the
  // gateRepairRouter routes scene-localized drift findings to scene-prose/cluster
  // repair; season-spine beat-placement findings (no scene target) are classified
  // blueprint_rebalance. Primary enforcement remains plan placement.
  { id: 'GATE_STORY_CIRCLE_ANCHOR_CONFORMANCE', placement: 'plan', auditPlacements: ['season-final'], lifecycle: 'plan-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'regen' },
  { id: 'GATE_SIGNATURE_PRESENCE_STRICT', placement: 'scene', auditPlacements: ['season-final'], lifecycle: 'scene-contract', finalRole: 'regression-net', kind: 'blocking', defaultOn: true, repair: 'judge+regen' },
] satisfies GateSpec[];

export const GATE_REGISTRY: GateSpec[] = RAW_GATE_REGISTRY.map(withGateMetadata);

/** All registered gates whose primary lifecycle owner is the given placement. */
export function gatesAtPlacement(placement: GatePlacement): GateSpec[] {
  return GATE_REGISTRY.filter((g) => g.placement === placement);
}

/** All gates allowed to execute at the given placement, including audit/regression nets. */
export function gateExecutionsAtPlacement(placement: GatePlacement): GateSpec[] {
  return GATE_REGISTRY.filter((g) => g.placement === placement || g.auditPlacements?.includes(placement));
}

/** Quality gates only; repair infrastructure is tracked separately from quality counts. */
export function qualityGatesAtPlacement(placement: GatePlacement): GateSpec[] {
  return gatesAtPlacement(placement).filter((g) => g.lifecycle !== 'repair-infra');
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
    } else if (spec.placement !== placement && !spec.auditPlacements?.includes(placement)) {
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
/**
 * Enforce registry completeness, default-drift, and the repair-first policy.
 * Returns violations (empty = compliant). The unit test pins this to
 * GATE_DEFAULTS so CI fails the moment a gate ships unregistered, drifts from
 * its registered default, or goes default-ON blocking at plan / scene /
 * episode / season-final without a repair route or a written exception (R2.2).
 */
export function validateGateRegistry(defaults: Record<string, boolean> = GATE_DEFAULTS): GateRegistryViolation[] {
  const violations: GateRegistryViolation[] = [];
  const registered = new Map(GATE_REGISTRY.map((g) => [g.id, g]));
  /** Placements where a default-ON hard abort must be repair-first (R2.2). */
  const repairFirstPlacements = new Set<GatePlacement>(['plan', 'scene', 'episode', 'season-final']);

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
    // Repair-first: default-ON blockers at plan/scene/episode/season-final
    // (primary placement OR auditPlacements) need a repair route or exception.
    const executionPlacements = new Set<GatePlacement>([
      spec.placement,
      ...(spec.auditPlacements ?? []),
    ]);
    const blocksAtRepairFirstPlacement = [...executionPlacements].some((p) => repairFirstPlacements.has(p));
    const violatesRepairFirst =
      spec.kind === 'blocking' && spec.defaultOn && blocksAtRepairFirstPlacement && !spec.repair && !spec.policyException;
    if (violatesRepairFirst) {
      violations.push({
        gateId: spec.id,
        problem: 'repair-first policy: a default-ON blocking gate at plan/scene/episode/season-final (placement or auditPlacements) must declare a repair route (autofix/regen/judge) or carry a written policyException',
      });
    }
  }
  return violations;
}
