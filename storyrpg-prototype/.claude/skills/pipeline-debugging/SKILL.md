---
name: pipeline-debugging
description: Use this skill when debugging StoryRPG story generation — failed or zero-output runs, stuck/cancelled worker jobs, FullStoryPipeline behavior, validator aborts, retry loops, truncated LLM output, or checking generation quality/success over time.
---

# Pipeline Debugging

Read `docs/CURRENT_PIPELINE_STATUS.md` before older architecture/status documents. For authored-lite
runs, distinguish ESC/architecture ownership failures from `NarrativeRealizationTask` owner-stage
evidence failures; do not repair either by weakening the final gate.

Story generation runs in the **proxy-spawned worker** (`src/ai-agents/server/worker-runner.ts`),
which drives `src/ai-agents/pipeline/FullStoryPipeline.ts` and streams events
back to the UI via the proxy (`proxy/workerLifecycle.js`).

## Start from artifacts, not the monolith

`FullStoryPipeline.ts` is large and typed; active phase bodies live in `pipeline/phases/`, and the
non-phase helper clusters in `pipeline/imageSupport.ts` / `pipelineMemory.ts` /
`runLedger.ts` / `treatmentRefresh.ts`. **Do not read it
top-to-bottom.** Start
from the failing run's artifacts, then jump to the owning code:

- `generated-stories/<run>/99-pipeline-errors.json` — per-run failure log
  (phase, message, episodeNumber). First stop for "run failed."
- `generated-stories/quality-ledger.jsonl` — one row per run across all runs
  (`outcome`, `overallScore`, `band`, `errorCount`). First stop for "are runs
  succeeding / is quality trending?" 25/38 zero-output runs is what this exists
  to surface.
- `.worker-jobs.json`, `.worker-checkpoints.json`, `.worker-dead-letter.json` —
  worker job state (gitignored runtime files).

Navigate the pipeline by phase, not by scrolling: `pipeline/phases/`,
`planningHelpers.ts`, `choiceAssembly.ts`, `seasonStoryMerge.ts`,
`checkpointing.ts`, `events.ts`.

## Common failure modes

- **A plan-time gate (SetupPayoff/CallbackCoverage/ChoiceDensity/
  ConsequenceBudget) didn't block a season run** — by design: in the
  multi-episode path these gates run shadow-only (records in
  `gate-shadow-ledger.jsonl`, never throw). Their default-ON promotion predates
  the scope-bug fix that first made them reachable there; re-promote only after
  a fresh multi-episode shadow pass. Single-episode `generate()` enforces them.
- **"Story Architect failed: [TreatmentFidelity]/[DramaticStructure] …"** —
  these are now **advisory** (validator tiering, B1). After retries they should
  degrade to recorded warnings and the story still ships. If a run still aborts
  on one of these, check `StoryArchitect.classifyBlueprintFailure()` (a pure,
  tested classifier) — a HARD keyword (scene-graph ref, choice density,
  encounter, parse) on a non-advisory line is what blocks.
- **Truncated/incomplete output** — `BaseAgent` logs a `warn` and sets
  `wasLastResponseTruncated()` when truncation recovery drops content (raise
  `maxTokens`). Don't treat a truncated parse as success.
- **Stuck/orphaned jobs** — check `workerLifecycle.js` and the dead-letter file;
  the proxy normalizes stale jobs on startup.
- **Memory/context failures** — run `npm run memory:doctor`; Cognee is advisory and must not override
  typed current-run artifacts.
- **Bad episode checkpoint** — inspect checkpoint artifacts, then use `npm run invalidate:episode`
  when regeneration from the owning episode boundary is intended.

## Guardrails

- Preserve the three zones: client UI · Express proxy · worker pipeline. Don't
  bypass the proxy.
- Don't grow `FullStoryPipeline.ts` (CI monolith ratchet will fail) — extract
  into `pipeline/phases/` instead.
- Reproduce with a mocked/cheap run where possible; full generation costs API credits.

See also: `docs/CURRENT_PIPELINE_STATUS.md`, `docs/STORY_QUALITY_CONTRACT.md`,
`docs/PROJECT_AUDIT_2026-05-28.md`.
