# StoryRPG Tech Debt Audit

Date: 2026-05-25

This audit covers the whole StoryRPG codebase with an actionable backlog bias.
It is based on static inspection plus the current validation commands run from
`storyrpg-prototype/`. Generated stories, build outputs, dependency folders,
and runtime artifacts are out of scope except where their contracts affect app
correctness.

## Executive Summary

The repo is in a workable state: typecheck passes, Vitest passes, and the
reader/generator boundary check passes. The core debt is not broken tests; it is
hidden risk concentrated in a few very large, weakly typed modules that combine
runtime orchestration, provider integration, persistence, compatibility, and UI
concerns.

Top priorities:

1. Finish extracting typed phases from `FullStoryPipeline.ts`.
2. Continue decomposing image generation/provider orchestration.
3. Type and split reader runtime state/UI modules that currently run under
   `@ts-nocheck`.
4. Harden reader/generator and secret boundaries so deployment safety does not
   depend on conventions alone.
5. Ratchet lint/type guardrails from "warnings and disabled rules" into
   enforceable subsystem contracts.

## Baseline Health

Commands run from `storyrpg-prototype/`:

| Command | Result | Notes |
|---|---:|---|
| `npm run typecheck` | Pass | App, test, contracts, and worker configs completed successfully. |
| `npm test` | Pass | 133 test files passed, 1 skipped; 1059 tests passed, 1 skipped. |
| `npm run lint` | Pass with warnings | 429 warnings, 0 errors; 9 warnings are auto-fixable. |
| `npm run check:reader-boundary` | Pass | Reader boundary clean, 66 files checked. |

Current dirty files observed before this report:

- `storyrpg-prototype/src/ai-agents/agents/SourceMaterialAnalyzer.test.ts`
- `storyrpg-prototype/src/ai-agents/utils/treatmentExtraction.ts`

This audit does not modify either file.

## Debt Inventory

Static counts from `src`, `proxy`, and `scripts`, excluding tests where noted:

| Signal | Count | Why it matters |
|---|---:|---|
| `@ts-nocheck` references | 23 | TypeScript is disabled across critical runtime, pipeline, image, and legacy story paths. |
| `any`-like usage | 787 | Contract drift is being handled dynamically rather than with shared types. |
| TS/ESLint suppressions | 9 | Small count, but several suppressions live near IO/runtime helpers. |
| TODO/FIXME/HACK/XXX | 23 | Most important markers already point to phased tech debt plans. |
| `console.*` in `src` | 999 | Lint only warns; logging is noisy and bypasses the app logger in many production paths. |
| Lint warnings | 429 | Guardrails exist, but most are warnings and many strict rules are disabled. |

Largest non-generated files:

| File | Lines | Risk |
|---|---:|---|
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | 20146 | Central generation orchestration monolith under `@ts-nocheck`. |
| `src/ai-agents/services/imageGenerationService.ts` | 6561 | Multi-provider image service with endpoint, retry, QA, and provider-specific behavior in one file. |
| `src/screens/GeneratorScreen.tsx` | 5545 | Large internal UI screen under `@ts-nocheck`, coupled to proxy and generation settings. |
| `src/ai-agents/agents/image-team/ImageAgentTeam.ts` | 4804 | Image planning, illustration, consistency, and QA mixed under `@ts-nocheck`. |
| `src/ai-agents/agents/EncounterArchitect.ts` | 4315 | Complex LLM output shaping and fallback behavior. |
| `src/components/EncounterView.tsx` | 2667 | Reader runtime encounter UI under `@ts-nocheck`. |
| `src/components/StoryReader.tsx` | 2590 | Main playback UI with web/native conditionals and persistence hooks. |
| `src/stores/gameStore.ts` | 1551 | Core player state persistence under `@ts-nocheck`. |
| `proxy/workerLifecycle.js` | 1688 | Job lifecycle and worker process behavior in untyped JS. |

## Ranked Backlog

### Fix Now

#### 1. Extract typed pipeline phases from `FullStoryPipeline`

