export type GenerationMode = 'strict' | 'advisory' | 'disabled';
export type GeneratorLlmProvider = 'anthropic' | 'gemini';
export type GeneratorImageProvider = 'nano-banana' | 'atlas-cloud' | 'midapi';

export interface ModelOption {
  value: string;
  label: string;
  createdAt?: string | null;
  description?: string | null;
}

export const DEFAULT_LLM_PROVIDER: GeneratorLlmProvider = 'anthropic';
export const DEFAULT_LLM_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
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
