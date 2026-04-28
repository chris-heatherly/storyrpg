/**
 * Two-axis image QA toggle configuration (B1).
 *
 * Two orthogonal dimensions:
 *
 * 1. `promptMode` — which prompt-building path runs:
 *    - `deterministic` (today): beatPromptBuilder + CinematicBeatAnalyzer, no LLM
 *    - `llm`: the revived StoryboardAgent + VisualIllustratorAgent cascade
 *    - `compare`: run both paths for each illustrated beat and write both
 *      variants (deterministic.png + llm.png) plus a manifest. Pick the
 *      canonical variant via `compareCanonical`.
 *
 * 2. `qaMode` — post-generation validator cascade:
 *    - `off` (today): only tier-1 artifact/text checks
 *    - `fast`: pose-diversity + consistency-scorer only on hero beats,
 *      single re-roll
 *    - `full`: the legacy 8-validator cascade with its diversity / full-QA
 *      re-roll caps
 *
 * The axes are independent — every combination is valid. `compare` mode
 * also respects the `compareMaxBeats` cap so a long story can't double the
 * bill unbounded.
 */

import { ART_STYLE_PRESETS } from './artStylePresets';
import type { ArtStyleProfile } from '../images/artStyleProfile';

export type ImagePromptMode = 'deterministic' | 'llm' | 'compare';
export type ImageQaMode = 'off' | 'fast' | 'full';

export interface ImageQaConfig {
  promptMode: ImagePromptMode;
  qaMode: ImageQaMode;
  /** When `promptMode === 'compare'`, which variant is the canonical asset. */
  compareCanonical: 'deterministic' | 'llm';
  /** Cap on how many beats get the doubled generation cost under `compare`. */
  compareMaxBeats: number;
}

export const DEFAULT_IMAGE_QA_CONFIG: ImageQaConfig = {
  promptMode: 'deterministic',
  qaMode: 'off',
  compareCanonical: 'deterministic',
  compareMaxBeats: 20,
};

function pickEnum<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  if (!raw) return fallback;
  const norm = raw.trim().toLowerCase();
  return (allowed as readonly string[]).includes(norm) ? (norm as T) : fallback;
}

/**
 * Resolve QA config from EXPO_PUBLIC_ env vars.
 *
 *   EXPO_PUBLIC_IMAGE_PROMPT_MODE            = deterministic | llm | compare
 *   EXPO_PUBLIC_IMAGE_QA_MODE                = off | fast | full
 *   EXPO_PUBLIC_IMAGE_PROMPT_COMPARE_CANONICAL = deterministic | llm
 *   EXPO_PUBLIC_IMAGE_COMPARE_MAX_BEATS       = integer (default 20)
 */
export function resolveImageQaConfig(env: Record<string, string | undefined> = {}): ImageQaConfig {
  const promptMode = pickEnum<ImagePromptMode>(
    env.EXPO_PUBLIC_IMAGE_PROMPT_MODE || env.IMAGE_PROMPT_MODE,
    ['deterministic', 'llm', 'compare'],
    DEFAULT_IMAGE_QA_CONFIG.promptMode,
  );
  const qaMode = pickEnum<ImageQaMode>(
    env.EXPO_PUBLIC_IMAGE_QA_MODE || env.IMAGE_QA_MODE,
    ['off', 'fast', 'full'],
    DEFAULT_IMAGE_QA_CONFIG.qaMode,
  );
  const compareCanonical = pickEnum<'deterministic' | 'llm'>(
    env.EXPO_PUBLIC_IMAGE_PROMPT_COMPARE_CANONICAL || env.IMAGE_PROMPT_COMPARE_CANONICAL,
    ['deterministic', 'llm'],
    DEFAULT_IMAGE_QA_CONFIG.compareCanonical,
  );
  const rawCap = env.EXPO_PUBLIC_IMAGE_COMPARE_MAX_BEATS || env.IMAGE_COMPARE_MAX_BEATS;
  const parsedCap = rawCap ? Number.parseInt(rawCap, 10) : NaN;
  const compareMaxBeats = Number.isFinite(parsedCap) && parsedCap > 0
    ? parsedCap
    : DEFAULT_IMAGE_QA_CONFIG.compareMaxBeats;

  return { promptMode, qaMode, compareCanonical, compareMaxBeats };
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
