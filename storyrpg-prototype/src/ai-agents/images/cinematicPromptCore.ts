/**
 * CinematicPromptCore (B8)
 *
 * Shared primitives for assembling image prompts. Both the deterministic
 * `beatPromptBuilder` path and the LLM-based `VisualIllustratorAgent` path
 * have historically duplicated logic around:
 *
 *   - the universal negative-prompt floor ("no collage, no watermarks…")
 *   - the character-vs-establishing negative overlays
 *   - style-aware pruning of those negatives against an `ArtStyleProfile`
 *   - a concise "cinematic storytelling" tail string appended to each prompt
 *
 * Keeping them here lets us tune prompt economics (B3) and style awareness
 * (C2/C4) once and have both paths benefit. Callers remain free to override
 * the constants; we treat them as the single source of truth for defaults.
 */

import type { ArtStyleProfile } from './artStyleProfile';

/**
 * Universal negatives that apply to every image the pipeline generates
 * regardless of beat, style, or provider. Intentionally short (B3):
 * image models learn from specific negatives far better than from
 * exhaustive synonym lists, and shorter prompts leave more of the
 * multimodal input budget for actual content.
 */
export const UNIVERSAL_NEGATIVE_PROMPT =
  'collage, split-screen, picture-in-picture, composite image, floating portrait, ' +
  'overlaid text, captions, speech bubbles, watermarks, signatures, sound effects, ' +
  'blurry, low quality';

/** Additional negatives when the beat subject is a character interaction. */
export const CHARACTER_NEGATIVE_OVERLAY =
  ', stiff mannequin pose, arms at sides, neutral expression, centered dead-on composition';

/** Additional negatives when the beat is an establishing/environmental shot. */
export const ESTABLISHING_NEGATIVE_OVERLAY =
  ', character portrait, close-up face, people in foreground';

/**
 * Tail string appended to provider prompts that benefit from a terse
 * "this is a cinematic illustration, not a panel grid" reminder
 * (e.g. Midjourney). Kept here so the same string is used by both
 * deterministic and LLM paths.
 */
export const CINEMATIC_TAIL = 'cinematic storytelling, no overlay text, no captions, no collage';

export type NegativeSurface = 'character' | 'establishing';

/**
 * C2/C4: Assemble the final negative prompt, honoring the active art-style
 * profile. Drops built-in negatives that the profile's `acceptableDeviations`
 * explicitly permit (e.g. a minimalist / storybook style should not be
 * told to avoid "centered composition" because that's exactly the look it
 * wants), and merges `genreNegatives` so style-specific anti-patterns
 * survive into the final negative-prompt string.
 */
export function composeNegativePrompt(
  base: string,
  profile: ArtStyleProfile | undefined,
  surface: NegativeSurface,
): string {
  if (!profile) return base;

  let adjusted = base;

  if (profile.acceptableDeviations.includes('mid-action-posing')) {
    adjusted = adjusted
      .replace(/,?\s*stiff pose/gi, '')
      .replace(/,?\s*characters frozen in place/gi, '')
      .replace(/,?\s*stiff mannequin pose/gi, '')
      .replace(/,?\s*mannequin pose/gi, '');
  }
  if (profile.acceptableDeviations.includes('asymmetric-body-language')) {
    adjusted = adjusted
      .replace(/,?\s*symmetrical stance/gi, '')
      .replace(/,?\s*arms at sides/gi, '')
      .replace(/,?\s*standing straight/gi, '');
  }
  if (profile.acceptableDeviations.includes('no-symmetrical-composition') ||
      profile.acceptableDeviations.includes('no-dead-center')) {
    adjusted = adjusted
      .replace(/,?\s*centered composition/gi, '')
      .replace(/,?\s*centered dead-on composition/gi, '');
  }
  if (profile.acceptableDeviations.includes('thumbnail-readable-expressions')) {
    adjusted = adjusted.replace(/,?\s*neutral expression/gi, '');
  }

  adjusted = adjusted.replace(/\s{2,}/g, ' ').replace(/^\s*,+\s*/, '').replace(/\s*,\s*,/g, ',').trim();

  if (profile.genreNegatives.length > 0) {
    adjusted = `${adjusted}, ${profile.genreNegatives.join(', ')}`;
  }

  // Reserved for surface-specific behavior (e.g. keeping "character portrait"
  // in the establishing-shot set even when a storybook profile softens the
  // character-shot set). Today both surfaces share one deviation map.
  void surface;

  return adjusted;
}

/**
 * Convenience: build the full negative-prompt string for a given surface
 * and style profile in one call. The deterministic and LLM paths should
 * call this rather than assembling the base string themselves so that
 * future additions to the universal floor propagate automatically.
 */
export function buildNegativePromptForSurface(
  surface: NegativeSurface,
  profile?: ArtStyleProfile,
): string {
  const base = UNIVERSAL_NEGATIVE_PROMPT + (
    surface === 'character' ? CHARACTER_NEGATIVE_OVERLAY : ESTABLISHING_NEGATIVE_OVERLAY
  );
  return composeNegativePrompt(base, profile, surface);
}
