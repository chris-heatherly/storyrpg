# Image Pipeline Runtime

**Last Updated:** April 2026

This document captures the live runtime behavior of the StoryRPG image pipeline.

## Goals

- Keep character identity stable across scenes and branches.
- Keep style stable across the episode, not just within one prompt.
- Make every image communicate a readable story beat.
- Use model-specific controls when they improve results.
- Enforce encounter image completeness as a pipeline invariant.

## Current Runtime Flow

1. `FullStoryPipeline` generates character references and body-language assets during the master-images phase.
2. `ColorScriptAgent` creates the episode color arc.
3. The pipeline generates an episode style bible before scene renders begin:
   - an abstract color-script strip
   - a controlled character-in-style anchor image
4. The best style-bible image becomes the primary style anchor for downstream image generation.
5. `StoryboardAgent` plans shot rhythm, transitions, color/mood, motifs, and beat locks.
6. `VisualIllustratorAgent` converts shots into structured image prompts.
7. `ImageGenerationService` routes the prompt to the selected provider and applies provider-specific controls.
8. `ImageAgentTeam` runs diversity validation first, then full visual QA, and can trigger targeted regeneration for severe failures.

### Image Prompt Assembly

Image prompts are assembled through a layered system:

- `src/ai-agents/images/beatPromptBuilder.ts` — `buildBeatImagePrompt` constructs prompts from beat context, visual contracts, and storyboard plans
- `src/ai-agents/images/promptComposer.ts` — `composeCanonicalPrompt` and `budgetCanonicalPrompt` assemble and trim prompts to fit provider limits
- `src/ai-agents/images/shotSequencePlanner.ts` — `planShotSequence` determines shot types and panel modes
- `src/ai-agents/images/referencePackBuilder.ts` — `buildReferencePack` selects and packages reference images for identity lock

### Image Asset Management

- `src/ai-agents/images/assetRegistry.ts` — `AssetRegistry` tracks all generated image assets
- `src/ai-agents/images/slotTypes.ts` — defines `ImageSlot` types and slot families/statuses
- `src/ai-agents/images/storyImageSlotManifest.ts` — builds scene/beat coverage manifests
- `src/ai-agents/images/storyAssetAssembler.ts` — `assembleStoryAssetsFromRegistry` wires URLs into story data
- `src/ai-agents/images/coverageValidator.ts` — `validateRegistryCoverage` checks completeness
- `src/ai-agents/images/visualValidation.ts` — tier-1 heuristic checks, tier-2 vision-model prompts, regeneration targeting
- `src/ai-agents/images/providerPolicy.ts` — `ProviderPolicy` with health state tracking

## Character Consistency

Character consistency uses multiple layers:

- Canonical physical descriptions from the character bible
- Character reference sheets with individual views where supported
- Body-vocabulary and silhouette metadata for pose/staging continuity
- Selective generated expression references for major characters when expression-sheet generation is enabled
- Prompt-time identity injection in `ImageGenerationService`

Scene generation can request expression references on emotionally critical beats, especially:

- climax beats
- key story beats
- beats with high-intensity character emotions

This keeps facial acting continuity separate from raw face-lock consistency.

### Character Reference Sheet Agent

`CharacterReferenceSheetAgent` (`src/ai-agents/agents/image-team/CharacterReferenceSheetAgent.ts`) provides:

- `execute` — full reference sheet generation
- `generateExpressionSheet` — expression reference sheets
- `generateSingleExpression` — individual expression references
- `generateActionPoseSheet` — action pose reference sheets
- `generateSilhouetteProfile` — silhouette profiles for identity recognition
- `generateSingleViewPrompt` — individual character view prompts
- `generateBodyVocabulary` — body language vocabulary references
- `generateActingDirection` — acting direction for specific emotional beats

## Style Consistency

The pipeline no longer relies solely on the first generated scene image to define the look.

Primary style-control stack:

1. canonical art-style text
2. episode style bible artifact
3. previous-scene continuity image
4. color-script planning constraints

If the style bible cannot be generated, the runtime falls back to the old first-scene anchor behavior.

### Style Adaptation

`src/ai-agents/utils/styleAdaptation.ts` provides conditional art style parsing and `resolveSceneSettingContext` / `selectStyleAdaptation` for adapting visual style to scene context.

