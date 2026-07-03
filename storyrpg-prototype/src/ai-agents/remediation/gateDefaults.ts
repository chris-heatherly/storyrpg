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
  // G10: promote unknown-NPC RELATIONSHIP-consequence errors to blocking.
  // PROMOTED ON 2026-06-09 after wiring the canonicalizer that this gate depends on. The
  // 2026-06-09 offline audit (memory: g10-shadow-gate-audit) found the dead deltas were
  // STILL shipping (bite-me 3, endsong 6 distinct unknown ids) because
  // canonicalizeRelationshipConsequences existed but was NEVER CALLED — only the witness
  // variant ran. It is now wired at BOTH the per-episode chokepoint (prepareValidationInput,
  // mirroring canonicalizeWitnessReactions) and the assembled-story chokepoint
  // (enforceFinalStoryContract → canonicalizeStoryRelationshipConsequences). resolveWitnessNpcId
  // remaps the resolvable raw labels (first-name token overlap, snake/full-name normalized
  // equality) to their canonical char-* id and drops the genuinely-unknown (e.g. "fort_soldiers",
  // "(missing)") BEFORE the validator scans — so the gate now fires only on real residue
  // (a relationship delta whose target truly is not in the roster), which is correctly
  // unshippable. Reversible via =0.
  GATE_RELATIONSHIP_ID_INTEGRITY: true,
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

  // Scene-shape architecture gates. These were kept default-off while planned
  // scenes could bypass the architecture validator path and emit generic scene
  // containers. Planned-scene blueprints now receive deterministic dramatic
  // structure / turn-contract metadata and validate through the same policy as
  // invented blueprints, so missing scene question/turn/changed-state and
  // removable-scene failures are correctness issues, not broad craft taste.
  // Reversible via =0.
  GATE_DRAMATIC_STRUCTURE: true,
  GATE_SCENE_TURN_CONTRACT: true,
  // Episode-level Story Circle prose realization. Blueprint completeness is
  // still enforced by STORY_CIRCLE_BLOCKING; this default-off flag only promotes
  // structural episodeCircle misses in final prose from warning/shadow evidence
  // to blocking repair findings after enough telemetry is clean.
  GATE_EPISODE_STORY_CIRCLE_REALIZATION: false,

  // LLM scene-prose repair handler INSIDE the final-contract repair loop
  // (2026-06-11 failure-cycle audit: 20 runs generated every episode and then
  // died at the contract, median 73 min each). When ON, blocking prose-
  // realization findings that name a scene (RequiredBeatRealization,
  // SignatureDevicePresence) drive a bounded per-scene SceneCritic rewrite +
  // re-validation instead of an immediate run abort — the finding's own
  // message/suggestion is the director note. Same safety shape as
  // GATE_FINAL_CONTRACT_REPAIR: runs only on an already-failing contract,
  // capped per round (4 scenes), budget-guarded, so it can only rescue.
  // No-op unless GATE_FINAL_CONTRACT_REPAIR is also on.
  GATE_FINAL_CONTRACT_SCENE_REGEN: true,

  // Outcome-text repair: a blocking OutcomeTextQuality `outcome_text_stub` finding
  // (a choice whose outcome tier is the ChoiceAuthor deterministic stub) drives a
  // bounded per-choice LLM re-author (ChoiceAuthor.reauthorOutcomeTexts) +
  // re-validation instead of a season abort. Same safety shape as the scene-regen
  // handler: only on an already-failing contract, capped per round, budget-guarded,
  // replaces a stub only with real authored prose. No-op unless
  // GATE_FINAL_CONTRACT_REPAIR is also on.
  GATE_FINAL_CONTRACT_OUTCOME_REGEN: true,

  // Scene-time required-beat realization check (2026-06-12, bite-me-g13 root
  // cause). The treatment binds requiredBeats/signatureMoment to scenes and
  // SceneWriter gets them as a prompt checklist — but nothing verified
  // realization until the season-final contract ~90 min later, and the
  // generation-time rewrite passes (SceneCritic polish, POV/voice regen swap)
  // could paraphrase a realized moment away unnoticed. When ON: (a) a freshly
  // written scene that under-realizes its authored moments gets ONE immediate
  // SceneWriter retry with the exact missing content words as feedback
  // (deterministic mirror of the final validators — no extra LLM to detect);
  // if authored/signature moments remain missing after that retry, the scene
  // fails locally instead of deferring the blocker to final-contract repair;
  // (b) polish/regen rewrites that would LOSE a depicted authored moment are
  // reverted (free).
  GATE_SCENE_REQUIRED_BEAT_CHECK: true,

  // Judge confirmation for HEURISTIC fidelity findings (WS3, 2026-06-11 audit).
  // RequiredBeatRealization / SignatureDevicePresence are keyword-overlap
  // heuristics; before one of their findings blocks the contract, one bounded
  // LLM call checks whether the flagged authored moment is actually dramatized
  // on-page (paraphrase counts). Refuted findings downgrade to warnings;
  // confirmed misses stay blocking. Conservative on judge failure (everything
  // stays blocking) — so this gate can only PREVENT false-positive aborts,
  // never create one. ON by default.
  GATE_FIDELITY_JUDGE_CONFIRM: true,

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
  // STILL OFF — current shadow telemetry shows repeated residual blockers. Keep
  // advisory until the deterministic assignment/retry loop drives residualBlockingCount
  // to 0 on a watched run.
  GATE_CHOICE_DISTRIBUTION: false,
  //
  // 2026-07-01 audit 4.2: the following flags were LIVE in code but registered
  // nowhere — raw `process.env.X === '1'` reads invisible to the registry policy
  // test. Migrated to isGateEnabled + registered here with their existing
  // opt-in (default-OFF) behavior preserved. All reversible via =0 / promotable
  // via =1 exactly as before.
  //
  // Season choice/consequence budget hard-gate (SeasonPlannerAgent).
  GATE_SEASON_BUDGETS: false,
  // Charge-materialization hollow-branch blocking (consequenceFlags →
  // episodeChargeMaterialization / chargeMaterializationGate).
  GATE_CHARGE_MATERIALIZATION: false,
  // Incremental per-scene intensity-tier distribution check.
  GATE_INTENSITY_DISTRIBUTION: false,
  // Strict mechanics-leakage scan + escalate-to-scene-regen (incremental).
  GATE_MECHANICS_LEAKAGE_REGEN: false,
  // Per-scene regen-choices loop (regenChoicesPolicy / ContentGenerationPhase).
  GATE_REGEN_CHOICES: false,
  // B0 architect craft gates: retry-exhausted craft warnings become blocking
  // per-rule (architectGatePolicy). DRAMATIC_STRUCTURE / SCENE_TURN_CONTRACT
  // from the same tag list are already registered above (default-ON).
  GATE_TREATMENT_FIDELITY: false,
  GATE_THEME_PRESSURE: false,
  GATE_EPISODE_PRESSURE: false,
  // PROMOTED ON after plan-time shadow telemetry started recording this seam:
  // the local ledger shows 84 records across 72 runs with 0 would-gate rows and
  // 0 residual blockers. Plan placement means a true defect fails before prose is
  // generated. Reversible via =0.
  GATE_ARC_PRESSURE: true,

  // ── Gen-4 audit follow-ups ──
  // ENABLED: precise structural / backstop checks with a low false-positive profile
  // and no fix-side dependency — safe to fail loud on a genuine defect.
  //
  // Dead-branch detection: a blueprint scene declared as a multi-target branch
  // point (leadsTo.size>1) whose own choices fan out to <2 of those targets
  // assembled as a linear pass-through. The metric is always recorded; this flag
  // promotes it to a blocking SceneGraphBranchValidator error.
  GATE_BRANCH_FANOUT: true,
  // Scene-construction preflight: each scene must own one primary turn and one
  // owner per route event before SceneWriter/EncounterArchitect. Detection
  // (SceneOwnershipPreflightValidator + construction/event-ownership profiles)
  // always runs and is saved to the construction report; this flag promotes the
  // conflicts to a blocking hard-abort (StoryArchitect regenerates; the
  // content-phase re-check aborts). Reversible via =0. Default-ON.
  GATE_SCENE_CONSTRUCTION_PREFLIGHT: true,
  // Treatment-seed on-page presence: every treatment_seed_* declared for an
  // episode must be set via a setFlag consequence on some choice in that episode.
  // Seeds are emitted deterministically upstream, so this is a pure backstop.
  GATE_TREATMENT_SEED_ONPAGE: true,
  //
  // STILL OFF — detection-only / fix-side deferred. Their detection runs regardless
  // (warnings + metrics); promoting to BLOCKING here would hard-fail runs until the
  // generative repair lands (or, for pronouns, false-positive on correct prose):
  //
  // Duplicate establishing-beat: prose heuristic promoted after clean shadow +
  // replay evidence (local ledger: 291 records across 129 runs, 0 would-gate rows;
  // replay:gates clean). Registered with an autofix route and reversible via =0.
  GATE_DUPLICATE_ESTABLISHING_BEAT: true,
  // Protagonist pronoun integrity: the deterministic resolver ALWAYS repairs the
  // safe (protagonist-only-sentence) wrong-gender cases (ungated). The regen route for
  // AMBIGUOUS residue now exists — when this gate is on, disambiguateProtagonistPronouns
  // hands each ambiguous sentence ("Kylie watches Mika lift HIS glass") to the
  // PronounDisambiguator agent before the contract re-scans, so the gate blocks only on
  // residue the rewrite could not resolve, not on every shared-pronoun sentence. STILL
  // OFF: needs one live run to confirm the disambiguator clears real residue (the LLM
  // path can't be exercised offline). Flip to true after that; reversible via =0.
  GATE_PROTAGONIST_PRONOUN: false,
  // G10: NPC pronoun inconsistencies (a uniquely-named gendered NPC paired with a wrong
  // binary or singular-they pronoun — Endsong ep3 narrated he/him Thorne as "their
  // shoulder"). STAYS OFF (advisory only) — the 2026-06-09 audit (memory:
  // g10-shadow-gate-audit) replayed it over bite-me-g10 + endsong-g10 and found ~100
  // findings/run that are ~90% FALSE POSITIVE: a sentence names one NPC but the contrary
  // pronoun refers to a DIFFERENT, unnamed person ("meant for HIM to overhear", "before she
  // can stop THEM" = eyes, "without learning HIS" = the opponent's). Added precision guards
  // cut this ~50% (skip the roster-bio subtree; require the name to be the pronoun's
  // antecedent; skip sentences with an unnamed third-party noun or a dialogue speaker tag),
  // but heuristic detection structurally CANNOT reach blocking precision — pronoun
  // coreference needs semantics. Durable fix to promote this: an LLM coreference judge that
  // confirms the pronoun binds to the named NPC (mirror the protagonist PronounDisambiguator
  // regen route), then gate on its confirmed residue. Until then: advisory backstop only.
  GATE_NPC_PRONOUN: false,
  // WS0.3 (bite-me-g17): encounter outcome storylets + phase outcome prose narrate the
  // protagonist in third person ("Kylie straightens her collar… she has become it") in a
  // second-person story — the recurring protagonist_as_npc / encounter-POV break, present on
  // every encounter climax in g17. Unlike GATE_NPC_PRONOUN this is high-precision: the
  // detector requires the protagonist NAME + a third-person pronoun + NO "you" anywhere, and
  // the repair is a deterministic name-anchored coercion with verb agreement (autofix), so
  // false positives can't abort a run. Promoted ON at landing (user: promote the two
  // high-confidence blockers now). Reversible via =0.
  GATE_ENCOUNTER_POV: true,
  // bite-me-g22/g23: second-person encounter repair residue like "you rooftop",
  // "you candle", and "You kiss takes" is mechanically generated corruption,
  // not craft preference. Default-OFF after the g23 live failure-cycle audit:
  // it correctly detected corruption, but final-contract scene repair was not
  // yet precise enough to clear every nested encounter outcome, causing a
  // 74-blocker season-final abort. Keep findings as warnings by default; run
  // `GATE_ENCOUNTER_PROSE_INTEGRITY=1` for watched repair/promotion tests.
  GATE_ENCOUNTER_PROSE_INTEGRITY: false,
  // G24: planning-register/task prose ("Open the episode", "Introduce X on-page",
  // "Authored treatment choice", "Decide how to handle...") is authoring scaffold,
  // not fiction. High precision and repairable by localized scene-prose rewrite, so
  // keep it blocking by default; reversible via =0.
  GATE_PLANNING_REGISTER_PROSE: true,
  // High-confidence reader-prose style defects: repeated toast/click motifs and
  // live-action past-tense drift without memory/backstory markers.
  GATE_PROSE_STYLE_CONSISTENCY: true,
  // WS1.4 (bite-me-g17): deterministic encounter skill-rebalance. perception carried 52–55% of
  // choice slots in all three g17 encounters (a single-skill meta). Reassign the excess dominant-
  // skill slots to the least-used skill ALREADY present in the encounter until no skill exceeds
  // ~40%. Default-OFF until a smoke run confirms the reassignments read coherently against the
  // choice prose; the EncounterArchitect prompt cap is the primary (coherent-at-source) fix. =1 to enable.
  GATE_ENCOUNTER_SKILL_REBALANCE: false,
  // WS1.3 (bite-me-g17): enforce the episode COLD OPEN on-page. g17 dropped the entire ep1
  // cold open (the niece-Sadie FaceTime + grandmother's-chain hook) as an advisory seed, so a
  // Season-2 anchor and the protagonist's humanity tether never reached a single beat. The cold
  // open is split out as its own required-beat tier (low-FP: an episode opener is reliably due),
  // and a miss routes to the season-final scene regen. Default-OFF until a live run confirms a
  // clean baseline; =1 to enable blocking.
  GATE_COLD_OPEN_REALIZATION: false,
  // G10: promote stub/scaffold-leak/echo/duplicate outcomeTexts to blocking. The
  // ChoiceAuthor fallback that produced these is fixed; OutcomeTextQualityValidator is
  // the durable backstop. High-precision (exact scaffold lead-ins + annotation-echo +
  // tier-duplication).
  // PROMOTED ON 2026-06-11 (group-A batch): the offline replay over the g10 golden corpus
  // caught 15 (bite-me) + 3 (endsong) real scaffold/stub outcomeTexts with ZERO false
  // positives on the clean (non-treatment) runs, and the ChoiceAuthor fallback that produced
  // them is already fixed, so on fresh output this fires only on genuine residue. Reversible via =0.
  GATE_OUTCOME_TEXT_QUALITY: true,
  // Prose craft: flag monotonous second-person sentence cadence — a single beat or
  // outcome tier that stacks 3+ consecutive "You …" openers ("You save the file. You
  // don't know where. You just know …"). The reader is second person, so "You" openers
  // are correct; only consecutive runs flag. The ChoiceAuthor/SceneWriter opener-variety
  // prompt guidance is the real fix; SentenceOpenerVarietyValidator is the deterministic
  // backstop.
  // PROMOTED ON 2026-06-11 (group-A batch) on offline g10-corpus evidence, then RETURNED
  // TO SHADOW the same day (failure-cycle audit, repair-first policy): a blocking gate at
  // the final contract must carry a repair handler, an autofix, or judge confirmation —
  // this one has none, so a hit aborts an entire generated season for a cadence defect.
  // Findings still surface as warnings. Re-promote once opener-cadence rewrites join the
  // scene-prose repair handler (sceneProseRepairHandler.ts).
  GATE_SENTENCE_OPENER_VARIETY: false,
  // G10: a treatment-staged SUSTAINED set-piece encounter (e.g. "wall breach + repulse →
  // evacuate") must keep escalating structure (≥2 phases or a ≥3-point tension curve),
  // not collapse to one decision + a summary outcome (Endsong ep3 siege). Complements
  // SignatureDevicePresence (string present) with a structural-depth check.
  // PROMOTED ON after the 2026-06-09 offline audit (memory: g10-shadow-gate-audit): replaying
  // over the bite-me-g10 + endsong-g10 final stories produced exactly ONE finding — the
  // documented Endsong "Wall Breach and Repulse" siege collapsed to 1 phase + 1-point
  // tensionCurve — and ZERO false positives. Fires only on a genuinely-flattened set piece.
  // CAVEAT: hard-gate at the final contract with NO deterministic repair, so on a treatment
  // run it ABORTS (wastes the generation) rather than rescuing — pair with the
  // EncounterArchitect depth fix so the gen stops emitting a 1-phase siege. Reversible via =0.
  GATE_ENCOUNTER_SETPIECE_DEPTH: true,
  // G10: an enumerated scene objective ("collects four splinters — Ileana's tears, the
  // photograph, the maiden name, Mika's absence") must dramatize each listed item on
  // page; otherwise a later scene pays off a clue the reader never saw. Conservative
  // (only explicit ≥3-item enumerations).
  // PROMOTED ON after the missing repair-first pieces landed: findings now carry
  // scene locations, are judge-confirmable in fidelityRealizationJudge, and route
  // through sceneProseRepairHandler/gateRepairRouter. Local replay is clean across
  // the available archived corpus; any genuine miss gets same-scene regen before
  // an abort. Reversible via =0.
  GATE_REFERENCED_EVENT_PRESENCE: true,
  // G10: an `authored`-tier required beat on a STANDARD (non-encounter) scene must be
  // dramatized in that scene's prose. Closes the gap between SignatureDevicePresence
  // (signature-tier only) and EncounterAnchorContent (encounter scenes only): the audited
  // Endsong ep1 `s1-6` ("Vraxxan Names the Key") shipped its authored required beat — the
  // season's key reveal — unwritten, stopping at the villain's entrance, and NO gate saw it.
  // PROMOTED ON 2026-06-11 (group-A batch): the offline replay over the g10 corpus produced
  // 7 (bite-me) + 7 (endsong) real undramatized-required-beat misses with ZERO false positives.
  // STAYS ON under the repair-first policy (same-day failure-cycle audit) because it now has
  // BOTH safety routes: GATE_FIDELITY_JUDGE_CONFIRM judge-checks each finding against the
  // scene's actual prose (paraphrase-blind false positives downgrade to warnings), and
  // confirmed misses drive the GATE_FINAL_CONTRACT_SCENE_REGEN per-scene rewrite instead of
  // an immediate abort. The run aborts only when repair rounds exhaust. Reversible via =0.
  GATE_REQUIRED_BEAT_REALIZATION: true,
  // bite-me-g16/g24 audit: treatment SEED plants (cold-open / consequence-seed /
  // info-ledger tells such as "the stray dog in the courtyard, watching", readership
  // counters, or delivered objects) were dropped on-page yet later payoffs still
  // referenced them, because a dropped seed only warned. PROMOTED ON 2026-06-20 after
  // a watched run showed the exact class again (missing blog counter + roses/card)
  // and the gate already routes to the season-final scene regen path. Reversible via =0.
  GATE_TREATMENT_SEED_REALIZATION: true,
  // Bite Me hard-cut remediation: unacknowledged time/place jumps between adjacent
  // scenes or choice-bridge payoffs are now blocking. The validator remains inert
  // for legacy stories with no persisted timeline/scene-plan metadata, but any
  // planned location/time jump must be grounded in bridge prose, transitionIn, or
  // the arriving scene's opening.
  GATE_SCENE_TRANSITION_CONTINUITY: true,
  // Turn-centered scene realization: every generated scene with a turn contract
  // must show setup/pre-turn pressure, the central turn, and aftermath/handoff.
  // Treatment-authored turns block; non-treatment misses start as warnings unless
  // the validator detects structural risk. Reversible via =0.
  GATE_SCENE_TURN_REALIZATION: true,
  // Relationship/location slow-burn enforcement: major named locations are full
  // scene units; relationship stages and thematic-square surfaces are computed
  // from a deterministic ledger rather than accepted from prose or prompt intent.
  // Reversible via =0.
  GATE_SCENE_SPATIAL_UNIT: true,
  GATE_RELATIONSHIP_ARC_LEDGER: true,
  GATE_THEMATIC_SQUARE_TURN: true,
  // Narrative mechanic pressure: flags, scores, skills, items, routes,
  // relationships, information, and encounter outcomes must be earned as
  // on-page pressure and spent as future story permission, not bare state math.
  // Routes through final-contract regen/cluster repair. Reversible via =0.
  GATE_NARRATIVE_MECHANIC_PRESSURE: true,
  // Treatment field utilization: parsed authored treatment fields must become
  // concrete scene/choice/encounter/info/consequence/ending/cliffhanger
  // obligations and then show up fiction-first in final prose. Reversible via =0.
  GATE_TREATMENT_FIELD_UTILIZATION: true,
  // Season promise realization: explicit top-level treatment promises (genre/tone
  // progression, logline engine, core fantasy, audience/premise promise, theme
  // question, inaction pressure) must become visible story material instead of
  // metadata-only guidance. Reversible via =0.
  GATE_SEASON_PROMISE_REALIZATION: true,
  // Protagonist treatment realization: authored protagonist fields (canonical
  // identity, role facts, Want/Need/Lie/Wound/Truth, starting identity, pressure
  // points, climax choice, end states, visual identity) must become traceable
  // plan artifacts and reader-facing character pressure. Reversible via =0.
  GATE_CHARACTER_TREATMENT_REALIZATION: true,
  // Failure-mode audit realization: authored Section 15 QA claims (avoided traps
  // and watch-item mitigations) must be converted into concrete setup/payoff,
  // agency, causality, state-change, fair-play reveal, or thematic-rhyme
  // obligations instead of remaining prompt-only confidence notes. Reversible via =0.
  GATE_FAILURE_MODE_AUDIT_REALIZATION: true,
  // Cluster repair for structural flow defects: when a turn/transition failure is
  // bigger than one missing sentence, rewrite the failed scene plus its immediate
  // neighbors with shared director notes. Runs only inside final-contract repair.
  GATE_SCENE_TURN_CLUSTER_REPAIR: true,
  // 2026-06-09 storytelling-quality audit: characters surfacing without on-page
  // introduction — cold name-drops (bite-me-g10 Victor, prose names him before any
  // scene casts him) and metadata-only presence (endsong-g10 Sylvanor, cast +
  // npcStates but never named in prose). The generative half is live (first-appearance
  // SceneWriter directives, notYetIntroducedNames ban-list, plan-introduction key
  // beats); CharacterIntroductionValidator is the prose-level backstop
  // (PropIntroductionValidator only sees structured ids, never prose).
  // PROMOTED ON 2026-06-27 after the scene-prose repair route gained
  // CharacterIntroductionValidator coverage and Bite Me exposed a first-scene
  // off-page-familiarity regression (new cast written as an already familiar group).
  GATE_CHARACTER_INTRODUCTION: true,
  // G10: per-episode plan-conformance gates (replace the slice-vs-season-target category
  // error). Choice-type / skill BALANCE is validated at the season-plan level; per
  // generated episode we only check it realized what the plan assigned to IT.
  // PROMOTED ON 2026-06-11 (group-A batch), then RETURNED TO SHADOW the same day after
  // GATE_SKILL_PLAN_CONFORMANCE killed the endsong-g14 run at the final contract
  // (failure-cycle audit): per-episode plan conformance has NO remediation path — the
  // season-level skill rebalance runs pre-contract but does not fix per-episode leaning,
  // so a hit is an unavoidable end-of-run abort for a balance defect. DEMOTED TO
  // TELEMETRY + FLAGS DELETED 2026-07-03 (criteria-reduction backlog item 7): the
  // final contract emits conformance findings as warnings unconditionally, so the
  // GATE_CHOICE_TYPE/CONSEQUENCE_TIER/SKILL_PLAN_CONFORMANCE kill-switches were dead
  // and removed. Re-promotion requires a per-episode rebalance autofix (reassign
  // stat-check skills within the episode toward its planned set, mirroring
  // rebalanceSeasonSkillCoverage), or moving the check to generation time.
  // G12: flag setter/consumer contract. Deterministic (a condition reading a flag
  // nothing sets is dead content), but authored orphan conditions are common until
  // the SceneWriter/ChoiceAuthor flag-context wiring beds in — findings ship as
  // warnings by default; flip to blocking after one live run shows a clean baseline.
  GATE_FLAG_CONTRACT: false,
  // WS0.2 (bite-me-g17): residue-consume contract. The flip side of GATE_FLAG_CONTRACT —
  // ~80% of player-choice flags are SET but never READ (g17: 49 write-only), so decisions
  // leave no trace. The generative half: for every consequential set-flag no condition reads,
  // append a flag-gated in-fiction acknowledgment TextVariant to a downstream beat. Drove g17
  // write-only flags 49 -> 1 (the one residual is set in the final beat → pays off in ep4,
  // outside the 3-episode slice). Deterministic + idempotent + golden-parity when every flag
  // is already read. Default-OFF until the corpus + a watched smoke run confirm the injected
  // prose reads cleanly live (WS0.2b adds LLM-authored, scene-specific reads). Enable via =1.
  GATE_RESIDUE_CONSUME: false,
  // G12/WS7: bake witness reactions into outcomeTexts at assembly. reactionText /
  // witnessReactions have NO runtime consumer (storyEngine renders outcomeTexts
  // only), so authored witness reactivity silently dropped. Deterministic, additive
  // concatenation (one reaction sentence per tier, skipped when already present).
  // ON by default like the other pure assembly repairs; reversible via =0.
  GATE_WITNESS_BAKE: true,
  // Encounter-outcome variant: outcome state flags are ALWAYS seeded (ungated). The
  // generative half now exists — when this gate is on, authorEncounterOutcomeVariants
  // runs the OutcomeVariantAuthor over each detected reconvergence desync to write the
  // missing outcome-conditioned opening variants (gated on encounter_<id>_<outcome>)
  // before the contract re-detects, so the gate blocks only on reconvergences the
  // author could not cover.
  // PROMOTED ON 2026-06-10 (G12 audit): the run shipped THREE flag spellings — the
  // seeder keyed on `<sceneId>-encounter`, authored variants on the scene id, and
  // architect storylets on `partial_victory`/`escaped` — so every encounter's outcome
  // residue was dead and this gate, off, never even surfaced the desync.
  // normalizeEncounterOutcomeFlags now unifies setters/consumers at both chokepoints
  // (FullStoryPipeline.authorEncounterOutcomeVariants + enforceFinalStoryContract),
  // making the author's variants reachable at runtime. Reversible via =0.
  GATE_ENCOUNTER_OUTCOME_VARIANT: true,
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
  // PLAN-vs-treatment validators (AuthoredEpisodeConformance, StoryCircleAnchor) are
  // independent of how many episodes were generated and could not be offline-verified
  // (the run did not persist sourceAnalysis); watch them on the next live run.
  // Reversible per-env via STORYRPG / GATE_TREATMENT_SOURCED_ARM=0 (kill-switch).
  GATE_TREATMENT_SOURCED_ARM: true,

  // ── Wave 5: treatment-fidelity §4 gates (Remediation §4.1–§4.5) ──
  // Promoted ON to ENFORCE authored-treatment fidelity (not merely steer it): with
  // these off the validators are dispatched but never block, so a re-cut episode
  // list, an empty encounter anchor, a missing signature device, a mis-scheduled
  // info reveal, or a mis-anchored legacy-structure beat would ship silently. SCOPE: these
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
  // Re-promoted after the Section-6 generative half landed: authored ledger entries are
  // parsed into durable metadata, StoryArchitect assigns setup/reveal/payoff phases to
  // scenes, SceneWriter receives fiction-first information-movement directives, and the
  // choice backstop emits detectable setup/reveal/payoff flags. Partial-season scoping
  // still suppresses future-episode obligations that have not been generated yet.
  GATE_INFORMATION_LEDGER_SCHEDULE: true,
  GATE_SIGNATURE_DEVICE_PRESENCE: true,
  GATE_STORY_CIRCLE_ANCHOR_CONFORMANCE: true,
  // WS2a (CONSISTENCY_PLAN 2026-06-09): reconvergence-residue repair + degrade.
  // The #1 archived-run killer (16 zero-output runs) was the SceneGraphBranchValidator
  // missing_branch_residue ERROR escalating straight to a pipeline abort. With this ON,
  // that finding instead gets (a) ONE targeted SceneCritic regen per offending scene with
  // the residue requirement injected (reconvergenceResidueRepair.ts), and (b) terminal
  // degrade-to-advisory — the story SHIPS with a recorded `[advisory]` warning rather
  // than producing zero output. PROMOTED ON at introduction, mirroring the
  // GATE_FINAL_CONTRACT_REPAIR rationale: it only runs on an ALREADY-FAILING validation,
  // its repair is merge-by-beat-id idempotent, and its terminal state is strictly less
  // destructive than the abort it replaces — it can only rescue a failing run, never
  // fail a passing one. (Residue is also now authored by construction: planning stamps
  // a ResidueRequirement on reconvergence-target blueprints and SceneWriter renders it
  // as a mandatory deliverable, so this gate should rarely fire at all.) Kill-switch:
  // `GATE_RECONVERGENCE_RESIDUE_REPAIR=0` restores the historical hard-abort behavior.
  GATE_RECONVERGENCE_RESIDUE_REPAIR: true,
  // G10: SignatureDevicePresence demoted ALL design-note signatures (anything with an
  // em-dash / parenthetical / >12 tokens) to advisory, so two genuinely-staged-but-
  // verbosely-described signatures that were summarized away (Bite Me ep1 Cișmigiu
  // rescue, Endsong ep3 siege) shipped as mere warnings. With this strict flag on, a
  // PRESENCE failure (keyword overlap < 0.5 → the moment is essentially absent) blocks
  // for concrete staged signatures; only true meta-narration notes ("the player…",
  // "establishes that…") stay advisory. The inversion check remains advisory for long
  // signatures regardless (its proximity heuristic genuinely false-positives there).
  // PROMOTED ON 2026-06-11 (group-A batch): scoped to concrete staged-signature PRESENCE
  // failures (keyword overlap < 0.5) only — true meta-narration notes and the long-signature
  // inversion check stay advisory — so the g10 corpus replay blocked the two summarized-away
  // signatures (Cișmigiu rescue, Endsong siege) without false-positiving. STAYS ON under the
  // repair-first policy (same-day failure-cycle audit): findings are judge-confirmed against
  // the scene's actual prose (GATE_FIDELITY_JUDGE_CONFIRM) and confirmed misses drive the
  // per-scene rewrite (GATE_FINAL_CONTRACT_SCENE_REGEN) before any abort. Reversible via =0.
  GATE_SIGNATURE_PRESENCE_STRICT: true,
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
