import type { Story } from '../../types';
import {
  coerceThirdPersonProtagonistToSecond,
  PovClarityValidator,
  repairSecondPersonProtagonistResidue,
} from '../validators/PovClarityValidator';

/**
 * WS0.3 — encounter-POV backstop. Encounter outcome storylets and phase outcome prose are
 * authored in third person ("Kylie straightens her collar… she has become it") in a
 * second-person story (the recurring `protagonist_as_npc` / encounter-POV defect). The LLM
 * regen path (EncounterArchitect POV directive) is the primary fix; THIS is the deterministic
 * guarantee that a third-person break never ships even on truncated/variant output.
 *
 * Narrative prose fields are touched, plus choice option text that explicitly names the
 * protagonist. Pronoun coercion is held back when a same-gender NPC shares the string
 * (she/her ambiguity) — the residual is reported for the LLM-regen gate.
 */

const NARRATIVE_KEYS = new Set([
  'text',
  'setupText',
  'narrativeText',
  'escalationText',
  'outcomeText',
  'successText',
  'failureText',
  'visualMoment',
  'visualNarrative',
  'visibleCost',
  'immediateEffect',
  'lingeringEffect',
  'visibleComplication',
  'narration',
  'description',
  'victory',
  'defeat',
]);

export interface ProtagonistRef {
  name?: string;
  aliases?: string[];
  pronouns?: string;
}

function subjectPronounOf(pronouns?: string): 'she' | 'he' | undefined {
  const p = (pronouns || '').toLowerCase();
  if (p.startsWith('she')) return 'she';
  if (p.startsWith('he')) return 'he';
  return undefined;
}

/** Names of NPCs who share the protagonist's pronouns (same-gender → shared she/her risk). */
function sameGenderNpcNames(story: Story, pronouns?: string): string[] {
  const subj = subjectPronounOf(pronouns);
  if (!subj) return [];
  const out: string[] = [];
  for (const npc of story.npcs || []) {
    const p = (npc.pronouns || '').toLowerCase();
    if (p.startsWith(subj) && npc.name) out.push(npc.name);
  }
  return out;
}

/** Resolve the protagonist from the story roster (npcs[].role === 'protagonist'). */
export function protagonistFromStory(story: Story): ProtagonistRef | undefined {
  const p = (story.npcs || []).find((n) => (n as { role?: string }).role === 'protagonist');
  if (!p?.name) return undefined;
  return { name: p.name, pronouns: (p as { pronouns?: string }).pronouns };
}

const UNSAFE_PROTAGONIST_NAMES = new Set([
  'a',
  'an',
  'hero',
  'lead',
  'main',
  'protagonist',
  'the',
  'unknown',
]);

