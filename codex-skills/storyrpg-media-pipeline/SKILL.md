---
name: storyrpg-media-pipeline
description: Use this skill when working on StoryRPG media generation — image provider adapters, style bible anchors, ArtStyleProfile, reference packs, image QA/retry, Stable Diffusion/LoRA, AND audio narration (ElevenLabs/Gemini TTS, deterministic voice casting, alignment where supported) and their playback integration.
---

# StoryRPG Media Pipeline (Image + Audio)

StoryRPG renders two media layers after text is finalized: **images** (per-beat/scene/encounter)
and **audio narration** (provider-aware TTS, with word-level alignment where supported). Both are
pipeline phases that degrade softly — a missing image or beat audio never fails the run.

## Image Workflow

1. Start with `docs/IMAGE_PIPELINE_RUNTIME.md` and `docs/IMAGE_PIPELINE_AUDIT.md`.
2. Inspect `src/ai-agents/services/imageGenerationService.ts` and provider adapters before changing call sites.
3. Inspect style/reference helpers in `src/ai-agents/images/` and the `image-team/*` agents.
4. For LoRA: `docs/LORA_TRAINING.md`, `LoraTrainingAgent.ts`, `datasetBuilder.ts`, `loraRegistry.ts`, `proxy/loraTrainingRoutes.js`.

## Audio Workflow

1. `src/ai-agents/services/voiceCastingService.ts` casts characters to provider voices — **deterministic heuristics, no LLM** (keep it that way; same story = same cast). Providers are `elevenlabs` and `gemini`.
2. `src/ai-agents/services/audioGenerationService.ts` pre-renders per-beat TTS via provider-neutral `/audio/tts` and `/audio/batch-generate`, storing `audioUrl`, provider, voice id, and alignment when returned.
3. `proxy/elevenLabsRoutes.js` still owns the audio routes: `/audio/*` is provider-neutral; legacy `/elevenlabs/*` routes remain for ElevenLabs compatibility.

## Guardrails

- Keep image generation provider-aware (refs, batch, seed, LoRA differ per provider); never assume one shape fits all.
- Route every image call through `ProviderThrottle` (`this._throttle.run(provider, task, { dedupKey })`), never call a provider directly. Caps live in `images/providerCapabilities.ts`.
- No hardcoded endpoints — use `src/config/endpoints.ts`.
- Voice casting stays deterministic (no LLM, no `Math.random()`); narrator voice is never reused by characters.
- Audio is idempotent (keyed on `beatId`, `cached: true` on re-render) and soft-fails. ElevenLabs returns alignment for karaoke; Gemini emits WAV audio without alignment. If beat text changes post-TTS, regenerate.
- Don't regenerate/commit generated images or audio unless explicitly requested.

## Common Checks

- Providers: nano-banana (Gemini), atlas-cloud, midapi (Midjourney), stable-diffusion, placeholder, plus historical compatibility names (`useapi` normalizes to `midapi`; `dall-e` remains compatibility-only). Per-provider concurrency/interval caps in `providerCapabilities.ts`.
- Default image work flows through storyboard-v2 plus `ImageAgentTeam`; `ImageGenerator.ts` is gone.
- `ArtStyleProfile` resolution, reference pack slot priority (`referenceStrategy.ts`), character identity fingerprints, previous-panel continuity.
- Audio: `hasAlignment` flag, per-character ElevenLabs alignment grouped into word spans, Gemini voice catalog (`Kore`, `Puck`, etc.), 429 backoff serialized per voice.

## Verification

From `storyrpg-prototype/`, prefer focused tests:

```bash
npm test -- imageGenerationService
npm test -- stable-diffusion
npm test -- lora-training
npm test -- audioGeneration
npm test -- voiceCasting
npm run typecheck
```
