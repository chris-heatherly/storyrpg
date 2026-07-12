---
name: pipeline-orchestration
description: Use this skill when changing StoryRPG FullStoryPipeline phases, authored-lite ESC flow, NarrativeRealizationTask ownership, checkpoints, concurrency, Cognee context, worker events, or final story package output.
---

# Pipeline Orchestration

Read `docs/CURRENT_PIPELINE_STATUS.md` first. `FullStoryPipeline` and its typed modules under
`src/ai-agents/pipeline/phases/` are the only active story path.

## Load-bearing contracts

- For `authored_lite`, preserve **Parse+ESC -> Facts -> Realize -> Enforce -> Media**. The Episode
  Spine Contract (ESC) alone owns scene order/topology; later agents fill, realize, or enforce.
- Preserve every `NarrativeRealizationTask` owner stage, evidence target, route scope, severity,
  repair handler, and fingerprint. Enforce it at the owning SceneWriter/ChoiceAuthor/
  EncounterArchitect stage before checkpointing; `NarrativeContractValidator` is the late net.
- Keep Cognee advisory. Typed current-run artifacts and canonical contracts stay authoritative.
- Complete story text and failure gates before image/video/audio phases.
- Keep package output centered on `story.json` plus `manifest.json` and resolve modern media through
  `AssetRef`.

Preserve phase events, checkpoint keys, artifact ids, cancellation, prompt snapshots, and run-event
goldens. Route structural failures back to architecture/ESC refresh; final-contract repair must not
invent structure.

Verify with focused phase/prompt tests, `npm run typecheck`, and `npm run audit:skills`.