function safeProtagonistName(name?: string): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.length < 3) return undefined;
  if (UNSAFE_PROTAGONIST_NAMES.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

function resolveProtagonist(story: Story, provided?: ProtagonistRef): ProtagonistRef | undefined {
  const roster = protagonistFromStory(story);
  if (safeProtagonistName(roster?.name)) {
    return {
      name: roster!.name,
      aliases: provided?.aliases,
      pronouns: roster?.pronouns || provided?.pronouns,
    };
  }
  if (!safeProtagonistName(provided?.name)) return undefined;
  return provided;
}

function firstNameRe(name: string): RegExp {
  const first = name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${first}\\b`, 'i');
}

function textHasAnyName(text: string, names: string[]): boolean {
  return names.some((n) => firstNameRe(n).test(text));
}

function looksLikeChoiceText(obj: Record<string, unknown>, key: string): boolean {
  return key === 'text' && (
    obj.outcomes != null ||
    obj.approach != null ||
    obj.primarySkill != null ||
    obj.consequenceDomain != null
  );
}

function replaceChoicePhrase(text: string, pattern: RegExp, replacement: string): string {
  return text.replace(pattern, (match) =>
    /^[A-Z]/.test(match) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement,
  );
}

function repairChoiceTextProtagonistReference(text: string, protagonistName: string): { text: string; changed: boolean } {
  const coerced = coerceThirdPersonProtagonistToSecond(text, protagonistName, {
    coercePronouns: false,
  });
  let repaired = coerced.text;
  repaired = replaceChoicePhrase(repaired, /\bdemand your location\b/gi, 'demand answers');
  repaired = replaceChoicePhrase(repaired, /\bask for your location\b/gi, 'ask where this is going');
  repaired = replaceChoicePhrase(repaired, /\bask where your location is\b/gi, 'ask where this is going');
  return {
    text: repaired,
    changed: coerced.changed || repaired !== text,
  };
}

function walkNarrative(
  node: unknown,
  fn: (s: string) => string,
  choiceFn: (s: string) => string,
  depth = 0,
): void {
  if (depth > 12 || node == null) return;
  if (Array.isArray(node)) {
    for (const v of node) walkNarrative(v, fn, choiceFn, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        if (looksLikeChoiceText(obj, k)) {
          obj[k] = choiceFn(v);
        } else if (NARRATIVE_KEYS.has(k)) {
          obj[k] = fn(v);
        }
      } else {
        walkNarrative(v, fn, choiceFn, depth + 1);
      }
    }
  }
}

function collectNarrative(node: unknown, out: string[], depth = 0): void {
  if (depth > 12 || node == null) return;
  if (Array.isArray(node)) {
    for (const v of node) collectNarrative(v, out, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        if ((NARRATIVE_KEYS.has(k) || looksLikeChoiceText(obj, k)) && v.trim()) out.push(v);
      } else {
        collectNarrative(v, out, depth + 1);
      }
    }
  }
}

function eachEncounter(story: Story, fn: (enc: unknown) => void): void {
  for (const ep of story.episodes || []) {
    for (const sc of (ep.scenes || []) as Array<{ encounter?: unknown }>) {
      if (sc.encounter) fn(sc.encounter);
    }
  }
}

/** Detection only: third-person protagonist breaks remaining in encounter narrative prose. */
export function findEncounterPovBreaks(story: Story, protagonist?: ProtagonistRef): string[] {
  const prot = resolveProtagonist(story, protagonist);
  if (!prot?.name) return [];
  const strings: string[] = [];
  eachEncounter(story, (enc) => collectNarrative(enc, strings));
  return new PovClarityValidator().findThirdPersonProtagonistTexts(strings, prot.name);
}

export interface EncounterPovBackstopResult {
  coerced: number;
  residualBreaks: string[];
}

/** Apply the POV projection to one encounter before its owning scene is sealed. */
export function applyEncounterPovBackstopToEncounter(
  encounter: unknown,
  protagonist: ProtagonistRef,
  sameGenderNpcNames: string[] = [],
): EncounterPovBackstopResult {
  const protagonistName = safeProtagonistName(protagonist.name);
  if (!protagonistName) return { coerced: 0, residualBreaks: [] };
  const subjectPronoun = subjectPronounOf(protagonist.pronouns);
  const sameGender = sameGenderNpcNames.filter((name) => name !== protagonistName);
  let coerced = 0;
  walkNarrative(
    encounter,
    (text) => {
      const residue = repairSecondPersonProtagonistResidue(text);
      if (!firstNameRe(protagonistName).test(residue.text)) {
        if (residue.changed) coerced += 1;
        return residue.text;
      }
      const coercePronouns = Boolean(subjectPronoun) && !textHasAnyName(text, sameGender);
      const result = coerceThirdPersonProtagonistToSecond(residue.text, protagonistName, {
        coercePronouns,
        subjectPronoun,
      });
      if (result.changed || residue.changed) coerced += 1;
      return result.text;
    },
    (text) => {
      const result = repairChoiceTextProtagonistReference(text, protagonistName);
      if (result.changed) coerced += 1;
      return result.text;
    },
  );
  const strings: string[] = [];
  collectNarrative(encounter, strings);
  const residualBreaks = new PovClarityValidator()
    .findThirdPersonProtagonistTexts(strings, protagonistName);
  return { coerced, residualBreaks };
}

/**
 * In-place deterministic backstop: coerce third-person protagonist narration in encounter
 * prose to second person. Returns how many strings changed and any residual breaks the
 * coercion could not safely clear (same-gender NPC ambiguity) — the gate routes those to regen.
 */
/**
 * W3 STATUS (2026-07-03): REGRESSION NET. Encounter prose is now authored
 * under the shared house register (PROSE_AND_DIALOGUE_CRAFT) with the ABSOLUTE
 * second-person POV block, so this coercion should be a no-op on healthy runs.
 * Retire after one live cycle where its rewrite count stays 0.
 */
export function applyEncounterPovBackstop(
  story: Story,
  protagonist?: ProtagonistRef,
): EncounterPovBackstopResult {
  const prot = resolveProtagonist(story, protagonist);
  if (!prot?.name) return { coerced: 0, residualBreaks: [] };
  const sameGender = sameGenderNpcNames(story, prot.pronouns).filter((n) => n !== prot.name);
  let coerced = 0;
  eachEncounter(story, (enc) => {
    coerced += applyEncounterPovBackstopToEncounter(enc, prot, sameGender).coerced;
  });
  return { coerced, residualBreaks: findEncounterPovBreaks(story, prot) };
}
