/**
 * Shared builders for the three style-bible anchor prompts — character,
 * arc color strip, environment. Extracted from FullStoryPipeline so both
 * the in-pipeline anchor step and the pre-pipeline UI style-setup flow
 * (exposed via the proxy's `/generate/style/concept` route) produce the
 * same prompts for the same inputs.
 *
 * These builders are deliberately dependency-free — they take plain
 * structural input and return an `ImagePrompt`, so they can run anywhere
 * (browser, Node worker, proxy) without pulling in agents or services.
 */

import type { ImagePrompt } from '../agents/ImageGenerator';

export interface AnchorStyleInput {
  /**
   * The composite art-style string (from `composeCanonicalStyleString(profile)`).
   * Becomes `ImagePrompt.style` so downstream builders can echo it.
   */
  style?: string;
}

export interface CharacterAnchorInput extends AnchorStyleInput {
  /** Protagonist's display name. */
  protagonistName: string;
  /**
   * Up to three color-script terms (e.g. `['warm coral', 'deep teal', 'gold']`).
   * Fed into the prompt so the anchor already lives inside the episode's palette.
   */
  colorTerms?: string[];
  /**
   * Optional free-form description of the protagonist's identity anchors
   * (face, hair, costume). Omitted by the UI when no character bible exists
   * yet; the pipeline supplies it after the CharacterBible step.
   */
  protagonistDescription?: string;
}

export interface ArcStripAnchorInput extends AnchorStyleInput {
  /** Story title for the visualNarrative prose. */
  storyTitle: string;
  /**
   * Optional strip prompt body from `ColorScriptAgent.generateThumbnails`.
   * When provided it becomes the main `prompt` text; otherwise a minimal
   * placeholder keyed off the style is used so the UI can preview before
   * the ColorScript step has run.
   */
  stripPrompt?: string;
}

export interface EnvironmentAnchorInput extends AnchorStyleInput {
  /** Story title for labelling. */
  storyTitle: string;
  /** Primary location name, e.g. "The Crimson Library". Falls back to a generic phrase. */
  locationName?: string;
  /**
   * Up to two color terms describing the episode's tonal palette. Same
   * semantics as CharacterAnchorInput.colorTerms.
   */
  toneTerms?: string[];
}

export interface BuiltAnchorPrompt {
  /** Slug-friendly identifier suffix, e.g. `"character-anchor"`. */
  role: 'character-anchor' | 'arc-strip' | 'environment-anchor';
  prompt: ImagePrompt;
}

/**
 * Characters-only portrait anchor. Mirrors the pipeline's existing
 * protagonist anchor contract so `setGeminiStyleReference` can consume it.
 */
export function buildCharacterAnchorPrompt(input: CharacterAnchorInput): BuiltAnchorPrompt {
  const palette = (input.colorTerms || []).filter(Boolean).slice(0, 3).join(', ');
  const identityLine = input.protagonistDescription
    ? `Identity anchors: ${input.protagonistDescription}.`
    : '';
  return {
    role: 'character-anchor',
    prompt: {
      prompt: [
        `single character portrait of ${input.protagonistName}, one person only, three-quarter standing pose,`,
        'readable face and costume, cinematic story frame,',
        `the episode palette expressed through ${palette || 'the planned color script'},`,
        'designed as a visual style bible anchor, unified single image',
        identityLine,
      ]
        .filter(Boolean)
        .join(' '),
      style: input.style,
      aspectRatio: '3:4',
      composition:
        'One single unified image of one character, no splits, no panels, no divisions, clear silhouette, polished rendering, no text.',
      negativePrompt:
        'text, letters, numbers, collage, split-screen, multi-panel, split image, diptych, triptych, side by side, multiple views, duplicate character, two people, two figures, multiple characters, reference sheet, turnaround, photorealistic, photography, neutral mannequin pose',
      visualNarrative: `${input.protagonistName} rendered as the canonical in-style anchor for the episode. One single unified image, not split or divided.`,
      keyExpression: 'Readable calm but alert expression, neutral enough for reuse, never blank.',
      keyBodyLanguage:
        'Relaxed but purposeful three-quarter stance, asymmetric weight shift, clear silhouette.',
    },
  };
}

/**
 * Abstract color-script arc strip. No characters, no figures — just the
 * episode's tonal arc rendered in the chosen style.
 */
export function buildArcStripAnchorPrompt(input: ArcStripAnchorInput): BuiltAnchorPrompt {
  const fallbackStrip = `Abstract horizontal color-script strip for ${input.storyTitle}. Five to seven mood panels reading left-to-right showing the episode's tonal arc. No characters, no figures, no text.`;
  return {
    role: 'arc-strip',
    prompt: {
      prompt: input.stripPrompt?.trim() || fallbackStrip,
      style: input.style,
      aspectRatio: '4:1',
      composition:
        'Horizontal color script strip showing the episode look bible. Abstract mood panels only, no text, no characters, no people, no figures.',
      negativePrompt:
        'text, letters, numbers, captions, labels, collage, split-screen, multi-image grid, photorealistic, photography, person, people, character, figure, face, body, silhouette of person, human, man, woman, portrait',
      visualNarrative: `Episode style bible for ${input.storyTitle}: abstract color-and-light arc strip. NO characters, NO people, NO figures — purely abstract color mood panels.`,
    },
  };
}

/**
 * Environment-only vignette anchor. Locks in material palette and lighting
 * for the story's primary location.
 */
export function buildEnvironmentAnchorPrompt(input: EnvironmentAnchorInput): BuiltAnchorPrompt {
  const tones = (input.toneTerms || []).filter(Boolean).slice(0, 2).join(', ');
  const location = input.locationName?.trim() || "the episode's primary location";
  return {
    role: 'environment-anchor',
    prompt: {
      prompt: [
        `environment vignette of ${location} at the key tonal moment,`,
        'no people, atmospheric light and texture,',
        `the episode palette expressed through ${tones || 'the planned color script'},`,
        'designed as a visual style bible anchor for locations, unified single image',
      ].join(' '),
      style: input.style,
      aspectRatio: '16:9',
      composition:
        "Environment-only establishing vignette. No people, no figures, no text. Single cohesive image locking in the episode's material palette and lighting.",
      negativePrompt:
        'text, letters, numbers, captions, labels, characters, people, figures, person, woman, man, silhouette of person, portrait, collage, split-screen, multi-panel',
      visualNarrative: `Episode style bible environment anchor for ${input.storyTitle}: locks in the look of ${location} under the episode's tonal palette.`,
    },
  };
}

/**
 * Slug-friendly identifier for a given anchor, keyed off the story title.
 * Callers typically pass their own `idSlugify` result as `titleSlug`.
 */
export function anchorIdentifier(titleSlug: string, role: BuiltAnchorPrompt['role']): string {
  return `style-bible-${titleSlug}-${role}`;
}
