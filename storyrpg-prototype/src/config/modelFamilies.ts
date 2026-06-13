/**
 * Model-family presets and per-task model assignments.
 *
 * The generator pipeline runs several distinct LLM roles ("tasks"). Rather than
 * forcing the user to pick one model for everything, they pick a **family**
 * (Anthropic / OpenAI / Gemini) and get a cost/benefit-tuned preset that assigns
 * the best model to each task. Power users can then override individual tasks.
 *
 * Narrative tasks (architect, scene, choice, qa) are locked to the selected
 * family's provider — only the model may be overridden (so QA can still drop to
 * a cheaper, decorrelated model within the family). The image and video
 * prompt-planning tasks keep cross-provider freedom.
 *
 * Generator-only. Never imported by the public reader.
 */
import {
  FALLBACK_MODEL_OPTIONS,
  GeneratorLlmProvider,
} from './generatorLlmOptions';

export type PipelineTask = 'architect' | 'scene' | 'choice' | 'qa' | 'image' | 'video';

export interface PipelineTaskMeta {
  id: PipelineTask;
  label: string;
  /** One-line description of what the task does, shown in the per-task sheet. */
  description: string;
  /** Whether the task may use a provider different from the chosen family. */
  crossProvider: boolean;
}

/** Display order + metadata for the per-task UI. */
export const PIPELINE_TASKS: readonly PipelineTaskMeta[] = [
  {
    id: 'architect',
    label: 'Planning / Architecture',
    description: 'Season structure, 7-point spine, treatment. Highest-stakes reasoning — quality here cascades through the whole run.',
    crossProvider: false,
  },
  {
    id: 'scene',
    label: 'Scene Writing',
    description: 'High-volume prose generation. The bulk of token spend.',
    crossProvider: false,
  },
  {
    id: 'choice',
    label: 'Choice Authoring',
    description: 'Short but tonally sensitive branch and choice text.',
    crossProvider: false,
  },
  {
    id: 'qa',
    label: 'QA Grading',
    description: 'Structured scoring and continuity checks. Benefits from a cheaper model decorrelated from the author.',
    crossProvider: false,
  },
  {
    id: 'image',
    label: 'Image Prompting',
    description: 'Plans image prompts from scene metadata (mechanical). Separate from the image-generation provider.',
    crossProvider: true,
  },
  {
    id: 'video',
    label: 'Video Prompting',
    description: 'Plans video prompts (experimental). Separate from the video-generation backend.',
    crossProvider: true,
  },
] as const;

/** Narrative tasks are locked to the family provider. */
export const NARRATIVE_TASKS: readonly PipelineTask[] = ['architect', 'scene', 'choice', 'qa'];

export interface TaskModelAssignment {
  provider: GeneratorLlmProvider;
  model: string;
}

export interface ModelFamilyPreset {
  id: GeneratorLlmProvider;
  label: string;
  /** One-line summary of the family's cost/benefit posture. */
  tagline: string;
  assignments: Record<PipelineTask, TaskModelAssignment>;
}

const anthropic = (model: string): TaskModelAssignment => ({ provider: 'anthropic', model });
const openai = (model: string): TaskModelAssignment => ({ provider: 'openai', model });
const gemini = (model: string): TaskModelAssignment => ({ provider: 'gemini', model });
const openrouter = (model: string): TaskModelAssignment => ({ provider: 'openrouter', model });

/**
 * Cost/benefit-optimal model per task, per family. The expensive flagship goes
 * to planning (where it pays off), a balanced mid-tier to prose/choices, and the
 * cheapest tier to QA/image/video prompting.
 */
