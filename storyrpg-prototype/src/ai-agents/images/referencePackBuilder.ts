import type { ReferenceImage } from '../services/imageGenerationService';
import type { ImageSlotFamily, SlotReferencePack } from './slotTypes';

export interface ReferencePackProfile {
  maxTotal: number;
  /** Max identity (pose/face) refs per character. */
  maxPerCharacter: number;
  /** Max expression refs per character, counted separately so expressions never evict identity views. */
  maxExpressionsPerCharacter: number;
  includeExpressionRefs: boolean;
  includeEnvironmentRef: boolean;
}

const PROFILES: Record<ImageSlotFamily, ReferencePackProfile> = {
  'story-scene': { maxTotal: 6, maxPerCharacter: 3, maxExpressionsPerCharacter: 0, includeExpressionRefs: false, includeEnvironmentRef: true },
  'story-beat': { maxTotal: 8, maxPerCharacter: 3, maxExpressionsPerCharacter: 1, includeExpressionRefs: true, includeEnvironmentRef: true },
  'encounter-setup': { maxTotal: 8, maxPerCharacter: 3, maxExpressionsPerCharacter: 1, includeExpressionRefs: true, includeEnvironmentRef: true },
  'encounter-outcome': { maxTotal: 9, maxPerCharacter: 3, maxExpressionsPerCharacter: 1, includeExpressionRefs: true, includeEnvironmentRef: true },
  'encounter-situation': { maxTotal: 8, maxPerCharacter: 3, maxExpressionsPerCharacter: 1, includeExpressionRefs: true, includeEnvironmentRef: true },
  'storylet-aftermath': { maxTotal: 9, maxPerCharacter: 3, maxExpressionsPerCharacter: 1, includeExpressionRefs: true, includeEnvironmentRef: true },
  cover: { maxTotal: 8, maxPerCharacter: 3, maxExpressionsPerCharacter: 0, includeExpressionRefs: false, includeEnvironmentRef: true },
  master: { maxTotal: 6, maxPerCharacter: 3, maxExpressionsPerCharacter: 0, includeExpressionRefs: false, includeEnvironmentRef: false },
  expression: { maxTotal: 6, maxPerCharacter: 3, maxExpressionsPerCharacter: 3, includeExpressionRefs: true, includeEnvironmentRef: false },
};

function rolePriority(role: string): number {
  if (role.includes('style')) return 0;
  if (role.includes('user-provided')) return 1;
  // Face crops carry the strongest per-image identity signal. Always select
  // them first so they are never evicted by other character-reference views.
  if (role.includes('character-reference') && role.includes('face')) return 2;
  if (role.includes('character-reference')) return 3;
  if (role.includes('expression')) return 4;
  if (role.includes('location') || role.includes('environment')) return 5;
  return 6;
}

function isExpressionRef(role: string): boolean {
  return role.includes('expression') && !role.includes('face');
}

function isIdentityRef(role: string): boolean {
  return role.includes('character-reference');
}

function uniqueRefKey(ref: ReferenceImage): string {
  return [ref.role, ref.characterName || '', ref.viewType || '', ref.data.slice(0, 32)].join('::');
}

export function buildReferencePack(
  slotId: string,
  family: ImageSlotFamily,
  references: ReferenceImage[],
): SlotReferencePack {
  const profile = PROFILES[family];
  const sorted = [...references].sort((a, b) => rolePriority(a.role) - rolePriority(b.role));
  const identityCountByChar = new Map<string, number>();
  const expressionCountByChar = new Map<string, number>();
  const deduped = new Set<string>();
  const selected: ReferenceImage[] = [];

  for (const ref of sorted) {
    if (selected.length >= profile.maxTotal) break;
    if (!profile.includeExpressionRefs && isExpressionRef(ref.role)) continue;
    if (!profile.includeEnvironmentRef && (ref.role.includes('location') || ref.role.includes('environment'))) continue;

    const key = uniqueRefKey(ref);
    if (deduped.has(key)) continue;

    const charKey = ref.characterName || '';
    if (charKey) {
      if (isExpressionRef(ref.role)) {
        const count = expressionCountByChar.get(charKey) || 0;
        if (count >= profile.maxExpressionsPerCharacter) continue;
        expressionCountByChar.set(charKey, count + 1);
      } else if (isIdentityRef(ref.role)) {
        const count = identityCountByChar.get(charKey) || 0;
        if (count >= profile.maxPerCharacter) continue;
        identityCountByChar.set(charKey, count + 1);
      }
    }

    deduped.add(key);
    selected.push(ref);
  }

  return {
    slotId,
    totalCount: selected.length,
    references: selected,
    summary: selected.map((ref) => ({
      role: ref.role,
      characterName: ref.characterName,
      viewType: ref.viewType,
    })),
  };
}

export function getReferencePackProfile(family: ImageSlotFamily): ReferencePackProfile {
  return PROFILES[family];
}
