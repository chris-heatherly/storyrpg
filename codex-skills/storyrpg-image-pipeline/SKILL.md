---
name: storyrpg-image-pipeline
description: Use this skill when working on StoryRPG image generation, image provider adapters, style bible anchors, ArtStyleProfile behavior, reference packs, image QA and retry logic, Stable Diffusion settings, or LoRA training.
---

# StoryRPG Image Pipeline

## Workflow

Keep provider capabilities and story readability in view:

1. Start with `docs/IMAGE_PIPELINE_RUNTIME.md` and `docs/IMAGE_PIPELINE_AUDIT.md` for current runtime behavior.
2. Inspect `storyrpg-prototype/src/ai-agents/services/imageGenerationService.ts` and provider adapters before changing call sites.
3. Inspect style and reference helpers in `storyrpg-prototype/src/ai-agents/images/`.
4. For LoRA work, inspect `docs/LORA_TRAINING.md`, `LoraTrainingAgent.ts`, `datasetBuilder.ts`, `loraRegistry.ts`, and `proxy/loraTrainingRoutes.js`.

## Guardrails

- Keep image generation provider-aware; never assume all providers accept the same reference format, batch mode, seed, or LoRA settings.
- Preserve character identity, style consistency, and visual story-beat clarity.
- Do not add hardcoded endpoints; use `storyrpg-prototype/src/config/endpoints.ts`.
- Avoid regenerating or committing generated images unless explicitly requested.
- Keep style behavior compatible with arbitrary user style strings; unknown styles should not inherit cinematic defaults accidentally.

## Common Checks

- Provider capability and throttling behavior before adding new image paths.
- `ArtStyleProfile` resolution, prompt composition, style-aware negatives, and anchor weights.
- Reference pack slot priority, character identity fingerprints, and previous-panel continuity.
- Stable Diffusion seeds, backend settings, and LoRA registry merge behavior.

## Verification

From `storyrpg-prototype/`, prefer focused tests:

```bash
npm test -- imageGenerationService
npm test -- stable-diffusion
npm test -- lora-training
npm run typecheck
```

Use asset validation only when story/image files or URLs are part of the task.
