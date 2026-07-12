---
name: storyrpg-media-pipeline
description: Use this skill when working on StoryRPG optional video or audio generation, VideoDirectorAgent, videoGenerationService, ElevenLabs/Gemini narration, voice casting, alignment, generated media jobs, or playback integration. Use storyrpg-image-pipeline for still images and visual style systems.
---

# StoryRPG Media Pipeline

## Workflow

1. Read `docs/CURRENT_PIPELINE_STATUS.md`; ensure story authoring and text-contract gates complete before media.
2. For video, inspect `VideoDirectorAgent`, `videoGenerationService`, video phases, job stores, continuation paths, and playback binding.
3. For audio, inspect `audioGenerationService`, `voiceCastingService`, narration services, `proxy/elevenLabsRoutes.js`, and playback controls.
4. Preserve deterministic voice casting, provider-neutral proxy routes, idempotent beat keys, alignment where supported, and cache/resume behavior.
5. Keep video/audio failures non-blocking while retaining diagnostics and missing-media truth.

## Guardrails

- Do not mutate sealed prose or narrative structure from a media phase.
- Keep provider keys and external API calls behind the proxy.
- Regenerate bound audio when source beat text changes.
- Use `storyrpg-image-pipeline` for storyboard-v2, `ImageAgentTeam`, `ArtStyleProfile`, image QA, and LoRA.

## Verification

```bash
npm test -- audioGeneration
npm test -- voiceCasting
npm test -- VideoPhase
npm run generator:typecheck
```
