/**
 * AI Agent Configuration
 * Configure your LLM provider and model settings here.
 */

// Polyfill for fs.existsSync to prevent crashes in mobile environments
// where some libraries might expect a Node.js environment.
if (typeof global !== 'undefined') {
  const g = global as any;
  const fsPolyfill = require('../fs-polyfill');
  
  if (!g.fs) {
    g.fs = fsPolyfill;
  } else {
    // Aggressively patch existing fs object
    for (const key in fsPolyfill) {
      if (typeof g.fs[key] !== typeof fsPolyfill[key]) {
        try {
          g.fs[key] = fsPolyfill[key];
        } catch (e) {
          // Ignore read-only property errors
        }
      }
    }
  }
}

import { ValidationConfig } from '../types/validation';
import { CHOICE_DENSITY_DEFAULTS } from '../constants/validation';
import type { ImageQaConfig } from './config/imageQaConfig';
import { resolveImageQaConfig, resolveArtStylePresetProfile } from './config/imageQaConfig';
import type { ArtStyleProfile } from './images/artStyleProfile';

/**
 * One pre-approved style-bible anchor image supplied by the UI's Style
 * Setup flow. Either the inline base64 payload (preferred for immediate
 * handoff to `setGeminiStyleReference`) or an on-disk path that the
 * pipeline can read.
 */
export interface PreapprovedAnchor {
  /** Base64-encoded image bytes (no data-URL prefix). */
  data?: string;
  /** MIME type matching `data` (e.g. `image/png`). */
  mimeType?: string;
  /** Absolute or workspace-relative path to the stored image. */
  imagePath?: string;
}

export type { ImageQaConfig, ImagePromptMode, ImageQaMode } from './config/imageQaConfig';
export { DEFAULT_IMAGE_QA_CONFIG } from './config/imageQaConfig';
export type { ArtStyleProfile } from './images/artStyleProfile';

export interface AgentConfig {
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  /** OpenAI-only hint for reasoning-class models (gpt-5/o-series). */
  openaiReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /** OpenAI-only: force JSON response format for structured agent outputs. */
  openaiForceJsonResponse?: boolean;
}

// Generation settings from UI
export interface GenerationSettingsConfig {
  // Scene structure
  /** Max scenes per episode (cap)—engine may generate fewer */
  maxScenesPerEpisode?: number;
  /** @deprecated Use maxScenesPerEpisode */
  targetSceneCount?: number;
  majorChoiceCount?: number;
  
  // Beat count (caps—engine may use fewer)
  minBeatsPerScene?: number;
  maxBeatsPerScene?: number;
  standardBeatCount?: number;
  bottleneckBeatCount?: number;
  encounterBeatCount?: number;
  
  // Validation thresholds
  blockingThreshold?: number;
  warningThreshold?: number;
  firstChoiceMaxSeconds?: number;
  averageGapMaxSeconds?: number;
  minChoiceDensity?: number;
  
  // Text length limits
  maxSentencesPerBeat?: number;
  maxWordsPerBeat?: number;
  maxChoiceWords?: number;
  maxDialogueWords?: number;
  maxDialogueLines?: number;
  
  // Encounter text limits
  encounterSetupMaxWords?: number;
  encounterOutcomeMaxWords?: number;
  
  // Resolution limits
  resolutionSummaryMaxWords?: number;
  
  // Choice constraints
  minChoices?: number;
  maxChoices?: number;
  
  // Choice type distribution targets (percentages, must sum to 100)
  // Types describe player experience, not structural effect.
  choiceDistExpression?: number;
  choiceDistRelationship?: number;
  choiceDistStrategic?: number;
  choiceDistDilemma?: number;
  
  // Branching cap: max choices per episode that route to different scenes.
  // Branching is a property of any non-expression choice, not a type.
  maxBranchingChoicesPerEpisode?: number;
  
  // Minimum encounters per episode
  minEncountersShort?: number;
  minEncountersMedium?: number;
  minEncountersLong?: number;
  
  // NPC depth validation
  minMajorDimensions?: number;
  
  // Pixar quality threshold
  pixarGoodThreshold?: number;
  
  // Character reference generation
  generateCharacterRefs?: boolean;
  generateExpressionSheets?: boolean;
  generateBodyVocabulary?: boolean;

