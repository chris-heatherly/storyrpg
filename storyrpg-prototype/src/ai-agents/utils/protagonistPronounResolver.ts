/**
 * Protagonist pronoun resolver (Gen-4 W1).
 *
 * The protagonist's pronouns are CANON — authored once on the brief
 * (`brief.protagonist.pronouns`) and on the character bible. Yet the encounter
 * outcome generator drifted: Bite Me Gen-4 rendered the female protagonist
 * "Kylie" as "he/him/himself" across ~160 player-facing encounter fields while
 * the linear SceneWriter prose was correct. No validator caught it.
 *
 * This module makes the fact deterministic AFTER generation, mirroring the
 * witnessNpcResolver pattern: it walks the assembled story's reader-facing text
 * and, for sentences whose ONLY person referent is the protagonist, rewrites
 * wrong-gender pronouns to the canon set. Sentences that also name another
 * character of the wrong gender are genuinely ambiguous ("Victor looks at him")
 * — those are NOT rewritten (we never risk introducing a new error); they are
 * returned as `ambiguous` findings the caller can route to a bounded regen.
 *
 * Deterministic, no LLM. Mutates the story in place so the shipped story.json is
 * corrected. Only `he/him` and `she/her` canon are repaired; `they/them` is
 * skipped (it is never "wrong-gender" against a third-person singular).
 */

import type { Story } from '../../types';

export interface ProtagonistIdentity {
  /** Display + reference names/aliases for the protagonist (e.g. ["Kylie", "Kylie Marinescu"]). */
  names: string[];
  pronouns: string;
}

export interface ProtagonistPronounAmbiguity {
  location: string;
  sentence: string;
}

export interface ProtagonistPronounResult {
  repaired: number;
  ambiguous: ProtagonistPronounAmbiguity[];
  fieldsScanned: number;
}

// Reader-facing text fields anywhere in the story graph (incl. nested encounter
// situations). Agent-facing planning fields are deliberately excluded.
const TEXT_KEYS = new Set([
  'text', 'narrativeText', 'setupText', 'outcomeText', 'reactionText',
  'success', 'partial', 'failure',
  'lockedText', 'description', 'visualMoment', 'primaryAction',
  // G12: encounter stakes ("two suitors leaning toward him") and escalation prose
  // are reader-facing but were never scanned — the misgendered clock/stakes text
  // shipped untouched. `victory`/`defeat` are string leaves only on stakes.
  'escalationText', 'victory', 'defeat',
]);

type Gender = 'm' | 'f';

// Wrong-gender pronoun word source per target canon. Fresh RegExp objects are
// built per use to avoid shared global-regex lastIndex state.
const WRONG_SOURCE: Record<Gender, string> = {
  // target = female canon -> wrong = masculine pronouns
  f: '\\b(he|him|his|himself)\\b',
  // target = male canon -> wrong = feminine pronouns
  m: '\\b(she|her|hers|herself)\\b',
};

function mapPronoun(word: string, target: Gender): string {
  const lower = word.toLowerCase();
  const table: Record<string, string> =
    target === 'f'
      ? { he: 'she', him: 'her', his: 'her', himself: 'herself' }
      : { she: 'he', her: 'him', hers: 'his', herself: 'himself' };
  const replacement = table[lower] ?? word;
  // Preserve capitalization of the original first letter.
  return /^[A-Z]/.test(word) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a block of prose into sentences, preserving terminators. */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]*/g);
  return parts ?? [text];
}

function targetGender(pronouns: string): Gender | undefined {
  const p = pronouns.toLowerCase();
  if (p.startsWith('she')) return 'f';
  if (p.startsWith('he')) return 'm';
  return undefined; // they/them or unknown -> skip
}

/**
 * Repair wrong-gender protagonist pronouns across the story in place.
 *
 * @param story    The assembled story (mutated).
 * @param identity Canonical protagonist names + pronouns (from the brief/bible).
 * @param otherGenderNames Names of characters of the WRONG gender — their presence
 *   in a sentence makes a wrong-gender pronoun ambiguous (skip + report).
 */
