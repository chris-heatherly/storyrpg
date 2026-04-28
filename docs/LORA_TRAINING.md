# LoRA Auto-Training Subsystem

**Last Updated:** April 2026

This document describes the auto-train-LoRA subsystem that ships inside
StoryRPG's image pipeline. The subsystem is Stable-Diffusion-only; for
every other image provider it is a hard no-op.

See also: `docs/IMAGE_PIPELINE_RUNTIME.md` (runtime flow) and
`docs/TDD.md` (architecture).

## Goals

- Improve character identity and style consistency on Stable Diffusion
  backends without forcing the operator to hand-train LoRAs.
- Stay transparent on other providers: flipping the switches should
  never affect nano-banana, Midjourney, or Atlas output.
- Be idempotent. Training jobs are fingerprinted; unchanged inputs
  never re-train.
- Be optional. The whole subsystem is off by default.

## Components

```
LoraTrainingAgent ──┬──► datasetBuilder ──► LoraTrainerAdapter ──► /lora-training/* proxy
                    │                                                    │
                    │                                                    ▼
                    │                                            kohya_ss sidecar
                    │
                    └──► LoraRegistry ──► mergeIntoStableDiffusionSettings
                                              │
                                              ▼
                                    StableDiffusionSettings.{styleLoras, characterLoraByName}
                                              │
                                              ▼
                                     buildSDPrompt → `<lora:name:weight>` tag
```

| File | Role |
|---|---|
| `src/ai-agents/agents/image-team/LoraTrainingAgent.ts` | Orchestrates eligibility, dataset assembly, dispatch, caching |
| `src/ai-agents/images/datasetBuilder.ts` | Turns reference sheets + style-bible anchors into captioned training sets |
| `src/ai-agents/images/loraRegistry.ts` | Fingerprint-keyed cache under `generated-stories/<storyId>/loras/registry.json` |
| `src/ai-agents/services/lora-training/LoraTrainerAdapter.ts` | Interface + shared types |
| `src/ai-agents/services/lora-training/KohyaAdapter.ts` | `kohya_ss` implementation |
| `src/ai-agents/services/lora-training/factory.ts` | Backend selection (kohya today, stubs for diffusers / replicate) |
| `src/ai-agents/images/providerCapabilities.ts` | `supportsLoraTraining` capability gate |
| `proxy/loraTrainingRoutes.js` | Express proxy mount for `/lora-training/*` |

## When does training run?

`FullStoryPipeline.runEpisodeImageGeneration` calls
`runLoraTrainingIfEligible` once per episode, right after the character
reference sheets are generated AND the style bible is produced. These
are the earliest points at which both dataset halves exist.

Before dispatch the pipeline:

1. Calls `providerSupportsLoraTraining(imageProvider)` — if the provider
   can't consume a LoRA, the entire call returns immediately.
2. Calls `LoraTrainingAgent.shouldRun()` — respects the master
   `enabled`/`backend` flags.
3. Calls `agent.invalidateStaleLoras(characters, style)` — prunes
   cached artifacts whose source fingerprint no longer matches
   (identity drift or style-bible edits).
4. Calls `agent.trainAll(characters, style)` — cache hits resolve
   synchronously from `LoraRegistry`; everything else dispatches
   through the adapter.
5. Merges the updated registry into `StableDiffusionSettings` so
   `buildSDPrompt` picks the new tags up on the next render.

When `characterThresholds.blockScenes=true` (default) the pipeline
waits for in-flight character-LoRA jobs before the scene loop starts,
so the LoRA is active from beat #1. Disable this flag for a
faster-but-less-consistent pass that lets scenes render in parallel
with training.

## Eligibility

Character candidate (from `LoraTrainingAgent.evaluateCharacterEligibility`):

- Character tier is in `characterThresholds.tiers` (default
  `['core','major','supporting']`).
- `character.references.length >= characterThresholds.minRefs`
  (default 6).
- `character.identityFingerprint` is defined.

Style candidate (from `evaluateStyleEligibility`):