  // Concurrency and guardrail settings
  episodeParallelismEnabled?: boolean;
  // NOTE: historical `sceneParallelismEnabled` was removed — scene generation
  // is still serial inside a single episode. Topological ordering via the
  // dependency graph is always on. Real wave-based parallelism is deferred
  // to the Phase 5 `ContentGenerationPhase` extraction.
  imageWorkerModeEnabled?: boolean;
  audioWorkerModeEnabled?: boolean;
  shadowSchedulerEnabled?: boolean;
  maxParallelEpisodes?: number;
  maxParallelScenes?: number;
  llmMaxGlobalInFlight?: number;
  llmMaxPerProviderInFlight?: number;
  llmBackoffJitterRatio?: number;
  // Sequential mode preserves previous-episode summary dependency chain.
  episodeDependencyMode?: 'sequential' | 'independent';
  // Optional cloud uplift (kept disabled by default for local-first rollout)
  cloudModeEnabled?: boolean;
  cloudQueueEndpoint?: string;
  /** Pipeline failure handling policy. `fail_fast` stops immediately instead of generating fallback content. */
  failurePolicy?: 'fail_fast' | 'recover';
  /**
   * I5 instrumentation. When true, captures a side-by-side diff of the
   * LLM-driven `BranchManager` output vs the deterministic
   * `analyzeBranchTopology` output and persists it as
   * `06d-branch-shadow-diff.json`. Default off; enable when evaluating
   * whether the LLM branch pass catches issues the deterministic analyzer
   * does not (gates deferred decision D4).
   */
  branchShadowModeEnabled?: boolean;
}

// Video generation settings (Veo via Gemini API)
export interface VideoSettingsConfig {
  enabled?: boolean;
  model?: 'veo-3.1-generate-preview' | 'veo-3.1-fast-generate-preview';
  durationSeconds?: 6 | 8;
  resolution?: '720p' | '1080p';
  aspectRatio?: '9:16' | '16:9';
  /** Reuses image strategy: 'selective' animates only key beats, 'all-beats' animates every beat that has an image */
  strategy?: 'selective' | 'all-beats';
  /** Max concurrent Veo API calls (default 2, Veo is slow so keep low) */
  maxConcurrent?: number;
  /** API key for Veo — defaults to Gemini API key if not set */
  apiKey?: string;
}

export const DEFAULT_VIDEO_SETTINGS: Required<VideoSettingsConfig> = {
  enabled: false,
  model: 'veo-3.1-generate-preview',
  durationSeconds: 8,
  resolution: '720p',
  aspectRatio: '9:16',
  strategy: 'selective',
  maxConcurrent: 2,
  apiKey: '',
};

// Narration/Audio settings from UI
export interface NarrationSettingsConfig {
  enabled?: boolean;
  elevenLabsApiKey?: string;
  autoPlay?: boolean;
  preGenerateAudio?: boolean;
  voiceId?: string;
  highlightMode?: 'none' | 'word' | 'sentence';
}

// Per-character reference mode: controls what traits are extracted from uploaded reference images
export type CharacterReferenceMode = 'face-only' | 'full-appearance';

// Provider-agnostic image reference settings (shared across all providers)
export interface ImageReferenceSettings {
  /** Max reference images to pass per character for scene generation (default 2) */
  maxRefImagesPerCharacter?: number;
}

export type ImageResolution = '512px' | '1K' | '2K' | '4K';
export type ImageProvider = 'nano-banana' | 'atlas-cloud' | 'midapi' | 'useapi' | 'dall-e' | 'stable-diffusion' | 'placeholder';

// Gemini (Nano Banana) specific tuning parameters
export interface GeminiSettings extends ImageReferenceSettings {
  /** Gemini model to use for image generation */
  model?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview';
  /** Include explicit character consistency instruction in prompt (default: true) */
  includeConsistencyInstruction?: boolean;
  /** Pass previous scene image for visual continuity (default: true) */
  includePreviousScene?: boolean;
  /** Pass style reference image for style consistency (default: true) */
  includeStyleReference?: boolean;
  /** Canonical art style string — when set, overrides LLM-generated style to prevent synonym drift */
  canonicalArtStyle?: string;
  /** Enable edit mode: within-scene beats pass previous image for modification instead of fresh generation (experimental, default: false) */
  useEditMode?: boolean;
  /** Enable multi-turn chat mode: each scene uses a chat session so Gemini retains visual context of previous beats (experimental, default: false) */
  useChatMode?: boolean;
  /** Resolution for scene/beat images (default: '1K') */
  sceneResolution?: ImageResolution;
  /** Resolution for character reference sheets (default: '2K') */
  referenceResolution?: ImageResolution;
  /** Resolution for cover art and master location images (default: '2K') */
  coverResolution?: ImageResolution;
  /**
   * @deprecated Character reference generation is provider-strategy driven.
   * Front-only providers generate one clean front view + derived face crop;
   * Midjourney may generate a composite; legacy persisted values are ignored.
   */
  useIndividualCharacterViews?: boolean;
  /**
   * When true (default), the composite model sheet is attached as a
   * low-weight style anchor to Gemini/Atlas scene generations instead of
   * being passed as a regular character-reference. This prevents the
   * "collage leak" where Gemini echoes the turnaround layout into scene
   * outputs while still letting the palette/silhouette inform style.
   * No-op when the active provider strategy does not generate composites.
   */
  compositeAsStyleAnchor?: boolean;
  /** Thinking level for scene/beat images (default: 'minimal') */
  thinkingLevel?: 'minimal' | 'high';
  /** Thinking level for reference sheets and cover art (default: 'high') */
  referenceThinkingLevel?: 'minimal' | 'high';
  /** Use 512px preview for validation retries before committing to full resolution (default: false) */
  usePreviewForValidation?: boolean;
}

