/**
 * Character profile resolver
 *
 * Resolves a character/NPC token (which may be a canonical bible id like
 * `char-mika-drgan`, a short treatment id like `mika`, or a display name) to a
 * `CharacterProfile` in the character bible.
 *
 * Why this exists: several pipeline seams build NPC rosters from
 * `encounterRequiredNpcIds` / `npcsPresent`, which can carry short treatment
 * ids while the character bible is keyed by canonical `char-*` ids. An exact
 * `find(c => c.id === token)` misses, the profile resolves to `undefined`, and
 * the NPC silently falls back to a bare id name and a `he/him` default — which
 * misgenders female/non-binary characters (the Gen-4 "Mika rendered he/him"
 * defect). This helper mirrors the precise matcher previously inlined as
 * `characterForToken` in the image path (exact id, then normalized id / full
 * name / first name) so every seam resolves NPCs the same way.
 */

import type { CharacterProfile, PronounSet } from '../agents/CharacterDesigner';

const normalizeToken = (value: string | null | undefined): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * Resolve a token to a character profile. Tries, in order:
 *   1. exact id match
 *   2. normalized id match (case/punctuation-insensitive)
 *   3. full-name match
 *   4. first-name match
 * Returns `undefined` when nothing matches.
 */
export function resolveCharacterProfile(
  characters: CharacterProfile[] | undefined | null,
  token: string | undefined | null,
): CharacterProfile | undefined {
  if (!token || !characters || characters.length === 0) return undefined;

  const exact = characters.find(c => c.id === token);
  if (exact) return exact;

  const normalized = normalizeToken(token);
  if (!normalized) return undefined;

  return characters.find(c => {
    const idN = normalizeToken(c.id);
    const fullN = normalizeToken(c.name);
    const firstN = normalizeToken(String(c.name || '').split(/\s+/)[0]);
    return idN === normalized || fullN === normalized || firstN === normalized;
  });
}

/**
 * Resolve a token to its pronouns. Falls back to a neutral `they/them` (NOT a
 * gendered default) and warns when resolution fails, so an unresolved NPC can
 * never silently be misgendered masculine.
 */
export function resolveNpcPronouns(
  characters: CharacterProfile[] | undefined | null,
  token: string | undefined | null,
  options: { warn?: boolean; context?: string } = {},
): PronounSet {
  const { warn = true, context } = options;
  const profile = resolveCharacterProfile(characters, token);
  if (profile?.pronouns) return profile.pronouns;
  if (warn) {
    console.warn(
      `[characterProfileResolver] Could not resolve pronouns for NPC token "${token}"${
        context ? ` (${context})` : ''
      }; defaulting to they/them`,
    );
  }
  return 'they/them';
}
