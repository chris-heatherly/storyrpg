---
name: storyrpg-testing-validation
description: Use this skill when deciding how to test or validate StoryRPG changes, choosing focused Vitest, TypeScript, reader/generator boundary, asset, worker, proxy, database, or Playwright checks, or preparing final verification notes for code changes.
---

# StoryRPG Testing Validation

## Workflow

Run `npm run audit:skills` after changing pipeline contracts, commands, auth/media/package behavior,
or any Claude, Cursor, or Codex skill. `skills-manifest.json` defines cross-model capability parity.
Run `npm run sync:skills` to update every harness target and `npm run sync:skills:check` to detect
installed-target drift without writing.

Run the smallest check that proves the changed behavior:

1. Identify the subsystem touched: engine, validators, image pipeline, proxy/worker, reader UI, stores, or generated assets.
2. Run focused Vitest files or name filters before broad suites.
3. Run target-specific TypeScript configs when reader/generator imports, worker payloads, or shared types changed.
4. Run boundary, proxy health, DB, or asset checks when the changed subsystem crosses those contracts.
5. Use Playwright only for user flows or visual reader/generator behavior.

## Command Map

Run commands from `storyrpg-prototype/`.

```bash
npm test
npm run typecheck
npm run reader:typecheck
npm run generator:typecheck
npm run validate
npm run validate:reader
npm run check:reader-boundary
npm run verify:reader
npm run check:monolith-size
npm run validate:assets
npm run proxy:health
npm run db:migrate
npm run db:verify
npm run test:e2e
npm run test:e2e:story
```

Use `npm run validate` for broad confidence after cross-cutting changes. For narrow changes, prefer `npm test -- <name>` plus `npm run typecheck`.

## Subsystem Defaults

- Engine/playback: `npm test -- storyEngine`, `conditionEvaluator`, `resolutionEngine`, `identityEngine`, or `rewindEngine`.
- Validators: run the specific validator test plus `npm run typecheck`.
- Image pipeline: `npm test -- imageGenerationService`, `stable-diffusion`, provider registry, or LoRA tests.
- Proxy/worker: typecheck plus targeted store/service tests; `npm run proxy:health` when a proxy is running; DB scripts for account/storage changes.
- Reader UI: `npm run validate:reader`, focused component/engine tests, then browser or Playwright for visible flows.
- Generator UI: `npm run generator:typecheck` plus focused store/hook tests.
- Assets: `npm run validate:assets` only when generated story asset URLs or files changed.
- Deployment boundary: `npm run check:reader-boundary` after any reader/generator import, env, or Vercel export change.

## Guardrails

- Do not update snapshots, generated stories, or generated images just to make tests pass unless the task explicitly requires it.
- Mention unrun tests and why in the final response.
- Prefer deterministic unit coverage for pipeline contracts; reserve full generation runs for tasks that require real provider behavior.