- Severity: High
- Area: AI pipeline / worker orchestration
- Evidence: `FullStoryPipeline.ts` is 20146 lines, uses `@ts-nocheck`, has 222 `any`-like matches, and has 186 `console.*` matches.
- Impact: Generation behavior is hard to reason about, cancellation/resume paths are hard to prove, and changes can silently break story output contracts.
- Existing plan: `src/ai-agents/pipeline/phases/README.md` already defines the migration. `SavingPhase` is wired; `WorldBuildingPhase` is scaffolded but not wired.
- First fix: Wire `WorldBuildingPhase` without behavior changes, then extract `AudioPhase` and `BrowserQAPhase` because they are lower-risk leaf phases.
- Acceptance criteria: New phase files typecheck without `@ts-nocheck`; each phase has a smoke test that mocks heavy agents and asserts event/checkpoint behavior; `npm run typecheck` and focused phase tests pass.
- Validation: `npm run typecheck`, `npm test -- pipeline`, and a no-provider dry-run or mocked worker test where available.

#### 2. Split `pipelineOutputWriter` from pipeline/runtime compatibility

- Severity: High
- Area: Pipeline output contract / generated story packaging
- Evidence: `pipelineOutputWriter.ts` is 2141 lines, under `@ts-nocheck`, writes both modern `story.json` and legacy `08-final-story.json`, and mixes asset packaging, manifests, checkpoints, compatibility mirrors, and web/native filesystem branches.
- Impact: A packaging bug can cause reader-visible content loss even when story generation succeeds.
- First fix: Extract pure story-package normalization and manifest construction into typed helpers, leaving filesystem writes in a thin IO layer.
- Acceptance criteria: Unit tests cover modern and legacy output mirrors, manifest contents, checkpoint file listing, and asset URL stripping.
- Validation: `npm test -- pipelineOutputWriter storyLibrary`, `npm run typecheck`.

#### 3. Lock down secret and environment boundaries

- Severity: High
- Area: Config / deployment / reader-generator split
- Evidence: Reader boundary check blocks known generator strings, but `EXPO_PUBLIC_*API_KEY` fallbacks still appear in pipeline/server config paths. `.env.example` includes `EXPO_PUBLIC_GEMINI_API_KEY`; docs say Vercel reader env must not include provider keys.
- Impact: Reader deployment safety depends on discipline and string checks rather than a typed/validated env contract.
- First fix: Add explicit `readerEnv` and `generatorEnv` parsing modules, with denylist tests for provider keys in reader config.
- Acceptance criteria: Reader build code cannot import generator env parsing; reader boundary script checks env names from one central denylist; docs and `.env.example` distinguish public reader config from local generator/provider secrets.
- Validation: `npm run check:reader-boundary`, `npm run reader:typecheck`, `npm run generator:typecheck`.

#### 4. Type the core reader state path

- Severity: High
- Area: Reader runtime / persistence
- Evidence: `gameStore.ts` is 1551 lines under `@ts-nocheck`; `EncounterView.tsx` is 2667 lines under `@ts-nocheck`; `StoryReader.tsx` has 14 `any`-like matches and 19 `console.*` matches.
- Impact: Player progress, encounter state, consequences, and persisted state compatibility can regress without compile-time signal.
- First fix: Extract typed consequence application and encounter persistence helpers from `gameStore`, then remove `@ts-nocheck` from those new helpers before touching UI.
- Acceptance criteria: Consequence application, resume, encounter progress, and reset flows have deterministic unit coverage.
- Validation: `npm test -- storyEngine conditionEvaluator resolutionEngine encounter rewindEngine`, `npm run reader:typecheck`.

### Fix Next

#### 5. Continue `ImageAgentTeam` coordinator extraction

- Severity: Medium-high
- Area: Image generation
- Evidence: `ImageAgentTeam.ts` is 4804 lines under `@ts-nocheck`; the coordinator README identifies four concerns: planning, illustration, consistency, and quality. The file has 82 `any`-like matches and 64 `console.*` matches.
- Impact: Image generation changes are brittle because prompt planning, provider calls, consistency state, and QA are tangled.
- Existing plan: `src/ai-agents/agents/image-team/coordinators/README.md` defines a behavior-only extraction strategy.
- First fix: Move small pure helpers into `ImagePlanningCoordinator` while leaving `ImageAgentTeam` as a delegator.
- Acceptance criteria: Each moved coordinator method has a smoke test; public `ImageAgentTeam` behavior stays unchanged.
- Validation: `npm test -- imageGenerationService storyboard-v2`, `npm run typecheck`.

#### 6. Decompose `imageGenerationService`

