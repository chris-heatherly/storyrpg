/**
 * Per-provider reference strategy — the single source of truth for
 * "how many, which, and what kind of character reference artifacts does
 * this provider actually benefit from?"
 *
 * This complements `providerCapabilities.ts`:
 *   - `providerCapabilities` describes the raw transport (max refs, inline vs
 *     URL, seed support, concurrency limits, etc.)
 *   - `referenceStrategy` describes the *content* policy: which views to
 *     generate up-front for a character, and which of those views to
 *     forward as scene references on the hot path.
 *
 * The two tables are kept separate because capability is a fact about the
 * API, whereas strategy is an opinion about what maximizes identity
 * consistency per provider. Strategy rows can be tuned without touching
 * the transport layer.
 *
 * Current matrix:
 *
 *   nano-banana / atlas-cloud
 *     Gemini-family providers excel at multi-view consistency. Generate
 *     the full front / three-quarter / profile pack, plus a composite
 *     turnaround (installed as a low-weight style anchor via
 *     `setReferenceSheetStyleAnchor`), plus an expression sheet for
 *     major characters. Scene refs: all views + face crop.
 *
 *   dall-e (gpt-image-2)
 *     The `/v1/images/edits` endpoint accepts multi-image input, but
 *     gpt-image-2 tends to *copy* composite turnaround layouts as
 *     collages rather than extract identity, and expression sheets add
 *     noise more than they help (emotion is controlled well from the
 *     text prompt). Best practice per OpenAI guidance and empirical
 *     testing: one clean front view as the identity anchor, optionally
 *     a tight face crop. Generate nothing else.
 *
 *   midapi / useapi (Midjourney)
 *     Midjourney accepts exactly two reference slots (`--cref` identity
 *     and `--sref` style). The composite turnaround is the canonical
 *     `--cref` format. No individual views, no expression sheets.
 *
 *   stable-diffusion
 *     Self-hosted SD routes views into specific ControlNet / IP-Adapter
 *     units. The composite echoes badly through IP-Adapter (averages to
 *     a muddy embedding) and OpenPose detects multiple people in a
 *     turnaround, so we skip it. Expressions are not used today.
 *
 *   placeholder
 *     Deterministic stub provider used for tests and offline runs.
 *     Skips all reference generation.
 */

import type { ImageProvider } from '../config';

/**
 * Which reference views to generate for a character up front, and what
 * to pass downstream as the scene identity anchor.
 *
 * "Scene refs" in this context refers to what the reference pack builder /
 * `filterRefsForProvider` will *retain* for the provider at scene time.
 * Different providers prefer different shapes:
 *
 *   - `front`            : single front view only. Best for gpt-image-2.
 *   - `front+face`       : front view + tight face crop. Two clean signals.
 *   - `composite-anchor` : the composite sheet (turnaround), used as --cref
 *                          on Midjourney or as a style anchor on Gemini.
 *   - `all-views`        : pass the whole individual-view pack plus face
 *                          crop. Current Gemini default.
 *   - `none`             : don't generate refs at all (placeholder / text-
 *                          only providers).
 */
export type SceneReferenceShape =
  | 'front'
  | 'front+face'
  | 'composite-anchor'
  | 'all-views'
  | 'none';

export type CharacterView = 'front' | 'three-quarter' | 'profile';

export interface ReferenceStrategy {
  /**
   * Which individual views the image pipeline should actually generate
   * up-front for a character. Empty array → skip the individual-views
   * phase entirely.
   */
  generateViews: CharacterView[];

  /**
   * Generate a composite turnaround sheet after individual views? Only
   * useful for providers that consume it specifically (Midjourney
   * `--cref`, Gemini style anchor).
   */
  generateComposite: boolean;

  /**
   * Run the expression-sheet LLM planner AND its image generation?
   * False disables both.
   */
  generateExpressions: boolean;

  /**
   * Run the body-vocabulary LLM planner?
   */
  generateBodyVocabulary: boolean;

  /**
   * Run the silhouette-profile LLM planner and its image?
   */
  generateSilhouette: boolean;

  /**
   * How the downstream reference pack should look when this provider
   * receives a scene / beat call. Consumed by `filterRefsForProvider` in
   * `referencePackBuilder.ts`.
   */
  sceneRefs: SceneReferenceShape;

