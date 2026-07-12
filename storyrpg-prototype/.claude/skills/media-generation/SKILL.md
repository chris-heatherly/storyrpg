---
name: media-generation
description: Use this skill when working on StoryRPG media generation — storyboard-v2, ImageAgentTeam, ArtStyleProfile, image providers, style anchors, image QA/retry, Stable Diffusion/LoRA, optional video, or audio narration.
---

# Media Generation (Image + Audio + Video)

Two media layers render after text is finalized; both are pipeline phases that **degrade softly** —
a missing image or beat audio never fails the run.

The active still-image path is storyboard-v2 -> `ImageAgentTeam` -> `ImageGenerationService`, with
`ArtStyleProfile` and approved anchors kept authoritative. Optional video uses
`VideoDirectorAgent` / `videoGenerationService`; all media runs after the sealed text contract and
must not mutate narrative structure.

## Images

- Entry point: `src/ai-agents/services/imageGenerationService.ts`. Providers: nano-banana (Gemini),
  atlas-cloud, midapi (Midjourney), stable-diffusion, placeholder, plus historical compatibility
  names (`useapi` normalizes to `midapi`; `dall-e` remains a compatibility surface).
- **Always route through `ProviderThrottle`** (`this._throttle.run(provider, task, { dedupKey })`),
  never call a provider directly. Per-provider caps live in `images/providerCapabilities.ts`; per-provider
  reference strategy in `images/referenceStrategy.ts`.
- Default image work flows through storyboard-v2 plus `ImageAgentTeam`; `ImageGenerator.ts` is gone.
- `image-team/*` agents storyboard, illustrate, and post-validate (validators score, they don't gate).
- LoRA training is gated by `supportsLoraTraining` (stable-diffusion only).
- No hardcoded endpoints — use `src/config/endpoints.ts`. Don't regenerate/commit generated images
  unless asked.

## Audio narration

- `voiceCastingService.ts` casts provider voices with **deterministic heuristics — no LLM, no
  `Math.random()`** (same story = same cast). Providers are `elevenlabs` and `gemini`; narrator
  voice is never reused by characters.
- `audioGenerationService.ts` pre-renders per-beat TTS through provider-neutral proxy routes
  (`/audio/tts`, `/audio/batch-generate`), idempotent (keyed on `beatId`, `cached: true` on
  re-render), and stores `audioUrl`, provider, voice id, and alignment when returned.
- `proxy/elevenLabsRoutes.js` owns both `/audio/*` provider-neutral routes and legacy
  `/elevenlabs/*` routes. ElevenLabs uses `with-timestamps` for karaoke alignment; Gemini emits WAV
  audio without alignment. If beat text changes post-TTS, regenerate.

## Verification

```bash
npm test -- imageGenerationService stable-diffusion lora-training audioGeneration voiceCasting
npm run typecheck
```

See also: the Cursor `image-generation-team` + `audio-narration` skills,
`docs/IMAGE_PIPELINE_RUNTIME.md`, `docs/LORA_TRAINING.md`.
