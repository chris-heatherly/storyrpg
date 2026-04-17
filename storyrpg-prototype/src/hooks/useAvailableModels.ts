import { useCallback, useEffect, useRef, useState } from 'react';
import { PROXY_CONFIG } from '../config/endpoints';
import {
  FALLBACK_MODEL_OPTIONS,
  GeneratorLlmProvider,
  ModelOption,
} from '../config/generatorLlmOptions';

// Atlas Cloud text-to-image catalog (kept in sync with the server-side list in
// proxy/modelScanRoutes.js::getAtlasCloudImageModels). Used as the fallback
// while the proxy's model scan is still in flight.
const FALLBACK_ATLAS_MODELS: ModelOption[] = [
  { value: 'google/nano-banana-2/text-to-image', label: 'Nano Banana 2', description: "Google's lightweight yet powerful model. 14 ref images, 5-char consistency, 4K. Best for StoryRPG." },
  { value: 'google/nano-banana-pro/text-to-image', label: 'Nano Banana Pro', description: '10 ref images, 5-char consistency, native 2K/4K. Premium quality.' },
  { value: 'google/nano-banana-pro/text-to-image-ultra', label: 'Nano Banana Pro Ultra', description: 'Next-gen Nano Banana Pro. Sharpest detail, richest color control.' },
  { value: 'google/nano-banana/text-to-image', label: 'Nano Banana', description: "Google's state-of-the-art image generation and editing model." },
  { value: 'google/imagen4-ultra', label: 'Imagen 4 Ultra', description: "Google's highest-quality image generation model." },
  { value: 'google/imagen4', label: 'Imagen 4', description: "Google's Imagen 4 flagship model." },
  { value: 'google/imagen4-fast', label: 'Imagen 4 Fast', description: 'Fast variant of Imagen 4 flagship.' },
  { value: 'google/imagen3', label: 'Imagen 3', description: 'Prior-gen high-detail text-to-image model.' },
  { value: 'google/imagen3-fast', label: 'Imagen 3 Fast', description: 'Fast variant of Imagen 3.' },
  { value: 'openai/gpt-image-1.5/text-to-image', label: 'GPT Image 1.5', description: "OpenAI's fast, cost-efficient text-to-image. Photorealistic, concept art. Text only." },
  { value: 'openai/gpt-image-1/text-to-image', label: 'GPT Image 1', description: "OpenAI's GPT Image-1. Ideal for creating visual assets." },
  { value: 'openai/gpt-image-1-mini/text-to-image', label: 'GPT Image 1 Mini', description: 'Cost-efficient multimodal OpenAI model (GPT-5 guided).' },
  { value: 'bytedance/seedream-v5.0-lite', label: 'Seedream v5.0 Lite', description: 'ByteDance latest. Visual CoT, 14 ref images, 4K.' },
  { value: 'bytedance/seedream-v5.0-lite/sequential', label: 'Seedream v5.0 Lite Sequential', description: 'Seedream v5.0 Lite batch — up to 15 related images per request.' },
  { value: 'bytedance/seedream-v4.5', label: 'Seedream v4.5', description: 'High quality, batch + edit support, 10 ref images.' },
  { value: 'bytedance/seedream-v4.5/sequential', label: 'Seedream v4.5 Sequential', description: 'Seedream v4.5 batch — up to 15 images per request.' },
  { value: 'bytedance/seedream-v4', label: 'Seedream v4.0', description: 'Good quality, lower cost.' },
  { value: 'bytedance/seedream-v4/sequential', label: 'Seedream v4.0 Sequential', description: 'Seedream v4 batch mode.' },
  { value: 'qwen/qwen-image-2.0/text-to-image', label: 'Qwen Image 2.0', description: 'Alibaba enhanced image quality and prompt understanding. Up to 2K.' },
  { value: 'qwen/qwen-image-2.0-pro/text-to-image', label: 'Qwen Image 2.0 Pro', description: 'Professional-grade. Superior quality, advanced prompt understanding.' },
  { value: 'alibaba/qwen-image/text-to-image-max', label: 'Qwen-Image Max', description: 'General-purpose Qwen-Image. Great for complex text rendering.' },
  { value: 'alibaba/qwen-image/text-to-image-plus', label: 'Qwen-Image Plus', description: 'Good text rendering in images.' },
  { value: 'atlascloud/qwen-image/text-to-image', label: 'Qwen-Image (Atlas)', description: 'Qwen-Image 20B MMDiT model.' },
  { value: 'alibaba/wan-2.7/text-to-image', label: 'Wan-2.7', description: 'Fast iteration, strong prompt fidelity.' },
  { value: 'alibaba/wan-2.7-pro/text-to-image', label: 'Wan-2.7 Pro', description: 'Higher fidelity, 4K-ready workflows.' },
  { value: 'alibaba/wan-2.6/text-to-image', label: 'Wan-2.6', description: 'Various artistic styles and realistic photographic effects.' },
  { value: 'alibaba/wan-2.5/text-to-image', label: 'Wan-2.5', description: 'Alibaba WAN 2.5 general text-to-image.' },
  { value: 'black-forest-labs/flux-dev', label: 'Flux Dev', description: 'Flux-dev 12B parameter rectified flow transformer.' },
  { value: 'black-forest-labs/flux-schnell', label: 'Flux Schnell', description: 'FLUX.1 [schnell] — fastest 12B model, great for drafts.' },
  { value: 'black-forest-labs/flux-dev-lora', label: 'Flux Dev LoRA', description: 'FLUX.1 [dev] with LoRA support for personalized styles.' },
  { value: 'z-image/turbo', label: 'Z-Image Turbo', description: 'Sub-second 6B text-to-image model, great for testing. Text only.' },
  { value: 'baidu/ERNIE-Image-Turbo/text-to-image', label: 'ERNIE Image Turbo', description: 'Baidu ERNIE Image, low-latency turbo variant. Free tier.' },
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
