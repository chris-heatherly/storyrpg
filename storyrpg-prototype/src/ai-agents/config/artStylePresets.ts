/**
 * Art style preset library (C7).
 *
 * Curated high-quality `ArtStyleProfile`s the Generator UI can surface as
 * picks. Each preset is a fully-specified profile (no blanks) so it can be
 * dropped straight into a story without the LLM being asked to author one.
 *
 * Add a new preset by appending to `ART_STYLE_PRESETS`. Keep `id` stable
 * once published — persisted stories reference it.
 */

import type { ArtStyleProfile } from '../images/artStyleProfile';

export interface ArtStylePreset {
  id: string;
  displayName: string;
  /** Short blurb shown under the preset tile in the UI. */
  description: string;
  /** Optional sample image path (relative to assets) for the picker. */
  samplePath?: string;
  profile: ArtStyleProfile;
}

export const ART_STYLE_PRESETS: ArtStylePreset[] = [
  {
    id: 'cinematic-dramatic',
    displayName: 'Cinematic drama',
    description: 'Photoreal film-still look with chiaroscuro lighting and strong staging.',
    profile: {
      name: 'dramatic cinematic story art',
      family: 'cinematic',
      renderingTechnique: 'photoreal digital illustration with shallow depth of field',
      colorPhilosophy: 'saturated with selective highlights, warm for safety / cool for danger',
      lightingApproach: 'high-contrast chiaroscuro with practical light sources',
      lineWeight: 'no outlines, painted edges',
      compositionStyle: 'rule-of-thirds focal point, asymmetric staging, dramatic diagonals',
      moodRange: 'dramatic and emotionally charged',
      acceptableDeviations: [],
      genreNegatives: ['flat lighting for drama beats', 'staged portrait feel'],
      positiveVocabulary: ['cinematic', 'dramatic', 'shallow focus', 'volumetric light'],
      inappropriateVocabulary: [],
      anchorWeight: 1,
    },
  },
  {
    id: 'gothic-ink-wash',
    displayName: 'Gothic ink wash',
    description: 'Brush ink with grey wash — atmospheric, haunted, silhouette-first.',
    profile: {
      name: 'gothic ink wash',
      family: 'ink',
      renderingTechnique: 'brush ink with wet-into-wet grey wash and occasional spatter',
      colorPhilosophy: 'near-monochrome with a single muted accent',
      lightingApproach: 'single strong light source, large dark shape design',
      lineWeight: 'variable brush line, expressive weight',
      compositionStyle: 'silhouette-first, generous negative space',
      moodRange: 'atmospheric, haunted, foreboding',
      acceptableDeviations: ['no-flat-lighting', 'no-symmetrical-composition'],
      genreNegatives: ['bright saturation', 'digital smoothness', 'airbrushed skin'],
      positiveVocabulary: ['brush ink', 'wash shading', 'expressive silhouette', 'ink spatter'],
      inappropriateVocabulary: ['bright colors', 'airbrushed'],
      anchorWeight: 2,
    },
  },
  {
    id: 'ghibli-watercolor',
    displayName: 'Studio watercolor',
    description: 'Soft wet-on-wet watercolor; warm, contemplative storytelling.',
    profile: {
      name: 'studio watercolor illustration',
      family: 'watercolor',
      renderingTechnique: 'wet-on-wet watercolor with visible paper texture and soft blooms',
      colorPhilosophy: 'muted, layered washes with translucent overlays',
      lightingApproach: 'soft ambient light, minimal hard shadows',
      lineWeight: 'faint pencil underdrawing, no hard outlines',
      compositionStyle: 'centered or gently diagonal, negative space welcome',
      moodRange: 'gentle, contemplative, warm',
      acceptableDeviations: [
        'frozen-moment-of-change',
        'asymmetric-body-language',
        'high-contrast-for-conflict',
        'no-flat-lighting',
        'no-symmetrical-composition',
        'thumbnail-readable-expressions',
      ],
      genreNegatives: ['photorealistic rendering', 'sharp edges', 'digital gradient', 'neon'],
      positiveVocabulary: ['soft edges', 'diffused light', 'paper texture', 'gentle wash'],
      inappropriateVocabulary: ['high-contrast', 'sharp shadows', 'neon', 'cyberpunk'],
      anchorWeight: 2,
    },
  },
  {
    id: 'neo-noir',
    displayName: 'Neo-noir',
    description: 'Hard shadows, venetian-blind light, desaturated with one accent color.',
    profile: {
      name: 'neo-noir illustration',
      family: 'noir',
      renderingTechnique: 'deep-shadow comic ink with selective color accents',
      colorPhilosophy: 'desaturated blacks and grays punctuated by one accent hue (sodium amber or cherry red)',
      lightingApproach: 'single hard light, shadows dominate, visible Venetian-blind patterns',
      lineWeight: 'thick expressive black ink, heavy shadow shapes',
      compositionStyle: 'Dutch angles welcome, silhouette readability prioritized',
      moodRange: 'oppressive, uneasy, foreboding',
      acceptableDeviations: ['no-flat-lighting'],
      genreNegatives: ['bright colors', 'warm palette', 'soft even lighting', 'pastel'],
      positiveVocabulary: ['hard shadows', 'chiaroscuro', 'rain-slick', 'backlit silhouette', 'sodium vapor light'],
      inappropriateVocabulary: ['warm safety', 'gentle glow'],
      anchorWeight: 2,
    },
  },
  {
    id: 'pixel-rpg',
    displayName: 'Pixel RPG',
    description: '16-bit pixel art with a tight palette. Limited resolution, charming clarity.',
    profile: {
      name: 'pixel art RPG',
      family: 'pixel',
      renderingTechnique: 'limited-palette pixel art, no anti-aliasing, aliased edges',
      colorPhilosophy: 'tight 16-32 color palette, flat fills',
      lightingApproach: 'flat with directional highlight pixels',
      lineWeight: 'single-pixel outlines',
      compositionStyle: 'centered or iso-tile composition acceptable, symbolic scale OK',
      moodRange: 'charming, readable',
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
  },
  {
    id: 'manga-screentone',
    displayName: 'Manga screentone',
    description: 'Black ink line art with halftone screentones and speedlines.',
    profile: {
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
  },
  {
    id: 'risograph',
    displayName: 'Risograph print',
    description: 'Two-color overprint with halftone dots and registration shifts.',
    profile: {
      name: 'risograph print illustration',
      family: 'risograph',
      renderingTechnique: 'two-color risograph overprint with registration shift and visible grain',
      colorPhilosophy: 'two or three spot inks (fluorescent pink + teal, or blue + red)',
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
  },
  {
    id: 'frazetta-oil',
    displayName: 'Heroic oil painting',
    description: 'Frazetta-inspired textured oil with mythic low-angle heroes.',
    profile: {
      name: 'Frazetta-esque oil painting',
      family: 'oil',
      renderingTechnique: 'textured oil brushwork with visible impasto',
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
  },
  {
    id: 'ligne-claire',
    displayName: 'Ligne claire',
    description: 'Clean uniform line + flat color. Tintin / Moebius lineage.',
    profile: {
      name: 'ligne claire comic',
      family: 'comic',
      renderingTechnique: 'uniform line weight with flat color fills and occasional tone',
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
  },
  {
    id: 'minimalist-editorial',
    displayName: 'Minimalist editorial',
    description: 'Restricted palette, geometric shapes, symbolic layouts.',
    profile: {
      name: 'minimalist editorial illustration',
      family: 'minimalist',
      renderingTechnique: 'flat vector shapes with minimal detail',
      colorPhilosophy: 'restricted palette, strong figure-ground',
      lightingApproach: 'flat, implied by color choice',
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
  },
];

export function findPresetById(id: string | undefined): ArtStylePreset | undefined {
  if (!id) return undefined;
  return ART_STYLE_PRESETS.find((p) => p.id === id);
}

export function findPresetByStyleName(name: string | undefined): ArtStylePreset | undefined {
  if (!name) return undefined;
  const lower = name.trim().toLowerCase();
  return ART_STYLE_PRESETS.find(
    (p) => p.displayName.toLowerCase() === lower || p.profile.name.toLowerCase() === lower,
  );
}
