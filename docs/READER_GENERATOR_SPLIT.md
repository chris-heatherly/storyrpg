# Reader / Generator Split

StoryRPG now has two app targets in one package:

- Reader: public end-user app for story library, playback, and reader settings.
- Generator: internal/local app for story generation, jobs, provider controls, and pipeline work.

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

## Content

Reader-visible generated content can be exported with:

```bash
npm run content:reader:export
```

This copies story packages and reader media into `public/reader-content/` and writes `public/reader-content/manifest.json`. It skips checkpoints, prompts, job state, LoRA artifacts, source uploads, and diagnostics.

## Boundary Check

Reader validation includes:

```bash
npm run check:reader-boundary
```

The check fails if the Reader app reaches generator-only modules such as `src/ai-agents`, `GeneratorScreen`, generation job stores, image/video job stores, season plan storage, or generator provider config.
