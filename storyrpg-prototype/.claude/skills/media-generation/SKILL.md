---
name: media-generation
description: Use this skill when working on StoryRPG media generation — image providers/adapters, style bible anchors, reference packs, image QA/retry, Stable Diffusion/LoRA, and audio narration (ElevenLabs TTS, deterministic voice casting, karaoke alignment). Use when editing imageGenerationService.ts, image-team agents, providerThrottle, audioGenerationService.ts, voiceCastingService.ts, or elevenLabsRoutes.js.
---

# Media Generation (Image + Audio)

Two media layers render after text is finalized; both are pipeline phases that **degrade softly** —
a missing image or beat audio never fails the run.

## Images

- Entry point: `src/ai-agents/services/imageGenerationService.ts`. Providers: nano-banana (Gemini),
  atlas-cloud, midapi/useapi (Midjourney; `normalizeProvider` aliases useapi→midapi), dall-e,
  stable-diffusion, placeholder.
- **Always route through `ProviderThrottle`** (`this._throttle.run(provider, task, { dedupKey })`),
  never call a provider directly. Per-provider caps live in `images/providerCapabilities.ts`; per-provider
  reference strategy in `images/referenceStrategy.ts`.
- `image-team/*` agents storyboard, illustrate, and post-validate (validators score, they don't gate).
- LoRA training is gated by `supportsLoraTraining` (stable-diffusion only).
- No hardcoded endpoints — use `src/config/endpoints.ts`. Don't regenerate/commit generated images
  unless asked.

## Audio narration

- `voiceCastingService.ts` casts ElevenLabs voices with **deterministic heuristics — no LLM, no
  `Math.random()`** (same story = same cast). Narrator voice is never reused by characters.
- `audioGenerationService.ts` pre-renders per-beat TTS through the proxy, idempotent (keyed on
  `beatId`, `cached: true` on re-render), and stores `audioUrl` + `alignment` per beat.
- `proxy/elevenLabsRoutes.js` holds `ELEVENLABS_API_KEY` and forwards the **`with-timestamps`**
  endpoint — needed for karaoke; never switch to plain TTS. If beat text changes post-TTS the
  alignment is invalid — regenerate.

## Verification

```bash
npm test -- imageGenerationService stable-diffusion lora-training audioGeneration voiceCasting
npm run typecheck
```

See also: the Cursor `image-generation-team` + `audio-narration` skills,
`docs/IMAGE_PIPELINE_RUNTIME.md`, `docs/LORA_TRAINING.md`.
