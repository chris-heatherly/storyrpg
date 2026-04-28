import {
  PipelineConfig,
  VideoSettingsConfig,
  GeminiSettings,
  MidjourneySettings,
  StableDiffusionSettings,
  OpenAISettings,
  DEFAULT_OPENAI_SETTINGS,
  ImageProvider,
  LoraTrainingSettings,
  resolveLoraTrainingSettings,
} from '../config';
import { resolveImageQaConfig, resolveArtStylePresetProfile } from './imageQaConfig';
import { resolveArtStyleProfile, composeCanonicalStyleString } from '../images/artStyleProfile';
import type { ArtStyleProfile } from '../images/artStyleProfile';
import { StyleArchitect } from '../agents/StyleArchitect';
import type { PreapprovedAnchor } from '../config';
import type { GenerationSettings } from '../../components/GenerationSettingsPanel';
import {
  DEFAULT_LLM_MODELS,
  GenerationMode,
  GeneratorImageProvider,
  GeneratorLlmProvider,
} from '../../config/generatorLlmOptions';
import type {
  GeneratorNarrationSettings,
  GeneratorVideoSettings,
} from '../../hooks/useGeneratorSettings';

export interface BuildPipelineConfigInput {
  llmProvider: GeneratorLlmProvider;
  llmModel: string;
  imageLlmProvider: GeneratorLlmProvider;
  imageLlmModel: string;
  videoLlmProvider: GeneratorLlmProvider;
  videoLlmModel: string;
  apiKey: string;
  openaiApiKey?: string;
  geminiApiKey: string;
  elevenLabsApiKey: string;
  atlasCloudApiKey: string;
  atlasCloudModel: string;
  midapiToken: string;
  imageProvider: GeneratorImageProvider;
  imageStrategy: 'selective' | 'all-beats';
  panelMode: 'single' | 'special-beats' | 'all-beats';
  artStyle: string;
  geminiSettings: GeminiSettings;
  midjourneySettings: MidjourneySettings;
  stableDiffusionSettings?: StableDiffusionSettings;
  /**
   * Optional UI overrides for the auto-train LoRA subsystem. When omitted,
   * env-var defaults apply via `resolveLoraTrainingSettings`.
   */
  loraTrainingSettings?: Partial<LoraTrainingSettings>;
  openaiSettings?: OpenAISettings;
  generationSettings: GenerationSettings;
  generationMode: GenerationMode;
  narrationSettings: GeneratorNarrationSettings;
  videoSettings: GeneratorVideoSettings;
}

function getSelectedLlmApiKey(input: BuildPipelineConfigInput): string {
  if (input.llmProvider === 'gemini') {
    return input.geminiApiKey.trim();
  }
  if (input.llmProvider === 'openai') {
    return (input.openaiApiKey || input.apiKey || '').trim();
  }

  return input.apiKey.trim();
}

function getSelectedLlmModel(input: BuildPipelineConfigInput): string {
  return input.llmModel.trim() || DEFAULT_LLM_MODELS[input.llmProvider];
}

function getScopedLlmApiKey(
  provider: GeneratorLlmProvider,
  input: BuildPipelineConfigInput,
): string {
  if (provider === 'gemini') {
    return input.geminiApiKey.trim();
  }
  if (provider === 'openai') {
    return (input.openaiApiKey || input.apiKey || '').trim();
  }

  return input.apiKey.trim();
}

function getScopedLlmModel(
  provider: GeneratorLlmProvider,
  model: string,
): string {
  return model.trim() || DEFAULT_LLM_MODELS[provider];
}

function normalizeImageProvider(provider: GeneratorImageProvider | 'useapi'): ImageProvider {
  if (provider === 'useapi') return 'midapi';
  return provider;
}

