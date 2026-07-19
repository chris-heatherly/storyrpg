/**
 * Encounter-outcome state flags (Gen-4 W4).
 *
 * Encounters resolve to one of victory / partialVictory / defeat / escape, but the
 * outcome set NO state, so a following scene could not vary by what happened. The
 * Endsong Gen-4 case: the wall-breach partialVictory leaves Lysandra wounded, yet
 * s3-5 (which all four outcomes reconverge into) opened with her relaxed at the
 * parapet — the gameplay state and the prose contradicted each other.
 *
 * Two deterministic passes, run at the FinalStoryContract chokepoint alongside the
 * witness/pronoun resolvers:
 *
 *  - `seedEncounterOutcomeFlags` (always-on, additive): every present outcome gets
 *    a `setFlag encounter_<encounterId>_<outcome>` consequence so downstream scenes
 *    and validators can condition on the result. Pure capability seeding.
 *  - `findEncounterOutcomeDesyncs` (detection): when ≥2 distinct outcomes RECONVERGE
 *    into the same next scene and that scene carries no textVariant keyed on an
 *    `encounter_<id>_*` flag, the prose cannot reflect the outcome — a desync. The
 *    caller decides whether to surface it (gated).
 *
 * No LLM. The actual outcome-aware variant PROSE is authored upstream; these passes
 * make the state available and flag where a reconvergence ignores it.
 */

import type { Story, Scene, Encounter } from '../../types';
import type { Consequence } from '../../types/consequences';

const OUTCOMES = ['victory', 'partialVictory', 'defeat', 'escape'] as const;
type OutcomeKey = (typeof OUTCOMES)[number];

/**
 * G12 found THREE spellings of the same outcome flag in one run: the seeder used
 * `enc.id` (which the converter auto-suffixes `-encounter`), authored variants were
 * keyed on the SCENE id, and EncounterArchitect's default storylets used
 * `partial_victory`/`escaped`. Setter never matched consumer, so every encounter's
 * post-reconvergence residue was dead. Canonical form: scene-id keyed (trailing
 * `-encounter` stripped), camelCase outcome keys.
 */
const OUTCOME_ALIASES: Record<string, OutcomeKey> = {
  victory: 'victory',
  partialvictory: 'partialVictory',
  partial_victory: 'partialVictory',
  defeat: 'defeat',
  defeated: 'defeat',
  escape: 'escape',
  escaped: 'escape',
};

const ENCOUNTER_FLAG_RE = /^encounter_(.+?)_(partial_victory|partialvictory|victory|defeated|defeat|escaped|escape)$/i;

/** Scene-id form of an encounter id: the converter's auto `-encounter` suffix stripped. */
export function canonicalEncounterFlagId(encounterId: string): string {
  return encounterId.replace(/-encounter$/, '');
}

export function canonicalOutcomeKey(outcome: string): string {
  return OUTCOME_ALIASES[outcome.toLowerCase()] ?? outcome;
}

export function encounterOutcomeFlag(encounterId: string, outcome: string): string {
  return `encounter_${canonicalEncounterFlagId(encounterId)}_${canonicalOutcomeKey(outcome)}`;
}

/** Rewrite a single flag name to canonical spelling; returns the input unchanged if it isn't an encounter-outcome flag. */
export function canonicalizeEncounterOutcomeFlagName(flag: string): string {
  const m = ENCOUNTER_FLAG_RE.exec(flag);
  if (!m) return flag;
  return encounterOutcomeFlag(m[1], m[2]);
}

/**
 * Canonicalize encounter-outcome flag spellings inside ONE condition tree, in
 * place — the parse-time (creation seam) counterpart of the story-wide
 * normalizeEncounterOutcomeFlags walker below, so consumer-side misspellings
 * are fixed where they are authored (SceneWriter textVariants, ChoiceAuthor
 * conditions) instead of waiting for the final-contract net. Idempotent;
 * returns the number of rewrites.
 */
export function canonicalizeConditionOutcomeFlags(condition: unknown): number {
  let rewritten = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.flag === 'string') {
      const canonical = canonicalizeEncounterOutcomeFlagName(obj.flag);
      if (canonical !== obj.flag) {
        obj.flag = canonical;
        rewritten += 1;
      }
    }
    if (Array.isArray(obj.conditions)) visit(obj.conditions);
    if (obj.condition && typeof obj.condition === 'object') visit(obj.condition);
  };
  visit(condition);
  return rewritten;
}

/**
 * Deep-walk the story and rewrite every encounter-outcome flag reference — variant
 * conditions, setFlag consequences, storylet setsFlags, string conditions — to the
 * canonical spelling, so setters and consumers agree no matter which layer authored
 * them. Idempotent. Returns the number of rewrites.
 */
export function normalizeEncounterOutcomeFlagsInObject(root: unknown): number {
  let rewritten = 0;
  const seen = new Set<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && (key === 'flag' || key === 'condition')) {
        const canonical = canonicalizeEncounterOutcomeFlagName(value);
        if (canonical !== value) {
          obj[key] = canonical;
          rewritten += 1;
        }
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(root);
  return rewritten;
}

export function normalizeEncounterOutcomeFlags(story: Story): number {
  return normalizeEncounterOutcomeFlagsInObject(story.episodes);
}

export interface SeedEncounterOutcomeFlagsResult {
  encountersSeeded: number;
  flagsAdded: number;
}

