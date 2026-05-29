---
name: reader-generator-safety
description: Use this skill for any change that touches the StoryRPG reader app, the reader/generator boundary, the two web targets (STORYRPG_APP_TARGET), provider API keys / secrets, the public bundle, or deployment. Ensures the public reader never bundles generator code or leaks provider keys.
---

# Reader / Generator Safety

StoryRPG ships **two web targets from one package**, selected by the
`STORYRPG_APP_TARGET` env var:

- **reader** (`apps/reader/ReaderApp.tsx`, port 8081, `npm run reader:web`) —
  the **public** player app. Story library, playback, reader settings, player
  state, analytics.
- **generator** (`apps/generator/GeneratorApp.tsx`, port 8082,
  `npm run generator:web`) — the **internal** creation app. Source ingestion,
  generation, media jobs, provider credentials, visualizer.

`metro.config.js` maps `@storyrpg/app-entry` to the target. The reader is the
only thing deployed publicly (Vercel).

## The two hard rules

1. **The reader must not import generator code.** Forbidden in the reader
   import graph: `src/ai-agents/**`, `GeneratorScreen`, `src/screens/generator/**`,
   generation/image/video/season stores, `useGeneratorRunner`, generator LLM
   config.
2. **The reader must not carry provider API keys.** Expo inlines every
   `EXPO_PUBLIC_*` var into the client bundle, so a provider key behind that
   prefix is world-readable. Provider keys live server-side (the proxy) only.
   PostHog publishable keys (`phc_…`) are the one client-safe exception.

## How to verify a reader-affecting change

```bash
npm run check:reader-boundary   # fast: walks the reader import graph for forbidden modules
npm run verify:reader           # full: builds dist-reader, scans the BUNDLE for secret
                                #       VALUES + provider-key shapes (AIza…, sk-…, sk-ant-…)
```

Both run in CI. `verify:reader` is the strong gate — it scans the actually-built
bundle, not just import paths, so it catches a key that gets inlined regardless
of the variable name. Run it before shipping any reader change that could pull
in config/secret code. The boundary script lives at
`scripts/check-reader-boundary.mjs`.

## Guardrails

- Adding an import to the reader? Check it doesn't transitively reach a
  forbidden module. Dynamic/aliased imports can escape the static walk — prefer
  `verify:reader` (bundle scan) when unsure.
- Adding a new provider key/secret? It is `process.env.X` (server/proxy), never
  `EXPO_PUBLIC_X`. Update `.env.example` and the boundary denylist if relevant.
- Don't relax the boundary script to make a change pass — fix the import instead.

See also: `docs/PROJECT_STATUS.md` (Application Split), `docs/PROJECT_AUDIT_2026-05-28.md` (L3).