- Severity: Medium-high
- Area: Image providers / adapters
- Evidence: `imageGenerationService.ts` is 6561 lines, has 67 `any`-like matches, and embeds direct calls to Gemini/OpenAI/Atlas/MidAPI endpoints even though provider adapters also exist.
- Impact: Provider-specific fixes risk cross-provider regressions, and rate-limit/retry behavior is hard to compare across providers.
- First fix: Move remaining direct provider branches behind provider adapter interfaces; keep shared retry/rate limiting in one typed policy.
- Acceptance criteria: Provider adapters own external endpoint details; shared service owns routing, rate policy, and artifact normalization only.
- Validation: `npm test -- imageGenerationService stable-diffusion`, provider registry tests, `npm run typecheck`.

#### 7. Make proxy route contracts explicit

- Severity: Medium
- Area: Proxy / worker / filesystem
- Evidence: `proxy/workerLifecycle.js` is 1688 lines of JS; proxy routes perform external API proxying, file IO, job lifecycle, auth, and generated story serving without TypeScript contracts.
- Impact: Client/proxy mismatches can ship because many route payloads are only informally typed.
- First fix: Add shared Zod schemas for worker job status, generation job updates, story manifest responses, and proxy error envelopes.
- Acceptance criteria: Proxy validates inbound/outbound payloads for the highest-traffic routes and client tests use the same schemas.
- Validation: Targeted store/service tests, `npm run typecheck`, optional proxy health smoke test.

#### 8. Ratchet ESLint from broad warning mode to subsystem budgets

- Severity: Medium
- Area: Tooling / maintainability
- Evidence: ESLint explicitly disables multiple TypeScript rules and reports 429 warnings, mostly `no-console`; proxy, scripts, `App.tsx`, and configs are ignored.
- Impact: The repo has a lint command, but it does not yet prevent new debt in the riskiest areas.
- First fix: Add per-directory warning budgets and fail only on new warnings in touched files or selected directories.
- Acceptance criteria: `src/engine`, `src/types`, and new pipeline phase/coordinator files have stricter rules than legacy monoliths.
- Validation: `npm run lint`.

#### 9. Centralize endpoint construction

- Severity: Medium
- Area: Config / local dev / provider integration
- Evidence: `src/config/endpoints.ts` exists, but hardcoded `localhost:3001` and direct provider URLs still appear in `FullStoryPipeline`, `StoryboardAgent`, `ImageAgentTeam`, `KohyaAdapter`, `GeneratorScreen`, validators, and services.
- Impact: Local/proxy/cloud behavior can diverge, especially for native, reader export, and worker contexts.
- First fix: Extend endpoint helpers for worker/proxy write-file, lora training, generated story asset URLs, and provider metadata endpoints.
- Acceptance criteria: New code uses endpoint helpers; lint can flag hardcoded app/proxy URLs outside `endpoints.ts` and proxy route modules.
- Validation: `npm run lint`, `npm run typecheck`.

#### 10. Add smoke coverage for reader/generator split

- Severity: Medium
- Area: Deployment / bundle safety
- Evidence: `check-reader-boundary` passes and docs define the split, but the script relies on static import walking plus forbidden strings.
- Impact: Dynamic imports, env additions, or new generated exports could bypass intent.
- First fix: Add a small test around the forbidden path/string list and require new generator-only modules to be declared centrally.
- Acceptance criteria: Boundary denylist is centralized; test fails when a generator-only module is reachable from reader entry.
- Validation: `npm run check:reader-boundary`, `npm run validate:reader`.

### Watch

#### 11. Legacy story compatibility

- Severity: Medium
- Area: Story data / reader compatibility
- Evidence: Built-in legacy story files carry `@ts-nocheck` because they predate current outcome fields. Asset and manifest code supports both `story.json` and `08-final-story.json`.
- Impact: Removing compatibility too early would risk existing generated stories and fixtures.
- Recommendation: Keep compatibility until migration tooling proves all built-ins and generated packages satisfy the current codec. Then retire legacy mirrors in a documented release step.
- Validation: `npm run validate:assets`, story codec tests, reader playback smoke tests.

#### 12. Narration service dependency drift

- Severity: Medium-low
- Area: Audio / reader experience
- Evidence: `narrationService.ts` is under `@ts-nocheck` with a note about missing `expo-audio`; it also has web audio escape hatches.
- Impact: Optional narration can regress silently across web/native targets.
- Recommendation: Decide whether narration uses the current Expo audio package or a web-only path; then type the service around that decision.
- Validation: Focused narration tests plus a browser/native smoke when audio behavior changes.

