import { useCallback, useEffect, useRef, useState } from 'react';
import { PROXY_CONFIG } from '../config/endpoints';
import {
  FALLBACK_MODEL_OPTIONS,
  GeneratorLlmProvider,
  ModelOption,
} from '../config/generatorLlmOptions';

const FALLBACK_ATLAS_MODELS: ModelOption[] = [
  { value: 'bytedance/seedream-v5.0-lite', label: 'Seedream v5.0 Lite', description: 'Latest ByteDance model. Enhanced quality, typography, poster design.' },
  { value: 'google/nano-banana-2/text-to-image', label: 'Nano Banana 2', description: 'Google lightweight image gen. Fast, high quality from text prompts.' },
  { value: 'openai/gpt-image-1.5/text-to-image', label: 'GPT Image 1.5', description: 'OpenAI fast text-to-image. Photorealistic, concept art, stylized.' },
  { value: 'qwen/qwen-image-2.0/text-to-image', label: 'Qwen Image 2.0', description: 'Alibaba enhanced image quality and prompt understanding.' },
  { value: 'qwen/qwen-image-2.0-pro/text-to-image', label: 'Qwen Image 2.0 Pro', description: 'Professional-grade. Superior quality, advanced prompt understanding.' },
  { value: 'alibaba/wan-2.7/text-to-image', label: 'Wan-2.7', description: 'Fast iteration, strong prompt fidelity.' },
  { value: 'alibaba/wan-2.7-pro/text-to-image', label: 'Wan-2.7 Pro', description: 'Higher fidelity, 4K-ready workflows.' },
  { value: 'bytedance/seedream-v4.5', label: 'Seedream v4.5', description: 'High quality, batch + edit support.' },
  { value: 'bytedance/seedream-v4', label: 'Seedream v4.0', description: 'Good quality, lower cost.' },
  { value: 'z-image/turbo', label: 'Z-Image Turbo', description: 'Sub-second generation, great for testing.' },
  { value: 'alibaba/qwen-image/text-to-image-plus', label: 'Qwen-Image Plus', description: 'Good text rendering in images.' },
];

interface ScanResultProviders extends Record<GeneratorLlmProvider, ModelOption[] | null> {
  atlasCloud?: ModelOption[] | null;
}

export interface ModelScanResult {
  scannedAt: number | null;
  providers: ScanResultProviders;
}

export interface AvailableModelsState {
  models: Record<GeneratorLlmProvider, ModelOption[]>;
  atlasCloudModels: ModelOption[];
  scannedAt: number | null;
  loading: boolean;
  error: string | null;
  refresh: (keys?: { anthropicApiKey?: string; geminiApiKey?: string; atlasCloudApiKey?: string }) => Promise<void>;
}

export function useAvailableModels(): AvailableModelsState {
  const [models, setModels] = useState<Record<GeneratorLlmProvider, ModelOption[]>>(FALLBACK_MODEL_OPTIONS);
  const [atlasCloudModels, setAtlasCloudModels] = useState<ModelOption[]>(FALLBACK_ATLAS_MODELS);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const applyResult = useCallback((result: ModelScanResult) => {
    const merged: Record<GeneratorLlmProvider, ModelOption[]> = {
      anthropic: result.providers.anthropic?.length
        ? result.providers.anthropic
        : FALLBACK_MODEL_OPTIONS.anthropic,
      gemini: result.providers.gemini?.length
        ? result.providers.gemini
        : FALLBACK_MODEL_OPTIONS.gemini,
    };
    setModels(merged);
    setAtlasCloudModels(
      result.providers.atlasCloud?.length
        ? result.providers.atlasCloud
        : FALLBACK_ATLAS_MODELS,
    );
    setScannedAt(result.scannedAt);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(PROXY_CONFIG.modelsAvailable);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data: ModelScanResult = await resp.json();
        if (!cancelled) applyResult(data);
      } catch (err) {
        if (!cancelled) {
          console.log('[useAvailableModels] Proxy unavailable, using fallback models');
        }
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [applyResult]);

  const refresh = useCallback(async (keys?: { anthropicApiKey?: string; geminiApiKey?: string; atlasCloudApiKey?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(PROXY_CONFIG.modelsScan, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keys || {}),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: ModelScanResult = await resp.json();
      if (mountedRef.current) applyResult(data);
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || 'Scan failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyResult]);

  return { models, atlasCloudModels, scannedAt, loading, error, refresh };
}
