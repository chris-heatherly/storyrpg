/**
 * Character capability facts (Season Canon, Phase B).
 *
 * The recurring "character does something they can't" bug (e.g. a scholar NPC
 * suddenly delivering combat "blade-work") happens because no downstream prompt is
 * grounded in what a character CAN do. This derives a deterministic capability
 * constraint from the CharacterProfile and serves it three ways:
 *   - into SceneWriter's NPC descriptions, so it never authors the contradiction
 *     (prevention — "the canon disposes, served read-only to downstream prompts");
 *   - into ContinuityChecker's establishedFacts, so it reliably FLAGS one if it
 *     slips through;
 *   - sealed into the SeasonCanon as world-facts, so later episodes inherit it.
 *
 * Conservative: a "no combat training" constraint is emitted ONLY when nothing in
 * the profile (skills, traits, or role) signals combat capability — so a warrior
 * character is never wrongly constrained.
 *
 * Pure + unit-testable.
 */

import type { CharacterProfile } from '../agents/CharacterDesigner';

const COMBAT_SIGNAL =
  /\b(combat|blade|sword|fight(?:er|ing)?|martial|melee|brawl|weapon|warrior|soldier|knight|guard(?:sman)?|mercenary|assassin|duel|archer|archery|marksman|gun|spear|axe)\b/i;

/** Whether anything in the profile signals the character can physically fight. */
export function isCombatCapable(profile: CharacterProfile): boolean {
  if ((profile.skills ?? []).some((s) => COMBAT_SIGNAL.test(s?.name ?? '') && (s?.level ?? 0) > 0)) return true;
  if ((profile.traits ?? []).some((t) => COMBAT_SIGNAL.test(t ?? ''))) return true;
  if (COMBAT_SIGNAL.test(profile.role ?? '')) return true;
  return false;
}

/** A one-line capability constraint for a profile, or '' when combat-capable. */
export function capabilityNoteForProfile(profile: CharacterProfile): string {
  if (isCombatCapable(profile)) return '';
  return `${profile.name} has no established combat training — do not depict ${profile.name} fighting, wielding weapons, or performing physical-combat feats.`;
}

export interface CapabilityWorldFact {
  id: string;
  statement: string;
}

/** Canon world-facts for the season's non-combatant characters (sealed once). */
export function characterCapabilityWorldFacts(profiles: CharacterProfile[] | undefined): CapabilityWorldFact[] {
  const facts: CapabilityWorldFact[] = [];
  for (const p of profiles ?? []) {
    const note = capabilityNoteForProfile(p);
    if (note) facts.push({ id: `cap:${p.id}:no-combat`, statement: note });
  }
  return facts;
}

/** Flat capability strings for ContinuityChecker `establishedFacts`. */
export function capabilityFactStrings(profiles: CharacterProfile[] | undefined): string[] {
  return characterCapabilityWorldFacts(profiles).map((f) => f.statement);
}
