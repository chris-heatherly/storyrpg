# Image Pipeline Audit

This document catalogs every rule, constraint, and aesthetic preference the image pipeline currently enforces. It identifies what pushes all stories toward a uniform visual language, proposes approaches for story-specific art styles, and outlines strategies for faster generation.

---

## Table of Contents

1. [Current Rules Inventory](#1-current-rules-inventory)
2. [What Creates the Uniform Look](#2-what-creates-the-uniform-look)
3. [Proposals for Story-Specific Art Styles](#3-proposals-for-story-specific-art-styles)
4. [Generation Speed: Bottlenecks and Acceleration](#4-generation-speed-bottlenecks-and-acceleration)

---

## 1. Current Rules Inventory

Every constraint enforced on image generation, organized by the layer that enforces it.

### 1.1 Hardcoded Art Style Default

When no art style is specified, every agent falls back to the same string:

- `VisualIllustratorAgent`: `"dramatic cinematic story art"` (line 242)
- `beatPromptBuilder`: `"dramatic cinematic story art"` (line 174)
- `ImageGenerationService.DEFAULT_ART_STYLE`: `"dramatic cinematic story art"`
- `resolveArtStyle()` resolution order: `canonicalArtStyle` > `prompt.style` > default

**Source**: `src/ai-agents/services/imageGenerationService.ts`, `src/ai-agents/agents/image-team/VisualIllustratorAgent.ts`, `src/ai-agents/images/beatPromptBuilder.ts`

### 1.2 Mobile Composition Framework

Every image is constrained to a specific spatial layout:

- **Canvas**: 9:19.5 full-bleed (taller than standard mobile)
- **Safe zone**: 9:16 ratio, centered vertically
- **Critical content zone**: Upper 2/3 of the 9:16 area — all faces, key objects, focal action must be here
- **UI overlay zone**: Lower 1/3 of 9:16 — ground plane, shadows, feet, ambient details only
- **Atmospheric extension**: Outside the 9:16 box — sky, blur, textures, nothing essential

**Source**: `MOBILE_COMPOSITION_FRAMEWORK` in `src/ai-agents/prompts/visualPrinciples.ts`

### 1.3 Visual Storytelling Principles (Compact)

Injected into every narrative image prompt via `buildNarrativePrompt()`:

1. Every image is a story beat — show action, emotion, relationship, not a portrait
2. Focal point at rule-of-thirds intersection, never dead center
3. Clear foreground-midground-background depth; environment participates
4. Lighting serves mood: warm = safety/intimacy, cool = isolation/danger, high contrast = conflict
5. Faces and hands carry the emotion and deserve the most detail; expressions must read at thumbnail size
6. Narrative-critical content in the upper 2/3 of the frame
7. Body language is asymmetric between characters
8. Capture the frozen moment of change — mid-reach, mid-recoil, mid-turn

**Source**: `STORY_BEAT_VISUAL_PRINCIPLES_COMPACT` in `src/ai-agents/prompts/visualPrinciples.ts`

### 1.4 The Forbidden Defaults (15 Rules)

Baked into prompts via `FORBIDDEN_DEFAULTS`:

1. Never show only one character when multiple are interacting
2. Never reduce a scene to a character portrait
3. Never dead-center facing camera without reason
4. Never eye-level for 3+ consecutive images
5. Never repeat shot type in consecutive images
6. Never neutral symmetrical standing pose for emotional beats
7. Never critical content in lower third of 9:16
8. Never Dutch angle without justification
9. Never lose character's face in shadow during emotional peaks (exception: deliberate dramatic peaks)
10. Never ECU for mundane moments
11. Never flatten depth — always maintain foreground/background
12. Never include unwanted text, words, AI signatures, or watermarks
13. Never forget: every image is a story beat, not a portrait
14. Never repeat the same staging or pose in consecutive images
15. Never show characters in passive, observational poses when the beat involves action or confrontation

**Source**: `FORBIDDEN_DEFAULTS` in `src/ai-agents/prompts/visualPrinciples.ts`

### 1.5 Dramatic Staging Defaults

When `beatType` is known, `BEAT_STAGING_MAP` provides beat-specific direction (confrontation, revelation, intimacy, action, transition). When beatType is unknown, a generic dramatic staging paragraph is injected:

> "This is a moment of real human drama, not a posed portrait. At least one character must be mid-action — shifting weight, turning, reaching, recoiling, or gesturing. Hands must be doing something specific: gripping an object, pressing against a surface, pulling back, fidgeting, or clenching. If two characters are present, their body language must be ASYMMETRIC..."

This fires on every prompt where `beatType` is missing.

**Source**: `buildNarrativePrompt()` in `src/ai-agents/services/imageGenerationService.ts` (lines 2677-2691)

### 1.6 Consolidated Negative Prompts

Every image prompt ends with a massive `Avoid:` block combining five categories:


| Category              | Examples                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anti-stiffness**    | stiff pose, symmetrical stance, mannequin, T-pose, arms at sides, standing straight, passport photo, character sheet, flat lighting, mirrored poses, static tableau |
| **Narrative failure** | character looking at camera, posed group photo, blank expression, decorative background unrelated to story, generic reaction shot, corporate portrait style         |
| **Anti-text**         | text overlay, caption text, speech bubbles, watermarks, signatures, sound effect text, character name labels                                                        |
| **Anti-composite**    | triptych, diptych, collage, montage, picture-in-picture, comic panels, manga panels, split-screen, grid layout, storyboard cells                                    |
| **Anti-duplication**  | duplicate character, same character twice, cloned character, character appearing multiple times                                                                     |


These are appended unconditionally to every image prompt regardless of art style.

**Source**: `buildNarrativePrompt()` in `src/ai-agents/services/imageGenerationService.ts` (lines 2742-2767)

### 1.7 VisualIllustratorAgent System Prompt

The LLM that generates `ImagePrompt` JSON is instructed with:

- **GOLDEN RULE**: Illustrate the story beat, not a portrait
- **One beat, one image**: Each image captures exactly one dramatic moment
- **Character staging**: Foreground vs. background character classification with strict appearance rules
- **Character appearance consistency**: Canonical physical description enforced, never invent attributes
- **Multi-character foreground**: All foreground characters must appear, with spatial and relational dynamics
- **Character scale**: Real heights enforced, no symbolic size distortion for power dynamics
- **Pose principles** (compact): S-curve/C-curve spine, asymmetric stance, weight distribution, silhouette readability
- **Transition continuity**: moment-to-moment, action-to-action, subject-to-subject, scene-to-scene, aspect-to-aspect rules
- **Single unified image**: No composites, triptychs, or multi-panel layouts
- **No text in images**: Negative prompts must always include text-related terms
- **Character duplication prevention**: Each character appears exactly once
- **Output JSON structure**: prompt, negativePrompt, style, aspectRatio, composition, cameraAngle, poseSpec, keyExpression, keyGesture, keyBodyLanguage, shotDescription, emotionalCore, visualNarrative

**Source**: `VisualIllustratorAgent.getAgentSpecificPrompt()` in `src/ai-agents/agents/image-team/VisualIllustratorAgent.ts`

### 1.8 Prompt Assembly Order (Gemini)

The final multimodal request to Gemini is assembled in this order:

1. `Art style (MANDATORY): <style>` — text part
2. Narrative prompt from `buildNarrativePrompt()` — text part, which itself contains:
  - Art style (again, as first section)
  - Setting adaptation notes
  - `STORY_BEAT_VISUAL_PRINCIPLES_COMPACT`
  - Character acting micro-directions (keyExpression, keyGesture, keyBodyLanguage)
  - Dramatic staging (beat-specific or generic)
  - Visual narrative / emotional core
  - Core scene description
  - Shot description and composition
  - Character scale rule
  - Style reminder (third mention of art style)
  - Single-scene + no-text directive
  - Full consolidated negative prompt block
3. Character reference images — inline data with identity labels
4. Style consistency reference image — episode style bible
5. Previous scene image — for scene-to-scene continuity
6. Consistency instruction block — per-character identity anchors, visual anchor traits, composite sheet warnings

**Source**: `src/ai-agents/services/imageGenerationService.ts` (lines 2260-2389)

### 1.9 Style Consistency Stack

Four layers ensure visual coherence across an episode:

1. **Canonical art style text** — `canonicalArtStyle` overrides LLM-generated style to prevent synonym drift
2. **Episode style bible** — abstract color strip + character-in-style anchor image, passed to every Gemini call as an inline reference
3. **Previous scene continuity** — previous scene's image passed as reference
4. **Color script constraints** — `ColorScriptAgent` generates an upfront lighting/color arc for the episode

**Source**: `FullStoryPipeline.generateEpisodeStyleBible()`, `FullStoryPipeline.generateEpisodeColorScript()`, `ImageGenerationService` style reference injection

### 1.10 `ensureVisualPromptStrength`

A post-processing step on every `ImagePrompt` before it reaches the API. It:

- Injects action verbs if prompt is too static
- Strips "abstract" visual narratives
- Derives missing `keyExpression` / `keyBodyLanguage` from other fields
- Breaks stiff pose patterns
- Synthesizes composition from `beatType`
- Strips non-diegetic magical/supernatural language for non-fantasy genres

**Source**: `ensureVisualPromptStrength()` in `src/ai-agents/services/imageGenerationService.ts`

### 1.11 QA Validators (8 Total)

After generation, images pass through a validation chain in `ImageAgentTeam`:


| Validator                     | What It Checks                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `CompositionValidatorAgent`   | Framing, focal point, depth, mobile zone compliance                                   |
| `ConsistencyScorerAgent`      | Character identity match vs. reference sheets (face, hair, marks, clothing, physique) |
| `PoseDiversityValidator`      | No repeated shot types, angles, poses, or staging across the sequence                 |
| `TransitionValidator`         | Visual continuity between consecutive images                                          |
| `ExpressionValidator`         | Facial expressions match the beat's emotional intent                                  |
| `BodyLanguageValidator`       | Body language matches action and relationships                                        |
| `LightingColorValidator`      | Lighting/color matches mood and color script                                          |
| `VisualStorytellingValidator` | Overall narrative clarity — Eisner-style visual storytelling                          |


Failed validation triggers regeneration loops (up to 3 attempts for diversity, up to 2 for full QA).

**Source**: `src/ai-agents/agents/image-team/ImageAgentTeam.ts`, individual validator files in `src/ai-agents/agents/image-team/`

### 1.12 Additional Enforced Rules

- **Character reference sheets** generated per major character (multi-angle composites) for identity locking
- **Style adaptation** via `selectStyleAdaptation()` — parses conditional art style strings and appends setting-specific notes (e.g., "For Modern Real World:" branches)
- **Text artifact validation** — post-generation vision check for unwanted text in images, triggers regen
- **Selective beat strategy** — `'selective'` mode (default) only illustrates starting beats, choice points, last beats, climax/key/payoff beats, and every 3rd beat
- **Asset audit** — `AssetAuditorAgent` checks for missing scene/beat/cover assets

---

## 2. What Creates the Uniform Look

### 2.1 The Default Style Dominates

`"dramatic cinematic story art"` is the fallback across the entire pipeline. When a user doesn't specify a style (or specifies something vague), this string shapes every image. It biases the model toward a single aesthetic: moody, high-contrast, cinematic.

### 2.2 Style Signal Is Drowned by Rules

Even when a custom art style is provided, the prompt that reaches Gemini is ~2000+ tokens. The art style string appears three times (MANDATORY, within narrative prompt, REMINDER), but it's surrounded by hundreds of tokens of generic cinematic direction: dramatic staging paragraphs, asymmetric body language rules, "frozen moment of change" framing, lighting-serves-mood directives, and a massive negative prompt block. These rules implicitly define a visual language that overrides whatever style the user requested.

A watercolor fairy tale, a noir detective comic, and a pixel-art dungeon crawler all receive the same:

- "high contrast for conflict" lighting rules
- "frozen moment of change — mid-reach, mid-recoil, mid-turn" framing
- "body language must be ASYMMETRIC" character direction
- Identical negative prompt blocks biased against "flat lighting" and "symmetrical" composition

These are appropriate for dramatic cinematic art but wrong for many other styles.

### 2.3 Style Bible Is Too Abstract

The episode style bible generates an abstract color strip (no characters, no people) plus a single character-in-style anchor. This is thin — it doesn't carry enough genre-specific DNA to differentiate a gritty crime drama from a whimsical fantasy. It's a color palette hint, not a comprehensive visual identity.

### 2.4 QA Validators Score Against One Baseline

All eight validators evaluate against implicit "dramatic cinematic" criteria. A deliberately flat-lit minimalist illustration would be flagged for "flat lighting." A symmetrically composed Art Deco piece would be flagged for "symmetrical pose." A watercolor with soft edges would score poorly on "expression readable at thumbnail size." The validators don't know what good looks like for the requested style.

### 2.5 canonicalArtStyle Is a Single Flat String

The anti-drift mechanism (`canonicalArtStyle`) ensures the style string doesn't mutate across the episode, which is good. But it's a single string applied uniformly — there's no structured breakdown of what the style means in terms of rendering technique, color philosophy, line weight, or acceptable compositional patterns. The LLM and image model must guess what "gothic ink wash" means for lighting, composition, and body language.

### 2.6 Setting Adaptation Adds Notes But Doesn't Change the Skeleton

`selectStyleAdaptation()` appends setting-specific notes (e.g., "For modern real world: reduce fantasy elements"), but the core prompt skeleton — visual principles, staging defaults, negative prompts — remains identical regardless of setting or genre.

---

## 3. Proposals for Story-Specific Art Styles

### 3.1 Art Style Profiles (Replace Flat String)

Replace the single `artStyle` string with a structured `ArtStyleProfile`:

```typescript
interface ArtStyleProfile {
  name: string;                    // "gothic ink wash", "studio ghibli watercolor"
  renderingTechnique: string;      // "heavy ink lines with wash shading", "soft cel shading"
  colorPhilosophy: string;         // "desaturated with red accents", "vibrant pastels"
  lightingApproach: string;        // "high-contrast chiaroscuro", "soft ambient, minimal shadows"
  lineWeight: string;              // "thick expressive outlines", "no outlines, painterly edges"
  compositionStyle: string;        // "dramatic diagonals", "centered symmetry is acceptable"
  moodRange: string;               // "dark and oppressive", "warm and hopeful"
  acceptableDeviations: string[];  // rules from the default set that this style overrides
  genreNegatives: string[];        // style-specific negative prompts
}
```

This profile would be generated once by the WorldBuilder or a new StyleArchitect agent at story creation time, then locked for the episode. The pipeline would use the profile fields to modulate prompt construction rather than blindly applying the same rules.

### 3.2 Conditional Prompt Skeleton

Make `STORY_BEAT_VISUAL_PRINCIPLES_COMPACT` and the staging defaults swappable based on the style profile:

- **Dramatic cinematic**: current rules (high contrast, asymmetry, frozen moment of change)
- **Watercolor / storybook**: softer framing language, symmetry acceptable, "gentle transition" instead of "frozen moment", warmth-biased lighting
- **Noir / crime**: keep high contrast but add shadow-dominant language, desaturated palette directives, Dutch angle encouragement
- **Manga / anime**: different body language vocabulary (sweat drops, speed lines acceptable), allow more frontal compositions
- **Pixel art / retro**: different spatial rules entirely, simpler composition language, less emphasis on facial microexpressions
- **Minimalist / art house**: allow flat lighting, centered composition, symbolic staging

The compact principles would become a function that selects the appropriate rule set based on the profile.

### 3.3 Style-Aware QA Validators

Teach validators what "good" means for the current style:

- `LightingColorValidator` should accept flat lighting for minimalist styles
- `CompositionValidator` should accept centered symmetry for Art Deco or storybook styles
- `PoseDiversityValidator` should have style-appropriate pose vocabularies
- `ExpressionValidator` should calibrate expectations (watercolor faces don't need thumbnail-readable microexpressions)

Pass the `ArtStyleProfile` to each validator so it can adjust its scoring thresholds and criteria.

### 3.4 Expanded Location References

The pipeline already generates a single master shot per major location and passes it as a reference when the ref budget allows. This is insufficient — environments drift across scenes set in the same place. Proposed improvements:

**a) Generate refs for all recurring locations, not just "major" ones.**
Currently `runMasterImageGeneration` filters on `briefLoc?.importance === 'major'`. Any location that appears in 2+ scenes should get a reference, regardless of importance tag. The cost is one extra image per minor recurring location during the upfront master phase. Only generate location refs if the active image provider supports multi-image reference input — do not spend generation time on refs that cannot be consumed (see Section 4.4).

**b) Give location refs a dedicated budget slot.**
Location master shots are appended to the reference array after all character refs. In multi-character scenes, they get squeezed out by `MAX_TOTAL_REFS`. Location refs should have a reserved slot (e.g., always room for 1 location ref) so they aren't crowded out by character references. This ensures environment consistency even in character-heavy scenes. The reserved slot still counts against the provider's max reference limit — it just guarantees the location isn't the first thing dropped.

**c) Improve scene-to-location matching.**
The current lookup is an exact match on `locationId`. If a scene describes "the tavern's back room" but the world bible location is "The Brass Lantern Tavern", the master shot isn't found. Add fuzzy matching: check if the scene's setting description contains the location name or vice versa, fall back to the parent location when a sub-location is described, and use the `resolveWorldLocationForScene` output (which already exists) to drive the lookup.

### 3.5 Richer Style Bible

Expand the style bible from one abstract strip + one character anchor to:

- **Character in environment** — establishes how characters relate to backgrounds in this style
- **Mood lighting sample** — the style's lighting language demonstrated
- **Color palette swatch** — explicit palette, not just implied by an abstract strip
- **Action moment sample** — how this style renders dynamic action (very different for watercolor vs. cel shading)
- **Quiet moment sample** — how this style handles calm/intimate scenes

More reference images give Gemini a stronger visual anchor for the intended aesthetic.

### 3.6 Per-Genre Negative Prompts

Replace the universal negative prompt block with style-aware negatives:


| Style      | Remove from negatives                    | Add to negatives                                          |
| ---------- | ---------------------------------------- | --------------------------------------------------------- |
| Watercolor | "flat lighting"                          | "photorealistic rendering, sharp edges, digital gradient" |
| Noir       | "high contrast" (it's desired)           | "bright colors, warm palette, soft lighting"              |
| Manga      | "symmetrical pose" (acceptable in genre) | "western comic style, oil painting texture"               |
| Pixel art  | "flat lighting", "centered composition"  | "anti-aliasing, photorealism, gradient shading"           |


### 3.7 Style-Aware Prompt Strength

`ensureVisualPromptStrength` currently strips supernatural language from non-fantasy genres. Extend this to be bidirectional — also inject style-appropriate language and remove style-inappropriate language:

- For watercolor: strip "sharp contrast", inject "soft edges, diffused light"
- For noir: strip "warm for safety", inject "shadows dominate, light sources visible"
- For pixel art: strip "expressions must read at thumbnail size", adjust composition language

---

## 4. Generation Speed: Bottlenecks and Acceleration

### 4.1 Current Bottlenecks

#### Global Rate Limiting (3-second gap)

A single `lastRequestTime` + 3-second minimum interval serializes all image requests through one service instance, regardless of provider. Even if Gemini could handle 60 RPM, the service enforces ~20 RPM globally.

**Source**: `minRequestInterval = 3000` in `imageGenerationService.ts` (line 206)

#### Low Concurrency Cap

Hard limit of 3 concurrent image requests across the entire pipeline.

**Source**: `_concurrencyLimit = 3` in `imageGenerationService.ts` (line 225)

#### Sequential Scene Processing

Within an episode, scenes are processed in a `for` loop — each scene fully completes (storyboard + illustrate + validate) before the next begins.

**Source**: `runEpisodeImageGeneration()` in `FullStoryPipeline.ts`

#### LLM Overhead Per Image

Every beat image goes through: StoryboardAgent (LLM call) -> VisualIllustratorAgent (LLM call) -> `ensureVisualPromptStrength` (CPU) -> `buildNarrativePrompt` (CPU) -> Gemini image API. The two LLM calls per image often dominate wall time over the image generation itself.

#### Aggressive Retry Configuration

- 5 retries with exponential backoff (5s base, 2x multiplier)
- A single image can take 5s + 10s + 20s + 40s + 80s = 155 seconds of retry delay alone
- Text-instead-of-image errors retry at a flat 5s delay

**Source**: `maxRetries = 5`, `retryDelayMs = 5000`, `retryBackoffMultiplier = 2` in `imageGenerationService.ts`

#### QA Validation + Regeneration Loops

Each scene can trigger up to 3 rounds of pose diversity regeneration, then up to 2 rounds of full QA regeneration. Each regeneration round generates new images (with the same overhead) and re-runs validation.

**Source**: `generateSceneVisualsWithDiversityCheck()` and full QA loop in `ImageAgentTeam.ts`

#### Reference Image Payload Overhead

Every Gemini request includes inline base64 reference images (character sheets, style bible, previous scene). For a scene with 3 characters, that's potentially 5+ images as base64 data in each request. Atlas has a 10MB upload threshold that triggers pre-upload calls.

#### Resolution

Default 1K for scenes, 2K for covers/references. Higher resolution = slower generation.

### 4.2 Accepted Acceleration Proposals

#### Per-Provider Rate Limiting

Replace the single global `lastRequestTime` with per-provider tracking. Gemini, Atlas, and Midjourney have different rate limits and shouldn't block each other. Each provider gets its own `lastRequestTime` and `minRequestInterval` tuned to that provider's actual RPM limit.

**Impact**: Moderate. Mainly helps when using multiple providers.

#### Raise Concurrency for Capable Providers

Gemini supports higher than 3 concurrent requests. Make `_concurrencyLimit` configurable per provider, defaulting to 3 for unknown providers but allowing 5-8 for Gemini.

**Impact**: Significant. More images generating in parallel means better throughput.

#### Parallel Scene Image Generation

Scenes within an episode that don't share continuity references (e.g., branching paths) can be processed in parallel. Even sequential scenes could overlap: start Scene N's storyboard while Scene N-1's images are still generating. Pass the previous scene's continuity reference forward as soon as it's available rather than waiting for the entire scene to complete.

**Impact**: Significant. Transforms a serial bottleneck into parallel work.

#### Pre-Upload Reference Images

Upload character reference sheets and style bible to a temporary URL once per episode, then pass URLs instead of inline base64 in every request. Only applies to providers that support URL-based references (Atlas). For providers that require inline data (Gemini), keep the current approach. Do not generate or upload references that the active provider cannot consume.

**Impact**: Moderate. Reduces upload time and bandwidth per request, especially for multi-character scenes on Atlas.

#### Batch API Where Supported

Atlas Seedream already supports `generateImageBatch`. Extend batching to scene beat images where the provider supports it, reducing round-trip overhead. Not applicable to Gemini's current API — only use batch paths for providers that have batch endpoints.

**Impact**: Moderate for Atlas users.

#### Reduce Retry Aggressiveness

Cap backoff at 20s instead of allowing it to reach 80s. For text-instead-of-image errors (which are prompt problems, not transient failures), try 2 retries instead of 5.

**Impact**: Moderate. Prevents a single bad prompt from blocking the queue for 2+ minutes.

### 4.3 Rejected Proposals


| Proposal                            | Reason                                                       |
| ----------------------------------- | ------------------------------------------------------------ |
| Fast path for non-hero beats        | Quality risk too high — all beats deserve full LLM prompting |
| Tiered QA                           | All beats should receive full validation                     |
| Lower resolution for non-hero beats | Visible quality difference unacceptable                      |


### 4.4 Reference Generation: Provider-Aware Policy

Reference images (character sheets, location masters, style bibles) should only be generated to the extent the active provider can use them. Key rules:

- **Do not generate references that the provider cannot consume.** If the provider has no multi-image reference support, skip reference sheet generation entirely rather than wasting generation time on unused assets.
- **Respect per-provider reference limits.** Atlas Nano Banana supports up to 14 refs, Atlas Seedream up to 10, Gemini Pro up to 10. Do not build reference packs that exceed what the provider will accept.
- **Match reference format to provider expectations.** Gemini uses inline base64; Atlas can use uploaded URLs above 10MB; Midjourney uses `--sref` codes and text-based identity, not image refs. Tailor the reference strategy to each provider rather than building a universal pack and discarding what doesn't fit.
- **Location master shots** follow the same rule: only generate them if the provider supports environment reference images. For text-only providers (Midjourney), invest that generation budget elsewhere.

### 4.5 Speed vs. Quality Summary


| Change                       | Speed Gain  | Quality Risk                                 | Status                    |
| ---------------------------- | ----------- | -------------------------------------------- | ------------------------- |
| Per-provider rate limits     | Moderate    | None                                         | Accepted                  |
| Higher concurrency           | Significant | None                                         | Accepted                  |
| Parallel scenes              | Significant | Slight (mitigated by continuity ref passing) | Accepted                  |
| Pre-upload references        | Moderate    | None (provider-aware)                        | Accepted                  |
| Batch API                    | Moderate    | None                                         | Accepted, where supported |
| Reduce retry backoff         | Moderate    | Slight (fewer recovery chances)              | Accepted                  |
| Fast path for non-hero beats | High        | Moderate                                     | Rejected                  |
| Tiered QA                    | High        | Moderate                                     | Rejected                  |
| Lower resolution non-hero    | Moderate    | Visible                                      | Rejected                  |


---

## File Reference


| File                                                              | Role in Image Pipeline                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/ai-agents/prompts/visualPrinciples.ts`                       | All hardcoded visual rules and principles                              |
| `src/ai-agents/services/imageGenerationService.ts`                | Prompt assembly, rate limiting, concurrency, retries, provider routing |
| `src/ai-agents/agents/image-team/VisualIllustratorAgent.ts`       | LLM prompt for generating ImagePrompt JSON                             |
| `src/ai-agents/agents/image-team/ImageAgentTeam.ts`               | QA validation orchestration, regeneration loops                        |
| `src/ai-agents/agents/image-team/StoryboardAgent.ts`              | Visual contract, shot planning, sequence grammar                       |
| `src/ai-agents/agents/image-team/ColorScriptAgent.ts`             | Episode color/lighting arc                                             |
| `src/ai-agents/agents/image-team/CharacterReferenceSheetAgent.ts` | Character identity reference generation                                |
| `src/ai-agents/agents/image-team/CompositionValidatorAgent.ts`    | Framing and composition QA                                             |
| `src/ai-agents/agents/image-team/ConsistencyScorerAgent.ts`       | Character identity consistency QA                                      |
| `src/ai-agents/agents/image-team/PoseDiversityValidator.ts`       | Sequence variety QA                                                    |
| `src/ai-agents/agents/image-team/TransitionValidator.ts`          | Scene-to-scene continuity QA                                           |
| `src/ai-agents/agents/image-team/ExpressionValidator.ts`          | Facial expression QA                                                   |
| `src/ai-agents/agents/image-team/BodyLanguageValidator.ts`        | Body language QA                                                       |
| `src/ai-agents/agents/image-team/LightingColorValidator.ts`       | Lighting and color QA                                                  |
| `src/ai-agents/agents/image-team/VisualStorytellingValidator.ts`  | Overall narrative clarity QA                                           |
| `src/ai-agents/agents/image-team/AssetAuditorAgent.ts`            | Missing asset detection                                                |
| `src/ai-agents/utils/styleAdaptation.ts`                          | Conditional style branching by setting                                 |
| `src/ai-agents/images/beatPromptBuilder.ts`                       | Deterministic (non-LLM) prompt construction                            |
| `src/ai-agents/config.ts`                                         | GeminiSettings, defaults, concurrency config                           |
| `src/ai-agents/config/buildPipelineConfig.ts`                     | Art style wiring from UI to pipeline                                   |
| `src/ai-agents/pipeline/FullStoryPipeline.ts`                     | Style bible, color script, episode image orchestration                 |