function resolveStableDiffusionSettings(
  provider: ImageProvider,
  overrides: StableDiffusionSettings | undefined,
): StableDiffusionSettings | undefined {
  if (provider !== 'stable-diffusion' && !overrides) return undefined;
  const env = typeof process !== 'undefined' ? process.env : ({} as any);
  const baseUrl = (overrides?.baseUrl || env.STABLE_DIFFUSION_BASE_URL || env.EXPO_PUBLIC_STABLE_DIFFUSION_BASE_URL || '').trim();
  const apiKey = (overrides?.apiKey || env.STABLE_DIFFUSION_API_KEY || env.EXPO_PUBLIC_STABLE_DIFFUSION_API_KEY || '').trim();
  const defaultModel = (overrides?.defaultModel || env.STABLE_DIFFUSION_DEFAULT_MODEL || env.EXPO_PUBLIC_STABLE_DIFFUSION_DEFAULT_MODEL || '').trim();
  const backend = (overrides?.backend || (env.STABLE_DIFFUSION_BACKEND as any) || 'a1111') as StableDiffusionSettings['backend'];
  return {
    ...overrides,
    baseUrl: baseUrl || overrides?.baseUrl,
    apiKey: apiKey || overrides?.apiKey,
    defaultModel: defaultModel || overrides?.defaultModel,
    backend,
  };
}

/**
 * Optional extras an async/UI-driven caller can supply to short-circuit
 * the heuristic style-resolution step and thread pre-approved style-bible
 * anchors into the pipeline.
 */
export interface PipelineConfigExtras {
  /**
   * A fully-formed profile the caller already resolved (e.g. via
   * StyleArchitect, or via the UI style-setup section where the user
   * edited individual DNA fields). When present, this wins over the
   * preset-based or keyword-based heuristic.
   */
  artStyleProfileOverride?: ArtStyleProfile;
  /** Anchor images the user approved in the UI. */
  preapprovedStyleAnchors?: {
    character?: PreapprovedAnchor;
    arcStrip?: PreapprovedAnchor;
    environment?: PreapprovedAnchor;
  };
}