#### 13. Visualizer data-model drift

- Severity: Medium-low
- Area: Developer tooling
- Evidence: `storyGraphTransformer.ts` is under `@ts-nocheck` for data-model consolidation and contains compatibility assumptions around encounters and choices.
- Impact: Visualizer can misrepresent generated story branching, which hurts debugging but is less directly user-facing than reader playback.
- Recommendation: Address after core story/encounter types settle; add fixture-based graph snapshots for one built-in story and one generated story package.
- Validation: `npm test -- visualizer`.

## Remediation Roadmap

### Phase 1: Guard the Shipped Surface

- Add reader/generator env schema split and denylist tests.
- Keep `check-reader-boundary` required for reader validation.
- Extract typed consequence/persistence helpers from `gameStore`.
- Replace direct `console.log` in reader-visible runtime files with `src/utils/logger.ts`.

### Phase 2: Shrink the Pipeline Monolith

- Wire `WorldBuildingPhase`.
- Extract `AudioPhase`, `BrowserQAPhase`, and `AssemblyPhase`.
- Require all new phase files to typecheck without `@ts-nocheck`.
- Add phase smoke tests that assert event, checkpoint, cancellation, and output contracts.

### Phase 3: Untangle Image Generation

- Move pure planning helpers into coordinators first.
- Keep `ImageAgentTeam` public methods as delegators during migration.
- Move provider-specific endpoint and payload code behind adapters.
- Add smoke tests for coordinator contracts and provider routing.

### Phase 4: Ratchet Tooling

- Introduce stricter lint rules for new files and already-clean directories.
- Track warning budgets for `no-console`, `any`, and unused suppressions.
- Turn endpoint hardcoding into an error outside approved modules once helpers exist.
- Move worker/proxy payload contracts into shared schemas.

## Issue-Ready Top Items

### Issue: Wire `WorldBuildingPhase` into `FullStoryPipeline`

Labels: `tech-debt`, `pipeline`, `type-safety`

Acceptance criteria:

- `FullStoryPipeline` delegates world building through `WorldBuildingPhase`.
- Behavior is unchanged except for typed phase boundaries.
- Phase smoke test covers success, emitted progress, and failure propagation.
- `npm run typecheck` and focused pipeline tests pass.

### Issue: Extract typed output package normalization

Labels: `tech-debt`, `pipeline`, `generated-content`

Acceptance criteria:

- Story package normalization is a pure typed helper.
- Filesystem writes remain in an IO wrapper.
- Tests cover `story.json`, legacy `08-final-story.json`, manifest entries, and image data stripping.
- `npm test -- pipelineOutputWriter storyLibrary` passes.

### Issue: Add reader/generator env schema split

Labels: `tech-debt`, `deployment`, `security`

Acceptance criteria:

- Reader-safe env vars are parsed separately from generator/provider secrets.
- Provider keys cannot be imported by reader entry paths.
- `check-reader-boundary` consumes the same denylist used by env tests.
- `.env.example` separates reader public config from local generator secrets.

### Issue: Extract typed consequence application from `gameStore`

Labels: `tech-debt`, `reader`, `state`

Acceptance criteria:

- Consequence application logic moves into typed helpers.
- Existing persisted state compatibility is preserved.
- Tests cover flags, scores, relationships, tags, inventory, pending consequences, and reset.
- `npm test -- storyEngine conditionEvaluator resolutionEngine encounter` passes.

### Issue: Begin `ImagePlanningCoordinator` migration

Labels: `tech-debt`, `image-pipeline`, `type-safety`

Acceptance criteria:

- One small pure planning method group moves out of `ImageAgentTeam`.
- `ImageAgentTeam` delegates to the coordinator with no public API change.
- Coordinator smoke tests cover the moved contract.
- `npm test -- imageGenerationService storyboard-v2` and `npm run typecheck` pass.

## Notes and Assumptions

- Passing baseline checks mean the next work should prefer small behavior-preserving refactors with tests, not broad rewrites.
- The existing migration docs are directionally correct and should remain the source of sequencing for pipeline and image extraction.
- Legacy output and built-in story compatibility are real product constraints, not merely cleanup opportunities.
- The two pre-existing dirty files listed above should be reviewed separately from this audit.
