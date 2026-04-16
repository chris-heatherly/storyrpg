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

export interface AgentConfig {
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
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
  sceneParallelismEnabled?: boolean;
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
  /** Generate individual view images instead of composite sheets for NB2 character consistency (default: true) */
  useIndividualCharacterViews?: boolean;
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
  thinkingLevel: 'minimal',
  referenceThinkingLevel: 'high',
  usePreviewForValidation: false,
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
};

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
  };
  
  // Midjourney-specific parameters exposed in settings
  midjourneySettings?: MidjourneySettings;
  // Gemini-specific parameters exposed in settings
  geminiSettings?: GeminiSettings;
  // Generation settings (beat counts, choice distribution, etc.)
  generation?: GenerationSettingsConfig;
  // Narration/Audio settings
  narration?: NarrationSettingsConfig;
  // Video generation settings (Veo via Gemini API)
  videoGen?: VideoSettingsConfig;
  // Claude memory tool configuration (Anthropic-only, opt-in)
  memory?: MemoryConfig;
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
      model: env.EXPO_PUBLIC_GEMINI_MODEL || env.GEMINI_MODEL,
      provider: env.EXPO_PUBLIC_IMAGE_PROVIDER || env.IMAGE_PROVIDER || 'nano-banana',
    },
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
