/**
 * NPC on-page introduction tracking — "has the reader actually met this
 * character yet?"
 *
 * The 2026-06-09 audit found character introductions exist ONLY at the planning
 * layer (`SourceMaterialAnalysis.majorCharacters[].firstAppearance` →
 * `SeasonEpisode.introducesCharacters` / `SeasonPlan.characterIntroductions`)
 * and are never consulted during generation: SceneWriter received NPC context
 * with no notion of whether the reader had met them, so bite-me-g10 named
 * Victor Vâlcescu cold in s2-4 ("You open Victor's first. Of course you do.")
 * and endsong-g10 shipped Sylvanor Dawnheart as encounter metadata with no
 * on-page introduction at all.
 *
 * This module derives, deterministically, which NPCs count as INTRODUCED at
 * the moment a given scene is about to be written:
 *
 *  - NPCs whose planned introduction episode (from the season plan's
 *    `characterIntroductions`) is EARLIER than the episode being generated —
 *    prior episodes are trusted to have introduced their own cast;
 *  - NPCs already staged in this episode (present in the cast of an
 *    already-generated scene's content or an earlier blueprint scene in
 *    reading order).
 *
 * Fallback: when the plan carries no introduction data (from-scratch runs),
 * every roster NPC is treated as introduced for episodes > 1 (we cannot see
 * prior episodes' prose, and a false "first appearance" directive would make
 * the writer re-introduce a known character — worse than missing one), while
 * episode 1 trusts only what this episode has staged so far.
 *
 * Consumed by FullStoryPipeline when building SceneWriter input: NPCs in the
 * scene cast that are NOT yet introduced get a first-appearance directive
 * (introduce them on-page), and roster characters that are neither introduced
 * nor in the cast are listed as forbidden names for this scene.
 *
 * Pure and deterministic — no LLM, no wall-clock, no randomness.
 */

export interface PlannedCharacterIntroduction {
  characterId: string;
  introducedInEpisode: number;
}

export interface IntroducedNpcsInput {
  /** Episode currently being generated. */
  episodeNumber: number;
  /** Full NPC roster ids (protagonist excluded). */
  rosterNpcIds: string[];
  /** Season plan introduction order, when the run has one. */
  characterIntroductions?: PlannedCharacterIntroduction[];
  /**
   * Cast already staged in this episode before the scene being written:
   * the union of `charactersInvolved` from generated scene contents and
   * `npcsPresent` from earlier blueprint scenes in reading order.
   */
  alreadyStagedNpcIds: string[];
}

/**
 * The set of NPC id SLUGS the reader has met (on-page) before the scene about
 * to be written. See module doc for the derivation rules.
 *
 * Membership is slug-normalized because the layers speak three id vocabularies
 * for one character ('Stela Pavel' in planned casts, 'char-stela-pavel' in the
 * roster, 'stela-pavel' in season-plan characterIntroductions) — raw string
 * compares silently split them (storyrpg-lite 2026-07-04 s1-2 contradiction).
 * Query with {@link isIntroducedNpc}, never with raw `.has(id)`.
 */
export function introducedNpcIds(input: IntroducedNpcsInput): Set<string> {
  const introduced = new Set<string>();
  const add = (idOrName: string) => {
    const slug = normalizeCharacterSlug(idOrName);
    if (slug) introduced.add(slug);
  };
  const plan = input.characterIntroductions ?? [];

  if (plan.length > 0) {
    for (const entry of plan) {
      if (entry.introducedInEpisode < input.episodeNumber) add(entry.characterId);
    }
    // Roster NPCs the plan never schedules: treat as introduced for episodes
    // past the first (legacy cast carried in from prior seasons/episodes).
    if (input.episodeNumber > 1) {
      const scheduled = new Set(plan.map((e) => normalizeCharacterSlug(e.characterId)));
      for (const id of input.rosterNpcIds) {
        if (!scheduled.has(normalizeCharacterSlug(id))) add(id);
      }
    }
  } else if (input.episodeNumber > 1) {
    // No plan data at all: prior episodes are invisible here, so assume their
    // cast is known rather than spamming re-introduction directives.
    for (const id of input.rosterNpcIds) add(id);
  }

  for (const id of input.alreadyStagedNpcIds) add(id);
  return introduced;
}

/**
 * Roster NPC ids actually NAMED in generated scene prose. The writer's
 * `charactersInvolved` metadata is LLM-authored and can omit a character the
 * prose plainly stages (storyrpg-lite 2026-07-04T23-09-35: s1-2's prose said
 * "'Bun venit, I'm Stela'" while its cast metadata listed only the
 * protagonist) — for introduction tracking, the prose is ground truth.
 * Matches the full name or a distinctive (>=3 char) first name on word
 * boundaries, accent-insensitive. Pure and deterministic.
 */