- `ArtStyleProfile` is defined.
- Either `styleThresholds.forceStyle=true`, OR the series is at least
  `styleThresholds.minEpisodes` long (default 2).
- At least one style-bible anchor file has been saved to disk.

## Fingerprinting

All caching is keyed by SHA-1 fingerprints produced by pure helpers in
`loraRegistry.ts`:

- `computeCharacterLoraFingerprint({ characterId, name,
  identityFingerprint, hyperparameters })`
- `computeStyleLoraFingerprint({ profile, anchorHashes,
  hyperparameters })`

`normalizeHyperparams` strips `undefined` values and sorts keys so
equivalent configs produce identical fingerprints. This means you can
tweak default hyperparameters in the UI without invalidating every
cached LoRA in the registry.

When a fingerprint no longer matches any current character/style,
`invalidateStaleLoras` removes the record and emits a `skip` event
with reason `invalidated: fingerprint <hash> no longer valid`.

## LoraRegistry layout

```
generated-stories/<storyId>/loras/
├── registry.json                       # manifest (LoraRegistrySnapshot)
├── <characterSlug>_<fpShort>.safetensors
└── style_<fpShort>.safetensors
```

`registry.json` records, per artifact: kind (`character` | `style`),
display name, trigger token, fingerprint, absolute path, preferred
weight, and ISO timestamp. `LoraRegistryIO` is pluggable —
`createNodeLoraRegistryIO` backs it with `fs/promises`; environments
without a real FS fall back to an in-memory read-only registry.

## Kohya Sidecar Contract

The `/lora-training/*` proxy mount forwards verbatim to the URL in
`LORA_TRAINER_BASE_URL`. We currently target the `kohya_ss` HTTP
sidecar, but any service that implements the following contract works.

### Authentication

Per-request tokens can be supplied via the `x-lora-trainer-token`
header so the UI can override the env default. If no token is supplied
and `LORA_TRAINER_API_KEY` is set, the proxy attaches it as either
`Authorization: Bearer <token>` or the header named by
`LORA_TRAINER_AUTH_HEADER`.

### Endpoints

#### `GET /preflight`

Liveness + model discovery. Used by the Generator UI readiness
indicator. Should return 200 with a JSON body when healthy.

Response (recommended):

```json
{
  "ok": true,
  "backend": "kohya_ss",
  "version": "22.6.1",
  "installedBaseModels": ["sdxl-base-1.0", "sd15"],
  "gpuMemoryMb": 24576
}
```

The proxy returns 503 if `LORA_TRAINER_BASE_URL` is not configured.

#### `POST /lora-training/jobs`

Submit a training job. Request body is a `LoraTrainingRequest`:

```jsonc
{
  "kind": "character" | "style",
  "name": "kaia",
  "triggerToken": "sks_kaia",
  "baseModel": "sdxl-base-1.0",
  "hyperparameters": {
    "steps": 1500, "rank": 32, "networkAlpha": 32, "learningRate": 1e-4,
    "batchSize": 2, "resolution": 1024, "repeats": 10,
    "optimizer": "adamw8bit", "scheduler": "cosine",
    "mixedPrecision": "bf16", "seed": 1234
  },
  "images": [
    { "imagePath": "/abs/path/refs/kaia_front.png", "caption": "sks_kaia, front view, neutral expression" },
    { "imagePath": "/abs/path/refs/kaia_three_quarter.png", "caption": "sks_kaia, three-quarter view" }
  ]
}
```

Response:

```json
{ "jobId": "abc-123", "status": "queued" }
```

#### `GET /lora-training/jobs/:jobId`

Poll status. Response:

```json
{
  "jobId": "abc-123",
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled",
  "progress": 0.42,
  "etaSeconds": 180,
  "error": "optional failure message",
  "artifact": {
    "filename": "kaia_f2a3b4.safetensors",
    "sha256": "0xabc…",
    "sizeBytes": 145_000_000
  }
}
```

