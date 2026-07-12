---
name: storyrpg-story-packaging-assets
description: Use this skill when working on StoryRPG story.json, manifest.json, story-codec, AssetRef, assetResolver, assetStore, catalog loading, package migration, reader-safe exports, GCS or Blob uploads, or validate:assets failures.
---

# StoryRPG Story Packaging Assets

## Workflow

1. Read `docs/CURRENT_PIPELINE_STATUS.md` and inspect `src/story-codec/`, `src/ai-agents/codec/`, `src/assets/`, and `src/services/storyLibrary.ts`.
2. Treat `story.json` as the primary versioned package and `manifest.json` as the declaration of `primaryStoryFile` and checksum.
3. Keep `pipelineOutputWriter`, `SavingPhase`, worker completion, proxy catalog reads, and client `/stories/:id` loading aligned.
4. Resolve modern media through `AssetRef` and `assetResolver`; support legacy string paths only through codec migrations.
5. Produce reader-safe content with `npm run content:reader:export` or `npm run reader:export:with-content`; omit prompts, checkpoints, job state, LoRA artifacts, uploads, and diagnostics.

## Guardrails

- Do not make transient worker result blobs the runtime source of truth.
- Do not add catalog fallback reads for legacy-only directories; migrate them.
- Keep filesystem, GCS, Blob, and public-reader paths explicit.

## Verification

```bash
npm test -- storyCodec
npm test -- storyLibrary
npm run validate:assets
npm run check:reader-boundary
```
