# Endsong remediation plan — generator-first, re-arm the gates

**Date:** 2026-05-30
**Last verified:** 2026-05-30 (every seam below re-checked against the current
working tree, which contains in-progress QA/playthrough changes on branch
`chris/story-playthrough-qa-system-sdeviants`).
**Source audit:** the `endsong_2026-05-30T20-10-05` run (band `warn`, overall 51, QA 62; contract "passed" with 7 advisory-demoted craft errors).
**Author directive:** *fix the generation, not the validators.* Re-enable the validators we recently softened — **except** the genuine false-positive fixes — and add generator-side fixes for the past errors that **do not reduce quality or remove any rule.**

> **Line numbers are approximate and drift.** They reflect the current dirty
> working tree; the QA/playthrough work already moved several seams since this
> plan was first drafted. Always grep for the named symbol, not the line.

---

## Status (updated 2026-05-30)

- **PR A (Phase 0) — DONE** (landed in the working tree, not yet committed; see
  per-item notes below). Two of the original Phase-0 diagnoses turned out to be
  **stale** against current code and were dropped as no-ops — called out inline.
- **PRs B–F — not started.** All Phase 1/2 seams below were re-verified; the
  corrected file:line refs and reframings are folded in.

---

## Context — why this is needed

Two audits now point at the same structural problem:

- **2026-05-28 audit** found 25 of 38 runs produced **zero playable output** because craft/fidelity validators hard-aborted whole runs. The response (commits `4d63bcd`, `b831ca0` F3, `849b3a1`) softened the gates so stories ship. That stopped the zero-output bleed but converted **hard failures into silent "warn"-band ships**.
- **2026-05-30 Endsong audit** shows the cost of that posture: a story shipped `success` while carrying 7 real craft failures (callback debt, inverted consequence budget, monotone choice taxonomy, NPC with no relationship model, vague stakes), **and** the validators that should have caught them were partly *blind* (choice-counter reads the wrong field; ChoiceDistribution unregistered; encounter default-collisions telemetry-only).

So the gates were softened **and** the meters were broken at the same time. Reverting the softening alone would send us straight back to zero-output runs, because generation still can't clear the bar. The fix has to be ordered: **make the meters honest → fix generation so it passes → re-arm the gates.**

## Guiding principle (non-negotiable for this work)

1. **No rule is deleted or weakened to make a story pass.** Every quality target stays.
2. **Keep the legitimate false-positive fixes** (MechanicsLeakage regex hardening, the Victor/Radu removal, the "repair-instead-of-abort" F-series). These fixed *wrong* failures, not *real* ones.
3. **Re-promote the gates only after the generator can clear them**, proven by a green Endsong re-run, so we don't reintroduce zero-output aborts.

---

## What got softened in the last few days — keep vs. reverse

| Commit | Change | Verdict |
|---|---|---|
| **`b831ca0` (F3 portion)** | In `FinalStoryContractValidator.ts`, demoted `unrepaired_callback_debt` (~L435), `qa_blocker_present`/QA report (~L497), and **all IntegratedBestPractices blocking findings** — consequence-budget, choice-taxonomy, NPC-depth, stakes-triangle, callback (~L511) — from `error` → `warning`. **Verified still `warning` today.** | **REVERSE** (PR F, after Phase 1) — this is the nerf that let Endsong ship dirty. |
| **`4d63bcd` (B1)** | `StoryArchitect.classifyBlueprintFailure()` makes architecture-stage craft validators (TreatmentFidelity, DramaticStructure, ThemePressure, SceneTurnContract, EpisodePressure) advisory on the final retry. **Verified intact (`StoryArchitect.ts` ~2176-2219, advisory tags ~2183, advisory-only early return ~2137).** | **RE-PROMOTE (policy)** after Phase 1 — keep the per-line classifier (it fixed a real 22× mis-classification) but flip advisory-craft back to blocking once generation passes. |
| **`849b3a1` (F3)** | Made `failed_incremental_validation` advisory. | **ALREADY REVERSED** by `cb43d53` — **verified `error` today (~L475).** No action — confirm it stays. |
| `cb43d53` | Reverted `849b3a1`; **strengthened** dice regex; persists blocking issues to `99-pipeline-errors.json`. | **KEEP** — already on the right side. |
| `0a77e46`, `9230d46`, `b01b484` | MechanicsLeakage regex hardening (DC / roll / build / bonus / modifier / probability). True positives retained. | **KEEP** — real false-positive fixes. |
| `b0737c9` | Removed hardcoded "Victor/Radu" order check from TreatmentFidelity (matched "gradually"/"victory"). | **KEEP** — leaked test fixture, pure false positive. |
| `7d8c7b6` | Tree-format encounter beat **recount** (count nested situations) + drop bogus skill-canon merge. | **KEEP** — correct recount, not a relaxation. |
| `49edca9`, `806b453`, `db7cbbd`, `0ae1ade`, `cc4bcdd`, `4205b2c` (F4–F8) | "Repair instead of abort" generator fixes + anti-truncation maxTokens + ledger telemetry. | **KEEP** — these *are* the generator-first approach. |

