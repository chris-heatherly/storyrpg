---
name: storyrpg-pipeline-orchestration
description: Use this skill when changing StoryRPG FullStoryPipeline phases, authored-lite treatment flow, Episode Spine Contract ownership, NarrativeRealizationTask routing, checkpoints, concurrency, Cognee context, or final story package output.
---

# StoryRPG Pipeline Orchestration

## Workflow

1. Read `docs/CURRENT_PIPELINE_STATUS.md` before older architecture documents.
2. Treat `FullStoryPipeline` plus `src/ai-agents/pipeline/phases/` as the only active story path; `EpisodePipeline` and `ParallelStoryPipeline` are removed.
3. For `authored_lite`, preserve **Parse+ESC -> Facts -> Realize -> Enforce -> Media**. The Episode Spine Contract (ESC) is the sole structural author; downstream agents must not reorder scenes or invent topology.
4. Preserve each `NarrativeRealizationTask` owner stage, discriminated evidence target, route scope, severity, repair handler, and owner-stage fingerprint. Validate at `SceneWriter`, `ChoiceAuthor`, or `EncounterArchitect` before checkpointing, then use `NarrativeContractValidator` as the late regression net.
5. Keep Cognee advisory. Typed current-run artifacts and canonical contracts remain authoritative.
6. Preserve event names, checkpoint keys, artifact ids, cancellation checks, and dependency ordering when extracting or moving a phase.
7. Keep final output centered on `story.json` plus `manifest.json`; use `AssetRef` and codec migrations for modern/legacy media compatibility.

## Guardrails

- Run story authoring and text-contract gates before images, video, or audio.
- Route structural failures back to architecture or ESC refresh; final-contract repair may change prose and fields, not invent structure.
- Prefer typed phase/helper extraction over growing `FullStoryPipeline.ts`.
- Preserve prompt snapshots and run-event goldens when orchestration changes.

## Verification

From `storyrpg-prototype/`, run focused phase or prompt-snapshot tests, then:

```bash
npm run typecheck
npm test -- FullStoryPipeline
npm run audit:skills
```
