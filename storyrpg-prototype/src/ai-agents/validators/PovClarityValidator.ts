import type { SceneContent } from '../agents/SceneWriter';

export interface PovClarityIssue {
  beatId: string;
  issue: string;
  severity: 'error' | 'warning';
  suggestion: string;
}

export interface PovClarityResult {
  passed: boolean;
  score: number;
  issues: PovClarityIssue[];
  shouldRegenerate: boolean;
  checkedBeatId?: string;
}

export interface PovClarityContext {
  protagonistName?: string;
  characterNames?: string[];
}

const PLAYER_TEMPLATE_RE = /\{\{\s*player\.(?:name|they|them|their|theirs|themselves|are|were|have)\s*\}\}/i;
const SECOND_PERSON_RE = /\b(?:you|your|yours|yourself)\b/i;

export function hasPlayerReference(text: string | undefined | null): boolean {
  if (!text) return false;
  return PLAYER_TEMPLATE_RE.test(text) || SECOND_PERSON_RE.test(text);
}

/**
 * Classify each character as inside/outside a DIALOGUE span. Characters legitimately
 * speak in first person ('I'd like that,' Victor says); only unquoted narration using
 * "I/my" is a POV break. Handles BOTH double quotes (simple toggle — sentence-splitting
 * may sever the closing mark, so an unclosed opening still counts to end) and single
 * quotes (boundary-aware so apostrophes in contractions/possessives — I'd, Kylie's — are
 * NOT treated as delimiters: a `'` opens only when not preceded by a letter and closes
 * only when not followed by a letter).
 */
function dialogueMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  let inDouble = false;
  let inSingle = false;
  let inStar = false; // markdown-italic spans: quoted messages/DMs (Victor's *…* texts) + emphasis
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (c === '“' || c === '”' || c === '"') {
      if (!inDouble && looksLikeOrphanClosingDoubleQuote(text, i)) {
        mask[i] = true;
        continue;
      }
      inDouble = !inDouble;
      mask[i] = true;
      continue;
    }
    if (c === '*' && !inDouble && !inSingle) {
      inStar = !inStar;
      mask[i] = true;
      continue;
    }
    if ((c === "'" || c === '’') && !inDouble && !inStar) {
      if (!inSingle && !/[A-Za-z]/.test(prev)) { inSingle = true; mask[i] = true; continue; }
      if (inSingle && !/[A-Za-z]/.test(next)) { inSingle = false; mask[i] = true; continue; }
    }
    mask[i] = inDouble || inSingle || inStar;
  }
  return mask;
}

function looksLikeOrphanClosingDoubleQuote(text: string, index: number): boolean {
  const c = text[index];
  if (c === '“') return false;
  if (c === '”') return true;
  const prev = index > 0 ? text[index - 1] : '';
  const next = index + 1 < text.length ? text[index + 1] : '';
  return /[.!?]/.test(prev) && (next === '' || /\s/.test(next));
}

/** Return only the NARRATION (text outside dialogue spans). */
function stripDoubleQuotedSpans(text: string): string {
  const mask = dialogueMask(text);
  let out = '';
  for (let i = 0; i < text.length; i++) if (!mask[i]) out += text[i];
  return out;
}

/** Apply `fn` to maximal runs of NARRATION (outside dialogue); dialogue is preserved verbatim. */
function transformOutsideQuotes(text: string, fn: (segment: string) => string): string {
  const mask = dialogueMask(text);
  let out = '';
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    if (mask[i]) {
      if (buf) { out += fn(buf); buf = ''; }
      out += text[i];
    } else {
      buf += text[i];
    }
  }
  if (buf) out += fn(buf);
  return out;
}

