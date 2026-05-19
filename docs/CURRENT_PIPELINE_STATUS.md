# Current Pipeline Status

**Last Updated:** May 2026

This is the short operational status of the codebase as it exists now. It is
intended to answer "what is live?" before older architecture notes or audit
documents are consulted.

## Authoritative Path

Story generation is owned by `src/ai-agents/pipeline/FullStoryPipeline.ts`.
The UI talks to `PipelineClient`, the Express proxy starts a worker through
`proxy/workerLifecycle.js`, and the worker streams structured pipeline events
back into the generation job stores.

`src/ai-agents/pipeline/EpisodePipeline.ts` still exists only as legacy code.
It is not exported from `src/ai-agents/pipeline/index.ts` and should not be
used for new work. `ParallelStoryPipeline` has been removed.

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
6. Validation: incremental per-scene checks, quick best-practices checks,
   LLM QA, branch/divergence checks, setup/payoff checks, twist checks, and
   arc-delta checks.
7. Media: `ImageAgentTeam`, storyboard-v2 beat imagery, encounter imagery,
   provider-aware reference packs, optional Stable-Diffusion LoRA training,
   optional video generation, and optional ElevenLabs narration.
8. Finalization: runtime `Story` assembly, `SavingPhase`,
   `pipelineOutputWriter`, asset HTTP validation, optional Playwright
   multi-path QA, and image remediation/re-save when possible.

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

## Concurrency and Resumability

The pipeline uses local worker queues, semaphores, and provider throttles rather
than a second orchestration pipeline. LLM concurrency is controlled in
`BaseAgent`; image and audio work use local queues; provider RPM/concurrency
limits live in `providerThrottle.ts` and the image service adapters.

Workers persist job state, checkpoints, dead-letter state, checkpoint output
files, and sanitized timelines through `proxy/workerLifecycle.js`.