  /**
   * Absolute cap on reference images handed to this provider per call.
   * Applied on top of provider capability limits so strategy can be
   * tighter than capability (e.g. gpt-image-2's 16-ref capability but
   * best-practice cap of 2).
   */
  maxSceneRefs: number;
}

const STRATEGIES: Record<ImageProvider, ReferenceStrategy> = {
  'nano-banana': {
    generateViews: ['front', 'three-quarter', 'profile'],
    generateComposite: true,
    generateExpressions: true,
    generateBodyVocabulary: true,
    generateSilhouette: true,
    sceneRefs: 'all-views',
    maxSceneRefs: 10,
  },
  'atlas-cloud': {
    generateViews: ['front', 'three-quarter', 'profile'],
    generateComposite: true,
    generateExpressions: true,
    generateBodyVocabulary: true,
    generateSilhouette: true,
    sceneRefs: 'all-views',
    maxSceneRefs: 16,
  },
  midapi: {
    // Midjourney consumes the composite (--cref) and style-anchor (--sref);
    // individual views are not used separately. We still generate the
    // three-view pack for now (upstream planning / identity anchoring
    // relies on front for style-anchor installation), but downstream
    // filtering in referencePackBuilder keeps only the composite.
    generateViews: ['front', 'three-quarter', 'profile'],
    generateComposite: true,
    generateExpressions: false,
    generateBodyVocabulary: false,
    generateSilhouette: false,
    sceneRefs: 'composite-anchor',
    maxSceneRefs: 2,
  },
  useapi: {
    generateViews: ['front', 'three-quarter', 'profile'],
    generateComposite: true,
    generateExpressions: false,
    generateBodyVocabulary: false,
    generateSilhouette: false,
    sceneRefs: 'composite-anchor',
    maxSceneRefs: 2,
  },
  'dall-e': {
    // gpt-image-2: a single clean front view is the highest-signal ref.
    // Composite copies as a collage, three-quarter / profile add little,
    // expressions dilute identity signal. Keep it tight.
    generateViews: ['front'],
    generateComposite: false,
    generateExpressions: false,
    generateBodyVocabulary: false,
    generateSilhouette: false,
    sceneRefs: 'front+face',
    maxSceneRefs: 2,
  },
  'stable-diffusion': {
    // SD routes views into specific ControlNet / IP-Adapter units. The
    // composite isn't consumed (it echoes as a muddy embedding through
    // IP-Adapter) but `filterRefsForProvider` already strips it, so we
    // still generate it today to match legacy behavior; revisit if SD
    // cost becomes a concern.
    generateViews: ['front', 'three-quarter', 'profile'],
    generateComposite: true,
    generateExpressions: true,
    generateBodyVocabulary: true,
    generateSilhouette: true,
    sceneRefs: 'all-views',
    maxSceneRefs: 4,
  },
  placeholder: {
    generateViews: [],
    generateComposite: false,
    generateExpressions: false,
    generateBodyVocabulary: false,
    generateSilhouette: false,
    sceneRefs: 'none',
    maxSceneRefs: 0,
  },
};

/**
 * Canonicalize legacy / alias provider ids, mirroring
 * `providerCapabilities.canonicalProviderId`. Kept in sync intentionally
 * so both tables answer for the same canonical slug.
 */
function canonicalProviderId(provider: ImageProvider | string | undefined): ImageProvider {
  const p = (provider as ImageProvider) || 'placeholder';
  if (p === 'useapi') return 'midapi';
  return p;
}

/**
 * Returns the effective reference strategy for a provider. Unknown
 * providers fall back to the conservative `placeholder` row so new
 * providers don't accidentally kick off expensive reference generation.
 */
export function getReferenceStrategy(
  provider: ImageProvider | string | undefined,
): ReferenceStrategy {
  const normalized = canonicalProviderId(provider);
  return STRATEGIES[normalized] ?? STRATEGIES.placeholder;
}

/**
 * Convenience: does this provider benefit from any character reference
 * generation at all? Used by upstream orchestrators to decide whether to
 * even enter the character-refs phase.
 */
export function providerBenefitsFromCharacterRefs(
  provider: ImageProvider | string | undefined,
): boolean {
  const s = getReferenceStrategy(provider);
  return s.generateViews.length > 0 || s.generateComposite;
}
