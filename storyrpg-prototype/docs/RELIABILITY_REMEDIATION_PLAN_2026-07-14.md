# Reliability Remediation Plan — 2026-07-14

**Status:** Waves A–D executed (R0.*–R2.6 landed; live bite-me gate still owed)
**Sources:** `docs/RELIABILITY_AUDIT_2026-07-13.md`, prior canvas audits, Jul 11–14
commit history, live Bite Me / lite-treatment corpus  
**Scope:** Generation reliability and consistency without regressing fiction-first,
ESC authorship, NarrativeRealizationTask ownership, or confirmed semantic-judge
verdicts on real content misses.

---

## 0. One-sentence diagnosis

The Jul 11–13 contract/semantic refactors were the **right architecture** landed
**without repair, feasibility, salvage, or cost ceilings** — so ~43 default-ON
blocking checks × per-scene application (~300–500 kill opportunities) mostly
**abort and discard** instead of **repair and retain**. July success ≈ 11.5%;
Jul 13 = 0%; ~86% of tokens went to discarded runs.

## 1. North-star principles (non-negotiable)

1. **LLMs write; deterministic systems enforce.** Never invent reader-facing prose
   in repair handlers or plan patches.
2. **Confirmed content misses stay blocking.** Do not weaken
   `SemanticRealizationJudge` `content_miss` verdicts to raise pass rate.
3. **ESC remains sole structural author** for `authored_lite`. Plan repair may
   edit ownership/labels/splits; it must not reorder `spineUnitId` or invent
   topology.
4. **Abort → repair → score.** Findings drive repair first; unresolved craft /
   unconfirmed heuristics may ship with QualityScore caps; structural + reader-
   safety + confirmed meaning misses do not silently pass.
5. **Verify-then-fix.** Every item lands with a failing regression test (or
   mined live diagnostic fixture) before the patch. Live bite-me + lite-treatment
   runs gate each wave.
6. **No new default-ON blockers** until Wave A live runs show the semantic
   collapse is gone and the kill table (R0.10) exists.
7. **Commit hygiene.** Explicit paths only; never `git add -A`. Prefer one
   workstream per commit.

### Explicit non-goals

- Rolling back NarrativeRealizationTask / semantic IR / ESC ownership
- Re-hardening TreatmentFidelity / DramaticStructure as craft hard-aborts
- Inventing deterministic fallback prose for reader surfaces
- Blanket “fail-open judge” or blanket “ship all fidelity with caps” on
  treatment-bound runs

---

## 2. Target outcomes

| Checkpoint | Success rate (directional) | Must also be true |
|---|---|---|
| After Wave A | Jul-13-class runs recover sharply; July-mix ~20–30% | Semantic pronoun/authority kills gone; router covers new validators; QA freeze fixed if R0.12 pulled |
| After Wave B | Same pass rate, far lower waste | Every failure leaves `partial-story.json`; runaway token burns stop; ledger attributed |
| After Wave C | ~50–65% on bite-me + lite-treatment | Plan-time wall has a real repair rung; resume stops identical loops |
| After Wave D | Path to 80%+ stable | ≤15 hard blockers; repair-first on every default-ON gate; kill-table-driven demotions |

Failures that remain must be **cheaper** (ceilings), **salvageable** (partials),
and **attributed** (honest ledger + UI).

---

## 3. Wave A — Stop the 0% days (days)

**Goal:** Fix broken checking/repair machinery behind the Jul 11–13 collapse.  
**Exit:** Two consecutive bite-me runs and one lite-treatment run get past scene 1
owner-stage without `OwnerStageRealizationBlocker` on pronoun/canonical-identity
atoms; `npm test` green for touched packages; `typecheck:app` clean.

### R0.1 — Unified evidence counting + honor `required: false`

**Problem:** `minimumEvidenceHits` / satisfaction counting can treat optional
semantic atoms as hard misses when the threshold is unmet
(`realizationTaskGate.ts` ~504–505). Live Bite Me
(`bite-me_2026-07-13T23-59-58`) died on
`…canonical-identity…:semantic:2` (“uses she/her”), `required: false`, while
prose was correct second-person.

**Fix:**
- Count mechanical + semantic passes in **one** satisfaction expression
  (`realizationTaskSatisfaction.ts` / coordinator combine path).