// Default Gemini settings
export const DEFAULT_GEMINI_SETTINGS: Required<GeminiSettings> = {
  model: 'gemini-3.1-flash-image-preview',
  maxRefImagesPerCharacter: 4,
  includeConsistencyInstruction: true,
  includePreviousScene: true,
  includeStyleReference: true,
  canonicalArtStyle: '',
  useEditMode: false,
  useChatMode: false,
  sceneResolution: '1K',
  referenceResolution: '2K',
  coverResolution: '2K',
  useIndividualCharacterViews: true,
  compositeAsStyleAnchor: true,
  thinkingLevel: 'minimal',
  referenceThinkingLevel: 'high',
  usePreviewForValidation: false,
};

export interface OpenAISettings {
  /** OpenAI reasoning effort for text/orchestration agents. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /** Force `response_format: { type: "json_object" }` for structured outputs. */
  forceJsonResponse?: boolean;
  /** OpenAI image model used when image provider is OPENAI (`dall-e` id). */
  imageModel?: 'gpt-image-2' | 'gpt-image-1.5' | 'gpt-image-1' | 'gpt-image-1-mini';
  /** OpenAI image moderation mode. */
  imageModeration?: 'auto' | 'low';
}

export const DEFAULT_OPENAI_SETTINGS: Required<OpenAISettings> = {
  reasoningEffort: 'medium',
  forceJsonResponse: true,
  // `gpt-image-1` is the broadest-availability tier on the OpenAI API and does
  // NOT require organization verification. `gpt-image-2` and `gpt-image-1.5`
  // are gated behind platform.openai.com org verification — pick them explicitly
  // in the UI only after your org is verified.
  imageModel: 'gpt-image-1',
  imageModeration: 'auto',
};

// Midjourney-specific tuning parameters
export interface MidjourneySettings extends ImageReferenceSettings {
  /** --sref code for style consistency across all images (e.g. "14094475") */
  srefCode?: string;
  /** --ow (omni weight) for reference sheet generation: how strongly --oref locks character identity (0-1000, default 400) */
  refSheetOmniWeight?: number;
  /** --ow for scene generation: balance character identity vs scene composition (0-1000, default 250) */
  sceneOmniWeight?: number;
  /** Stylization for reference sheets: lower = more faithful to prompt (0-1000, default 150) */
  refSheetStylization?: number;
  /** Stylization for scene images: higher = more artistic (0-1000, default 500) */
  sceneStylization?: number;
  /** Speed mode: 'fast' or 'relaxed' */
  speed?: 'fast' | 'relaxed';
  /** Max reference images to pass per character for scene generation (default 2) */
  maxRefImagesPerCharacter?: number;
  /** --ow for full-appearance reference sheet generation: locks entire look including outfit (0-1000, default 700) */
  fullAppearanceOmniWeight?: number;
  /** Midjourney version (default '7') */
  version?: string;
  /**
   * D7: Enable `--cref <url>` and `--sref <url>` flags when reference images
   * carry an accessible URL. Reference images without a URL fall back to the
   * existing `--oref`/identity-hint path so this flag is safe to leave on.
   * Default: false to preserve today's behavior.
   */
  enableCrefSref?: boolean;
  /**
   * D7: `--cw` character weight (0-100). Controls how strongly Midjourney
   * locks to the character reference's features vs its clothing/style. 100 =
   * full locking (face + hair + outfit), 0 = face only. Default 100.
   */
  characterWeight?: number;
  /**
   * D7: `--sw` style weight (0-1000). How strongly `--sref` biases the final
   * image toward the style reference. Higher = more style fidelity. Default 100.
   */
  styleWeight?: number;
}

// Default Midjourney settings
export const DEFAULT_MIDJOURNEY_SETTINGS: Required<MidjourneySettings> = {
  srefCode: '',
  refSheetOmniWeight: 400,
  sceneOmniWeight: 250,
  refSheetStylization: 150,
  sceneStylization: 500,
  speed: 'fast',
  maxRefImagesPerCharacter: 2,
  fullAppearanceOmniWeight: 700,
  version: '7',
  enableCrefSref: false,
  characterWeight: 100,
  styleWeight: 100,
};

// ========================================
// Stable Diffusion settings
// ========================================

/**
 * Backend flavors supported by the Stable Diffusion adapter layer.
 *
 * Only `a1111` has a concrete adapter today; the other values are reserved so
 * the config surface can be authored ahead of time without breaking callers
 * when new adapters land.
 */
export type StableDiffusionBackend = 'a1111' | 'comfy' | 'replicate' | 'stability' | 'fal';

/** A single LoRA reference to weave into the positive prompt. */
export interface StableDiffusionLoraRef {
  name: string;
  weight: number;
}

/**
 * ControlNet model ids configured per module. `A1111Adapter` picks which one
 * to use based on the `purpose` of a reference image. Leave blank to disable
 * that flavor of ControlNet.
 */
export interface StableDiffusionControlNetModels {
  depth?: string;
  canny?: string;
  referenceOnly?: string;
}

