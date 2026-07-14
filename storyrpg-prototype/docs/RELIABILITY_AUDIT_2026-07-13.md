# Reliability Audit — 2026-07-13

Architectural and code audit of the generation pipeline, grounded in the July 2026
production corpus (191 unique runs, 169 failure diagnostics mined) plus five
targeted code audits (plan-time gates, semantic validation stack, remediation
routing, LLM layer, systemic architecture). All paths relative to
`storyrpg-prototype/`.

## 0. The numbers

- **July success rate: 22/191 unique runs (11.5%).** Trend is *down*: 07-11 = 7%,
  07-12 = 4%, 07-13 = **0%** (coinciding with the semantic-validation stack landing).
- **181 of 214 failed ledger entries recorded `remediationsAttempted: 0`** — the
  pipeline mostly aborts instead of repairing (part real, part telemetry undercount; see §4).
- **43.1M tokens (86% of all July spend) went to failed runs**; 7.2M to successes.
- Resume is not a recovery path in practice: one run failed 13 consecutive resumes
  identically (deterministic re-failure, no loop-breaker).

### Kill distribution (mined from `99-pipeline-errors.json` across all July runs)

| Kill zone | Share | Top signatures |
|---|---|---|
| Episode-1 final contract (`incremental_contract_ep_1`) | ~35% | `treatment_fidelity_violation` (108 issues), `qa_blocker_present` (18 runs), `outcome_text_stub`, `unsafe_fallback_prose` |
| Plan-time architecture wall | ~27% | SceneConstructionGate (~39 runs), EpisodeSpineContract (11), duplicate-dramatic-turn (7), blocked-relationship-label / multi-location regex heuristics |
| Owner-stage semantic blockers (new) | ~8% and growing | `OwnerStageRealizationBlocker` (19 runs in 3 days), `SemanticValidationInconclusive` |
| Unattributed / code crashes | ~30% | `failureKind: null` (43), `Error`/`TypeError` (21) |

Final-contract blocking issues by validator (issues / distinct runs killed):
NarrativeContractValidator 52/18 · RelationshipArcLedgerValidator 33/21 ·
OutcomeTextQualityValidator 25/5 · RouteContinuityValidator 22/11 ·
TreatmentEventLedgerValidator 19/17 · QARunner 18/18 · ContinuityChecker 10/10 ·
SceneTurnRealizationValidator 10/5 · CharacterIntroductionValidator 8/5.

## 1. The systemic diagnosis: compounding enforcement surface

The 11% success rate is what the architecture predicts, independent of any single bug.

- **90 registered gates** (`remediation/gateRegistry.ts:102-295`), 62 blocking,
  **43 blocking AND default-ON**; **92 validator registry entries**, 55 blocking
  (36 at final stage). ~85 of the blocking checks are regex/keyword/count
  heuristics evaluating LLM prose; only ~7 surfaces are LLM-judged.
- Scene-scoped gates apply per scene (~10–14 scenes + choices + encounters), so a
  run faces **~300–500 blocking check applications** before episode 1 can lock.
  At 99.5% per-application reliability, 0.995^400 ≈ **13.4% expected success** —
  observed is 11.5%. To reach 80% success you need either ~99.94% per-application
  reliability (unreachable for keyword heuristics over creative prose) or **~10×
  fewer independent kill points**.
- The repo's own repair-first guardrail (`validateGateRegistry`,
  gateRegistry.ts:365-401) enforces repair routes **only for season-final
  placement**. The kills migrated upstream (plan / scene / owner-stage), where the
  policy doesn't apply.
- Config: ~136 env toggles (46 `STORYRPG_*` + 90 `GATE_*`), gate defaults edited
  ≥8× in July, and **runs don't record their resolved gate config**, so the corpus
  conflates config drift with content variance.

