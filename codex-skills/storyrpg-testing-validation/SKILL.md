---
name: storyrpg-testing-validation
description: Use this skill when deciding how to test or validate StoryRPG changes, choosing focused Vitest, TypeScript, asset, worker, proxy, or Playwright checks, or preparing final verification notes for code changes.
---

# StoryRPG Testing Validation

## Workflow

Run the smallest check that proves the changed behavior:

1. Identify the subsystem touched: engine, validators, image pipeline, proxy/worker, reader UI, stores, or generated assets.
2. Run focused Vitest files or name filters before broad suites.
3. Run TypeScript configs when shared types, worker payloads, or app imports changed.
4. Use Playwright only for user flows or visual reader/generator behavior.

## Command Map

Run commands from `storyrpg-prototype/`.

```bash
npm test
npm run typecheck
npm run validate
npm run validate:assets
npm run test:e2e
npm run test:e2e:story
```

Use `npm run validate` for broad confidence after cross-cutting changes. For narrow changes, prefer `npm test -- <name>` plus `npm run typecheck`.

## Subsystem Defaults

- Engine/playback: `npm test -- storyEngine`, `conditionEvaluator`, `resolutionEngine`, `identityEngine`, or `rewindEngine`.
- Validators: run the specific validator test plus `npm run typecheck`.
- Image pipeline: `npm test -- imageGenerationService`, `stable-diffusion`, provider registry, or LoRA tests.
- Proxy/worker: typecheck plus targeted store/service tests; live proxy only when route behavior matters.
- Reader UI: focused component/engine tests, then browser or Playwright for visible flows.
- Assets: `npm run validate:assets` only when generated story asset URLs or files changed.

## Guardrails

- Do not update snapshots, generated stories, or generated images just to make tests pass unless the task explicitly requires it.
- Mention unrun tests and why in the final response.
- Prefer deterministic unit coverage for pipeline contracts; reserve full generation runs for tasks that require real provider behavior.