- `required: false` atoms never enter the blocking missing set solely to pad a
  threshold.
- Preflight/migrate: strip live `canonical_identity` premise tasks that migration
  already claims to remove (`narrativeContractMigration.ts`) but still appear in
  production graphs.

**Verify:** Fixture from `episode-1-scene-s1-1-realization-blockers.json` + unit
tests: name literal hit alone satisfies `minimumEvidenceHits: 1`; optional
pronoun miss does not block.

**Done when:** Repro test red→green; no `canonical_identity` owner tasks in a
fresh authored_lite compile.

### R0.2 — POV / feasibility downgrade of impossible atoms

**Problem:** Character-sheet metadata compiled into prose obligations (pronouns,
naming-as-third-person, pure interiority) that second-person fiction cannot show.

**Fix:** Plan-time feasibility pass after task compile:
- If protagonist POV is second-person, pronoun-form obligations → advisory /
  artifact-invariant (not owner-stage blocking).
- Naming obligations that require third-person reference of the PC → literal
  optional or deferred to non-you surfaces only.
- Pure-interiority criteria without externalizable behavior → advisory.

**Verify:** Compiler/feasibility tests with you-POV brief; Bite Me opening scene
no longer owns she/her as blocking.

**Done when:** Fresh compile of Bite Me treatment produces zero blocking pronoun
atoms on s1-1.

### R0.3 — Reconnect repair router to renamed validators

**Problem:** `gateRepairRouter.ts` matches `NarrativeContractValidator` only;
`SemanticRealizationJudge` / owner-stage semantic findings fall to
`diagnostic_stop`. QARunner never had a route. Same bug class as Jul 3 rename
regression.

**Fix:**
- Add explicit `routeIssue` rules for `SemanticRealizationJudge` /
  owner-stage realization codes → `same_scene_retry` /
  `premise_realization` / existing repairHandler field.
- Add QARunner → appropriate cleanup or scene retry (not architecture dead-end).
- Extend `repairRouteCoverage.test.ts` so unknown new validator names fail CI.

**Verify:** Coverage test fails if SemanticRealizationJudge is omitted; fixture
issues route to non-`diagnostic_stop`.

### R0.4 — Skip byte-identical elaborate retries + ESC failure metadata

**Problem:** Treatment-sourced StoryArchitect is deterministic
(`StoryArchitect.ts` ~5266+), but `EpisodeArchitecturePhase.ts` ~303 appends
conflict feedback into `userPrompt` that elaborate mode never reads. Retries
re-derive identical blueprints while burning LLM calls (`reauthorGenericTurns`).
EpisodeSpineContract returns `success:false` with **no** failure metadata
(~5040–5059) → first-hit abort.

**Fix:**
- Attach `PipelineFailureMetadata` (`retryClass`, `repairTarget: 'scene-plan'`,
  codes) to ESC failures.
- In elaborate/treatment mode: if blueprint hash unchanged after a “retry,” skip
  further LLM-feedback retries and surface structured failure toward plan-repair
  (Wave C) instead of burning attempts.
- Do **not** “tighten feedback text” for elaborate mode — it cannot help.

**Verify:** Unit/integration: elaborate conflict path performs at most one
deterministic recompile; second attempt with identical hash short-circuits.

### R0.5 — Un-freeze QA findings at final contract *(pulled forward)*

**Problem:** `finalContract.ts` ~1026 passes frozen `input.qaReport` into every
revalidation → `qa_blocker_present` / `continuity_error` can never clear after
prose repair (~28 July runs).

**Fix (prefer cheapest correct):**
- Option A (best): re-run the continuity/QA critical extraction on the current
  story each revalidation (or null QA blockers when scene hash changed and no
  fresh corroboration — mirror `reconcileFrozenIncrementalFlags`).
- Option B: drop frozen QA from blocking set after a successful scene-local
  repair that touches the cited sceneIds, unless a fresh QA pass re-asserts.

**Verify:** Fixture where frozen QA fails but repaired story has no continuity
error → second validate passes (or downgrades).

**Note:** This was Phase 1 in the sibling plan; it belongs in Wave A because it
is small and high kill-share.

