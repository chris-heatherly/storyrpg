---
name: storyrpg-image-pipeline
description: Use this skill when working on StoryRPG storyboard-v2, ImageAgentTeam, image providers, ArtStyleProfile, style-bible anchors, reference packs, image QA and retry, Stable Diffusion, or LoRA training.
---

# StoryRPG Image Pipeline

## Workflow

1. Read `docs/IMAGE_PIPELINE_RUNTIME.md` and `docs/CURRENT_PIPELINE_STATUS.md` for the active path.
2. Treat storyboard-v2, `ImageAgentTeam`, and `ImageGenerationService` as active; `ImageGenerator.ts` is removed.
3. Keep the raw user style authoritative through `ArtStyleProfile`, canonical style composition, style-bible anchors, and provider prompts.
4. Resolve provider behavior through `providerCapabilities.ts`, provider adapters, reference strategy, and `providerThrottle.ts`.
5. Preserve character identity references, essential-reference budgets, visual QA, retry limits, cache/resume keys, and non-blocking media failure semantics.
6. Keep LoRA Stable-Diffusion-only and use the current kohya adapter/registry fingerprint contract.

## Guardrails

- Do not let image work mutate sealed story text or narrative structure.
- Do not assume coordinator or visual-check scaffolds are live without confirming the call site.
- Keep provider keys server-side and out of the Reader bundle.

## Verification

```bash
npm test -- storyboard-v2
npm test -- imageGenerationService
npm test -- LoraTrainingAgent
npm run generator:typecheck
```
