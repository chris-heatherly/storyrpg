# Current Pipeline Status

**Last Updated:** May 25, 2026

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

`src/ai-agents/pipeline/EpisodePipeline.ts` still exists only as legacy code.
It is not exported from `src/ai-agents/pipeline/index.ts` and should not be
used for new work. `ParallelStoryPipeline` has been removed.

The app now has two target-specific web entries:

- `apps/reader/ReaderApp.tsx` for public playback.
- `apps/generator/GeneratorApp.tsx` for internal generation and media jobs.

The generator target is the active UI surface for `PipelineClient` and worker
jobs. The reader target must remain isolated from generation modules; that
boundary is enforced by `npm run check:reader-boundary`.

## Current Generation Flow

1. Optional source analysis via `SourceMaterialAnalyzer`.
2. Optional season planning via `SeasonPlannerAgent` and
   `SevenPointCoverageValidator`.
3. Shared foundation: `WorldBuilder`, `CharacterDesigner`, `NPCDepthValidator`,
   and `PhaseValidator`.
4. Per-episode planning and content: `StoryArchitect`, `BranchManager`,
   `SceneWriter`, `ChoiceAuthor`, and `EncounterArchitect`.
5. Narrative scaffolding: `ThreadPlanner`, `TwistArchitect`,
   `CharacterArcTracker`, `CallbackLedger`, and optional `SceneCritic`.
6. Mechanical story metadata: story verbs, affordance sources, witness
   reactions, failure residue, branch-shadow diagnostics, and visualizer
   diagnostics where enabled.
7. Validation: incremental per-scene checks, quick best-practices checks,
   LLM QA, branch/divergence checks, scene graph checks, setup/payoff checks,
   twist checks, arc-delta checks, mechanical storytelling checks, sequence
   continuity audits, and treatment-fidelity checks.
8. Media: storyboard-v2 beat imagery, `ImageAgentTeam`, encounter imagery,
   provider-aware reference packs, structured art-style profiles,
   preapproved style anchors, optional Stable-Diffusion LoRA training,
   optional video generation, and optional ElevenLabs narration.
9. Finalization: runtime `Story` assembly, `SavingPhase`,
   `pipelineOutputWriter`, story codec packaging, asset HTTP validation,
   optional Playwright multi-path QA, and image remediation/re-save when
   possible.

`SavingPhase` is wired and tested. `WorldBuildingPhase` is scaffolded in
`src/ai-agents/pipeline/phases/` but is not yet the fully wired active boundary
for world-building behavior. Continue phase extraction as behavior-preserving
migrations.

## Output Contract

Generated story directories now write a modern package:

- `story.json` — primary versioned story package.
- `manifest.json` — declares `primaryStoryFile` and records the story package
  checksum when available.
- `08-final-story.json` — legacy mirror kept for older scripts and fallback
  readers.

The proxy catalog reads `manifest.json` first, then falls back to `story.json`,
then to `08-final-story.json`. The client fetch path trusts `story.json` on
disk through `/stories/:id` after worker completion rather than relying on the
transient worker result blob.

Media references are resolved through `src/assets/assetResolver.ts` and
`src/services/storyLibrary.ts`. Modern packages may carry content-addressed
`AssetRef` objects; legacy string paths remain supported.

Reader-safe content exports are produced by `npm run content:reader:export` or
`npm run reader:export:with-content`. The export intentionally omits prompts,
checkpoints, job state, LoRA artifacts, source uploads, and diagnostics.

## Active Compatibility Boundaries

- `ImageGenerator.ts` remains as a compatibility export for older imports;
  active type definitions live in `src/ai-agents/images/imageTypes.ts`.
- Legacy generated stories are still supported through codec migrations and
  catalog fallback reads.
- The old `useapi` provider name should be treated as historical. Current
  provider selection uses `midapi`.
- Image-team coordinator and visual-check scaffolds are present, but the live
  path is the storyboard-v2 / `ImageAgentTeam` / `ImageGenerationService`
  flow, with `VisualQualityJudge` and modular `visualChecks` used where wired.
- `App.tsx` remains in the tree as a monolithic shell, but the target-specific
  `apps/reader` and `apps/generator` entries are the current bundle/deployment
  path.
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
