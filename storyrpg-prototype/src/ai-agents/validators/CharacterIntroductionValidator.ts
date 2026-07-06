/**
 * Character-Introduction Validator (2026-06-09 storytelling-quality audit —
 * the "who is this?" defect class).
 *
 * Two shipped variants, both invisible to every existing gate:
 *
 *  1. NAME-DROP BEFORE INTRODUCTION — bite-me-g10 first names Victor Vâlcescu
 *     in s2-4 prose ("You open Victor's first. Of course you do.") in a scene
 *     whose cast never includes him; by s3-2 he behaves as established, but no
 *     scene ever introduced him on-page.
 *  2. METADATA-ONLY PRESENCE — endsong-g10 carries Sylvanor Dawnheart in an
 *     encounter's npcStates / charactersInvolved with full disposition
 *     tracking, while the prose never names them: the reader meets a state
 *     machine, not a character.
 *
 * `PropIntroductionValidator` cannot catch either: it reads only structured
 * `referencedEntityIds`, never prose. This validator walks the assembled story
 * in reading order (episodes by number, scenes in array order — the same
 * approximation the rest of the pipeline uses) and checks the ROSTER cast
 * (story.npcs) against the prose:
 *
 *  - error: an NPC's name first occurs in prose in a scene BEFORE any scene
 *    that carries them in its cast (`charactersInvolved`) — a cold name-drop
 *    the reader can't place (class 1);
 *  - warning: an NPC is in a scene's cast but their name never appears in
 *    that scene's prose nor any earlier prose — present in metadata only
 *    (class 2);
 *  - warning: an NPC's first on-page appearance lands EARLIER than the season
 *    plan's `characterIntroductions` episode for them (plan drift).
 *
 * Name matching is conservative to keep precision: the FULL name always
 * matches (word-bounded, accent-insensitive); the first-name token matches
 * only when it is ≥ 3 chars and unique across the roster's first names.
 * Branch caveat: array order flattens parallel branches, so a character
 * introduced on one branch counts as introduced for its siblings — this
 * under-reports (never over-reports) the branch-aware defect.
 *
 * Pure, deterministic, generator-internal. Registration is DEFAULT-ON behind
 * `GATE_CHARACTER_INTRODUCTION`, dispatched from {@link runFidelityValidators}.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { Beat } from '../../types/content';
import type { Scene, Story } from '../../types/story';

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All reader-facing prose of one scene (beats + variants + encounter content). */
function sceneProse(scene: Scene): string {
  const parts: string[] = [];
  for (const beat of scene.beats || []) {
    const b = beat as Beat;
    if (b.text) parts.push(b.text);
    for (const variant of b.textVariants || []) {
      if (variant.text) parts.push(variant.text);
    }
  }
  const enc = scene.encounter as
    | {
        setupText?: string;
        phases?: Array<{ beats?: Array<{ text?: string; setupText?: string; escalationText?: string }> }>;
        storylets?: unknown;
      }
    | undefined;
  if (enc) {
    if (enc.setupText) parts.push(enc.setupText);
    const collect = (beats: Array<{ text?: string; setupText?: string; escalationText?: string }> | undefined): void => {
      for (const b of beats || []) {
        if (b.text) parts.push(b.text);
        if (b.setupText) parts.push(b.setupText);
        if (b.escalationText) parts.push(b.escalationText);
      }
    };
    for (const phase of enc.phases || []) collect(phase.beats);
    const storylets = Array.isArray(enc.storylets)
      ? enc.storylets
      : Object.values((enc.storylets ?? {}) as Record<string, unknown>);
    for (const storylet of storylets) {
      if (storylet && typeof storylet === 'object') {
        collect((storylet as { beats?: Array<{ text?: string }> }).beats);
      }
    }
  }
  return parts.join(' ');
}

interface RosterEntry {
  id: string;
  name: string;
  /** Normalized full name, e.g. "victor valcescu". */
  fullName: string;
  /** Normalized first-name token, when usable for matching alone. */
  firstToken?: string;
}

