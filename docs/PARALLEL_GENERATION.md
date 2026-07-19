# Variant Batch Generation

**Last updated:** July 19, 2026

The pipeline shorthand for “reuse one locked analysis and run several complete alternatives” is **Variant Batch**. Its wire-level discriminator is `kind: "variant-batch"`.

A Variant Batch contains two to four ordinary generation jobs. Source analysis and the season plan are prepared once, hashed, and copied into every child request. After that boundary, every child runs the complete `FullStoryPipeline` independently and concurrently, producing its own checkpoints, memory namespace, output directory, `story.json`, manifest, quality evidence, and worker result.

The proxy admits the batch atomically through `POST /worker-batches/start`. Batch status, cancellation, and selection use `/worker-batches/:batchId`. Story-worker admission is capped at four concurrent processes even if `STORYRPG_STORY_WORKER_CONCURRENCY` requests a larger value.

Variant outputs remain held out of the reader catalog. The Generator can inspect each exact package through `/story-runs/:runId`; selecting a completed variant promotes only that package, and only when it already passed the normal reader quality gate.

## Concurrency Boundaries

| Area | Mechanism |
|---|---|
| Alternative full runs | Variant Batch, 2–4 independent worker jobs |
| LLM calls inside one run | `BaseAgent` global/per-provider in-flight controls |
| Image/audio/video work | Local queues and provider throttles |
| Episodes inside one story run | Sequential, preserving canon and prior-episode dependencies |

`EpisodePipeline` and `ParallelStoryPipeline` remain removed. The dormant episode-parallel configuration and scheduling branch were also removed; “parallel generation” must not be used as an ambiguous synonym for either internal provider concurrency or Variant Batch.