### R0.6 — Repair-loop revert-and-continue

**Problem:** `finalContractRepair.ts` ~513–537: on introduced blocking
fingerprints, reverts **and `break`s** the entire loop.

**Fix:** Revert that round’s story, exclude the offending handler/scene from the
remainder of the round (or mark fingerprints unschedulable), continue other
repairable issues.

**Verify:** Multi-issue fixture where one handler introduces a fingerprint and
another could clear a different issue → second issue still attempted.

### Wave A live gate

```bash
# from storyrpg-prototype/
npm test -- realizationTaskSatisfaction realizationTaskGate repairRouteCoverage
npm run typecheck:app
# then operator: bite-me ×2, lite-treatment ×1 through owner-stage scene 1–2
```

---

## 4. Wave B — Stop burning money / fly blind (days, parallelizable)

**Goal:** Failures become cheap, salvageable, and diagnosable.  
**Exit:** Failed worker runs under ceiling leave `partial-story.json` + attributed
ledger rows; Generator UI shows typed failure fields.

### R0.7 — StoryArchitect truncation ladder

**Problem:** `TruncatedLLMResponseError` is non-retryable in BaseAgent; StoryArchitect
classifier doesn’t map truncation → retryable; other agents already have compact
retry.

**Fix:** Mirror ChoiceAuthor/SceneWriter compact-retry; classify truncation as
`retryClass: 'adjust_call_budget'`; one compact retry; optional budget bump on
second attempt only.

**Verify:** Truncation fixture retries once with compact instruction; no instant abort.

### R0.8 — Judge as stable instrument *(narrowed)*

**Problem:** Judge at temp 0.2; long quote requirements; inconclusives uncached →
replay can abort on judge noise; inconclusive treated as content defect.

**Fix:**
- Temperature **0**; short excerpt labels (E1, E2…); keep schema aligned with
  existing “quotes derived from cited spans” comment in
  `SemanticRealizationJudge.ts`.
- Cache inconclusive/unavailable receipts for snapshot replay identity.
- **Policy:** `INCONCLUSIVE` / `UNAVAILABLE` → infrastructure outcome (retry judge,
  do **not** spend authored repair budget). After infra retries exhausted:
  owner-stage may warn + defer to final regression. Final regression still needs
  a settled verdict **or** an explicit ship-with-cap policy — **never** silent pass
  on unresolved meaning for event-critical tasks.
- Confirmed `content_miss` remains blocking.

**Verify:** Flaky inconclusive no longer flips adopt/reject; infra path does not
debit remediation budget.

### R0.9 — Default cost ceilings + charge owner-stage patches

**Problem:** `tokenBudgetPerStory` opt-in; `remediationBudgetTotal` default 1000;
owner-stage semantic patches uncharged → 15–30 min / ~1M token zero-output runs.

**Fix:**
- Default worker token ceiling from success corpus (~330K avg success → start
  ~1.0–1.5M hard ceiling; env-overridable).
- Lower default remediation budget to a realistic cap (e.g. 24–48) with
  per-stage sub-budgets.
- Debit owner-stage patch + full-regen attempts via `recordRemediationSafe` /
  `RemediationBudget`.

**Verify:** Synthetic runaway aborts at ceiling with structured
`failureKind: 'token_budget'`; owner patch increments remediation counters.

### R0.10 — Partial salvage on all abort paths

**Problem:** `savePartialStory` only at multi-episode late assembly
(`FullStoryPipeline.ts` ~5892). Single-episode / early owner-stage aborts leave
no playable/diagnostic package.

**Fix:**
- Write `partial-story.json` after each completed scene-wave watermark and on
  every abort path that has any assembled scenes/episodes.
- Never catalog (`story.json` publish) until text contract passes.
- Include failure metadata pointer in partial manifest.

**Verify:** Forced owner-stage abort after s1-1 success writes partial with s1-1.

### R0.11 — Honest ledger + gate-config hash + kill table

**Problem:** 181/214 failed July rows show `remediationsAttempted: 0` (undercount);
43 failures lack `failureKind`; gate defaults changed 8+ times without config hash.

