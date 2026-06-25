export type GenerationMode = 'strict' | 'advisory' | 'disabled';
export type GeneratorLlmProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter';
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

export const DEFAULT_LLM_PROVIDER: GeneratorLlmProvider = 'gemini';
export const DEFAULT_LLM_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5',
  gemini: 'gemini-2.5-pro',
  openrouter: 'x-ai/grok-4.3',
} as const;

export const FALLBACK_MODEL_OPTIONS: Record<GeneratorLlmProvider, ModelOption[]> = {
  anthropic: [
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', description: 'Most capable — best for planning/architecture.' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Balanced speed/quality — best for prose and choices.' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fastest/cheapest — best for QA grading and prompting.' },
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (legacy)' },
    { value: 'claude-opus-4-20250514', label: 'Claude Opus 4 (legacy)' },
    { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  openai: [
    { value: 'gpt-5', label: 'GPT-5', description: 'Flagship reasoning model (if available on your key).' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini', description: 'Smaller, cheaper GPT-5 tier.' },
    { value: 'gpt-4.1', label: 'GPT-4.1', description: 'Latest GPT-4.1 generation.' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Fast, cost-effective GPT-4.1 tier.' },
    { value: 'gpt-4o', label: 'GPT-4o', description: 'Widely available multimodal workhorse.' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Budget GPT-4o variant.' },
    { value: 'o4-mini', label: 'o4-mini', description: 'Reasoning-class model; supports reasoning_effort.' },
    { value: 'o3-mini', label: 'o3-mini', description: 'Prior-gen reasoning model.' },
  ],
  gemini: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
  // OpenRouter routes to many vendors; model ids are `vendor/model` slugs.
  // These non-big-three defaults are a fallback list — the live catalog is
  // fetched from https://openrouter.ai/api/v1/models when a key is supplied.
  openrouter: [
    { value: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'Strong reasoning/planning — best for architecture.' },
    { value: 'x-ai/grok-4.3', label: 'Grok 4.3', description: 'Fast, agentic, good prose — balanced default.' },
    { value: 'x-ai/grok-4.20', label: 'Grok 4.20', description: 'Top-tier reasoning + tool calling.' },
    { value: 'mistralai/mistral-medium-3.5', label: 'Mistral Medium 3.5', description: 'Dense 128B — tonally sensitive choices.' },
    { value: 'qwen/qwen3.7-max', label: 'Qwen 3.7 Max', description: 'Agent-centric, strong coding/structure.' },
    { value: 'qwen/qwen3.6-flash', label: 'Qwen 3.6 Flash', description: 'Cheapest/fastest — best for QA grading.' },
    { value: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'Efficient MoE — cheap prompting/grading.' },
  ],
};

/** @deprecated Use FALLBACK_MODEL_OPTIONS or dynamic models from useAvailableModels */
export const PROVIDER_MODEL_OPTIONS = FALLBACK_MODEL_OPTIONS;
