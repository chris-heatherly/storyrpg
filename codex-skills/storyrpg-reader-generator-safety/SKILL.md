---
name: storyrpg-reader-generator-safety
description: Use this skill for any change touching the StoryRPG reader app, the reader/generator boundary, the two web targets (STORYRPG_APP_TARGET), provider API keys or secrets, the public bundle, or deployment. Ensures the public reader never bundles generator code or leaks provider keys.
---

# StoryRPG Reader / Generator Safety

This is the project's #1 non-negotiable. One package ships two web targets selected by
`STORYRPG_APP_TARGET`: **reader** (`apps/reader/ReaderApp.tsx`, port 8081, public) and
**generator** (`apps/generator/GeneratorApp.tsx`, port 8082, internal). Only the reader is
deployed publicly. `metro.config.js` maps `@storyrpg/app-entry` to the target.

## Workflow

1. Identify whether the change can reach the reader import graph.
2. Before shipping, run `npm run check:reader-boundary` and `npm run verify:reader` from `storyrpg-prototype/`.
3. For new secrets, confirm they are `process.env.X` server-side, not `EXPO_PUBLIC_X`.

## Guardrails

- The reader must NOT import generator code: `src/ai-agents/**`, `GeneratorScreen`, `src/screens/generator/**`, the generation stores (`generationJobStore`, `imageJobStore`, `videoJobStore`, `seasonPlanStore`), `useGeneratorRunner`, generator LLM config. Enforced by `scripts/check-reader-boundary.mjs`.
- The reader must NOT carry provider API keys. `EXPO_PUBLIC_*` vars are inlined into the bundle. Provider keys (`AIza…`, `sk-…`, `sk-ant-…`) live server-side (proxy) only. PostHog publishable `phc_`/`phx_` keys are the one client-safe exception.
- Do not relax the boundary script to make a change pass — fix the import.
- Dynamic/aliased imports escape the static walk; trust `verify:reader` (bundle scan) when unsure.

## Common Checks

- Transitive reachability of forbidden modules from a new reader import.
- Bundle secret scan: `verify:reader` builds `dist-reader` and scans for secret VALUES + key shapes.
- New provider key/secret placement (`.env.example`, denylist) and proxy auth-gating (`PROXY_REQUIRE_AUTH`).

## Verification

From `storyrpg-prototype/`:

```bash
npm run check:reader-boundary
npm run verify:reader
npm run reader:typecheck
```

Both boundary checks run in CI. See `docs/READER_GENERATOR_SPLIT.md` and `docs/PROJECT_AUDIT_2026-05-28.md`.