/** Build matchable roster entries; first tokens kept only when unambiguous. */
function buildRoster(story: Story): RosterEntry[] {
  const entries: RosterEntry[] = (story.npcs || [])
    .map((npc) => ({ id: npc.id, name: npc.name, fullName: normalize(npc.name || '') }))
    .filter((e) => e.fullName.length >= 3);
  const firstCounts = new Map<string, number>();
  for (const e of entries) {
    const first = e.fullName.split(' ')[0];
    firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
  }
  for (const e of entries) {
    const first = e.fullName.split(' ')[0];
    if (first.length >= 3 && firstCounts.get(first) === 1) {
      (e as RosterEntry).firstToken = first;
    }
  }
  return entries;
}

/** Whether the normalized prose names this roster entry (full name or unique first token). */
function proseNames(entry: RosterEntry, normalizedProse: string): boolean {
  const padded = ` ${normalizedProse} `;
  if (padded.includes(` ${entry.fullName} `)) return true;
  if (entry.firstToken && padded.includes(` ${entry.firstToken} `)) return true;
  return false;
}

const FIRST_APPEARANCE_OFFPAGE_FAMILIARITY_RE = /\b(?:only|just)\s+been\s+(?:\w+\s+){0,3}(?:hours?|days?|nights?|weeks?)\s+(?:with|around)\b[^.!?]{0,220}\b(?:easy\s+gesture|refills?\s+your\s+(?:wine|glass)|watches?\s+over\s+the\s+rim|kindness|belong|belonging|inside\s+joke|the\s+club)\b/i;
// "her other friend Mika" is an introduction phrase, not settled membership.
const FIRST_APPEARANCE_SETTLED_GROUP_RE = /\b(?:dusk\s+club|club|crew|circle|group)\b[^.!?]{0,160}\b(?:belong|belonging|inside\s+joke|usual|already|one\s+of\s+us|friends?\s+now|best\s+friend)\b/i;
const FIRST_CONTACT_STAGING_RE = /\b(?:you\s+meet|meets?\s+you|offers?\s+(?:a\s+)?hand|introduces?\s+(?:herself|himself|themselves|you)|says?,?\s*["']|["'][^"']{0,80}["']\s*,?\s*(?:she|he|they)\s+says?|a\s+woman\b[^.!?]{0,80}\bsays?\b|stranger\b[^.!?]{0,80}\b(?:says?|offers?|steps?)\b)/i;
const FIRST_APPEARANCE_THIRD_PERSON_SUMMARY_RE = /\b(?:she|he)\s+(?:explores?|wanders?|arrives?|steps?|walks?)\b/i;

function hasPlayerReference(text: string): boolean {
  return /\byou\b|\byour\b|\byours\b/i.test(text);
}

function hasFirstContactStaging(rawProse: string): boolean {
  return FIRST_CONTACT_STAGING_RE.test(rawProse);
}

function impliesOffPageFamiliarityOnFirstAppearance(rawProse: string, newNamesInScene: number): boolean {
  if (FIRST_APPEARANCE_OFFPAGE_FAMILIARITY_RE.test(rawProse)) return true;
  if (hasFirstContactStaging(rawProse)) return false;
  if (newNamesInScene >= 1 && FIRST_APPEARANCE_THIRD_PERSON_SUMMARY_RE.test(rawProse) && !hasPlayerReference(rawProse)) {
    return true;
  }
  return newNamesInScene >= 2 && FIRST_APPEARANCE_SETTLED_GROUP_RE.test(rawProse);
}

/** Re-check whether a scene still trips the off-page-familiarity class after repair. */
export function scenePassesCharacterIntroductionOffPageCheck(
  scene: Scene,
  npcNames: string[],
): boolean {
  const rawProse = sceneProse(scene);
  const newNamesInScene = npcNames.filter((name) => {
    const entry = { id: '', name, fullName: normalize(name) } as RosterEntry;
    return proseNames(entry, normalize(rawProse));
  }).length;
  return !impliesOffPageFamiliarityOnFirstAppearance(rawProse, newNamesInScene);
}

// Back-reference appositive right after a name: "Stela Pavel—the woman from
// the bookstore—", "Andrei, the man you met at the market,". On a FIRST
// appearance any such reference points at an event the reader never saw
// (an earlier on-page meeting would have made this scene not the first
// appearance), so the prose is placing the reader in a memory they don't have
// (bite-me 2026-07-03: no bookstore scene exists anywhere in the episode).
const OFFPAGE_BACKREFERENCE_WINDOW = 90;
const OFFPAGE_BACKREFERENCE_RE =
  /^[\s,—–(-]*(?:the\s+)?(?:woman|man|girl|guy|one|lady|gentleman|waitress|waiter|clerk|owner|stranger)?\s*(?:from|you\s+(?:met|saw|noticed|talked\s+to)\s+(?:at|in|outside|near))\s+the\s+[a-z]/i;

function offPageBackReferenceAfterName(rawProse: string, displayName: string): string | undefined {
  const lowered = rawProse.toLowerCase();
  const needle = displayName.toLowerCase();
  let from = 0;
  while (from < lowered.length) {
    const idx = lowered.indexOf(needle, from);
    if (idx < 0) return undefined;
    const window = rawProse.slice(idx + needle.length, idx + needle.length + OFFPAGE_BACKREFERENCE_WINDOW);
    if (OFFPAGE_BACKREFERENCE_RE.test(window)) {
      return `${displayName}${window.split(/[.!?\n]/)[0]}`.trim();
    }
    from = idx + needle.length;
  }
  return undefined;
}

/** Whether a scene's cast (`charactersInvolved` mixes ids and display names) carries this NPC. */
function castIncludes(entry: RosterEntry, scene: Scene): boolean {
  for (const ref of scene.charactersInvolved || []) {
    const n = normalize(String(ref || ''));
    if (!n) continue;
    if (n === normalize(entry.id) || n === entry.fullName) return true;
  }
  return false;
}

export interface CharacterIntroductionInput {
  story: Story;
  /** Season plan introduction order, when the run has one (plan-drift check). */
  characterIntroductions?: Array<{ characterId: string; introducedInEpisode: number }>;
  /**
   * Per-scene planned-contract text (required-beat mustDepict turns, story-circle
   * sourceText, signature moment), keyed by scene id. When a scene's OWN contract
   * names an NPC, prose naming them there is a planned verbal staging, not a cold
   * name-drop (storyrpg-lite 2026-07-05T00-09-22: the authored s1-2 turn has Stela
   * speak OF "her other friend Mika" before Mika's on-page introduction in s1-3 —
   * the treatment demands the forward reference).
   */
  plannedSceneContractText?: ReadonlyMap<string, string>;
}

export class CharacterIntroductionValidator extends BaseValidator {
  constructor() {
    super('CharacterIntroductionValidator');
  }

  validate(input: CharacterIntroductionInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const roster = buildRoster(input.story);
    if (roster.length === 0) {
      return { valid: true, score: 100, issues: [], suggestions: [] };
    }

    // Reading-order walk: episodes by number, scenes in array order.
    const orderedScenes: Array<{ episodeNumber: number; scene: Scene; rawProse: string; prose: string }> = [];
    const episodes = [...(input.story.episodes || [])].sort((a, b) => a.number - b.number);
    for (const episode of episodes) {
      for (const scene of episode.scenes || []) {
        const rawProse = sceneProse(scene);
        orderedScenes.push({ episodeNumber: episode.number, scene, rawProse, prose: normalize(rawProse) });
      }
    }

    const plannedEpisodeById = new Map<string, number>();
    for (const entry of input.characterIntroductions ?? []) {
      plannedEpisodeById.set(normalize(entry.characterId), entry.introducedInEpisode);
    }

    for (const npc of roster) {
      let firstProseIdx = -1;
      let firstCastIdx = -1;
      for (let i = 0; i < orderedScenes.length; i++) {
        if (firstProseIdx < 0 && proseNames(npc, orderedScenes[i].prose)) firstProseIdx = i;
        if (firstCastIdx < 0 && castIncludes(npc, orderedScenes[i].scene)) firstCastIdx = i;
        if (firstProseIdx >= 0 && firstCastIdx >= 0) break;
      }

      // Class 1 — cold name-drop: named in prose before any scene casts them.
      // Exception: the scene's own planned contract names this NPC — the plan
      // stages the (verbal) reference there, so it is not a cold name-drop.
      if (firstProseIdx >= 0 && (firstCastIdx < 0 || firstProseIdx < firstCastIdx)) {
        const at = orderedScenes[firstProseIdx];
        const contractText = input.plannedSceneContractText?.get(String(at.scene.id ?? ''));
        const contractNamesNpc = !!contractText && proseNames(npc, normalize(contractText));
        if (!contractNamesNpc) {
          issues.push(this.error(
            `"${npc.name}" is first named in the prose of scene "${at.scene.id}" (episode ${at.episodeNumber}) but no scene up to that point carries them in its cast — the reader has never met them and cannot know who this is.`,
            `characterIntroduction:ep${at.episodeNumber}:${at.scene.id}:${npc.id}`,
            `Introduce ${npc.name} on-page (a scene with them present in the cast and an introduction beat) before any scene's prose names them casually.`,
          ));
        }
      }

      // Class 2 — metadata-only presence: cast somewhere, never named on-page by then.
      if (firstCastIdx >= 0) {
        const at = orderedScenes[firstCastIdx];
        const namedByThen = firstProseIdx >= 0 && firstProseIdx <= firstCastIdx;
        const namedInCastScene = proseNames(npc, at.prose);
        if (!namedByThen && !namedInCastScene) {
          issues.push(this.warning(
            `"${npc.name}" first appears in the cast of scene "${at.scene.id}" (episode ${at.episodeNumber}) but the prose of that scene never names them, and no earlier scene introduced them — they exist in metadata only, not on-page.`,
            `characterIntroduction:ep${at.episodeNumber}:${at.scene.id}:${npc.id}`,
            `Have the prose of "${at.scene.id}" actually present ${npc.name}: name them and let the protagonist register who they are.`,
          ));
        }
        const firstOnPageIdx = firstProseIdx >= 0 ? Math.min(firstProseIdx, firstCastIdx) : firstCastIdx;
        if (firstOnPageIdx === firstCastIdx && namedInCastScene) {
          const newNamesInScene = roster.filter((entry) => {
            const namedHere = proseNames(entry, at.prose) || castIncludes(entry, at.scene);
            if (!namedHere) return false;
            const earlier = orderedScenes.slice(0, firstCastIdx).some((prior) => proseNames(entry, prior.prose) || castIncludes(entry, prior.scene));
            return !earlier;
          }).length;
          if (impliesOffPageFamiliarityOnFirstAppearance(at.rawProse, newNamesInScene)) {
            issues.push(this.error(
              `"${npc.name}" first appears in scene "${at.scene.id}" (episode ${at.episodeNumber}) inside prose that implies off-page familiarity or settled group belonging before the reader has met them.`,
              `characterIntroduction:ep${at.episodeNumber}:${at.scene.id}:${npc.id}:offpage-familiarity`,
              `Introduce ${npc.name} with first-contact behavior before using time-jump familiarity, group shorthand, or belonging language.`,
            ));
          }
          // Class 4 — off-page back-reference at first appearance: the name is
          // introduced via an event the reader never saw.
          const backReference = offPageBackReferenceAfterName(at.rawProse, npc.name);
          if (backReference) {
            issues.push(this.error(
              `"${npc.name}" is introduced in scene "${at.scene.id}" (episode ${at.episodeNumber}) via a back-reference to an event the reader never saw ("${backReference.slice(0, 120)}"). This is their FIRST on-page appearance — there is no earlier scene for that reference to point at.`,
              `characterIntroduction:ep${at.episodeNumber}:${at.scene.id}:${npc.id}:offpage-backreference`,
              `Introduce ${npc.name} on-page in this scene (first-contact behavior, or an in-scene identifying detail) instead of referencing an unseen prior meeting — or stage that prior meeting in an earlier scene.`,
            ));
          }
        }
      }

      // Plan drift — on-page before the plan's introduction episode.
      const plannedEpisode = plannedEpisodeById.get(normalize(npc.id)) ?? plannedEpisodeById.get(npc.fullName);
      const firstOnPageIdx = firstProseIdx >= 0 ? firstProseIdx : firstCastIdx;
      if (plannedEpisode !== undefined && firstOnPageIdx >= 0) {
        const at = orderedScenes[firstOnPageIdx];
        if (at.episodeNumber < plannedEpisode) {
          issues.push(this.warning(
            `"${npc.name}" appears in episode ${at.episodeNumber} (scene "${at.scene.id}") but the season plan introduces them in episode ${plannedEpisode}.`,
            `characterIntroduction:ep${at.episodeNumber}:${at.scene.id}:${npc.id}`,
            'Either move the appearance to the planned introduction episode or update the season plan introduction order.',
          ));
        }
      }
    }

    const errors = issues.filter((i) => i.severity === 'error').length;
    const score = Math.max(0, 100 - errors * 10 - (issues.length - errors) * 2);
    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}