export function npcIdsNamedInProse(
  prose: string,
  roster: Array<{ id: string; name: string }>,
): string[] {
  const normalized = ` ${prose
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
  const out: string[] = [];
  for (const npc of roster) {
    const fullName = npc.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!fullName) continue;
    const first = fullName.split(' ')[0];
    if (
      normalized.includes(` ${fullName} `)
      || (first.length >= 3 && normalized.includes(` ${first} `))
    ) {
      out.push(npc.id);
    }
  }
  return out;
}

/** Slug-normalized membership query — tolerant of raw-id sets from older callers. */
export function isIntroducedNpc(introduced: Set<string>, idOrName: string): boolean {
  const slug = normalizeCharacterSlug(idOrName);
  if (introduced.has(slug)) return true;
  for (const entry of introduced) {
    if (normalizeCharacterSlug(entry) === slug) return true;
  }
  return false;
}

/** Normalize plan/roster ids and aliases to a comparable slug. */
export function normalizeCharacterSlug(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^char-/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function rosterSlugTokens(value: string): string[] {
  return normalizeCharacterSlug(value)
    .split('-')
    .filter((token) => token.length > 1 && !['the', 'mr', 'ms', 'dr'].includes(token));
}

/**
 * Resolve a season-plan character reference (id slug or display name) to the
 * canonical roster entry. Plan layers often emit duplicate aliases such as
 * `char-victor-valcescu-mr-midnight` and `victor-valcescu` for one NPC.
 */
export function resolveRosterCharacter(
  idOrName: string,
  roster: Array<{ id: string; name: string }>,
): { id: string; name: string } | undefined {
  const refSlug = normalizeCharacterSlug(idOrName);
  if (!refSlug) return undefined;
  const refTokens = rosterSlugTokens(idOrName);

  let best: { id: string; name: string; score: number } | undefined;
  for (const character of roster) {
    const idSlug = normalizeCharacterSlug(character.id);
    const nameSlug = normalizeCharacterSlug(character.name.replace(/\s+/g, '-'));
    if (refSlug === idSlug || refSlug === nameSlug) {
      return character;
    }
    if (idSlug && (refSlug.includes(idSlug) || idSlug.includes(refSlug))) {
      const score = idSlug.length;
      if (!best || score > best.score) best = { ...character, score };
      continue;
    }
    const characterTokens = [...new Set([
      ...rosterSlugTokens(character.id),
      ...rosterSlugTokens(character.name),
    ])];
    const overlap = refTokens.filter((token) => characterTokens.includes(token)).length;
    if (
      overlap >= 2
      || (overlap === 1 && refTokens.length === 1 && characterTokens.length === 1)
    ) {
      const score = overlap * 10 + characterTokens.length;
      if (!best || score > best.score) best = { ...character, score };
    }
  }
  return best ? { id: best.id, name: best.name } : undefined;
}

/**
 * The characters the season plan schedules a given episode to introduce,
 * resolved against the roster (plan entries may carry ids OR display names).
 * Union of `SeasonEpisode.introducesCharacters` and the
 * `SeasonPlan.characterIntroductions` entries for that episode, deduped.
 * Feeds `StoryArchitectInput.introducesCharacters` so the blueprint can
 * guarantee each one an on-page introduction beat.
 */
export function plannedIntroductionsForEpisode(opts: {
  episodeNumber: number;
  roster: Array<{ id: string; name: string }>;
  protagonistId?: string;
  introducesCharacters?: string[];
  characterIntroductions?: Array<{
    characterId: string;
    characterName?: string;
    introducedInEpisode: number;
    role?: string;
  }>;
}): Array<{ id: string; name: string }> {
  const protagonistSlug = opts.protagonistId ? normalizeCharacterSlug(opts.protagonistId) : '';
  const resolve = (idOrName: string): { id: string; name: string } => {
    const match = resolveRosterCharacter(idOrName, opts.roster);
    return match ?? { id: idOrName, name: idOrName };
  };
  const out = new Map<string, { id: string; name: string }>();
  const add = (idOrName: string) => {
    if (!String(idOrName || '').trim()) return;
    const character = resolve(idOrName);
    if (protagonistSlug && normalizeCharacterSlug(character.id) === protagonistSlug) return;
    out.set(character.id, character);
  };
  for (const ref of opts.introducesCharacters ?? []) add(ref);
  for (const entry of opts.characterIntroductions ?? []) {
    if (entry.introducedInEpisode !== opts.episodeNumber) continue;
    if (entry.role === 'protagonist') continue;
    add(entry.characterId || entry.characterName || '');
  }
  return Array.from(out.values());
}

/**
 * Roster NPC names the writer must NOT name in this scene: characters the
 * reader has not met AND who are not in this scene's cast (so the scene is not
 * the one introducing them). Mentioning them would be exactly the "who is
 * this?" name-drop defect.
 */
export function forbiddenNpcNames(opts: {
  roster: Array<{ id: string; name: string }>;
  introduced: Set<string>;
  sceneCastIds: string[];
}): string[] {
  const cast = new Set(opts.sceneCastIds.map((id) => normalizeCharacterSlug(id)));
  return opts.roster
    .filter((npc) => !isIntroducedNpc(opts.introduced, npc.id)
      && !cast.has(normalizeCharacterSlug(npc.id))
      && !cast.has(normalizeCharacterSlug(npc.name)))
    .map((npc) => npc.name)
    .filter((name) => name.trim().length > 0);
}
