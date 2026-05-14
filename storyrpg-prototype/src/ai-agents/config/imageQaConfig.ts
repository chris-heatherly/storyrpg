/**
 * Two-axis image QA toggle configuration (B1).
 *
 * Two orthogonal dimensions:
 *
 * 1. `promptMode` — which prompt-building path runs:
 *    - `deterministic`: beatPromptBuilder + CinematicBeatAnalyzer, no LLM
 *    - `llm` (default): the revived StoryboardAgent + VisualIllustratorAgent cascade
 *
 * 2. `qaMode` — post-generation validator cascade:
 *    - `off`: only tier-1 artifact/text checks
 *    - `fast`: pose-diversity + consistency-scorer only on hero beats,
 *      single re-roll
 *    - `full` (default): the legacy 8-validator cascade with its diversity / full-QA
 *      re-roll caps
 *
 * The axes are independent — every prompt/QA combination is valid. The old
 * production `compare` prompt mode has been retired; old env values are
 * normalized to `llm`.
 */

import { ART_STYLE_PRESETS } from './artStylePresets';
import type { ArtStyleProfile } from '../images/artStyleProfile';

export type ImagePromptMode = 'deterministic' | 'llm';
export type ImageQaMode = 'off' | 'fast' | 'full';

export interface ImageQaConfig {
  promptMode: ImagePromptMode;
  qaMode: ImageQaMode;
}

export const DEFAULT_IMAGE_QA_CONFIG: ImageQaConfig = {
  promptMode: 'llm',
  qaMode: 'full',
};

function pickEnum<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  if (!raw) return fallback;
  const norm = raw.trim().toLowerCase();
  return (allowed as readonly string[]).includes(norm) ? (norm as T) : fallback;
}

/**
 * Resolve QA config from EXPO_PUBLIC_ env vars.
 *
 *   EXPO_PUBLIC_IMAGE_PROMPT_MODE            = deterministic | llm
 *   EXPO_PUBLIC_IMAGE_QA_MODE                = off | fast | full
 */
export function resolveImageQaConfig(env: Record<string, string | undefined> = {}): ImageQaConfig {
  const rawPromptMode = env.EXPO_PUBLIC_IMAGE_PROMPT_MODE || env.IMAGE_PROMPT_MODE;
  const promptMode = pickEnum<ImagePromptMode>(
    rawPromptMode?.trim().toLowerCase() === 'compare' ? 'llm' : rawPromptMode,
    ['deterministic', 'llm'],
    DEFAULT_IMAGE_QA_CONFIG.promptMode,
  );
  const qaMode = pickEnum<ImageQaMode>(
    env.EXPO_PUBLIC_IMAGE_QA_MODE || env.IMAGE_QA_MODE,
    ['off', 'fast', 'full'],
    DEFAULT_IMAGE_QA_CONFIG.qaMode,
  );
  return { promptMode, qaMode };
}

/**
 * Resolve the preset id (if any) selected via env. Kept here because the
 * preset library is the primary way a user picks a structured style today.
 *
 *   EXPO_PUBLIC_ART_STYLE_PRESET = <preset id>
 */
export function resolveArtStylePresetProfile(
  env: Record<string, string | undefined> = {},
): ArtStyleProfile | undefined {
  const presetId = (env.EXPO_PUBLIC_ART_STYLE_PRESET || env.ART_STYLE_PRESET || '').trim();
  if (!presetId) return undefined;
  const preset = ART_STYLE_PRESETS.find((p) => p.id === presetId);
  return preset?.profile;
}