**Net:** exactly one code nerf to reverse (`b831ca0` F3, three severities) plus one policy re-promotion (`4d63bcd` advisory-craft), both **gated behind Phase 1**. Nothing else recent reduced a real rule.

---

## Phase 0 — Make the meters honest — ✅ DONE (PR A)

Bug fixes to the validators, not rule changes. Landed in the working tree.

### 0.1 Choice under-count — ✅ DONE
- **Was:** `IntegratedBestPracticesValidator` exported `totalChoices` from `ChoiceDensityValidator.choiceCount` (beats flagged `isChoicePoint`, ~2) instead of the real choice inventory — a 14-choice story read as 2.
- **Done:** `totalChoices = input.choices.length` at both the init and the density-metric assignment in `IntegratedBestPracticesValidator.ts`. Regression test added (14-choice story → `totalChoices === 14`).

### 0.2 Per-scene incremental validation — ✅ DONE (original framing was **stale**)
- **Stale parts (dropped as no-ops):** the "flags are off → `validateScene` is a 1 ms no-op" premise is wrong — `INCREMENTAL_VALIDATION_DEFAULTS` (`src/constants/validation.ts`) has every check `true`. And encounter scenes are **not** run through `validateScene(encounter: undefined)`; they `continue` at `FullStoryPipeline.ts` ~7158 and use a dedicated encounter path (~8347) with its own regeneration loop. "Pass the real encounter into the 7798 call" was therefore a no-op and was not done.
- **Done:** the one genuinely-useful piece — a **zero-beat hard guard** in `IncrementalValidators.validateScene`: a non-encounter scene with no authored beats now fails (`emptyScene`, `overallPassed=false`, requests scene regen) instead of passing vacuously. New test file added.

### 0.3 Encounter default-collisions — ✅ DONE (advisory, never blocks)
- **Done (correctness):** `EncounterArchitect.buildDefaultStorylets` now emits the missing `partialVictory` slot (with structured cost), so a defaulted encounter ships all four outcomes and the `partialVictory` collision check can fire.
- **Done (gating, per decision "regenerate but never block"):** a non-empty `phase4DefaultCollisions` (or `phase4Ok=false`) now drives the **existing** encounter regeneration loop toward distinct outcomes, but is **advisory only** — collisions never set `overallPassed=false`, so they cannot propagate to a blocking contract failure or reintroduce zero-output aborts. `getPhase4DefaultCollisions` helper added in `FullStoryPipeline.ts`; baseline bumped +35 with a documented rationale in `scripts/check-monolith-size.mjs`.
- **Note:** the validator already does more than the original plan assumed (it checks `hasPartialVictoryPath` + structured partial-victory cost), so the only real bug was the missing `partialVictory`.