**Fix:**
- Record attempted-and-rejected repairs + owner-stage patches.
- Stamp failed rows: top blocking validator/type, `failureCode`, `ownerStage`,
  `repairTarget`, **resolved gate-config hash**.
- Script: `scripts/gate-kill-table.mjs` (or ts) over `99-pipeline-errors.json` +
  ledger → per-gate kill rate / FP candidates.

**Verify:** Owner-stage fail shows remediationsAttempted ≥ 1; kill-table script
runs on July corpus.

### R0.12 — Typed failures in Generator UI

**Problem:** `PipelineError` metadata exists through worker/proxy; UI shows
phase/step/kind only.

**Fix:** Surface `failureCode`, `failureOwnerStage`, `retryClass`, `repairTarget`,
link/path to `99-pipeline-errors.json` in Generator failure workspace.

**Verify:** Manual or component test with mocked failureContext.

### Wave B live gate

Failed bite-me under ceiling leaves partial + attributed ledger; UI shows code +
owner stage. Kill table generates without hand mining.

---

## 5. Wave C — Make repair the default (1–2 weeks)

**Goal:** Plan wall and owner-stage stops discarding validated work; resume works.  
**Exit:** Plan-gate failures attempt bounded plan-repair; owner-stage escalates
before abort; resume refuses identical fingerprints.

### R1.1 — Plan-repair rung for construction / density / architecture contracts

**Problem:** ~27% of July kills. Defect lives in season scene plan; pipeline does
one mechanical recompile then aborts. Feedback to StoryArchitect cannot help in
elaborate mode (Wave A R0.4).

**Fix:** Bounded LLM **plan** repair (1–2 attempts):
- Input: gate findings with per-scene evidence + repair instructions.
- Edit only offending `plannedScenes` (split, move obligation, rename colliding
  turn, adjust location labels).
- Recompile EpisodeEventPlan / ownership; revalidate.
- **Authored_lite ESC guard:** forbid spine order / `spineUnitId` mutation;
  structural refresh goes through `rebuildTreatmentSeasonScenePlan` /
  ESC compile, not freeform plan LLM.

**Verify:** SceneConstructionGate / relationship-label fixture clears via plan
repair without ESC order drift.

### R1.2 — Owner-stage escalate, then final-repair — don’t naked-defer

**Problem:** 2 patches then run abort; post-assembly regression has no repair.

**Fix ladder:**
1. Targeted semantic patches (existing, improved feedback into attempt 2).
2. One full SceneWriter regen with missing-atom feedback.
3. Hand off to final-contract repair **only if** R0.3 routes exist for the codes.
4. Abort only if event/premise-**critical** tasks still miss after final repair.

**Do not** degrade premise/event obligations to warning unless step 3 can clear
them. That only moves the 0% day later.

**Verify:** Fixture clears on step 2 or 3; critical miss still blocks at end.

### R1.3 — Adoption by task miss-count + single re-sample

**Problem:** `shouldAdoptOwnerRepairCandidate` fingerprint-subset rejects real
progress when judge noise flips a sibling atom (`realizationTaskGate.ts` ~78–101).

**Fix:** Compare per-task missing counts; allow adoption when target fingerprint
clears and total task misses do not increase; re-sample a single newly appeared
claim once before rejecting.

**Verify:** Replay of rejected-but-improved candidate from live repair JSON adopts.

### R1.4 — Fidelity heuristics behind judge *(narrowed)*

**Problem:** `treatment_fidelity_violation` dominates final-contract issues;
architecture-class routes point at missing executors.

**Fix:**
- Extend `GATE_FIDELITY_JUDGE_CONFIRM` to NarrativeContract / TreatmentEventLedger /
  RelationshipArcLedger heuristic hits.
- Confirmed miss → prose repair (not dead `blueprint_rebalance` with no executor).
- Unconfirmed heuristic → **invent-mode:** ship-with-cap; **authored_lite /
  treatment-bound:** remain blocking until judge or repair clears.
- Implement or remove dead architecture executors at final contract (no silent
  withhold).

**Verify:** Heuristic-only paraphrase divergence does not block invent-mode;
authored_lite true miss still blocks until cleared.

### R1.5 — Resume carry-forward + loop-breaker

**Problem:** Resume reloads pre-repair content; repaired candidates on disk unread;
identical failure ×13 with no breaker.

