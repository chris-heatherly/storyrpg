# Image Pipeline Runtime

**Last Updated:** April 2026

This document captures the live runtime behavior of the StoryRPG image pipeline.

## Goals

- Keep character identity stable across scenes and branches.
- Keep style stable across the episode, not just within one prompt.
- Make every image communicate a readable story beat.
- Use model-specific controls when they improve results.
- Enforce encounter image completeness as a pipeline invariant.

## Recent Improvements (April 2026)

The image pipeline has been extended with several foundational and
pillar-specific improvements. All of them are gated behind explicit
configuration so existing stories render identically unless the operator
opts in:

- **B1 / two-axis QA toggles** — `EXPO_PUBLIC_IMAGE_PROMPT_MODE`
  (`deterministic` | `llm` | `compare`) and `EXPO_PUBLIC_IMAGE_QA_MODE`
  (`off` | `fast` | `full`) let prompt-building and QA rigor be tuned
  independently. See `src/ai-agents/config/imageQaConfig.ts`.
- **C1 / ArtStyleProfile** — structured replacement for the flat
  `canonicalArtStyle` string. Captures rendering technique, color
  philosophy, lighting, acceptable deviations, genre negatives, and
  positive vocabulary so prompt building and validators can modulate to
  the active style. Resolved via `resolveArtStyleProfile` and presets in
  `src/ai-agents/config/artStylePresets.ts`.
- **E4 / ProviderCapabilities table** — central table describing whether
  each provider accepts inline vs URL references, supports batches,
  speaks Midjourney ref tokens, etc. Powers A1/A7/A8/A9/D7.
- **A1 / per-provider throttle** — replaces a global rate-limit delay
  with a per-provider concurrency + inter-request spacing controller
  (`src/ai-agents/services/providerThrottle.ts`).
- **A9 / skip refs provider can't consume** — callers no longer pay the
  payload cost for refs the active provider will drop.
- **A11 / inflight dedup** — identical prompts submitted while an earlier
  request is still in flight now share the single result.
- **A6 / tamed retry ladder** — retry cap reduced to 2 and back-off
  capped at 20s for text-class errors.
- **A2 / post-success `rateLimitDelayMs` dropped** — the per-provider
  throttle handles spacing without a blanket post-success sleep.
- **C2 / style-aware negatives** — deterministic prompts now drop
  default negatives that the active style explicitly permits
  (e.g. "centered composition" for a minimalist preset) and merge the
  profile's `genreNegatives` into the final string.
- **C4 / bidirectional style-aware prompt strength** —
  `ensureVisualPromptStrength` in `ImageGenerationService` now skips
  guardrails allowed by the profile, strips inappropriate vocabulary
  from the prompt, and injects the profile's positive vocabulary.
- **C5 / style-aware validators** — `checkStructuralDiversity` and
  `buildTier2VisionPrompt` adapt their rubric when a profile whitelists
  static pose / centered composition so intentional stylistic stasis is
  not flagged as a failure.
- **C6 / style anchor strength knob** — optional per-profile
  `anchorWeight` controls how aggressively the text prompt defers to the
  style-reference image.
- **C7 / preset library** — 6+ curated `ArtStyleProfile` presets
  selectable via `EXPO_PUBLIC_ART_STYLE_PRESET`.
- **B2 / scene-level sequence grammar pass** — after the beat-local
  planner, a scene-wide pass in `shotSequencePlanner` enforces varied
  opening shots in longer scenes, climax-adjacent shot demotion, and
  contrast in 2-beat scenes.
- **B3 / compressed universal prompt skeleton** — shrinks the shared
  negative-prompt floor and single-lines the canonical section headers
  in `promptComposer`. Saves ~60% of the boilerplate tokens per prompt.
- **B5 / choice-payoff visual language** — choice kind (combat /
  diplomacy / stealth / etc.) now emits a concrete visual-language
  clause in the prompt so the rendered beat matches the narrative
  intent.
- **B6 / color-script follow-through per beat** — per-beat color-script
  hints flow into the prompt so palette shifts are honored across the
  sequence rather than only at scene boundaries.
- **B7 / coverage profile knob** — `CoverageProfile` biases the ratio
  of dominant / supporting / rest shots per scene; exposed via config.
- **B8 / CinematicPromptCore** — shared module
  (`src/ai-agents/images/cinematicPromptCore.ts`) hosts the universal
  negative floor, the character/establishing overlays, and
  `composeNegativePrompt` so both the deterministic and LLM paths pull
  from one source of truth.
- **D1 / supporting-character master refs** — characters tagged
  `supporting` are now promoted to master reference sheets (not just
  major/core), preventing identity drift on recurring side cast.
- **D2 / reserved ref-pack slots** — location and style-anchor slots
  are reserved in the reference pack so high-priority anchors can't be
  crowded out by low-priority character refs.
- **D3 / per-character ref pack weight** — character refs now carry a
  weight so the most important face wins when the pack is over budget.
- **D4 / wardrobe & state tracking** — `CharacterVisualState` tracks
  wardrobe, injuries, and held props across a scene and feeds them into
  the prompt's identity block.
- **D5 / anchor regen on identity change** — reference sheets store an
  `identityFingerprint` (FNV-1a hash of the character's identity
  fields). `invalidateStaleReferenceSheets` prunes mismatched sheets at
  the top of the master-images phase.
- **D6 / stable SD seeds per character** — `SeedRegistry` produces
  deterministic seeds per character/scene for Stable Diffusion so a
  retry produces the same face.