/**
 * Stable Diffusion specific tuning parameters. All fields are optional — when
 * unset the adapter falls back to adapter-specific defaults so that a minimal
 * config (just `baseUrl`) still produces images.
 */
export interface StableDiffusionSettings extends ImageReferenceSettings {
  /** Base URL for the SD backend (e.g. A1111 WebUI) — usually the proxy `/sd-api`. */
  baseUrl?: string;
  /** Optional API key/bearer token, forwarded as Authorization by the proxy. */
  apiKey?: string;
  /** Backend flavor (only `a1111` is wired today). */
  backend?: StableDiffusionBackend;
  /** Default checkpoint / model id used when the prompt doesn't specify one. */
  defaultModel?: string;
  /** Style LoRAs applied to every image for a consistent look. */
  styleLoras?: StableDiffusionLoraRef[];
  /** Per-character LoRA registry keyed by canonical character name. */
  characterLoraByName?: Record<string, StableDiffusionLoraRef>;
  /** IP-Adapter model id (runs through ControlNet extension on A1111/Forge). */
  ipAdapterModel?: string;
  /** ControlNet model ids for depth/canny/reference-only pipelines. */
  controlNetModels?: StableDiffusionControlNetModels;
  defaultSampler?: string;
  defaultSteps?: number;
  defaultCfg?: number;
  /** Baseline negative prompt prepended to every generation. */
  defaultNegativePrompt?: string;
  /** Default output width in pixels. */
  width?: number;
  /** Default output height in pixels. */
  height?: number;
  /** Default denoising strength for img2img passes (0..1). */
  defaultDenoisingStrength?: number;
}

export const DEFAULT_STABLE_DIFFUSION_SETTINGS: Required<
  Omit<
    StableDiffusionSettings,
    'styleLoras' | 'characterLoraByName' | 'ipAdapterModel' | 'controlNetModels' | 'defaultModel' | 'apiKey'
  >
> & Pick<StableDiffusionSettings, 'styleLoras' | 'characterLoraByName' | 'ipAdapterModel' | 'controlNetModels' | 'defaultModel' | 'apiKey'> = {
  baseUrl: '',
  backend: 'a1111',
  defaultSampler: 'DPM++ 2M Karras',
  defaultSteps: 28,
  defaultCfg: 6.5,
  defaultNegativePrompt:
    'lowres, blurry, deformed, bad anatomy, extra fingers, watermark, signature, jpeg artifacts, text',
  width: 832,
  height: 1216,
  defaultDenoisingStrength: 0.55,
  maxRefImagesPerCharacter: 2,
  styleLoras: undefined,
  characterLoraByName: undefined,
  ipAdapterModel: undefined,
  controlNetModels: undefined,
  defaultModel: undefined,
  apiKey: undefined,
};

// ========================================
// Auto-train LoRA settings
// ========================================

/**
 * Which character tiers are eligible for auto character-LoRA training. Matches
 * `Character.role`/tier strings used by the existing reference-sheet pipeline.
 */
export type LoraTrainableCharacterTier = 'core' | 'major' | 'supporting';

/**
 * Which concrete trainer backend the `LoraTrainingAgent` talks to. `disabled`
 * keeps the whole subsystem dormant — the agent short-circuits before it
 * even instantiates an adapter.
 */
export type LoraTrainerBackend =
  | 'kohya'
  | 'a1111-dreambooth'
  | 'comfy-training'
  | 'replicate'
  | 'fal'
  | 'disabled';

/** Eligibility heuristics for automatically training a character LoRA. */
export interface LoraCharacterThresholds {
  /** Minimum number of high-quality reference images the character must have. */
  minRefs: number;
  /** Tiers eligible for auto-training (default: core + major + supporting). */
  tiers: LoraTrainableCharacterTier[];
  /**
   * When true (default), scene generation for that character waits for its
   * LoRA to finish training before rendering. When false, training runs in
   * the background and the first few scenes may still use the base model.
   */
  blockScenes: boolean;
}

/** Eligibility heuristics for automatically training an episode-style LoRA. */
export interface LoraStyleThresholds {
  /**
   * Minimum episode count before the style LoRA trains automatically. Stories
   * with a single episode rarely recoup the training cost.
   */
  minEpisodes: number;
  /**
   * Force style training even when `minEpisodes` is not met. Lets the UI
   * "Train style LoRA" button bypass the heuristic for a one-off.
   */
  forceStyle: boolean;
}

/**
 * Shared training knobs passed through to the adapter. Adapters merge their
 * own defaults on top, so leaving a field `undefined` just means "use the
 * adapter's default".
 */
export interface LoraHyperparameters {
  baseModel?: string;
  steps?: number;
  rank?: number;
  networkAlpha?: number;
  learningRate?: number;
  batchSize?: number;
  resolution?: number;
  repeats?: number;
  optimizer?: string;
  scheduler?: string;
  seed?: number;
  mixedPrecision?: string;
}