`artifact` is only required once `status === "succeeded"`. The pipeline
uses that filename to request the binary download below.

#### `POST /lora-training/jobs/:jobId/cancel`

Optional. Used to cancel in-flight jobs when the pipeline aborts.
Should return a `LoraJobStatus` with `status: "cancelled"`.

#### `GET /lora-training/jobs/:jobId/artifact`

Stream the safetensors file. Must set a non-JSON `Content-Type`
(`application/octet-stream` or similar). The proxy's extended
`DEFAULT_ARTIFACT_TIMEOUT_MS` (15 minutes) applies.

#### `POST /lora-training/loras/:name/install`

Copy the rendered artifact into the SD host's `models/Lora/` directory.
Request body:

```jsonc
{ "jobId": "abc-123", "overwrite": false }
```

Response:

```json
{ "ok": true, "installedPath": "/sd/models/Lora/kaia_f2a3b4.safetensors" }
```

Implementations that run on the same machine as the SD host typically
hard-link or copy the file. Implementations running on a separate box
must upload the safetensors to the SD host themselves.

### Failure modes

The `KohyaAdapter` retries each poll on transient HTTP errors up to
the adapter's poll budget. Any non-retryable failure ends with
`LoraJobStatus.status === "failed"` and bubbles through
`LoraTrainingAgent.trainCharacter` / `trainStyle` as a
`LoraTrainingOutcome.kind === "error"`. The pipeline emits a warning
event but never aborts image generation on a LoRA training failure.

## Environment variables

See `docs/INSTALL.md` section 10 for the full reference. The
LoRA-specific vars:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_LORA_AUTO_TRAIN` | Default-on the master switch in the Generator UI |
| `LORA_AUTO_TRAIN` | Same, but for worker/CLI entry points |
| `LORA_TRAINER_BACKEND` / `EXPO_PUBLIC_LORA_TRAINER_BACKEND` | `disabled` \| `kohya` \| `diffusers` \| `replicate` |
| `LORA_TRAINER_BASE_URL` / `EXPO_PUBLIC_LORA_TRAINER_BASE_URL` | Base URL of the trainer sidecar |
| `LORA_TRAINER_API_KEY` | Bearer token for the trainer sidecar |
| `LORA_TRAINER_AUTH_HEADER` | Header name to use instead of `Authorization` |
| `LORA_TRAINER_TIMEOUT_MS` | Override the default 10-minute timeout |

## UI surface

The Generator screen exposes the subsystem inside the existing Stable
Diffusion disclosure (only visible when `EXPO_PUBLIC_SD_ENABLED=true`
and the selected image provider is Stable Diffusion):

- Master `ENABLE AUTO-TRAIN` switch.
- Backend segmented control.
- Trainer base URL / API key overrides.
- Character eligibility: `MIN REFS`, tier chips (`core`, `major`,
  `supporting`, `minor`), and the `BLOCK SCENES UNTIL TRAINED` toggle.
- Style eligibility: `MIN EPISODES` + `FORCE STYLE LORA` toggle.
- Hyperparameters: steps, rank, learning rate, resolution, batch size,
  repeats, optional base model.
- Reset-to-defaults button.

State is managed by
`useGeneratorSettings.handleLoraTrainingSettingsChange`, persisted to
both AsyncStorage and the proxy `generatorSettings.json` disk cache.

## Running locally

1. Stand up a `kohya_ss` sidecar that implements the contract above
   (see https://github.com/bmaltais/kohya_ss for the upstream project).
2. Set `LORA_TRAINER_BASE_URL=http://localhost:7861` in
   `storyrpg-prototype/.env`.
3. Either set `EXPO_PUBLIC_LORA_AUTO_TRAIN=true` before starting the
   app, or enable the toggle at runtime inside the Generator's Stable
   Diffusion panel.
4. Generate a story with `imageProvider=stable-diffusion`. The first
   episode will produce character and (optionally) style LoRAs under
   `generated-stories/<storyId>/loras/`; subsequent episodes reuse
   the cached artifacts.