export function buildPipelineConfig(
  input: BuildPipelineConfigInput,
  extras?: PipelineConfigExtras,
): PipelineConfig {
  const selectedLlmModel = getSelectedLlmModel(input);
  const selectedLlmApiKey = getSelectedLlmApiKey(input);
  const artStyle = input.artStyle.trim() || undefined;
  const normalizedImageProvider = normalizeImageProvider(input.imageProvider);
  const env = typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {};
  const qa = resolveImageQaConfig(env);
  const artStyleProfile =
    extras?.artStyleProfileOverride ??
    resolveArtStylePresetProfile(env) ??
    (artStyle ? resolveArtStyleProfile(artStyle) : undefined);

  return {
    agents: {
      storyArchitect: {
        provider: input.llmProvider,
        model: selectedLlmModel,
        apiKey: selectedLlmApiKey,
        maxTokens: 8192,
        temperature: 0.7,
        openaiReasoningEffort: input.openaiSettings?.reasoningEffort || DEFAULT_OPENAI_SETTINGS.reasoningEffort,
        openaiForceJsonResponse: input.openaiSettings?.forceJsonResponse ?? DEFAULT_OPENAI_SETTINGS.forceJsonResponse,
      },
      sceneWriter: {
        provider: input.llmProvider,
        model: selectedLlmModel,
        apiKey: selectedLlmApiKey,
        maxTokens: 4096,
        temperature: 0.85,
        openaiReasoningEffort: input.openaiSettings?.reasoningEffort || DEFAULT_OPENAI_SETTINGS.reasoningEffort,
        openaiForceJsonResponse: input.openaiSettings?.forceJsonResponse ?? DEFAULT_OPENAI_SETTINGS.forceJsonResponse,
      },
      choiceAuthor: {
        provider: input.llmProvider,
        model: selectedLlmModel,
        apiKey: selectedLlmApiKey,
        maxTokens: 4096,
        temperature: 0.75,
        openaiReasoningEffort: input.openaiSettings?.reasoningEffort || DEFAULT_OPENAI_SETTINGS.reasoningEffort,
        openaiForceJsonResponse: input.openaiSettings?.forceJsonResponse ?? DEFAULT_OPENAI_SETTINGS.forceJsonResponse,
      },
      imagePlanner: {
        provider: input.imageLlmProvider,
        model: getScopedLlmModel(input.imageLlmProvider, input.imageLlmModel),
        apiKey: getScopedLlmApiKey(input.imageLlmProvider, input),
        maxTokens: 8192,
        temperature: 0.7,
        openaiReasoningEffort: input.openaiSettings?.reasoningEffort || DEFAULT_OPENAI_SETTINGS.reasoningEffort,
        openaiForceJsonResponse: input.openaiSettings?.forceJsonResponse ?? DEFAULT_OPENAI_SETTINGS.forceJsonResponse,
      },
      videoDirector: {
        provider: input.videoLlmProvider,
        model: getScopedLlmModel(input.videoLlmProvider, input.videoLlmModel),
        apiKey: getScopedLlmApiKey(input.videoLlmProvider, input),
        maxTokens: 8192,
        temperature: 0.7,
        openaiReasoningEffort: input.openaiSettings?.reasoningEffort || DEFAULT_OPENAI_SETTINGS.reasoningEffort,
        openaiForceJsonResponse: input.openaiSettings?.forceJsonResponse ?? DEFAULT_OPENAI_SETTINGS.forceJsonResponse,
      },
    },
    validation: {
      enabled: input.generationMode !== 'disabled',
      mode: input.generationMode,
      rules: {
        stakesTriangle: {
          enabled: true,
          level: 'error',
          threshold: input.generationSettings.blockingThreshold || 60,
        },
        fiveFactor: { enabled: true, level: 'error' },
        choiceDensity: {
          enabled: true,
          level: 'warning',
          firstChoiceMaxSeconds: input.generationSettings.firstChoiceMaxSeconds || 60,
          averageGapMaxSeconds: input.generationSettings.averageGapMaxSeconds || 90,
        },
        consequenceBudget: { enabled: true, level: 'warning', budgetTolerance: 0.15 },
        npcDepth: {
          enabled: true,
          level: input.generationMode === 'strict' ? 'error' : 'warning',
          minMajorDimensions: input.generationSettings.minMajorDimensions,
        },
      },
    },
    debug: true,
    outputDir: './generated',
    artStyle,
    imageGen: {
      enabled: input.generationSettings.generateImages,
      apiKey: input.geminiApiKey.trim(),
      geminiApiKey: input.geminiApiKey.trim(),
      openaiApiKey: (input.openaiApiKey || input.apiKey || '').trim() || undefined,
      openaiImageModel: input.openaiSettings?.imageModel || DEFAULT_OPENAI_SETTINGS.imageModel,
      openaiModeration: input.openaiSettings?.imageModeration || DEFAULT_OPENAI_SETTINGS.imageModeration,
      provider: normalizedImageProvider,
      strategy: input.imageStrategy,
      atlasCloudApiKey: input.atlasCloudApiKey.trim() || undefined,
      atlasCloudModel: input.atlasCloudModel.trim() || undefined,
      midapiToken: input.midapiToken.trim() || undefined,
      panelMode: input.panelMode || 'single',
      requireCharacterRefsForVisibleCharacters: true,
      minRefsPerVisibleCharacter: 1,
      allowTextOnlyCharacterImages: false,
      midjourney: normalizedImageProvider === 'midapi' ? input.midjourneySettings : undefined,
      gemini: {
        ...(normalizedImageProvider === 'nano-banana' ? input.geminiSettings : {}),
        canonicalArtStyle:
          composeCanonicalStyleString(artStyleProfile) || input.artStyle.trim() || '',
      },
      stableDiffusion: resolveStableDiffusionSettings(normalizedImageProvider, input.stableDiffusionSettings),
      qa,
      artStyleProfile,
      preapprovedStyleAnchors: extras?.preapprovedStyleAnchors,
      loraTraining: resolveLoraTrainingSettings(env, input.loraTrainingSettings),
    },
    generation: {
      failurePolicy: input.generationSettings.failFastMode ? 'fail_fast' : 'recover',
      maxScenesPerEpisode: input.generationSettings.targetSceneCount,
      targetSceneCount: input.generationSettings.targetSceneCount,
      majorChoiceCount: input.generationSettings.majorChoiceCount,
      minBeatsPerScene: input.generationSettings.minBeatsPerScene,
      maxBeatsPerScene: input.generationSettings.maxBeatsPerScene,
      standardBeatCount: input.generationSettings.standardBeatCount,
      bottleneckBeatCount: input.generationSettings.bottleneckBeatCount,
      encounterBeatCount: input.generationSettings.encounterBeatCount,
      blockingThreshold: input.generationSettings.blockingThreshold,
      warningThreshold: input.generationSettings.warningThreshold,
      firstChoiceMaxSeconds: input.generationSettings.firstChoiceMaxSeconds,
      averageGapMaxSeconds: input.generationSettings.averageGapMaxSeconds,
      minChoiceDensity: input.generationSettings.minChoiceDensity,
      maxSentencesPerBeat: input.generationSettings.maxSentencesPerBeat,
      maxWordsPerBeat: input.generationSettings.maxWordsPerBeat,
      maxChoiceWords: input.generationSettings.maxChoiceWords,
      maxDialogueWords: input.generationSettings.maxDialogueWords,
      maxDialogueLines: input.generationSettings.maxDialogueLines,
      encounterSetupMaxWords: input.generationSettings.encounterSetupMaxWords,
      encounterOutcomeMaxWords: input.generationSettings.encounterOutcomeMaxWords,
      resolutionSummaryMaxWords: input.generationSettings.resolutionSummaryMaxWords,
      minChoices: input.generationSettings.minChoices,
      maxChoices: input.generationSettings.maxChoices,
      choiceDistExpression: input.generationSettings.choiceDistExpression,
      choiceDistRelationship: input.generationSettings.choiceDistRelationship,
      choiceDistStrategic: input.generationSettings.choiceDistStrategic,
      choiceDistDilemma: input.generationSettings.choiceDistDilemma,
      maxBranchingChoicesPerEpisode: input.generationSettings.maxBranchingChoicesPerEpisode,
      minEncountersShort: input.generationSettings.minEncountersShort,
      minEncountersMedium: input.generationSettings.minEncountersMedium,
      minEncountersLong: input.generationSettings.minEncountersLong,
      minMajorDimensions: input.generationSettings.minMajorDimensions,
      pixarGoodThreshold: input.generationSettings.pixarGoodThreshold,
      generateCharacterRefs: input.generationSettings.generateCharacterRefs,
      generateExpressionSheets: input.generationSettings.generateExpressionSheets,
      generateBodyVocabulary: input.generationSettings.generateBodyVocabulary,
    },
    narration: {
      enabled: input.narrationSettings.enabled,
      elevenLabsApiKey: input.elevenLabsApiKey.trim() || undefined,
      autoPlay: input.narrationSettings.autoPlay,
      preGenerateAudio: input.narrationSettings.preGenerateAudio,
      voiceId: input.narrationSettings.voiceId || undefined,
      highlightMode: input.narrationSettings.highlightMode,
    },
    videoGen: {
      enabled: input.videoSettings.enabled,
      model: input.videoSettings.model as VideoSettingsConfig['model'],
      durationSeconds: input.videoSettings.durationSeconds as VideoSettingsConfig['durationSeconds'],
      resolution: input.videoSettings.resolution as VideoSettingsConfig['resolution'],
      aspectRatio: input.videoSettings.aspectRatio as VideoSettingsConfig['aspectRatio'],
      strategy: input.videoSettings.strategy as VideoSettingsConfig['strategy'],
      apiKey: input.geminiApiKey.trim() || undefined,
    },
  };
}