export const MODEL_FAMILY_PRESETS: Record<GeneratorLlmProvider, ModelFamilyPreset> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude',
    tagline: 'Opus plans, Sonnet writes, Haiku grades.',
    assignments: {
      architect: anthropic('claude-opus-4-8'),
      scene: anthropic('claude-sonnet-4-6'),
      choice: anthropic('claude-sonnet-4-6'),
      qa: anthropic('claude-haiku-4-5'),
      image: anthropic('claude-haiku-4-5'),
      video: anthropic('claude-haiku-4-5'),
    },
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    tagline: 'GPT-5 plans, GPT-5 mini writes, 4o-mini grades.',
    assignments: {
      architect: openai('gpt-5'),
      scene: openai('gpt-5-mini'),
      choice: openai('gpt-5-mini'),
      qa: openai('gpt-4o-mini'),
      image: openai('gpt-4o-mini'),
      video: openai('gpt-4o-mini'),
    },
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    tagline: '3.1 Pro plans, 2.5 Pro writes, 2.5 Flash grades.',
    assignments: {
      architect: gemini('gemini-3.1-pro-preview'),
      scene: gemini('gemini-2.5-pro'),
      choice: gemini('gemini-2.5-pro'),
      qa: gemini('gemini-2.5-flash'),
      image: gemini('gemini-2.5-flash'),
      video: gemini('gemini-2.5-flash'),
    },
  },
  // Cross-vendor "best-of" via OpenRouter — deliberately avoids the
  // Anthropic / OpenAI / Gemini families (those have their own presets) so the
  // QA judge is fully decorrelated from the author. Model ids are OpenRouter
  // `vendor/model` slugs.
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    tagline: 'DeepSeek plans, Grok writes, Mistral picks, Qwen grades.',
    assignments: {
      architect: openrouter('deepseek/deepseek-v4-pro'),
      scene: openrouter('x-ai/grok-4.3'),
      choice: openrouter('mistralai/mistral-medium-3.5'),
      qa: openrouter('qwen/qwen3.6-flash'),
      image: openrouter('deepseek/deepseek-v4-flash'),
      video: openrouter('deepseek/deepseek-v4-flash'),
    },
  },
};

export const DEFAULT_MODEL_FAMILY: GeneratorLlmProvider = 'anthropic';

/**
 * Per-task model overrides. Narrative tasks store a model only (provider is
 * always the family); image/video may store a full provider+model assignment.
 */
export type TaskModelOverrides = Partial<Record<PipelineTask, TaskModelAssignment>>;

export function isPipelineTask(value: unknown): value is PipelineTask {
  return (
    value === 'architect' ||
    value === 'scene' ||
    value === 'choice' ||
    value === 'qa' ||
    value === 'image' ||
    value === 'video'
  );
}

function isNarrativeTask(task: PipelineTask): boolean {
  return NARRATIVE_TASKS.includes(task);
}

/**
 * Resolve the effective per-task model assignments for a family + overrides.
 *
 * Starts from the family preset, then applies overrides. For narrative tasks the
 * provider is forced to the family (only the model is honored from an override);
 * for image/video the override's provider is respected.
 */
export function resolveTaskAssignments(
  family: GeneratorLlmProvider,
  overrides: TaskModelOverrides | undefined,
): Record<PipelineTask, TaskModelAssignment> {
  const preset = MODEL_FAMILY_PRESETS[family] ?? MODEL_FAMILY_PRESETS[DEFAULT_MODEL_FAMILY];
  const result = {} as Record<PipelineTask, TaskModelAssignment>;
  for (const meta of PIPELINE_TASKS) {
    const task = meta.id;
    const base = preset.assignments[task];
    const override = overrides?.[task];
    if (!override) {
      result[task] = { ...base };
      continue;
    }
    if (isNarrativeTask(task)) {
      // Provider locked to family; only the model may differ.
      result[task] = { provider: family, model: override.model || base.model };
    } else {
      result[task] = {
        provider: override.provider || base.provider,
        model: override.model || base.model,
      };
    }
  }
  return result;
}

/** Human-readable label for a model id, falling back to the raw id. */
export function modelLabel(provider: GeneratorLlmProvider, model: string): string {
  const option = FALLBACK_MODEL_OPTIONS[provider]?.find((o) => o.value === model);
  return option?.label ?? model;
}