## Visual Storytelling Enforcement

The prompt layer is responsible for:

- beat clarity
- camera grammar
- gesture/body-language specificity
- transition continuity
- motif threading
- thumbnail readability

These principles are codified in:

- `src/ai-agents/prompts/visualPrinciples.ts` — mobile composition, shot/camera/body language, pose rules, encounter/beat compact principles, transition types/prompts
- `src/ai-agents/agents/image-team/VisualNarrativeSystem.ts` — rules, helpers, `suggestRhythmSpec`, `checkAdvancement`, `runSilentStorytellingTest`, `suggestEnvironmentPersonality`
- `src/ai-agents/agents/image-team/VisualStorytellingSystem.ts` — unified camera/texture/composition vocabulary
- `src/ai-agents/agents/image-team/LightingColorSystem.ts` — lighting/color types, emotion maps, `generateMoodSpec`, `generateLightingColorPrompt`
- `src/ai-agents/agents/image-team/CharacterActionLibrary.ts` — movement profiles, body language inference
- `src/ai-agents/agents/image-team/CinematicBeatAnalyzer.ts` — heuristic beat type detection, cinematic analysis, body language and camera suggestions

### Runtime QA Stages

Runtime QA has two stages:

1. Pose-diversity regeneration (`PoseDiversityValidator`)
2. Full visual QA regeneration

Full visual QA can trigger targeted regeneration using guidance from:

- `CompositionValidatorAgent` — composition validation
- `ExpressionValidator` — expression validation
- `BodyLanguageValidator` — body-language validation
- `LightingColorValidator` — lighting/color validation
- `VisualStorytellingValidator` — broad visual storytelling QA with `validateSequence`
- `VisualNarrativeValidator` — Eisner-style narrative validation
- `TransitionValidator` — beat-to-beat transition validation
- `ConsistencyScorerAgent` — image/reference consistency scoring
- `AssetAuditorAgent` — asset audit reports
- `DramaExtractionAgent` — dramatic structure extraction for images

## Encounter Image Runtime

Encounter art runs as a first-class image path rather than a thin special case.

- `EncounterArchitect` authors setup, outcome, next-situation, and storylet `visualContract` fields.
- `FullStoryPipeline` preserves those authored contracts and only falls back to inferred contracts when the authored field is missing.
- Encounter image traversal uses the runtime encounter shape, where beats live under `encounter.phases[].beats`. Legacy flat `encounter.beats` is supported only as a compatibility fallback inside shared helpers.
- `EncounterImageAgent` differentiates action, social, romantic, dramatic, investigation, puzzle, exploration, stealth, and mixed encounter grammar.
- Social, romantic, dramatic, negotiation, investigation, and mixed encounters opt into expression references more aggressively so facial acting survives generation.
- Storylet aftermath images route through the encounter cinematic prompt path instead of a thinner raw-text prompt.

### Encounter Image QA

Encounter image QA checks:

- text artifact rejection
- expression readability when the prompt asks for emotional acting
- body-language clarity when the prompt asks for gesture/posture intent
- visual-storytelling clarity for setup, outcome, and aftermath readability

### Encounter Slot Manifests

The encounter image coverage system uses dedicated slot manifests:

- `src/ai-agents/encounters/encounterSlotManifest.ts` — `buildEncounterSlotManifest`, `collectMissingSlotsFromManifest`, tree depth constants
- `src/ai-agents/encounters/storyletSlotManifest.ts` — `buildStoryletSlotManifest`, `collectMissingStoryletSlotsFromManifest`
- `src/ai-agents/encounters/encounterProviderPolicy.ts` — `EncounterProviderPolicy` for provider selection/health for encounter images

### Runtime Guarantees

- setup images are counted against every runtime encounter beat
- nested `nextSituation` nodes are checked recursively for `situationImage`
- choice outcomes are checked recursively for `outcomeImage`
- storylet aftermath beats are checked for `beat.image`
- if encounter image generation fails, the pipeline can fail fast instead of quietly assembling an encounter with empty image fields

If encounter image text-artifact retries are needed, the retry path strengthens only the generation instruction and negatives. It does not mutate the canonical story-facing `visualNarrative` and `composition` fields.

## Completeness And Wiring

Encounter image generation has three distinct responsibilities:

