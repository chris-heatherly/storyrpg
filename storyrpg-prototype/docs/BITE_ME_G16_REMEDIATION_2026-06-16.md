# Bite Me G16 — Remediation Plan (2026-06-16)

Source audit run: `generated-stories/bite-me-g16_2026-06-16T19-56-53` (completed; the two
earlier g16 timestamps that day aborted pre-final-story).

Two goals:
1. Fix the audited defects **without regression**.
2. **Validate & repair per-episode** as we generate, instead of discovering failure only at
   the season-final story contract.

Key architectural finding: the per-episode validate+repair **seam already exists**
(`FullStoryPipeline.ts:6440-6473`, after each episode's QA + continuity repair, before the
episode returns), and the gates that would block on these defects **already exist with repair
loops** — they are held `default: false` pending a live run, and the final contract currently
**downgrades their errors to warnings**. So most of this is promoting work that is ~80% built
but switched off, plus adding deterministic repairs so the gates have a remediation path.

## Guiding principle — regression safety

> Detection-broadening + deterministic JSON-level repair churns **no** prompt goldens.
> Prompt-text edits churn the 6 `src/ai-agents/pipeline/__goldens__/*.json` snapshots.
> New blocking gates must be registered in **both** `remediation/gateDefaults.ts` and
> `remediation/gateRegistry.ts` with a `repair` route, land **default-OFF**, and be proven on
> one live `=1` run before flipping on (the repair-first policy test `validateGateRegistry`
> enforces the registry shape).

Sequencing: no-golden/default-off first → structural (gated, parity-proven) → prompt/golden
last → one live `=1` run flips gates on.

---

## Audit findings (reconciled, with severity)

