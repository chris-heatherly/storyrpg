# StoryRPG Project Status

**Last updated:** May 25, 2026  
**Scope:** Current implementation status for the StoryRPG workspace. This file is the high-level operational map; the other docs remain the deeper design, pipeline, image, validation, and setup references.

## Executive Snapshot

StoryRPG is currently a local-first Expo/React Native application with two web app targets in one package:

- **Reader** is the public player-facing app. It owns the story library, episode selection, playback, reader settings, persisted player state, media URL resolution, and analytics events for play.
- **Generator** is the internal/local creation app. It owns source ingestion, story generation settings, provider credentials, generation job monitoring, style setup, image/video/audio continuation runs, visualizer access, and pipeline controls.

The older monolithic `App.tsx` route shell has been removed. The current bundler target split is driven by `STORYRPG_APP_TARGET` and the app entries under `storyrpg-prototype/apps/`.

The generation path is still centered on `FullStoryPipeline`. Parallelism now lives inside that pipeline and its helpers rather than in a separate `ParallelStoryPipeline`. `EpisodePipeline` and `ParallelStoryPipeline` have both been removed.

## Current Runtime Targets

| Target | Entry | Command | Port | Purpose |
|---|---|---:|---:|---|
| Reader web | `apps/reader/ReaderApp.tsx` | `npm run reader:web` or `npm run web` | 8081 | Public story library and playback |
| Generator web | `apps/generator/GeneratorApp.tsx` | `npm run generator:web` | 8082 | Internal generation, media, visualizer, settings |
| Proxy | `proxy-server.js` | `npm run proxy` | 3001 | API proxy, job lifecycle, generated content serving |
| Combined dev | Proxy + Reader web | `npm run dev` | 3001 + 8081 | Quick local reader-plus-proxy loop |

`metro.config.js` maps `@storyrpg/app-entry` to the correct target-specific app entry. `app.config.js` also changes the Expo app name and slug based on `STORYRPG_APP_TARGET`.

## Application Split

### Reader

The reader app imports only player-safe modules:

- `HomeScreen`, `EpisodeSelectScreen`, `ReadingScreen`, and `ReaderSettingsScreen`
- `GameProvider` / `gameStore` for player state
- `SettingsProvider` / `settingsStore` for reader preferences
- `useStoryLibrary` and `storyLibrary` services for catalog loading
- `story-codec` and asset resolving for generated story packages
- built-in stories from `src/data/stories`
- analytics through `analyticsService`

The reader can load:

- built-in TypeScript story fixtures
- generated stories served by the local proxy
- exported reader content from `public/reader-content`
- Vercel Blob manifest entries when `EXPO_PUBLIC_BLOB_MANIFEST_URL` is present on a Vercel deployment

The reader must not import generator-only code such as `src/ai-agents`, generation stores, provider settings panels, worker controls, source analysis, or image/video job orchestration. `scripts/check-reader-boundary.mjs` enforces this by walking imports and checking forbidden strings.

### Generator

The generator app imports the full creation surface:

- `GeneratorScreen`, `SettingsScreen`, and `VisualizerScreen`
- `PipelineClient` and `useGeneratorRunner`
- `generationJobStore`, `videoJobStore`, `seasonPlanStore`, and generator settings state
- provider credentials saved through AsyncStorage and the proxy generator-settings route
- image-only and video-only continuation helpers that rebuild a `PipelineConfig` from saved generator settings

Generator runs are intended to stay local/internal unless explicitly exported. `npm run generator:export:internal` exists for inspection, not as the public Vercel build.

## Proxy / Control Plane

The proxy is modularized under `storyrpg-prototype/proxy/` and bootstrapped by `proxy-server.js`.

Current responsibilities:

