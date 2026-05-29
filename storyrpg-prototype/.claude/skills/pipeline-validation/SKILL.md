---
name: pipeline-validation
description: Use this skill when adding/modifying StoryRPG validators or working with the story-structure contract — the IntegratedBestPracticesValidator orchestrator, standalone structural/phase/season/coverage validators, incremental per-scene validation, StructuralValidator auto-fix, and the 7-point / choice-taxonomy / consequence rules they enforce.
---

# Pipeline Validation

Validators live in `src/ai-agents/validators/`. The set churns (~50 files) — the canonical sources
of truth are **`validators/index.ts`** (every exported validator + types) and
**`validatorRegistry.ts`** (the stage → validator → tier dispatch map: which runs in which phase and
whether it's HARD or advisory). Read those before assuming a validator's name, wiring, or severity.

- **Orchestrator**: `IntegratedBestPracticesValidator` runs the six best-practice validators
  (`ChoiceDensity`, `NPCDepth`, `ConsequenceBudget`, `StakesTriangle`, `FiveFactor`,
  `CallbackOpportunities`) in quick mode (heuristic, no LLM, Phase 4.5) or full mode (LLM scoring, Phase 5).
- **Standalone**: structural integrity (`StructuralValidator` with `autoFix()`), phase correctness
  (`PhaseValidator`), season (`MicroEpisodeSeasonValidator`, `SeasonPromiseValidator` — the old
  `SeasonValidator` was removed), coverage (`SevenPointCoverageValidator`), E2E (`playwrightQARunner`),
  HTTP assets (`storyAssetWalker`), plus many narrative validators.
- **Incremental**: `IncrementalValidationRunner` runs per-scene during content generation and returns
  `regenerationRequested: 'scene'|'choices'|'encounter'|'none'`.

## The structure contract validators protect

7-point spine in canonical order; branch-and-bottleneck (reconverge, no dead ends/orphans/unreachable);
choice taxonomy (`expression`~35% never branches / `relationship` / `strategic` / `dilemma`) with
≥50% of scenes having a choicePoint; stakes triangle (want/cost/identity); five-factor; balanced
consequence budget; encounter-first design with goal/threat clocks and a branching `nextSituation` tree.

## Guardrails

- Don't weaken a validator to pass bad output — tighten the prompt/remediation/data flow instead.
- New validator: `validate()` returns `{ passed, metrics, issues }`; register in the orchestrator
  and/or `validatorRegistry.ts`; add config to `ValidationConfig`; if auto-fixable, extend
  `StructuralValidator.autoFix()`.

See also: the Cursor `pipeline-validation` + `story-structure-rules` skills,
`docs/INCREMENTAL_VALIDATION_PLAN.md`, `docs/STORY_QUALITY_CONTRACT.md`.
