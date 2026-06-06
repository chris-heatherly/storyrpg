// ========================================
// CENTRAL GATE ROLLOUT REGISTRY
// ========================================
//
// Single source of truth for which validator gates are ON by default, replacing
// the scattered `process.env[f] === '1'` opt-in predicates that lived at every
// call site (FullStoryPipeline, issueEscalation, treatmentFidelityGate,
// applyCraftAutofix, planGatePolicy seams). Rollout state is now auditable in
// ONE place and still overridable per-environment without code edits.
//
// Resolution order for `isGateEnabled(flag)`:
//   1. process.env[flag] === '1'  -> true   (explicit on override)
//   2. process.env[flag] === '0'  -> false  (explicit off / kill-switch override)
//   3. GATE_DEFAULTS[flag]        -> the rolled-out default for that flag
//   4. otherwise                  -> false  (un-rolled-out gate stays opt-in)
//
// Any flag NOT listed in GATE_DEFAULTS keeps EXACTLY the old semantics
// (on iff env === '1'), so adding the registry is a no-op for those flags.
//
// PURE/UNCACHED w.r.t. wall-clock/randomness: the only side input is process.env.

/**
 * Per-flag rollout defaults. `true` = gate is ON unless the environment sets the
 * var to '0'. Absent / `false` = gate stays default-off (opt-in via env '1').
 *
 * Keep the rationale for each promotion next to it; this map is the rollout log.
 */
export const GATE_DEFAULTS: Record<string, boolean> = {
  // ── Wave 1: deterministic, in-place autofix repairs ──
  // Each has a tested, pure repair module in remediation/repairs/ that fully
  // resolves its finding with no LLM and no downstream invalidation.
  GATE_NPC_DEPTH: true,
  GATE_CHOICE_IMPACT: true,
  GATE_STAT_CHECK_BALANCE: true,
  GATE_ARC_DELTA: true,
  GATE_MECHANICS_LEAKAGE: true,

  // ── Wave 2: correctness hard-gates ──
  // Re-enabled after the witnessNpcResolver root-cause fix (wired into
  // prepareValidationInput) so the aggregate can no longer carry raw-label
  // errors — the gate enforces against canonical ids only.
  GATE_WITNESS_ID_INTEGRITY: true,
  // Deterministic repair: add canonical witness NPCs to their scene's roster so the
  // "Witness reaction NPC … is not listed in scene" PREFERENCE warning clears (the NPC
  // is real and meant to observe). Additive-only, reversible via env=0.
  GATE_WITNESS_SCENE_PRESENCE: true,
  // Promoted ON after the shadow pass: the 2026-06-06 run logged 0 design-note leaks
  // across 24 scenes (gate-shadow-ledger.jsonl), a clean false-positive profile. A
  // design-note/meta-narration leak is an unshippable fiction-first violation, so
  // blocking it is correct. Reversible via env=0.
  GATE_DESIGN_NOTE_LEAK: true,

  // ── Wave 3: bounded LLM soft-gates ──
  // Hysteresis-stabilized, single-pass repair, degrade-not-block (never aborts a
  // run) — safe to enable without corpus data.
  GATE_JUDGE_STABILIZATION: true,
  GATE_CLIFFHANGER: true,

  // Final-contract repair loop (Wave 4 keystone). When ON, a failing contract
  // attempts bounded deterministic repair (structural autofix + witness
  // canonicalization) + re-validation BEFORE the hard-abort throw. Promoted ON as a
  // pure safety net: it only runs on an already-FAILING contract and its handlers are
  // idempotent, so it can never turn a passing run into a failure — it can only
  // rescue a failing one. Reversible via env=0.
  GATE_FINAL_CONTRACT_REPAIR: true,

  // ── Wave 4: plan-time gates — stay OFF until their repair loop lands AND the
  // shadow pass clears them. Listed here (false) so the rollout state is visible.
  GATE_SETUP_PAYOFF: false,
  GATE_CALLBACK_COVERAGE: false,
  GATE_PROP_INTRODUCTION: false,
  GATE_CHOICE_DENSITY: false,
  GATE_CHOICE_DISTRIBUTION: false,
  GATE_CONSEQUENCE_BUDGET: false,
  GATE_ARC_PRESSURE: false,
};

/**
 * Whether a gate is enabled, honouring env overrides over the rolled-out default.
 * Replaces the inline `(f) => process.env[f] === '1'` predicates everywhere.
 */
export function isGateEnabled(flag: string): boolean {
  const env = process.env[flag];
  if (env === '1') return true;
  if (env === '0') return false;
  return GATE_DEFAULTS[flag] ?? false;
}

/** Predicate form for helpers that take `(flag) => boolean` (planGatePolicy, applyCraftAutofix). */
export const gateEnabledPredicate = (flag: string): boolean => isGateEnabled(flag);

/**
 * Whether Wave-0 gate SHADOW logging is active. Default-ON so every run records
 * what each gate WOULD have done (gate-shadow-ledger.jsonl) even while its flag is
 * off — this is the data that promotes a gate off -> on. Set `STORYRPG_GATE_SHADOW=0`
 * to disable (e.g. a perf-sensitive batch run). Shadow validators are pure and
 * LLM-free, so the only cost is a little extra CPU per episode.
 */
export function isShadowLoggingEnabled(): boolean {
  return process.env.STORYRPG_GATE_SHADOW !== '0';
}