### 0.4 Register ChoiceDistributionValidator — ✅ DONE
- **Was:** `ChoiceDistributionValidator.ts` existed but was unregistered, so taxonomy distribution (the 86%-dilemma problem) was never measured.
- **Done:** registered (`validatorRegistry.ts`, quick/advisory) and wired into `IntegratedBestPracticesValidator.runFullValidation` so `metrics.choiceDistribution` is now surfaced (counts, percentages, deviations, branching count). Gating on deviation is deferred to Phase 2. Test added.

---

## Phase 1 — Generator-side fixes (improve generation; no rule weakened)

Each item fixes the *cause* of an Endsong defect at the generation seam. None change a validator threshold. **Refs re-verified against the current tree.**

### 1.1 Callback debt — close the set-flag → payoff loop  *(PR B)*
- **Cause (verified):** `callbackLedger.ts` `recordChoice` (~113-136) seeds a hook **only** from `choice.memorableMoment` (returns `undefined` otherwise) — so ordinary `setFlag` consequences never enter the ledger and SceneWriter is never told to author a payoff `textVariant`. The injection helper `getUnresolvedCallbacksForPrompt` (`FullStoryPipeline.ts` ~17705) returns `undefined` for `episode <= 1`. Harvest runs at `harvestEpisodeCallbacks` (~17733) called ~10288. SceneWriter/ChoiceAuthor already have dedicated prompt sections (`prompts/callbackPromptSection.ts`, `SceneWriter.ts` ~1469) and there is already a `CallbackCoverageValidator` — the infrastructure exists; the **seeding** is the gap.
- **Fix (generator):**
  - In `callbackLedger.ts`, seed a lightweight hook for **every** non-tint flag a choice sets (extend `inferFlagsFromChoice`/`recordChoice`), not just memorableMoment-tagged ones.
  - Add an **orphan-flag reconciliation pass** before final assembly (near the harvest call ~10288): every set flag must have ≥1 downstream `condition`/`textVariant` reader, else either (a) request a SceneWriter payoff variant, or (b) demote the flag to cosmetic `sceneTint`. No flag ships unread.
  - Remove the EP1 inject skip (or pay EP1 hooks off within EP1) so first-episode choices can resolve.
- **Files:** `src/ai-agents/pipeline/callbackLedger.ts`, `src/ai-agents/agents/ChoiceAuthor.ts`, `src/ai-agents/agents/SceneWriter.ts`, `src/ai-agents/prompts/callbackPromptSection.ts`, `FullStoryPipeline.ts`.

### 1.3 Consequence budget — make callback the default tier  *(PR B, coupled with 1.1)*
- **Cause (verified):** `ChoiceAuthor.normalizeConsequenceTier` (~851-860) maps `expression → sceneTint` always, then for the rest defaults `dilemma ? 'branchlet' : 'sceneTint'` (~859), collapsing the budget to branchlet/tint with ~0% callback. The 60/25/10/5 target lives in `ConsequenceBudgetValidator` (target ~24-29) and is advisory.
- **Fix (generator):** rework `normalizeConsequenceTier` so a flag-setting choice with a planned reader (from 1.1) maps to `callback`, reserving `branchlet`/`structuralBranch` for choices that actually change routing (`nextSceneId`). Pair with 1.1 so the realized mix approaches the target. (Validator stays as the check; generator does the work.)
- **Files:** `src/ai-agents/agents/ChoiceAuthor.ts`.