export function canonicalizeProtagonistPronouns(
  story: Story,
  identity: ProtagonistIdentity,
  otherGenderNames: string[],
): ProtagonistPronounResult {
  const result: ProtagonistPronounResult = { repaired: 0, ambiguous: [], fieldsScanned: 0 };
  const target = targetGender(identity.pronouns);
  if (!target) return result;

  const names = identity.names.filter(Boolean);
  if (names.length === 0) return result;
  // Non-global (used only with .test()), so no lastIndex state to manage.
  const nameRe = new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})\\b`, 'i');
  const otherRe = otherGenderNames.length
    ? new RegExp(`\\b(?:${otherGenderNames.filter(Boolean).map(escapeRegExp).join('|')})\\b`, 'i')
    : undefined;
  const wrongTest = new RegExp(WRONG_SOURCE[target], 'i');

  const repairField = (value: string, location: string): string => {
    result.fieldsScanned += 1;
    if (!nameRe.test(value)) {
      // Choice outcome tiers are structurally authored as the result of the
      // player's action, but may also include an NPC reaction. A bare wrong-
      // gender pronoun with no second-person anchor therefore needs semantic
      // coreference rather than deterministic coercion. Surface it to the
      // PronounDisambiguator; do not guess here.
      const unanchoredChoiceOutcome = /\/outcomeTexts\/(?:success|partial|failure)$/.test(location)
        && wrongTest.test(value)
        && !/\b(?:you|your|yours|yourself)\b/i.test(value);
      if (unanchoredChoiceOutcome) {
        for (const sentence of splitSentences(value)) {
          if (wrongTest.test(sentence)) result.ambiguous.push({ location, sentence: sentence.trim() });
        }
      }
      return value;
    }
    if (!wrongTest.test(value)) return value; // no wrong-gender pronoun

    // Reflexive wrong-gender pronoun for this target (himself when canon is female).
    const reflexiveSource = target === 'f' ? '\\bhimself\\b' : '\\bherself\\b';
    // Non-reflexive wrong-gender pronouns (he/him/his when canon is female).
    const nonReflexiveSource = target === 'f' ? '\\b(he|him|his)\\b' : '\\b(she|her|hers)\\b';

    // Topic propagation (G12): "The night swallows Kylie. He orders second, …" — the
    // follow-on sentence has the wrong-gender pronoun but no name, so a per-sentence
    // name requirement skipped it. Track when the running topic is the protagonist
    // (last named person was the protagonist, no other-gender name since) and repair
    // pronoun-only follow-on sentences under that topic.
    let protagonistTopic = false;
    return splitSentences(value)
      .map((sentence) => {
        if (otherRe && otherRe.test(sentence)) protagonistTopic = false;
        else if (nameRe.test(sentence)) protagonistTopic = true;
        if (!nameRe.test(sentence)) {
          if (
            protagonistTopic &&
            wrongTest.test(sentence) &&
            !(otherRe && otherRe.test(sentence))
          ) {
            return sentence.replace(new RegExp(WRONG_SOURCE[target], 'gi'), (m) => {
              result.repaired += 1;
              return mapPronoun(m, target);
            });
          }
          return sentence;
        }
        if (!wrongTest.test(sentence)) return sentence;
        // Ambiguous when another wrong-gender character is named in the sentence
        // ("Victor looks at him" — the "him" could be Victor). We never risk
        // introducing an error, so non-reflexive pronouns are reported, not touched.
        // EXCEPTION: a reflexive pronoun (himself/herself) binds to its own clause's
        // SUBJECT, so a wrong-gender reflexive in a protagonist-named sentence is the
        // protagonist's even when an NPC is also named (an NPC of the correct gender
        // would never carry a wrong-gender reflexive). Repair reflexives; report only
        // residual non-reflexive ambiguity. This fixes the gen-5 clock-label bug
        // ("how fully Kylie allows himself … for Victor") the blanket skip missed.
        if (otherRe && otherRe.test(sentence)) {
          let out = sentence;
          if (new RegExp(reflexiveSource, 'i').test(sentence)) {
            out = out.replace(new RegExp(reflexiveSource, 'gi'), (m) => {
              result.repaired += 1;
              return mapPronoun(m, target);
            });
          }
          if (new RegExp(nonReflexiveSource, 'i').test(out)) {
            result.ambiguous.push({ location, sentence: sentence.trim() });
          }
          return out;
        }
        // Fresh global regex per sentence for the actual replace.
        return sentence.replace(new RegExp(WRONG_SOURCE[target], 'gi'), (m) => {
          result.repaired += 1;
          return mapPronoun(m, target);
        });
      })
      .join('');
  };

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string' && TEXT_KEYS.has(key)) {
        obj[key] = repairField(val, `${path}/${key}`);
      } else if (val && typeof val === 'object') {
        walk(val, `${path}/${key}`);
      }
    }
  };

  walk(story, '');
  return result;
}

/**
 * Apply LLM-produced sentence rewrites to the assembled story in place. For every
 * reader-facing text field (the same {@link TEXT_KEYS} the resolver scans, so this
 * reaches encounter outcome/reaction fields too), replace the first occurrence of any
 * `original` ambiguous sentence with its `rewritten` form. Returns the number of
 * replacements applied. Pure (mutates in place), deterministic, unit-testable — the
 * LLM call that produces `rewrites` is the caller's responsibility.
 */
export function applyPronounDisambiguations(story: Story, rewrites: Map<string, string>): number {
  if (rewrites.size === 0) return 0;
  let applied = 0;

  const repairField = (value: string): string => {
    let out = value;
    for (const [original, rewritten] of rewrites) {
      if (!original || out.indexOf(original) === -1) continue;
      out = out.replace(original, rewritten); // first occurrence only
      applied += 1;
    }
    return out;
  };

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string' && TEXT_KEYS.has(key)) {
        obj[key] = repairField(val);
      } else if (val && typeof val === 'object') {
        walk(val);
      }
    }
  };

  walk(story);
  return applied;
}

/** Derive the wrong-gender NPC names from the story roster for a given target. */
export function otherGenderNamesFromStory(story: Story, pronouns: string): string[] {
  const target = targetGender(pronouns);
  if (!target) return [];
  const wrongPrefix = target === 'f' ? 'he' : 'she'; // protagonist female -> male NPCs are the risk
  const names = new Set<string>();
  for (const npc of story.npcs || []) {
    const p = (npc.pronouns || '').toLowerCase();
    if (!p.startsWith(wrongPrefix) || !npc.name) continue;
    names.add(npc.name);
    const firstName = npc.name.trim().split(/\s+/)[0];
    if (firstName && firstName.length >= 3) names.add(firstName);
  }
  return [...names];
}
