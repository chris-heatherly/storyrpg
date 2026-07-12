# Legacy Removal Registry

**Status:** active cleanup tracker

This registry classifies old StoryRPG structures so removal work stays explicit
and migration-first. Compatibility code should live at ingestion, codec, or
one-time settings migration boundaries only; active generation, playback, and
catalog runtime code should use current contracts directly.

## Classification

| Surface | Classification | Target state |
|---|---|---|
| `LegacyStructuralMap`, `LegacyStructuralBeat`, `legacyStructure`, `structuralRole` | migrate-then-delete | Decode or ingest old seven-point data into Story Circle at the boundary; active pipeline consumes Story Circle only. |
| `EpisodeBlueprint.arc` | migrate-then-delete | Replace active validator/prompt usage with `episodeCircle` and arc-pressure contracts. |
| `legacyStructureDistribution.ts` | migrate-then-delete | Remove after Story Circle distribution fully owns planning and tests. |
| `08-final-story.json` | migrate-then-delete | Migration input only; new runtime writes and catalog reads use `story.json` + `manifest.json`. |
| Raw `Story` package fallback | migrate-then-delete | Codec migration decodes old raw stories into the current package shape. |
| Flat `encounter.beats` | migrate-then-delete | Codec migration normalizes into `encounter.phases[].beats`; runtime consumers read phases. |
| Legacy encounter image filenames and situation keys | migrate-then-delete | Asset manifests/indexes carry current identifiers; proxy does not guess old names at runtime. |
| `normalizeStoryMediaUrls` | delete | Use `resolveStoryMedia` directly. |
| `ImageGenerator` compatibility export | delete | Use image team/services and storyboard-v2 phases. |
| `imageGen.pipelineMode: 'legacy'` | delete | Current image orchestration is the only pipeline mode. |
| `useapi` provider id | migrate-then-delete | Normalize old stored/env values to `midapi`; current config exposes `midapi`. |
| `useIndividualCharacterViews` | delete | Provider reference strategy owns character-reference behavior. |
| Monolithic `App.tsx` | delete | Reader and Generator target entries are the only app shells. |
| `targetSceneCount` | delete | Use `maxScenesPerEpisode`. |
| `PROVIDER_MODEL_OPTIONS` | delete | Use `FALLBACK_MODEL_OPTIONS` or dynamic model loading. |
| Old settings storage keys | migrate-then-delete | One-time migration writes modern keys, then stops reading old keys. |
| Legacy narration direct-file alignment fetch | delete | Proxy alignment endpoint is authoritative. |
| `EpisodePipeline.ts` / `ParallelStoryPipeline` doc references | delete/stale-doc | Code is gone; docs must not describe them as present. |
| `sceneEpisode` active-mode references | delete/stale-doc | Keep only explicitly historical references when needed. |
| `@ts-nocheck` suppressions | modernize | Remove in small typed tranches after legacy shape dependencies are gone. |
| Narrative realization task v2 fields (`requiredSurface`, `routePolicy`, top-level `outcomeTier`) | migrate-then-delete | Normalize only while loading persisted checkpoints; all active compilers, prompts, gates, and repair metadata use the version-3 discriminated `target` contract. Remove the boundary adapter after supported resume artifacts have crossed the version-3 migration window. |
| NarrativeContractValidator viral/codename/all-route heuristic loops | migrate-then-delete | Compatibility checks only for events that lack a compiled realization task. Version-3 events use the canonical task gate exclusively; delete these loops when version-2 graph resume support is retired. |

## Current Ratchet

1. New package writes must not produce `08-final-story.json`.
2. Runtime catalog and proxy resolution must require `story.json` or
   `manifest.json`; legacy-only directories should be reported as needing
   migration.
3. Legacy decoders and migration tests may keep old names, but active app,
   proxy, and generation code should not import them.
