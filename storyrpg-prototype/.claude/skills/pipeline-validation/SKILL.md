---
name: pipeline-validation
description: Use this skill when adding/modifying StoryRPG validators or working with the story-structure contract — IntegratedBestPracticesValidator quick/full checks, standalone season/architecture/diagnostic/final validators, validatorRegistry stage/tier/remediation notes, incremental per-scene validation, StructuralValidator auto-fix, and Story Circle / choice-taxonomy / consequence rules.
---

# Pipeline Validation

Validators live in `src/ai-agents/validators/`. The set churns — the canonical inventory sources are
**`validators/index.ts`** (every exported validator + types) and **`validatorRegistry.ts`** (the
stage → validator → tier/remediation manifest). `validatorRegistry.ts` is documentation-grade, not
the universal live dispatcher, so confirm behavior in the owning call site before editing flow.

Current policy seams include `finalContractSeverityPolicy.ts`, `runFidelityValidators.ts`, and the
owner-stage `NarrativeRealizationTask` gates. Keep `validatorRegistry.ts` aligned with live
dispatch, lifecycle, role, tier, remediation route, and attempt budget.

- **Best-practices orchestrator**: `IntegratedBestPracticesValidator` owns quick/full checks such as
  choice density/distribution/impact, NPC depth, consequence budget, stakes triangle, five-factor,
  callbacks, mechanics leakage, stat balance, skill coverage/surface, branch mechanical divergence,
  Pixar principles, and cliffhanger quality.
- **Standalone**: structural integrity (`StructuralValidator` with `autoFix()`), phase correctness
  (`PhaseValidator`), season/Story Circle (`StoryCircleCoverageValidator`, `SeasonPromiseValidator`,
  `StoryCircleAnchorConformanceValidator`), episode architecture (`EpisodeStoryCircleValidator`,
  `DramaticStructureValidator`, `SceneTurnContractValidator`), fidelity/final-contract validators,
  E2E (`playwrightQARunner`), HTTP assets (`storyAssetWalker`), plus diagnostics. `SeasonValidator`
  and `MicroEpisodeSeasonValidator` are not active validators.
- **Incremental**: `IncrementalValidationRunner` runs per-scene during content generation and returns
  `regenerationRequested: 'scene'|'choices'|'encounter'|'none'`. It also scans ENCOUNTER prose
  (`collectEncounterProseTexts` over storylet/phase beats + clock labels) — encounter scenes carry
  empty `sceneContent.beats`, so without this they validated as a ~1ms no-op (gen-5). POV consistency
  is checked on EVERY beat (not just the opener) via `setProtagonistName` to catch third-person drift.

## The structure contract validators protect

Story Circle spine in canonical order; branch-and-bottleneck (reconverge, no dead ends/orphans/unreachable);
choice taxonomy (`expression`~35% never branches / `relationship` / `strategic` / `dilemma`) with
≥50% of scenes having a choicePoint; stakes triangle (want/cost/identity); five-factor; balanced
consequence budget; encounter-first design with goal/threat clocks and a branching `nextSituation` tree.

## Guardrails

- Don't weaken a validator to pass bad output — tighten the prompt/remediation/data flow instead.
- Use `npm run replay:gates`, `npm run rollout:gates`, and `npm run corpus:check` before promoting or
  consolidating gates; use `npm run audit:episode` for treatment-vs-realized evidence.
- New validator: `validate()` returns `{ passed, metrics, issues }`; wire it at the owning runtime
  call site (season, architecture, quick, full, diagnostic, artifact, final), update
  `validatorRegistry.ts` when it belongs in the gate map, and add config/gates only when runtime
  policy needs them. Register in `IntegratedBestPracticesValidator` only for quick/full checks.
- New BLOCKING class = complete its row in `repairRouteCoverage.test.ts` (route + executable
  handler claim) or CI fails — the closure sweep enumerates every blocking final-stage validator.
  Renames count as new names.
- Cross-artifact identity is never string equality: two LLM outputs never agree on exact strings
  (route tiers vs storylet keys, mined cues vs plan text, IR locations vs the authority). Use
  `utils/entityIdentity.ts` (`entityTokensMatch`) or a judge. Content verdicts are never fuzzy.
- One collector per surface: "where does reader text live" answers belong in shared modules
  (`utils/readerFacingDescriptionFields.ts`, `validators/encounterTextSurfaces.ts`) — when you find
  a private copy, replace it, don't fork it.

See also: the Cursor `pipeline-validation` + `story-structure-rules` skills,
`docs/INCREMENTAL_VALIDATION_PLAN.md`, `docs/STORY_QUALITY_CONTRACT.md`.