### 1.2 Choice taxonomy — stop forcing dilemma; enforce the distribution  *(PR C)*
- **Cause (verified, refined):** the `expression→dilemma` rewrites are real but **conditional**, firing only when the existing type is `expression`/missing: `StoryArchitect.ts` ~913 (new choicePoint in branch repair), ~933 (`type === 'expression' ? 'dilemma' : …`), ~1143 (choice-density-pressure repair). The blueprint prompt example still hardcodes `"type": "dilemma"` (~2585). The 35/30/20/15 target exists as config in `ChoiceAuthor` (~250-255) and as a *comment* in `StoryArchitect` (~1702-1705), and is now **measured** post-gen by ChoiceDistributionValidator (0.4) — but nothing **biases generation** toward it, and branch-repair promotes to dilemma rather than just setting `branches:true`. The set-level type is source-of-truth (`ChoiceAuthor.ts` ~474-477 copy, ~588-597 force-to-set).
- **Fix (generator):**
  - In the StoryArchitect repair paths, when a branch is needed set `branches:true` and assign a **non-dilemma** routing-capable type (relationship/strategic) instead of promoting to `dilemma`.
  - Add a **deterministic post-pass** that re-types non-branch choice points toward expression/strategic/relationship to hit the per-episode budget.
  - Diversify the blueprint prompt example so it shows all four types.
- **Files:** `src/ai-agents/agents/StoryArchitect.ts`, `src/ai-agents/agents/ChoiceAuthor.ts`.

### 1.7 Skill monoculture — rotate the default statCheck skill  *(PR C)*
- **Cause (verified):** `ChoiceAuthor.ts` ~1355-1368 defaults missing statChecks to `persuasion` (relationship) / `investigation` (strategic) / **`survival`** (dilemma — note: the original plan said "perception"; the real fallback is `survival`). Relationship/dilemma dominate → persuasion ~45%. No per-episode skill-coverage tracking.
- **Fix (generator):** track per-episode skill usage on the agent and pick the **least-used relevant** skill for auto-assigned checks; add skill-coverage guidance to the statCheck prompt section. Target ≥5/6 attributes exercised across the season (the existing SkillCoverage rule).
- **Files:** `src/ai-agents/agents/ChoiceAuthor.ts`.