Confirmed against runtime `story.json`, not just the generator artifact. Two agent
"blockers" were corrected during verification (noted).

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Blocker | Timeline inversion — ep3 midnight maze (`treatment-enc-3-1`) renders after `s3-4` "Sunday breakfast". QA flagged it (`passesQA:false`) but final contract `passed:true`. | Confirmed |
| 2 | Blocker | Bottleneck encounter re-stages content already played in the preceding standard scenes (rooftop+rescue ep1, kiss ep3); structural root of #1. | Confirmed |
| 3 | Major | Reader-facing POV breaks: ep2 cliffhanger coda in 1st person ("my laptop… I have to choose"); ep3 maze storylet narration in 3rd person ("She smooths the lapel"). | Confirmed |
| 4 | Major | Flag economy inert in-season: ~28-32 player flags set, consumed only by cross-episode payoff hooks windowed to unwritten eps 4-8; no choice changes later rendered content. | Confirmed (partly by-design for a 3-ep slice) |
| 5 | Major | Dropped ep1 plant ("stray dog in courtyard, watching") still referenced by its ep3 payoff. | Confirmed |
| 6 | Major | Skill monotony: persuasion+perception ~57% of stat-check weight; encounters perception 58%/48%; eps used off-plan skills. ("only 4 skills" was overstated — 8 appear.) | Confirmed |
| 7 | Minor | All 3 encounters single-phase (1 decision, 4 outcome storylets) — below the multi-layer tree ideal. (NOT "hollow no-ops" — encounter choices carry full approach/skill/clock mechanics.) | Corrected + confirmed |
| 8 | Minor | Voice-bleed: "This one wants to be with you, love" reused by Mika, Stela, Victor. | Confirmed |
| 9 | Minor | World-rule tension: pivotal Victor kiss beside a running fountain vs strigoi "cannot cross fresh-flowing water". | Soft |
| 10 | Minor | Twist/thread instrumentation skipped: `twist_quality` + `setup_payoff` diagnostics report no ledger; the slow burn is unenforced (how #5 slipped). | Confirmed |
| M1 | Meta | All 21 `npc_pronoun_inconsistency` warnings are FALSE POSITIVES (pronoun near a name referring to a different character). Validator noise that would mask a real misgendering. | Confirmed |
| M2 | Meta | Gating gap: QA continuity error downgraded to warning at final contract (`FinalStoryContractValidator.ts:1065-1104`) because `GATE_QA_CRITICAL_BLOCK` / `GATE_CONTINUITY_REMEDIATION` are off. | Confirmed |

Refuted machine flags (do NOT "fix"): the blog-readership counter IS present and climbing;
the strigoi/pricolici/succubus "Nature" reveals are correctly withheld for the slow burn.

---

## Part 1 — Per-episode validate & repair (WS-A)

Current flow: per-scene incremental validation → per-episode QA + `repairContinuityFindings`
→ **season-final** `enforceFinalStoryContract` (the real bounded repair loop). The aggregate
takes `continuity` from the last episode only (`FullStoryPipeline.ts:5386`).

- **A1** Extract the contract validate-unit to be episode-callable. Reuse the `runValidation`
  closure (`finalContract.ts:161`, already accepts `requestedEpisodeNumbers`); wrap one
  episode as `{episodes:[episode]}` (as the continuity-repair call at `:6454` already does) and
  invoke validate+repair **per episode** at `FullStoryPipeline.ts:6440-6473` / end of
  `processPendingEpisode` after the canon seal (`:5307`).
- **A2** Fire QA/continuity/POV/fidelity gates at **`episode`** placement (the tier already
  exists, `gateRegistry.ts:30`) where a regen costs one episode, driving the existing repair
  handlers (continuity, scene-prose, outcome-text, reconvergence-residue).
- **A3** Keep a thin **season-final** pass for genuinely cross-episode checks only: forward
  continuity, `validateSeasonCompletion` (`:5373`), ending reachability, season skill/choice
  balance. Document the split.
- **A4** Fix the lossy aggregate (`:5383-5394`) to accumulate per-episode continuity.
- **A5** Force sequential episode mode when per-episode continuity needs prior canon
  (`episodeParallelismEnabled`, `:5133`, makes `priorEpisodeSnapshot` incoherent).

Regression posture: reuses existing validators/handlers → no goldens; new `episode`-placement
gates land default-off with repair routes.

---

## Part 2 — Defect workstreams (each repairs at the per-episode seam)

### WS-B — Encounter placement & timeline *(blockers #1/#2)* — **scope: reorder + de-dupe (both)**
Root cause: `seasonScenePlanBuilder.buildEpisodeScenes` (`:577-597`) hardcodes
`setup → development(s) → encounter(s) → release`; `order` is positional with no chronology
field and no reorder step; `bindAuthoredTurnsToScenes` (`:407-411`) + `StoryArchitect.ts:987`
define the anchor as "the encounter, late index".
- **B1** Add a chronology hint to `PlannedScene` (`types/scenePlan.ts`) + an ordering pass in
  `buildEpisodeScenes` (`:591-597`) and `authorScenePlan.normalizeEpisodeScenes` (`:470-499`)
  so the encounter can occupy a non-final slot at its true story-time.
- **B2** New **plan-time** deterministic `ChronologyValidator` (fail-fast before prose),
  reusing time-marker matching (`seasonScenePlanBuilder.ts:219-232`).
- **B3** Re-staging detector: invert `EncounterAnchorContentValidator`
  (`collectReaderFacingTexts` + `tokenOverlapScore`, both exported) to flag/repair when
  encounter prose duplicates an earlier standard scene above threshold.
- Golden risk: scene-plan structural change → gate behind a flag, standard-mode floor, prove
  blueprint-golden parity.

### WS-C — POV enforcement everywhere *(major #3)*
Root cause: `PovClarityValidator` has no first-person detector; the final-contract POV scan is
encounter-only (`FinalStoryContractValidator.ts:592`); the coda is authored after all POV
passes (`cliffhangerRepair.ts:185-215`); `GATE_PROTAGONIST_PRONOUN` is off so the storylet
break only warned.
- **C1** Add `FIRST_PERSON_RE` + `findFirstPersonProtagonistTexts` (mirror the 3rd-person scan,
  `PovClarityValidator.ts:117-135`).
- **C2** Move the POV scan outside the `if(scene.encounter)` block (covers ordinary beats +
  coda).
- **C3** POV check+repair inside coda generation before pushing (`cliffhangerRepair.ts:185-215`).
- **C4** Extend `sceneRealizationGuard` preserve-or-revert to POV on storylets/codas.
- **C5** Promote `GATE_PROTAGONIST_PRONOUN` (or new `GATE_POV_PERSON`) default-on (has
  `repair:'regen'`).
- Golden risk: none.

### WS-D — Treatment plant binding & enforcement *(major #5)*
Root cause: recurring-object plants bind as advisory `tier:'seed'` beats (warn-only at
`RequiredBeatRealizationValidator.ts:302`; skipped at `sceneRealizationGuard.ts:66` and
`EncounterAnchorContentValidator.ts:222`); `treatmentGuidance` has no recurring-object field
(`sourceAnalysis.ts:268-317`) so the plant may never be extracted; payoff is credited against
the planted hook, not on-page seed prose.
- **D1** Add a recurring-object/motif extraction field (`sourceAnalysis.ts` +
  `treatmentExtraction.ts` label match alongside `:335/:364`).
- **D2** New `'recurring'` tier (distinct from advisory `'seed'`) or escalate the recurring
  class to error across the three enforcement points → blocks + scene-time regen per episode.
- **D3** Plant↔payoff cross-check in `callbackLedger.ts`: a payoff referencing a
  recurring-object hook requires its seed rendered earlier; referenced-but-unplanted →
  warning becomes error.
- Golden risk: deterministic; verify `treatmentExtraction` isn't golden-bound.

### WS-E — Skill-rotation enforcement *(major #6)*
Root cause: the only rebalancer (`ChoiceAuthor.rebalanceStatCheckSkills`, `:1222-1260`) is
choice-level/single-skill/season-capped; EncounterArchitect has no rebalancer and never gets
`episodeSkillTargets` — and the meta lives in encounters; the validator doesn't walk encounter
checks. `GATE_SKILL_PLAN_CONFORMANCE` is off because it had no remediation path.
- **E1** New deterministic `repairs/skillPlanRebalanceRepair.ts` (per-episode, post-gen,
  JSON-level): reassign choice stat-check skills toward `skillsForEpisode`, cap any one skill
  ≤40% episode share.
- **E2** Push `episodeSkillTargets` into `EncounterArchitectInput` + deterministic post-gen
  encounter rebalance + per-encounter ≤40% cap (biggest lever).
- **E3** Extend `SkillPlanConformanceValidator` walk to include `scene.encounter` checks.
- **E4** Promote `GATE_SKILL_PLAN_CONFORMANCE`.
- Golden risk: none if post-gen JSON repair; do NOT edit EncounterArchitect/ChoiceAuthor prompt
  text.

### WS-F — Flag economy accuracy + reduction *(major #4)*
Root cause: `FlagContractValidator` walks only the story, no ledger access, so a
future-window-consumed flag is indistinguishable from a true orphan.
- **F1** Make the validator ledger-aware: add `callbackLedger` to
  `FinalStoryContractInput`/`FlagContractInput` (serialized at `runLedger.ts:151`); partition
  future-window-consumed (suppress) vs true orphans (warn).
- **F2** Clamp/abandon hook windows entirely outside the generated episode range in
  `callbackOrchestration.ts`.
- **F3** Disambiguate "set onShow but never read" vs "condition reads unset flag".
- **F4** Promote `GATE_FLAG_CONTRACT`.
- Golden risk: none.

### WS-G — Pronoun validator false positives *(meta — 21 FPs)*
Root cause: `npcPronounResolver.ts:147-192` antecedent guard is name-before-pronoun, not
nearest-antecedent; `ALT_REFERENT_RE` omits agent-nouns; quoted dialogue about a third party
isn't excluded.
- **G1** broaden `ALT_REFERENT_RE` (rescuer/driver/caller/voice/shape/silhouette/hand…).
  **G2** nearest-antecedent guard. **G3** quoted-span guard. **G4** possessive ambiguity guard.
- Protagonist misgendering stays caught via the separate `protagonistPronounResolver` /
  `GATE_PROTAGONIST_PRONOUN` path — untouched.
- Golden risk: none.

### WS-H — Encounter depth *(minor #7)* — **scope: include now (golden regen)**
Root cause: the phased flow structurally emits one top-level phase; multi-phase only comes
from the flat multi-beat flow, routed only to sustained set-pieces;
`EncounterSetPieceDepthValidator` only checks sustained encounters.
- **H1** Broaden the routing/depth predicate: route more encounters through the multi-beat flow
  with a ≥3-beat floor (`EncounterArchitect.getMinimumRequiredBeatCount` `:1057`; routing
  branch `:1653`).
- **H2** Extend `EncounterSetPieceDepthValidator` to all encounters + extend the
  `deepenRootTerminalWins` autofix (gate `GATE_ENCOUNTER_SETPIECE_DEPTH` already on,
  `repair:'autofix'`).
- Golden risk: YES — beat-count floor is interpolated into encounter prompts; regenerate the 6
  `__goldens__` snapshots in the WS-H commit.

### WS-I — Minor craft
- **I1** dedup the stock line "This one wants to be with you, love" (Mika/Stela/Victor) — find
  the leaked payoff string source.
- **I2** optional advisory world-rule proximity check (running-water vs strigoi).
- **I3** wire `TwistArchitect`/`ThreadPlanner` ledger so `setup_payoff`/`twist_quality` stop
  being skipped (the instrumentation gap behind #5).

---

## Milestones

- **M1 — no-golden, default-off: ✅ COMPLETE (2026-06-16, uncommitted).** Suite **2789 green**,
  typecheck clean, lint 0-error/no-new-warning, 6 prompt goldens byte-identical, only
  `season-run-event-sequence.json` regenerated (2 deterministic advisory events).
  - **WS-G** ✅ pronoun FPs: protagonist-aware exclusion + quoted-span/alt-referent/protagonist-gender
    guards → 21 real-story FPs to **0**; genuine misgendering still flags.
  - **WS-C** ✅ POV: first-person detector + deterministic coda coercion (`cliffhangerRepair`);
    final-contract POV scan now covers all scenes (beats+coda). Gate stays off → M4.
  - **WS-A** ✅ per-episode advisory contract pass (`validateEpisodeIncrementally`) +
    aggregate continuity accumulation. Non-blocking; per-episode blocking+repair → M4.
  - **WS-D** ✅ `GATE_TREATMENT_SEED_REALIZATION` (default-off, repair:regen) + validator escalation.
  - **WS-E** ✅ `SkillPlanConformanceValidator` now walks encounter `primarySkill` (the meta's home).
  - **WS-F** ✅ root cause: onShow `{type:'flag'}` is a runtime no-op; `consequenceNormalization.ts`
    rewrites → `setFlag` at assembly + validator is consequence-context-aware. 7 false
    unset-condition errors → **0**.
  - **WS-I1** — reframed: not a code constant (LLM voice-bleed); needs a future repeated-phrase
    validator. Deferred.
- **M2 — WS-B: partial / redirected (2026-06-16).** Investigation showed the *deterministic*
  reorder + de-dupe are **not viable**: g16's timeline inversion is **cross-day** (the coarse
  `timeOfDay` labels can't encode Saturday-night-maze vs Sunday-morning-breakfast — a
  timeOfDay-sort no-ops on it), and the re-staging is **semantic/paraphrased** (token-overlap
  scored 0% on reader prose; the encounter description matched *every* scene 52–69% = noise).
  A token-overlap de-dupe detector was built, proven non-functional on the real case, and
  removed. **Delivered the genuine fix instead:** a StoryArchitect prompt rule
  ("Encounter is the chronological climax") enforcing aftermath-after-encounter ordering + no
  pre-staging of the central beat. 6 prompt goldens regenerated; suite green. Efficacy needs
  the live `=1` run (LLM obedience), per the repo's standard prompt-change pattern.
- **M3 — WS-H: deferred (blocked on live run).** Single-phase is the encounter architecture's
  *default* (the phased flow emits one phase by construction). A detection-only validator would
  flag ~every encounter (noise); a prompt rule alone is ineffective (the converter collapses to
  one phase). The real fix — broaden multi-beat-flow routing + raise the beat floor in
  EncounterArchitect — churns prompt goldens **and** needs a live `=1` run to confirm
  multi-phase encounters generate well.
- **M4 — gate flips: deferred (blocked on live run, by repo discipline).** Flipping any
  default-off gate to blocking needs a working repair path (else it aborts every run) **and**
  one live `=1` run to confirm the LLM repair converges (can't be exercised offline). The
  wiring + detection are in place (M1); the flip is a one-line-per-gate change post-live-run.
  A5 sequential-mode forcing rides the same milestone (only needed once per-episode continuity
  blocks). **This is the long-owed `=1` run; it needs worker/credits.**

## Notes / gotchas (from memory + investigation)
- New gate ⇒ entries in BOTH `gateDefaults.ts` and `gateRegistry.ts` (completeness test).
- `npm run typecheck:app` (base `tsc` stack-overflows).
- Do not run parallel impl subagents in the shared worktree (they clobber via git stash/reset).
- A reader server up makes event-sequence goldens flaky.
- A conditional template block on its own line adds a blank line even when empty → churns all 6
  prompt goldens; INLINE it.