export interface LoraTrainingSettings {
  /** Master switch. When false, `LoraTrainingAgent` always no-ops. */
  enabled: boolean;
  /** Trainer backend; `disabled` keeps the agent dormant even if enabled=true. */
  backend: LoraTrainerBackend;
  /** Optional override for the proxy-mounted trainer base URL. */
  baseUrl?: string;
  /** Optional bearer token forwarded to the trainer sidecar. */
  apiKey?: string;
  /** Character-training eligibility knobs. */
  characterThresholds: LoraCharacterThresholds;
  /** Style-training eligibility knobs. */
  styleThresholds: LoraStyleThresholds;
  /** Shared training hyperparameters. */
  training: LoraHyperparameters;
}

/**
 * Safe defaults. `enabled=false` and `backend='disabled'` together mean
 * existing stories render exactly as they do today unless the operator opts
 * in via env vars or the Generator UI.
 */
export const DEFAULT_LORA_TRAINING_SETTINGS: LoraTrainingSettings = {
  enabled: false,
  backend: 'disabled',
  characterThresholds: {
    minRefs: 6,
    tiers: ['core', 'major', 'supporting'],
    blockScenes: true,
  },
  styleThresholds: {
    minEpisodes: 2,
    forceStyle: false,
  },
  training: {
    steps: 1500,
    rank: 32,
    networkAlpha: 32,
    learningRate: 1e-4,
    batchSize: 2,
    resolution: 1024,
    repeats: 10,
    optimizer: 'adamw8bit',
    scheduler: 'cosine',
    mixedPrecision: 'bf16',
  },
};

/**
 * Resolve a `LoraTrainingSettings` object from env vars, applying sensible
 * defaults. Called from `loadConfig()` and `buildPipelineConfig()` so the
 * same semantics apply to both the CLI/worker entry point and the UI-driven
 * generator flow.
 */
export function resolveLoraTrainingSettings(
  env: Record<string, string | undefined>,
  overrides?: Partial<LoraTrainingSettings>,
): LoraTrainingSettings {
  const defaults = DEFAULT_LORA_TRAINING_SETTINGS;
  const backendRaw = (
    overrides?.backend ||
    env.LORA_TRAINER_BACKEND ||
    env.EXPO_PUBLIC_LORA_TRAINER_BACKEND ||
    defaults.backend
  ).trim() as LoraTrainerBackend;
  const enabledRaw =
    overrides?.enabled !== undefined
      ? overrides.enabled
      : env.EXPO_PUBLIC_LORA_AUTO_TRAIN === 'true' || env.LORA_AUTO_TRAIN === 'true';
  const toNum = (value: string | undefined, fallback: number | undefined) => {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    enabled: enabledRaw && backendRaw !== 'disabled',
    backend: backendRaw || 'disabled',
    baseUrl: overrides?.baseUrl || env.LORA_TRAINER_BASE_URL || env.EXPO_PUBLIC_LORA_TRAINER_BASE_URL || undefined,
    apiKey: overrides?.apiKey || env.LORA_TRAINER_API_KEY || undefined,
    characterThresholds: {
      minRefs:
        overrides?.characterThresholds?.minRefs ??
        (toNum(env.LORA_TRAIN_CHARACTER_MIN_REFS, defaults.characterThresholds.minRefs) as number),
      tiers: overrides?.characterThresholds?.tiers ?? defaults.characterThresholds.tiers,
      blockScenes:
        overrides?.characterThresholds?.blockScenes ??
        (env.LORA_TRAIN_CHARACTER_BLOCK === undefined
          ? defaults.characterThresholds.blockScenes
          : env.LORA_TRAIN_CHARACTER_BLOCK === 'true'),
    },
    styleThresholds: {
      minEpisodes:
        overrides?.styleThresholds?.minEpisodes ??
        (toNum(env.LORA_TRAIN_STYLE_EPISODE_THRESHOLD, defaults.styleThresholds.minEpisodes) as number),
      forceStyle:
        overrides?.styleThresholds?.forceStyle ??
        (env.LORA_TRAIN_STYLE_FORCE === 'true' || defaults.styleThresholds.forceStyle),
    },
    training: {
      ...defaults.training,
      ...(overrides?.training ?? {}),
      baseModel: overrides?.training?.baseModel || env.LORA_TRAIN_BASE_MODEL || defaults.training.baseModel,
      steps: toNum(env.LORA_TRAIN_STEPS, overrides?.training?.steps ?? defaults.training.steps),
      rank: toNum(env.LORA_TRAIN_RANK, overrides?.training?.rank ?? defaults.training.rank),
      learningRate: toNum(env.LORA_TRAIN_LR, overrides?.training?.learningRate ?? defaults.training.learningRate),
    },
  };
}

