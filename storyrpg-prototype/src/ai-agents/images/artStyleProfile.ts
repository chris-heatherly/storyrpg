/**
 * ArtStyleProfile
 *
 * Structured replacement for the flat `canonicalArtStyle` string. A profile
 * captures the full aesthetic DNA of a story so downstream prompt builders
 * and validators can modulate their rules to match (instead of blindly
 * applying the default "dramatic cinematic" rule stack).
 *
 * The profile is authored once at story setup time (by a StyleArchitect
 * agent or by selecting a preset from `artStylePresets.ts`), persisted with
 * the story JSON, and flows to:
 *
 * - `buildNarrativePrompt` / `beatPromptBuilder` — modulates staging, negatives
 * - `ensureVisualPromptStrength` — bidirectional prompt strengthening
 * - `generateEpisodeStyleBible` — decides which style samples to render
 * - validators (under B1 QA toggles) — calibrates acceptance thresholds
 *
 * A profile may be derived from an existing flat style string via
 * `resolveArtStyleProfile`, which produces a reasonable best-effort shape
 * even when no preset matches.
 */

import type { ImageProvider } from '../config';

/** Rough family of techniques — informs which default rules apply. */
export type ArtStyleFamily =
  | 'cinematic'
  | 'watercolor'
  | 'noir'
  | 'manga'
  | 'anime'
  | 'comic'
  | 'pixel'
  | 'ink'
  | 'oil'
  | 'risograph'
  | 'minimalist'
  | 'storybook'
  | 'unknown';

/** Which of the "default rules" the profile wants to opt out of. */
export type DefaultRuleId =
  | 'frozen-moment-of-change'
  | 'asymmetric-body-language'
  | 'thumbnail-readable-expressions'
  | 'high-contrast-for-conflict'
  | 'mid-action-posing'
  | 'no-flat-lighting'
  | 'no-symmetrical-composition'
  | 'no-dead-center'
  | 'foreground-midground-background-depth'
  | 'rule-of-thirds-focal-point';

export interface ArtStyleProfile {
  /** Canonical short name, used as the style string when sent to the model. */
  name: string;
  /** Rough family bucket. */
  family: ArtStyleFamily;
  /** Long-form technique description (e.g. "heavy ink lines with wash shading"). */
  renderingTechnique: string;
  /** Color approach (e.g. "desaturated with red accents", "vibrant pastels"). */
  colorPhilosophy: string;
  /** Lighting language (e.g. "high-contrast chiaroscuro", "soft ambient"). */
  lightingApproach: string;
  /** Line weight / edge treatment (e.g. "thick expressive outlines"). */
  lineWeight: string;
  /** Composition tendencies (e.g. "dramatic diagonals", "centered symmetry is acceptable"). */
  compositionStyle: string;
  /** Mood range the style operates in (e.g. "dark and oppressive", "warm and hopeful"). */
  moodRange: string;
  /** Rules from the default set this style explicitly overrides. */
  acceptableDeviations: DefaultRuleId[];
  /** Style-specific negative-prompt phrases. */
  genreNegatives: string[];
  /** Style-specific positive vocabulary injected by ensureVisualPromptStrength. */
  positiveVocabulary: string[];
  /** Phrases that should be stripped from prompts for this style. */
  inappropriateVocabulary: string[];
  /**
   * Optional weight applied to the style anchor reference image (Gemini).
   * Higher values cause the text prompt to more strongly defer to the anchor.
   * 0 = don't mention the anchor, 1 = standard, 2 = heavy.
   */
  anchorWeight?: 0 | 1 | 2;
  /**
   * Optional per-provider hints. For instance Midjourney can pin to an
   * `--sref` code; SD can target specific LoRAs. Consumers are expected to
   * read only the keys they care about.
   */
  providerHints?: Partial<Record<ImageProvider, Record<string, string | number>>>;
}

/**
 * A minimal profile suitable when no style information is available. Matches
 * today's implicit behavior ("dramatic cinematic story art" + full rule stack)
 * so enabling profiles everywhere is a no-op if no explicit profile is chosen.
 */
