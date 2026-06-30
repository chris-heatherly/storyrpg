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
 * The set of NPC ids the reader has met (on-page) before the scene about to be
 * written. See module doc for the derivation rules.
 */
export function introducedNpcIds(input: IntroducedNpcsInput): Set<string> {
  const introduced = new Set<string>();
  const plan = input.characterIntroductions ?? [];

  if (plan.length > 0) {
    for (const entry of plan) {
      if (entry.introducedInEpisode < input.episodeNumber) introduced.add(entry.characterId);
    }
    // Roster NPCs the plan never schedules: treat as introduced for episodes
    // past the first (legacy cast carried in from prior seasons/episodes).
    if (input.episodeNumber > 1) {
      const scheduled = new Set(plan.map((e) => e.characterId));
      for (const id of input.rosterNpcIds) {
        if (!scheduled.has(id)) introduced.add(id);
      }
    }
  } else if (input.episodeNumber > 1) {
    // No plan data at all: prior episodes are invisible here, so assume their
    // cast is known rather than spamming re-introduction directives.
    for (const id of input.rosterNpcIds) introduced.add(id);
  }

  for (const id of input.alreadyStagedNpcIds) introduced.add(id);
  return introduced;
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
  introducesCharacters?: string[];
  characterIntroductions?: Array<{ characterId: string; characterName?: string; introducedInEpisode: number }>;
}): Array<{ id: string; name: string }> {
  const norm = (s: string): string => s.toLowerCase().trim();
  const resolve = (idOrName: string): { id: string; name: string } => {
    const match = opts.roster.find((c) => norm(c.id) === norm(idOrName) || norm(c.name) === norm(idOrName));
    return match ?? { id: idOrName, name: idOrName };
  };
  const out = new Map<string, { id: string; name: string }>();
  for (const ref of opts.introducesCharacters ?? []) {
    if (!String(ref || '').trim()) continue;
    const c = resolve(ref);
    out.set(c.id, c);
  }
  for (const entry of opts.characterIntroductions ?? []) {
    if (entry.introducedInEpisode !== opts.episodeNumber) continue;
    const c = resolve(entry.characterId || entry.characterName || '');
    if (c.id.trim()) out.set(c.id, c);
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
  const cast = new Set(opts.sceneCastIds);
  return opts.roster
    .filter((npc) => !opts.introduced.has(npc.id) && !cast.has(npc.id))
    .map((npc) => npc.name)
    .filter((name) => name.trim().length > 0);
}
