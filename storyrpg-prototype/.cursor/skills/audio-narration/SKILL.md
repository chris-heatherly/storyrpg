---
name: audio-narration
description: Work on StoryRPG audio narration — voice casting via ElevenLabs, pre-generation of beat audio with karaoke alignment, and playback integration. Use when editing `src/ai-agents/services/audioGenerationService.ts`, `src/ai-agents/services/voiceCastingService.ts`, `proxy/elevenLabsRoutes.js`, or any component that plays back or schedules narration audio.
---

# Audio Narration

## Scope — what this skill covers

Audio narration is an optional-but-first-class layer in StoryRPG. It runs in two distinct moments:

- **Generation-time** — `AudioGenerationService` pre-renders TTS + alignment for every narration beat after text is finalized. This is a pipeline phase.
- **Runtime** — `StoryReader` plays the cached audio and drives karaoke highlighting via the alignment timestamps.

Files this skill covers:

- `src/ai-agents/services/audioGenerationService.ts` — batch orchestrator + per-beat generation
- `src/ai-agents/services/voiceCastingService.ts` — matches characters to ElevenLabs voices
- `proxy/elevenLabsRoutes.js` — proxy for TTS API calls (keeps the API key server-side)
- Any playback integration in `src/components/StoryReader.tsx` that calls into audio (see also `story-playback` skill).

If you are working on image generation instead, see `image-generation-team`.

## Architecture at a Glance

```
Generation pipeline
   │
   ▼
voiceCastingService.castVoices(characterBible)
   │     uses GET /elevenlabs/voices (proxy) to pull available voice metadata
   │     scores each voice against gender / age / personality / accent
   │     returns a VoiceCast { narrator, characters[] }
   ▼
audioGenerationService.generateBatchForScene(scene, voiceCast)
   │     POSTs each beat's text to /elevenlabs/tts-with-timestamps
   │     stores audio + alignment JSON alongside the scene in generated-stories/
   ▼
Story JSON now has `audioUrl` + `alignment` on each beat
   │
   ▼
Runtime (StoryReader)
   plays audioUrl, uses alignment to drive word-by-word highlight
```

## Voice casting — deterministic matcher, not an LLM

`voiceCastingService` is **pure heuristics + voice metadata**. No LLM. It reads `CharacterBible` fields and scores each ElevenLabs voice on:

- Gender match (pronouns → labels.gender)
- Age match (bible's age bucket → labels.age)
- Personality heuristics (traits like "warm", "authoritative", "playful" map to voice descriptions)
- Accent preference (only if the bible explicitly requests one)

**Do not add LLM calls here.** The determinism is the feature — the same story always gets the same cast on re-run, which is essential for producer review.

The narrator is always cast separately from character voices, and the narrator voice is allowed to be reused by no one else.

## Audio pre-generation lives in a pipeline phase

`AudioGenerationService.generateBatchForScene` is called from the `audioGeneration` phase of `FullStoryPipeline`. It is:

- **Idempotent** — each beat is keyed on `beatId`; regenerating a scene should use cached audio if the text is unchanged (`cached: true` in the result).
- **Non-blocking on failure** — a failed beat is reported but does not fail the whole pipeline. Missing audio is a soft degradation; the reader falls back to silent playback.
- **Rate-aware** — ElevenLabs has strict concurrency limits. The service serializes calls per voice and backs off on 429.

If you add a new audio pipeline phase, wire it through `AudioGenerationService`, not direct `fetch` calls.

## Alignment / karaoke — use the `with_timestamps` endpoint

The playback UX depends on **word-level timestamps** from ElevenLabs's `text-to-speech/:voice_id/with-timestamps` endpoint. The proxy route forwards this unchanged and stores the `alignment` JSON alongside the audio URL.

Footguns:

- Do not switch to plain `text-to-speech/:voice_id` — you will lose `alignment` and karaoke highlighting will silently stop working.
- The alignment is **per-character**, not per-word. The renderer groups characters into word spans. If you change the text post-TTS (e.g. inject a template variable), the alignment is invalidated — regenerate.
- `hasAlignment` on the result is the canonical "did we get timestamps?" flag. The reader must check it before enabling karaoke mode.

## Cost / rate control

ElevenLabs is the most expensive external call in the pipeline per token rendered. Guardrails in the service today:

- Per-beat text is capped (see `MAX_BEAT_TTS_CHARS` if present) — long beats are split.
- The batch result exposes `generated`, `cached`, `failed` so telemetry can surface "how many beats hit the API this run."
- Failed beats go into `result.errors` with the beatId; the pipeline never retries automatically.

If you are adding a new voice or a new character track, estimate the impact: n_beats × mean_chars_per_beat × voice_premium_factor. Flag it in the PR description.

## `elevenLabsRoutes.js` — proxy responsibilities

The proxy does three things for audio:

1. Holds the `ELEVENLABS_API_KEY` (never ship to client).
2. Forwards `GET /voices` so `voiceCastingService` can pull metadata without exposing the key.
3. Forwards TTS generation with `with-timestamps`, streaming the binary back to the caller.

Do not add business logic here — mapping / filtering of voices belongs in `voiceCastingService`. The proxy is a pure transport.

## Common footguns

1. **Adding an LLM call to voice casting.** Breaks determinism, introduces flake, no user benefit.
2. **Dropping `alignment` from the result shape.** Karaoke silently degrades with no error.
3. **Calling ElevenLabs directly from the client bundle.** You will leak the API key and trip CORS.
4. **Mutating beat text after audio is generated.** Misaligned audio is worse than no audio.
5. **Forgetting `cached: true` in regenerations.** If you refactor the cache key, keep the `cached` flag honest so telemetry still reflects reality.
6. **Forcing the narrator voice onto all characters.** Narrator reuse is prohibited in the caster for a reason — readers find it confusing.

## Checklist when editing audio code

1. Did you keep voice casting deterministic (no LLM, no `Math.random()`)?
2. Did you keep alignment end-to-end — from `with-timestamps` through the stored JSON to the renderer?
3. If you changed beat text post-TTS, did you invalidate the cache entry?
4. Did you route all calls through `/elevenlabs/*` proxy endpoints?
5. Did you keep failures soft — playback still works without audio?
6. Are the new rate-control assumptions documented in `docs/TDD.md` under the audio subsystem?
