/**
 * Witness-reaction NPC-id canonicalization.
 *
 * Background: `witnessReactions[].npcId` is authored by ChoiceAuthor's LLM using
 * whatever NPC label it was given. The per-scene NPC list (`sceneBlueprint.npcsPresent`)
 * holds RAW display names / short slugs ("mika", "carmen", "Mihaela 'Mika' Drăgan"),
 * not the canonical `char-${slugify(name)}` ids that end up in `story.npcs`. So witness
 * ids ship in non-canonical form and fail MechanicalStorytellingValidator's
 * unknown-NPC check.
 *
 * This module resolves a raw witness id against the AUTHORITATIVE roster
 * (`story.npcs`, which always carries canonical id + full name) and rewrites it.
 * Run it once over the finished story (assembly stage) so every witness path —
 * scene choices, beat choices, nested structures — is corrected regardless of how
 * it was authored. Unresolvable ids are dropped (they were dead data: the reader
 * runtime does not consume witnessReactions, and the validator would reject them).
 */

export interface NpcRosterEntry {
  id: string;
  name?: string;
}

const norm = (s: string): string => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const stripCharPrefix = (n: string): string => n.replace(/^char/, '');
const tokens = (s: string): string[] =>
  String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4); // skip short titles/articles ("of", "the")

/**
 * Resolve a raw witness NPC id/name to a canonical roster id, or undefined if it
 * cannot be matched unambiguously. Tiers, most-precise first:
 *   1. exact id
 *   2. alphanumeric-normalized equality vs canonical id (with/without `char` prefix) or full name
 *   3. unique distinctive name-token overlap (e.g. surname), only if exactly one NPC matches
 * Tier 3 requires a UNIQUE match so a bare shared surname never mis-binds.
 */
export function resolveWitnessNpcId(rawId: string, roster: NpcRosterEntry[]): string | undefined {
  const raw = String(rawId || '').trim();
  if (!raw || !roster?.length) return undefined;

  // 1. exact id
  const exact = roster.find((n) => n.id === raw);
  if (exact) return exact.id;

  // 2. normalized equality (id, id-without-char-prefix, or full name)
  const nr = norm(raw);
  const normEq = roster.find(
    (n) => norm(n.id) === nr || stripCharPrefix(norm(n.id)) === nr || norm(n.name || '') === nr,
  );
  if (normEq) return normEq.id;

  // 3. unique distinctive name-token overlap
  const rawTokens = new Set(tokens(raw));
  if (rawTokens.size > 0) {
    const candidates = roster.filter((n) => tokens(n.name || '').some((t) => rawTokens.has(t)));
    if (candidates.length === 1) return candidates[0].id;
  }

  return undefined;
}

export interface WitnessCanonicalizationResult {
  total: number;
  remapped: number;
  dropped: number;
}

/**
 * Walk any node (a story, an array of choice sets, a single scene, …) and
 * canonicalize every `witnessReactions[].npcId` against the supplied canonical
 * roster. Remaps resolvable ids and drops unresolvable reactions IN PLACE.
 * Generic recursive walk so it covers witness reactions wherever they nest.
 * No-op (and leaves data untouched) when the roster is empty.
 */
export function canonicalizeWitnessReactions(
  node: unknown,
  roster: NpcRosterEntry[],
): WitnessCanonicalizationResult {
  const result: WitnessCanonicalizationResult = { total: 0, remapped: 0, dropped: 0 };
  const cleanRoster: NpcRosterEntry[] = Array.isArray(roster)
    ? roster.filter((n) => n && typeof n.id === 'string').map((n) => ({ id: n.id, name: n.name }))
    : [];
  if (cleanRoster.length === 0) return result; // no authoritative roster → leave untouched

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    const wr = obj.witnessReactions;
    if (Array.isArray(wr)) {
      const kept: unknown[] = [];
      for (const reaction of wr) {
        if (!reaction || typeof reaction !== 'object') {
          kept.push(reaction);
          continue;
        }
        const r = reaction as Record<string, unknown>;
        const rawId = typeof r.npcId === 'string' ? r.npcId : '';
        if (!rawId) {
          // No id to resolve — drop (matches validator's "(missing)" rejection).
          result.total++;
          result.dropped++;
          continue;
        }
        result.total++;
        const canonical = resolveWitnessNpcId(rawId, cleanRoster);
        if (canonical) {
          if (canonical !== rawId) {
            r.npcId = canonical;
            result.remapped++;
          }
          kept.push(reaction);
        } else {
          result.dropped++;
        }
      }
      obj.witnessReactions = kept;
    }

    for (const key of Object.keys(obj)) {
      if (key === 'witnessReactions') continue;
      visit(obj[key]);
    }
  };

  visit(node);
  return result;
}

