import {
  PipelineConfig,
  VideoSettingsConfig,
  GeminiSettings,
  MidjourneySettings,
  ImageProvider,
} from '../config';
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
  generationSettings: GenerationSettings;
  generationMode: GenerationMode;
  narrationSettings: GeneratorNarrationSettings;
  videoSettings: GeneratorVideoSettings;
}

function getSelectedLlmApiKey(input: BuildPipelineConfigInput): string {
  if (input.llmProvider === 'gemini') {
    return input.geminiApiKey.trim();
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

export function buildPipelineConfig(input: BuildPipelineConfigInput): PipelineConfig {
  const selectedLlmModel = getSelectedLlmModel(input);
  const selectedLlmApiKey = getSelectedLlmApiKey(input);
  const artStyle = input.artStyle.trim() || undefined;
  const normalizedImageProvider = normalizeImageProvider(input.imageProvider);

  return {
    agents: {
      storyArchitect: {
        provider: input.llmProvider,
        model: selectedLlmModel,
        apiKey: selectedLlmApiKey,
        maxTokens: 8192,
        temperature: 0.7,
      },
      sceneWriter: {
        provider: input.llmProvider,
        model: selectedLlmModel,
        apiKey: selectedLlmApiKey,
        maxTokens: 4096,
        temperature: 0.85,
      },
      choiceAuthor: {
        provider: input.llmProvider,
        model: selectedLlmModel,
        apiKey: selectedLlmApiKey,
        maxTokens: 4096,
        temperature: 0.75,
      },
      imagePlanner: {
        provider: input.imageLlmProvider,
        model: getScopedLlmModel(input.imageLlmProvider, input.imageLlmModel),
        apiKey: getScopedLlmApiKey(input.imageLlmProvider, input),
        maxTokens: 8192,
        temperature: 0.7,
      },
      videoDirector: {
        provider: input.videoLlmProvider,
        model: getScopedLlmModel(input.videoLlmProvider, input.videoLlmModel),
        apiKey: getScopedLlmApiKey(input.videoLlmProvider, input),
        maxTokens: 8192,
        temperature: 0.7,
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
      provider: normalizedImageProvider,
      strategy: input.imageStrategy,
      atlasCloudApiKey: input.atlasCloudApiKey.trim() || undefined,
      atlasCloudModel: input.atlasCloudModel.trim() || undefined,
      midapiToken: input.midapiToken.trim() || undefined,
      panelMode: input.panelMode || 'single',
      midjourney: normalizedImageProvider === 'midapi' ? input.midjourneySettings : undefined,
      gemini: normalizedImageProvider === 'nano-banana'
        ? { ...input.geminiSettings, canonicalArtStyle: input.artStyle.trim() || '' }
        : undefined,
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
