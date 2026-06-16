/**
 * NPC pronoun-consistency detector (G10).
 *
 * Companion to {@link canonicalizeProtagonistPronouns}, which only governs the
 * PROTAGONIST (the implicit "you") and only repairs he↔she. The G10 audit surfaced a
 * different miss: an NPC with canon pronouns drifting in the played prose — Endsong ep3
 * narrated Captain Thorne (he/him) as "the shadow-wound dark at THEIR shoulder",
 * "Thorne lifts THEIR gaze" in the finale, while he was correctly "he/his" mid-episode.
 * No validator reads played prose against the NPC roster's pronouns.
 *
 * This module DETECTS (does not auto-rewrite — NPC pronoun attribution is far more
 * ambiguous than the protagonist's, so we never risk introducing an error) sentences
 * where a UNIQUELY-named gendered NPC is paired with a pronoun inconsistent with its
 * roster gender: a wrong binary pronoun (she/her for a he/him NPC, or vice versa) or a
 * singular they/them/their form. Findings are returned for the caller to surface as an
 * advisory finding and, when gated, route to a bounded regen.
 *
 * Precision guards (kept deliberately conservative so it can be promoted to blocking):
 *   - the sentence must name EXACTLY ONE person (one gendered NPC, no other roster name,
 *     no protagonist "you") — multi-person sentences are ambiguous and skipped;
 *   - they/them is only flagged when no plural-antecedent cue is present (soldiers, men,
 *     both, the others …), so legitimate group "they" is not mis-flagged.
 *
 * Deterministic, no LLM. Pure (returns findings; mutates nothing).
 */

import type { Story } from '../../types';

export interface NpcPronounFinding {
  npcId: string;
  npcName: string;
  /** The offending pronoun word(s), e.g. "their" or "she". */
  wrongPronoun: string;
  location: string;
  sentence: string;
}

export interface NpcPronounScanResult {
  findings: NpcPronounFinding[];
  fieldsScanned: number;
}

type Gender = 'm' | 'f';

// Reader-facing text fields — the same surface canonicalizeProtagonistPronouns scans,
// so this reaches encounter situation/outcome/reaction prose too. G12 added the
// encounter stakes/escalation leaves (Victor ran they/them through the whole ep2
// encounter tree, including these fields).
const TEXT_KEYS = new Set([
  'text', 'narrativeText', 'setupText', 'outcomeText', 'reactionText',
  'lockedText', 'description', 'visualMoment', 'primaryAction',
  'escalationText', 'victory', 'defeat',
]);

const SECOND_PERSON_RE = /\b(?:you|your|yours|yourself)\b/i;

// Plural-antecedent cues that make a "they/their" legitimately group-referential, so a
// singular-NPC sentence containing one of these is NOT flagged for they/them.
// Person-specific plural antecedents only — NOT bare "both"/"ranks"/"others", which
// commonly modify non-person nouns ("both hands", "the broken ranks") and would mask a
// real singular-they misgendering ("Thorne braces both hands … at their shoulder").
const PLURAL_CUE_RE =
  /\b(?:they all|them all|both of them|both men|both women|the others|soldiers?|men|women|guards?|people|crowd|group|council|raiders?|troops?|everyone|all of them|the rest of them)\b/i;

const WRONG_BINARY: Record<Gender, RegExp> = {
  // he/him NPC → feminine pronouns are wrong
  m: /\b(she|her|hers|herself)\b/i,
  // she/her NPC → masculine pronouns are wrong
  f: /\b(he|him|his|himself)\b/i,
};
const THEY_RE = /\b(they|them|their|theirs|themselves)\b/i;

// An UNNAMED third party that can be the real referent of the offending pronoun even
// though only one roster NAME is in the sentence. The canonical FP is dialogue/recall
// prose: "Say something to Mika meant for HIM to overhear" (him = the unnamed target),
// "the way HE smiled" (he = the stranger Kylie recalls). When such a noun is present we
// cannot attribute the pronoun to the named NPC, so we skip — trading recall for the
// precision a blocking-candidate gate needs.
const ALT_REFERENT_RE =
  /\b(stranger|commander|captain|figure|attacker|raider|soldier|guard|man|woman|girl|boy|person|someone|somebody|child|speaker|the other|the rest|whoever)\b/i;

// A dialogue speaker tag where the pronoun is the SPEAKER of a quote, not the named NPC
// who is merely the quote's subject/object — "'Victor something,' SHE offers", "Victor
// Vâlcescu, SHE says". The pronoun there refers to the (often unnamed) speaker.
const SPEECH_TAG_RE =
  /\b(?:she|he)\s+(?:says|said|offers|offered|asks|asked|replies|replied|whispers|whispered|adds|added|breathes|breathed|murmurs|murmured|answers|answered|continues|continued)\b/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]*/g) ?? [text];
}