export interface PipelineConfig {
  agents: {
    storyArchitect: AgentConfig;
    sceneWriter: AgentConfig;
    choiceAuthor: AgentConfig;
    imagePlanner?: AgentConfig;
    videoDirector?: AgentConfig;
  };
  // Validation configuration
  validation: ValidationConfig;
  // Enable detailed logging for debugging
  debug: boolean;
  // Output directory for generated content
  outputDir: string;
  // Global art style for image generation
  artStyle?: string;
  // Image generation configuration
  imageGen?: {
    enabled?: boolean;
    apiKey?: string;
    geminiApiKey?: string;
    openaiApiKey?: string;
    openaiImageModel?: string;
    openaiModeration?: 'auto' | 'low';
    model?: string;
    provider?: ImageProvider;
    strategy?: 'selective' | 'all-beats';
    // Atlas Cloud configuration
    atlasCloudApiKey?: string;
    atlasCloudModel?: string;
    // MidAPI specific config (Midjourney - no Discord token required)
    midapiToken?: string;
    // Midjourney tuning parameters
    midjourney?: MidjourneySettings;
    // Gemini (Nano Banana) tuning parameters
    gemini?: GeminiSettings;
    // Stable Diffusion tuning parameters (A1111/Forge REST by default)
    stableDiffusion?: StableDiffusionSettings;
    /** 0 = disabled. Hard-abort encounter image phase after N consecutive failures (in addition to completeness gate). */
    encounterMaxConsecutiveFailuresBeforeAbort?: number;
    /** Panel layout mode for beat images: 'single' (one image per beat), 'special-beats' (panels for action/dramatic moments), 'all-beats' (panels for every beat). */
    panelMode?: 'single' | 'special-beats' | 'all-beats';
    /**
     * Minimum ConsistencyScorer score (0-100) a generated shot must achieve
     * against its character reference images before it is accepted. Shots below
     * this threshold trigger a single bounded edit-mode regeneration pass.
     * Default: 75.
     */
    identityScoreThreshold?: number;
    /**
     * Episode-wide cap on identity-driven regenerations. Prevents runaway API
     * spend when the model cannot stabilize on the reference. Default: 10.
     */
    maxIdentityRegenerations?: number;
    /**
     * Require every character-visible shot to carry at least one usable
     * character reference per visible character. Default: true.
     */
    requireCharacterRefsForVisibleCharacters?: boolean;
    /** Minimum provider-usable refs expected per visible character. Default: 1. */
    minRefsPerVisibleCharacter?: number;
    /**
     * Permit text-only image generation for character-visible shots when refs
     * are missing or dropped by provider filtering. Default: false.
     */
    allowTextOnlyCharacterImages?: boolean;
    /**
     * Two-axis QA/prompt-path toggles (B1). Controls which prompt-building
     * path runs (deterministic | llm | compare) and which validator cascade
     * runs afterwards (off | fast | full). See `config/imageQaConfig.ts`.
     */
    qa?: ImageQaConfig;
    /**
     * Structured art-style profile (C1). When set, replaces the flat
     * `canonicalArtStyle` string for downstream prompt/validator modulation.
     * Prompt-assembly code still emits a string derived from `profile.name`
     * so legacy callers keep working.
     */
    artStyleProfile?: ArtStyleProfile;
    /**
     * Pre-approved style-bible anchor images supplied by the UI's Style
     * Setup section. When present, `generateEpisodeStyleBible` skips its
     * internal generation for whichever roles were approved and primes
     * `setGeminiStyleReference` from the preferred anchor (character first,
     * falling back to arc strip). Any slot left undefined is still
     * generated in-pipeline the way it is today.
     *
     * The image is either supplied inline (base64 + mimeType) for the
     * freshest handoff or as a filesystem path written by the proxy.
     */
    preapprovedStyleAnchors?: {
      character?: PreapprovedAnchor;
      arcStrip?: PreapprovedAnchor;
      environment?: PreapprovedAnchor;
    };
    /**
     * Auto-train LoRA settings. Drives the `LoraTrainingAgent` in
     * `FullStoryPipeline`. Only meaningful when `provider === 'stable-diffusion'`
     * (other providers can't consume trained LoRAs — see
     * `providerCapabilities.supportsLoraTraining`).
     */
    loraTraining?: LoraTrainingSettings;
  };
  
  // Midjourney-specific parameters exposed in settings
  midjourneySettings?: MidjourneySettings;
  // Gemini-specific parameters exposed in settings
  geminiSettings?: GeminiSettings;
  // OpenAI-specific parameters exposed in settings
  openaiSettings?: OpenAISettings;
  // Generation settings (beat counts, choice distribution, etc.)
  generation?: GenerationSettingsConfig;
  // Narration/Audio settings
  narration?: NarrationSettingsConfig;
  // Video generation settings (Veo via Gemini API)
  videoGen?: VideoSettingsConfig;
  // Claude memory tool configuration (Anthropic-only, opt-in)
  memory?: MemoryConfig;

  /**
   * Scene Critic rewrite pass (Phase 9.2). Optional because it is a second
   * LLM pass per authored scene and therefore doubles SceneWriter token
   * cost. Off by default.
   */
  sceneCritic?: {
    enabled: boolean;
    /**
     * When set, only scenes whose VoiceValidator score is at-or-below this
     * threshold (0-100) are sent to SceneCritic. Leave unset to critique
     * every scene.
     */
    voiceScoreThreshold?: number;
    /**
     * Hard cap on the number of scenes the critic will touch per episode.
     * Defaults to 3 — the critic is a scalpel, not a chainsaw.
     */
    maxScenesPerEpisode?: number;
  };
}