export const DEFAULT_CINEMATIC_PROFILE: ArtStyleProfile = {
  name: 'dramatic cinematic story art',
  family: 'cinematic',
  renderingTechnique: 'photoreal digital illustration with cinematic depth-of-field',
  colorPhilosophy: 'saturated with selective highlights, warm for safety and cool for danger',
  lightingApproach: 'high-contrast chiaroscuro with practical light sources',
  lineWeight: 'no outlines, painted edges',
  compositionStyle: 'rule-of-thirds focal point, asymmetric staging, dramatic diagonals',
  moodRange: 'dramatic and emotionally charged',
  acceptableDeviations: [],
  genreNegatives: [],
  positiveVocabulary: ['cinematic', 'dramatic', 'emotionally charged', 'sharp focus'],
  inappropriateVocabulary: [],
  anchorWeight: 1,
};

/**
 * Best-effort derivation of a profile from a flat art-style string. Uses a
 * keyword match against known families. The result is intentionally
 * conservative — the caller can still override individual fields afterwards.
 */
export function resolveArtStyleProfile(input: string | ArtStyleProfile | undefined): ArtStyleProfile {
  if (!input) return DEFAULT_CINEMATIC_PROFILE;
  if (typeof input !== 'string') return input;

  const s = input.trim();
  if (!s) return DEFAULT_CINEMATIC_PROFILE;

  const lower = s.toLowerCase();
  const inferredFamily = inferFamily(lower);

  const base = BASE_BY_FAMILY[inferredFamily] ?? DEFAULT_CINEMATIC_PROFILE;
  return {
    ...base,
    name: s,
  };
}

function inferFamily(lower: string): ArtStyleFamily {
  if (/watercolor|watercolour|storybook|gouache/.test(lower)) return 'watercolor';
  if (/noir|detective|chiaroscuro/.test(lower)) return 'noir';
  if (/manga|screentone/.test(lower)) return 'manga';
  if (/anime|cel[- ]shad|ghibli/.test(lower)) return 'anime';
  if (/pixel|8[- ]bit|16[- ]bit|retro game/.test(lower)) return 'pixel';
  if (/ink wash|ink[- ]only|brush ink|sumi/.test(lower)) return 'ink';
  if (/oil paint|frazetta|bierstadt/.test(lower)) return 'oil';
  if (/risograph|riso|screenprint/.test(lower)) return 'risograph';
  if (/minimal|flat|vector/.test(lower)) return 'minimalist';
  if (/comic|ligne claire|graphic novel/.test(lower)) return 'comic';
  if (/cinematic|film still|dramatic/.test(lower)) return 'cinematic';
  return 'unknown';
}

