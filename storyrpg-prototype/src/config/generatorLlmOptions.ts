export type GenerationMode = 'strict' | 'advisory' | 'disabled';
export type GeneratorLlmProvider = 'anthropic' | 'openai' | 'gemini';
export type GeneratorImageProvider = 'nano-banana' | 'atlas-cloud' | 'midapi' | 'dall-e' | 'stable-diffusion';

/**
 * Whether the Stable Diffusion image provider option is exposed in the UI.
 * Shown by default (so local users with an A1111/SD backend can pick it);
 * set `EXPO_PUBLIC_SD_ENABLED=false` in .env to hide it in builds that don't
 * ship an SD backend.
 */
export const STABLE_DIFFUSION_UI_ENABLED: boolean =
  (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_SD_ENABLED : undefined) !== 'false';

export interface ModelOption {
  value: string;
  label: string;
  createdAt?: string | null;
  description?: string | null;
}

export const DEFAULT_LLM_PROVIDER: GeneratorLlmProvider = 'anthropic';
export const DEFAULT_LLM_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-5',
  gemini: 'gemini-2.5-pro',
} as const;

export const FALLBACK_MODEL_OPTIONS: Record<GeneratorLlmProvider, ModelOption[]> = {
  anthropic: [
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
    { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  openai: [
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { value: 'gpt-5.4-medium', label: 'GPT-5.4 Medium' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4o', label: 'GPT-4o' },
  ],
  gemini: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
};

/** @deprecated Use FALLBACK_MODEL_OPTIONS or dynamic models from useAvailableModels */
export const PROVIDER_MODEL_OPTIONS = FALLBACK_MODEL_OPTIONS;
