import { describe, expect, it } from 'vitest';
import { buildSDPrompt } from './buildSDPrompt';
import type { ImagePrompt } from '../../agents/ImageGenerator';
import type { StableDiffusionSettings } from '../../config';

const basePrompt: ImagePrompt = {
  prompt: 'a lone swordsman on a misty mountain',
  style: 'painterly fantasy',
  composition: 'rule of thirds, subject on left',
} as any;

const baseSettings: StableDiffusionSettings = {
  baseUrl: 'http://localhost:7860',
  backend: 'a1111',
  defaultSteps: 28,
  defaultCfg: 6.5,
  defaultSampler: 'DPM++ 2M Karras',
  defaultNegativePrompt: 'lowres, blurry',
  width: 832,
  height: 1216,
};

describe('buildSDPrompt', () => {
  it('merges style into the positive prompt when missing', () => {
    const built = buildSDPrompt(basePrompt, baseSettings);
    expect(built.positive).toContain('lone swordsman');
    expect(built.positive).toContain('painterly fantasy');
    expect(built.positive).toContain('rule of thirds');
  });

  it('appends style lora tags from settings', () => {
    const built = buildSDPrompt(basePrompt, {
      ...baseSettings,
      styleLoras: [{ name: 'studio_ghibli', weight: 0.8 }],
    });
    expect(built.loraTags).toContain('<lora:studio_ghibli:0.80>');
    expect(built.positive).toContain('<lora:studio_ghibli:0.80>');
  });

  it('honors prompt-level LoRAs and character lora without duplicates', () => {
    const built = buildSDPrompt(
      { ...basePrompt, loras: [{ name: 'studio_ghibli', weight: 1.0 }] },
      {
        ...baseSettings,
        styleLoras: [{ name: 'studio_ghibli', weight: 0.4 }],
      },
      { name: 'hero_face', weight: 0.9 },
    );
    const ghibliTags = built.loraTags.filter(t => t.includes('studio_ghibli'));
    expect(ghibliTags).toHaveLength(1);
    // Prompt-level wins
    expect(ghibliTags[0]).toBe('<lora:studio_ghibli:1.00>');
    expect(built.loraTags).toContain('<lora:hero_face:0.90>');
  });

  it('clamps absurd LoRA weights into [-2, 2]', () => {
    const built = buildSDPrompt(
      { ...basePrompt, loras: [{ name: 'runaway', weight: 99 }] },
      baseSettings,
    );
    expect(built.loraTags[0]).toBe('<lora:runaway:2.00>');
  });

  it('strips existing inline LoRA tags from the prompt text to avoid duplication', () => {
    const built = buildSDPrompt(
      { ...basePrompt, prompt: 'hero <lora:misc:1>', loras: [{ name: 'misc', weight: 0.5 }] },
      baseSettings,
    );
    const miscMatches = built.positive.match(/<lora:misc/g) || [];
    expect(miscMatches).toHaveLength(1);
  });

  it('pulls sampler/steps/cfg from settings when prompt omits them', () => {
    const built = buildSDPrompt(basePrompt, baseSettings);
    expect(built.sampler).toBe('DPM++ 2M Karras');
    expect(built.steps).toBe(28);
    expect(built.cfgScale).toBe(6.5);
    expect(built.width).toBe(832);
    expect(built.height).toBe(1216);
  });

  it('lets prompt-level sampler/steps override settings', () => {
    const built = buildSDPrompt(
      { ...basePrompt, sampler: 'Euler a', steps: 18, cfgScale: 5, width: 512, height: 768 },
      baseSettings,
    );
    expect(built.sampler).toBe('Euler a');
    expect(built.steps).toBe(18);
    expect(built.cfgScale).toBe(5);
    expect(built.width).toBe(512);
    expect(built.height).toBe(768);
  });

  it('passes explicit seed through verbatim and defaults to -1 otherwise', () => {
    expect(buildSDPrompt(basePrompt, baseSettings).seed).toBe(-1);
    expect(buildSDPrompt({ ...basePrompt, seed: 123456 }, baseSettings).seed).toBe(123456);
    expect(buildSDPrompt({ ...basePrompt, seed: 1.9 }, baseSettings).seed).toBe(1);
  });

  it('merges negative prompts from settings and prompt while deduping', () => {
    const built = buildSDPrompt(
      { ...basePrompt, negativePrompt: 'blurry, watermark' },
      baseSettings,
    );
    const parts = built.negative.split(',').map(s => s.trim().toLowerCase());
    expect(parts).toContain('lowres');
    expect(parts).toContain('blurry');
    expect(parts).toContain('watermark');
    expect(parts.filter(p => p === 'blurry')).toHaveLength(1);
  });
});
