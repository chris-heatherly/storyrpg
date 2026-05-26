# Reader / Generator Split

StoryRPG now has two app targets in one package:

- Reader: end-user app for story library, playback, and reader settings (sign-in required).
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

### Creator authentication

The generator app requires sign-in (email/password, Google, or Discord via the proxy) before the studio shell loads. The proxy needs `DATABASE_URL` and applied migrations (`npm run db:migrate`).

For local OAuth on port **8082**, set on the proxy:

```bash
AUTH_SUCCESS_REDIRECT=http://localhost:8082/?afterAuth=home
AUTH_FAILURE_REDIRECT=http://localhost:8082/?auth=error
```

Sign out is available under **System Info** in generator settings. The creator login screen does not offer a dev bypass; users must authenticate through the proxy.

### Reader authentication

The reader app uses the same proxy auth stack. Sign-in is required before the library loads. For local OAuth on port **8081**:

```bash
AUTH_SUCCESS_REDIRECT=http://localhost:8081/?afterAuth=home
AUTH_FAILURE_REDIRECT=http://localhost:8081/?auth=error
```

Sign out is under **Settings → System**. No dev bypass on the reader login screen.

If one proxy serves both apps locally, only one `AUTH_SUCCESS_REDIRECT` can be active at a time — use separate proxy processes or alternate the redirect when testing OAuth for each app.

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
