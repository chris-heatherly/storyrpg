/**
 * Pure helpers that translate `ImagePrompt` + `StableDiffusionSettings` into
 * the positive/negative prompt strings and LoRA tags that A1111 / Forge / most
 * SD-compatible backends consume.
 *
 * Kept free of backend-specific logic so it can be unit-tested without any
 * HTTP mocking.
 */

import type { ImagePrompt, ImagePromptLora } from '../../agents/ImageGenerator';
import type { StableDiffusionSettings } from '../../config';

export interface BuiltSDPrompt {
  positive: string;
  negative: string;
  loraTags: string[];
  seed: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  width: number;
  height: number;
  model?: string;
}

const DEFAULT_STEPS = 28;
const DEFAULT_CFG = 6.5;
const DEFAULT_SAMPLER = 'DPM++ 2M Karras';
const DEFAULT_WIDTH = 832;
const DEFAULT_HEIGHT = 1216;
const DEFAULT_NEGATIVE =
  'lowres, blurry, deformed, bad anatomy, extra fingers, watermark, signature, jpeg artifacts, text';

function stripLoraTags(text: string): string {
  return text.replace(/<lora:[^>]+>/gi, '').replace(/\s{2,}/g, ' ').trim();
}

function formatLoraTag(lora: ImagePromptLora): string {
  const name = lora.name.trim().replace(/[<>\s]+/g, '_');
  if (!name) return '';
  const weight = Number.isFinite(lora.weight) ? Math.max(-2, Math.min(2, lora.weight)) : 0.8;
  return `<lora:${name}:${weight.toFixed(2)}>`;
}

function dedupeCsv(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    for (const part of raw.split(',').map(s => s.trim()).filter(Boolean)) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }
  return out.join(', ');
}

/**
 * Merge LoRAs from settings (style, per-character registry) with any already
 * on the prompt. Prompt-level LoRAs win on duplicates so callers can override
 * registry weights per-shot.
 */
function mergeLoras(
  promptLoras: ImagePromptLora[] | undefined,
  settingsLoras: ImagePromptLora[] | undefined,
  characterLora?: ImagePromptLora,
): ImagePromptLora[] {
  const merged = new Map<string, ImagePromptLora>();
  const push = (lora: ImagePromptLora | undefined) => {
    if (!lora || !lora.name) return;
    const key = lora.name.trim().toLowerCase();
    if (!key) return;
    if (!merged.has(key)) merged.set(key, lora);
  };
  (promptLoras || []).forEach(push);
  if (characterLora) push(characterLora);
  (settingsLoras || []).forEach(push);
  return Array.from(merged.values());
}

/**
 * Build the full SD positive/negative prompt + sampler settings for a single
 * generation call.
 *
 * Rules:
 *  - Style + canonical art style fold into the positive prompt.
 *  - LoRAs are appended as inline `<lora:name:weight>` tags so they work on
 *    A1111 / Forge without extra API flags.
 *  - Negatives stack: settings default + prompt-level + global guards, with
 *    duplicate removal.
 *  - Seed defaults to -1 (random) unless the prompt pins one.
 */
export function buildSDPrompt(
  prompt: ImagePrompt,
  settings: StableDiffusionSettings,
  characterLora?: ImagePromptLora,
): BuiltSDPrompt {
  const basePositive = stripLoraTags(prompt.prompt || '');
  const style = (prompt.style || '').trim();
  const positiveParts = [basePositive];
  if (style && !basePositive.toLowerCase().includes(style.toLowerCase())) {
    positiveParts.push(style);
  }
  if (prompt.composition) positiveParts.push(prompt.composition);
  if (prompt.keyExpression) positiveParts.push(prompt.keyExpression);
  if (prompt.keyGesture) positiveParts.push(prompt.keyGesture);
  if (prompt.keyBodyLanguage) positiveParts.push(prompt.keyBodyLanguage);

  const loras = mergeLoras(prompt.loras, settings.styleLoras, characterLora);
  const loraTags = loras.map(formatLoraTag).filter(Boolean);

  const positive = [dedupeCsv(positiveParts), loraTags.join(' ')].filter(Boolean).join(' ').trim();

  const negative = dedupeCsv([
    settings.defaultNegativePrompt || DEFAULT_NEGATIVE,
    prompt.negativePrompt || '',
  ]);

  const seedRaw = prompt.seed;
  const seed = typeof seedRaw === 'number' && Number.isFinite(seedRaw) ? Math.trunc(seedRaw) : -1;

  return {
    positive,
    negative,
    loraTags,
    seed,
    steps: prompt.steps ?? settings.defaultSteps ?? DEFAULT_STEPS,
    sampler: prompt.sampler ?? settings.defaultSampler ?? DEFAULT_SAMPLER,
    cfgScale: prompt.cfgScale ?? settings.defaultCfg ?? DEFAULT_CFG,
    width: prompt.width ?? settings.width ?? DEFAULT_WIDTH,
    height: prompt.height ?? settings.height ?? DEFAULT_HEIGHT,
    model: settings.defaultModel,
  };
}