- CORS and static serving for `/generated-stories/*`
- local or GCS-backed generated story catalog reads
- generated story deletion/mutation tracking
- source/reference image upload and serving
- file writes and runtime artifact access
- worker lifecycle, worker events, worker checkpoints, dead-letter state, and cleanup
- generation job mirror state for the UI
- generator settings persistence
- model scanning and cached model availability
- Anthropic transport proxying
- Atlas Cloud, MidAPI, Stable Diffusion, LoRA trainer, and ElevenLabs proxy routes
- style-bible anchor persistence
- image feedback storage
- auth/session routes through Passport, local login, Google OAuth, and Discord OAuth

Runtime paths are centralized in `proxy/runtimePaths.js`. On local dev, artifacts live under the repo. On Cloud Run-like environments, runtime data can be redirected through `STORYRPG_RUNTIME_DIR`, `STORIES_DIR`, and `MEMORY_DIR`.

## Auth, Analytics, and Accounts

Auth is proxy-owned and session-cookie based. The proxy uses:

- `express-session`
- `passport`
- `passport-local`
- `passport-google-oauth20`
- `passport-oauth2` for Discord-style OAuth
- optional Postgres via `DATABASE_URL`
- a local auth user store fallback path where configured

Relevant environment variables:

- `SESSION_SECRET`
- `DATABASE_URL`
- `AUTH_BASE_URL`
- `AUTH_SUCCESS_REDIRECT`
- `AUTH_FAILURE_REDIRECT`
- `AUTH_LOCAL_ENABLED`
- `AUTH_ALLOW_REGISTRATION`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_CALLBACK_URL`
- `TRUST_PROXY`
- `SESSION_COOKIE_SECURE`
- `SESSION_COOKIE_SAMESITE`

Analytics are client-side through `analyticsService` and PostHog when enabled:

- `EXPO_PUBLIC_ANALYTICS_ENABLED`
- `EXPO_PUBLIC_POSTHOG_KEY`
- `EXPO_PUBLIC_POSTHOG_HOST`
- `EXPO_PUBLIC_ANALYTICS_DEBUG`
- `EXPO_PUBLIC_LOG_LEVEL`

The reader records lifecycle events such as app open, screen changes, story selection, and story start. Generator also emits target-scoped analytics for internal flow visibility.

## Story Library and Content Loading

Story loading has a stricter package boundary than older docs describe.

The primary generated package is:

- `story.json` — versioned story package encoded by `story-codec`
- `manifest.json` — package metadata and primary story file pointer

The proxy catalog reads `manifest.json` first, then falls back to `story.json`. Legacy-only directories must be migrated before runtime load. The client validates modern packages with `decodeStory`.

Media is now resolved through `src/assets/assetResolver.ts` and `src/services/storyLibrary.ts` rather than by ad hoc URL string rewrites. The resolver accepts both:

- legacy strings such as `generated-stories/<run>/images/<file>.png`
- content-addressed `AssetRef` objects backed by `story-codec/assetIndex`

Reader-visible generated content can be exported with:

```bash
READER_CONTENT_OUTPUT_DIR=dist-reader/reader-content npm run content:reader:export
```

or as part of:

```bash
npm run reader:export:with-content
```

The export skips checkpoints, prompts, job state, LoRA artifacts, source uploads, and diagnostics.

## Generation Pipeline Status

`src/ai-agents/pipeline/FullStoryPipeline.ts` remains the authoritative orchestrator.

Active generation flow:

1. Optional source analysis through `SourceMaterialAnalyzer`.
2. Optional season planning through `SeasonPlannerAgent`.
3. Seven-point structural validation through `SevenPointCoverageValidator`.
4. Shared foundation generation through `WorldBuilder`, `CharacterDesigner`, `NPCDepthValidator`, and `PhaseValidator`.
5. Episode blueprinting through `StoryArchitect`.
6. Branch and scene graph planning through `BranchManager`, deterministic topology helpers, and scene graph validators.
7. Scene prose through `SceneWriter`.
8. Choice authoring through `ChoiceAuthor`.
9. Encounter authoring through `EncounterArchitect`.
10. Narrative scaffolding through `ThreadPlanner`, `CallbackLedger`, `TwistArchitect`, `CharacterArcTracker`, and optional `SceneCritic`.
11. Incremental validation after meaningful generation steps.
12. Image planning and rendering through storyboard-v2, `ImageAgentTeam`, and `ImageGenerationService`.
13. Optional encounter imagery, style-bible anchoring, reference-pack handling, and image remediation.
14. Optional Stable Diffusion LoRA training through `LoraTrainingAgent`.
15. Optional video generation through `VideoDirectorAgent` and `videoGenerationService`.
16. Optional ElevenLabs narration through audio generation services.
17. Final story assembly, `SavingPhase`, `pipelineOutputWriter`, package writing, and catalog visibility.
18. Optional asset HTTP validation and Playwright-based story-path QA.

Scene-first planning now treats scenes as load-bearing dramatic units. When
`SeasonPlannerAgent` supplies planned scenes, `StoryArchitect` deterministically
derives scene names, turn contracts, dramatic structure, sequence intent,
residue, and transitions before prose generation, then runs the planned-scene
blueprint through the same architecture validation policy as LLM-invented
blueprints. `DramaticStructure` and `SceneTurnContract` are default-on
scene-shape gates with `GATE_DRAMATIC_STRUCTURE=0` and
`GATE_SCENE_TURN_CONTRACT=0` kill switches.

The pipeline has begun extracting typed phases. `SavingPhase` is wired and tested. `WorldBuildingPhase` is scaffolded but not fully wired as the active phase boundary. Future extraction should continue in behavior-preserving steps.

## Pipeline Parallelism and Resumability

There is no active `ParallelStoryPipeline`.

Current concurrency lives in:

- `BaseAgent` LLM request throttling
- `providerThrottle.ts` provider RPM and concurrency limits
- local image/audio queues
- worker job state and checkpoint cleanup in `workerLifecycle.js`
- generation settings for episode parallelism and image/audio worker modes
- optional, still-gated image parallel scene starts through `EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS`

Workers persist:

- generation jobs
- worker jobs
- checkpoint metadata
- checkpoint output files
- dead-letter records
- sanitized timeline/image/video job fragments

The proxy periodically normalizes stale jobs, prunes completed jobs, prunes orphaned checkpoints, clears stale MidAPI callback cache entries, trims high-memory worker state, and flushes stores on shutdown signals.

## Image Pipeline Status

The default image path is `storyboard-v2` unless explicitly set to `legacy`.

Core image modules:

- `images/storyboard-v2/StoryboardV2Pipeline.ts`
- `images/storyboard-v2/storyboardCompiler.ts`
- `images/storyboard-v2/visualGrammar.ts`
- `agents/image-team/ImageAgentTeam.ts`
- `services/imageGenerationService.ts`
- `services/providers/*`
- `services/stable-diffusion/*`
- `images/providerCapabilities.ts`
- `images/referenceStrategy.ts`
- `images/referencePackBuilder.ts`
- `images/artStyleProfile.ts`
- `images/anchorPrompts.ts`
- `images/loraRegistry.ts`

Supported or retained providers:

| Provider | Current role |
|---|---|
| `nano-banana` | Default Gemini image provider |
| `atlas-cloud` | Alternative provider via proxy |
| `midapi` | Midjourney via MidAPI proxy |
| `stable-diffusion` | Self-hosted A1111/Forge adapter path |
| `dall-e` | Historical / compatibility surface |
| `placeholder` | Fallback/testing |
| `useapi` | Historical alias normalized to `midapi` |

Style handling now prefers structured `ArtStyleProfile` data over a flat style string. The style setup UI can produce preapproved anchors for character, arc-strip, and environment slots. Uploaded style references can also be threaded through the pipeline with a configurable strength.

Stable Diffusion has the deepest local-control surface: base URL, API key/header, checkpoint, sampler, steps, CFG, dimensions, denoising strength, negative prompt, ControlNet model ids, IP-Adapter model ids, style LoRAs, and character LoRA mapping.

## LoRA Auto-Training Status

Auto-training is Stable-Diffusion-only and off by default.

Implemented pieces:

- `LoraTrainingAgent`
- `datasetBuilder`
- `loraRegistry`
- `services/lora-training/LoraTrainerAdapter`
- `services/lora-training/KohyaAdapter`
- proxy route mount at `/lora-training/*`

Training eligibility is driven by provider capability, feature switches, character-reference thresholds, style thresholds, and a fingerprint registry. The registry prevents retraining when the same story/style/character inputs have already produced an artifact.

Only the `kohya` sidecar path is concretely wired. Other backend enum values exist as future adapter placeholders.

## Video and Audio Status

Video generation is optional and disabled by default. It uses Gemini/Veo settings through `videoGenerationService` and `VideoDirectorAgent`.

Audio narration is optional and uses ElevenLabs through the proxy. Existing services cover TTS, voice lookup, batch generation, voice casting, and narration playback. Audio files and alignment data are written under generated story output directories when enabled.

## Validation Status

Validation is layered rather than one final pass.

Current families include:

- structural validation
- phase validation
- season and seven-point coverage
- stakes triangle checks
- choice density and distribution
- consequence budget checks
- scene graph branch checks
- mechanical storytelling checks
- scene craft and scene turn contract checks
- POV clarity
- theme pressure
- arc pressure and episode pressure
- NPC depth
- skill surface and mechanics leakage
- setup/payoff and callback coverage
- twist quality
- arc delta
- narrative diagnostics
- treatment fidelity and quote recall
- sequence continuity and sequence-plan specificity
- asset walking and Playwright QA

Final QA is intentionally two-tiered:

- Tier 1 checks story package and asset availability cheaply.
- Tier 2 uses browser/playthrough coverage when configured, then passes failures to remediation helpers where possible.

## Deployment and Storage

Reader is the intended public Vercel deployment:

```bash
npm run reader:export
```

Output directory:

```bash
dist-reader
```

Generator export exists as internal tooling only:

```bash
npm run generator:export:internal
```

Story storage modes:

- **Local**: `generated-stories/` under the app directory.
- **GCS**: proxy redirects `/generated-stories/*` to GCS when `STORY_STORAGE_MODE=gcs`.
- **Vercel Blob manifest**: reader can load public story packages from `EXPO_PUBLIC_BLOB_MANIFEST_URL` on Vercel deployments.

Relevant storage scripts:

- `npm run upload:gcs:latest`
- `npm run upload:gcs:all`
- `scripts/upload-stories-to-blob.ts`
- `npm run content:reader:export`

## Current Command Matrix

Run all commands from `storyrpg-prototype/`.

| Command | Current purpose |
|---|---|
| `npm run dev` | Kill existing Node processes, start proxy and Reader web |
| `npm run proxy` | Start Express proxy only |
| `npm run proxy:health` | Check proxy health endpoint |
| `npm run reader:web` | Start Reader web on port 8081 |
| `npm run web` | Alias for Reader web target |
| `npm run generator:web` | Start Generator web on port 8082 |
| `npm run reader:export` | Export public Reader web build |
| `npm run reader:export:with-content` | Export Reader and reader-safe generated content |
| `npm run generator:export:internal` | Export internal Generator build |
| `npm run reader:typecheck` | Typecheck reader app target |
| `npm run generator:typecheck` | Typecheck generator app target |
| `npm run typecheck` | Typecheck app, tests, contracts, and worker configs |
| `npm run lint` | ESLint over `src/**/*.{ts,tsx}` |
| `npm test` | Vitest test suite |
| `npm run validate` | Typecheck, lint, then tests |
| `npm run check:reader-boundary` | Import/string guard for Reader target |
| `npm run validate:reader` | Reader typecheck, boundary check, and focused reader tests |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run validate:assets` | Standalone asset validator |
| `npm run clean:runtime` | Clean local runtime artifacts |
| `npm run db:proxy` | Start Cloud SQL Auth Proxy helper |
| `npm run db:migrate` | Apply Postgres migrations |
| `npm run db:verify` | Verify database connectivity |