### 1.4 NPC tiering + relationship dimensions  *(PR D)*
- **Cause (verified):** `CharacterDesigner` lets the LLM tag tier directly (~315-319 doc, ~498 prompt: `core | supporting | background`) with no promotion pass. `NPCDepthValidator` infers dimensions from `initialStats` presence (~180-186: `if (char.initialStats.trust !== undefined) …`) — no stats block → 0 dimensions — and only **warns** (~122-134, no autofix).
- **Fix (generator):**
  - In CharacterDesigner, require any NPC appearing in ≥2 scenes or carrying a mechanical role (a flag/relationship the choices track) to be `core`/`supporting` **and** emit ≥2 relationship dimensions (initialStats).
  - Add a deterministic promotion/backfill pass keyed on actual mechanical usage (e.g., Thorne's `thorne_cooperation` flag read across EP2/EP3 → promote + seed trust/respect). Corrects categorization from evidence rather than relaxing the rule.
- **Files:** `src/ai-agents/agents/CharacterDesigner.ts`, `src/ai-agents/validators/NPCDepthValidator.ts` (as an autofix, not just a warn).

### 1.5 7-point spine — run coverage + backfill missing beats  *(PR D)*
- **Cause (verified, REFRAMED):** the original "partial LLM `structuralRole` **clobbers** the default" premise is **stale** — `SeasonPlannerAgent.ts` ~1171-1180 already loads the full `distributeSevenPoints` default first, then **per-episode replaces** it only where the LLM provided a role (cascading fallback, not a blanket overwrite). The **real** remaining gap: `checkSevenPointCoverage` (`utils/sevenPointDistribution.ts` ~137-169) **exists but is never called** in `buildSeasonPlan`, so a *partial* LLM distribution can still leave canonical beats (pinch1/midpoint/pinch2/climax) uncovered with nothing to detect or fix it.
- **Fix (generator):** call `checkSevenPointCoverage` after the merge and **backfill** any missing canonical beat onto a sensible episode; feed the result back into the map instead of discarding it. (Do **not** reintroduce a clobber — the merge is already correct.)
- **Files:** `src/ai-agents/agents/SeasonPlannerAgent.ts`, `src/ai-agents/utils/sevenPointDistribution.ts`.

### 1.6 EP1 invisible branch — ensure a selecting choice exists  *(PR D)*
- **Cause (verified):** `branchRepair.repairLostSceneGraphBranches` (`branchRepair.ts` ~147-151) requires **≥2 distinct forward in-episode targets** (`ti > currentIdx`) and bails otherwise; `buildSyntheticBranchChoice`/`wireChoiceThroughBridge` exist (~55-64, ~87-110). It **is** called for every episode incl. EP1 (`FullStoryPipeline.ts` ~1003-1015, no EP1 exclusion) — so the original "may not run on EP1" is mostly stale; the residual risk is branch shapes whose targets aren't both strictly-forward, which the filter silently drops.
- **Fix (generator):** broaden the repair so `buildSyntheticBranchChoice`/`wireChoiceThroughBridge` fire whenever `leadsTo` has ≥2 distinct targets even if not both strictly forward (e.g. pivot/convergence shapes), and confirm EP1 scene-1 forks get a selecting choice. (Repair-correctness fix, in the spirit of F5.)
- **Files:** `src/ai-agents/pipeline/branchRepair.ts`, `FullStoryPipeline.ts` (branch-repair call site).

### 1.8 Brief fidelity — preserve genre/tone and signature terms  *(PR E)*
- **Cause (verified):** brief genre/tone is masked by generic fallbacks — `documentParser.ts` ~123-125 and ~558-563 (`'Adventure'` / `'Engaging and immersive'`), `GeneratorScreen.tsx` ~1497-1499 (`sourceAnalysis.genre || 'Adventure'`, `tone || 'Dramatic'`), with `SourceMaterialAnalyzer` extracting genre/tone (~716-717, ~1016-1017) but nothing guaranteeing they survive. The central conceit ("All-Song" → "Codex") renames because **no locked glossary exists anywhere** — `WorldBuilder`/`WorldBible` have no `glossary`/`lockedTerms` field, and SceneWriter only gets `sourceAnalysis.directLanguageFragments.terminology`, not a pinned WorldBible glossary.
- **Fix (generator):**
  - Make genre/tone extraction from a real brief mandatory/validated so the `|| 'Adventure'` / `|| 'Dramatic'` fallbacks never fire for a real brief; or pass the brief's explicit genre/tone straight through.
  - Add a locked-terminology glossary to `WorldBible` in `WorldBuilder`, seed it from the brief's signature terms, and forbid synonym substitution downstream (propagate locked terms to SceneWriter).
- **Files:** `src/ai-agents/agents/SourceMaterialAnalyzer.ts`, `src/ai-agents/utils/documentParser.ts`, `src/screens/GeneratorScreen.tsx`, `src/ai-agents/agents/WorldBuilder.ts`.

---

## Phase 2 — Re-arm the gates (PR F; reverse the nerfs, after Phase 1 lands)

Once a fresh Endsong re-run clears the craft checks, restore strictness. **Refs verified: the three demotions are currently `warning`; the reversal is still pending.**

### 2.1 Reverse the `b831ca0` F3 demotions (three severities, one file)
In `src/ai-agents/validators/FinalStoryContractValidator.ts`:
- `unrepaired_callback_debt` (~L435): `'warning'` → `'error'`.
- `qa_blocker_present` (QA report path, ~L497): `'warning'` → `'error'`.
- best-practices loop (consequence-budget, choice-taxonomy, NPC-depth, stakes-triangle, callback, ~L511): `'warning'` → `'error'`.
- Leave MechanicsLeakage (~L453) and `failed_incremental_validation` (~L475) as `'error'` — **already correct, confirmed.**
- Update the F3 tests in `FinalStoryContractValidator.test.ts` to expect blocking again.

> **Caveat:** re-promote `callback_opportunities` *after* 1.1 proves out, and the `qa_blocker_present` (QA self-assessment score) **last** — it's an LLM self-grade and the noisiest signal. Sequence within Phase 2: callback/consequence/taxonomy/NPC/stakes first, QA-score gate last.

### 2.2 Re-promote architecture-stage craft (`4d63bcd` policy)
Keep the per-line `classifyBlueprintFailure` classifier (verified intact, `StoryArchitect.ts` ~2176-2219). Flip the advisory-craft validators (TreatmentFidelity, DramaticStructure, ThemePressure, SceneTurnContract, EpisodePressure) back to **blocking on the final retry** — *only after* Phase 1 makes blueprints pass them.
- **File:** `src/ai-agents/agents/StoryArchitect.ts` (advisory set ~2183 + the advisory-only early return ~2137).

### 2.3 Align the registry with reality
Update `validatorRegistry.ts` tiers to match the re-armed behavior (currently doc-only and will drift). `ChoiceDistributionValidator` is already registered (0.4). Optionally wire the live dispatch sites to consume the registry so tiers stop being cosmetic.

---

## Keep list — do NOT revert these (false-positive / repair fixes)

- MechanicsLeakage regex hardening (`0a77e46`, `9230d46`, `b01b484`, plus the `cb43d53` strengthening).
- Victor/Radu removal (`b0737c9`).
- Tree-format encounter recount (`7d8c7b6`).
- The F4–F8 "repair instead of abort" + anti-truncation + telemetry commits.
- The `cb43d53` revert of `849b3a1` (incremental failure stays blocking, verified `error`).
- **PR A (Phase 0) work** — the choice-count fix, zero-beat guard, partialVictory fallback, advisory collision-regeneration, and ChoiceDistribution registration. Do not regress these when committing alongside the QA/playthrough changes.

---

## Verification (end-to-end)

1. **Unit tests** for each Phase 0 fix — ✅ landed (14-choice → `totalChoices==14`; zero-beat scene → incremental fail; default-fallback encounter emits 4 outcomes; ChoiceDistribution registered and reporting).
2. **Re-run Endsong** from `00-input-brief.json` after Phase 1. Compare new `07-validation-metrics.json` / `07b-final-story-contract.json` / `06c-encounter-telemetry.json` against this run. Targets:
   - choice taxonomy within ~±10% of 35/30/20/15; consequence budget approaching 60/25/10/5;
   - 0 unread set-flags (callback debt = 0); callback-ledger hooks resolved within the story's episode span;
   - all supporting NPCs ≥2 relationship dimensions; Thorne core;
   - 7-point coverage complete; EP3 carries a climax;
   - EP1 scene-1 has a selecting choice; ≥5/6 attributes exercised, no single skill >35%;
   - genre/tone/title/conceit match the brief;
   - encounters: no phase4 default-collisions; distinct outcomes.
3. **Flip Phase 2 gates**, re-run Endsong, confirm it now passes at **ship** band (≥70) with the gates blocking — proving generation clears the restored bar (no zero-output regression).
4. `npm run validate` (typecheck + lint ratchet + test:coverage + boundary + monolith ratchet) green throughout. Don't grow `FullStoryPipeline.ts` / `imageGenerationService.ts` — extract where a fix adds bulk (Phase 0 already required one documented +35 baseline bump).

## Suggested sequencing / PRs

- **PR A (Phase 0):** measurement fixes — choice count, incremental zero-beat guard, encounter collision regeneration (advisory), register ChoiceDistribution. **✅ DONE (in working tree, uncommitted).**
- **PR B (Phase 1a):** callbacks (1.1) + consequence budget (1.3) — coupled.
- **PR C (Phase 1b):** choice taxonomy (1.2) + skill rotation (1.7).
- **PR D (Phase 1c):** NPC tiering (1.4) + 7-point coverage/backfill (1.5) + EP1 branch (1.6).
- **PR E (Phase 1d):** brief fidelity (1.8).
- **PR F (Phase 2):** reverse `b831ca0` F3 (3 severities), re-promote `4d63bcd` advisory-craft, align registry — only after B–E prove out on an Endsong re-run.

> **Process note:** per saved memory, an hourly cron auto-pushes a *separate* `StoryRPG_New` clone to `origin/main` with no validation. Confirm these changes land on the intended branch/remote and aren't shadowed by that auto-committer before relying on CI.
