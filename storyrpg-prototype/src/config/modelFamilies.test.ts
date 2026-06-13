import { describe, expect, it } from 'vitest';
import {
  MODEL_FAMILY_PRESETS,
  PIPELINE_TASKS,
  NARRATIVE_TASKS,
  resolveTaskAssignments,
  isPipelineTask,
} from './modelFamilies';
import { FALLBACK_MODEL_OPTIONS, GeneratorLlmProvider } from './generatorLlmOptions';

const FAMILIES: GeneratorLlmProvider[] = ['anthropic', 'openai', 'gemini', 'openrouter'];

describe('modelFamilies presets', () => {
  it('assigns every pipeline task in every family', () => {
    for (const family of FAMILIES) {
      const preset = MODEL_FAMILY_PRESETS[family];
      expect(preset).toBeDefined();
      for (const task of PIPELINE_TASKS) {
        const assignment = preset.assignments[task.id];
        expect(assignment, `${family}/${task.id}`).toBeDefined();
        expect(assignment.model.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps narrative-task preset providers within the family', () => {
    for (const family of FAMILIES) {
      const preset = MODEL_FAMILY_PRESETS[family];
      for (const task of NARRATIVE_TASKS) {
        expect(preset.assignments[task].provider, `${family}/${task}`).toBe(family);
      }
    }
  });

  it('references model ids that are present in the fallback option list', () => {
    for (const family of FAMILIES) {
      const known = new Set(FALLBACK_MODEL_OPTIONS[family].map((o) => o.value));
      for (const task of PIPELINE_TASKS) {
        const { provider, model } = MODEL_FAMILY_PRESETS[family].assignments[task.id];
        // Cross-provider tasks may point at another family's option list.
        const list = new Set(FALLBACK_MODEL_OPTIONS[provider].map((o) => o.value));
        expect(provider === family ? known.has(model) : list.has(model), `${family}/${task.id} -> ${model}`).toBe(true);
      }
    }
  });

  it('uses the recommended Claude cost/benefit split', () => {
    const claude = MODEL_FAMILY_PRESETS.anthropic.assignments;
    expect(claude.architect.model).toBe('claude-opus-4-8');
    expect(claude.scene.model).toBe('claude-sonnet-4-6');
    expect(claude.choice.model).toBe('claude-sonnet-4-6');
    expect(claude.qa.model).toBe('claude-haiku-4-5');
  });
});

describe('resolveTaskAssignments', () => {
  it('returns the preset when no overrides are given', () => {
    const resolved = resolveTaskAssignments('anthropic', undefined);
    expect(resolved.architect.model).toBe('claude-opus-4-8');
    expect(resolved.qa.model).toBe('claude-haiku-4-5');
  });

  it('honors a narrative model override but forces the family provider', () => {
    const resolved = resolveTaskAssignments('anthropic', {
      // Even if an override smuggles a different provider, narrative locks to family.
      qa: { provider: 'openai', model: 'claude-sonnet-4-6' },
    });
    expect(resolved.qa.provider).toBe('anthropic');
    expect(resolved.qa.model).toBe('claude-sonnet-4-6');
  });

  it('honors a cross-provider override for image/video tasks', () => {
    const resolved = resolveTaskAssignments('anthropic', {
      image: { provider: 'gemini', model: 'gemini-2.5-flash' },
    });
    expect(resolved.image.provider).toBe('gemini');
    expect(resolved.image.model).toBe('gemini-2.5-flash');
    // Untouched tasks keep the preset.
    expect(resolved.scene.model).toBe('claude-sonnet-4-6');
  });

  it('recognizes valid pipeline task ids', () => {
    expect(isPipelineTask('architect')).toBe(true);
    expect(isPipelineTask('qa')).toBe(true);
    expect(isPipelineTask('nope')).toBe(false);
  });
});
