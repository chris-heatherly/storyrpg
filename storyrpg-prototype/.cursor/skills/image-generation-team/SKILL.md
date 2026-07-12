---
name: image-generation-team
description: Work on the StoryRPG image generation subsystem — the ImageAgentTeam, image providers, per-provider throttling (ProviderThrottle), character consistency, and video/LoRA adjuncts. Use when editing files in src/ai-agents/agents/image-team/, src/ai-agents/services/imageGenerationService.ts, src/ai-agents/services/providerThrottle.ts, src/ai-agents/images/providerCapabilities.ts, or any image/video pipeline phase.
---

# Image Generation Team

The active path is storyboard-v2 -> `ImageAgentTeam` -> `ImageGenerationService`. Preserve the raw
user style through `ArtStyleProfile`, canonical style composition, and approved style anchors.

## Architecture Overview

```
Post-story media phases
  ├── Master Images: character references + color scripts
  ├── Scene Images: beat-level illustrations
  └── Encounter Images: encounter sequence visuals

ImageAgentTeam (coordination)
  ├── Planning Agents: Storyboard, ColorScript, CinematicBeatAnalyzer, DramaExtraction
  ├── Generation Agents: VisualIllustrator, EncounterImage, CharacterReferenceSheet
  ├── Validation Agents: Consistency, Composition, Pose, Transition, Expression, BodyLanguage, Lighting, VisualStorytelling, VisualNarrative
  ├── Systems (non-agent libraries): VisualNarrativeSystem, VisualStorytellingSystem, LightingColorSystem, CharacterActionLibrary
  └── Video / training: VideoDirectorAgent, LoraTrainingAgent

ImageGenerationService (provider abstraction)
  └── Providers: nano-banana (Gemini), atlas-cloud, midapi (Midjourney), stable-diffusion, placeholder
      Compatibility: `useapi` aliases to `midapi`; `dall-e` remains a historical surface
```

Default image work flows through storyboard-v2 plus `ImageAgentTeam`; `ImageGenerator.ts` has been
removed. Images run after story authoring, per-episode QA, and episode failure gates.

## ImageAgentTeam (`agents/image-team/ImageAgentTeam.ts`)

### Team Members

Core planning & generation (wired in the `ImageAgentTeam` constructor):

| Agent | Role |
|---|---|
| StoryboardAgent | Plans shots and cinematic structure |
| VisualIllustratorAgent | Generates image prompts per shot |
| EncounterImageAgent | Encounter-specific visuals |
| CharacterReferenceSheetAgent | Character reference sheet generation |
| ColorScriptAgent | Color palette planning |
| CinematicBeatAnalyzer | Extracts beat-level cinematic intent from prose |

Validation agents (run post-generation, do not gate image creation):

| Agent | Role |
|---|---|
| ConsistencyScorerAgent | Character consistency scoring |
| CompositionValidatorAgent | Composition validation |
| PoseDiversityValidator | Pose variety across scenes |
| TransitionValidator | Scene-to-scene visual transitions |
| ExpressionValidator | Facial expression consistency |
| BodyLanguageValidator | Body language continuity |
| LightingColorValidator | Lighting/color coherence |
| VisualStorytellingValidator | Visual narrative rules |

Video & training side:

| Agent | Role |
|---|---|
| VideoDirectorAgent | Composes video clips from scene shots (gated by `EXPO_PUBLIC_VIDEO_GENERATION_ENABLED`) |
| LoraTrainingAgent | Trains local LoRA weights — only active when `getProviderCapabilities(provider).supportsLoraTraining` is true (currently `stable-diffusion` only) |

Non-agent libraries referenced by agents (knowledge bases, not LLM callers): `VisualNarrativeSystem`, `VisualStorytellingSystem`, `LightingColorSystem`, `CharacterActionLibrary`.

### Coordination Flow