function capitalizeSentenceStarts(text: string): string {
  return text
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

/**
 * Deterministically coerce first-person protagonist NARRATION to second person, leaving
 * quoted dialogue untouched. Safety net for the bite-me-g16 ep2 coda ("my laptop… I have
 * to choose") so a first-person POV break never ships even when the authoring LLM produced
 * one. Returns the coerced text and whether anything changed. Conservative: only the
 * first-person singular forms are mapped; "we/our/us" is left alone.
 */
export function coerceFirstPersonNarrationToSecond(text: string): { text: string; changed: boolean } {
  if (!text) return { text, changed: false };
  let changed = false;
  const transformed = transformOutsideQuotes(text, (seg) => {
    if (!seg) return seg;
    const before = seg;
    let s = seg;
    // Contractions first (longest match wins), then bare I, then object/possessive forms.
    s = s.replace(/\bI[’']m\b/g, "you're");
    s = s.replace(/\bI[’']ve\b/g, "you've");
    s = s.replace(/\bI[’']ll\b/g, "you'll");
    s = s.replace(/\bI[’']d\b/g, "you'd");
    s = s.replace(/\bI\b/g, 'you');
    s = s.replace(/\bmy\b/gi, 'your');
    s = s.replace(/\bmine\b/gi, 'yours');
    s = s.replace(/\bmyself\b/gi, 'yourself');
    s = s.replace(/\bme\b/gi, 'you');
    if (s !== before) { changed = true; s = capitalizeSentenceStarts(s); }
    return s;
  });
  return { text: transformed, changed };
}

function matchCase(original: string, replacement: string): string {
  if (/^[A-Z][a-z]/.test(original) || /^[A-Z]$/.test(original)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  if (original === original.toUpperCase() && /[A-Z]/.test(original)) return replacement.toUpperCase();
  return replacement;
}

/** Irregular present-tense 3rd-singular verbs → base form after a "you" subject. */
const IRREGULAR_DEINFLECT: Record<string, string> = {
  is: 'are', "isn't": "aren't", "isn’t": "aren’t",
  was: 'were', "wasn't": "weren't", "wasn’t": "weren’t",
  has: 'have', "hasn't": "haven't", "hasn’t": "haven’t",
  does: 'do', "doesn't": "don't", "doesn’t": "don’t",
  goes: 'go',
};

const PROTAGONIST_NAME_MODIFIER_FOLLOWERS = new Set([
  'rooftop', 'bar', 'stair', 'same', 'charcoal', 'flannel', 'hedge', 'music',
  'dark', 'threshold', 'room', 'club', 'glass', 'curtain', 'willow', 'attacker',
  'boulevard', 'first', 'velvet', 'key', 'back', 'door', 'choice', 'candle',
  'maze', 'lantern', 'inch', 'noticer', 'woman', 'night', 'pulse',
  'watchfulness', 'grin', 'thing', 'catalogue',
]);
const MALFORMED_OBJECT_POSSESSIVE_FOLLOWERS = new Set([
  'eyes', 'eye', 'forehead', 'laptop', 'face', 'mouth', 'hand', 'hands',
  'shoulder', 'shoulders', 'arm', 'arms', 'pulse', 'breath', 'voice',
]);
const POSSESSIVE_PRONOUN_HEAD_NOUNS = new Set([
  ...MALFORMED_OBJECT_POSSESSIVE_FOLLOWERS,
  'ankle', 'ankles', 'back', 'body', 'cheek', 'cheeks', 'chest', 'coat',
  'collar', 'cuffs', 'door', 'dress', 'elbow', 'fingers', 'floor', 'hair',
  'home', 'instinct', 'instincts', 'jaw', 'knuckles', 'lips', 'neck', 'pocket', 'skin', 'sleeve',
  'spine', 'throat', 'thumb', 'wrist', 'wrists', 'lungs', 'sense',
]);
const SELF_BODY_POSSESSIVE_HEAD_NOUNS = new Set([
  'ankle', 'ankles', 'arm', 'arms', 'back', 'body', 'breath', 'cheek', 'cheeks',
  'chest', 'elbow', 'eyes', 'face', 'fingers', 'hair', 'hand', 'hands', 'heart',
  'jaw', 'knee', 'knees', 'knuckles', 'lips', 'lungs', 'mouth', 'neck', 'pulse',
  'ribs', 'shoulder', 'shoulders', 'skin', 'spine', 'throat', 'thumb', 'voice',
  'wrist', 'wrists',
]);
const SELF_BODY_ACTION_VERBS = [
  'check', 'checks', 'checked',
  'clutch', 'clutches', 'clutched',
  'cover', 'covers', 'covered',
  'feel', 'feels', 'felt',
  'find', 'finds', 'found',
  'guard', 'guards', 'guarded',
  'hold', 'holds', 'held',
  'lift', 'lifts', 'lifted',
  'pat', 'pats', 'patted',
  'press', 'presses', 'pressed',
  'protect', 'protects', 'protected',
  'reach for', 'reaches for', 'reached for',
  'rub', 'rubs', 'rubbed',
  'test', 'tests', 'tested',
  'touch', 'touches', 'touched',
  'wipe', 'wipes', 'wiped',
];
const OBJECT_HOME_VERBS = [
  'bring', 'brings', 'brought',
  'escort', 'escorts', 'escorted',
  'lead', 'leads', 'led',
  'take', 'takes', 'took',
  'walk', 'walks', 'walked', 'walking',
];

function nextWordAfter(text: string, offset: number, word: string): string | undefined {
  const rest = text.slice(offset + word.length);
  const match = rest.match(/^\s+([A-Za-z]+)/);
  return match?.[1]?.toLowerCase();
}

function followingWords(text: string, offset: number, word: string, maxWords: number): string[] {
  const rest = text.slice(offset + word.length);
  const out: string[] = [];
  const re = /\s+([A-Za-z][A-Za-z'’-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest)) && out.length < maxWords) {
    out.push(match[1].toLowerCase().replace(/[’']/g, ''));
  }
  return out;
}

function looksLikePossessiveHer(text: string, offset: number): boolean {
  const words = followingWords(text, offset, 'her', 4);
  return words.some((word) => POSSESSIVE_PRONOUN_HEAD_NOUNS.has(word));
}

function scopedPronounStart(text: string, nameRe: RegExp): number {
  const match = nameRe.exec(text);
  return match?.index ?? 0;
}

function replaceAfterOffset(text: string, offset: number, fn: (segment: string) => string): string {
  return text.slice(0, offset) + fn(text.slice(offset));
}

function repairSecondPersonResidueInSegment(seg: string): { text: string; changed: boolean } {
  if (!/\b(?:you|your)\b/i.test(seg)) return { text: seg, changed: false };
  let changed = false;
  let s = seg;
  const possessive = '(?:her|his|their)';
  const bodyParts = [...SELF_BODY_POSSESSIVE_HEAD_NOUNS].join('|');
  const actionVerbs = SELF_BODY_ACTION_VERBS
    .map((verb) => verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const directSelfBodyRe = new RegExp(
    `\\b(you\\s+(?:${actionVerbs})\\s+)${possessive}\\s+(${bodyParts})\\b`,
    'gi',
  );
  s = s.replace(directSelfBodyRe, (_m, prefix: string, noun: string) => {
    changed = true;
    return `${prefix}your ${noun}`;
  });

  const lingeringSelfBodyRe = new RegExp(
    `(\\byou\\s+(?:${actionVerbs})\\s+your\\s+(?:${bodyParts})\\b[^.!?]{0,180}?)\\b${possessive}\\s+(${bodyParts})\\b`,
    'gi',
  );
  s = s.replace(lingeringSelfBodyRe, (_m, prefix: string, noun: string) => {
    changed = true;
    return `${prefix}your ${noun}`;
  });

  const homeResidueRe = new RegExp(
    `\\b(${OBJECT_HOME_VERBS.join('|')})\\s+her\\s+home\\b`,
    'gi',
  );
  s = s.replace(homeResidueRe, (_m, verb: string) => {
    changed = true;
    return `${verb} you home`;
  });

  s = s.replace(/\bkisses\s+her\s+hand\b/gi, (m) => {
    changed = true;
    return matchCase(m, 'kisses your hand');
  });

  return { text: s, changed };
}

export function repairSecondPersonProtagonistResidue(text: string): { text: string; changed: boolean } {
  if (!text) return { text, changed: false };
  let changed = false;
  const transformed = transformOutsideQuotes(text, (seg) => {
    const repaired = repairSecondPersonResidueInSegment(seg);
    if (repaired.changed) changed = true;
    return repaired.text;
  });
  return { text: transformed, changed };
}

/** De-inflect a present 3rd-singular verb ("straightens"→"straighten") for a "you" subject. */
function deinflectPresentVerb(word: string): string {
  const lower = word.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(IRREGULAR_DEINFLECT, lower)) {
    return matchCase(word, IRREGULAR_DEINFLECT[lower]);
  }
  if (/(?:ches|shes|sses|xes|zes)$/.test(lower)) return word.slice(0, -2); // touches→touch
  if (/[^aeiou]ies$/.test(lower)) return `${word.slice(0, -3)}y`;          // carries→carry
  if (/[^s]s$/.test(lower) && !/(?:us|ss|is)$/.test(lower)) return word.slice(0, -1); // runs→run
  return word; // past tense / not a 3rd-sing present verb → unchanged
}

/**
 * Deterministically coerce THIRD-person protagonist NARRATION to second person, leaving
 * quoted dialogue untouched. Backstop for the recurring encounter-outcome POV break
 * ("Kylie straightens her collar… she has become it") so a third-person break never ships
 * even when the authoring LLM produced one. Mirror of {@link coerceFirstPersonNarrationToSecond},
 * but third→second needs verb agreement (straightens→straighten, has→have, isn't→aren't).
 *
 * Scoping for safety (female/same-gender NPCs share she/her): the protagonist's NAME and the
 * verb it governs are ALWAYS converted (a name is unambiguous). Subject/possessive/object
 * pronouns are converted only when `coercePronouns` is true — the caller sets that ONLY when
 * no same-gender NPC name appears in the text, so a bare "she/her" can only be the protagonist.
 * When pronouns are left ambiguous, the residual break is still caught by the POV gate and
 * routed to LLM regen. Conservative + idempotent.
 */
export function coerceThirdPersonProtagonistToSecond(
  text: string,
  protagonistName?: string,
  opts: { coercePronouns?: boolean; subjectPronoun?: 'she' | 'he' } = {},
): { text: string; changed: boolean } {
  if (!text || !protagonistName) return { text, changed: false };
  const names = Array.from(new Set([protagonistName, protagonistName.split(/\s+/)[0]].filter(Boolean)));
  const escapedNames = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // The subject pass below replaces word-by-word, so a multi-word name must be
  // collapsed to its first token first — otherwise "Kylie Marinescu arrives"
  // coerces to "You Marinescu arrives".
  const nameTokens = protagonistName.trim().split(/\s+/);
  const fullNameSequenceRe = nameTokens.length > 1
    ? new RegExp(`\\b${nameTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}\\b(?!['’]s)`, 'gi')
    : null;
  const nameRe = new RegExp(`^(?:${escapedNames.join('|')})$`, 'i');
  const nameAnywhereRe = new RegExp(`\\b(?:${escapedNames.join('|')})\\b`, 'i');
  const nameAnywhereOrPossessiveRe = new RegExp(`\\b(?:${escapedNames.join('|')})\\b(?:['’]s)?`, 'i');
  const namePossessiveRe = new RegExp(`\\b(?:${[...escapedNames].sort((a, b) => b.length - a.length).join('|')})['’]s\\b`, 'gi');
  const subj = opts.subjectPronoun ?? 'she';
  const poss = subj === 'he' ? 'his' : 'her';
  const obj = subj === 'he' ? 'him' : 'her';
  const possS = subj === 'he' ? null : 'hers';
  const reflexive = subj === 'he' ? 'himself' : 'herself';
  let changed = false;

  const transformed = transformOutsideQuotes(text, (seg) => {
    if (!seg) return seg;
    let s = seg;
    const segmentHasProtagonistName = nameAnywhereRe.test(seg);
    const shouldCoercePronouns = Boolean(opts.coercePronouns && segmentHasProtagonistName);

    if (shouldCoercePronouns) {
      // Possessive (pronoun + following word) → "your"; standalone object form → "you".
      const pronounStart = scopedPronounStart(seg, nameAnywhereOrPossessiveRe);
      s = replaceAfterOffset(s, pronounStart, (tail) => {
        let out = tail;
        if (obj !== poss) {
          const possRe = new RegExp(`\\b${poss}\\b(?=\\s+[A-Za-z])`, 'g');
          out = out.replace(possRe, (m) => { changed = true; return matchCase(m, 'your'); });
          const possessiveObjectRe = new RegExp(`\\b${obj}\\b(?=\\s+(?:${[...MALFORMED_OBJECT_POSSESSIVE_FOLLOWERS].join('|')})\\b)`, 'g');
          out = out.replace(possessiveObjectRe, (m) => { changed = true; return matchCase(m, 'your'); });
          out = out.replace(new RegExp(`\\b${obj}\\b`, 'g'), (m) => { changed = true; return matchCase(m, 'you'); });
        } else {
          const objectHomeRe = new RegExp(`\\b(${OBJECT_HOME_VERBS.join('|')})\\s+her\\s+home\\b`, 'gi');
          out = out.replace(objectHomeRe, (_m, verb: string) => {
            changed = true;
            return `${verb} you home`;
          });
          out = out.replace(/\bher\b/g, (m, offset: number, full: string) => {
            changed = true;
            return matchCase(m, looksLikePossessiveHer(full, offset) ? 'your' : 'you');
          });
        }
        if (possS) out = out.replace(new RegExp(`\\b${possS}\\b`, 'g'), (m) => { changed = true; return matchCase(m, 'yours'); });
        out = out.replace(new RegExp(`\\b${reflexive}\\b`, 'g'), (m) => { changed = true; return matchCase(m, 'yourself'); });
        return out;
      });
    } else if (opts.coercePronouns && obj !== poss) {
      const possessiveObjectRe = new RegExp(`\\b${obj}\\b(?=\\s+(?:${[...MALFORMED_OBJECT_POSSESSIVE_FOLLOWERS].join('|')})\\b)`, 'g');
      s = s.replace(possessiveObjectRe, (m) => { changed = true; return matchCase(m, 'your'); });
    }

    s = s.replace(namePossessiveRe, (m) => {
      changed = true;
      return m === m.toUpperCase() && /[A-Z]/.test(m) ? 'YOUR' : 'your';
    });

    if (fullNameSequenceRe) {
      s = s.replace(fullNameSequenceRe, (m) =>
        m === m.toUpperCase() && /[A-Z]/.test(m) ? nameTokens[0].toUpperCase() : nameTokens[0]);
    }

    // Subject pass: protagonist NAME (always) and subject pronoun (when coercing pronouns)
    // → "you", de-inflecting the verb it governs.
    let pending = false;
    s = s.replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, (word, offset: number, full: string) => {
      const lower = word.toLowerCase();
      // The protagonist name is always capitalized as a proper noun, so it carries no
      // sentence-position signal — emit lowercase "you" and let capitalizeSentenceStarts
      // re-capitalize only the genuinely sentence-initial ones.
      if (nameRe.test(word)) {
        changed = true;
        const next = nextWordAfter(full, offset, word);
        if (next && PROTAGONIST_NAME_MODIFIER_FOLLOWERS.has(next)) {
          pending = false;
          return 'your';
        }
        pending = true;
        return 'you';
      }
      if (shouldCoercePronouns && lower === subj) { changed = true; pending = true; return matchCase(word, 'you'); }
      if (pending) {
        pending = false;
        const v = deinflectPresentVerb(word);
        if (v !== word) { changed = true; return v; }
      }
      return word;
    });

    const residue = repairSecondPersonResidueInSegment(s);
    if (residue.changed) {
      changed = true;
      s = residue.text;
    }

    return s;
  });

  const finalText = changed ? capitalizeSentenceStarts(transformed) : transformed;
  return { text: finalText, changed };
}

export class PovClarityValidator {
  validateScene(sceneContent: SceneContent, context: PovClarityContext = {}): PovClarityResult {
    const issues: PovClarityIssue[] = [];
    const firstBeat = (sceneContent.beats || []).find(beat => {
      const text = typeof beat.text === 'string' ? beat.text.trim() : String(beat.text || '').trim();
      return text.length > 0;
    });

    if (!firstBeat) {
      return {
        passed: false,
        score: 0,
        issues: [{
          beatId: sceneContent.startingBeatId || 'unknown',
          issue: 'Scene has no player-facing opening prose beat to anchor POV.',
          severity: 'error',
          suggestion: 'Add an opening beat that places the player character in the scene using you/your or {{player.name}}.',
        }],
        shouldRegenerate: true,
      };
    }

    const openingText = String(firstBeat.text || '');
    const variantTexts = Array.isArray(firstBeat.textVariants)
      ? firstBeat.textVariants.map((variant: { text?: unknown }) => String(variant.text || ''))
      : [];
    const textToCheck = [openingText, ...variantTexts].join('\n');

    if (!hasPlayerReference(textToCheck)) {
      issues.push({
        beatId: firstBeat.id,
        issue: 'Opening beat does not establish the player character as the POV/focal character.',
        severity: 'error',
        suggestion: 'Rewrite the first beat so it anchors the player with you/your or {{player.name}} before focusing on NPCs, setting, or exposition.',
      });
    }

    const characterNames = (context.characterNames || []).filter(Boolean);
    if (characterNames.length >= 2 && this.hasAmbiguousPronounChain(openingText, characterNames, context.protagonistName)) {
      issues.push({
        beatId: firstBeat.id,
        issue: 'Opening beat relies on pronouns while multiple characters are present, making the focal character ambiguous.',
        severity: 'warning',
        suggestion: 'Use {{player.name}} or exact NPC names in the opening beat before using pronouns.',
      });
    }

    // Beat-level POV consistency (gen-5): the original check only inspected the OPENING
    // beat, so a mid-scene payoff beat that flipped into third person ("Kylie hits
    // publish… She wakes to 84,000") in an otherwise second-person scene shipped
    // unflagged. Scan EVERY beat for third-person protagonist narration. Advisory
    // (warning) — it never forces regeneration, so it cannot destabilize a run, but it
    // surfaces the POV break in diagnostics.
    for (const beat of sceneContent.beats || []) {
      const beatText = typeof beat.text === 'string' ? beat.text : String(beat.text || '');
      if (this.isThirdPersonProtagonistNarration(beatText, context.protagonistName)) {
        issues.push({
          beatId: beat.id,
          issue: `Beat narrates the protagonist in the third person ("${context.protagonistName}… she/he…") in a second-person story — a POV break.`,
          severity: 'warning',
          suggestion: 'Rewrite the beat in second person ("you/your"); reserve third-person + pronoun for NPCs only.',
        });
      }
    }

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 70 - warningCount * 20);

    return {
      passed: errorCount === 0,
      score,
      issues,
      shouldRegenerate: errorCount > 0,
      checkedBeatId: firstBeat.id,
    };
  }

  /**
   * Scan an arbitrary set of reader-facing texts (e.g. encounter situation beats and
   * outcome storylets, which never live in `sceneContent.beats` and so escape the
   * per-scene beat scan above) for third-person protagonist narration. Returns the
   * offending snippets (deduped, trimmed to a readable length). Used by the final-story
   * pass to catch the encounter-outcome POV break (G10 Bite Me ep1/ep2 wrote whole
   * encounter sub-branches as "Kylie smiles back…" in a second-person story).
   */
  findThirdPersonProtagonistTexts(
    texts: Array<string | undefined | null>,
    protagonistName?: string,
  ): string[] {
    const hits: string[] = [];
    const seen = new Set<string>();
    for (const raw of texts) {
      const text = typeof raw === 'string' ? raw : '';
      if (!text.trim()) continue;
      if (this.isThirdPersonProtagonistNarration(text, protagonistName)) {
        const snippet = text.trim().slice(0, 160);
        if (!seen.has(snippet)) {
          seen.add(snippet);
          hits.push(snippet);
        }
      }
    }
    return hits;
  }

  /**
   * Scan reader-facing texts for FIRST-person protagonist narration ("my laptop… I have
   * to choose") in a second-person story. The bite-me-g16 ep2 cliffhanger coda slipped
   * into first person, and nothing detected it: the only POV scans were second-vs-third.
   * Mirror of {@link findThirdPersonProtagonistTexts}. Returns offending snippets.
   */
  findFirstPersonProtagonistTexts(
    texts: Array<string | undefined | null>,
    protagonistName?: string,
  ): string[] {
    const hits: string[] = [];
    const seen = new Set<string>();
    for (const raw of texts) {
      const text = typeof raw === 'string' ? raw : '';
      if (!text.trim()) continue;
      if (this.isFirstPersonProtagonistNarration(text)) {
        const snippet = text.trim().slice(0, 160);
        if (!seen.has(snippet)) {
          seen.add(snippet);
          hits.push(snippet);
        }
      }
    }
    return hits;
  }

  /**
   * True when narration (not dialogue) uses first-person for the protagonist in a
   * second-person story. Quoted dialogue is stripped first — characters legitimately say
   * "I" — then we require a first-person pronoun in the remaining narration AND no
   * second-person address anywhere (the same load-bearing "no you" signal the third-person
   * check uses). protagonistName is unused (first-person never names the protagonist) but
   * kept for signature symmetry. Heuristic + advisory.
   */
  isFirstPersonProtagonistNarration(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const narration = stripDoubleQuotedSpans(trimmed);
    // Second-person in NARRATION (not inside a quoted/italic message) → in-register, not a
    // break. Checking the stripped narration — rather than the whole text — matters when a
    // first-person coda embeds a quoted message that itself says "you" (bite-me-g16 ep2
    // coda embeds Victor's DM "*…if you can stand it…*").
    if (hasPlayerReference(narration)) return false;
    // First-person singular in narration. "I"/"I'm"/"I'll"/"I've"/"I'd" are matched
    // case-SENSITIVELY (capital I) so lowercase "i" inside words is never a hit; the
    // possessive/object forms (me/my/mine/myself) are case-insensitive ("My thumb hovers").
    // Bare "we/our/us" is excluded (often diegetic group speech) to stay conservative.
    return /\bI\b|\bI['’](?:m|ll|ve|d)\b/.test(narration) || /\b(?:me|my|mine|myself)\b/i.test(narration);
  }

  /**
   * True when a beat narrates the PROTAGONIST in the third person in a second-person
   * story: the protagonist is referenced by name AND a third-person singular pronoun
   * appears, while NO second-person marker ("you/your") is present anywhere in the
   * beat. The absence of any "you" is the load-bearing signal — a beat that addresses
   * the player even once is in-register and not flagged (so an occasional stylized
   * self-naming like "You sign it: Kylie Marinescu" is safe). Heuristic + advisory.
   */
  private isThirdPersonProtagonistNarration(text: string, protagonistName?: string): boolean {
    if (!protagonistName) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const narration = stripDoubleQuotedSpans(trimmed);
    const names = Array.from(new Set([protagonistName, protagonistName.split(/\s+/)[0]].filter(Boolean)));
    const escapedNames = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const namePossessiveRe = new RegExp(`\\b(?:${[...escapedNames].sort((a, b) => b.length - a.length).join('|')})['’]s\\b`, 'i');
    if (namePossessiveRe.test(narration)) return true;
    // Any second-person address in narration means the beat is otherwise in the house POV.
    if (hasPlayerReference(narration)) return false;
    const nameRe = new RegExp(`\\b(?:${escapedNames.join('|')})\\b`, 'i');
    if (!nameRe.test(narration)) return false;
    // Protagonist named, third-person singular pronoun present, and no "you" anywhere →
    // the protagonist is being narrated in third person.
    return /\b(?:she|he|her|him|his|hers|herself|himself)\b/i.test(narration);
  }

  private hasAmbiguousPronounChain(text: string, characterNames: string[], protagonistName?: string): boolean {
    if (hasPlayerReference(text)) return false;

    const pronounHits = text.match(/\b(?:he|him|his|she|her|hers|they|them|their|theirs)\b/gi) || [];
    if (pronounHits.length < 2) return false;

    const lowered = text.toLowerCase();
    const hasNamedCharacter = characterNames.some(name => lowered.includes(name.toLowerCase()));
    const hasProtagonistName = protagonistName ? lowered.includes(protagonistName.toLowerCase()) : false;

    return !hasNamedCharacter && !hasProtagonistName;
  }
}
