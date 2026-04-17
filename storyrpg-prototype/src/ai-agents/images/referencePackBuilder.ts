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
  /**
   * D2: Reserved slots that the builder always tries to fill before
   * allocating general character/expression refs. These slots are carved out
   * of `maxTotal` and do not count against `maxPerCharacter`.
   *
   * `styleAnchor`  : reserve for a role containing "style"
   * `location`     : reserve for a role containing "location" or "environment"
   * `userProvided` : reserve for a role containing "user-provided"
   *
   * If the corresponding ref isn't present, the slot is forfeited back to
   * the general pool rather than left empty. `maxPerCharacter` still caps
   * identity refs per character.
   */
  reservedSlots?: {
    styleAnchor?: number;
    location?: number;
    userProvided?: number;
  };
}

const PROFILES: Record<ImageSlotFamily, ReferencePackProfile> = {
  'story-scene': {
    maxTotal: 6,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 0,
    includeExpressionRefs: false,
    includeEnvironmentRef: true,
    reservedSlots: { styleAnchor: 1, location: 1 },
  },
  'story-beat': {
    maxTotal: 8,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 1,
    includeExpressionRefs: true,
    includeEnvironmentRef: true,
    reservedSlots: { styleAnchor: 1, location: 1 },
  },
  'encounter-setup': {
    maxTotal: 8,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 1,
    includeExpressionRefs: true,
    includeEnvironmentRef: true,
    reservedSlots: { styleAnchor: 1, location: 1 },
  },
  'encounter-outcome': {
    maxTotal: 9,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 1,
    includeExpressionRefs: true,
    includeEnvironmentRef: true,
    reservedSlots: { styleAnchor: 1, location: 1 },
  },
  'encounter-situation': {
    maxTotal: 8,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 1,
    includeExpressionRefs: true,
    includeEnvironmentRef: true,
    reservedSlots: { styleAnchor: 1, location: 1 },
  },
  'storylet-aftermath': {
    maxTotal: 9,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 1,
    includeExpressionRefs: true,
    includeEnvironmentRef: true,
    reservedSlots: { styleAnchor: 1, location: 1 },
  },
  cover: {
    maxTotal: 8,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 0,
    includeExpressionRefs: false,
    includeEnvironmentRef: true,
    reservedSlots: { styleAnchor: 1, location: 1 },
  },
  master: {
    maxTotal: 6,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 0,
    includeExpressionRefs: false,
    includeEnvironmentRef: false,
    reservedSlots: { styleAnchor: 1, userProvided: 2 },
  },
  expression: {
    maxTotal: 6,
    maxPerCharacter: 3,
    maxExpressionsPerCharacter: 3,
    includeExpressionRefs: true,
    includeEnvironmentRef: false,
  },
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

function isStyleAnchorRef(role: string): boolean {
  return role.includes('style');
}

function isLocationRef(role: string): boolean {
  return role.includes('location') || role.includes('environment');
}

function isUserProvidedRef(role: string): boolean {
  return role.includes('user-provided');
}

function uniqueRefKey(ref: ReferenceImage): string {
  return [ref.role, ref.characterName || '', ref.viewType || '', ref.data.slice(0, 32)].join('::');
}

export interface BuildReferencePackOptions {
  /**
   * D3: Per-character weight (0..2). Multiplied against `maxPerCharacter` to
   * allocate more slots to major characters. Names not present default to
   * 1.0 (the profile's `maxPerCharacter`). Values are clamped so no single
   * character can consume more than `maxTotal`.
   */
  characterWeights?: Record<string, number>;
}

export function buildReferencePack(
  slotId: string,
  family: ImageSlotFamily,
  references: ReferenceImage[],
  options: BuildReferencePackOptions = {},
): SlotReferencePack {
  const profile = PROFILES[family];
  const reserved = profile.reservedSlots || {};
  const reservedStyleSlots = reserved.styleAnchor ?? 0;
  const reservedLocationSlots = profile.includeEnvironmentRef ? (reserved.location ?? 0) : 0;
  const reservedUserSlots = reserved.userProvided ?? 0;
  const totalReserved = reservedStyleSlots + reservedLocationSlots + reservedUserSlots;
  const generalBudget = Math.max(0, profile.maxTotal - totalReserved);
  const weights = options.characterWeights ?? {};

  const sorted = [...references].sort((a, b) => rolePriority(a.role) - rolePriority(b.role));
  const identityCountByChar = new Map<string, number>();
  const expressionCountByChar = new Map<string, number>();
  const deduped = new Set<string>();
  const selected: ReferenceImage[] = [];
  let styleSlotsUsed = 0;
  let locationSlotsUsed = 0;
  let userSlotsUsed = 0;
  let generalUsed = 0;

  const canAddReserved = (ref: ReferenceImage): boolean => {
    if (isStyleAnchorRef(ref.role) && styleSlotsUsed < reservedStyleSlots) {
      styleSlotsUsed++;
      return true;
    }
    if (isUserProvidedRef(ref.role) && userSlotsUsed < reservedUserSlots) {
      userSlotsUsed++;
      return true;
    }
    if (isLocationRef(ref.role) && locationSlotsUsed < reservedLocationSlots) {
      locationSlotsUsed++;
      return true;
    }
    return false;
  };

  const perCharCap = (charKey: string): number => {
    if (!charKey) return profile.maxPerCharacter;
    const weight = weights[charKey];
    if (weight === undefined || !Number.isFinite(weight) || weight <= 0) return profile.maxPerCharacter;
    const scaled = Math.round(profile.maxPerCharacter * Math.max(0, Math.min(2, weight)));
    // A weighted entry of 0 would zero out the character entirely; clamp to 1
    // so we still include at least one identity view when they're in-scene.
    return Math.max(1, Math.min(profile.maxTotal, scaled));
  };

  for (const ref of sorted) {
    if (selected.length >= profile.maxTotal) break;
    if (!profile.includeExpressionRefs && isExpressionRef(ref.role)) continue;
    if (!profile.includeEnvironmentRef && isLocationRef(ref.role)) continue;

    const key = uniqueRefKey(ref);
    if (deduped.has(key)) continue;

    const charKey = ref.characterName || '';
    if (charKey) {
      if (isExpressionRef(ref.role)) {
        const count = expressionCountByChar.get(charKey) || 0;
        if (count >= profile.maxExpressionsPerCharacter) continue;
        expressionCountByChar.set(charKey, count + 1);
      } else if (isIdentityRef(ref.role)) {
        const cap = perCharCap(charKey);
        const count = identityCountByChar.get(charKey) || 0;
        if (count >= cap) continue;
        identityCountByChar.set(charKey, count + 1);
      }
    }

    // D2: Prefer the reserved-slot bucket if this ref qualifies.
    const wentToReserved = canAddReserved(ref);
    if (!wentToReserved) {
      if (generalUsed >= generalBudget) continue;
      generalUsed++;
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
