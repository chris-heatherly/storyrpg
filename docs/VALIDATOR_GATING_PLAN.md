# Validator Gating — Comprehensive Plan

**Status:** v6 — ALL BUCKETS IMPLEMENTED & green (default-off); lint ratchet clean
**Date:** 2026-06-04
**Companion to:** `docs/PROJECT_AUDIT_2026-05-28.md` (validator tiering section)
**Scope:** story, branching, and gameplay rules in the generation pipeline

> **Reconciliation note (2026-06-04):** a concurrent session landed commit `0292467`
> **"7-point spine now GATES — two-tier"** on this branch — it promotes
> `SevenPointCoverageValidator` from advisory to a blocking gate (tier-1 in
> `SeasonPlannerAgent.execute`, tier-2 inline in `StoryArchitect.validateBlueprint`),
> default-ON via `sevenPointBlocking` / `SEVEN_POINT_BLOCKING=0`. **SevenPoint is therefore
> already gated — do not duplicate it.** No conflict with this plan's buckets. Note the flag
> convention difference: that work (and `SEASON_CANON_BLOCKING`) uses **config-based default-ON
> opt-out**; this plan's buckets use **default-OFF opt-in `GATE_*` env flags** (rollout discipline
> §9), so new gates ship as zero-behavior-change until explicitly enabled. An auto-committer on
> this branch bundles working-tree changes into commits under unrelated messages and pushes them;
> per-phase commit hygiene is best-effort as a result.