function genderOf(pronouns: string | undefined): Gender | undefined {
  const p = (pronouns || '').toLowerCase();
  if (p.startsWith('she')) return 'f';
  if (p.startsWith('he')) return 'm';
  return undefined; // they/them or unknown → cannot judge
}

interface NpcEntry {
  id: string;
  name: string;
  gender: Gender;
  nameRe: RegExp;
}

/** Build matchable entries for gendered NPCs (skips they/them + unknown-pronoun NPCs). */
function buildNpcEntries(npcs: Array<{ id?: string; name?: string; pronouns?: string }>): NpcEntry[] {
  const out: NpcEntry[] = [];
  for (const npc of npcs || []) {
    const gender = genderOf(npc.pronouns);
    if (!gender || !npc.name || !npc.id) continue;
    // Match the full name OR a distinctive first/last token (≥3 chars) so "Thorne",
    // "Rorik", and "Captain Rorik Thorne" all resolve to the same entry.
    const tokens = Array.from(
      new Set([npc.name, ...npc.name.split(/\s+/).filter((t) => t.replace(/[^a-z]/gi, '').length >= 3)]),
    ).filter(Boolean);
    if (tokens.length === 0) continue;
    out.push({
      id: npc.id,
      name: npc.name,
      gender,
      nameRe: new RegExp(`\\b(?:${tokens.map(escapeRegExp).join('|')})\\b`, 'i'),
    });
  }
  return out;
}

/**
 * Scan a story's reader-facing prose for NPC pronoun inconsistencies. Returns one
 * finding per offending sentence (deduped by location+sentence).
 */
