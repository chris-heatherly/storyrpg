---
name: storyrpg-reader-deployment-boundary
description: Use this skill when working on StoryRPG Reader/Generator separation, STORYRPG_APP_TARGET, public exports, provider secret leakage, reader-safe content export, Vercel configuration, or reader-boundary failures.
---

# StoryRPG Reader Deployment Boundary

## Workflow

1. Treat `apps/reader/ReaderApp.tsx` as public and `apps/generator/GeneratorApp.tsx` as internal; the removed monolithic entry is not a deployment surface.
2. Inspect `scripts/check-reader-boundary.mjs`, `metro.config.js`, `app.config.js`, and `vercel.json` before changing imports or environment exposure.
3. Keep generator agents, stores, provider settings, server-only services, and provider secrets out of the Reader graph.
4. Use `npm run content:reader:export` or `npm run reader:export:with-content` for public content; preserve the export exclusions.
5. Use `npm run verify:reader` when aliases, dynamic imports, environment variables, or bundling could evade the static import walk.

## Verification

```bash
npm run reader:typecheck
npm run check:reader-boundary
npm run validate:reader
npm run verify:reader
```
