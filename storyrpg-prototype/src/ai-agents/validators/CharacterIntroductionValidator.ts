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
import type { Scene, Story } from '../../types/story';
import {
  deriveAnonymousPlantNpcIds,
  ensembleObligationsFromContractText,
  normalizeCharacterSlug,
  resolveRosterCharacter,
  type CharacterIntroMode,
  type EnsembleCastObligation,
} from '../utils/npcIntroductionLedger';
import { collectReaderFacingTexts, collectEncounterMetaTexts } from './encounterTextSurfaces';

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All reader-facing prose of one scene (beats + variants + encounter outcomes/storylets). */
function sceneProse(scene: Scene): string {
  return [
    ...collectReaderFacingTexts(scene),
    ...collectEncounterMetaTexts(scene),
  ].join(' ');
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
const FIRST_CONTACT_STAGING_RE = /\b(?:you\s+meet|meets?\s+you|offers?\s+(?:a\s+)?hand|introduces?\s+(?:herself|himself|themselves|you)|says?,?\s*["']|["'][^"']{0,80}["']\s*,?\s*(?:she|he|they)\s+says?|a\s+woman\b[^.!?]{0,80}\bsays?\b|(?:stranger|rescuer|silhouette|figure)\b[^.!?]{0,100}\b(?:says?|offers?|steps?|pulls?|grabs?|intervenes?|rescues?|saves?)|(?:man|woman)\s+in\s+(?:a\s+)?(?:charcoal|dark|black)\s+suit\b[^.!?]{0,80}\b(?:steps?|intervenes?|pulls?|rescues?|saves?|offers?))/i;
const FIRST_APPEARANCE_THIRD_PERSON_SUMMARY_RE = /\b(?:she|he)\s+(?:explores?|wanders?|arrives?|steps?|walks?)\b/i;

function hasPlayerReference(text: string): boolean {
  return /\byou\b|\byour\b|\byours\b/i.test(text);
}

function hasFirstContactStaging(rawProse: string): boolean {
  return FIRST_CONTACT_STAGING_RE.test(rawProse);
}

/** Exported for repair predicted-clear and callers that need the same staging check. */
export function sceneHasFirstContactStaging(scene: Scene): boolean {
  return hasFirstContactStaging(sceneProse(scene));
}

/** Whether scene prose names any of the given display names (full or unique first token). */
export function sceneNamesAnyCharacter(scene: Scene, npcNames: string[]): boolean {
  const normalizedProse = normalize(sceneProse(scene));
  return npcNames.some((name) => {
    const entry = { id: '', name, fullName: normalize(name) } as RosterEntry;
    const first = entry.fullName.split(' ')[0];
    if (first.length >= 3) (entry as RosterEntry).firstToken = first;
    return proseNames(entry, normalizedProse);
  });
}

/**
 * Predicted-clear for CharacterIntroductionValidator issues.
 * - anonymous-plant-leak: clear ONLY when roster name is absent (and first-contact
 *   staging present). Do NOT treat "name still present" as success.
 * - off-page-familiarity / offpage-backreference: existing off-page check.
 * - metadata-only / never-names: require naming OR (anonymous_plant) first-contact staging.
 */
export function characterIntroductionIssueCleared(
  scene: Scene,
  issue: { message?: string; location?: string; type?: string },
  opts?: { anonymousPlantNpcIds?: ReadonlySet<string>; npcId?: string },
): boolean {
  const location = String(issue.location || '');
  const message = String(issue.message || '');
  const name = /"([^"]+)"/.exec(message)?.[1];

  // Class-5 plant leak: location ends with :anonymous-plant-leak; npc id is the
  // segment before that suffix (never location.split(':').pop()).
  const isPlantLeak = location.includes(':anonymous-plant-leak')
    || /anonymous plant|scheduled as an anonymous plant|roster identity must stay hidden/i.test(message);
  if (isPlantLeak) {
    if (name && sceneNamesAnyCharacter(scene, [name])) return false;
    return sceneHasFirstContactStaging(scene);
  }

  const isOffPage = location.includes(':offpage-familiarity')
    || location.includes(':offpage-backreference')
    || /off-page familiarity|settled group belonging|back-reference/i.test(message);
  if (isOffPage) {
    if (!name) return scenePassesCharacterIntroductionOffPageCheck(scene, []);
    return scenePassesCharacterIntroductionOffPageCheck(scene, [name]);
  }
  // Metadata-only / never-names class.
  if (name && sceneNamesAnyCharacter(scene, [name])) return true;
  const npcId = opts?.npcId || parseCharacterIntroductionNpcId(location);
  const isAnonymous = (npcId && opts?.anonymousPlantNpcIds?.has(npcId))
    || (npcId && opts?.anonymousPlantNpcIds?.has(normalizeCharacterSlug(npcId)))
    || (name && opts?.anonymousPlantNpcIds && [...opts.anonymousPlantNpcIds].some((id) =>
      normalizeCharacterSlug(id) === normalizeCharacterSlug(name || '')));
  if (isAnonymous) return sceneHasFirstContactStaging(scene);
  return false;
}

/** Parse roster npc id from `characterIntroduction:epN:sceneId:npcId[:suffix]`. */
export function parseCharacterIntroductionNpcId(location: string): string | undefined {
  const parts = String(location || '').split(':');
  // characterIntroduction : epN : sceneId : npcId [ : suffix ]
  if (parts[0] !== 'characterIntroduction' || parts.length < 4) return undefined;
  const suffix = parts[parts.length - 1];
  if (
    suffix === 'anonymous-plant-leak'
    || suffix === 'offpage-familiarity'
    || suffix === 'offpage-backreference'
    || suffix === 'ensemble-obligation'
  ) {
    return parts[parts.length - 2] || undefined;
  }
  return suffix || undefined;
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
  /**
   * When true (treatment-sourced runs), metadata-only cast presence is an error:
   * an NPC in scene cast must be named on-page by that scene, not only in roster.
   * Exception: {@link anonymousPlantNpcIds} / {@link characterIntroModes} with
   * `anonymous_plant` may satisfy via first-contact staging without naming.
   */
  treatmentSourced?: boolean;
  /**
   * Roster NPC ids whose planned intro is an anonymous plant (stranger / suit /
   * rescuer staging). Class-2 cast-without-name is OK when first-contact staging
   * is present; still errors if cast with neither name nor first-contact staging.
   */
  anonymousPlantNpcIds?: ReadonlySet<string> | string[];
  /** Optional per-NPC intro mode; `anonymous_plant` entries feed the same escape hatch. */
  characterIntroModes?: ReadonlyMap<string, CharacterIntroMode> | Record<string, CharacterIntroMode>;
  /**
   * Multi-party cast obligations (e.g. "the three become friends"): each listed
   * NPC must be in the scene cast and introduced on-page (or anonymous_plant
   * first-contact) by that scene. Derived from planned contract text when omitted.
   */
  ensembleObligations?: EnsembleCastObligation[];
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

    const anonymousPlantIds = new Set<string>();
    const addAnonymous = (idOrName: string) => {
      const slug = normalizeCharacterSlug(idOrName);
      if (slug) anonymousPlantIds.add(slug);
    };
    if (input.anonymousPlantNpcIds) {
      for (const id of input.anonymousPlantNpcIds) addAnonymous(id);
    }
    if (input.characterIntroModes) {
      const modes = input.characterIntroModes instanceof Map
        ? input.characterIntroModes
        : new Map(Object.entries(input.characterIntroModes));
      for (const [id, mode] of modes) {
        if (mode === 'anonymous_plant') addAnonymous(id);
      }
    }
    // Derive from planned contract text when callers don't pass an explicit set.
    // Schedule-aware: first named staging wins; unbound stranger text does not
    // plant the full roster (requires candidate linkage — empty here without
    // per-scene cast, so only explicit named→skip / no false plants).
    if (anonymousPlantIds.size === 0 && input.plannedSceneContractText) {
      const scenes = [...input.plannedSceneContractText.entries()].map(([sceneId, contractText]) => ({
        sceneId,
        contractText,
        candidateIds: [] as string[],
      }));
      for (const id of deriveAnonymousPlantNpcIds({
        roster: roster.map((n) => ({ id: n.id, name: n.name })),
        scenes,
      })) {
        addAnonymous(id);
      }
    }
    const isAnonymousPlant = (npc: RosterEntry): boolean =>
      anonymousPlantIds.has(normalizeCharacterSlug(npc.id))
      || anonymousPlantIds.has(normalizeCharacterSlug(npc.name))
      || anonymousPlantIds.has(npc.fullName.replace(/\s+/g, '-'));

    // Reading-order walk: episodes by number, scenes in array order.
    const orderedScenes: Array<{ episodeNumber: number; scene: Scene; rawProse: string; prose: string }> = [];
    const episodes = [...(input.story.episodes || [])].sort((a, b) => a.number - b.number);
    for (const episode of episodes) {
      for (const scene of episode.scenes || []) {
        const rawProse = sceneProse(scene);
        orderedScenes.push({ episodeNumber: episode.number, scene, rawProse, prose: normalize(rawProse) });
      }
    }

    // Class 5 — anonymous_plant hard-info leak: roster name appears on ANY reader
    // surface before a scheduled named reveal (first cast scene that names them,
    // or any later scene). Treatment-sourced → error.
    if (anonymousPlantIds.size > 0) {
      for (const npc of roster) {
        if (!isAnonymousPlant(npc)) continue;
        let firstNamedIdx = -1;
        let firstPlantIdx = -1;
        for (let i = 0; i < orderedScenes.length; i++) {
          const at = orderedScenes[i];
          const named = proseNames(npc, at.prose);
          const cast = castIncludes(npc, at.scene);
          if (firstNamedIdx < 0 && named) firstNamedIdx = i;
          if (firstPlantIdx < 0 && cast && hasFirstContactStaging(at.rawProse) && !named) firstPlantIdx = i;
        }
        // Leak: named in prose at/before the plant scene, or named with no prior
        // anonymous first-contact plant when this NPC is scheduled as anonymous.
        if (firstNamedIdx >= 0) {
          const namedAt = orderedScenes[firstNamedIdx];
          const plantOk = firstPlantIdx >= 0 && firstPlantIdx < firstNamedIdx;
          // Naming at first cast without prior plant is OK only if that scene is
          // the reveal — but anonymous_plant mode forbids naming until reveal.
          // Any naming while still in anonymous_plant schedule (no earlier plant
          // OR naming in the plant scene itself) is a hard-info leak.
          if (!plantOk) {
            const message =
              `"${npc.name}" is named in reader-facing prose of scene "${namedAt.scene.id}" (episode ${namedAt.episodeNumber}) while scheduled as an anonymous plant — roster identity must stay hidden until the reveal scene.`;
            const location = `characterIntroduction:ep${namedAt.episodeNumber}:${namedAt.scene.id}:${npc.id}:anonymous-plant-leak`;
            const suggestion =
              `Keep ${npc.name} anonymous on all reader surfaces (beats, encounter outcomes, storylets, aftermath) until the planned reveal; use stranger/visual descriptors only.`;
            issues.push(input.treatmentSourced
              ? this.error(message, location, suggestion)
              : this.warning(message, location, suggestion));
          }
        }
      }
    }

    // Class 6 — multi-party ensemble cast obligation.
    const ensembleObligations = input.ensembleObligations?.length
      ? input.ensembleObligations
      : (input.plannedSceneContractText
        ? ensembleObligationsFromContractText({
            plannedSceneContractText: input.plannedSceneContractText,
            roster: roster.map((n) => ({ id: n.id, name: n.name })),
          })
        : []);
    for (const obligation of ensembleObligations) {
      const sceneEntry = orderedScenes.find((entry) => String(entry.scene.id) === String(obligation.sceneId));
      if (!sceneEntry) continue;
      for (const npcId of obligation.requiredNpcIds) {
        const resolved = resolveRosterCharacter(npcId, roster.map((n) => ({ id: n.id, name: n.name })));
        const npc = roster.find((entry) =>
          normalizeCharacterSlug(entry.id) === normalizeCharacterSlug(resolved?.id || npcId)
          || normalizeCharacterSlug(entry.name) === normalizeCharacterSlug(resolved?.name || npcId)
        );
        if (!npc) continue;
        const inCast = castIncludes(npc, sceneEntry.scene);
        const named = proseNames(npc, sceneEntry.prose);
        const anonymousOk = isAnonymousPlant(npc) && hasFirstContactStaging(sceneEntry.rawProse);
        // Prior introduction counts: named/cast in an earlier scene.
        const sceneIdx = orderedScenes.indexOf(sceneEntry);
        const introducedEarlier = orderedScenes.slice(0, sceneIdx).some((prior) =>
          proseNames(npc, prior.prose) || castIncludes(npc, prior.scene)
        );
        if (inCast && (named || anonymousOk || introducedEarlier)) continue;
        if (!inCast || (!named && !anonymousOk && !introducedEarlier)) {
          const message = !inCast
            ? `Multi-party obligation in scene "${obligation.sceneId}" requires "${npc.name}" in the cast (from: "${obligation.sourceText.slice(0, 120)}"), but they are missing from charactersInvolved.`
            : `Multi-party obligation in scene "${obligation.sceneId}" requires "${npc.name}" on-page (named or anonymous first-contact), but the prose never stages them.`;
          const location = `characterIntroduction:ep${sceneEntry.episodeNumber}:${obligation.sceneId}:${npc.id}:ensemble-obligation`;
          const suggestion = !inCast
            ? `Add ${npc.name} to the cast of "${obligation.sceneId}" and introduce them on-page before the group-formation beat.`
            : `Stage ${npc.name} on-page in "${obligation.sceneId}" (name them, or anonymous_plant first-contact if scheduled).`;
          issues.push(input.treatmentSourced
            ? this.error(message, location, suggestion)
            : this.warning(message, location, suggestion));
        }
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
      // Named intro expectation: treatment-sourced → ERROR when never named.
      // anonymous_plant: OK if first-contact staging is present; still ERROR if
      // cast with neither name nor first-contact staging.
      if (firstCastIdx >= 0) {
        const at = orderedScenes[firstCastIdx];
        const namedByThen = firstProseIdx >= 0 && firstProseIdx <= firstCastIdx;
        const namedInCastScene = proseNames(npc, at.prose);
        if (!namedByThen && !namedInCastScene) {
          const anonymousOk = isAnonymousPlant(npc) && hasFirstContactStaging(at.rawProse);
          if (!anonymousOk) {
            const message =
              `"${npc.name}" first appears in the cast of scene "${at.scene.id}" (episode ${at.episodeNumber}) but the prose of that scene never names them, and no earlier scene introduced them — they exist in metadata only, not on-page.`;
            const location = `characterIntroduction:ep${at.episodeNumber}:${at.scene.id}:${npc.id}`;
            const suggestion = isAnonymousPlant(npc)
              ? `Stage ${npc.name} as an anonymous first-contact plant in "${at.scene.id}" (stranger/visual cues, no roster name yet) or name them on-page if this is a named intro.`
              : `Have the prose of "${at.scene.id}" actually present ${npc.name}: name them and let the protagonist register who they are.`;
            // Treatment-sourced runs: second-lead plants that stay anonymous break
            // season payoffs — promote to blocking. Non-treatment stays advisory.
            // anonymous_plant with first-contact staging already escaped above.
            issues.push(input.treatmentSourced
              ? this.error(message, location, suggestion)
              : this.warning(message, location, suggestion));
          }
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
