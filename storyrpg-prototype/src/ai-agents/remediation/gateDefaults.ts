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

  // ── Gen-4 audit follow-ups ──
  // ENABLED: precise structural / backstop checks with a low false-positive profile
  // and no fix-side dependency — safe to fail loud on a genuine defect.
  //
  // Dead-branch detection: a blueprint scene declared as a multi-target branch
  // point (leadsTo.size>1) whose own choices fan out to <2 of those targets
  // assembled as a linear pass-through. The metric is always recorded; this flag
  // promotes it to a blocking SceneGraphBranchValidator error.
  GATE_BRANCH_FANOUT: true,
  // Treatment-seed on-page presence: every treatment_seed_* declared for an
  // episode must be set via a setFlag consequence on some choice in that episode.
  // Seeds are emitted deterministically upstream, so this is a pure backstop.
  GATE_TREATMENT_SEED_ONPAGE: true,
  //
  // STILL OFF — detection-only / fix-side deferred. Their detection runs regardless
  // (warnings + metrics); promoting to BLOCKING here would hard-fail runs until the
  // generative repair lands (or, for pronouns, false-positive on correct prose):
  //
  // Duplicate establishing-beat: prose heuristic; needs shadow data before blocking
  // (two scenes legitimately sharing a location could false-positive).
  GATE_DUPLICATE_ESTABLISHING_BEAT: false,
  // Protagonist pronoun integrity: the deterministic resolver ALWAYS repairs the
  // safe (protagonist-only-sentence) wrong-gender cases (ungated). This flag would
  // promote AMBIGUOUS residue to blocking — but that fires on correct prose too
  // ("Kylie watches Mika lift HIS glass"), so it stays off until a regen route exists.
  GATE_PROTAGONIST_PRONOUN: false,
  // Encounter-outcome variant: outcome state flags are ALWAYS seeded (ungated). This
  // flag blocks a reconvergence-with-no-outcome-variant — but nothing authors those
  // variants yet, so blocking would halt ~every encounter. Off until the generative
  // half (outcome-aware variant authoring) lands.
  GATE_ENCOUNTER_OUTCOME_VARIANT: false,
  // Continuity remediation: would promote high-precision cross-scene continuity ERRORS
  // (impossible_knowledge/contradiction/missing_setup/timeline_error) to blocking, but
  // there is no repair wired (the final-contract repair loop can't fix continuity), so
  // it would hard-fail any run with a continuity error. Off until scene-regen is wired.
  GATE_CONTINUITY_REMEDIATION: false,
  // QA critical-issue block: promotes a failing QA report (passesQA=false OR any
  // criticalIssues) from advisory to a BLOCKING contract issue. Default-OFF because,
  // like GATE_CONTINUITY_REMEDIATION, no auto-repair is wired — flipping it on would
  // hard-fail any run QA scores below the threshold. Distinct from
  // GATE_CONTINUITY_REMEDIATION (which only promotes the four remediable continuity
  // error CLASSES); this one gates the whole QA pass/fail. Detection of continuity
  // errors is now ALWAYS surfaced as at least a warning regardless of either flag.
  GATE_QA_CRITICAL_BLOCK: false,
  // Ending reachability: the branch-axis emitter ALWAYS sets the season's
  // treatment_branch_* ending axes on-page (ungated). This flag would promote a
  // declared-but-unset axis to blocking — but it needs a full-season shadow pass
  // first (a 3-episode generation can't exercise axes whose setInEpisode is a
  // later, ungenerated episode, so it would false-positive). Off until validated
  // against a full-season run.
  GATE_ENDING_REACHABILITY: false,
  // Treatment-sourced arming: stitches the live treatment `sourceAnalysis` onto
  // `brief.multiEpisode.sourceAnalysis` so `runFidelityValidators` resolves
  // `treatmentSourced=true` and the five §4 fidelity gates ENFORCE (hard-fail) on
  // treatment runs. Default-OFF because arming flips ALL five gates to blocking at
  // once: the EncounterAnchorContent gate is now partial-season-safe, but
  // InformationLedgerSchedule and SignatureDevicePresence still check the WHOLE
  // treatment against a partial (e.g. 3-of-8) story and would false-fail on
  // not-yet-generated episodes. Flip ON only after those validators are
  // partial-season-scoped and a real treatment run passes clean.
  GATE_TREATMENT_SOURCED_ARM: false,

  // ── Wave 5: treatment-fidelity §4 gates (Remediation §4.1–§4.5) ──
  // Promoted ON to ENFORCE authored-treatment fidelity (not merely steer it): with
  // these off the validators are dispatched but never block, so a re-cut episode
  // list, an empty encounter anchor, a missing signature device, a mis-scheduled
  // info reveal, or a mis-anchored 7-point beat would ship silently. SCOPE: these
  // escalate to blocking ONLY on treatment-sourced runs (runFidelityValidators sets
  // treatmentSourced from sourceFormat; FinalStoryContractValidator.validateFidelity
  // -Findings only hard-fails when treatmentSourced) — non-treatment generation is
  // byte-identical to before, so the broad corpus is unaffected. CAVEAT: promoted by
  // direction rather than off a clean shadow-ledger pass (live treatment runs were
  // blocked by proxy redeploys at promotion time); the deterministic binding was
  // validated offline against the real bite-me brief. Each is reversible per-env via
  // `<FLAG>=0` (kill-switch) if a real treatment run surfaces a false positive.
  GATE_AUTHORED_EPISODE_CONFORMANCE: true,
  GATE_ENCOUNTER_ANCHOR_CONTENT: true,
  GATE_INFORMATION_LEDGER_SCHEDULE: true,
  GATE_SIGNATURE_DEVICE_PRESENCE: true,
  GATE_SEVEN_POINT_ANCHOR_CONFORMANCE: true,
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