**Fix:** Resume from `partial-story.json` / repair snapshot; store failure
fingerprint in checkpoint; on identical fingerprint, refuse with structured
`failureKind: 'deterministic_resume_loop'`.

**Verify:** Second resume of same fingerprint aborts immediately with message.

### R1.6 — Cross-run artifact reuse

**Problem:** World/character/source analysis regenerated every fresh run.

**Fix:** Content-addressed cache keyed by hash(brief + treatment + model config +
compiler versions); hydrate on cache hit. Invalidate on hash mismatch.

**Verify:** Second run with identical inputs skips world/character LLM calls.

### R1.7 — Planner structured output + cache alignment + cancellable timeout

**Fix:** StoryArchitect / SeasonPlanner onto provider `jsonSchema` where possible;
move static instruction blocks into cache-controlled system prompt; replace
`withTimeout` with `withTimeoutAbort` in `EpisodeArchitecturePhase`.

**Verify:** Prompt snapshot shows static prefix in system; timeout cancels in-flight.

### R1.8 — Compile-time cross-authority contradictions

**Problem:** Required semantic “befriends” vs forbidden literal `friend` in same
scene.

**Fix:** Extend contradiction check across forbidden literals vs required semantic
stems/descriptions; fail at plan time.

**Verify:** Synthetic contradictory plan fails preflight before SceneWriter.

### Wave C live gate

bite-me + lite-treatment: plan-gate failures show plan-repair attempts in ledger;
owner-stage no longer aborts solely after 2 silent patches; resume loop-breaker
fires in a forced identical-resume test.

---

## 6. Wave D — Durable architecture (weeks; after A–C prove out)

**Goal:** Beat compounding math without lowering the quality bar.

### R2.1 — Hard core ≤15 default-ON blockers; score the rest

Keep blocking: graph reachability, package/structural integrity, fiction-first
reader safety (stubs/fallbacks/mechanics leaks/POV corruption), confirmed
semantic event/premise misses after repair exhaustion.

Move craft / pacing / unconfirmed fidelity / ledger heuristics into QualityScore
v4 ship-with-cap band.

**Rule:** Each demotion justified by R0.11 kill table + one live run proof.

### R2.2 — Repair-first registry for every default-ON blocking placement

Extend `validateGateRegistry` from season-final-only to plan / scene /
owner-stage. CI fails if a default-ON blocker lacks repair route or documented
terminal policy.

### R2.3 — Frontier season gate enforcement

Replace `seasonGateEnforcement = () => false` with hard enforcement for episodes
≤ generation frontier (+1), shadow beyond.

### R2.4 — Genre-neutral lexicon migration

Finish Bite-Me-specific cue → neutral / LLM adjudication for semantic staging
judgment. Flip default lexicon after corpus regen.

### R2.5 — Generate-to-satisfy

Construction constraints in planning prompts + deterministic post-passes; ESC
elaboration as patch onto frozen spine so drift is impossible rather than
detected.

### R2.6 — Housekeeping

- Extract next `FullStoryPipeline.ts` cluster; get under ratchet baseline **9461**
  (currently **9557**, +96).
- Add ratchet for `ContentGenerationPhase.ts` (**5169** lines, unracheted).
- Reliability dashboard artifact from R0.11 telemetry (tokens, remediation by
  stage, truncation, gate kill rates).

---

## 7. Sequencing (do not reorder casually)

```
Wave A:  R0.1 → R0.3 → R0.2 → R0.4 → R0.5 → R0.6
Wave B:  R0.9 ∥ R0.10 ∥ R0.11 ∥ R0.12 ∥ R0.7 ∥ R0.8′
Wave C:  R1.1 → R1.2 → R1.3 → R1.4′ → R1.5 → R1.8 → R1.6 → R1.7
Wave D:  R0.11 kill-table drives R2.1 gate-by-gate → R2.2 → R2.3 → R2.4 → R2.5 → R2.6
```

Parallelism allowed only within Wave B and for pure tests vs docs. No parallel
impl agents in the shared worktree (house rule from Jul 1 remediation).

---

## 8. Verification matrix (every item)