`generateFullSceneVisuals()`:
1. Storyboard Agent plans shots (chunked execution for large scenes)
2. Illustrator Agent generates prompts per shot
3. Prompts stored in `Map<string, ImagePrompt>`
4. Validation agents check consistency, composition, etc.

### Caching Strategy

The team maintains cross-scene caches:
```typescript
characterReferenceSheets: Map<string, GeneratedReferenceSheet>
colorScripts: Map<string, ColorScript>
motifLibraries: Map<string, MotifLibrary>
characterBodyVocabularies: Map<string, CharacterBodyVocabulary>
```

Character references and color scripts are generated once (master images phase) and reused for all scene images.

## ImageGenerationService (`services/imageGenerationService.ts`)

### Provider Abstraction

Single entry point:
```typescript
async generateImage(prompt: string, options?: ImageGenOptions): Promise<GeneratedImage>
```

Provider switch routes to:
- `generateWithNanoBanana()` - Gemini API
- `generateWithAtlasCloud()` - Atlas Cloud
- MidAPI/Midjourney generation path (legacy `useapi` input normalizes to `midapi`)
- DALL-E compatibility path where still wired
- `generateWithStableDiffusion()` - Stable Diffusion
- `generateWithPlaceholder()` - Development placeholder

### Unified Return Type

```typescript
interface GeneratedImage {
  prompt: string;
  imageUrl: string;
  imagePath: string;
  imageData?: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  metadata?: Record<string, unknown>;
}
```

### Gemini-Specific Features (nano-banana)

- **Multi-turn chat sessions**: `startChatSession()` / `generateImageInChat()` for within-scene continuity
- **Style reference images**: `setGeminiStyleReference()` anchors visual style
- **Previous scene continuity**: `setGeminiPreviousScene()` passes prior scene as context
- **Reference sheet anchor**: `setReferenceSheetStyleAnchor()` for character consistency

### Character Consistency Strategy

1. Generate character reference sheets early (master images phase)
2. Pass reference images to subsequent generation calls
3. Use multi-turn chat mode so the model maintains visual memory
4. Validation agents score consistency across generated images

## Per-Provider Reference Strategy

`src/ai-agents/images/referenceStrategy.ts` is the single source of truth for *which* reference artifacts are worth generating for each provider, and *which* of those artifacts should ride along on scene/beat calls. It complements `providerCapabilities.ts`:

- `providerCapabilities`: facts about the API (max refs, inline vs URL, concurrency)
- `referenceStrategy`: opinions about content (what actually improves identity for this provider)

Current matrix:

| Provider | Views generated | Composite | Expressions | Body vocab | Silhouette | Scene refs | Cap |
|---|---|---|---|---|---|---|---|
| nano-banana / atlas-cloud | front, 3q, profile | yes (→ style anchor) | yes | yes | yes | all views + face | 10/16 |
| dall-e compatibility | front only | no | no | no | no | front + face | 2 |
| midapi (Midjourney) | front, 3q, profile | yes (→ --cref) | no (dropped by filter) | no | no | composite + style anchor | 2 |
| stable-diffusion | front, 3q, profile | yes | yes | yes | yes | all views (IP-Adapter) | 4 |
| placeholder | — | — | — | — | — | none | 0 |

Key invariant: user-facing toggles (`generateExpressionSheets`, `generateBodyVocabulary`) can only *narrow* the strategy — they never override it upward. Compatibility providers with fewer reference inputs stay on the trimmed path even when a richer reference toggle is enabled.

The strategy is consumed in two places:

1. `FullStoryPipeline.generateCharacterReferenceSheet` / `MasterImagePhase` — gates which planners and image calls run up front during the master-refs phase.
2. `filterRefsForProvider` in `referencePackBuilder.ts` — partitions the built reference pack into what the provider actually gets vs what's stripped.

## Concurrency & Rate Limiting

