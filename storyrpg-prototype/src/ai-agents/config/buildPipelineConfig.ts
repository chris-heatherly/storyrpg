import {
  PipelineConfig,
  VideoSettingsConfig,
  GeminiSettings,
  MidjourneySettings,
  StableDiffusionSettings,
  OpenAISettings,
  DEFAULT_OPENAI_SETTINGS,
  DEFAULT_GEMINI_TTS_MODEL,
  ImageProvider,
  LoraTrainingSettings,
  resolveLoraTrainingSettings,
  resolveQualityCouncilConfig,
  StyleReferenceStrength,
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
import type { PipelineTask, TaskModelAssignment } from '../../config/modelFamilies';
import type {
  GeneratorNarrationSettings,
  GeneratorVideoSettings,
} from '../../hooks/useGeneratorSettings';
import { clampSceneCount } from '../../constants/pipeline';

export interface BuildPipelineConfigInput {
  llmProvider: GeneratorLlmProvider;
  llmModel: string;
  imageLlmProvider: GeneratorLlmProvider;
  imageLlmModel: string;
  videoLlmProvider: GeneratorLlmProvider;
  videoLlmModel: string;
  /**
   * Per-task model assignments (model-family presets + overrides). When present,
   * each pipeline role gets its own provider/model. When omitted, the legacy
   * single-model fields above are used (narrative roles → llmProvider/llmModel,
   * image/video → their scoped fields) so older callers keep working.
   */
  taskAssignments?: Record<PipelineTask, TaskModelAssignment>;
  apiKey: string;
  openaiApiKey?: string;
  openRouterApiKey?: string;
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
  if (input.llmProvider === 'openrouter') {
    return (input.openRouterApiKey || '').trim();
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
  if (provider === 'openrouter') {
    return (input.openRouterApiKey || '').trim();
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
  /** Uploaded style reference images from the Generator Images panel. */
  uploadedStyleReferences?: PreapprovedAnchor[];
  /** Strength applied when interpreting uploaded style references. */
  styleReferenceStrength?: StyleReferenceStrength;
}

export function buildPipelineConfig(
  input: BuildPipelineConfigInput,
  extras?: PipelineConfigExtras,
): PipelineConfig {
  const selectedLlmModel = getSelectedLlmModel(input);
  const artStyle = input.artStyle.trim() || undefined;
  const normalizedImageProvider = normalizeImageProvider(input.imageProvider);
  const env = typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {};
  const qa = resolveImageQaConfig(env);
  const targetSceneCount = clampSceneCount(input.generationSettings.targetSceneCount);
  const artStyleProfile =
    extras?.artStyleProfileOverride ??
    resolveArtStylePresetProfile(env) ??
    (artStyle ? resolveArtStyleProfile(artStyle) : undefined);
  const qualityCouncil = resolveQualityCouncilConfig(env, {
    enabled: input.generationSettings.qualityCouncilEnabled,
    mode: input.generationSettings.qualityCouncilMode,
    runPlanCouncil: input.generationSettings.qualityCouncilRunPlan,
    runChoiceCouncil: input.generationSettings.qualityCouncilRunChoice,
    runRoutePlaytestCouncil: input.generationSettings.qualityCouncilRunRoutePlaytest,
    runFinalCouncil: input.generationSettings.qualityCouncilRunFinal,
    fusion: {
      enabled: input.generationSettings.qualityCouncilFusionEnabled,
      model: input.taskAssignments?.councilFusion?.model || 'openrouter/fusion',
      onlyWhen: input.generationSettings.qualityCouncilFusionOnlyWhen,
    },
    maxCouncilCallsPerRun: input.generationSettings.qualityCouncilMaxCalls,
    maxCandidateChoiceSets: input.generationSettings.qualityCouncilMaxChoiceCandidates,
  });

  // Resolve the provider/model for a given pipeline task. Prefers the per-task
  // assignment when supplied, otherwise falls back to the legacy single-model
  // fields so older callers keep their existing behavior.
  const resolveTask = (task: PipelineTask): TaskModelAssignment => {
    const assignment = input.taskAssignments?.[task];
    if (assignment) return assignment;
    if (task === 'image') return { provider: input.imageLlmProvider, model: input.imageLlmModel };
    if (task === 'video') return { provider: input.videoLlmProvider, model: input.videoLlmModel };
    return { provider: input.llmProvider, model: selectedLlmModel };
  };

  const buildAgentConfig = (
    task: PipelineTask,
    opts: { maxTokens: number; temperature: number },
  ) => {
    const { provider, model } = resolveTask(task);
    const agentConfig = {
      provider,
      model: getScopedLlmModel(provider, model),
      apiKey: getScopedLlmApiKey(provider, input),
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      openaiReasoningEffort: input.openaiSettings?.reasoningEffort || DEFAULT_OPENAI_SETTINGS.reasoningEffort,
      openaiForceJsonResponse: input.openaiSettings?.forceJsonResponse ?? DEFAULT_OPENAI_SETTINGS.forceJsonResponse,
    };
    if (provider === 'openrouter' && task === 'councilFusion') {
      return {
        ...agentConfig,
        model: qualityCouncil.fusion?.model || getScopedLlmModel(provider, model),
        openRouter: {
          route: 'fusion' as const,
          provider: {
            allowFallbacks: true,
            requireParameters: true,
          },
        },
      };
    }
    return agentConfig;
  };
  const councilAgentConfigs = qualityCouncil.enabled
    ? {
        qualityCouncilPlan: buildAgentConfig('councilPlan', { maxTokens: 4096, temperature: 0.25 }),
        qualityCouncilChoice: buildAgentConfig('councilChoice', { maxTokens: 4096, temperature: 0.25 }),
        qualityCouncilPlaytest: buildAgentConfig('councilPlaytest', { maxTokens: 4096, temperature: 0.25 }),
        qualityCouncilFinal: buildAgentConfig('councilFinal', { maxTokens: 4096, temperature: 0.2 }),
        qualityCouncilFusion: buildAgentConfig('councilFusion', { maxTokens: 8192, temperature: 0.2 }),
      }
    : {};

  return {
    agents: {
      // 32768: SeasonPlanner reuses the architect config and can emit large
      // treatment-derived season plans. Bite Me's 8-episode plan can exceed
      // 16k once Gemini thinking tokens are counted, causing MAX_TOKENS fallback.
      storyArchitect: buildAgentConfig('architect', { maxTokens: 32768, temperature: 0.7 }),
      // 16384: SceneWriter emits full multi-beat scenes and the validation/revision
      // loop can legitimately need more than 8192 tokens. Keep this aligned with
      // the default agent config; structured provider calls may floor low values,
      // but they must not silently undercut the pipeline's intended headroom.
      sceneWriter: buildAgentConfig('scene', { maxTokens: 16384, temperature: 0.85 }),
      // 16384: ChoiceAuthor emits dense structured JSON (choices, consequences, and
      // outcome tiers). A live Gemini structured call hit MAX_TOKENS at the old
      // 8192 runtime ceiling despite the default config documenting 16384.
      choiceAuthor: buildAgentConfig('choice', { maxTokens: 16384, temperature: 0.75 }),
      // Lower temperature for consistent grading; decorrelated from the author
      // when a distinct QA model is assigned (within the same family).
      qaRunner: buildAgentConfig('qa', { maxTokens: 4096, temperature: 0.3 }),
      // BranchManager only annotates a deterministic skeleton now — light enough
      // to ride the cheaper QA-tier model assignment (annotation temperature).
      branchManager: buildAgentConfig('qa', { maxTokens: 4096, temperature: 0.7 }),
      imagePlanner: buildAgentConfig('image', { maxTokens: 8192, temperature: 0.7 }),
      videoDirector: buildAgentConfig('video', { maxTokens: 8192, temperature: 0.7 }),
      ...councilAgentConfigs,
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
      openaiModeration: 'low',
      provider: normalizedImageProvider,
      storyboardV2: {
        maxPanelsPerSheet: input.generationSettings.storyboardMaxPanelsPerSheet || 6,
      },
      strategy: input.imageStrategy,
      atlasCloudApiKey: input.atlasCloudApiKey.trim() || undefined,
      atlasCloudModel: input.atlasCloudModel.trim() || undefined,
      midapiToken: input.midapiToken.trim() || undefined,
      panelMode: input.panelMode || 'single',
      imagePlanningMode: input.generationSettings.imagePlanningMode || 'text',
      requireCharacterRefsForVisibleCharacters: true,
      minRefsPerVisibleCharacter: 1,
      allowTextOnlyCharacterImages: false,
      midjourney: normalizedImageProvider === 'midapi' ? input.midjourneySettings : undefined,
      gemini: {
        ...(normalizedImageProvider === 'nano-banana' ? input.geminiSettings : {}),
        canonicalArtStyle:
          input.artStyle.trim() || composeCanonicalStyleString(artStyleProfile) || '',
      },
      stableDiffusion: resolveStableDiffusionSettings(normalizedImageProvider, input.stableDiffusionSettings),
      qa,
      artStyleProfile,
      preapprovedStyleAnchors: extras?.preapprovedStyleAnchors,
      uploadedStyleReferences: extras?.uploadedStyleReferences,
      styleReferenceStrength: extras?.styleReferenceStrength,
      loraTraining: resolveLoraTrainingSettings(env, input.loraTrainingSettings),
    },
    generation: {
      failurePolicy: input.generationSettings.failFastMode ? 'fail_fast' : 'recover',
      maxScenesPerEpisode: targetSceneCount,
      targetSceneCount,
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
      // Season Canon on by default; advisory gates unless explicitly set to block.
      seasonCanonEnabled:
        (input.generationSettings as { seasonCanonEnabled?: boolean }).seasonCanonEnabled ?? true,
      seasonCanonBlocking:
        (input.generationSettings as { seasonCanonBlocking?: boolean }).seasonCanonBlocking ?? true,
    },
    narration: {
      enabled: input.narrationSettings.enabled,
      provider: input.narrationSettings.provider || 'elevenlabs',
      elevenLabsApiKey: input.elevenLabsApiKey.trim() || undefined,
      geminiApiKey: input.geminiApiKey.trim() || undefined,
      geminiModel: input.narrationSettings.geminiModel || DEFAULT_GEMINI_TTS_MODEL,
      autoPlay: input.narrationSettings.autoPlay,
      preGenerateAudio: input.narrationSettings.preGenerateAudio,
      voiceId: input.narrationSettings.voiceId || undefined,
      voiceCastingEnabled: input.narrationSettings.voiceCastingEnabled !== false,
      performanceTagsEnabled: !!input.narrationSettings.performanceTagsEnabled,
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
    qualityCouncil,
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