| Layer | Command / action |
|---|---|
| Unit | Focused Vitest for the module under change |
| Types | `npm run typecheck:app` |
| Registry | Gate/validator registry completeness tests if flags touched |
| Goldens | No unexplained prompt/event golden churn |
| Live | bite-me + lite-treatment watched runs per wave exit criteria |
| Corpus | After Wave B: kill table on last N runs; trend success rate |

Do **not** declare a wave done on unit tests alone.

---

## 9. Relationship to recent refactors

**Keep:** NarrativeRealizationTask ownership, semantic IR, ESC sole authorship,
owner-stage validation before checkpoint, fiction-first, repair-first intent.

**Fix:** Counting bugs, feasibility, router rename gap, abort-without-salvage,
uncapped cost, frozen QA, identical elaborate retries, fingerprint-hostile
adoption, missing plan-repair rung.

**Do not:** Revert the Jul 11–13 architecture push. Complete its landing gear.

---

## 10. Execution log

_(Update as work lands.)_

| ID | Status | Commit / notes |
|---|---|---|
| R0.1 | done (`da06e386`) | Optional atoms never pad threshold misses; Bite Me fixture test; builds on cdf25022 mixed-authority fix |
| R0.2 | done (`da06e386`) | Second-person pronoun atoms stripped at task compile (`isSecondPersonUnrealizablePronounAtom`) |
| R0.3 | done (`da06e386`) | `SemanticRealizationJudge` + `QARunner` router rules + coverage tests |
| R0.4 | done (`da06e386`) | ESC failure metadata; skip identical elaborate-mode architecture retries |
| R0.5 | done (`da06e386`) | Frozen QA/best-practices applied on first final-contract validation pass only |
| R0.6 | done (`da06e386`) | Introduced-fingerprint rounds revert and continue (no full loop break) |
| R0.7 | done | StoryArchitect compact truncation ladder + `adjust_call_budget` metadata |
| R0.8 | done | Judge temp 0; E1/E2 excerpt labels; cache infra outcomes; owner skips authored repair on inconclusive |
| R0.9 | done (`da06e386`) | Default token ceiling 1.5M; remediation budget default 48; semantic-patch failures recorded |
| R0.10 | done (`da06e386`) | `partial-story.json` before single-episode final contract + on generate() abort |
| R0.11 | done | Failed ledger stamps code/owner/repairTarget/gateConfigHash; `npm run validation:kill-table` |
| R0.12 | done | Generator failure workspace surfaces typed failure fields + `99-pipeline-errors.json` path |
| R1.1 | done | Bounded planned-scene repair via treatment-spine rebuild + EpisodeEventPlan recompile |
| R1.2 | done | Owner-stage full SceneWriter regen + defer non-critical to final; critical still aborts |
| R1.3 | done | Adoption by non-increasing task miss-count + single re-sample of new claim |
| R1.4 | done | Extended fidelity judge confirm set; scene-local RelationshipArcLedger → same_scene_retry |
| R1.5 | done | Resume loop-breaker on identical failure fingerprint without patches |
| R1.6 | done | Foundation artifact cache for world/character bibles |
| R1.7 | done | StoryArchitect/SeasonPlanner jsonSchema + EpisodeArchitecturePhase withTimeoutAbort |
| R1.8 | done | Compile-time semantic↔literal contradiction preflight |
| R2.1 | done | Demoted unrepaired plan craft gates (density/budget/arc/fanout) to default-OFF |
| R2.2 | done | Repair-first registry extended to plan/scene/episode/season-final |
| R2.3 | done | Season gate frontier enforcement (`createSeasonGateEnforcement`) |
| R2.4 | done | Lexicon flip via `STORYRPG_STORY_LEXICON=genre_neutral` (Bite-Me default until corpus regen) |
| R2.5 | done | Generate-to-satisfy planner + ESC elaboration constraint blocks |
| R2.6 | done | Extracted plan craft gates + visual audit; FSP ≤9459; ContentGenerationPhase ratchet |

---

## 11. First action when execution starts

Start **Wave A** at **R0.1** (evidence counting + strip live canonical_identity),
then **R0.3** (router), with verify-then-fix tests derived from
`generated-stories/bite-me_2026-07-13T23-59-58/episode-1-scene-s1-1-realization-blockers.json`.
