# Reader / Generator Split

**Last updated:** May 25, 2026

StoryRPG now has two app targets in one package:

- Reader: public end-user app for story library, playback, and reader settings.
- Generator: internal/local app for story generation, jobs, provider controls, and pipeline work.

This split is the deployment safety boundary. Reader can ship publicly.
Generator is a creator/operator tool and can touch secrets, providers, worker
jobs, local files, source uploads, image/video queues, and generated artifacts.

## Entry Points

The target is selected by `STORYRPG_APP_TARGET`.

| Target | Entry file | Expo identity | Notes |
|---|---|---|---|
| `reader` | `apps/reader/ReaderApp.tsx` | `StoryRPG Reader` / `storyrpg-reader` | Default target; used by `npm run web` and Vercel export |
| `generator` | `apps/generator/GeneratorApp.tsx` | `StoryRPG Generator` / `storyrpg-generator` | Internal target; used by generator dev/export scripts |

`metro.config.js` resolves `@storyrpg/app-entry` to one of those files.
`app.config.js` sets Expo name/slug from the same target.

`App.tsx` remains in the repo as a legacy/monolithic shell. Do not treat it as
the public deployment boundary.

## Reader Responsibilities

Reader owns:

- story catalog display
- story package fetching and validation
- built-in story playback
- generated story playback
- episode selection
- pause/settings UI for readers
- player progress, identity, encounter, and settings persistence
- media URL resolution through `storyLibrary` and `assetResolver`
- reader-safe analytics events

Reader may import:

- `src/screens/HomeScreen.tsx`
- `src/screens/EpisodeSelectScreen.tsx`
- `src/screens/ReadingScreen.tsx`
- `src/screens/reader/ReaderSettingsScreen.tsx`
- `src/stores/gameStore.ts`
- `src/stores/settingsStore.ts`
- `src/hooks/useStoryLibrary.ts`
- `src/services/storyLibrary.ts`
- `src/story-codec/*`
- `src/assets/*`
- built-in stories under `src/data/stories/`

Reader must not import:

- `src/ai-agents/`
- `src/screens/GeneratorScreen.tsx`
- generator step components
- generation/image/video job stores
- season plan storage
- provider settings panels
- worker lifecycle clients
- Stable Diffusion, LoRA, Anthropic, OpenAI, Gemini, Atlas, or MidAPI secrets

## Generator Responsibilities

Generator owns:

- source prompt/document ingestion
- generation settings
- provider/model selection
- saved generator credentials and provider settings
- style setup and preapproved style-bible anchors
- worker job creation, polling, cancellation, and continuation
- image-only and video-only continuation runs
- season plan continuation
- story visualizer access
- internal story/media management

Generator can import the pipeline client, AI agent configuration, job stores,
image/video stores, and provider-specific controls.

## Local Commands

Run from `storyrpg-prototype/`.

```bash
npm run reader:web
npm run reader:typecheck
npm run reader:export

npm run generator:web
npm run generator:typecheck
```

The generator export is intentionally named `generator:export:internal` and is not used by Vercel.

For quick local reader development, `npm run web` is an alias for the reader
target:

```bash
npm run web
```

For a combined local loop:

```bash
npm run dev
```

This starts the proxy and reader web target. Start `npm run generator:web` in a
separate terminal when you need the generator UI.

## Vercel

Vercel deploys Reader only:

```bash
npm run reader:export
```

Output directory:

```bash
dist-reader
```

Vercel production env should include only reader-safe public config such as story/content manifest URLs, analytics, and public auth if enabled. Do not add LLM/image provider keys, Stable Diffusion/LoRA vars, worker flags, or generator proxy configuration to the Reader project.

Reader-safe examples:

- `EXPO_PUBLIC_BLOB_MANIFEST_URL`
- `EXPO_PUBLIC_ANALYTICS_ENABLED`
- `EXPO_PUBLIC_POSTHOG_KEY`
- `EXPO_PUBLIC_POSTHOG_HOST`
- `EXPO_PUBLIC_READER_APP_URL`
- `EXPO_PUBLIC_GENERATOR_APP_URL`
- `EXPO_PUBLIC_ENABLE_INTERNAL_APP_LINKS`
- `EXPO_PUBLIC_LOG_LEVEL`

Generator/proxy-only examples:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `EXPO_PUBLIC_GEMINI_API_KEY` in the current local generator compatibility path
- `ATLAS_CLOUD_API_KEY`
- `MIDAPI_TOKEN`
- `ELEVENLABS_API_KEY`
- `STABLE_DIFFUSION_BASE_URL`
- `STABLE_DIFFUSION_API_KEY`
- `LORA_TRAINER_BASE_URL`
- `LORA_TRAINER_API_KEY`
- `DATABASE_URL`
- `SESSION_SECRET`
- `BLOB_READ_WRITE_TOKEN`
- `GCS_BUCKET_NAME`

## Content

Reader-visible generated content can be exported with:

```bash
npm run content:reader:export
```

This copies story packages and reader media into `public/reader-content/` and writes `public/reader-content/manifest.json`. It skips checkpoints, prompts, job state, LoRA artifacts, source uploads, and diagnostics.

The reader content export can also be written into the web export output:

```bash
npm run reader:export:with-content
```

That command runs `reader:export` and then writes content into
`dist-reader/reader-content`.

Reader can also load public story packages through a Blob manifest when
`EXPO_PUBLIC_BLOB_MANIFEST_URL` points at a manifest shaped like:

```json
{
  "stories": [
    {
      "id": "story-id",
      "title": "Story Title",
      "genre": "Genre",
      "synopsis": "Short synopsis",
      "blobUrl": "https://..."
    }
  ]
}
```

## Boundary Check

Reader validation includes:

```bash
npm run check:reader-boundary
```

The check fails if the Reader app reaches generator-only modules such as `src/ai-agents`, `GeneratorScreen`, generation job stores, image/video job stores, season plan storage, or generator provider config.

The reader validation command combines this boundary check with reader
typechecking and focused playback tests:

```bash
npm run validate:reader
```

Treat any boundary-check failure as a deployment blocker, even if the reader
still appears to run locally.