**Pattern conflicts that generate failures by construction:**
1. Three stochastic generations (treatment → plan → prose) cross-checked by
   deterministic keyword-overlap heuristics → legitimate paraphrase divergence is
   scored as defect (`treatment_fidelity_violation`, the #1 issue class).
2. Deterministic replanning of deterministic conflicts → identical blueprint on
   retry, guaranteed re-failure (§2).
3. LLM-validating-LLM, fail-closed → judge indecision/outage treated as content
   defect (§3).
4. Measurement duplication: `MAJOR_EVIDENCE_RE` in 3 files; gateRegistry +
   validatorRegistry + call sites as three drift-prone bookkeeping layers.

## 2. Kill zone A — plan-time architecture wall (~27%)

**Root cause: treatment-sourced (elaborate) runs have a deterministic Story
Architect, but every retry mechanism assumes an LLM is listening.**
In elaborate mode the blueprint is built by `buildBlueprintFromPlannedScenes`
with no LLM call (`StoryArchitect.ts:5266-5269`); `input.userPrompt` is only read
on the invention path (`:6070`). Yet:

- Deterministic-conflict retries append findings to `architectureInput.userPrompt`
  (`phases/EpisodeArchitecturePhase.ts:303-307`) — a **no-op**; attempts 2–3
  re-derive a byte-identical blueprint (while burning real LLM calls in
  `reauthorGenericTurns`), then abort (`:391-410`).
- SceneConstructionGate/TreatmentDensityGate failures get one **deterministic**
  recompile (`:322-349`) — no feedback anywhere — then abort (`:412-414`).
- EpisodeSpineContract failures return `success:false` with **no failure
  metadata** (`StoryArchitect.ts:5034-5060`) → no retry class matches → first-failure abort.
- The defect usually lives one stage upstream (season scene plan / ESC), but **no
  code path routes plan-gate findings back to plan authoring**. `repairTarget:
  'scene-plan'` is emitted (`StoryArchitect.ts:5326`) but only logs consume it.

**False-positive factories** (all deterministic-heuristic, with documented FP
trails in their own comments — 19 "bite-me" incident references across the cue files):
- `LOCATION_RE` capitalized-phrase mining (`sceneLocationCues.ts`) — ≥4
  story-specific FP patches (person names mined as places, gerund titles).
- `storyEventCues.ts` regex lexicon — effectively hard-coded to the Bite Me story
  shape; largest abort-message class.
- `PLAN_RELATIONSHIP_STAGE_CONTRADICTION` — bare word-boundary regex with a
  narrow negation window (`architectureContractPreflight.ts:190-236`).
- Duplicate-dramatic-turn Jaccard ≥0.9 lexical fallback (`:159`).
- Multi-time-cue counting ("that evening" + "later" = conflict)
  (`sceneConstructionProfile.ts:113,927-931`).
- `[DramaticStructure]`/`[SceneTurnContract]` craft warnings promoted to blocking
  via defaultOn (`gateRegistry.ts:192-193`) despite the "default-off guarantee"
  comment in `architectGatePolicy.ts`.

## 3. Kill zone B — semantic validation stack (~8%, newest, 0%-success days)

Stack: LLM-compiled semantic IR (1–8 propositions/event, `semanticContractIr.ts:154-196`)
→ atoms → always-blocking owner tasks with `'all'` evidence groups
(`realizationTaskCompiler.ts:263-333`) → `SemanticRealizationJudge` (temp 0.2,
1-vote pass / 2-vote fail / 3rd-call adjudication, `semanticValidationCoordinator.ts:243-296`)
→ 2-patch budget → `PipelineError [OwnerStageRealizationBlocker]`
(`phases/ContentGenerationPhase.ts:2663`). Verified root causes (reproduced from
run diagnostics on HEAD):

- **RC1 — authority-silo bug**: `minimumEvidenceHits` is applied to semantic
  atoms only (`semanticValidationCoordinator.ts:378,405-412`; mirror silo at
  `realizationTaskGate.ts:489`), so a deterministic pass can't satisfy the
  threshold and a `required: false` atom becomes a de-facto hard blocker. This
  killed the freshest run (pronoun atom).
- **RC2 — unsatisfiable compiled obligations**: character-sheet metadata compiled
  into prose obligations (`narrativeContractCompiler.ts:988-1012`) — "uses
  she/her pronouns" can never be realized in second-person POV; `partial` on
  interiority criteria counts as total miss (`semanticValidationCoordinator.ts:62-67`).
  The G12 pronoun landmine reborn at plan time.
- **RC3 — monotonic adoption rejects real progress**: judge vote noise flips a
  sibling atom, fingerprint-subset test rejects the candidate
  (`realizationTaskGate.ts:74-97`) → `candidate_rejected` ×2 → abort.
- **RC4 — compiled gate conflicts**: required semantic atom "befriends" coexists
  with forbidden literal `blocked:friend` (`realizationTaskGate.ts:296-317`);
  contradiction checker only covers literal-vs-literal (`realizationTaskCompiler.ts:373+`).
- **RC5 — fail-closed measurement**: `SEMANTIC_VALIDATION_UNAVAILABLE` /
  `INCONCLUSIVE` are blocking findings (`semanticValidationCoordinator.ts:473-494`);
  inconclusives are never cached (`:289-292`) so the determinism replay-check
  re-rolls the judge and can abort on its own nondeterminism
  (`ContentGenerationPhase.ts:2561-2586`). Post-assembly regression gate has no
  repair loop at all (`:4843-4961`). `retryClass: 'repair_scene_prose'` is
  attached but nothing consumes it.
- Cost: the judge accounted for 11 of 19 LLM calls in a sampled failed run. Judge
  rides the same provider config as the author (`FullStoryPipeline.ts:1036-1038`)
  → correlated failure modes.

## 4. Kill zone C — final contract + remediation routing (~35%)

The router/repair machinery exists (`remediation/gateRepairRouter.ts:632-1109`,
`finalContractRepair.ts:420-591`, 3 rounds / 2 per-issue / 4 scenes per round)
but four mechanisms produce zero-remediation aborts:

1. **All-architecture reports skip every LLM handler.** Issues routed
   `blueprint_rebalance` / `episode_replan` / `diagnostic_stop` are withheld by
   `guardLlmContractRepairForArchitecture` (`finalContract.ts:198-228`); if *all*
   blockers are architecture-class, round 1 changes nothing → fixpoint break →
   abort. **No executor exists** for `blueprint_rebalance`/`episode_replan` at the
   final contract — the hinted routes (`finalContract.ts:190-193`) are never called.
   RelationshipArcLedgerValidator (#2 killer, 21 runs) routes here.
2. **Frozen inputs make repair futile by construction.** `qaReport` is passed
   frozen into every revalidation (`finalContract.ts:1026`); `qa_blocker_present`
   (18 runs) and `continuity_error` (10 runs) re-read the same report object and
   can never clear regardless of prose repairs. No QA-side analog of
   `reconcileFrozenIncrementalFlags`.
3. **Unroutable finding types default to `diagnostic_stop`** (starves repair):
   `QARunner` (no rule at all), **`SemanticRealizationJudge` (live regression —
   router rules match `validator === 'NarrativeContractValidator'` only,
   `gateRepairRouter.ts:787`; zero references to the new validator name in
   `remediation/`)**, `choice_bridge_sibling_leak`, `unsafe_fallback_prose`
   without sceneId, `failed_incremental_validation`.
4. **Telemetry undercount + loop kill switch.** Attempted-but-rejected repairs
   record nothing (`sceneProseRepairHandler.ts:1328-1347`;
   `runLedger.recordRemediationSafe` is the only incrementer, `runLedger.ts:85-104`)
   — and the owner-stage patch loop never calls it at all, so real repair
   attempts ledger as 0. `rejectIntroducedBlockingIssues` **breaks the entire
   loop** on one introduced fingerprint (`finalContractRepair.ts:513-537`).

**Resume**: rehydrates episodes from watermarks **including frozen per-episode QA
reports** (`FullStoryPipeline.ts:5333-5366`); the previous attempt's repaired
candidate (`partial-story.json`, `repair-snapshots/round-NN.json`) is **never
reloaded** (zero readers outside tests); no failure-fingerprint comparison across
the resume chain → deterministic identical re-failure, unbounded.

## 5. Kill zone D — LLM layer

- **StoryArchitect truncation → instant abort.** `TruncatedLLMResponseError` is
  deliberately not retried (`BaseAgent.ts:831-833`); SceneWriter/ChoiceAuthor/
  CharacterDesigner have compact-retry ladders, **StoryArchitect has none** and
  `classifyBlueprintFailure` has no pattern for "Truncated LLM response"
  (`StoryArchitect.ts:5991-5993`) → `retryable=false`, no metadata →
  `retryClass:'none'` → abort. No continuation request exists anywhere.
- **Heaviest planners bypass structured output.** StoryArchitect (32k-token
  blueprints, `StoryArchitect.ts:5460`) and SeasonPlannerAgent send free-text-JSON
  prompts and ride the hand-rolled repair stack (including speculative key
  synthesis, `BaseAgent.ts:2187-2194` — content *invention*), while every other
  heavy agent uses provider-native JSON schema.
- **Prompt caching misaligned.** StoryArchitect's ~30k-char static instruction
  block sits *after* dynamic content in the user message
  (`StoryArchitect.ts:6065-6563`); `cache_control` applies only to the system
  prompt (`BaseAgent.ts:897-900`). At 15–19 calls × ~40k chars/run, ~90% of the
  stable-prefix input cost is re-billed every call. Gemini `cachedContent` unused.
- **Non-cancelling timeouts orphan architect calls**:
  `EpisodeArchitecturePhase.ts:212` uses `withTimeout`, not `withTimeoutAbort`;
  an abandoned call keeps retrying up to 5 attempts holding provider-lane permits
  (limit 2/provider → two orphans freeze a lane).
- **Provider asymmetry**: only Gemini populates `thoughtsTokens` in truncation
  errors (so `visible_output_starved` can only fire on Gemini); OpenRouter has no
  reasoning-token floor; Anthropic/OpenAI/OpenRouter streaming has no overall
  ceiling (idle watchdog only). Dead branch: `'truncated llm response'` marked
  retryable at `BaseAgent.ts:537` but the typed error throws first.
- **max_tokens fixed per agent config, never raised on retry** — recovery ladders
  shrink the ask, never grow the budget.

## 6. Cross-run economics

World bible, character bible, source analysis are checkpointed for **same-job
resume only** (`FullStoryPipeline.ts:1695-1702`); a fresh run (required for any
plan-side fix) reuses **nothing** — no content-addressed cache keyed by
brief/treatment hash (the season plan already has `sourceHash` plumbing,
`seasonScenePlanBuilder.ts:2633-2641`). All pre-architecture spend was re-paid by
each of the 169 failed runs.

---

## 7. Remediation roadmap

Ordering principle: none of these lower the quality bar. Blocking→scored
demotions route through the QualityScore v4 ship band (which already caps), and
abort→repair conversions keep the same validators as arbiters — they just get to
*fix* instead of *kill*.

### Phase 0 — surgical fixes (S each, days; directly address ~60% of July kills)

| # | Fix | Where | Kills addressed |
|---|---|---|---|
| 0.1 | Fix `minimumEvidenceHits` authority silo; honor `required: false` | `semanticValidationCoordinator.ts:405-412`, `realizationTaskGate.ts:489` | pronoun/premise abort class |
| 0.2 | Add `SemanticRealizationJudge` router rules (+ coverage in `repairRouteCoverage.test.ts`); add a `QARunner` rule | `gateRepairRouter.ts:787` | semantic + QA diagnostic_stops |
| 0.3 | StoryArchitect truncation ladder: classify "Truncated LLM response" retryable, compact retry (ChoiceAuthor pattern), `retryClass:'adjust_call_budget'` metadata | `StoryArchitect.ts:5991-5993`, `:5869-5930` | truncation aborts |
| 0.4 | Attach failure metadata to EpisodeSpineContract returns; skip byte-identical deterministic retries in elaborate mode | `StoryArchitect.ts:5040-5059`, `EpisodeArchitecturePhase.ts:303-349` | 11 runs + wasted LLM spend |
| 0.5 | Fail-open semantic judge: INCONCLUSIVE/UNAVAILABLE → warning+receipt everywhere (incl. `finalContract.ts:1069-1087`); temp 0; ordinal excerpt handles; drop `evidenceQuotes` from required schema; cache inconclusives for replay check | `semanticValidationCoordinator.ts`, `SemanticRealizationJudge.ts:84-105` | inconclusive aborts + judge noise |
| 0.6 | Honest ledger: record attempted-but-rejected repairs and owner-stage patches (`recordRemediationSafe`); write top blocking validator/type + resolved gate-config hash into every failed ledger row; add a kill-table aggregator script | `runLedger.ts:85-104`, `pipelineOutputWriter.ts:953-998` | attribution for all future work |
| 0.7 | Fix loop kill switch: revert-and-continue instead of `break` on introduced issues | `finalContractRepair.ts:513-537` | repair starvation |
| 0.8 | Re-shadow FP-prone plan heuristics until a repair rung exists: Jaccard duplicate-turn fallback, `PLAN_MULTI_LOCATION_SCENE`, `PLAN_RELATIONSHIP_STAGE_CONTRADICTION`, multi-time-cue, `[DramaticStructure]`/`[SceneTurnContract]` promotions | `gateRegistry.ts:192-193`, `architectureContractPreflight.ts` | FP aborts |

### Phase 1 — structural repairs (M each, 1–2 weeks)

| # | Fix | Where |
|---|---|---|
| 1.1 | **Un-freeze QA findings**: re-derive `qa_blocker_present`/`continuity_error` per revalidation, or reconcile-downgrade when uncorroborated by fresh story-derived errors (extend `reconcileFrozenIncrementalFlags` pattern) — 28 runs | `finalContract.ts:1026`, `FinalStoryContractValidator.ts:1988-1996` |
| 1.2 | **Plan-repair rung for `recompile_episode_plan`**: bounded LLM pass that edits offending `plannedScenes` (split/move/reorder/rename) from gate findings, then recompile+revalidate — replaces the "stop without blind LLM retries" break; ~43+ runs | `EpisodeArchitecturePhase.ts:322-349` |
| 1.3 | **Demote the fidelity family to judge-confirmed-or-ship-with-cap**: extend `GATE_FIDELITY_JUDGE_CONFIRM` to NarrativeContract/TreatmentEventLedger/RelationshipArcLedger; execute or degrade architecture-class blockers at final contract instead of silent dead end — the single largest lever (~35% chokepoint) | `gateDefaults.ts:197`, `finalContract.ts:190-228` |
| 1.4 | **Owner-stage escalation instead of abort**: after 2-patch budget, one full SceneWriter regen with the (already-good) atom feedback; then two-tier degrade-to-warning + defer to final-contract repair; add repair/defer at the post-assembly regression site | `ContentGenerationPhase.ts:2647-2692`, `:4911-4961` |
| 1.5 | **Relax monotonic adoption** to task-level miss counts; re-sample single flipped claims before rejecting | `realizationTaskGate.ts:74-97` |
| 1.6 | **Cross-run artifact reuse** keyed by content hash of brief+treatment+model config (world/character bibles, season plan, sealed episodes) — cuts cost-per-success 3–5×, speeds every fix iteration | `checkpointArtifactStore.ts:52`, `FullStoryPipeline.ts:1695` |
| 1.7 | **Resume carry-forward + loop-breaker**: load `partial-story.json` repaired candidate as repair start; fingerprint failures into the checkpoint; refuse identical re-failure with a structured message | `pipelineOutputWriter.ts:1064-1105`, `proxy/workerLifecycle.js:2065` |
| 1.8 | **Structured output + cache alignment for planners**: StoryArchitect/SeasonPlanner onto `jsonSchema`; move static instruction blocks into the (cache-controlled) system prompt; abortable architect timeout (`withTimeoutAbort` + `activeAbortSignal`) | `StoryArchitect.ts:5460,6091-6563`, `EpisodeArchitecturePhase.ts:212` |
| 1.9 | Compile-time contradiction check across authorities (forbidden literal vs required semantic stems); stop compiling pronouns/naming/pure-interiority metadata into prose obligations (or downgrade when POV makes them unrealizable) | `realizationTaskCompiler.ts:373+`, `narrativeContractCompiler.ts:988-1012` |

### Phase 2 — target architecture (L, the durable fix)

1. **Hard core + scored band.** Keep ≤15 default-ON blocking checks (structural
   integrity, reader-safety: placeholder/stub/fallback prose, POV corruption,
   graph reachability). Fold fidelity/craft/pacing/ledger checks into the
   QualityScore v4 judge-graded band that ships with caps. This is the only way
   to beat the compounding math (0.995^400 ≈ 13%).
2. **Generate-to-satisfy, not detect-and-abort**: plan-time constraints go into
   prompts + deterministic post-passes; ESC elaboration applied as a patch onto
   the frozen spine so drift is impossible rather than detected.
3. **Extend the repair-first registry policy** (`validateGateRegistry`) from
   season-final to *all* default-ON blocking placements — this would have
   mechanically flagged most of what killed July.
4. **Semantic atoms as evidence candidates, tasks as the blocking unit** — abort
   only when the event as a whole is unrealized, never on a single atom verdict.
5. **Uniform provider reliability**: truncation telemetry (outputTokens/
   thoughtsTokens) on all providers; reasoning floors on OpenRouter; overall
   streaming ceilings; decorrelate judge provider from author provider.

## 8. Measurement discipline (so this doesn't recur)

- Every failed ledger row must carry: top blocking validator+type, gate-config
  hash, resume-chain id. (Phase 0.6.)
- Stand up the per-gate kill-rate/FP-rate table as a script over
  `99-pipeline-errors.json` — promotion/demotion decisions move from anecdote to
  data, and the ~25-gate promotion queue (each "owing a live run") becomes payable.
- Success-rate target checkpoints: Phase 0 alone plausibly moves 11% → 30–40%
  (it addresses the semantic silo, QA freeze, routing regressions, truncation,
  and FP shadow-flips); Phase 1 → 60%+; Phase 2 is what makes 80%+ stable.
