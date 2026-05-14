# Parallel Generation Status

`ParallelStoryPipeline` has been removed from the active architecture.

The authoritative generation path is:

- `src/ai-agents/pipeline/FullStoryPipeline.ts`
- focused concurrency utilities already used inside the main pipeline
- deterministic dependency analysis rather than a separate shadow orchestration layer

If more concurrency work is needed, it should be added to the main pipeline architecture instead of reviving a second pipeline implementation.

## Cleanup Direction

The current cleanup policy is to keep `FullStoryPipeline` as the only
authoritative generation path. Old pipeline rules may be reused through
`docs/STORY_QUALITY_CONTRACT.md`, validators, and compact prompt fragments;
old orchestration should not be restored.