The old single-instance `_concurrencyLimit` + global `lastRequestTime` pair has been **replaced** by a per-provider gate. Every `generateImage()` call runs through `ProviderThrottle` (`services/providerThrottle.ts`) with caps sourced from `getProviderCapabilities()` in `images/providerCapabilities.ts`.

### Why

Before the change, Midjourney's slow rate limit serialized every Gemini call through the same global gate. `ProviderThrottle` gives each provider its own semaphore and min-interval, so a slow provider can't starve a fast one.

### Entry Point

`ImageGenerationService` (grep `_throttle = new ProviderThrottle`) instantiates:
```typescript
private _throttle = new ProviderThrottle();
private _inflightGenerations: Map<string, Promise<GeneratedImage>> = new Map();
```

Callers go through `this._throttle.run(provider, task, { dedupKey })` — two concurrent calls with the same `dedupKey` (usually a prompt hash) share one round-trip.

### Per-Provider Caps

Current defaults live in `src/ai-agents/images/providerCapabilities.ts` (see `PROVIDER_CAPABILITIES`):

| Provider | concurrency | minRequestIntervalMs | rpmCeiling |
|---|---|---|---|
| `nano-banana` (Gemini) | 6 | 1000 | 60 |
| `atlas-cloud` | 4 | 1500 | 40 |
| `midapi` (Midjourney; legacy `useapi` alias) | 2 | 3000 | 20 |
| `dall-e` compatibility | 3 | 2000 | 30 |
| `stable-diffusion` | 1 | 0 | — |
| `placeholder` | 16 | 0 | — |

Runtime overrides are supported via `overrideProviderCapabilities(provider, override)` — use this when a user's API tier differs from the public default. LoRA training is gated by the provider's `supportsLoraTraining` flag.

## Retry Logic

### Configuration

```typescript
maxRetries: 5
retryDelayMs: 5000
retryBackoffMultiplier: 2
// Delays: 5s, 10s, 20s, 40s, 80s
```

### Error Classification

`classifyError()` determines retry behavior:

| Error Type | Retryable | Examples |
|---|---|---|
| Transient | Yes | Rate limits (429), timeouts, 503, connection resets |
| Permanent | No | Content policy violations, malformed requests, invalid API keys |

### Caching

Three layers prevent redundant generation:
1. **Prompt hash cache**: `_promptCache: Map<string, {imageUrl, imagePath, imageData}>`
2. **File existence check**: `getExistingImageFile()` skips if already on disk
3. **Identifier deduplication**: `_generatedIdentifiers: Set<string>`

## Pipeline Integration

Image generation runs after text authoring/episode QA with three sub-phases:

1. **master_images**: Character reference sheets + color scripts (cached for reuse)
2. **episode_image_generation**: Per-beat illustrations using storyboard plans
3. **encounter_image_generation**: Encounter sequence visuals

Checkpoints: `image_manifest` and `encounter_images` (both `requiresApproval: false`).

## Checklist for Image System Changes

1. New providers: implement `generateWith[Provider]()`, add to the provider switch, return `GeneratedImage`, and **add a row to `DEFAULT_CAPABILITIES` in `providerCapabilities.ts`** (concurrency, `minRequestIntervalMs`, `maxRefs`, `supportsLoraTraining`, etc.) so `ProviderThrottle` can gate it correctly
2. New image agents: add to `ImageAgentTeam`, integrate into coordination flow
3. Route calls through `this._throttle.run(provider, task, { dedupKey })` — never call providers directly
4. Use prompt hash cache and the inflight dedup map to avoid regenerating identical images
5. Classify errors as transient/permanent for correct retry behavior (retries capped at `maxRetryBackoffMs = 20s`; `text_instead_of_image` errors capped at `maxTextInsteadOfImageRetries = 2`)
6. For Gemini: use chat sessions for within-scene consistency, reference images for cross-scene
7. Validation agents run post-generation; they don't block image creation
8. If the provider supports LoRA training, expose `supportsLoraTraining: true` so `LoraTrainingAgent` opts in; otherwise it no-ops
