# Parallel Generation Status

**Last updated:** May 25, 2026

`ParallelStoryPipeline` has been removed from the active architecture.

The authoritative generation path is:

- `src/ai-agents/pipeline/FullStoryPipeline.ts`
- `src/ai-agents/pipeline/PipelineClient.ts`
- `proxy/workerLifecycle.js`
- focused concurrency utilities already used inside the main pipeline
- deterministic dependency analysis rather than a separate shadow orchestration layer

If more concurrency work is needed, it should be added to the main pipeline architecture instead of reviving a second pipeline implementation.

## What Exists Today

Parallelism is now incremental and local to the subsystem that can safely own
it.

| Area | Current mechanism | Notes |
|---|---|---|
| LLM calls | `BaseAgent` global/per-provider in-flight controls | Controlled through generation config fields such as `llmMaxGlobalInFlight` and `llmMaxPerProviderInFlight` |
| Provider backoff | LLM retry/backoff settings | Includes jitter controls where configured |
| Episode work | Episode-parallel settings exist | Sequential dependency mode remains important when later episodes need prior summaries |
| Scene work | Serial inside an episode today | The historical `sceneParallelismEnabled` flag was removed; topological ordering remains on |
| Image work | local queues, storyboard-v2, provider throttles | Image parallel scene starts are still gated by `EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS` |
| Audio work | local queues and optional worker-mode settings | Optional; depends on ElevenLabs settings |
| Provider RPM | `providerThrottle.ts` and provider adapters | Applies to image providers such as Gemini and Atlas Cloud |
| Worker durability | worker state/checkpoints/dead-letter files | Owned by `proxy/workerLifecycle.js` |
| Progress estimation | `proxy/workerProgress.js` | Worker events are mirrored into generation job state |

## What Is Explicitly Gone

- A second top-level `ParallelStoryPipeline`.
- Scene-level parallelism as a default generation behavior.
- Shadow orchestration that produces a competing story output contract.

## Safe Future Direction

Add concurrency only where the dependency boundary is explicit:

1. Keep season/source/world/character foundation phases serial unless a typed
   phase extraction proves the dependencies.
2. Preserve previous-episode summary dependencies by default.
3. Use deterministic scene dependency graphs before introducing any
   wave-based scene generation.
4. Keep provider-specific concurrency in provider throttles/adapters rather
   than sprinkling sleeps through agents.
5. Persist enough checkpoint output for resumed jobs to avoid rerunning
   expensive provider calls.
6. Prefer typed phase files under `src/ai-agents/pipeline/phases/` over adding
   more branches to the `FullStoryPipeline` monolith.

## Cleanup Direction

The current cleanup policy is to keep `FullStoryPipeline` as the only
authoritative generation path. Old pipeline rules may be reused through
`docs/STORY_QUALITY_CONTRACT.md`, validators, and compact prompt fragments;
old orchestration should not be restored.

`SavingPhase` is already extracted and tested. `WorldBuildingPhase` is
scaffolded but should be wired only as a behavior-preserving migration. The
next low-risk phase extractions are output assembly, audio, browser QA, and
other leaf behaviors that do not change story structure.