/**
 * Async variant of `buildPipelineConfig` that first asks the `StyleArchitect`
 * LLM to expand the user's raw art-style string into a full `ArtStyleProfile`.
 * Falls back to the keyword heuristic on any failure. Callers that already
 * have a profile (for example, the UI's style-setup section where the user
 * edited DNA fields manually) should skip this and pass the profile via
 * `extras.artStyleProfileOverride` on the sync builder instead.
 */
export async function buildPipelineConfigAsync(
  input: BuildPipelineConfigInput,
  extras?: PipelineConfigExtras,
): Promise<PipelineConfig> {
  if (extras?.artStyleProfileOverride) {
    return buildPipelineConfig(input, extras);
  }

  const rawStyle = input.artStyle.trim();
  if (!rawStyle) {
    return buildPipelineConfig(input, extras);
  }

  const selectedLlmApiKey = getSelectedLlmApiKey(input);
  const architectConfig = {
    provider: input.llmProvider,
    model: getSelectedLlmModel(input),
    apiKey: selectedLlmApiKey,
    maxTokens: 1024,
    temperature: 0.4,
  };

  try {
    const architect = new StyleArchitect(architectConfig);
    const profile = await architect.expand({ artStyle: rawStyle });
    return buildPipelineConfig(input, {
      ...extras,
      artStyleProfileOverride: profile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[buildPipelineConfigAsync] StyleArchitect failed for "${rawStyle}" (${message}); using heuristic resolution.`,
    );
    return buildPipelineConfig(input, extras);
  }
}
