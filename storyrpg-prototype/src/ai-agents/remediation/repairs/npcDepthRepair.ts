/**
 * NPCDepth dimension-count repair.
 *
 * Deterministic, no-LLM auto-fix for the NPCDepthValidator's tier-based
 * relationship-depth rule:
 *   - core NPCs       → all 4 dimensions (trust, affection, respect, fear)
 *   - supporting NPCs → at least 2 dimensions
 *   - background NPCs → at least 1 dimension
 *
 * The repair backfills MISSING dimension NAMES in canonical order so an NPC
 * meets its tier's minimum count. This is the least-fabricating approach: a
 * `RelationshipDimension` is a metadata tag, not narrative content. The repair
 * never invents dialogue, arc beats, or numeric values, and it never touches
 * `initialRelationship` — runtime/author still own the actual values.
 *
 * Gated by `GATE_NPC_DEPTH`. When the flag is disabled this is a complete
 * no-op (default-off, zero behavior change). Pure by construction: no
 * wall-clock, no randomness — the same story always produces the same fix.
 */

import type { Story, NPCTier, RelationshipDimension } from '../../../types';
import type { RemediationLedgerRecord } from '../remediationLedger';
import { DEFAULT_TIER_REQUIREMENTS, RELATIONSHIP_DIMENSIONS } from '../../config/tierRequirements';

const GATE_FLAG = 'GATE_NPC_DEPTH';
const RULE_NAME = 'NPCDepth';

const ALL_DIMENSIONS: RelationshipDimension[] = [...RELATIONSHIP_DIMENSIONS];

type NPC = Story['npcs'][number];

/**
 * Infer an NPC's tier when it has no explicit `tier`. Mirrors
 * `NPCDepthValidator.inferTier` so the repair and the validator cannot drift.
 */
function inferTier(npc: NPC): NPCTier {
  const role = npc.role?.toLowerCase();
  if (role === 'antagonist' || role === 'ally') {
    return 'core';
  }
  if (role === 'neutral') {
    return 'supporting';
  }
  return 'background';
}

/**
 * Compute the dimensions that must be added so `existing` meets the minimum
 * count for `tier`, in canonical order. Returns an empty array when the NPC
 * already satisfies the requirement.
 */
function computeMissingDimensions(
  tier: NPCTier,
  existing: RelationshipDimension[]
): RelationshipDimension[] {
  // Core NPCs require every dimension.
  if (tier === 'core') {
    return ALL_DIMENSIONS.filter((d) => !existing.includes(d));
  }

  const requiredCount = DEFAULT_TIER_REQUIREMENTS[tier];
  if (existing.length >= requiredCount) {
    return [];
  }

  const candidates = ALL_DIMENSIONS.filter((d) => !existing.includes(d));
  return candidates.slice(0, requiredCount - existing.length);
}

/**
 * Backfill missing NPC relationship dimensions so every NPC meets its tier's
 * minimum count.
 *
 * @returns the number of NPCs repaired plus one ledger record per repair.
 */
export function repairNPCDepth(
  story: Story,
  isEnabled: (flag: string) => boolean
): { fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> } {
  // Default-off: complete no-op when the gate is disabled.
  if (!isEnabled(GATE_FLAG)) {
    return { fixedCount: 0, records: [] };
  }

  let fixedCount = 0;
  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];

  for (const npc of story.npcs ?? []) {
    const tier = npc.tier ?? inferTier(npc);
    const existing = npc.relationshipDimensions ?? [];
    const missing = computeMissingDimensions(tier, existing);

    if (missing.length === 0) {
      continue;
    }

    // Mutate in place: append missing dimension names in canonical order.
    npc.relationshipDimensions = [...existing, ...missing];

    fixedCount += 1;
    records.push({
      rule: RULE_NAME,
      scope: 'autofix',
      attempted: 1,
      succeeded: true,
      degraded: false,
      blocked: false,
      attempts: 1,
    });
  }

  return { fixedCount, records };
}
