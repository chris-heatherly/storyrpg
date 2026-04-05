import type { ReferenceImage } from '../services/imageGenerationService';
import type { ImageSlotFamily, SlotReferencePack } from './slotTypes';

export interface ReferencePackProfile {
  maxTotal: number;
  maxPerCharacter: number;
  includeExpressionRefs: boolean;
  includeEnvironmentRef: boolean;
}

const PROFILES: Record<ImageSlotFamily, ReferencePackProfile> = {
  'story-scene': { maxTotal: 6, maxPerCharacter: 2, includeExpressionRefs: false, includeEnvironmentRef: true },
  'story-beat': { maxTotal: 8, maxPerCharacter: 2, includeExpressionRefs: true, includeEnvironmentRef: true },
  'encounter-setup': { maxTotal: 8, maxPerCharacter: 2, includeExpressionRefs: true, includeEnvironmentRef: true },
  'encounter-outcome': { maxTotal: 9, maxPerCharacter: 2, includeExpressionRefs: true, includeEnvironmentRef: true },
  'encounter-situation': { maxTotal: 8, maxPerCharacter: 2, includeExpressionRefs: true, includeEnvironmentRef: true },
  'storylet-aftermath': { maxTotal: 9, maxPerCharacter: 2, includeExpressionRefs: true, includeEnvironmentRef: true },
  cover: { maxTotal: 8, maxPerCharacter: 2, includeExpressionRefs: false, includeEnvironmentRef: true },
  master: { maxTotal: 6, maxPerCharacter: 3, includeExpressionRefs: false, includeEnvironmentRef: false },
  expression: { maxTotal: 6, maxPerCharacter: 3, includeExpressionRefs: true, includeEnvironmentRef: false },
};

function rolePriority(role: string): number {
  if (role.includes('style')) return 0;
  if (role.includes('user-provided')) return 1;
  if (role.includes('character-reference')) return 2;
  if (role.includes('expression')) return 3;
  if (role.includes('location') || role.includes('environment')) return 4;
  return 5;
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
  const perCharacter = new Map<string, number>();
  const deduped = new Set<string>();
  const selected: ReferenceImage[] = [];

  for (const ref of sorted) {
    if (selected.length >= profile.maxTotal) break;
    if (!profile.includeExpressionRefs && ref.role.includes('expression')) continue;
    if (!profile.includeEnvironmentRef && (ref.role.includes('location') || ref.role.includes('environment'))) continue;

    const key = uniqueRefKey(ref);
    if (deduped.has(key)) continue;

    const charKey = ref.characterName || '';
    if (charKey) {
      const count = perCharacter.get(charKey) || 0;
      if (count >= profile.maxPerCharacter && ref.role.includes('character-reference')) continue;
      perCharacter.set(charKey, count + 1);
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
