/**
 * Shared NPC tier → relationship-dimension-count requirements.
 *
 * Referenced by both `NPCDepthValidator` (to enforce) and
 * `CharacterDesigner` (to prompt the author) so the two agents cannot
 * drift.
 */

import type { NPCTier } from '../../types';

/**
 * Minimum number of relationship dimensions (trust / affection / respect /
 * fear) a character must have authored to pass validation, keyed by tier.
 */
export const DEFAULT_TIER_REQUIREMENTS: Record<NPCTier, number> = {
  core: 4,
  supporting: 2,
  background: 1,
};

/** Ordered list of relationship dimensions. */
export const RELATIONSHIP_DIMENSIONS = ['trust', 'affection', 'respect', 'fear'] as const;

/**
 * Human-readable summary of tier requirements, suitable for embedding in
 * LLM prompts.
 */
export function describeTierRequirements(): string {
  return [
    `- **core** NPCs MUST have all ${DEFAULT_TIER_REQUIREMENTS.core} relationship dimensions (${RELATIONSHIP_DIMENSIONS.join(', ')}).`,
    `- **supporting** NPCs MUST have at least ${DEFAULT_TIER_REQUIREMENTS.supporting} relationship dimensions.`,
    `- **background** NPCs MUST have at least ${DEFAULT_TIER_REQUIREMENTS.background} relationship dimension.`,
  ].join('\n');
}
