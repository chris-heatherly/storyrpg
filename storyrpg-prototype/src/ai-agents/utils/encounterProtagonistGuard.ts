/**
 * Protagonist-as-NPC guard (G12).
 *
 * The bite-me-g12 ep1 encounter cast the protagonist as an NPC: "Kylie Marinescu —
 * wary" in npcStates (rendered as a HUD badge by EncounterView), ~12 relationship
 * consequences paying affection to `char-kylie-marinescu`, and table dialogue
 * addressed to a second Kylie. The npcStates/consequence halves are deterministic
 * data defects — strip them at the final-contract chokepoint and report what was
 * removed so the prose half (a validator finding) has a precise location.
 */

import type { Story } from '../../types';

export interface ProtagonistEncounterStripResult {
  npcStatesRemoved: number;
  relationshipConsequencesRemoved: number;
  locations: string[];
}

/** Normalize a display name or char-id for identity comparison. */
function normalizeRef(s: string): string {
  return s
    .toLowerCase()
    .replace(/^char-/, '')
    .replace(/\(.*?\)/g, ' ') // "Sadie (via FaceTime)" → "Sadie"
    .replace(/[^a-zà-žăâîșț0-9]+/gi, ' ')
    .trim();
}

function buildMatcher(protagonist: { id?: string; name?: string; aliases?: string[] }): (ref: unknown) => boolean {
  const targets = new Set(
    [protagonist.id, protagonist.name, ...(protagonist.aliases || [])]
      .filter((s): s is string => Boolean(s && s.trim()))
      .map(normalizeRef)
      .filter((s) => s.length > 0 && s !== 'protagonist' && s !== 'the hero'),
  );
  return (ref: unknown): boolean => {
    if (typeof ref !== 'string' || !ref.trim()) return false;
    return targets.has(normalizeRef(ref));
  };
}

/**
 * Remove the protagonist from every encounter's npcStates and drop relationship
 * consequences that target the protagonist (the player cannot have a relationship
 * score with herself). Mutates in place; idempotent.
 */
export function stripProtagonistFromEncounters(
  story: Story,
  protagonist: { id?: string; name?: string; aliases?: string[] },
): ProtagonistEncounterStripResult {
  const result: ProtagonistEncounterStripResult = {
    npcStatesRemoved: 0,
    relationshipConsequencesRemoved: 0,
    locations: [],
  };
  const isProtagonist = buildMatcher(protagonist);
  if (!protagonist.name && !protagonist.id) return result;

  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      const enc = scene.encounter as unknown as Record<string, unknown> | undefined;
      if (!enc) continue;

      const npcStates = enc.npcStates;
      if (Array.isArray(npcStates)) {
        const before = npcStates.length;
        enc.npcStates = npcStates.filter(
          (st) => !isProtagonist((st as { npcId?: unknown })?.npcId) && !isProtagonist((st as { name?: unknown })?.name),
        );
        const removed = before - (enc.npcStates as unknown[]).length;
        if (removed > 0) {
          result.npcStatesRemoved += removed;
          result.locations.push(`${scene.id}/npcStates`);
        }
      }

      // Deep-walk the encounter for relationship consequences targeting the protagonist.
      const seen = new Set<object>();
      const visit = (node: unknown, path: string): void => {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node as object);
        if (Array.isArray(node)) {
          node.forEach((item, i) => visit(item, `${path}[${i}]`));
          return;
        }
        const obj = node as Record<string, unknown>;
        for (const [key, value] of Object.entries(obj)) {
          if (Array.isArray(value) && value.some((c) => (c as { type?: string })?.type === 'relationship')) {
            const before = value.length;
            const filtered = value.filter(
              (c) =>
                !((c as { type?: string })?.type === 'relationship' &&
                  isProtagonist((c as { npcId?: unknown }).npcId)),
            );
            if (filtered.length !== before) {
              obj[key] = filtered;
              result.relationshipConsequencesRemoved += before - filtered.length;
              result.locations.push(`${scene.id}/${path}/${key}`);
            }
            filtered.forEach((item, i) => visit(item, `${path}/${key}[${i}]`));
          } else if (value && typeof value === 'object') {
            visit(value, `${path}/${key}`);
          }
        }
      };
      visit(enc, 'encounter');
    }
  }
  return result;
}
