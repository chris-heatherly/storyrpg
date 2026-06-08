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

  // ── Wave 4: plan-time gates ──
  // PROMOTED ON after a clean shadow pass: across the six gen-3/4/5 runs recorded in
  // gate-shadow-ledger.jsonl, each of these logged wouldGate=false / blockingCount=0
  // on every episode — a zero false-positive profile. They block at plan time (before
  // any prose is authored), so a genuine error fails fast with no wasted generation and
  // no regen loop required. Each is reversible per-env via `<FLAG>=0` (kill-switch).
  GATE_SETUP_PAYOFF: true,
  GATE_CALLBACK_COVERAGE: true,
  GATE_CHOICE_DENSITY: true,
  GATE_CONSEQUENCE_BUDGET: true,
  // STILL OFF — fires on every shadow run pre-repair (5/5 runs, 16 blocking issues
  // total) via the cast-reference subset. It has a repair loop
  // (repairAndRevalidatePropIntroduction) that resolves the raw-label→canonical-id
  // class before aborting, but the loop has never been exercised live, so promoting
  // now risks hard-failing every run on residue the repair can't clear. Promote only
  // after one live `GATE_PROP_INTRODUCTION=1` run confirms the loop drives blocking→0.
  GATE_PROP_INTRODUCTION: false,
  // STILL OFF — no structured shadow data. Unlike the gates above (logged via
  // recordPlanGateShadow in FullStoryPipeline), these enforce at the season-planning
  // seam (seasonChoicePlan / SeasonPlannerAgent), which has no run output directory /
  // ledger baseDir to write a shadow record to. Their call sites now resolve through
  // gateEnabledPredicate (registry-controlled, env-overridable) so a future flip is a
  // one-liner here — but they cannot be promoted on data until that seam can emit a
  // shadow record (requires threading a baseDir into the season planner).
  GATE_CHOICE_DISTRIBUTION: false,
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
  // safe (protagonist-only-sentence) wrong-gender cases (ungated). The regen route for
  // AMBIGUOUS residue now exists — when this gate is on, disambiguateProtagonistPronouns
  // hands each ambiguous sentence ("Kylie watches Mika lift HIS glass") to the
  // PronounDisambiguator agent before the contract re-scans, so the gate blocks only on
  // residue the rewrite could not resolve, not on every shared-pronoun sentence. STILL
  // OFF: needs one live run to confirm the disambiguator clears real residue (the LLM
  // path can't be exercised offline). Flip to true after that; reversible via =0.
  GATE_PROTAGONIST_PRONOUN: false,
  // Encounter-outcome variant: outcome state flags are ALWAYS seeded (ungated). The
  // generative half now exists — when this gate is on, authorEncounterOutcomeVariants
  // runs the OutcomeVariantAuthor over each detected reconvergence desync to write the
  // missing outcome-conditioned opening variants (gated on encounter_<id>_<outcome>)
  // before the contract re-detects, so the gate blocks only on reconvergences the
  // author could not cover. STILL OFF until one live run confirms the author clears
  // real desyncs (the LLM path can't be exercised offline); reversible via =0.
  GATE_ENCOUNTER_OUTCOME_VARIANT: false,
  // Continuity remediation: promotes high-precision cross-scene continuity ERRORS
  // (impossible_knowledge/contradiction/missing_setup/timeline_error) to blocking. The
  // scene-regen IS now wired: repairContinuityFindings re-authors the flagged beats via
  // SceneCritic and, when this gate (or GATE_QA_CRITICAL_BLOCK) is on, re-runs the
  // ContinuityChecker over the repaired prose and refreshes qaReport.continuity in place,
  // so the gate fires only on CONFIRMED residue rather than stale pre-repair findings.
  // STILL OFF: promotion needs ONE live treatment/season run to confirm the repair loop
  // drives real continuity errors to 0 (the LLM re-validate path can't be exercised
  // offline). Flip to true after that run; reversible per-env via =0.
  GATE_CONTINUITY_REMEDIATION: false,
  // QA critical-issue block: promotes a failing QA report (passesQA=false OR any
  // criticalIssues) from advisory to a BLOCKING contract issue. Partial repair is now
  // wired: turning this on also runs the continuity re-validation loop, and the QA
  // report's derived fields (overallScore/criticalIssues/passesQA) are RECOMPUTED from
  // the refreshed sub-reports (recomputeQAReportDerived), so a continuity error that the
  // repair resolved no longer counts against the gate. CAVEAT: voice + stakes criticals
  // have no repair loop yet, so those still block when present (correctly — they are
  // unrepaired residue). STILL OFF until a live run confirms the recompute leaves only
  // genuine residue; reversible via =0. Distinct from GATE_CONTINUITY_REMEDIATION (which
  // promotes only the four remediable continuity error CLASSES); this gates whole-QA
  // pass/fail. Continuity errors are ALWAYS surfaced as at least a warning either way.
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
  // treatment runs (without this, the §4 gates run but never block).
  //
  // Promoted ON after the three STORY-dependent §4 validators were verified clean on a
  // real partial-season run (bite-me-gen-5, 3-of-8): EncounterAnchorContent (storylet +
  // partial-season + episode-scope fixes), InformationLedgerSchedule (encounter-beat
  // scan + arc-reframe-summary exemption), and SignatureDevicePresence (encounter prose
  // + verb-only negation cues + length-gated inversion) all report 0 errors. The two
  // PLAN-vs-treatment validators (AuthoredEpisodeConformance, SevenPointAnchor) are
  // independent of how many episodes were generated and could not be offline-verified
  // (the run did not persist sourceAnalysis); watch them on the next live run.
  // Reversible per-env via STORYRPG / GATE_TREATMENT_SOURCED_ARM=0 (kill-switch).
  GATE_TREATMENT_SOURCED_ARM: true,

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