/**
 * Convenience wrapper: canonicalize a whole story object against its own
 * authoritative `story.npcs` roster (used at the final-assembly chokepoint).
 */
export function canonicalizeStoryWitnessReactions(story: unknown): WitnessCanonicalizationResult {
  if (!story || typeof story !== 'object') return { total: 0, remapped: 0, dropped: 0 };
  const npcs = (story as { npcs?: NpcRosterEntry[] }).npcs;
  return canonicalizeWitnessReactions(story, Array.isArray(npcs) ? npcs : []);
}

export interface WitnessPresenceScene {
  sceneId: string;
  beats?: Array<{ id?: string } | null | undefined>;
  charactersInvolved?: string[];
}

/**
 * Ensure every (canonical, known) witness NPC is listed in the scene where it
 * reacts — the deterministic fix for MechanicalStorytellingValidator's
 * "Witness reaction NPC ... is not listed in scene" PREFERENCE warning (the NPC is
 * real and meant to observe; it was just missing from the roster).
 *
 * Run AFTER canonicalizeWitnessReactions so the npcIds are already canonical. The
 * scene for a witness reaction is resolved by the choice set's explicit `sceneId`
 * or, failing that, by the beat it hangs off (`beatId` → owning scene). Mutates each
 * scene's `charactersInvolved` IN PLACE (creating it when absent), so both the
 * validation input and the assembled story see the fix. Only adds ids present in
 * `knownNpcIds` (real story NPCs) — never invents a roster entry, never removes one.
 */
export function ensureWitnessNpcsInScenes(
  sceneContents: WitnessPresenceScene[],
  choiceSets: unknown,
  knownNpcIds: Set<string>,
): { added: number } {
  const result = { added: 0 };
  if (!Array.isArray(sceneContents) || sceneContents.length === 0 || knownNpcIds.size === 0) return result;

  const sceneById = new Map<string, WitnessPresenceScene>();
  const sceneByBeatId = new Map<string, WitnessPresenceScene>();
  for (const sc of sceneContents) {
    if (!sc || typeof sc.sceneId !== 'string') continue;
    sceneById.set(sc.sceneId, sc);
    for (const b of sc.beats ?? []) {
      if (b && typeof b.id === 'string') sceneByBeatId.set(b.id, sc);
    }
  }

  const addToScene = (scene: WitnessPresenceScene | undefined, npcId: string): void => {
    if (!scene || !knownNpcIds.has(npcId)) return;
    if (!Array.isArray(scene.charactersInvolved)) scene.charactersInvolved = [];
    if (!scene.charactersInvolved.includes(npcId)) {
      scene.charactersInvolved.push(npcId);
      result.added++;
    }
  };

  // Walk the choice sets; thread the resolved scene down so nested choices inherit it.
  const visit = (node: unknown, sceneHint?: WitnessPresenceScene): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, sceneHint);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    let scene = sceneHint;
    const explicitSceneId = typeof obj.sceneId === 'string' ? obj.sceneId : undefined;
    if (explicitSceneId && sceneById.has(explicitSceneId)) scene = sceneById.get(explicitSceneId);
    const beatId = typeof obj.beatId === 'string' ? obj.beatId : undefined;
    if (!scene && beatId && sceneByBeatId.has(beatId)) scene = sceneByBeatId.get(beatId);

    const wr = obj.witnessReactions;
    if (Array.isArray(wr) && scene) {
      for (const reaction of wr) {
        const npcId = reaction && typeof reaction === 'object' ? (reaction as Record<string, unknown>).npcId : undefined;
        if (typeof npcId === 'string' && npcId) addToScene(scene, npcId);
      }
    }

    for (const key of Object.keys(obj)) {
      if (key === 'witnessReactions') continue;
      visit(obj[key], scene);
    }
  };

  visit(choiceSets, undefined);
  return result;
}
