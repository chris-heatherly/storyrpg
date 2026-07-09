# Current Pipeline Status

**Last Updated:** July 8, 2026

This is the short operational status of the codebase as it exists now. It is
intended to answer "what is live?" before older architecture notes or audit
documents are consulted.

For the broader app/proxy/deployment snapshot, read `docs/PROJECT_STATUS.md`
first. This file stays focused on generation and output compatibility.

## Authoritative Path

Story generation is owned by `src/ai-agents/pipeline/FullStoryPipeline.ts`.
The UI talks to `PipelineClient`, the Express proxy starts a worker through
`proxy/workerLifecycle.js`, and the worker streams structured pipeline events
back into the generation job stores.

`EpisodePipeline.ts` and `ParallelStoryPipeline` are no longer present. New
work should use `FullStoryPipeline` and its extracted phase modules.

The app now has two target-specific web entries:

- `apps/reader/ReaderApp.tsx` for public playback.
- `apps/generator/GeneratorApp.tsx` for internal generation and media jobs.

The generator target is the active UI surface for `PipelineClient` and worker
jobs. The reader target must remain isolated from generation modules; that
boundary is enforced by `npm run check:reader-boundary`.

## Current Generation Flow

### Authored-lite treatments (`sourceKind === 'authored_lite'`)

Structural authorship collapses to five stages. ESC is the sole structural
author; later agents compile, realize, or enforce — they do not invent scene
order or topology.

1. **Parse + ESC** — `treatmentExtraction` / `SourceMaterialAnalyzer` →
   `compileEpisodeSpine` → `seasonScenePlanBuilder` projection.
   `SeasonPlannerAgent` may only overlay metadata (budgets/flags); it must not
   call `authorScenePlanLLM` or mutate scene id/order/`spineUnitId`.
2. **Facts** — `WorldBuilder` + `CharacterDesigner` (world/character bibles).
3. **Realize** — `StoryArchitect` fill-slots only (ESC unit text → turnContracts);
   `BranchManager` deterministic skeleton (LLM annotation skipped unless
   `STORYRPG_BRANCH_ANNOTATION=1` / branch shadow mode);
   `SceneWriter` / `ChoiceAuthor` / `EncounterArchitect` with ESC-compiled
   thread/twist/arc directives (Thread/Twist/Arc LLMs skipped unless
   `STORYRPG_THREAD_TWIST_PLANNING=1` / `STORYRPG_CHARACTER_ARC_TRACKING=1`).
4. **Enforce** — plan-time fidelity + `EpisodeSpineContractValidator`; final
   text contract with prose/field repair only. Structural classes
   (`blueprint_rebalance` / `episode_replan`) fail closed toward architecture
   retry or ESC/`rebuildTreatmentSeasonScenePlan` refresh.
5. **Media** — post-story images/video/audio after the text contract passes.

Skip telemetry (debug events): `thread_twist_skipped_authored_lite`,
`character_arc_skipped_authored_lite`, `branch_annotation_skipped_authored_lite`.

Cognee remains advisory-only: index compiled ESC/ledger facts, not competing
LLM plans.

### Non-authored-lite / invent-mode

1. Optional source analysis via `SourceMaterialAnalyzer`.
2. Optional season planning via `SeasonPlannerAgent` (may LLM-upgrade scene
   plans when not treatment-bound) and `StoryCircleCoverageValidator`.
3. Shared foundation: `WorldBuilder`, `CharacterDesigner`, `NPCDepthValidator`,
   and `PhaseValidator`.
4. Per-episode planning and content: `StoryArchitect` (invent-mode allowed),
   `BranchManager`, `SceneWriter`, `ChoiceAuthor`, and `EncounterArchitect`.
5. Optional narrative scaffolding: `ThreadPlanner`, `TwistArchitect`,
   `CharacterArcTracker` (when generation flags enable them), plus
   `CallbackLedger` and optional `SceneCritic`.
6. Mechanical story metadata: story verbs, affordance sources, witness
   reactions, failure residue, branch-shadow diagnostics, and visualizer
   diagnostics where enabled.