## Environment Boundary

Reader-safe public variables are limited to non-secret runtime flags, analytics, public reader URLs, and public content manifests. Provider keys, worker settings, Stable Diffusion/LoRA settings, and generator proxy configuration belong in local/internal generator or proxy environments.

Important reader-safe examples:

- `EXPO_PUBLIC_BLOB_MANIFEST_URL`
- `EXPO_PUBLIC_ANALYTICS_ENABLED`
- `EXPO_PUBLIC_POSTHOG_KEY`
- `EXPO_PUBLIC_POSTHOG_HOST`
- `EXPO_PUBLIC_READER_APP_URL`
- `EXPO_PUBLIC_GENERATOR_APP_URL`
- `EXPO_PUBLIC_ENABLE_INTERNAL_APP_LINKS`
- `EXPO_PUBLIC_LOG_LEVEL`

Important generator/proxy examples:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY` or current legacy `EXPO_PUBLIC_GEMINI_API_KEY` local path
- `ATLAS_CLOUD_API_KEY`
- `MIDAPI_TOKEN`
- `ELEVENLABS_API_KEY`
- `STABLE_DIFFUSION_BASE_URL`
- `STABLE_DIFFUSION_API_KEY`
- `LORA_TRAINER_BASE_URL`
- `LORA_TRAINER_API_KEY`
- `DATABASE_URL`
- `SESSION_SECRET`
- `GCS_BUCKET_NAME`
- `BLOB_READ_WRITE_TOKEN`

The code still contains some legacy `EXPO_PUBLIC_*` provider-key fallbacks for local Expo compatibility. The public Reader deployment should not include those secrets.

## Known Compatibility Boundaries

- `ImageGenerator.ts` has been removed; active image data types live under `src/ai-agents/images/`.
- `EpisodePipeline.ts` and `ParallelStoryPipeline` have been removed; `FullStoryPipeline` is the active orchestrator.
- `08-final-story.json` is migration input only. New runs write `story.json` and `manifest.json`.
- The old `useapi` provider string is normalized to `midapi`.
- Some large legacy files still use `@ts-nocheck`, especially in generation, image orchestration, reader runtime state, and older story fixtures.
- The target-specific app entries are the current deployment path; the old monolithic `App.tsx` shell has been removed.
- Stable Diffusion has only the A1111/Forge backend concretely implemented.
- LoRA trainer enums include future backends, but `kohya` is the active sidecar implementation.

## Documentation Map

Use these docs in this order when orienting:

1. `PROJECT_STATUS.md` — current implementation map.
2. `CURRENT_PIPELINE_STATUS.md` — concise generation path and compatibility boundary.
3. `READER_GENERATOR_SPLIT.md` — public Reader vs internal Generator deployment rules.
4. `INSTALL.md` — local setup, provider setup, commands, troubleshooting.
5. `TDD.md` — broad technical architecture.
6. `GDD.md` — game/product design intent.
7. `STORY_CONCEPTS_GUIDE.md` — accessible + technical map of story concepts, source analysis, structure, arcs, canon, choices, encounters, visuals, and treatment obligations.
8. `GAMEPLAY_SYSTEMS_NARRATIVE_GUIDE.md` — accessible + technical map of hidden gameplay systems and how they surface through narrative.
9. `BRANCHING_ARCS_NARRATIVE_GUIDE.md` — accessible + technical map of branching, reconvergence, player/NPC arcs, route state, information, endings, and validation.
10. `STORY_AGENT_SYSTEM_DETAIL.md` — deeper agent architecture.
11. `STORY_PIPELINE_PROMPTING.md` and treatment prompt docs — prompt contracts.
12. `IMAGE_PIPELINE_RUNTIME.md` and `LORA_TRAINING.md` — media generation details.
13. `STORY_QUALITY_CONTRACT.md`, validation plans, and structure/adaptation plans — quality gates and pending design work.
14. `TECH_DEBT_AUDIT.md` — current debt inventory and remediation backlog.