export interface MemoryConfig {
  enabled: boolean;
  directory?: string; // defaults to ./pipeline-memories
  pipelineOptimization: boolean; // self-optimization: QA scores, failure patterns
  characterKnowledge: boolean;   // character knowledge: physical traits, ref matching
}

// Default validation configuration
const defaultValidationConfig: ValidationConfig = {
  enabled: true,
  mode: 'advisory', // Default to advisory for backwards compatibility
  rules: {
    stakesTriangle: {
      enabled: true,
      level: 'error',
      threshold: 60,
    },
    fiveFactor: {
      enabled: true,
      level: 'error',
    },
    choiceDensity: {
      enabled: true,
      level: 'warning',
      firstChoiceMaxSeconds: CHOICE_DENSITY_DEFAULTS.firstChoiceMaxSeconds,
      averageGapMaxSeconds: CHOICE_DENSITY_DEFAULTS.averageGapMaxSeconds,
    },
    consequenceBudget: {
      enabled: true,
      level: 'warning',
      budgetTolerance: 15,
    },
    npcDepth: {
      enabled: true,
      level: 'warning', // Warning by default - CharacterDesigner may not output all dimensions
    },
  },
};

// Default configuration - override with environment variables
export function loadConfig(): PipelineConfig {
  const env = typeof process !== 'undefined' ? process.env : {} as any;
  const openaiSettingsFromEnv: Required<OpenAISettings> = {
    reasoningEffort:
      (env.EXPO_PUBLIC_OPENAI_REASONING_EFFORT || env.OPENAI_REASONING_EFFORT || DEFAULT_OPENAI_SETTINGS.reasoningEffort) as Required<OpenAISettings>['reasoningEffort'],
    forceJsonResponse:
      (env.EXPO_PUBLIC_OPENAI_FORCE_JSON_RESPONSE || env.OPENAI_FORCE_JSON_RESPONSE || 'true') !== 'false',
    imageModel:
      (env.EXPO_PUBLIC_OPENAI_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_SETTINGS.imageModel) as Required<OpenAISettings>['imageModel'],
    imageModeration:
      (env.EXPO_PUBLIC_OPENAI_IMAGE_MODERATION || env.OPENAI_IMAGE_MODERATION || DEFAULT_OPENAI_SETTINGS.imageModeration) as Required<OpenAISettings>['imageModeration'],
  };
  const resolveProviderApiKey = (provider: AgentConfig['provider']): string => {
    if (provider === 'gemini') {
      return env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY || '';
    }
    if (provider === 'openai') {
      return env.EXPO_PUBLIC_OPENAI_API_KEY || env.OPENAI_API_KEY || '';
    }
    return env.EXPO_PUBLIC_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';
  };
  const defaultConfig: AgentConfig = {
    provider: (env.EXPO_PUBLIC_LLM_PROVIDER || env.LLM_PROVIDER as 'anthropic' | 'openai' | 'gemini') || 'anthropic',
    model: env.EXPO_PUBLIC_LLM_MODEL || env.LLM_MODEL || 'claude-sonnet-4-20250514',
    apiKey:
      env.EXPO_PUBLIC_ANTHROPIC_API_KEY ||
      env.EXPO_PUBLIC_OPENAI_API_KEY ||
      env.EXPO_PUBLIC_GEMINI_API_KEY ||
      env.ANTHROPIC_API_KEY ||
      env.OPENAI_API_KEY ||
      env.GEMINI_API_KEY ||
      '',
    maxTokens: 4096,
    temperature: 0.8,
    openaiReasoningEffort: openaiSettingsFromEnv.reasoningEffort,
    openaiForceJsonResponse: openaiSettingsFromEnv.forceJsonResponse,
  };

  // Parse validation mode from environment
  const validationMode = (env.EXPO_PUBLIC_VALIDATION_MODE || env.VALIDATION_MODE) as 'strict' | 'advisory' | 'disabled' | undefined;
  const failurePolicy = ((env.EXPO_PUBLIC_FAILURE_POLICY || env.FAILURE_POLICY) as 'fail_fast' | 'recover' | undefined) || 'fail_fast';

  return {
    agents: {
      storyArchitect: {
        ...defaultConfig,
        temperature: 0.7, // More focused for structural work
      },
      sceneWriter: {
        ...defaultConfig,
        temperature: 0.85, // More creative for prose
      },
      choiceAuthor: {
        ...defaultConfig,
        temperature: 0.75, // Balanced for meaningful choices
      },
      imagePlanner: {
        provider: ((env.EXPO_PUBLIC_IMAGE_LLM_PROVIDER || env.IMAGE_LLM_PROVIDER) as AgentConfig['provider']) || defaultConfig.provider,
        model: env.EXPO_PUBLIC_IMAGE_LLM_MODEL || env.IMAGE_LLM_MODEL || defaultConfig.model,
        apiKey: resolveProviderApiKey(((env.EXPO_PUBLIC_IMAGE_LLM_PROVIDER || env.IMAGE_LLM_PROVIDER) as AgentConfig['provider']) || defaultConfig.provider),
        maxTokens: 8192,
        temperature: 0.7,
      },
      videoDirector: {
        provider: ((env.EXPO_PUBLIC_VIDEO_LLM_PROVIDER || env.VIDEO_LLM_PROVIDER) as AgentConfig['provider']) || defaultConfig.provider,
        model: env.EXPO_PUBLIC_VIDEO_LLM_MODEL || env.VIDEO_LLM_MODEL || defaultConfig.model,
        apiKey: resolveProviderApiKey(((env.EXPO_PUBLIC_VIDEO_LLM_PROVIDER || env.VIDEO_LLM_PROVIDER) as AgentConfig['provider']) || defaultConfig.provider),
        maxTokens: 8192,
        temperature: 0.7,
      },
    },
    validation: {
      ...defaultValidationConfig,
      enabled: env.EXPO_PUBLIC_VALIDATION_ENABLED !== 'false' && env.VALIDATION_ENABLED !== 'false',
      mode: validationMode || defaultValidationConfig.mode,
    },
    debug: env.EXPO_PUBLIC_DEBUG === 'true' || env.DEBUG === 'true',
    outputDir: env.EXPO_PUBLIC_OUTPUT_DIR || env.OUTPUT_DIR || './generated-content',
    artStyle: env.EXPO_PUBLIC_ART_STYLE || env.ART_STYLE,
    imageGen: {
      enabled: env.EXPO_PUBLIC_IMAGE_GENERATION_ENABLED !== 'false' && env.IMAGE_GENERATION_ENABLED !== 'false',
      apiKey: env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY,
      geminiApiKey: env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY || env.EXPO_PUBLIC_OPENAI_API_KEY,
      openaiImageModel: openaiSettingsFromEnv.imageModel,
      openaiModeration: openaiSettingsFromEnv.imageModeration,
      model: env.EXPO_PUBLIC_GEMINI_MODEL || env.GEMINI_MODEL,
      provider: env.EXPO_PUBLIC_IMAGE_PROVIDER || env.IMAGE_PROVIDER || 'nano-banana',
      requireCharacterRefsForVisibleCharacters: env.IMAGE_REQUIRE_CHARACTER_REFS !== 'false',
      minRefsPerVisibleCharacter: Number.parseInt(env.IMAGE_MIN_REFS_PER_VISIBLE_CHARACTER || '1', 10) || 1,
      allowTextOnlyCharacterImages: env.IMAGE_ALLOW_TEXT_ONLY_CHARACTER_IMAGES === 'true',
      qa: resolveImageQaConfig(env),
      artStyleProfile: resolveArtStylePresetProfile(env),
      loraTraining: resolveLoraTrainingSettings(env),
    },
    openaiSettings: openaiSettingsFromEnv,
    videoGen: {
      enabled: env.EXPO_PUBLIC_VIDEO_GENERATION_ENABLED === 'true' || env.VIDEO_GENERATION_ENABLED === 'true',
      model: (env.EXPO_PUBLIC_VIDEO_MODEL || env.VIDEO_MODEL || DEFAULT_VIDEO_SETTINGS.model) as VideoSettingsConfig['model'],
      apiKey: env.EXPO_PUBLIC_VIDEO_API_KEY || env.VIDEO_API_KEY || env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY,
      durationSeconds: parseInt(env.EXPO_PUBLIC_VIDEO_DURATION || env.VIDEO_DURATION || '8', 10) as 6 | 8,
      resolution: (env.EXPO_PUBLIC_VIDEO_RESOLUTION || env.VIDEO_RESOLUTION || DEFAULT_VIDEO_SETTINGS.resolution) as VideoSettingsConfig['resolution'],
      aspectRatio: (env.EXPO_PUBLIC_VIDEO_ASPECT_RATIO || env.VIDEO_ASPECT_RATIO || DEFAULT_VIDEO_SETTINGS.aspectRatio) as VideoSettingsConfig['aspectRatio'],
      strategy: (env.EXPO_PUBLIC_VIDEO_STRATEGY || env.VIDEO_STRATEGY || DEFAULT_VIDEO_SETTINGS.strategy) as VideoSettingsConfig['strategy'],
    },
    generation: {
      failurePolicy,
    },
    memory: {
      enabled: env.EXPO_PUBLIC_CLAUDE_MEMORY === 'true' || env.CLAUDE_MEMORY === 'true' || defaultConfig.provider === 'anthropic',
      directory: env.EXPO_PUBLIC_MEMORY_DIR || env.MEMORY_DIR || undefined,
      pipelineOptimization: true,
      characterKnowledge: true,
    },
  };
}

// Export default validation config for direct use
export { defaultValidationConfig };
