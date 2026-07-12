---
name: storyrpg-pipeline-debugging
description: Use this skill when debugging StoryRPG story generation failures, stuck or cancelled worker jobs, FullStoryPipeline behavior, retry loops, pipeline checkpoints, generated story output, or validation failures surfaced during generation.
---

# StoryRPG Pipeline Debugging

## Workflow

Read `docs/CURRENT_PIPELINE_STATUS.md` first. For authored-lite runs, separate ESC/architecture
ownership failures from `NarrativeRealizationTask` owner-stage evidence failures; do not hide either
by weakening final validation.

Start from the failing symptom, then trace the execution zone that owns it:

1. Inspect the user-facing job state and proxy events before changing pipeline code.
2. Check worker orchestration in `storyrpg-prototype/src/ai-agents/pipeline/FullStoryPipeline.ts`.
3. Check the relevant agents in `storyrpg-prototype/src/ai-agents/agents/` and validators in `storyrpg-prototype/src/ai-agents/validators/`.
4. Use docs only as targeted references: `docs/TDD.md`, `docs/STORY_PIPELINE_PROMPTING.md`, `docs/STORY_AGENT_SYSTEM_DETAIL.md`, and `docs/PARALLEL_GENERATION.md`.

## Guardrails

- Preserve the three-zone architecture: client UI, Express proxy, worker pipeline.
- Do not bypass the proxy for API calls that belong behind the proxy.
- Avoid touching generated story artifacts unless the task is explicitly about an artifact.
- Keep retry or checkpoint changes narrow; generation jobs can run for a long time.
- Treat validators as contracts between generation and playback, not just lint rules.

## Common Checks

- Pipeline orchestration: `FullStoryPipeline.ts`, worker payload types, and job timeline hooks.
- Memory/context health: run `npm run memory:doctor`; Cognee remains advisory.
- Episode recovery: inspect checkpoint artifacts, then use `npm run invalidate:episode` when the
  owning episode should be regenerated.
- Plan-time gates in multi-episode runs are shadow-only (validate + ledger record, never throw); only single-episode `generate()` enforces them. Check `gate-shadow-ledger.jsonl` before assuming a gate is broken.
- Job state: proxy job routes, `.generation-jobs.json`, worker stdout events, and cancellation handling.
- Retry loops: validator failures feeding the Karpathy retry loop, especially season planning and scene validation.
- Output shape: canonical types in `storyrpg-prototype/src/types/` before adding compatibility shims.

## Verification

From `storyrpg-prototype/`, prefer focused checks:

```bash
npm run typecheck
npm test -- FullStoryPipeline
npm test -- validators
```

Run `npm run validate` only when changes cross subsystem boundaries.