export function findNpcPronounInconsistencies(
  story: Story,
  npcRoster?: Array<{ id?: string; name?: string; pronouns?: string }>,
): NpcPronounScanResult {
  const result: NpcPronounScanResult = { findings: [], fieldsScanned: 0 };
  const roster =
    npcRoster ?? (story as { npcs?: Array<{ id?: string; name?: string; pronouns?: string }> }).npcs ?? [];
  const entries = buildNpcEntries(roster);
  if (entries.length === 0) return result;
  const seen = new Set<string>();

  const scanSentence = (sentence: string, location: string): void => {
    if (SECOND_PERSON_RE.test(sentence)) return; // protagonist present → ambiguous
    // An unnamed third party or a dialogue speaker tag means the contrary pronoun likely
    // refers to someone other than the one named NPC — skip for precision.
    if (ALT_REFERENT_RE.test(sentence)) return;
    if (SPEECH_TAG_RE.test(sentence)) return;
    // Which gendered NPCs are named here?
    const present = entries.filter((e) => e.nameRe.test(sentence));
    if (present.length !== 1) return; // zero or multiple named persons → skip
    const npc = present[0];

    let wrong: string | undefined;
    let wrongIndex = -1;
    const binaryHit = WRONG_BINARY[npc.gender].exec(sentence);
    if (binaryHit) {
      wrong = binaryHit[1];
      wrongIndex = binaryHit.index;
    } else if (THEY_RE.test(sentence) && !PLURAL_CUE_RE.test(sentence)) {
      const theyHit = THEY_RE.exec(sentence);
      if (theyHit) {
        wrong = theyHit[1];
        wrongIndex = theyHit.index;
      }
    }
    if (!wrong) return;

    // Antecedent guard (precision): the matched NPC name must appear BEFORE the offending
    // pronoun, establishing it as the referent. When the pronoun precedes any mention of
    // the name, the real subject is some earlier, un-named person (the canonical false
    // positive: an NPC's OWN bio describes them in third person while merely *mentioning*
    // another roster name — "the lodge-keeper … the night Kylie arrived … watching over her
    // … hiding his …" flagged Kylie/"his" though "his" refers to the unnamed lodge-keeper).
    const nameHit = npc.nameRe.exec(sentence);
    if (!nameHit || nameHit.index >= wrongIndex) return;

    const key = `${location}::${sentence.trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.findings.push({
      npcId: npc.id,
      npcName: npc.name,
      wrongPronoun: wrong,
      location,
      sentence: sentence.trim(),
    });
  };

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      // Skip the NPC-roster subtree: an NPC's own `description` bio narrates them in third
      // person while naming OTHER cast members, which is the dominant false-positive source
      // (it is also generator-internal, never reader-facing prose). Pronoun consistency is
      // checked against played beat/encounter prose only.
      if (key === 'npcs') continue;
      if (typeof val === 'string' && TEXT_KEYS.has(key)) {
        result.fieldsScanned += 1;
        for (const sentence of splitSentences(val)) scanSentence(sentence, `${path}/${key}`);
      } else if (val && typeof val === 'object') {
        walk(val, `${path}/${key}`);
      }
    }
  };

  walk(story, '');
  return result;
}

export interface InternalPronounConflict {
  /** The recurring name referred to with conflicting pronoun genders. */
  name: string;
  /** The genders observed for this name across the prose ('m' | 'f' | 'n' for they). */
  genders: string[];
  /** One example sentence per observed gender (for the advisory message). */
  examples: string[];
}

// Capitalized words that are NOT names (sentence-openers, pronouns, articles, etc.) so the
// internal scan does not treat them as characters.
const NAME_STOPWORDS = new Set([
  'The', 'You', 'Your', 'Yours', 'She', 'Her', 'Hers', 'His', 'Him', 'They', 'Them', 'Their',
  'And', 'But', 'For', 'Not', 'With', 'When', 'Then', 'That', 'This', 'There', 'Here', 'What',
  'How', 'Why', 'Who', 'Where', 'One', 'Two', 'Three', 'Now', 'Yes', 'Maybe', 'Across', 'Inside',
  'Outside', 'Above', 'Below', 'After', 'Before', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday', 'Sunday', 'Mr', 'Mrs', 'Ms', 'Dr',
]);

/**
 * Roster-INDEPENDENT pronoun-consistency detector. {@link findNpcPronounInconsistencies}
 * only checks names that are in the NPC roster with a known gender; an UNDECLARED character
 * (the dominant cause of drift — e.g. Bite-Me-G15's Stela, narrated as they → he → she
 * across one episode with no roster entry) is invisible to it. This scan instead infers a
 * name's gender from each clean reference and flags any recurring name observed with ≥2
 * conflicting genders. Advisory only (detection, never auto-rewrite) — the same precision
 * guards as the roster scan keep multi-person / second-person / speech-tag sentences out.
 */
export function findInternalPronounConflicts(story: Story): InternalPronounConflict[] {
  // Pass 1: collect candidate names = capitalized tokens (≥3 letters) that recur in prose.
  const nameCounts = new Map<string, number>();
  const sentences: Array<{ text: string }> = [];
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) collect(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'npcs') continue;
      if (typeof val === 'string' && TEXT_KEYS.has(key)) {
        for (const s of splitSentences(val)) {
          sentences.push({ text: s });
          for (const m of s.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
            const tok = m[1];
            if (NAME_STOPWORDS.has(tok)) continue;
            nameCounts.set(tok, (nameCounts.get(tok) ?? 0) + 1);
          }
        }
      } else if (val && typeof val === 'object') {
        collect(val);
      }
    }
  };
  collect(story);
  const candidates = new Set([...nameCounts.entries()].filter(([, c]) => c >= 2).map(([n]) => n));
  if (candidates.size === 0) return [];

  // Pass 2: per candidate name, record the gender of each clean single-referent sentence.
  const observed = new Map<string, Map<string, string>>(); // name -> gender -> example
  for (const { text: sentence } of sentences) {
    if (SECOND_PERSON_RE.test(sentence) || ALT_REFERENT_RE.test(sentence) || SPEECH_TAG_RE.test(sentence)) continue;
    const namesHere = [...candidates].filter((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`).test(sentence));
    if (namesHere.length !== 1) continue; // ambiguous referent
    const name = namesHere[0];
    const nameIdx = sentence.search(new RegExp(`\\b${escapeRegExp(name)}\\b`));

    let gender: string | undefined;
    let pronounIdx = -1;
    const fHit = WRONG_BINARY.m.exec(sentence); // she/her family
    const mHit = WRONG_BINARY.f.exec(sentence); // he/him family
    if (fHit && (!mHit || fHit.index < mHit.index)) { gender = 'f'; pronounIdx = fHit.index; }
    else if (mHit) { gender = 'm'; pronounIdx = mHit.index; }
    else if (THEY_RE.test(sentence) && !PLURAL_CUE_RE.test(sentence)) {
      const tHit = THEY_RE.exec(sentence);
      if (tHit) { gender = 'n'; pronounIdx = tHit.index; }
    }
    if (!gender || nameIdx < 0 || nameIdx >= pronounIdx) continue; // name must precede pronoun

    if (!observed.has(name)) observed.set(name, new Map());
    const byGender = observed.get(name)!;
    if (!byGender.has(gender)) byGender.set(gender, sentence.trim());
  }

  const conflicts: InternalPronounConflict[] = [];
  for (const [name, byGender] of observed) {
    if (byGender.size >= 2) {
      conflicts.push({ name, genders: [...byGender.keys()], examples: [...byGender.values()] });
    }
  }
  return conflicts;
}
