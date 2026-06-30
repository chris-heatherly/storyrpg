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
  /\b(combat|blade(?:master)?|sword|swordsm[ae]n|swordmaster|fight(?:er|ing)?|martial|melee|brawl|weapon|warrior|soldier|knight|guard(?:sman)?|mercenary|assassin|duel|archer|archery|marksman|gun|spear|axe|paladin|warlord|hunter|huntress|ranger|gladiator|captain|champion|slayer|reaver|berserker|battle|war-?forged|sentinel|templar|vanguard|sworn|legionn?aire|sellsword|bladesinger)\b/i;

/** Antagonist-ish roles default to combat-capable: a threat character can fight. */
const ANTAGONIST_ROLE = /\b(antagonist|villain|enemy|warlord|tyrant|overlord|nemesis)\b/i;

/** Protagonists/leads act physically — never assume the player character can't fight. */
const PROTAGONIST_ROLE = /\b(protagonist|hero(?:ine)?|player|lead|player-?character)\b/i;

/**
 * Whether anything in the profile signals the character can physically fight.
 * In practice `skills`/`traits` are often empty, so the discriminating signal
 * lives in the prose (`overview`/`fullBackground`/`typicalAttire`/
 * `distinctiveFeatures` — the last two name weapons like "the Sunblade"); we scan
 * all of those. Protagonists and antagonists are assumed combat-capable so the
 * constraint only lands on clearly non-combatant supporting cast.
 */
export function isCombatCapable(profile: CharacterProfile): boolean {
  if (PROTAGONIST_ROLE.test(profile.role ?? '')) return true;
  if (ANTAGONIST_ROLE.test(profile.role ?? '')) return true;
  if (COMBAT_SIGNAL.test(profile.role ?? '')) return true;
  if ((profile.skills ?? []).some((s) => COMBAT_SIGNAL.test(s?.name ?? '') && (s?.level ?? 0) > 0)) return true;
  if ((profile.traits ?? []).some((t) => COMBAT_SIGNAL.test(t ?? ''))) return true;
  // The archetype + weapon mentions usually live in the prose/appearance fields.
  const p = profile as {
    overview?: string; fullBackground?: string; physicalDescription?: string;
    typicalAttire?: string; distinctiveFeatures?: string[] | string;
  };
  const prose = [
    p.overview, p.fullBackground, p.physicalDescription, p.typicalAttire,
    ...(Array.isArray(p.distinctiveFeatures) ? p.distinctiveFeatures : [p.distinctiveFeatures]),
  ]
    .filter((s): s is string => typeof s === 'string')
    .join(' ');
  if (COMBAT_SIGNAL.test(prose)) return true;
  return false;
}

/**
 * A one-line capability constraint for a profile, or '' when combat-capable. The
 * constraint targets SKILLED/trained combat (martial prowess, expert weapon use,
 * winning fights) — not any physical act — so a desperate or clumsy move under
 * duress (shoving, interposing, a panicked grab) stays in-bounds. This keeps the
 * real bug (a scholar competently delivering "blade-work") flagged without
 * false-flagging ordinary heroics.
 */
export function capabilityNoteForProfile(profile: CharacterProfile): string {
  if (isCombatCapable(profile)) return '';
  return `${profile.name} has no formal combat training — do not depict ${profile.name} as a skilled fighter, winning fights through martial prowess, or wielding weapons with expertise. A desperate, clumsy, or instinctive physical act under duress is acceptable.`;
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