> Governing principle: **a rule may become mandatory only if a violation can be fixed
> automatically** — repaired in code, regenerated, or rejected at planning time — with a
> degrade-to-warning fallback on exhaustion and a per-rule rollout flag. This is the
> guard against re-creating the hard-abort collapse the audit's tiering work fixed
> (TreatmentFidelity aborted 22/38 runs, DramaticStructure 17/38, before demotion).

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Current state: gated vs advisory inventory](#2-current-state-gated-vs-advisory-inventory)
3. [Remediation primitives (verified infrastructure)](#3-remediation-primitives-verified-infrastructure)
4. [Source-verified learnings](#4-source-verified-learnings)
5. [Remediation feasibility & bucket assignment](#5-remediation-feasibility--bucket-assignment)
6. [Shared scaffolding (S1–S4)](#6-shared-scaffolding-s1s4)
7. [Implementation buckets](#7-implementation-buckets)
8. [Sequencing & effort](#8-sequencing--effort)
9. [Rollout discipline](#9-rollout-discipline)
10. [Testing strategy](#10-testing-strategy)
11. [Risk register](#11-risk-register)
12. [Open items before building](#12-open-items-before-building)
- [Appendix A — file:line reference index](#appendix-a--fileline-reference-index)
- [Appendix B — per-rule master table](#appendix-b--per-rule-master-table)

---

## 0. Implementation status (2026-06-04) — COMPLETE

All buckets are implemented behind **default-off** flags, so the merge is zero-behavior-change
until a flag is enabled. Each phase shipped green (typecheck + lint ratchet + tests). Commits on
`chris/story-playthrough-qa-system-sdeviants`:

| Phase | What landed | Commit |
|---|---|---|
| S1–S4 + B0 | scaffolding (registry fields, RemediationBudget, remediationLedger, runGatedRemediation) + architecture craft gates | `d00e07d` (bundled by a concurrent commit) |
| A | 5 craft auto-repairs + applyCraftAutofix, wired after structural autofix | `17e0745` |
| D | 4 plan-time/ledger gates via planGatePolicy | `444825b` |
| C | judgeStabilizer + stakes-score hysteresis soft-gate | `8d92f4a` |
| B1 | regen-choices consumer loop + 2 scene-local detectors | `c914591` |
| A fix | drop stray console.log (ratchet 432→431) | `084c0dc` |

### Rollout flags (all default-OFF; set `=1` to enable)

| Flag | Effect | Remediation |
|---|---|---|
| `GATE_TREATMENT_FIDELITY` / `GATE_DRAMATIC_STRUCTURE` / `GATE_THEME_PRESSURE` / `GATE_SCENE_TURN_CONTRACT` / `GATE_EPISODE_PRESSURE` | B0: architecture craft validator blocks on retry exhaustion | regen-episode (retry 3×) |
| `GATE_STAT_CHECK_BALANCE` / `GATE_CHOICE_IMPACT` / `GATE_NPC_DEPTH` / `GATE_ARC_DELTA` / `GATE_MECHANICS_LEAKAGE` | A: deterministic auto-repair runs after structural autofix | autofix |
| `GATE_ARC_PRESSURE` / `GATE_CHOICE_DISTRIBUTION` / `GATE_SETUP_PAYOFF` / `GATE_CALLBACK_COVERAGE` | D: plan-time/ledger gate throws on error-severity | plan-time (re-plan/regen) |
| `GATE_JUDGE_STABILIZATION` | C: hysteresis on the stakes-score regen trigger (cut false positives) | regen-choices (soft) |
| `GATE_REGEN_CHOICES` | B1: enable the regen-choices consumer loop | regen-choices |
| `GATE_INTENSITY_DISTRIBUTION` / `GATE_MECHANICS_LEAKAGE_REGEN` | B1: scene-local detectors escalate to scene regen | regen-scene |

Note these are env opt-IN (`=1`), distinct from the codebase's `SEVEN_POINT_BLOCKING` / `SEASON_CANON_BLOCKING`
opt-OUT convention. Suggested rollout: enable one flag, run N seasons, read the quality/remediation
ledger, keep or revert.

### Known caveats / deferrals (verify-confirmed)
- **`GATE_CALLBACK_COVERAGE`** is a wired no-op: `CallbackCoverageValidator` emits no error-severity
  issues today — gate fires only once it's upgraded to emit errors.
- **B1 scene detectors** (`IntensityDistribution`, `MechanicsLeakage`) are wired and gated, but both
  emit warning-severity only today, so escalation-to-regen is forward-compatible but inert until they
  emit errors. **PropIntroduction was not wired** — it needs a cross-scene known-entity set a single
  scene can't supply without fabricating false positives.
- **Bucket C** narrowed to `stakes_triangle` only (the one rule with a real score-gated regen seam);
  the other 4 LLM-judged rules lack a judge-score regen path today.
- **Remediation-ledger wiring** (S3 `recordRemediation`) is built and tested but not yet called from
  the agent seams that lack an audit `baseDir` (e.g. ChoiceAuthor) — a follow-up.
- **SevenPoint** is already gated by a concurrent session (commit `0292467`), not by this plan.

## 1. Executive summary

Today only **4 validator classes can hard-block** a generation; everything else is
**advisory** (scored, logged to the quality ledger, used to drive retries, or nudged via
prompts, but the story still ships). The gated set answers "is this story *playable and
canon-consistent?*"; the advisory set answers "is this story *good craft?*"

Of ~30 advisory rules, **~25 are candidates for mandatory enforcement** if paired with an
automatic remediation path. The pipeline already contains every remediation primitive
needed, so most promotions are *wiring*, not new infrastructure. The one genuinely new
piece is a per-scene **`regen-choices`** loop.

Promotions are organized into five buckets by remediation route, plus a "leave advisory"
set:

| Bucket | Route | Rules | New infra? | Effort |
|---|---|---|---|---|
| **A** | code-repair (autofix) | ~5 | extends autofix | 3–4 d |
| **B0** | flip exhaustion (already in arch retry) | ~5 | none | ~2 d |
| **B1** | scene/choice regen | ~6 | 1 new loop | 5–7 d |
| **C** | soft-gate (retry-then-degrade, never block) | ~5 | judge stabilization | 3–4 d |
| **D** | plan-time gate (before prose) | ~4 | plan validators | 4–6 d |
| — | leave advisory | 2 | — | — |
| **S** | shared scaffolding (prerequisite) | — | yes | 1–2 d |

Recommended order: **S → B0 → A → D → C → B1** (cheap/high-leverage first; the new loop last).

---

## 2. Current state: gated vs advisory inventory

### 2.1 Mandatory (gated) today

All at the **final-assembly gate**; concerned with playability and canon integrity.
Failure throws `PipelineError` (`FullStoryPipeline.ts:1175`).

**Navigation & structural integrity** — `FinalStoryContractValidator.ts`
- Starting scene exists; every scene reachable from episode start (`broken_navigation`, `unreachable_scene`).
- Every `nextSceneId`/`nextBeatId`/`leadsTo` reference resolves (`broken_navigation`).
- No beat-id collisions across scenes (`beat_id_collision`).
- No routing contradictions — beat/choice can't route outside its `leadsTo` (`routing_contradiction`).
- Non-encounter scenes have ≥1 beat (`empty_scene`); no placeholder/branch-residue-only scenes.
- All requested episodes present (`missing_requested_episode`).

**Dead-end / empty-scene gates** — `StructuralValidator.ts` (also autofix-repaired)
- Non-terminal scenes must route somewhere (`dead_end_scene`, C3, commit `dcddff2`).
- Non-encounter scenes must have a beat (`empty_scene`, E4, commit `cbada19`).

**Encounter playability** — `EncounterQualityValidator.ts` + final contract
- Encounter satisfies runtime contract (`invalid_encounter`).
- No template-collapse prose / clock-coverage gap (`encounter_template_collapse`, `encounter_clock_coverage_gap`).
- If regeneration requested, encounter present in final story (`missing_runtime_encounter`).

**Season canon & promises** — `promiseLedgerValidators.ts`, `canonConsistencyValidator.ts`
(blocking by default, commit `038d925`, opt-out `SEASON_CANON_BLOCKING=0`)
- Promise targeted at episode N paid in N; no dangling payoff refs.
- Plants target a strictly-later, in-range episode; at season end all promises paid or abandoned.
- Impossible-knowledge guard: a character in episode N can't act on a fact from episode > N.

### 2.2 Advisory today (full inventory)

Recorded to diagnostics + the quality ledger; may drive retries; never fail a run alone.

- **Season structure:** SevenPointCoverage (note: season gate exists, opt-out `sevenPointBlocking`), ArcPressureArchitecture, EpisodePressureArchitecture, CharacterArchitecture, SeasonPromise, InformationLedger
- **Episode architecture (retry-then-degrade):** TreatmentFidelity, DramaticStructure, ThemePressure, SceneTurnContract
- **Choice & branching:** ChoiceDensity, ChoiceDistribution, ChoiceCoverage, StakesTriangle, FiveFactor, ConsequenceBudget, ChoiceImpact, Divergence, BranchMechanicalDivergence
- **Gameplay/mechanics:** MechanicsLeakage, MechanicalStorytelling, StatCheckBalance, SkillCoverage, SkillSurface
- **Threads/twists/payoff:** SetupPayoff, TwistQuality, CallbackCoverage (+ CallbackOpportunities = autofix), Cliffhanger, NarrativeFailureMode
- **Character:** NPCDepth, ArcDelta
- **Prose & coverage (newest, E5/#26C):** IntensityDistribution, PropIntroduction, ChoiceCoverage, PixarPrinciples, MicroEpisodeSeason

> Boundary cases: `MechanicsLeakage` is advisory in quick validation but escalates to a
> blocking `qa_blocker` inside the final contract. `StructuralValidator` is primarily
> autofix; only its dead-end/empty-scene classes block when unrepairable.

---

## 3. Remediation primitives (verified infrastructure)

Every primitive needed already exists. Promotion mostly means wiring validators into these.

| Primitive | Mechanism | Evidence |
|---|---|---|
| **autofix** | Deterministic in-place mutation | `StructuralValidator.autoFix()` `StructuralValidator.ts:643-956`; dispatch `FullStoryPipeline.ts:5712` |
| **regen-scene** | Re-invoke `SceneWriter.execute()` w/ augmented prompt; accept if issues decrease | loop `FullStoryPipeline.ts:8004`; keyed off `regenerationRequested === 'scene'` |
| **regen-encounter** | Re-invoke `EncounterArchitect.execute()` | loop `FullStoryPipeline.ts:8573` |
| **regen-episode** | StoryArchitect retry-then-degrade (B1 tiering) | loop `FullStoryPipeline.ts:6694`; collectors `StoryArchitect.ts:3487`; degrade `:6782` |
| **regen-choices** | **DOES NOT EXIST** — must be built | signal set `IncrementalValidators.ts:1386`, counted `:1610`, **no consumer** |
| **quick-val repair (Karpathy)** | On quick-val failure re-invoke `ChoiceAuthor`/`SceneWriter` for repairable categories | `FullStoryPipeline.ts:4900-5040`; `repairableCategories` `:4902` |
| **plan-time gate** | Throw on bad plan/ledger before prose | `SeasonPlannerAgent.ts:206` (SevenPoint); promise ledger (blocking) |

Shared types: `ValidatorTier = 'blocking'|'advisory'|'autofix'` (`validatorRegistry.ts:29`);
`ValidatorStage` (`:20`); `IssueSeverity = 'error'|'warning'|'info'`,
`ValidationResult {valid,score,issues,suggestions}` (`BaseValidator.ts:6,15`);
`SceneValidationResult.regenerationRequested: 'scene'|'choices'|'encounter'|'none'`
(`IncrementalValidators.ts:154`).

The promotion recipe (5 parts): **detector → remediation route → degrade fallback →
registry tier flip → rollout flag + ledger gate.**

---

## 4. Source-verified learnings

1. **`regen-choices` has no consumer loop.** The signal is set (`IncrementalValidators.ts:1386`,
   from `IncrementalStakesValidator.validateChoiceSet().shouldRegenerate`) and counted (`:1610`),
   but nothing acts on it. Only `'scene'` and `'encounter'` have loops. Mitigation: the
   quick-val Karpathy path already calls `ChoiceAuthor.execute()` for
   `stakes_triangle`/`five_factor`/`choice_density` (`FullStoryPipeline.ts:4928-5040`), so the
   new loop reuses that invocation code.

2. **Some "scene-scoped" rules are aggregate.** `ChoiceDensity` rules are episode-wide
   (`ChoiceDensityValidator.ts:186,195,210`); `ConsequenceBudget` violations are allocation
   deviations (`:220-232`); `BranchMechanicalDivergence` violations are cross-branch
   relationships (`:58-66`). None fix by regenerating one scene.

3. **One "aggregate" rule is scene-local.** `IntensityDistribution` ties issues to
   `scene:${sceneId}` (`:75-111`) → belongs in B1.

4. **`SceneTurnContract` is already in the architecture retry** (collector + tag
   `[SceneTurnContract]`) → belongs in B0, not B1.

5. **Four aggregate rules have planning-time ledgers** → gate before prose (Bucket D):
   `ChoiceDistribution` ↔ `seasonChoicePlan.ts:64` `assignSeasonChoiceTypes()`;
   `SetupPayoff` ↔ `ThreadLedger` (`narrativeThread.ts:58-89`, overlaps blocking promise ledger);
   `CallbackCoverage` ↔ `callbackLedger.ts:25-54`;
   `ArcPressureArchitecture` ↔ `seasonPlan.arcs` (`seasonPlan.ts:112-162`).

6. **`Divergence` / `BranchMechanicalDivergence` are gateable but not worth gating** — fixes
   require persistent cross-branch state, not prose regen.

---

## 5. Remediation feasibility & bucket assignment

See [Appendix B](#appendix-b--per-rule-master-table) for the complete per-rule table.
Summary of where each candidate lands:

- **Bucket A (code-repair):** StatCheckBalance, ChoiceImpact (field presence), NPCDepth
  (dimension count), ArcDelta (endpoint presence), MechanicsLeakage (isolated token)
- **Bucket B0 (flip exhaustion):** DramaticStructure, ThemePressure, SceneTurnContract,
  EpisodePressureArchitecture, TreatmentFidelity
- **Bucket B1 (scene/choice regen):** PropIntroduction, MechanicsLeakage (in-sentence),
  IntensityDistribution, ChoiceCoverage (+ choice-quality rules routed from C)
- **Bucket C (soft-gate):** StakesTriangle (quality), FiveFactor, TwistQuality, Cliffhanger,
  ChoiceImpact (quality)
- **Bucket D (plan-time):** ChoiceDistribution, SetupPayoff, CallbackCoverage,
  ArcPressureArchitecture
- **Leave advisory:** Divergence, BranchMechanicalDivergence

---

## 6. Shared scaffolding (S1–S4) — ✅ IMPLEMENTED

Prerequisite for everything below. **Landed 2026-06-04, all guardrails green**
(typecheck + lint + 27/27 unit tests). As-built file locations:

| Item | As-built location | Notes |
|---|---|---|
| S1 | `validators/validatorRegistry.ts` + `.test.ts` | added `ValidatorRemediation` union + 3 optional fields + `remediationRoute()`; invariant test scaffolded with `BLOCKING_WITHOUT_REMEDIATION_ALLOWLIST` (passes today, ready to tighten) |
| S2 | `remediation/RemediationBudget.ts` + `.test.ts` | pure class + `createRemediationBudget(total=12)`; no pipeline wiring yet |
| S3 | `utils/qualityLedger.ts` (extracted `appendJsonlRow`) + `remediation/remediationLedger.ts` + `.test.ts` | sibling module reuses the existing fs append util; writes `remediation-ledger.jsonl`; caller-supplied timestamp (deterministic) |
| S4 | `remediation/runGatedRemediation.ts` + `.test.ts` | driver + `GatedRemediationError`; non-determinism injected via callbacks |

> Wiring into the pipeline happens per-bucket (so the monolith isn't grown speculatively).
> The spec below is retained for reference.

**S1 — Extend the registry entry with an explicit remediation route.**
`ValidatorRegistryEntry` is `{validator, stage, tier, dispatchedFrom}` (`validatorRegistry.ts:31`). Add:
```ts
remediation?: 'autofix' | 'regen-scene' | 'regen-choices' | 'regen-encounter'
            | 'regen-episode' | 'plan-time' | 'none';
rolloutFlag?: string;          // e.g. 'GATE_PROP_INTRODUCTION'
maxRemediationAttempts?: number;
```
Add a registry test: every `blocking` entry must have a non-`none` remediation route.

**S2 — Global remediation budget per run.** A `RemediationBudget` (max regen calls/run,
default ~12) threaded through the pipeline. When exhausted, remaining gates degrade-to-warning
regardless of tier. Record consumption to the quality ledger.

**S3 — Ledger instrumentation.** Every remediation attempt writes
`{rule, scope, attempted, succeeded, degraded, blocked, attempts}` to the quality ledger.
This is the evidence base for flipping a flag from off → default-on.

**S4 — `runGatedRemediation()` helper.** Wraps loop-then-decide: takes a detector, a
remediation thunk, attempt cap, rollout flag; returns `{passed, degraded, attempts}`;
throws only if `blocking && !opt-out && budget-allows`. All buckets call this.

---

## 7. Implementation buckets

### Bucket A — code-repair gate (~5 rules) — ✅ IMPLEMENTED 2026-06-04 (green, default-off)

Landed as 5 pure per-repair modules under `remediation/repairs/` + `remediation/applyCraftAutofix.ts`
aggregator (27 tests), wired in `FullStoryPipeline.ts` right after the structural autofix block
(import L285), gated by `GATE_STAT_CHECK_BALANCE` / `GATE_CHOICE_IMPACT` / `GATE_NPC_DEPTH` /
`GATE_ARC_DELTA` / `GATE_MECHANICS_LEAKAGE` (all default-off → no-op until enabled). Registry
entries annotated `remediation: 'autofix'` + `rolloutFlag` (tier stays `advisory`: enforcement is
guaranteed repair, not a throw). MechanicsLeakage redacts only isolated-token leaks; in-sentence
leaks are left for B1 regen. Verified: 177 pipeline + 24 validator tests green, default-off; the
aggregator is idempotent. Original spec below.

| Rule | Repair | Notes |
|---|---|---|
| StatCheckBalance | Clamp/redistribute hidden DCs into valid band | verify DCs never in prose |
| ChoiceImpact (field presence) | Backfill `impactFactors`/`stakes` from `consequences` | quality dim → C |
| NPCDepth (dimension count) | Backfill from tier defaults | if not derivable → regen-scene |
| ArcDelta (endpoint presence) | Backfill from season arc plan | structural |
| MechanicsLeakage (isolated token) | Deterministic redaction | in-sentence → regen-scene (B1) |

Steps per rule: add repair fn → wire into autofix dispatch (emit `fixedCount`) → flip tier
to `blocking` + `remediation:'autofix'` behind flag → unit test (broken→valid; non-repairable→degrade).

### Bucket B0 — flip exhaustion (~5 rules) — ✅ IMPLEMENTED 2026-06-04 (green, default-off)

Landed as a pure `remediation/architectGatePolicy.ts` (`classifyArchitectGateWarnings` +
`ARCHITECT_GATE_TAGS`) + a surgical swap in `FullStoryPipeline.ts` (import L284, attempts 2→3
at L6696, classify/throw block at L6792). Behind per-rule flags
`GATE_TREATMENT_FIDELITY` / `GATE_DRAMATIC_STRUCTURE` / `GATE_THEME_PRESSURE` /
`GATE_SCENE_TURN_CONTRACT` / `GATE_EPISODE_PRESSURE`. With no flag set, behavior is byte-for-byte
unchanged (verified: 177 pipeline + 54 architect tests pass). Original spec below.



Already run in the StoryArchitect retry via tagged collectors (`StoryArchitect.ts:3487-3506`,
`:3755-3785`), currently degrading to advisory on exhaustion (`FullStoryPipeline.ts:6782`).

Rules: DramaticStructure, ThemePressure, SceneTurnContract, EpisodePressureArchitecture,
TreatmentFidelity.

Work: raise `maxArchitectureAttempts` (currently 2) for these; change the exhaustion branch
from "push advisory warning" to "throw if `blockingFlag` set." That's the whole change.
**Riskiest** (these caused the original mass aborts) → roll out one at a time behind
individual flags with ledger watching.

### Bucket B1 — scene/choice regen — ✅ IMPLEMENTED 2026-06-04 (green, default-off)

Landed (commit `c914591`) the missing **regen-choices consumer loop**: `remediation/regenChoicesPolicy.ts`
(`shouldRegenChoices` + `isChoiceRegenImprovement`, pure/tested) + a loop in `FullStoryPipeline` at the
scene-regen→encounter seam that re-invokes `ChoiceAuthor`, re-validates stakes, accepts on improvement,
swaps the set back, degrades on exhaustion (never throws), behind `GATE_REGEN_CHOICES`. Also wired
`IntensityDistribution` + `MechanicsLeakage` into `validateScene` (double-gated by config flag +
`GATE_INTENSITY_DISTRIBUTION`/`GATE_MECHANICS_LEAKAGE_REGEN`), escalating to `'scene'` regen only on
error-severity. **PropIntroduction skipped** (needs cross-scene entity set). 19 new tests; 177 pipeline +
408 validator tests green default-off. Original spec below.

Add the detector into `IncrementalValidator.validateScene()` (`IncrementalValidators.ts:1342`)
so it sets `regenerationRequested` and contributes issue text to the augmented prompt.

**regen-scene (loop exists):** PropIntroduction (`PropIntroductionValidator.ts:62-77`),
MechanicsLeakage in-sentence (`:102`), IntensityDistribution (`:75-111`).

**regen-choices (BUILD THE LOOP):** ChoiceCoverage (`ChoiceCoverageValidator.ts:55-71`),
plus LLM-judged choice-quality rules routed from C.

New `regen-choices` loop spec:
- Location: after the scene-regen loop closes (~`FullStoryPipeline.ts:8130`), before encounter loop.
- Guard: `if (sceneValidation.regenerationRequested === 'choices' && incrementalConfig.stakesValidation)`.
- Body: mirror the encounter loop — `while (attempt < maxRegenerationAttempts)`, re-invoke
  `this.choiceAuthor.execute(input)` (reuse input shape from Karpathy repair `:4928`),
  re-validate via `validateScene`, accept if issues decrease, swap into `choiceSets` +
  `sceneValidationResults` (pattern `:8105-8116`), degrade on exhaustion.
- `ChoiceAuthorInput` needs: `sceneBlueprint`, `beatText`, `beatId`, `storyContext`,
  `protagonistInfo`, `npcsInScene`, `possibleNextScenes`, `optionCount` (`ChoiceAuthor.ts:407`).

### Bucket C — soft-gate only (~5 rules) — ✅ IMPLEMENTED 2026-06-04 (green, default-off; scope narrowed)

Landed `remediation/judgeStabilizer.ts` (`stabilizeByHysteresis` + `stabilizeBySampling`, the
reusable primitive) + wired **only `stakes_triangle`** — the one LLM-judged rule with a real
score-gated regeneration seam (`ChoiceAuthor.executeRevision`). Applied a hysteresis margin (5,
behind default-off `GATE_JUDGE_STABILIZATION`) via an extracted pure `shouldFailStakesScore` so a
borderline `[55,60)` score no longer triggers choice regeneration. The path already degrades
(falls back to the original choices, never throws). 15 new tests; 177 pipeline + 25 ChoiceAuthor +
19 validator tests green default-off.

**Scope reality (verify-corrected):** the other four are N/A at current seams — `five_factor` and
`choice_impact` gate on *binary* heuristics (no numeric judge score → hysteresis is a no-op),
`twist_quality` is report-only, and `cliffhanger`'s `improveCliffhanger` is a separate in-place QA
repair, not a score-hysteresis decision. They'd only become stabilizable if/when wired to a
judge-score regen. Ledger wiring deferred (ChoiceAuthor has no audit baseDir plumbed). Original spec below.

LLM-judged; hard-gating re-creates false-positive aborts. **Explicit non-goal: never `blocking`.**
Rules: StakesTriangle (quality), FiveFactor, TwistQuality, Cliffhanger, ChoiceImpact (quality).
`stakes_triangle`/`five_factor` are already in `repairableCategories` (`:4902`); add
`twist_quality`, `cliffhanger`, `choice_impact_quality`.

Work: (1) ensure each runs in retry-then-degrade; (2) stabilize the judge (2-of-3 sampling
vote or threshold hysteresis) so one noisy score doesn't trigger regen; (3) always degrade,
always ledger, never throw.

### Bucket D — plan-time gate (~4 rules) — ✅ IMPLEMENTED 2026-06-04 (green, default-off)

Landed (commit `444825b`) as `remediation/planGatePolicy.ts` (`shouldGate` + `PLAN_GATE_FLAGS`)
wiring 4 existing advisory validators as flag-gated throws at their real seam:
`ArcPressureArchitecture`→SeasonPlanner (`GATE_ARC_PRESSURE`), `ChoiceDistribution`→`seasonChoicePlan`
plan-emit (`GATE_CHOICE_DISTRIBUTION`), `SetupPayoff`/`CallbackCoverage`→diagnostics seam, placed
*outside* the try/catch so throws propagate as real `PipelineError`s (`GATE_SETUP_PAYOFF`/
`GATE_CALLBACK_COVERAGE`). All default-off; registry annotated `remediation:'plan-time'` + rolloutFlag.
17 new tests; 237 regression tests green default-off. **Caveat:** `CallbackCoverageValidator` emits no
error-severity issues today, so its gate is a wired no-op until that validator is upgraded to emit
errors. (Refinement vs original spec: gated the existing validators in place rather than folding
thread/callback logic into the promise ledger — less duplication.) Original spec below.

Validate the plan/ledger before any prose. Fix = plan edit or re-plan, zero scene-authoring cost.
Mirrors the SevenPoint season gate (`SeasonPlannerAgent.ts:206`) and the blocking promise ledger.

| Rule | Artifact | Gate point |
|---|---|---|
| ChoiceDistribution (35/30/20/15) | `seasonChoicePlan.ts:64` `assignSeasonChoiceTypes()` | plan-emit, before ChoiceAuthor |
| SetupPayoff | `ThreadLedger` (`narrativeThread.ts:58-89`) | ledger-emit; **fold into blocking promise ledger** |
| CallbackCoverage | `callbackLedger.ts:25-54` | when hooks are created |
| ArcPressureArchitecture | `seasonPlan.arcs` (`seasonPlan.ts:112-162`) | season-stage gate; plan-edit fix |

### Leave advisory

Divergence, BranchMechanicalDivergence — fixes require persistent cross-branch state, not
prose regen. Revisit only if branch-divergence quality becomes a priority.

---

## 8. Sequencing & effort

| Phase | Bucket | New infra? | Effort | Rationale |
|---|---|---|---|---|
| 1 | Scaffolding S1–S4 | yes | 1–2 d | prerequisite |
| 2 | **B0** | none | ~2 d | near-free, highest leverage |
| 3 | A | extends autofix | 3–4 d | deterministic, low risk |
| 4 | **D** | plan validators | 4–6 d | best ROI; overlaps blocking ledgers |
| 5 | C | judge stabilization | 3–4 d | safety net, no blocking |
| 6 | B1 | **regen-choices loop** | 5–7 d | last; owns the only new loop |
| — | Divergence/BranchMech | — | — | leave advisory |

Total ~18–26 engineering days, phaseable and independently shippable.

---

## 9. Rollout discipline

Applies to every promotion:
1. Land behind a **default-off env flag** (mirror `SEASON_CANON_BLOCKING`, `sevenPointBlocking`).
2. Run N seasons; read the **quality ledger** (S3) for attempted/succeeded/degraded/blocked.
3. Flip default-on **only if** generation success rate holds.
4. **Regression guard:** CI/ledger check that success rate doesn't drop below threshold when
   a flag flips — the explicit guard against re-creating the audit's hard-abort collapse.
5. **Cost guard:** S2 budget caps worst-case added LLM calls; measure on a sample season first.

---

## 10. Testing strategy

- **Unit (per repair/detector):** broken fixture → repaired/valid; non-repairable → degrades, not crashes.
- **Loop integration:** deliberately broken scene/choice/episode → remediation runs →
  passes within attempt cap; exhaustion → degrades or blocks per flag.
- **Judge stability (C):** flaky-judge fixture → 2-of-3 vote suppresses single-sample noise.
- **Plan-time (D):** malformed plan/ledger → rejected at emit, before any SceneWriter call.
- **Regression:** sample-season run with all flags on → success rate ≥ baseline; ledger shows
  remediation, not aborts.
- Existing harness: Vitest unit + Playwright e2e + `npm run validate` (see `testing-tooling` skill).

---

## 11. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Re-introduce mass aborts (the 22/38 collapse) | med | remediation-first, block-last, per-rule flags, S3 ledger gate, regression guard |
| Repair produces worse prose | med | loop accepts only if issues decrease (existing rule); cap attempts |
| Cost/latency blowup from added regen calls | med | S2 global budget; per-rule attempt caps (default 2) |
| `regen-choices` loop bugs (new code) | med | model on proven encounter loop; reuse Karpathy ChoiceAuthor invocation |
| LLM-judged false positives (C) | high if hard-gated | never block C; sampling-vote stabilization |
| Plan-time gate too strict, rejects salvageable plans | low | re-plan once then degrade; flag-gated |

---

## 12. Open items — ✅ RESOLVED (2026-06-04, source-verified)

1. **StatCheckBalance DCs — safe to auto-rebalance numerically.** DCs are hidden game
   mechanics, never in player prose: `ChoiceAuthor.ts:135` forbids exposing numbers/odds/dice;
   `resolutionEngine.ts` uses `difficulty` only for internal probability; the validator's band
   is `[35,80]` (`StatCheckBalanceValidator.ts:78-84`). → Bucket A autofix is clear.

2. **SetupPayoff & CallbackCoverage — EXTEND the blocking promise ledger, don't add siblings.**
   `NarrativeThread` (`narrativeThread.ts:58-89`) and `CallbackHook` (`callbackLedger.ts:25-54`)
   are structurally isomorphic to promises. Add `validateThreadLedger()` + `validateCallbackLedger()`
   to `promiseLedgerValidators.ts` and merge into a unified `validateAllNarrativeLedgers()` (Bucket D).

3. **regen-choices loop — insertion point confirmed.** Insert after the regen-scene loop closes
   (`FullStoryPipeline.ts:8128`), before the encounter block (`:8132`), guarded by
   `regenerationRequested === 'choices' && incrementalConfig.stakesValidation`. Input shape matches
   the Karpathy repair call (`:4949`). Mirror the encounter loop (max 2 attempts, accept on issue
   decrease, degrade on exhaustion).

4. **`shouldRegenerate` is stable enough to gate on.** It's `errorCount > 0` — deterministic
   (`IncrementalValidators.ts:373-508`); the `passed` threshold is a configurable `>= 60`. The
   `'choices'` signal is already routed at `:1386`.

**Additional B0 finding:** the exact degrade-to-advisory code is `FullStoryPipeline.ts:6782-6793`;
the architecture retry loop is `:6694-6724` (`maxArchitectureAttempts = 2`); tagged collectors are
`StoryArchitect.ts:3487-3506`. Minimal flip = parse the `[Tag]` in `result.warnings`, throw a
`PipelineError` for tags whose `GATE_*` flag is on (else keep the advisory warning), and raise
`maxArchitectureAttempts` to 3.

---

## Appendix A — file:line reference index

**Pipeline (`src/ai-agents/pipeline/FullStoryPipeline.ts`)**
- Final contract gate (throws): `:1175` · autofix dispatch: `:5712`
- Architecture retry loop: `:6694` · architect advisory degrade: `:6782`
- Quick-val Karpathy repair: `:4900-5040` · `repairableCategories`: `:4902` · ChoiceAuthor repair call: `:4928`
- Per-scene validation: `:7961` · regen-scene loop: `:8004` · scene swap pattern: `:8105-8116`
- regen-choices insertion point (~): `:8130` · regen-encounter loop: `:8573`

**Validators (`src/ai-agents/validators/`)**
- `validatorRegistry.ts` — tier `:29`, stage `:20`, entry `:31`, `blockingValidators()` `:108`
- `BaseValidator.ts` — `IssueSeverity` `:6`, `ValidationResult` `:15`
- `FinalStoryContractValidator.ts` — report fields `:41,53`, `buildReport` `:610`
- `StructuralValidator.ts` — `autoFix()` `:643-956`
- `IncrementalValidators.ts` — `validateScene` `:1342`, `SceneValidationResult` `:140`, `'choices'` set `:1386`, counted `:1610`, max attempts `:130`
- `IntensityDistributionValidator.ts` `:75-111` · `PropIntroductionValidator.ts` `:62-77` · `MechanicsLeakageValidator.ts` `:102`
- `ChoiceCoverageValidator.ts` `:55-71` · `ChoiceDensityValidator.ts` `:186,195,210` · `ConsequenceBudgetValidator.ts` `:220-232` · `BranchMechanicalDivergenceValidator.ts` `:58-66`

**Agents & plan artifacts (`src/ai-agents/agents/`, `src/ai-agents/pipeline/`, `src/types/`)**
- `StoryArchitect.ts` — tagged collectors `:3487-3506`, collector impls `:3755-3785`
- `SceneWriter.ts` — `execute()` `:672`, input `:129-228`
- `ChoiceAuthor.ts` — `execute()` `:407`
- `SeasonPlannerAgent.ts` — SevenPoint season gate `:206`
- `seasonChoicePlan.ts` — `assignSeasonChoiceTypes()` `:64-110`
- `callbackLedger.ts` — `CallbackHook` `:25-54`
- `narrativeThread.ts` — `NarrativeThread` plants/payoffs `:58-89`
- `seasonPlan.ts` — `SeasonArc` `:112-162`

**Flags / commits**
- `SEASON_CANON_BLOCKING` (default true, commit `038d925`) · `sevenPointBlocking` input flag
- C3 dead-end gate commit `dcddff2` · E4 empty-scene gate commit `cbada19`
- E1 choice distribution commits `200e93a`, `b5cddfa`

---

## Appendix B — per-rule master table

| Rule | Today | Scope | Localizable | LLM-judged | Bucket | Route | Plan ledger |
|---|---|---|---|---|---|---|---|
| FinalStoryContract (nav/struct) | gated | episode | yes | no | — | (gated) | — |
| Encounter playability | gated | encounter | yes | no | — | (gated) | — |
| Promise/Canon ledger | gated | season | yes | no | — | (gated) | yes |
| StatCheckBalance | advisory | choice | yes | no | A | autofix | — |
| ChoiceImpact (field presence) | advisory | choice | yes | no | A | autofix | — |
| NPCDepth (dimension count) | advisory | scene | yes | no | A | autofix→regen | — |
| ArcDelta (endpoint presence) | advisory | episode | yes | no | A | autofix | — |
| MechanicsLeakage (isolated) | advisory | beat | yes | no | A | autofix | — |
| DramaticStructure | advisory | episode | yes | no | B0 | regen-episode | — |
| ThemePressure | advisory | episode | yes | no | B0 | regen-episode | — |
| SceneTurnContract | advisory | scene | yes | no | B0 | regen-episode | — |
| EpisodePressureArchitecture | advisory | episode | yes | no | B0 | regen-episode | — |
| TreatmentFidelity | advisory | episode | partial | no (token overlap) | B0 | regen-episode | — |
| PropIntroduction | advisory | scene | yes | no | B1 | regen-scene | — |
| MechanicsLeakage (in-sentence) | advisory | beat | yes | no | B1 | regen-scene | — |
| IntensityDistribution | advisory | scene | yes | no | B1 | regen-scene | — |
| ChoiceCoverage | advisory | scene | yes | no | B1 | regen-choices* | — |
| StakesTriangle (quality) | advisory | choice | yes | yes | C | soft | — |
| FiveFactor | advisory | choice | partial | yes | C | soft | — |
| TwistQuality | advisory | episode | partial | yes | C | soft | — |
| Cliffhanger | advisory | episode | yes | yes | C | soft | — |
| ChoiceImpact (quality) | advisory | choice | yes | yes | C | soft | — |
| ChoiceDistribution | advisory | season | no (aggregate) | no | D | plan-time | yes |
| SetupPayoff | advisory | season | partial | no | D | plan-time | yes |
| CallbackCoverage | advisory | season | partial | no | D | plan-time | yes |
| ArcPressureArchitecture | advisory | season | no (plan-doc) | no | D | plan-time | yes |
| ChoiceDensity | advisory | episode | no (aggregate) | no | D/B1 | plan-time + backstop | partial |
| ConsequenceBudget | advisory | episode | no (aggregate) | no | D/B1 | plan-time + backstop | — |
| Divergence | advisory | season | no | no | leave | — | — |
| BranchMechanicalDivergence | advisory | branch-pair | partial | no | leave | — | — |

\* `regen-choices` loop must be built (see [§4.1](#4-source-verified-learnings) / B1).