1. Generate setup/outcome/storylet image URLs from the authored encounter tree.
2. Wire those URLs back into the converted runtime encounter.
3. Reject outputs that still have missing runtime encounter image fields after retries/fallbacks.

The shared traversal helper is `src/ai-agents/utils/encounterImageCoverage.ts`.

This exists because the authored encounter structure and the runtime encounter shape differ:

- authored structure: encounter beats may appear as a flat authoring list
- runtime structure: encounter beats are played from `phases[].beats`

Without a shared traversal helper, generation and reporting can disagree about whether encounter images exist.

### Story-Level Image Coverage

Story-level image coverage uses:

- `src/ai-agents/images/storyImageSlotManifest.ts` — builds scene/beat coverage keys and manifests
- `src/ai-agents/images/coverageValidator.ts` — `validateRegistryCoverage` checks slot completeness
- `src/ai-agents/images/storyAssetAssembler.ts` — `assembleStoryAssetsFromRegistry` wires asset URLs into final story JSON

## Video Pipeline

A video generation pipeline is available via `VideoDirectorAgent`:

- `src/ai-agents/agents/image-team/VideoDirectorAgent.ts` — video direction for Veo pipeline (`execute`, `generateVideoDirection`, `generateBatchDirections`)
- `src/ai-agents/services/videoGenerationService.ts` — `VideoGenerationService` with config for Veo models
- `src/stores/videoJobStore.ts` — Zustand store for video generation job queue/status

Video settings are configured via `VideoSettingsConfig` and `DEFAULT_VIDEO_SETTINGS` in `src/ai-agents/config.ts`, supporting Veo-oriented models with duration, resolution, aspect ratio, strategy, and concurrency options.

## Provider Notes

### Gemini / `nano-banana`

Best for multi-reference character consistency and sequence continuity.

Runtime features in use:

- canonical art-style override
- style-reference image injection
- previous-scene image injection
- reference-sheet style anchor
- optional chat mode for within-scene continuity
- optional edit mode for shot-to-shot continuity
- individual character views for stronger identity lock
- provider-aware resolution and thinking settings

Recommended:

- use chat mode for same-scene multi-beat runs
- use edit mode for small continuity-preserving transitions
- keep references curated and limited rather than dumping every possible image

### Atlas Cloud / Seedream

Best for strong native reference-image workflows and sequential edit variants.

Runtime features in use:

- automatic routing to `/edit`, `/sequential`, and `/edit-sequential`
- reference-image submission
- style-bible and previous-scene references folded into the reference set
- concise provider-specific prompt shaping

### Midjourney via UseAPI / MidAPI

Runtime provider name is normalized so UI/provider config reaches the Midjourney path consistently.

Runtime features in use:

- `--sref`
- `--stylize`
- `--v`
- aspect-ratio mapping
- speed mode flags
- Midjourney-specific prompt assembly instead of reusing Gemini-style prose verbatim

Notes:

- local character refs still cannot be passed as native Midjourney reference URLs in this path
- identity is therefore reinforced through reference-sheet generation, textual identity anchors, and `--sref`

### `dall-e` / `stable-diffusion`

These remain placeholder providers in the current runtime and should not be treated as production-ready image backends.

## PartialVictory Cost Visuals

`partialVictory` art carries a structured `EncounterCost` payload from encounter authoring into runtime prompt assembly.

- `EncounterArchitect` preserves a machine-readable cost and copies its visible complication into partial-victory visual contracts.
- `EncounterImageAgent` adds a costly-success rule to prompts so the image must show the achieved objective and the visible price in the same frame.
- `FullStoryPipeline` passes that cost into both terminal outcome images and storylet aftermath images, and rejects prompts that flatten partial victory into clean triumph.

## Files To Know

### Image Team Agents

| File | Role |
|---|---|
| `src/ai-agents/agents/image-team/ImageAgentTeam.ts` | Orchestrator for all image generation and QA |
| `src/ai-agents/agents/image-team/EncounterImageAgent.ts` | Cinematic encounter image prompts |
| `src/ai-agents/agents/image-team/StoryboardAgent.ts` | Shot rhythm and visual planning |
| `src/ai-agents/agents/image-team/VisualIllustratorAgent.ts` | Beat illustration prompts |
| `src/ai-agents/agents/image-team/ColorScriptAgent.ts` | Color script and thumbnails |
| `src/ai-agents/agents/image-team/CharacterReferenceSheetAgent.ts` | Character references, expressions, body vocabulary |
| `src/ai-agents/agents/image-team/VideoDirectorAgent.ts` | Video direction for Veo pipeline |
| `src/ai-agents/agents/image-team/ConsistencyScorerAgent.ts` | Image/reference consistency scoring |
| `src/ai-agents/agents/image-team/DramaExtractionAgent.ts` | Dramatic structure extraction for images |

