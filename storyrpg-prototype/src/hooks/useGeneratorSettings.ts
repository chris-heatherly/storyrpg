import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_GEMINI_SETTINGS,
  DEFAULT_OPENAI_SETTINGS,
  DEFAULT_LORA_TRAINING_SETTINGS,
  DEFAULT_MIDJOURNEY_SETTINGS,
  DEFAULT_STABLE_DIFFUSION_SETTINGS,
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_GEMINI_TTS_MODEL,
  GeminiSettings,
  LoraTrainingSettings,
  MidjourneySettings,
  OpenAISettings,
  StableDiffusionSettings,
} from '../ai-agents/config';
import { GenerationSettings, DEFAULT_GENERATION_SETTINGS } from '../components/GenerationSettingsPanel';
import { PROXY_CONFIG } from '../config/endpoints';
import { createLogger } from '../utils/logger';

const log = createLogger('GeneratorSettings');
import {
  DEFAULT_LLM_MODELS,
  DEFAULT_LLM_PROVIDER,
  FALLBACK_MODEL_OPTIONS,
  GenerationMode,
  GeneratorImageProvider,
  GeneratorLlmProvider,
} from '../config/generatorLlmOptions';
import {
  DEFAULT_MODEL_FAMILY,
  MODEL_FAMILY_PRESETS,
  PipelineTask,
  TaskModelAssignment,
  TaskModelOverrides,
  isPipelineTask,
  resolveTaskAssignments,
} from '../config/modelFamilies';

export interface GeneratorNarrationSettings {
  enabled: boolean;
  provider?: 'elevenlabs' | 'gemini';
  autoPlay: boolean;
  preGenerateAudio: boolean;
  voiceId: string;
  geminiModel?: string;
  voiceCastingEnabled?: boolean;
  performanceTagsEnabled?: boolean;
  highlightMode: 'none' | 'word' | 'sentence';
}

export interface GeneratorVideoSettings {
  enabled: boolean;
  model: string;
  durationSeconds: number;
  resolution: string;
  aspectRatio: string;
  strategy: string;
}

export const GENERATOR_STORAGE_KEYS = {
  anthropicApiKey: '@storyrpg_anthropic_api_key',
  openaiApiKey: '@storyrpg_openai_api_key',
  openRouterApiKey: '@storyrpg_openrouter_api_key',
  llmGeminiApiKey: '@storyrpg_llm_gemini_api_key',
  elevenLabsApiKey: '@storyrpg_elevenlabs_api_key',
  llmProvider: '@storyrpg_llm_provider',
  llmModel: '@storyrpg_llm_model',
  modelFamily: '@storyrpg_model_family',
  taskModelOverrides: '@storyrpg_task_model_overrides',
  imageLlmProvider: '@storyrpg_image_llm_provider',
  imageLlmModel: '@storyrpg_image_llm_model',
  videoLlmProvider: '@storyrpg_video_llm_provider',
  videoLlmModel: '@storyrpg_video_llm_model',
  memoryLlmProvider: '@storyrpg_memory_llm_provider',
  memoryLlmModel: '@storyrpg_memory_llm_model',
  generationMode: '@storyrpg_generation_mode',
  geminiApiKey: '@storyrpg_gemini_api_key',
  atlasCloudApiKey: '@storyrpg_atlas_cloud_api_key',
  atlasCloudModel: '@storyrpg_atlas_cloud_model',
  midapiToken: '@storyrpg_midapi_token',
  imageProvider: '@storyrpg_image_provider',
  artStyle: '@storyrpg_art_style',
  imageStrategy: '@storyrpg_image_strategy',
  generationSettings: '@storyrpg_generation_settings',
  narrationSettings: '@storyrpg_narration_settings',
  midjourneySettings: '@storyrpg_midjourney_settings',
  geminiSettings: '@storyrpg_gemini_settings',
  openaiSettings: '@storyrpg_openai_settings',
  videoSettings: '@storyrpg_video_settings',
  stableDiffusionSettings: '@storyrpg_stable_diffusion_settings',
  loraTrainingSettings: '@storyrpg_lora_training_settings',
} as const;

function isGeneratorLlmProvider(value: string | null | undefined): value is GeneratorLlmProvider {
  return value === 'anthropic' || value === 'openai' || value === 'gemini' || value === 'openrouter';
}

/**
 * The Cognee memory-graph LLM picker. `mirror` (the default) follows whatever
 * the narrative model is at run time. OpenRouter is excluded because Cognee's
 * settings API has no openrouter provider.
 */
export type GeneratorMemoryLlmProvider = 'mirror' | 'anthropic' | 'openai' | 'gemini';

function isGeneratorMemoryLlmProvider(value: string | null | undefined): value is GeneratorMemoryLlmProvider {
  return value === 'mirror' || value === 'anthropic' || value === 'openai' || value === 'gemini';
}

/**
 * Per-task override map. Image/video assignments live in their own dedicated
 * image/video state, so we keep every text/council task except image/video here.
 * An override may carry its own provider (to route a heavy task to a different,
 * more reliable provider than the family); when it omits one we default to the
 * supplied family so legacy model-only overrides keep working.
 */
function sanitizeNarrativeOverrides(
  raw: unknown,
  family: GeneratorLlmProvider,
): TaskModelOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const out: TaskModelOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPipelineTask(key) || key === 'image' || key === 'video') continue;
    const model = (value as { model?: unknown })?.model;
    const rawProvider = (value as { provider?: unknown })?.provider;
    const provider = isGeneratorLlmProvider(rawProvider as string) ? rawProvider as GeneratorLlmProvider : family;
    if (typeof model === 'string' && model.trim()) {
      out[key] = { provider, model: model.trim() };
    }
  }
  return out;
}