/** Append a `setFlag encounter_<id>_<outcome>` to each present outcome, in place. */
export function seedEncounterOutcomeFlags(story: Story): SeedEncounterOutcomeFlagsResult {
  const result: SeedEncounterOutcomeFlagsResult = { encountersSeeded: 0, flagsAdded: 0 };
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      const enc = scene.encounter;
      if (!enc?.outcomes) continue;
      let touched = false;
      for (const key of OUTCOMES) {
        const outcome = enc.outcomes[key];
        if (!outcome) continue;
        const flag = encounterOutcomeFlag(enc.id, key);
        const existing = (outcome.consequences || []) as Consequence[];
        if (existing.some((c) => c.type === 'setFlag' && c.flag === flag)) continue;
        outcome.consequences = [...existing, { type: 'setFlag', flag, value: true }];
        result.flagsAdded += 1;
        touched = true;
      }
      if (touched) result.encountersSeeded += 1;
    }
  }
  return result;
}

export interface EncounterOutcomeDesync {
  encounterId: string;
  encounterSceneId: string;
  reconvergenceSceneId: string;
  outcomes: string[];
}

/** Distinct present outcome keys for an encounter. */
function presentOutcomes(enc: Encounter): OutcomeKey[] {
  return OUTCOMES.filter((k) => Boolean(enc.outcomes?.[k]));
}

/** True if any beat in the scene has a textVariant whose condition references an `encounter_<id>_` flag. */
function sceneHasOutcomeVariant(scene: Scene, encounterId: string): boolean {
  const prefix = `encounter_${canonicalEncounterFlagId(encounterId)}_`;
  const matches = (cond: unknown): boolean => {
    if (!cond || typeof cond !== 'object') return false;
    const c = cond as Record<string, unknown>;
    if (typeof c.flag === 'string' && canonicalizeEncounterOutcomeFlagName(c.flag).startsWith(prefix)) return true;
    if (Array.isArray(c.conditions)) return c.conditions.some(matches);
    if (c.condition) return matches(c.condition);
    return false;
  };
  for (const beat of scene.beats || []) {
    for (const variant of beat.textVariants || []) {
      if (matches((variant as { condition?: unknown }).condition)) return true;
    }
  }
  return false;
}

/** The id of a scene's first reader-facing prose beat (skips choice-bridge beats). */
export function firstProseBeatId(scene: Scene): string | undefined {
  const beat = (scene.beats || []).find(
    (b) => !(b as { isChoiceBridge?: boolean }).isChoiceBridge && typeof b.text === 'string' && b.text.trim().length > 0,
  );
  return beat?.id;
}

/**
 * Add outcome-conditioned text variants to a beat, gated on the
 * `encounter_<id>_<outcome>` flags. Skips any outcome whose flag already has a
 * variant on the beat (idempotent), so re-running never duplicates. Returns the
 * number of variants added. Pure (mutates the story in place). Unit-testable — the
 * LLM that authors the prose is the caller's responsibility.
 */
export function applyOutcomeVariants(
  story: Story,
  reconvergenceSceneId: string,
  beatId: string,
  encounterId: string,
  variants: Array<{ outcome: string; text: string }>,
): number {
  if (variants.length === 0) return 0;
  let added = 0;
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      if (scene.id !== reconvergenceSceneId) continue;
      for (const beat of scene.beats || []) {
        if (beat.id !== beatId) continue;
        const existing = (beat.textVariants || []) as Array<{ condition?: { flag?: string } }>;
        const have = new Set(
          existing.map((v) => v.condition?.flag).filter((f): f is string => typeof f === 'string'),
        );
        const toAdd = variants
          .map((v) => ({ flag: encounterOutcomeFlag(encounterId, v.outcome), text: v.text }))
          .filter((v) => v.text.trim() && !have.has(v.flag))
          .map((v) => ({
            condition: { type: 'flag' as const, flag: v.flag, value: true },
            text: v.text,
          }));
        if (toAdd.length === 0) continue;
        beat.textVariants = [...(beat.textVariants || []), ...(toAdd as never[])];
        added += toAdd.length;
      }
    }
  }
  return added;
}

/**
 * Find encounters where ≥2 distinct outcomes reconverge into one next scene that
 * has no outcome-conditioned text — the scene cannot reflect what happened.
 */
export function findEncounterOutcomeDesyncs(story: Story): EncounterOutcomeDesync[] {
  const sceneById = new Map<string, Scene>();
  for (const ep of story.episodes || []) for (const s of ep.scenes || []) sceneById.set(s.id, s);

  const desyncs: EncounterOutcomeDesync[] = [];
  for (const ep of story.episodes || []) {
    for (const scene of ep.scenes || []) {
      const enc = scene.encounter;
      if (!enc?.outcomes) continue;
      const outs = presentOutcomes(enc);
      if (outs.length < 2) continue;

      // Group outcomes by their next scene; a reconvergence = a target shared by ≥2 outcomes.
      const byTarget = new Map<string, OutcomeKey[]>();
      for (const k of outs) {
        const target = enc.outcomes[k]?.nextSceneId;
        if (!target) continue;
        byTarget.set(target, [...(byTarget.get(target) || []), k]);
      }
      for (const [target, keys] of byTarget) {
        if (keys.length < 2) continue;
        const targetScene = sceneById.get(target);
        if (!targetScene) continue; // terminal/cross-episode target — not checked here
        if (!sceneHasOutcomeVariant(targetScene, enc.id)) {
          desyncs.push({
            encounterId: enc.id,
            encounterSceneId: scene.id,
            reconvergenceSceneId: target,
            outcomes: keys,
          });
        }
      }
    }
  }
  return desyncs;
}