- **D7 / Midjourney `--cref` / `--sref`** — when reference images carry
  a pre-uploaded URL (`ReferenceImage.url`) and
  `midjourneySettings.enableCrefSref` is on, the Midjourney prompt
  builder emits native `--cref <url>`, `--sref <url>`, `--cw`, `--sw`
  flags. Falls back cleanly to the existing `--oref`/identity-hint path
  when no URL is available.
- **D8 / identity-drift audit** — `auditIdentityDrift` on
  `ImageAgentTeam` is a non-destructive companion to the D5 invalidator.
  Runs under QA_MODE=fast/full and emits a structured warning listing
  characters whose cached sheet fingerprint no longer matches the
  current profile, so the operator can decide whether to regenerate
  downstream scenes.
- **D9 / group-scene disambiguation** — multi-character beats emit an
  explicit per-character block so the model doesn't conflate
  similarly-built characters.
- **D10 / scoped previous-panel continuity** — the
  previous-panel-continuity reference is now only injected for direct
  continuations, preventing cross-branch bleed.
- **E3 / structured feedback in regen prompts** —
  `regenerate-image.ts` consumes both free-form notes and the
  `imageFeedbackStore`'s structured `reasons` tags to drive directive
  and negative-prompt additions.

All improvements preserve today's default behavior — to opt in, set the
relevant env var / config flag described in each bullet.

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

### Midjourney via useapi.net/midapi

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

### `dall-e`

Remains a placeholder provider in the current runtime and should not be treated as a production-ready image backend.

### `stable-diffusion`

Runs through a swappable adapter so we can target different SD hosts without touching `ImageGenerationService`. Today only the AUTOMATIC1111 / Forge WebUI backend is implemented (`A1111Adapter`); the adapter factory accepts `a1111`, `comfy`, `replicate`, `stability`, and `fal` but throws a clear error for anything except `a1111`.

Runtime features in use:

- text-to-image and image-to-image dispatch (init image is auto-promoted from any reference tagged `purpose: 'img2img-init'` or heuristically from `previous-panel-continuity` refs)
- inline LoRA tags (`<lora:name:weight>`) from both prompt-level LoRAs and the settings-level style / per-character LoRA registry (prompt wins on duplicates, weights clamped to `[-2, 2]`)
- ControlNet stack via the `sd-webui-controlnet` extension (`alwayson_scripts.controlnet.args[]`):
  - depth auto-wired from references tagged `purpose: 'controlnet-depth'` or any environment / scene-master ref when `controlNetModels.depth` is configured
  - canny / reference-only wired the same way from their respective purposes
  - explicit prompt-level `ImagePromptControlNet[]` always take precedence
- IP-Adapter (face identity) wired from references tagged `purpose: 'ip-adapter'`, or any `character-reference-face` ref when `ipAdapterModel` is configured
- deterministic seed registry (`SeedRegistry`) inside `ImageGenerationService` — caller metadata (`sceneId`, `characterName` / `characterId`) hashes into a stable 32-bit seed so the same shot reproduces across runs; `prompt.seed` always overrides
- preflight canary via `GET /sdapi/v1/sd-models` (service branch `preflightImageProvider('stable-diffusion')`)
- optional img2img mask (`purpose: 'inpaint-mask'`) for inpainting flows
- editImage uses the adapter's `edit()` (img2img) path and folds the base image into references with `purpose: 'img2img-init'`

Wiring surface:

- proxy mount: `/sd-api/*` forwards to `STABLE_DIFFUSION_BASE_URL` with optional bearer auth (`x-stable-diffusion-token`)
- env vars: `STABLE_DIFFUSION_BASE_URL`, `STABLE_DIFFUSION_API_KEY`, `STABLE_DIFFUSION_BACKEND`, `STABLE_DIFFUSION_DEFAULT_MODEL`, `EXPO_PUBLIC_SD_ENABLED` (gates the UI segment)
- settings object: `PipelineConfig.imageGen.stableDiffusion` (`StableDiffusionSettings` in `src/ai-agents/config.ts`)
- UI: the GeneratorScreen exposes an `SD` segment plus a Stable Diffusion parameters disclosure (base URL, model, sampler, steps, CFG, negative prompt) when `EXPO_PUBLIC_SD_ENABLED=true`

#### Consistency Feature Matrix (SD)

| Consistency Anchor          | Source                                                        | SD Lever                   |
|-----------------------------|---------------------------------------------------------------|----------------------------|
| Global art style            | `StableDiffusionSettings.styleLoras`                          | Inline `<lora:...>` tag    |
| Per-character identity (LoRA)| `StableDiffusionSettings.characterLoraByName[name]`          | Inline `<lora:...>` tag    |
| Per-character identity (face)| `character-reference-face` ref + `settings.ipAdapterModel`   | IP-Adapter via ControlNet  |
| Environment / layout        | `scene-master-environment` ref + `controlNetModels.depth`     | ControlNet depth           |
| Silhouette / pose           | ref with `purpose: 'controlnet-canny'`                        | ControlNet canny           |
| Previous-panel continuity   | `previous-panel-continuity` ref                               | img2img init image         |
| Deterministic reproducibility| seed registry (scene, character, character-in-scene scopes)  | `seed` parameter           |
| Negative stack              | `StableDiffusionSettings.defaultNegativePrompt` + per-prompt  | `negative_prompt`          |

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