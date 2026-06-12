/**
 * Tint-flag vocabulary normalization (G12 fix).
 *
 * The identity engine only reacts to the 28 canonical `tint:*` keys in
 * `TINT_TO_IDENTITY` (exact string match). G12 shipped 28 distinct authored tint
 * flags — `tint:bold`, `tint:pragmatic`, `tint:honest`, … — and not one matched,
 * so ~24% of the consequence budget (the whole tint tier) had zero player-visible
 * or mechanical effect. The author prompt itself suggested non-canonical examples
 * ("tint:reckless", "tint:cunning"), so this is normalized at the assembly seam
 * AND constrained at the prompt.
 *
 * Unrecognized tints are mapped via the alias table below when a clear semantic
 * neighbor exists; otherwise they pass through unchanged (they remain harmless
 * cosmetic flags) and `isKnownTint` reports false so a validator can warn.
 */

import { KNOWN_TINT_FLAGS } from '../../engine/identityEngine';

const KNOWN = new Set<string>(KNOWN_TINT_FLAGS);

/** Adjective/synonym → canonical noun-form tint (without the `tint:` prefix). */
const TINT_ALIASES: Record<string, string> = {
  // adjective forms of canonical keys
  merciful: 'mercy',
  just: 'justice',
  forgiving: 'forgiveness',
  punishing: 'punishment',
  compassionate: 'compassion',
  vengeful: 'vengeance',
  idealistic: 'idealism',
  pragmatic: 'pragmatism',
  sacrificial: 'sacrifice',
  surviving: 'survival',
  honorable: 'honor',
  expedient: 'expedience',
  cautious: 'caution',
  bold: 'boldness',
  patient: 'patience',
  aggressive: 'aggression',
  diplomatic: 'diplomacy',
  forceful: 'force',
  independent: 'independence',
  leading: 'leadership',
  cooperative: 'teamwork',
  solitary: 'solitude',
  emotional: 'emotion',
  logical: 'logic',
  intuitive: 'intuition',
  calculating: 'calculation',
  honest: 'honesty',
  deceptive: 'deception',
  truthful: 'truth',
  manipulative: 'manipulation',
  // common near-synonyms the author reaches for
  reckless: 'boldness',
  brave: 'boldness',
  courage: 'boldness',
  daring: 'boldness',
  defiant: 'boldness',
  decisive: 'boldness',
  fearful: 'caution',
  wary: 'caution',
  careful: 'caution',
  guarded: 'caution',
  kind: 'compassion',
  kindness: 'compassion',
  empathy: 'compassion',
  warm: 'compassion',
  cruel: 'punishment',
  ruthless: 'expedience',
  cunning: 'calculation',
  clever: 'calculation',
  curious: 'intuition',
  loyal: 'teamwork',
  connected: 'teamwork',
  protective: 'teamwork',
  trusting: 'teamwork',
  distant: 'solitude',
  personal: 'emotion',
  vulnerable: 'emotion',
  open: 'honesty',
  candid: 'honesty',
  direct: 'honesty',
  evasive: 'deception',
  secretive: 'deception',
  conflicted: 'sacrifice',
  principled: 'honor',
  dutiful: 'honor',
};

/** Normalize an authored tint flag to the canonical engine vocabulary when possible. */
export function normalizeTintFlag(flag: string): string {
  if (!flag.startsWith('tint:')) return flag;
  if (KNOWN.has(flag)) return flag;
  const bare = flag.slice('tint:'.length).toLowerCase();
  const aliased = TINT_ALIASES[bare];
  if (aliased) return `tint:${aliased}`;
  // case-only mismatch with a canonical key
  const lower = `tint:${bare}`;
  if (KNOWN.has(lower)) return lower;
  return flag;
}

/** True when the flag (post-normalization) is a tint the identity engine recognizes. */
export function isKnownTint(flag: string): boolean {
  return KNOWN.has(normalizeTintFlag(flag));
}

/** Canonical vocabulary, for prompt construction. */
export function canonicalTintVocabulary(): readonly string[] {
  return KNOWN_TINT_FLAGS;
}
