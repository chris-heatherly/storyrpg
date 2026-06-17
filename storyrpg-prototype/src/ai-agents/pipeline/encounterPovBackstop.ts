import type { Story } from '../../types';
import {
  coerceThirdPersonProtagonistToSecond,
  PovClarityValidator,
} from '../validators/PovClarityValidator';

/**
 * WS0.3 — encounter-POV backstop. Encounter outcome storylets and phase outcome prose are
 * authored in third person ("Kylie straightens her collar… she has become it") in a
 * second-person story (the recurring `protagonist_as_npc` / encounter-POV defect). The LLM
 * regen path (EncounterArchitect POV directive) is the primary fix; THIS is the deterministic
 * guarantee that a third-person break never ships even on truncated/variant output.
 *
 * Only NARRATIVE prose fields are touched (not choice option text, which is already imperative
 * second person, nor labels/prompts). Pronoun coercion is held back when a same-gender NPC
 * shares the string (she/her ambiguity) — the residual is reported for the LLM-regen gate.
 */

const NARRATIVE_KEYS = new Set([
  'text',
  'setupText',
  'narrativeText',
  'escalationText',
  'outcomeText',
  'successText',
  'failureText',
  'immediateEffect',
  'lingeringEffect',
  'visibleComplication',
  'narration',
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

function firstNameRe(name: string): RegExp {
  const first = name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${first}\\b`, 'i');
}

function textHasAnyName(text: string, names: string[]): boolean {
  return names.some((n) => firstNameRe(n).test(text));
}

function walkNarrative(node: unknown, fn: (s: string) => string, depth = 0): void {
  if (depth > 12 || node == null) return;
  if (Array.isArray(node)) {
    for (const v of node) walkNarrative(v, fn, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        if (NARRATIVE_KEYS.has(k)) obj[k] = fn(v);
      } else {
        walkNarrative(v, fn, depth + 1);
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
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === 'string') {
        if (NARRATIVE_KEYS.has(k) && v.trim()) out.push(v);
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
  const prot = protagonist ?? protagonistFromStory(story);
  if (!prot?.name) return [];
  const strings: string[] = [];
  eachEncounter(story, (enc) => collectNarrative(enc, strings));
  return new PovClarityValidator().findThirdPersonProtagonistTexts(strings, prot.name);
}

export interface EncounterPovBackstopResult {
  coerced: number;
  residualBreaks: string[];
}

/**
 * In-place deterministic backstop: coerce third-person protagonist narration in encounter
 * prose to second person. Returns how many strings changed and any residual breaks the
 * coercion could not safely clear (same-gender NPC ambiguity) — the gate routes those to regen.
 */
export function applyEncounterPovBackstop(
  story: Story,
  protagonist?: ProtagonistRef,
): EncounterPovBackstopResult {
  const prot = protagonist ?? protagonistFromStory(story);
  if (!prot?.name) return { coerced: 0, residualBreaks: [] };
  const subjectPronoun = subjectPronounOf(prot.pronouns);
  const sameGender = sameGenderNpcNames(story, prot.pronouns).filter((n) => n !== prot.name);
  let coerced = 0;
  eachEncounter(story, (enc) =>
    walkNarrative(enc, (s) => {
      const coercePronouns = Boolean(subjectPronoun) && !textHasAnyName(s, sameGender);
      const { text, changed } = coerceThirdPersonProtagonistToSecond(s, prot.name, {
        coercePronouns,
        subjectPronoun,
      });
      if (changed) coerced += 1;
      return text;
    }),
  );
  return { coerced, residualBreaks: findEncounterPovBreaks(story, prot) };
}
