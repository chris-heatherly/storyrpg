---
name: reader-generator-safety
description: The StoryRPG reader/generator boundary — two web targets via STORYRPG_APP_TARGET, the forbidden-import rules that keep generator code out of the public reader, the provider-key/secret rules, and how to verify a reader-affecting change. Use for any change touching the reader app, the public bundle, provider keys/secrets, or deployment.
---

# Reader / Generator Safety

This is the project's #1 non-negotiable. StoryRPG ships **two web targets from one package**,
selected by the `STORYRPG_APP_TARGET` env var:

- **reader** (`apps/reader/ReaderApp.tsx`, port 8081, `npm run reader:web`) — the **public**
  player app. Story library, playback, reader settings, player state, analytics.
- **generator** (`apps/generator/GeneratorApp.tsx`, port 8082, `npm run generator:web`) — the
  **internal** creation app. Source ingestion, generation, media jobs, provider credentials, visualizer.

`metro.config.js` maps `@storyrpg/app-entry` to the active target. The reader is the only thing
deployed publicly (Vercel).

## The two hard rules

1. **The reader must not import generator code.** Forbidden in the reader import graph
   (enforced by `scripts/check-reader-boundary.mjs`): `src/ai-agents/**`, `GeneratorScreen`,
   `src/screens/generator/**`, the generation stores (`generationJobStore`, `imageJobStore`,
   `videoJobStore`, `seasonPlanStore`), `useGeneratorRunner`, and generator LLM config
   (`generatorLlmOptions`).
2. **The reader must not carry provider API keys.** Expo inlines every `EXPO_PUBLIC_*` var into
   the client bundle, so a provider key behind that prefix is world-readable. Provider keys live
   server-side (the proxy) only. PostHog publishable keys (`phc_…` / `phx_…`) are the one
   client-safe exception (see the `integration-expo`/analytics skill).

## How to verify a reader-affecting change

Use `npm run content:reader:export` or `npm run reader:export:with-content` for public story content;
preserve exclusions for prompts, checkpoints, job state, LoRA artifacts, uploads, and diagnostics.

```bash
npm run check:reader-boundary   # fast: walks the reader import graph for forbidden modules
npm run verify:reader           # full: builds the reader bundle, scans it for secret VALUES
                                #       + provider-key shapes (AIza…, sk-…, sk-ant-…)
npm run reader:typecheck        # tsconfig.reader.json — reader-only type errors (not in main typecheck)
```

`verify:reader` is the strong gate — it scans the actually-built bundle, not just import paths,
so it catches a key inlined under any variable name and a forbidden module reached via a
dynamic/aliased import the static walk missed. All of these run in CI. `npm run validate:reader`
bundles the typecheck + boundary + the core reader unit tests.

## Guardrails

- Adding an import to the reader? Check it doesn't transitively reach a forbidden module.
  Dynamic/aliased imports can escape the static walk — prefer `verify:reader` (bundle scan) when unsure.
- Adding a new provider key/secret? It is `process.env.X` (server/proxy), never `EXPO_PUBLIC_X`.
  Update `.env.example` and the boundary denylist if relevant.
- Don't relax the boundary script to make a change pass — fix the import instead.
- The proxy (see `proxy-server` skill) is where provider keys live; if exposed it must be
  auth-gated (`PROXY_REQUIRE_AUTH`). The reader never talks to a provider directly.

See also: `proxy-server`, `story-playback`, and `integration-expo` skills;
`docs/READER_GENERATOR_SPLIT.md`, `docs/PROJECT_AUDIT_2026-05-28.md`.
