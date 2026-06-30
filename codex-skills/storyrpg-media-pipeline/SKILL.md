---
name: storyrpg-media-pipeline
description: Use this skill when working on StoryRPG media generation — image provider adapters, style bible anchors, ArtStyleProfile, reference packs, image QA/retry, Stable Diffusion/LoRA, AND audio narration (ElevenLabs TTS, voice casting, karaoke alignment) and their playback integration.
---

# StoryRPG Media Pipeline (Image + Audio)

StoryRPG renders two media layers after text is finalized: **images** (per-beat/scene/encounter)
and **audio narration** (TTS with word-level alignment). Both are pipeline phases that degrade
softly — a missing image or beat audio never fails the run.

## Image Workflow

1. Start with `docs/IMAGE_PIPELINE_RUNTIME.md` and `docs/IMAGE_PIPELINE_AUDIT.md`.
2. Inspect `src/ai-agents/services/imageGenerationService.ts` and provider adapters before changing call sites.
3. Inspect style/reference helpers in `src/ai-agents/images/` and the `image-team/*` agents.
4. For LoRA: `docs/LORA_TRAINING.md`, `LoraTrainingAgent.ts`, `datasetBuilder.ts`, `loraRegistry.ts`, `proxy/loraTrainingRoutes.js`.

## Audio Workflow

1. `src/ai-agents/services/voiceCastingService.ts` casts characters to ElevenLabs voices — **deterministic heuristics, no LLM** (keep it that way; same story = same cast).
2. `src/ai-agents/services/audioGenerationService.ts` pre-renders per-beat TTS via the proxy and stores `audioUrl` + `alignment` on each beat.
3. `proxy/elevenLabsRoutes.js` holds `ELEVENLABS_API_KEY` and forwards the `with-timestamps` endpoint (needed for karaoke highlighting — never switch to plain TTS).

## Guardrails

- Keep image generation provider-aware (refs, batch, seed, LoRA differ per provider); never assume one shape fits all.
- Route every image call through `ProviderThrottle` (`this._throttle.run(provider, task, { dedupKey })`), never call a provider directly. Caps live in `images/providerCapabilities.ts`.
- No hardcoded endpoints — use `src/config/endpoints.ts`.
- Voice casting stays deterministic (no LLM, no `Math.random()`); narrator voice is never reused by characters.
- Audio is idempotent (keyed on `beatId`, `cached: true` on re-render) and soft-fails. If beat text changes post-TTS, the alignment is invalid — regenerate.
- Don't regenerate/commit generated images or audio unless explicitly requested.

## Common Checks

- Providers: nano-banana (Gemini), atlas-cloud, midapi/useapi (Midjourney; `normalizeProvider` aliases useapi→midapi), dall-e, stable-diffusion, placeholder. Per-provider concurrency/interval caps in `providerCapabilities.ts`.
- `ArtStyleProfile` resolution, reference pack slot priority (`referenceStrategy.ts`), character identity fingerprints, previous-panel continuity.
- Audio: `hasAlignment` flag, per-character alignment grouped into word spans, 429 backoff serialized per voice.

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