const INVALID_OPENAI_MODEL_SLUGS = new Set<string>([
  // Internal Cursor/agent routing slugs that were accidentally seeded as OpenAI API
  // model IDs. OpenAI's /v1/chat/completions rejects these with 404 model_not_found.
  'gpt-5.4-medium',
  'gpt-5.3-codex',
  'composer-1.5',
  'composer-2-fast',
]);

function resolveModelForProvider(provider: GeneratorLlmProvider, model: string | null | undefined): string {
  const trimmed = model?.trim();
  if (trimmed) {
    if (provider === 'openai' && INVALID_OPENAI_MODEL_SLUGS.has(trimmed)) {
      return DEFAULT_LLM_MODELS[provider];
    }
    return trimmed;
  }
  return DEFAULT_LLM_MODELS[provider];
}

function getDefaultNarrationSettings(): GeneratorNarrationSettings {
  return {
    enabled: false,
    provider: 'elevenlabs',
    autoPlay: false,
    preGenerateAudio: false,
    voiceId: '',
    geminiModel: DEFAULT_GEMINI_TTS_MODEL,
    voiceCastingEnabled: true,
    performanceTagsEnabled: false,
    highlightMode: 'word',
  };
}

function getDefaultVideoSettings(): GeneratorVideoSettings {
  // Video generation defaults to OFF. The user must explicitly opt in, and
  // that preference is then persisted to AsyncStorage and honored on reload
  // regardless of the legacy EXPO_PUBLIC_VIDEO_GENERATION_ENABLED env flag.
  return {
    enabled: false,
    model: process.env.EXPO_PUBLIC_VIDEO_MODEL || DEFAULT_VIDEO_SETTINGS.model,
    durationSeconds: parseInt(process.env.EXPO_PUBLIC_VIDEO_DURATION || '', 10) || DEFAULT_VIDEO_SETTINGS.durationSeconds,
    resolution: process.env.EXPO_PUBLIC_VIDEO_RESOLUTION || DEFAULT_VIDEO_SETTINGS.resolution,
    aspectRatio: process.env.EXPO_PUBLIC_VIDEO_ASPECT_RATIO || DEFAULT_VIDEO_SETTINGS.aspectRatio,
    strategy: process.env.EXPO_PUBLIC_VIDEO_STRATEGY || DEFAULT_VIDEO_SETTINGS.strategy,
  };
}

