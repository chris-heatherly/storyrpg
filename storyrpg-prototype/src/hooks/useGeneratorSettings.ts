import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_GEMINI_SETTINGS,
  DEFAULT_LORA_TRAINING_SETTINGS,
  DEFAULT_MIDJOURNEY_SETTINGS,
  DEFAULT_STABLE_DIFFUSION_SETTINGS,
  DEFAULT_VIDEO_SETTINGS,
  GeminiSettings,
  LoraTrainingSettings,
  MidjourneySettings,
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

export interface GeneratorNarrationSettings {
  enabled: boolean;
  autoPlay: boolean;
  preGenerateAudio: boolean;
  voiceId: string;
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
  llmGeminiApiKey: '@storyrpg_llm_gemini_api_key',
  elevenLabsApiKey: '@storyrpg_elevenlabs_api_key',
  llmProvider: '@storyrpg_llm_provider',
  llmModel: '@storyrpg_llm_model',
  imageLlmProvider: '@storyrpg_image_llm_provider',
  imageLlmModel: '@storyrpg_image_llm_model',
  videoLlmProvider: '@storyrpg_video_llm_provider',
  videoLlmModel: '@storyrpg_video_llm_model',
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
  videoSettings: '@storyrpg_video_settings',
  stableDiffusionSettings: '@storyrpg_stable_diffusion_settings',
  loraTrainingSettings: '@storyrpg_lora_training_settings',
} as const;

function isGeneratorLlmProvider(value: string | null | undefined): value is GeneratorLlmProvider {
  return value === 'anthropic' || value === 'gemini';
}

function resolveModelForProvider(provider: GeneratorLlmProvider, model: string | null | undefined): string {
  const trimmed = model?.trim();
  if (trimmed) return trimmed;
  return DEFAULT_LLM_MODELS[provider];
}

function getDefaultNarrationSettings(): GeneratorNarrationSettings {
  return {
    enabled: false,
    autoPlay: false,
    preGenerateAudio: false,
    voiceId: '',
    highlightMode: 'word',
  };
}

function getDefaultVideoSettings(): GeneratorVideoSettings {
  return {
    enabled: process.env.EXPO_PUBLIC_VIDEO_GENERATION_ENABLED === 'true',
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
  imageLlmProvider?: string;
  imageLlmModel?: string;
  videoLlmProvider?: string;
  videoLlmModel?: string;
  generationMode?: string;
  imageProvider?: string;
  artStyle?: string;
  imageStrategy?: string;
  generationSettings?: GenerationSettings;
  narrationSettings?: GeneratorNarrationSettings;
  videoSettings?: GeneratorVideoSettings;
  geminiSettings?: GeminiSettings;
  midjourneySettings?: MidjourneySettings;
  stableDiffusionSettings?: StableDiffusionSettings;
  loraTrainingSettings?: LoraTrainingSettings;
  atlasCloudModel?: string;
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
  const [imageLlmProvider, setImageLlmProvider] = useState<GeneratorLlmProvider>(DEFAULT_LLM_PROVIDER);
  const [imageLlmModel, setImageLlmModel] = useState<string>(DEFAULT_LLM_MODELS[DEFAULT_LLM_PROVIDER]);
  const [videoLlmProvider, setVideoLlmProvider] = useState<GeneratorLlmProvider>(DEFAULT_LLM_PROVIDER);
  const [videoLlmModel, setVideoLlmModel] = useState<string>(DEFAULT_LLM_MODELS[DEFAULT_LLM_PROVIDER]);
  const [apiKey, setApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
  const [atlasCloudApiKey, setAtlasCloudApiKey] = useState('');
  const [atlasCloudModel, setAtlasCloudModel] = useState('bytedance/seedream-v4.5');
  const [midapiToken, setMidapiToken] = useState('');
  const [midjourneySettings, setMidjourneySettings] = useState<MidjourneySettings>({ ...DEFAULT_MIDJOURNEY_SETTINGS });
  const [geminiSettings, setGeminiSettings] = useState<GeminiSettings>({ ...DEFAULT_GEMINI_SETTINGS });
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

      const ip: GeneratorLlmProvider = isGeneratorLlmProvider(ps.imageLlmProvider) ? ps.imageLlmProvider : p;
      setImageLlmProvider(ip);
      setImageLlmModel(ps.imageLlmModel || DEFAULT_LLM_MODELS[ip]);

      const vp: GeneratorLlmProvider = isGeneratorLlmProvider(ps.videoLlmProvider) ? ps.videoLlmProvider : p;
      setVideoLlmProvider(vp);
      setVideoLlmModel(ps.videoLlmModel || DEFAULT_LLM_MODELS[vp]);

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
        const vs = { ...ps.videoSettings };
        if (process.env.EXPO_PUBLIC_VIDEO_GENERATION_ENABLED === 'true') delete (vs as any).enabled;
        setVideoSettings(prev => ({ ...prev, ...vs }));
      }
      if (ps.geminiSettings) {
        setGeminiSettings({ ...DEFAULT_GEMINI_SETTINGS, ...ps.geminiSettings });
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
          storedLlmProvider === 'anthropic' || storedLlmProvider === 'gemini'
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

          const storedGenerationMode = await AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.generationMode);
          if (isMounted && (storedGenerationMode === 'strict' || storedGenerationMode === 'advisory' || storedGenerationMode === 'disabled')) {
            setGenerationMode(storedGenerationMode);
          }
        }

        const storedLlmModel = await AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.llmModel);
        const resolvedLlmModel = resolveModelForProvider(resolvedProvider, storedLlmModel);

        const [
          storedAnthropicKey,
          storedLlmGeminiKey,
          storedElevenLabsApiKey,
          storedImageLlmProvider,
          storedImageLlmModel,
          storedVideoLlmProvider,
          storedVideoLlmModel,
          storedGeminiKey,
          storedAtlasKey,
          storedAtlasModel,
          storedMidapiToken,
          storedGeminiSettings,
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
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.llmGeminiApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.elevenLabsApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.imageLlmProvider),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.imageLlmModel),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.videoLlmProvider),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.videoLlmModel),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.geminiApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.atlasCloudApiKey),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.atlasCloudModel),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.midapiToken),
          AsyncStorage.getItem(GENERATOR_STORAGE_KEYS.geminiSettings),
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

          if (storedAtlasModel) setAtlasCloudModel(storedAtlasModel);

          if (storedGeminiSettings) {
            try {
              setGeminiSettings({ ...DEFAULT_GEMINI_SETTINGS, ...JSON.parse(storedGeminiSettings) });
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
              const envEnabled = process.env.EXPO_PUBLIC_VIDEO_GENERATION_ENABLED === 'true';
              if (envEnabled) delete parsedVideoSettings.enabled;
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

  return {
    llmProvider,
    llmModel,
    imageLlmProvider,
    imageLlmModel,
    videoLlmProvider,
    videoLlmModel,
    apiKey,
    geminiApiKey,
    elevenLabsApiKey,
    atlasCloudApiKey,
    atlasCloudModel,
    midapiToken,
    midjourneySettings,
    geminiSettings,
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
    handleImageLlmProviderChange,
    handleImageLlmModelChange,
    handleVideoLlmProviderChange,
    handleVideoLlmModelChange,
    handleGenerationModeChange,
    handleApiKeyChange,
    handleGeminiApiKeyChange,
    handleElevenLabsApiKeyChange,
    handleAtlasCloudApiKeyChange,
    handleAtlasCloudModelChange,
    handleMidapiTokenChange,
    handleGeminiSettingsChange,
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