7. Validation: incremental per-scene checks, quick best-practices checks,
   LLM QA, branch/divergence checks, scene graph checks, setup/payoff checks,
   twist checks, arc-delta checks, mechanical storytelling checks, sequence
   continuity audits, and treatment-fidelity checks.
8. Post-story media: after story authoring, per-episode QA, and episode
   failure gates complete, the pipeline runs master reference visuals,
   storyboard-v2 beat imagery, `ImageAgentTeam`, encounter imagery,
   provider-aware reference packs, structured art-style profiles,
   preapproved style anchors, optional Stable-Diffusion LoRA training,
   optional video generation, and optional ElevenLabs narration.
9. Finalization: runtime `Story` assembly from the story-first episodes plus
   post-story media assets, `SavingPhase`,
   `pipelineOutputWriter`, story codec packaging, asset HTTP validation,
   optional Playwright multi-path QA, and image remediation/re-save when
   possible.

`SavingPhase` and `WorldBuildingPhase` are wired active paths under
`src/ai-agents/pipeline/phases/`. Continue phase extraction as
behavior-preserving migrations.

## Output Contract

Generated story directories now write a modern package:

- `story.json` — primary versioned story package.
- `manifest.json` — declares `primaryStoryFile` and records the story package
  checksum when available.

The proxy catalog reads `manifest.json` first, then falls back to `story.json`.
Legacy-only directories must be migrated before runtime load. The client fetch
path trusts `story.json` on disk through `/stories/:id` after worker completion
rather than relying on the transient worker result blob.

Media references are resolved through `src/assets/assetResolver.ts` and
`src/services/storyLibrary.ts`. Modern packages may carry content-addressed
`AssetRef` objects; legacy string paths remain supported.

Reader-safe content exports are produced by `npm run content:reader:export` or
`npm run reader:export:with-content`. The export intentionally omits prompts,
checkpoints, job state, LoRA artifacts, source uploads, and diagnostics.

## Active Compatibility Boundaries

- `ImageGenerator.ts` has been removed. Active image definitions live in
  `src/ai-agents/images/imageTypes.ts`, and active work flows through
  storyboard-v2, `ImageAgentTeam`, and `ImageGenerationService`.
- Legacy generated stories are still supported through codec migrations and the
  migration script, not catalog fallback reads.
- The old `useapi` provider name should be treated as historical. Current
  provider selection uses `midapi`.
- Image-team coordinator and visual-check scaffolds are present, but the live
  path is the storyboard-v2 / `ImageAgentTeam` / `ImageGenerationService`
  flow, with `VisualQualityJudge` and modular `visualChecks` used where wired.
- The old monolithic `App.tsx` shell has been removed; `apps/reader` and
  `apps/generator` are the bundle/deployment entries.
- Stable Diffusion supports the A1111/Forge backend today. Other backend enum
  names are future adapter placeholders.
- LoRA training is Stable-Diffusion-only and concretely wired through the
  `kohya` sidecar adapter.

## Concurrency and Resumability

The pipeline uses local worker queues, semaphores, and provider throttles rather
than a second orchestration pipeline. LLM concurrency is controlled in
`BaseAgent`; image and audio work use local queues; provider RPM/concurrency
limits live in `providerThrottle.ts` and the image service adapters.

Workers persist job state, checkpoints, dead-letter state, checkpoint output
files, and sanitized timelines through `proxy/workerLifecycle.js`.

The proxy also normalizes stale/orphaned jobs on startup and periodically
prunes completed jobs, orphaned checkpoints, stale MidAPI callbacks, and old
worker result cache entries. High-memory relief trims large worker timelines,
image job lists, video job lists, and checkpoint outputs before forcing GC when
available.

## Current Command Notes

Run commands from `storyrpg-prototype/`.

- `npm run reader:web` starts the public reader target on port 8081.
- `npm run generator:web` starts the internal generator target on port 8082.
- `npm run dev` starts the proxy plus reader target.
- `npm run reader:export` is the Vercel/public build command.
- `npm run generator:export:internal` exists for internal inspection only.
- `npm run validate:reader` checks reader type safety, reader/generator
  boundary safety, and focused reader tests.