### Image QA Validators

| File | Role |
|---|---|
| `src/ai-agents/agents/image-team/CompositionValidatorAgent.ts` | Composition validation |
| `src/ai-agents/agents/image-team/TransitionValidator.ts` | Beat-to-beat transition validation |
| `src/ai-agents/agents/image-team/PoseDiversityValidator.ts` | Shot diversity |
| `src/ai-agents/agents/image-team/ExpressionValidator.ts` | Expression/pacing validation |
| `src/ai-agents/agents/image-team/BodyLanguageValidator.ts` | Body language QA |
| `src/ai-agents/agents/image-team/LightingColorValidator.ts` | Lighting/color QA |
| `src/ai-agents/agents/image-team/VisualNarrativeValidator.ts` | Eisner-style narrative validation |
| `src/ai-agents/agents/image-team/VisualStorytellingValidator.ts` | Broad visual storytelling QA |
| `src/ai-agents/agents/image-team/AssetAuditorAgent.ts` | Asset audit reports |

### Visual Systems (Non-Agent)

| File | Role |
|---|---|
| `src/ai-agents/agents/image-team/CinematicBeatAnalyzer.ts` | Heuristic beat type detection and cinematic analysis |
| `src/ai-agents/agents/image-team/VisualNarrativeSystem.ts` | Narrative rules, rhythm, storytelling tests |
| `src/ai-agents/agents/image-team/VisualStorytellingSystem.ts` | Camera/texture/composition vocabulary |
| `src/ai-agents/agents/image-team/LightingColorSystem.ts` | Lighting/color types and emotion maps |
| `src/ai-agents/agents/image-team/CharacterActionLibrary.ts` | Movement profiles and body language |

### Image Infrastructure

| File | Role |
|---|---|
| `src/ai-agents/services/imageGenerationService.ts` | Provider routing, prompt persistence, URL generation |
| `src/ai-agents/images/beatPromptBuilder.ts` | Beat image prompt construction |
| `src/ai-agents/images/promptComposer.ts` | Prompt composition and budgeting |
| `src/ai-agents/images/shotSequencePlanner.ts` | Shot sequence planning |
| `src/ai-agents/images/assetRegistry.ts` | Generated asset tracking |
| `src/ai-agents/images/slotTypes.ts` | Image slot types and families |
| `src/ai-agents/images/storyImageSlotManifest.ts` | Story-level coverage manifests |
| `src/ai-agents/images/storyAssetAssembler.ts` | Asset URL assembly into story data |
| `src/ai-agents/images/referencePackBuilder.ts` | Reference image pack building |
| `src/ai-agents/images/coverageValidator.ts` | Registry coverage validation |
| `src/ai-agents/images/visualValidation.ts` | Tier-1/tier-2 validation and regen targeting |
| `src/ai-agents/images/providerPolicy.ts` | Provider health state |

### Encounter Image Infrastructure

| File | Role |
|---|---|
| `src/ai-agents/utils/encounterImageCoverage.ts` | Shared runtime encounter image traversal |
| `src/ai-agents/encounters/encounterSlotManifest.ts` | Encounter beat image slot manifests |
| `src/ai-agents/encounters/storyletSlotManifest.ts` | Storylet image slot manifests |
| `src/ai-agents/encounters/encounterProviderPolicy.ts` | Encounter-specific provider policy |

### Pipeline and Prompts

| File | Role |
|---|---|
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Main pipeline orchestration |
| `src/ai-agents/agents/EncounterArchitect.ts` | Authors encounter visual contracts |
| `src/ai-agents/prompts/visualPrinciples.ts` | Visual and camera rules |
| `src/ai-agents/utils/styleAdaptation.ts` | Art style adaptation |
| `src/ai-agents/utils/imageResizer.ts` | Base64 downsample, face crop, batch |