async function saveValue(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await AsyncStorage.removeItem(key);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

interface ProxySettingsShape {
  llmProvider?: string;
  llmModel?: string;
  modelFamily?: string;
  taskModelOverrides?: TaskModelOverrides;
  imageLlmProvider?: string;
  imageLlmModel?: string;
  videoLlmProvider?: string;
  videoLlmModel?: string;
  memoryLlmProvider?: string;
  memoryLlmModel?: string;
  generationMode?: string;
  imageProvider?: string;
  artStyle?: string;
  imageStrategy?: string;
  generationSettings?: GenerationSettings;
  narrationSettings?: GeneratorNarrationSettings;
  videoSettings?: GeneratorVideoSettings;
  geminiSettings?: GeminiSettings;
  openaiSettings?: OpenAISettings;
  midjourneySettings?: MidjourneySettings;
  stableDiffusionSettings?: StableDiffusionSettings;
  loraTrainingSettings?: LoraTrainingSettings;
  atlasCloudModel?: string;
}

function normalizeOpenAiSettings(settings?: Partial<OpenAISettings>): OpenAISettings {
  return {
    ...DEFAULT_OPENAI_SETTINGS,
    ...(settings || {}),
    imageModeration: 'low',
  };
}

async function loadProxySettings(): Promise<ProxySettingsShape | null> {
  try {
    const resp = await fetch(PROXY_CONFIG.generatorSettings);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

let patchTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPatch: Partial<ProxySettingsShape> = {};

function patchProxySettings(patch: Partial<ProxySettingsShape>): void {
  pendingPatch = { ...pendingPatch, ...patch };
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    const body = { ...pendingPatch };
    pendingPatch = {};
    patchTimer = null;
    fetch(PROXY_CONFIG.generatorSettings, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(err => log.debug('[GeneratorSettings] Proxy patch failed:', err.message));
  }, 500);
}

export function useGeneratorSettings() {
  const [llmProvider, setLlmProvider] = useState<GeneratorLlmProvider>(DEFAULT_LLM_PROVIDER);
  const [llmModel, setLlmModel] = useState<string>(DEFAULT_LLM_MODELS[DEFAULT_LLM_PROVIDER]);
  const [modelFamily, setModelFamily] = useState<GeneratorLlmProvider>(DEFAULT_MODEL_FAMILY);
  const [taskModelOverrides, setTaskModelOverrides] = useState<TaskModelOverrides>({});
  const [imageLlmProvider, setImageLlmProvider] = useState<GeneratorLlmProvider>(DEFAULT_LLM_PROVIDER);
  const [imageLlmModel, setImageLlmModel] = useState<string>(DEFAULT_LLM_MODELS[DEFAULT_LLM_PROVIDER]);
  const [videoLlmProvider, setVideoLlmProvider] = useState<GeneratorLlmProvider>(DEFAULT_LLM_PROVIDER);
  const [videoLlmModel, setVideoLlmModel] = useState<string>(DEFAULT_LLM_MODELS[DEFAULT_LLM_PROVIDER]);
  const [memoryLlmProvider, setMemoryLlmProvider] = useState<GeneratorMemoryLlmProvider>('mirror');
  const [memoryLlmModel, setMemoryLlmModel] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
  const [atlasCloudApiKey, setAtlasCloudApiKey] = useState('');
  const [atlasCloudModel, setAtlasCloudModel] = useState('bytedance/seedream-v4.5');
  const [midapiToken, setMidapiToken] = useState('');
  const [midjourneySettings, setMidjourneySettings] = useState<MidjourneySettings>({ ...DEFAULT_MIDJOURNEY_SETTINGS });
  const [geminiSettings, setGeminiSettings] = useState<GeminiSettings>({ ...DEFAULT_GEMINI_SETTINGS });
  const [openaiSettings, setOpenaiSettings] = useState<OpenAISettings>({ ...DEFAULT_OPENAI_SETTINGS });
  const [stableDiffusionSettings, setStableDiffusionSettings] = useState<StableDiffusionSettings>({ ...DEFAULT_STABLE_DIFFUSION_SETTINGS });
  const [loraTrainingSettings, setLoraTrainingSettings] = useState<LoraTrainingSettings>({ ...DEFAULT_LORA_TRAINING_SETTINGS });
  const [imageProvider, setImageProvider] = useState<GeneratorImageProvider>('nano-banana');
  const [artStyle, setArtStyle] = useState('');
  const [imageStrategy, setImageStrategy] = useState<'selective' | 'all-beats'>('all-beats');
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('advisory');
  const [narrationSettings, setNarrationSettings] = useState<GeneratorNarrationSettings>(getDefaultNarrationSettings());
  const [videoSettings, setVideoSettings] = useState<GeneratorVideoSettings>(getDefaultVideoSettings());

  const proxyLoadedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const applyProxySettings = (ps: ProxySettingsShape) => {
      if (!isMounted) return;

      const p: GeneratorLlmProvider = isGeneratorLlmProvider(ps.llmProvider) ? ps.llmProvider : DEFAULT_LLM_PROVIDER;
      setLlmProvider(p);
      setLlmModel(ps.llmModel || DEFAULT_LLM_MODELS[p]);

      const family: GeneratorLlmProvider = isGeneratorLlmProvider(ps.modelFamily) ? ps.modelFamily : p;
      setModelFamily(family);
      setTaskModelOverrides(sanitizeNarrativeOverrides(ps.taskModelOverrides, family));

      const ip: GeneratorLlmProvider = isGeneratorLlmProvider(ps.imageLlmProvider) ? ps.imageLlmProvider : p;
      setImageLlmProvider(ip);
      setImageLlmModel(ps.imageLlmModel || DEFAULT_LLM_MODELS[ip]);

      const vp: GeneratorLlmProvider = isGeneratorLlmProvider(ps.videoLlmProvider) ? ps.videoLlmProvider : p;
      setVideoLlmProvider(vp);
      setVideoLlmModel(ps.videoLlmModel || DEFAULT_LLM_MODELS[vp]);

      if (isGeneratorMemoryLlmProvider(ps.memoryLlmProvider)) {
        setMemoryLlmProvider(ps.memoryLlmProvider);
        setMemoryLlmModel(
          ps.memoryLlmProvider === 'mirror'
            ? ''
            : ps.memoryLlmModel || DEFAULT_LLM_MODELS[ps.memoryLlmProvider],
        );
      }

      if (ps.generationMode === 'strict' || ps.generationMode === 'advisory' || ps.generationMode === 'disabled') {
        setGenerationMode(ps.generationMode);
      }
      if (ps.imageProvider) {
        setImageProvider(ps.imageProvider as GeneratorImageProvider);
      }
      if (ps.artStyle !== undefined) setArtStyle(ps.artStyle || '');
      if (ps.imageStrategy) setImageStrategy(ps.imageStrategy as 'selective' | 'all-beats');
      if (ps.atlasCloudModel) setAtlasCloudModel(ps.atlasCloudModel);
      if (ps.generationSettings) {
        setGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, ...ps.generationSettings });
      }
      if (ps.narrationSettings) {
        setNarrationSettings(prev => ({ ...prev, ...ps.narrationSettings }));
      }
      if (ps.videoSettings) {
        // The user's saved `enabled` preference always wins. We intentionally
        // do not let the EXPO_PUBLIC_VIDEO_GENERATION_ENABLED env flag override
        // a persisted choice so toggling video off stays off across reloads.
        setVideoSettings(prev => ({ ...prev, ...ps.videoSettings }));
      }
      if (ps.geminiSettings) {
        setGeminiSettings({ ...DEFAULT_GEMINI_SETTINGS, ...ps.geminiSettings });
      }
      if (ps.openaiSettings) {
        setOpenaiSettings(normalizeOpenAiSettings(ps.openaiSettings));
      }
      if (ps.midjourneySettings) {
        setMidjourneySettings({ ...DEFAULT_MIDJOURNEY_SETTINGS, ...ps.midjourneySettings });
      }
      if (ps.stableDiffusionSettings) {
        setStableDiffusionSettings({ ...DEFAULT_STABLE_DIFFUSION_SETTINGS, ...ps.stableDiffusionSettings });
      }
      if (ps.loraTrainingSettings) {
        setLoraTrainingSettings({ ...DEFAULT_LORA_TRAINING_SETTINGS, ...ps.loraTrainingSettings });
      }
    };

    const loadAllSettings = async () => {
      // Try proxy (disk) first as source of truth
      const proxySettings = await loadProxySettings();
      if (proxySettings && Object.keys(proxySettings).length > 0) {
        proxyLoadedRef.current = true;
        applyProxySettings(proxySettings);
      }

      try {
        const storedLlmProvider = await AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.llmProvider);
        const resolvedProvider: GeneratorLlmProvider =
          isGeneratorLlmProvider(storedLlmProvider)
            ? storedLlmProvider
            : DEFAULT_LLM_PROVIDER;

        // Only apply AsyncStorage values if proxy didn't provide them
        if (!proxyLoadedRef.current) {
          if (isMounted) {
            setLlmProvider(resolvedProvider);
          }

          const storedLlmModel = await AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.llmModel);
          const resolvedLlmModel = resolveModelForProvider(resolvedProvider, storedLlmModel);
          if (isMounted) {
            setLlmModel(resolvedLlmModel);
          }

          // Model family + per-task narrative overrides. Migrate from the legacy
          // single-provider when no family was persisted (existing users adopt
          // the family preset for their current provider).
          const [storedModelFamily, storedTaskOverrides] = await Promise.all([
            AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.modelFamily),
            AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.taskModelOverrides),
          ]);
          const resolvedFamily = isGeneratorLlmProvider(storedModelFamily)
            ? storedModelFamily
            : resolvedProvider;
          let parsedOverrides: unknown = undefined;
          if (storedTaskOverrides) {
            try {
              parsedOverrides = JSON.parse(storedTaskOverrides);
            } catch (_) {}
          }
          if (isMounted) {
            setModelFamily(resolvedFamily);
            setTaskModelOverrides(sanitizeNarrativeOverrides(parsedOverrides, resolvedFamily));
          }

          const storedGenerationMode = await AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.generationMode);
          if (isMounted && (storedGenerationMode === 'strict' || storedGenerationMode === 'advisory' || storedGenerationMode === 'disabled')) {
            setGenerationMode(storedGenerationMode);
          }
        }

        const storedLlmModel = await AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.llmModel);
        const resolvedLlmModel = resolveModelForProvider(resolvedProvider, storedLlmModel);

        const [
          storedAnthropicKey,
          storedOpenaiApiKey,
          storedOpenRouterApiKey,
          storedLlmGeminiKey,
          storedElevenLabsApiKey,
          storedImageLlmProvider,
          storedImageLlmModel,
          storedVideoLlmProvider,
          storedVideoLlmModel,
          storedMemoryLlmProvider,
          storedMemoryLlmModel,
          storedGeminiKey,
          storedAtlasKey,
          storedAtlasModel,
          storedMidapiToken,
          storedGeminiSettings,
          storedOpenaiSettings,
          storedMidjourneySettings,
          storedImageProvider,
          storedArtStyle,
          storedGenerationSettings,
          storedNarrationSettings,
          storedVideoSettings,
          storedStableDiffusionSettings,
          storedLoraTrainingSettings,
        ] = await Promise.all([
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.anthropicApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.openaiApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.openRouterApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.llmGeminiApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.elevenLabsApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.imageLlmProvider),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.imageLlmModel),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.videoLlmProvider),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.videoLlmModel),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.memoryLlmProvider),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.memoryLlmModel),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.geminiApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.atlasCloudApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.atlasCloudModel),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.midapiToken),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.geminiSettings),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.openaiSettings),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.midjourneySettings),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.imageProvider),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.artStyle),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.generationSettings),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.narrationSettings),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.videoSettings),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.stableDiffusionSettings),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.loraTrainingSettings),
        ]);

        if (!isMounted) return;

        // API keys always come from AsyncStorage (never stored on proxy for security)
        if (storedAnthropicKey) setApiKey(storedAnthropicKey);
        if (storedOpenaiApiKey) setOpenaiApiKey(storedOpenaiApiKey);
        if (storedOpenRouterApiKey) setOpenRouterApiKey(storedOpenRouterApiKey);
        if (storedGeminiKey || storedLlmGeminiKey) {
          setGeminiApiKey(storedGeminiKey || storedLlmGeminiKey || '');
        }
        if (storedElevenLabsApiKey) {
          setElevenLabsApiKey(storedElevenLabsApiKey);
        }
        if (storedAtlasKey) setAtlasCloudApiKey(storedAtlasKey);
        if (storedMidapiToken) setMidapiToken(storedMidapiToken);

        // Only apply remaining AsyncStorage values if proxy didn't load
        if (!proxyLoadedRef.current) {
          const resolvedImageProvider = isGeneratorLlmProvider(storedImageLlmProvider)
            ? storedImageLlmProvider
            : resolvedProvider;
          const resolvedVideoProvider = isGeneratorLlmProvider(storedVideoLlmProvider)
            ? storedVideoLlmProvider
            : resolvedProvider;

          setImageLlmProvider(resolvedImageProvider);
          setImageLlmModel(
            storedImageLlmModel
              ? resolveModelForProvider(resolvedImageProvider, storedImageLlmModel)
              : resolvedImageProvider === resolvedProvider
                ? resolvedLlmModel
                : DEFAULT_LLM_MODELS[resolvedImageProvider]
          );
          setVideoLlmProvider(resolvedVideoProvider);
          setVideoLlmModel(
            storedVideoLlmModel
              ? resolveModelForProvider(resolvedVideoProvider, storedVideoLlmModel)
              : resolvedVideoProvider === resolvedProvider
                ? resolvedLlmModel
                : DEFAULT_LLM_MODELS[resolvedVideoProvider]
          );

          if (isGeneratorMemoryLlmProvider(storedMemoryLlmProvider)) {
            setMemoryLlmProvider(storedMemoryLlmProvider);
            setMemoryLlmModel(
              storedMemoryLlmProvider === 'mirror'
                ? ''
                : resolveModelForProvider(storedMemoryLlmProvider, storedMemoryLlmModel),
            );
          }

          if (storedAtlasModel) setAtlasCloudModel(storedAtlasModel);

          if (storedGeminiSettings) {
            try {
              setGeminiSettings({ ...DEFAULT_GEMINI_SETTINGS, ...JSON.parse(storedGeminiSettings) });
            } catch (_) {}
          }
          if (storedOpenaiSettings) {
            try {
              setOpenaiSettings(normalizeOpenAiSettings(JSON.parse(storedOpenaiSettings)));
            } catch (_) {}
          }

          if (storedMidjourneySettings) {
            try {
              setMidjourneySettings({ ...DEFAULT_MIDJOURNEY_SETTINGS, ...JSON.parse(storedMidjourneySettings) });
            } catch (_) {}
          }

          if (storedImageProvider) {
            const migratedProvider =
              storedImageProvider === 'useapi'
                ? 'midapi'
                : storedImageProvider === 'scenario-gg'
                  ? 'atlas-cloud'
                  : storedImageProvider;
            setImageProvider(migratedProvider as GeneratorImageProvider);
          }

          if (storedArtStyle) setArtStyle(storedArtStyle);

          if (storedGenerationSettings) {
            try {
              setGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, ...JSON.parse(storedGenerationSettings) });
            } catch (_) {}
          }

          if (storedNarrationSettings) {
            try {
              const parsedNarrationSettings = JSON.parse(storedNarrationSettings);
              if (!storedElevenLabsApiKey && typeof parsedNarrationSettings.elevenLabsApiKey === 'string') {
                setElevenLabsApiKey(parsedNarrationSettings.elevenLabsApiKey);
              }
              delete parsedNarrationSettings.elevenLabsApiKey;
              setNarrationSettings((current) => ({ ...current, ...parsedNarrationSettings }));
            } catch (_) {}
          }

          if (storedVideoSettings) {
            try {
              const parsedVideoSettings = JSON.parse(storedVideoSettings);
              // Always honor the persisted `enabled` flag; the env var is not
              // allowed to flip a user-chosen off state back on at load time.
              setVideoSettings((current) => ({ ...current, ...parsedVideoSettings }));
            } catch (_) {}
          }

          if (storedStableDiffusionSettings) {
            try {
              setStableDiffusionSettings({ ...DEFAULT_STABLE_DIFFUSION_SETTINGS, ...JSON.parse(storedStableDiffusionSettings) });
            } catch (_) {}
          }

          if (storedLoraTrainingSettings) {
            try {
              setLoraTrainingSettings({ ...DEFAULT_LORA_TRAINING_SETTINGS, ...JSON.parse(storedLoraTrainingSettings) });
            } catch (_) {}
          }
        }
      } catch (error) {
        log.debug('Failed to load generator settings from AsyncStorage:', error);
      }
    };

    loadAllSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLlmProviderChange = useCallback(async (provider: GeneratorLlmProvider) => {
    setLlmProvider(provider);
    const validModels = FALLBACK_MODEL_OPTIONS[provider].map((option) => option.value);
    const needsReset = !validModels.includes(llmModel.trim());
    const newModel = needsReset ? DEFAULT_LLM_MODELS[provider] : llmModel;
    if (needsReset) {
      setLlmModel(newModel);
    }
    patchProxySettings({ llmProvider: provider, llmModel: newModel });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.llmProvider, provider);
      if (needsReset) {
        await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.llmModel, newModel);
      }
    } catch (error) {
      log.debug('Failed to save LLM provider:', error);
    }
  }, [llmModel]);

  const handleLlmModelChange = useCallback(async (model: string) => {
    setLlmModel(model);
    patchProxySettings({ llmModel: model.trim() || undefined });
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.llmModel, model.trim() ? model.trim() : null);
    } catch (error) {
      log.debug('Failed to save LLM model:', error);
    }
  }, []);

  const handleImageLlmProviderChange = useCallback(async (provider: GeneratorLlmProvider) => {
    setImageLlmProvider(provider);
    const validModels = FALLBACK_MODEL_OPTIONS[provider].map((option) => option.value);
    const nextModel = validModels.includes(imageLlmModel.trim()) ? imageLlmModel : DEFAULT_LLM_MODELS[provider];
    if (nextModel !== imageLlmModel) {
      setImageLlmModel(nextModel);
    }
    patchProxySettings({ imageLlmProvider: provider, imageLlmModel: nextModel });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.imageLlmProvider, provider);
      if (nextModel !== imageLlmModel) {
        await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.imageLlmModel, nextModel);
      }
    } catch (error) {
      log.debug('Failed to save image LLM provider:', error);
    }
  }, [imageLlmModel]);

  const handleImageLlmModelChange = useCallback(async (model: string) => {
    setImageLlmModel(model);
    patchProxySettings({ imageLlmModel: model.trim() || undefined });
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.imageLlmModel, model.trim() ? model.trim() : null);
    } catch (error) {
      log.debug('Failed to save image LLM model:', error);
    }
  }, []);

  const handleMemoryLlmProviderChange = useCallback(async (provider: GeneratorMemoryLlmProvider) => {
    setMemoryLlmProvider(provider);
    const nextModel = provider === 'mirror'
      ? ''
      : (FALLBACK_MODEL_OPTIONS[provider].map((option) => option.value).includes(memoryLlmModel.trim())
          ? memoryLlmModel
          : DEFAULT_LLM_MODELS[provider]);
    if (nextModel !== memoryLlmModel) {
      setMemoryLlmModel(nextModel);
    }
    patchProxySettings({ memoryLlmProvider: provider, memoryLlmModel: nextModel || undefined });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.memoryLlmProvider, provider);
      await saveValue(GENERATOR_STORAGE_KEYS.memoryLlmModel, nextModel || null);
    } catch (error) {
      log.debug('Failed to save memory LLM provider:', error);
    }
  }, [memoryLlmModel]);

  const handleMemoryLlmModelChange = useCallback(async (model: string) => {
    setMemoryLlmModel(model);
    patchProxySettings({ memoryLlmModel: model.trim() || undefined });
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.memoryLlmModel, model.trim() ? model.trim() : null);
    } catch (error) {
      log.debug('Failed to save memory LLM model:', error);
    }
  }, []);

  const handleVideoLlmProviderChange = useCallback(async (provider: GeneratorLlmProvider) => {
    setVideoLlmProvider(provider);
    const validModels = FALLBACK_MODEL_OPTIONS[provider].map((option) => option.value);
    const nextModel = validModels.includes(videoLlmModel.trim()) ? videoLlmModel : DEFAULT_LLM_MODELS[provider];
    if (nextModel !== videoLlmModel) {
      setVideoLlmModel(nextModel);
    }
    patchProxySettings({ videoLlmProvider: provider, videoLlmModel: nextModel });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.videoLlmProvider, provider);
      if (nextModel !== videoLlmModel) {
        await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.videoLlmModel, nextModel);
      }
    } catch (error) {
      log.debug('Failed to save video LLM provider:', error);
    }
  }, [videoLlmModel]);

  const handleVideoLlmModelChange = useCallback(async (model: string) => {
    setVideoLlmModel(model);
    patchProxySettings({ videoLlmModel: model.trim() || undefined });
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.videoLlmModel, model.trim() ? model.trim() : null);
    } catch (error) {
      log.debug('Failed to save video LLM model:', error);
    }
  }, []);

  const persistTaskOverrides = useCallback(async (next: TaskModelOverrides) => {
    patchProxySettings({ taskModelOverrides: next });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.taskModelOverrides, JSON.stringify(next));
    } catch (error) {
      log.debug('Failed to save task model overrides:', error);
    }
  }, []);

  // Switching the model family resets all per-task overrides to the family's
  // preset, and seeds the legacy narrative + image/video fields so existing
  // consumers (StyleArchitect, source analysis, image/video dropdowns) stay
  // coherent. Narrative tasks are locked to the family provider downstream.
  const handleModelFamilyChange = useCallback(async (family: GeneratorLlmProvider) => {
    const preset = MODEL_FAMILY_PRESETS[family];
    const headlineModel = preset.assignments.architect.model;
    const img = preset.assignments.image;
    const vid = preset.assignments.video;
    setModelFamily(family);
    setTaskModelOverrides({});
    setLlmProvider(family);
    setLlmModel(headlineModel);
    setImageLlmProvider(img.provider);
    setImageLlmModel(img.model);
    setVideoLlmProvider(vid.provider);
    setVideoLlmModel(vid.model);
    patchProxySettings({
      modelFamily: family,
      taskModelOverrides: {},
      llmProvider: family,
      llmModel: headlineModel,
      imageLlmProvider: img.provider,
      imageLlmModel: img.model,
      videoLlmProvider: vid.provider,
      videoLlmModel: vid.model,
    });
    try {
      await AsyncStorage.multiSet([
        [GENERATOR_STORAGE_KEYS.modelFamily, family],
        [GENERATOR_STORAGE_KEYS.taskModelOverrides, JSON.stringify({})],
        [GENERATOR_STORAGE_KEYS.llmProvider, family],
        [GENERATOR_STORAGE_KEYS.llmModel, headlineModel],
        [GENERATOR_STORAGE_KEYS.imageLlmProvider, img.provider],
        [GENERATOR_STORAGE_KEYS.imageLlmModel, img.model],
        [GENERATOR_STORAGE_KEYS.videoLlmProvider, vid.provider],
        [GENERATOR_STORAGE_KEYS.videoLlmModel, vid.model],
      ]);
    } catch (error) {
      log.debug('Failed to save model family:', error);
    }
  }, []);

  // Change the model for a single task. Image/video delegate to their existing
  // dedicated handlers (cross-provider, own persistence); narrative tasks store
  // an override, preserving any per-task provider the user already chose (so
  // editing the model of a Claude-routed task doesn't snap it back to the family).
  const handleTaskModelChange = useCallback(async (task: PipelineTask, model: string) => {
    if (task === 'image') {
      await handleImageLlmModelChange(model);
      return;
    }
    if (task === 'video') {
      await handleVideoLlmModelChange(model);
      return;
    }
    setTaskModelOverrides((prev) => {
      const provider = prev[task]?.provider ?? modelFamily;
      const next: TaskModelOverrides = { ...prev, [task]: { provider, model } };
      void persistTaskOverrides(next);
      return next;
    });
  }, [modelFamily, handleImageLlmModelChange, handleVideoLlmModelChange, persistTaskOverrides]);

  // Route a single task to a specific provider. Image/video delegate to their
  // dedicated cross-provider handlers; narrative tasks store a provider override
  // seeded with that provider's preset model so the model id is always valid.
  // This is what lets the heavy structured agents (architect / scene / choice —
  // which also drive the Season Planner and Encounter Architect) run on a more
  // reliable provider (e.g. Claude) while QA stays on a cheaper one.
  const handleTaskProviderChange = useCallback(async (task: PipelineTask, provider: GeneratorLlmProvider) => {
    if (task === 'image') {
      await handleImageLlmProviderChange(provider);
      return;
    }
    if (task === 'video') {
      await handleVideoLlmProviderChange(provider);
      return;
    }
    const presetModel =
      MODEL_FAMILY_PRESETS[provider]?.assignments[task]?.model || DEFAULT_LLM_MODELS[provider];
    setTaskModelOverrides((prev) => {
      const next: TaskModelOverrides = { ...prev, [task]: { provider, model: presetModel } };
      void persistTaskOverrides(next);
      return next;
    });
  }, [handleImageLlmProviderChange, handleVideoLlmProviderChange, persistTaskOverrides]);

  // Reset a single task back to its family preset.
  const resetTaskModel = useCallback(async (task: PipelineTask) => {
    const preset = MODEL_FAMILY_PRESETS[modelFamily];
    if (task === 'image') {
      await handleImageLlmProviderChange(preset.assignments.image.provider);
      await handleImageLlmModelChange(preset.assignments.image.model);
      return;
    }
    if (task === 'video') {
      await handleVideoLlmProviderChange(preset.assignments.video.provider);
      await handleVideoLlmModelChange(preset.assignments.video.model);
      return;
    }
    setTaskModelOverrides((prev) => {
      const next: TaskModelOverrides = { ...prev };
      delete next[task];
      void persistTaskOverrides(next);
      return next;
    });
  }, [
    modelFamily,
    handleImageLlmProviderChange,
    handleImageLlmModelChange,
    handleVideoLlmProviderChange,
    handleVideoLlmModelChange,
    persistTaskOverrides,
  ]);

  const handleGenerationModeChange = useCallback(async (mode: GenerationMode) => {
    setGenerationMode(mode);
    patchProxySettings({ generationMode: mode });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.generationMode, mode);
    } catch (error) {
      log.debug('Failed to save generation mode:', error);
    }
  }, []);

  const handleApiKeyChange = useCallback(async (key: string) => {
    setApiKey(key);
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.anthropicApiKey, key.trim() ? key : null);
    } catch (error) {
      log.debug('Failed to save API key:', error);
    }
  }, []);

  const handleGeminiApiKeyChange = useCallback(async (key: string) => {
    setGeminiApiKey(key);
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.geminiApiKey, key.trim() ? key : null);
    } catch (error) {
      log.debug('Failed to save Gemini API key:', error);
    }
  }, []);

  const handleOpenaiApiKeyChange = useCallback(async (key: string) => {
    setOpenaiApiKey(key);
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.openaiApiKey, key.trim() ? key : null);
    } catch (error) {
      log.debug('Failed to save OpenAI API key:', error);
    }
  }, []);

  const handleOpenRouterApiKeyChange = useCallback(async (key: string) => {
    setOpenRouterApiKey(key);
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.openRouterApiKey, key.trim() ? key : null);
    } catch (error) {
      log.debug('Failed to save OpenRouter API key:', error);
    }
  }, []);

  const handleElevenLabsApiKeyChange = useCallback(async (key: string) => {
    setElevenLabsApiKey(key);
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.elevenLabsApiKey, key.trim() ? key : null);
    } catch (error) {
      log.debug('Failed to save ElevenLabs API key:', error);
    }
  }, []);

  const handleAtlasCloudApiKeyChange = useCallback(async (key: string) => {
    setAtlasCloudApiKey(key);
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.atlasCloudApiKey, key.trim() ? key : null);
    } catch (error) {
      log.debug('Failed to save Atlas Cloud API key:', error);
    }
  }, []);

  const handleAtlasCloudModelChange = useCallback(async (modelId: string) => {
    setAtlasCloudModel(modelId);
    patchProxySettings({ atlasCloudModel: modelId });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.atlasCloudModel, modelId);
    } catch (error) {
      log.debug('Failed to save Atlas Cloud model:', error);
    }
  }, []);

  const handleMidapiTokenChange = useCallback(async (token: string) => {
    setMidapiToken(token);
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.midapiToken, token.trim() ? token : null);
    } catch (error) {
      log.debug('Failed to save MidAPI token:', error);
    }
  }, []);

  const handleGeminiSettingsChange = useCallback(async (newSettings: Partial<GeminiSettings>) => {
    const updated = { ...geminiSettings, ...newSettings };
    setGeminiSettings(updated);
    patchProxySettings({ geminiSettings: updated });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.geminiSettings, JSON.stringify(updated));
    } catch (error) {
      log.debug('Failed to save Gemini settings:', error);
    }
  }, [geminiSettings]);

  const handleOpenaiSettingsChange = useCallback(async (newSettings: Partial<OpenAISettings>) => {
    const updated = normalizeOpenAiSettings({ ...openaiSettings, ...newSettings });
    setOpenaiSettings(updated);
    patchProxySettings({ openaiSettings: updated });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.openaiSettings, JSON.stringify(updated));
    } catch (error) {
      log.debug('Failed to save OpenAI settings:', error);
    }
  }, [openaiSettings]);

  const handleMidjourneySettingsChange = useCallback(async (newSettings: Partial<MidjourneySettings>) => {
    const updated = { ...midjourneySettings, ...newSettings };
    setMidjourneySettings(updated);
    patchProxySettings({ midjourneySettings: updated });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.midjourneySettings, JSON.stringify(updated));
    } catch (error) {
      log.debug('Failed to save Midjourney settings:', error);
    }
  }, [midjourneySettings]);

  const handleStableDiffusionSettingsChange = useCallback(async (newSettings: Partial<StableDiffusionSettings>) => {
    const updated = { ...stableDiffusionSettings, ...newSettings };
    setStableDiffusionSettings(updated);
    patchProxySettings({ stableDiffusionSettings: updated });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.stableDiffusionSettings, JSON.stringify(updated));
    } catch (error) {
      log.debug('Failed to save Stable Diffusion settings:', error);
    }
  }, [stableDiffusionSettings]);

  // Deep-merges partial LoRA training settings (supports nested `training`
  // and `characterThresholds` / `styleThresholds` patches). Persists to
  // both AsyncStorage and the proxy disk cache.
  const handleLoraTrainingSettingsChange = useCallback(async (newSettings: Partial<LoraTrainingSettings>) => {
    const updated: LoraTrainingSettings = {
      ...loraTrainingSettings,
      ...newSettings,
      characterThresholds: {
        ...loraTrainingSettings.characterThresholds,
        ...(newSettings.characterThresholds || {}),
      },
      styleThresholds: {
        ...loraTrainingSettings.styleThresholds,
        ...(newSettings.styleThresholds || {}),
      },
      training: {
        ...loraTrainingSettings.training,
        ...(newSettings.training || {}),
      },
    };
    setLoraTrainingSettings(updated);
    patchProxySettings({ loraTrainingSettings: updated });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.loraTrainingSettings, JSON.stringify(updated));
    } catch (error) {
      log.debug('Failed to save LoRA training settings:', error);
    }
  }, [loraTrainingSettings]);

  const handleImageProviderChange = useCallback(async (provider: GeneratorImageProvider) => {
    setImageProvider(provider);
    patchProxySettings({ imageProvider: provider });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.imageProvider, provider);
    } catch (error) {
      log.debug('Failed to save image provider:', error);
    }
  }, []);

  const handleArtStyleChange = useCallback(async (style: string) => {
    setArtStyle(style);
    patchProxySettings({ artStyle: style || '' });
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.artStyle, style.trim() ? style : null);
    } catch (error) {
      log.debug('Failed to save art style:', error);
    }
  }, []);

  const handleImageStrategyChange = useCallback(async (strategy: 'selective' | 'all-beats') => {
    setImageStrategy(strategy);
    patchProxySettings({ imageStrategy: strategy });
    try {
      await saveValue(GENERATOR_STORAGE_KEYS.imageStrategy, strategy);
    } catch (error) {
      log.debug('Failed to save image strategy:', error);
    }
  }, []);

  const handleGenerationSettingsChange = useCallback(async (settings: GenerationSettings) => {
    setGenerationSettings(settings);
    patchProxySettings({ generationSettings: settings });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.generationSettings, JSON.stringify(settings));
    } catch (error) {
      log.debug('Failed to save generation settings:', error);
    }
  }, []);

  const updateNarrationSetting = useCallback(async <K extends keyof GeneratorNarrationSettings>(
    key: K,
    value: GeneratorNarrationSettings[K],
  ) => {
    const updated = { ...narrationSettings, [key]: value };
    setNarrationSettings(updated);
    patchProxySettings({ narrationSettings: updated });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.narrationSettings, JSON.stringify(updated));
    } catch (error) {
      log.debug('Failed to save narration settings:', error);
    }
  }, [narrationSettings]);

  const updateVideoSetting = useCallback(async <K extends keyof GeneratorVideoSettings>(
    key: K,
    value: GeneratorVideoSettings[K],
  ) => {
    const updated = { ...videoSettings, [key]: value };
    setVideoSettings(updated);
    patchProxySettings({ videoSettings: updated });
    try {
      await AsyncStorage.setItem(GENERATOR_STORAGE_KEYS.videoSettings, JSON.stringify(updated));
    } catch (error) {
      log.debug('Failed to save video settings:', error);
    }
  }, [videoSettings]);

  // The single source of truth handed to buildPipelineConfig. Narrative tasks
  // come from the family preset merged with overrides (provider locked to the
  // family); image/video reflect their dedicated cross-provider state.
  const narrativeAssignments = resolveTaskAssignments(modelFamily, taskModelOverrides);
  const effectiveTaskAssignments: Record<PipelineTask, TaskModelAssignment> = {
    ...narrativeAssignments,
    image: { provider: imageLlmProvider, model: imageLlmModel },
    video: { provider: videoLlmProvider, model: videoLlmModel },
  };

  return {
    llmProvider,
    llmModel,
    modelFamily,
    taskModelOverrides,
    effectiveTaskAssignments,
    imageLlmProvider,
    imageLlmModel,
    videoLlmProvider,
    videoLlmModel,
    memoryLlmProvider,
    memoryLlmModel,
    apiKey,
    openaiApiKey,
    openRouterApiKey,
    geminiApiKey,
    elevenLabsApiKey,
    atlasCloudApiKey,
    atlasCloudModel,
    midapiToken,
    midjourneySettings,
    geminiSettings,
    openaiSettings,
    stableDiffusionSettings,
    loraTrainingSettings,
    imageProvider,
    artStyle,
    imageStrategy,
    generationSettings,
    generationMode,
    narrationSettings,
    videoSettings,
    handleLlmProviderChange,
    handleLlmModelChange,
    handleModelFamilyChange,
    handleTaskModelChange,
    handleTaskProviderChange,
    resetTaskModel,
    handleImageLlmProviderChange,
    handleImageLlmModelChange,
    handleVideoLlmProviderChange,
    handleVideoLlmModelChange,
    handleMemoryLlmProviderChange,
    handleMemoryLlmModelChange,
    handleGenerationModeChange,
    handleApiKeyChange,
    handleOpenaiApiKeyChange,
    handleOpenRouterApiKeyChange,
    handleGeminiApiKeyChange,
    handleElevenLabsApiKeyChange,
    handleAtlasCloudApiKeyChange,
    handleAtlasCloudModelChange,
    handleMidapiTokenChange,
    handleGeminiSettingsChange,
    handleOpenaiSettingsChange,
    handleMidjourneySettingsChange,
    handleStableDiffusionSettingsChange,
    handleLoraTrainingSettingsChange,
    handleImageProviderChange,
    handleArtStyleChange,
    handleImageStrategyChange,
    handleGenerationSettingsChange,
    updateNarrationSetting,
    updateVideoSetting,
  };
}