/** Family-level shape used to hydrate profiles when only a string is known. */
const BASE_BY_FAMILY: Partial<Record<ArtStyleFamily, ArtStyleProfile>> = {
  cinematic: DEFAULT_CINEMATIC_PROFILE,
  watercolor: {
    name: 'watercolor illustration',
    family: 'watercolor',
    renderingTechnique: 'wet-on-wet watercolor with visible paper texture and soft blooms',
    colorPhilosophy: 'muted, layered washes with translucent overlays',
    lightingApproach: 'soft ambient light, minimal hard shadows',
    lineWeight: 'faint pencil underdrawing, no hard outlines',
    compositionStyle: 'centered or gently diagonal, negative space acceptable',
    moodRange: 'gentle, contemplative, warm',
    acceptableDeviations: [
      'frozen-moment-of-change',
      'asymmetric-body-language',
      'high-contrast-for-conflict',
      'no-flat-lighting',
      'no-symmetrical-composition',
      'thumbnail-readable-expressions',
    ],
    genreNegatives: [
      'photorealistic rendering',
      'sharp edges',
      'digital gradient',
      'harsh contrast',
      'neon lighting',
    ],
    positiveVocabulary: ['soft edges', 'diffused light', 'watercolor texture', 'gentle wash'],
    inappropriateVocabulary: ['high-contrast', 'sharp shadows', 'neon', 'cyberpunk'],
    anchorWeight: 2,
  },
  noir: {
    name: 'neo-noir illustration',
    family: 'noir',
    renderingTechnique: 'deep-shadow comic ink with selective color accents',
    colorPhilosophy: 'desaturated blacks and grays punctuated by one accent hue',
    lightingApproach: 'single hard light source, shadows dominate, visible Venetian-blind patterns',
    lineWeight: 'thick expressive black ink, heavy shadow shapes',
    compositionStyle: 'Dutch angles welcome, silhouette readability prioritized',
    moodRange: 'oppressive, uneasy, foreboding',
    acceptableDeviations: ['no-flat-lighting'],
    genreNegatives: ['bright colors', 'warm palette', 'soft even lighting', 'pastel'],
    positiveVocabulary: ['hard shadows', 'chiaroscuro', 'rain-slick', 'backlit silhouette'],
    inappropriateVocabulary: ['warm safety', 'gentle glow'],
    anchorWeight: 2,
  },
  manga: {
    name: 'manga screentone',
    family: 'manga',
    renderingTechnique: 'black ink line art with halftone screentones, selective speedlines',
    colorPhilosophy: 'monochrome with emphatic tone dots',
    lightingApproach: 'graphic blacks and whites, symbolic rather than physical',
    lineWeight: 'sharp variable-width ink',
    compositionStyle: 'centered hero shots acceptable, impact frames with radial lines',
    moodRange: 'kinetic, emotional, expressive',
    acceptableDeviations: ['no-symmetrical-composition', 'no-dead-center', 'thumbnail-readable-expressions'],
    genreNegatives: ['western oil painting', 'photorealism', 'realistic anatomy shading'],
    positiveVocabulary: ['screentone', 'speed lines', 'impact lines', 'expressive ink'],
    inappropriateVocabulary: ['photoreal', 'cinematic film still'],
    anchorWeight: 2,
  },
  anime: {
    name: 'anime cel-shaded illustration',
    family: 'anime',
    renderingTechnique: 'two-to-three tone cel shading with crisp line art and rim light',
    colorPhilosophy: 'saturated with pastel midtones, strong key light',
    lightingApproach: 'clear key + rim light, minimal ambient occlusion',
    lineWeight: 'clean outline, darker at silhouette edges',
    compositionStyle: 'centered heroic portraits acceptable, bold silhouettes',
    moodRange: 'expressive and emotionally legible',
    acceptableDeviations: ['no-symmetrical-composition', 'no-dead-center'],
    genreNegatives: ['photorealism', 'oil painting texture', 'grainy film'],
    positiveVocabulary: ['cel shading', 'rim light', 'crisp line art'],
    inappropriateVocabulary: ['photoreal', 'hyperrealistic'],
    anchorWeight: 2,
  },
  pixel: {
    name: 'pixel art RPG',
    family: 'pixel',
    renderingTechnique: 'limited-palette pixel art with aliased edges, no anti-aliasing',
    colorPhilosophy: 'tight 16-32 color palette, flat fills',
    lightingApproach: 'flat with directional highlight pixels',
    lineWeight: 'single-pixel outlines',
    compositionStyle: 'centered or iso-tile composition acceptable, symbolic scale OK',
    moodRange: 'charming and readable',
    acceptableDeviations: [
      'no-flat-lighting',
      'no-symmetrical-composition',
      'thumbnail-readable-expressions',
      'foreground-midground-background-depth',
    ],
    genreNegatives: ['anti-aliasing', 'photorealism', 'gradient shading', 'blur'],
    positiveVocabulary: ['pixel art', 'dithering', 'limited palette'],
    inappropriateVocabulary: ['photoreal', 'soft gradient', 'bokeh'],
    anchorWeight: 2,
  },
  ink: {
    name: 'gothic ink wash',
    family: 'ink',
    renderingTechnique: 'brush ink with wet-into-wet grey wash; occasional spatter',
    colorPhilosophy: 'near-monochrome with one muted accent',
    lightingApproach: 'strong single light, large dark shape design',
    lineWeight: 'variable brush line, expressive weight',
    compositionStyle: 'silhouette-first, negative space welcome',
    moodRange: 'atmospheric and haunted',
    acceptableDeviations: ['no-flat-lighting', 'no-symmetrical-composition'],
    genreNegatives: ['bright saturation', 'digital smoothness', 'airbrushed skin'],
    positiveVocabulary: ['brush ink', 'wash shading', 'expressive silhouette'],
    inappropriateVocabulary: ['bright colors', 'airbrushed'],
    anchorWeight: 2,
  },
  oil: {
    name: 'Frazetta-esque oil painting',
    family: 'oil',
    renderingTechnique: 'textured oil brushwork, visible impasto',
    colorPhilosophy: 'earth-toned with warm firelight highlights',
    lightingApproach: 'dramatic directional warm/cool contrast',
    lineWeight: 'painted edges, no outlines',
    compositionStyle: 'heroic low-angle shots, muscular silhouettes',
    moodRange: 'mythic and operatic',
    acceptableDeviations: [],
    genreNegatives: ['flat digital shading', 'clean vector lines', 'neon'],
    positiveVocabulary: ['oil impasto', 'brushwork', 'earth tones', 'warm rim light'],
    inappropriateVocabulary: ['vector art', 'flat shaded'],
    anchorWeight: 2,
  },
  risograph: {
    name: 'risograph print',
    family: 'risograph',
    renderingTechnique: 'two-color risograph overprint with registration shift and grain',
    colorPhilosophy: 'two or three spot inks (fluorescent pink + teal, etc.)',
    lightingApproach: 'graphic flat shapes, minimal modeling',
    lineWeight: 'chunky shapes, halftone dots for tone',
    compositionStyle: 'poster-like, centered or bold diagonals',
    moodRange: 'playful, graphic, nostalgic',
    acceptableDeviations: ['no-flat-lighting', 'no-symmetrical-composition', 'thumbnail-readable-expressions'],
    genreNegatives: ['full-color photoreal', 'smooth gradient'],
    positiveVocabulary: ['risograph', 'halftone', 'registration shift', 'spot color'],
    inappropriateVocabulary: ['photoreal', 'smooth gradient'],
    anchorWeight: 2,
  },
  minimalist: {
    name: 'minimalist editorial illustration',
    family: 'minimalist',
    renderingTechnique: 'flat vector shapes with minimal detail',
    colorPhilosophy: 'restricted palette, strong figure-ground',
    lightingApproach: 'flat — lighting implied by color choice',
    lineWeight: 'clean geometric outlines or none',
    compositionStyle: 'symbolic layout, centered symmetry welcome',
    moodRange: 'clean, quiet, thoughtful',
    acceptableDeviations: [
      'no-flat-lighting',
      'no-symmetrical-composition',
      'no-dead-center',
      'foreground-midground-background-depth',
      'thumbnail-readable-expressions',
    ],
    genreNegatives: ['photorealism', 'heavy shadow', 'painted texture'],
    positiveVocabulary: ['flat color', 'geometric', 'editorial illustration'],
    inappropriateVocabulary: ['photoreal', 'heavy shadow'],
    anchorWeight: 2,
  },
  storybook: {
    name: 'children\'s storybook illustration',
    family: 'storybook',
    renderingTechnique: 'soft gouache with textured paper',
    colorPhilosophy: 'warm pastels, gentle saturation',
    lightingApproach: 'even warm light, gentle shadows',
    lineWeight: 'optional soft outline',
    compositionStyle: 'centered, inviting compositions',
    moodRange: 'warm and hopeful',
    acceptableDeviations: [
      'frozen-moment-of-change',
      'high-contrast-for-conflict',
      'no-flat-lighting',
      'no-symmetrical-composition',
      'mid-action-posing',
    ],
    genreNegatives: ['grimdark', 'gore', 'neon cyberpunk', 'hard shadow'],
    positiveVocabulary: ['gouache', 'soft texture', 'warm palette'],
    inappropriateVocabulary: ['grimdark', 'chiaroscuro'],
    anchorWeight: 2,
  },
  comic: {
    name: 'ligne claire comic',
    family: 'comic',
    renderingTechnique: 'uniform line weight, flat color fills with occasional tone',
    colorPhilosophy: 'saturated primaries with clear separations',
    lightingApproach: 'graphic, color-as-light',
    lineWeight: 'uniform clean line',
    compositionStyle: 'clear tableau, readable silhouettes',
    moodRange: 'adventurous and clear',
    acceptableDeviations: [],
    genreNegatives: ['painterly texture', 'airbrushed gradient'],
    positiveVocabulary: ['ligne claire', 'flat color', 'clean line'],
    inappropriateVocabulary: ['painterly', 'airbrushed'],
    anchorWeight: 2,
  },
  unknown: DEFAULT_CINEMATIC_PROFILE,
};

/** True if the profile opts this default rule out of the shared rule stack. */
export function profileAllowsDeviation(profile: ArtStyleProfile, rule: DefaultRuleId): boolean {
  return profile.acceptableDeviations.includes(rule);
}
