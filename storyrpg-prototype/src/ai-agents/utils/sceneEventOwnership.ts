import type {
  AuthoredTreatmentFieldContract,
  PlannedScene,
  RequiredBeat,
  SceneConstructionProfile,
  SceneEventOwnershipCue,
  SceneEventOwnershipProfile,
  SceneOwnedEvent,
  SceneTurnContract,
  StoryCircleBeatRealizationContract,
} from '../../types/scenePlan';
import {
  detectPrimaryStoryEventCues,
  STORY_EVENT_CUE_ORDER,
  type StoryEventCue,
} from '../remediation/storyEventCues';
import { isGateEnabled } from '../remediation/gateDefaults';
import { isGenericPlannerTurnScaffold } from './sceneContractBuilders';

export interface SceneEventOwnershipSceneLike {
  id?: string;
  episodeNumber?: number;
  order?: number;
  kind?: string;
  isEncounter?: boolean;
  name?: string;
  title?: string;
  description?: string;
  location?: string;
  timeOfDay?: string;
  dramaticPurpose?: string;
  narrativeFunction?: string;
  requiredBeats?: RequiredBeat[];
  turnContract?: SceneTurnContract;
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
  authoredTreatmentFields?: AuthoredTreatmentFieldContract[];
  sceneConstructionProfile?: SceneConstructionProfile;
  ownedChronologyKeys?: string[];
  sceneEventOwnership?: SceneEventOwnershipProfile;
}

export interface SceneEventOwnershipDiagnostic {
  sceneId?: string;
  episodeNumber?: number;
  severity: 'error' | 'warning';
  message: string;
}

const ROUTE_CUE_ORDER: Partial<Record<SceneEventOwnershipCue, number>> = {
  ...STORY_EVENT_CUE_ORDER,
  walkHome: 60,
};

const DUPLICATE_SENSITIVE_CUES = new Set<SceneEventOwnershipCue>([
  'venueDoor',
  'objectHandoff',
  'threatEncounter',
  'walkHome',
  // First contact from the hidden watcher is a one-time reveal (bite-me
  // 2026-07-03 staged it fresh in three scenes).
  'antagonistContact',
  'blogAftermath',
]);
const CANONICAL_CUE_KEYS = new Set<SceneEventOwnershipCue>([
  'arrival',
  'venueDoor',
  'objectHandoff',
  'socialMeet',
  'threatEncounter',
  'walkHome',
  'roadBreakdown',
  'friendDebrief',
  'lateNightWriting',
  'antagonistContact',
  'blogAftermath',
  'endingAftermath',
]);

/**
 * Causal cue prerequisites that must be owned earlier than their dependents.
 * Keep in sync with SceneOwnershipPreflightValidator.CAUSAL_CUE_PREREQUISITES.
 */
export const CAUSAL_CUE_OWNERSHIP_PREREQUISITES: ReadonlyArray<readonly [SceneEventOwnershipCue, readonly SceneEventOwnershipCue[]]> = [
  ['blogAftermath', ['lateNightWriting']],
];

const WALK_HOME_ESCORT_RE = /\b[A-Z][a-z]+\b[^.!?\n]{0,180}\b(?:walks?|guides?|escorts?)\b[^.!?\n]{0,80}\bhome\b/i;
// Escort body-language alone is a romance-prose staple — gestures only count
// as walk-home when the text also moves toward a dwelling (keep in sync with
// RouteContinuityValidator walkHomeCueFires).
const WALK_HOME_GESTURE_RE = /\b(?:small of your back|guiding you away|under your heels)\b/i;
const WALK_HOME_CONTEXT_RE = /\b(?:walk(?:s|ing)?|home|door(?:step|way)?|threshold|apartment|building|stairs|street|park|alley|pavement|sidewalk|escort(?:s|ing)?|guid(?:es|ing)|steer(?:s|ing)|toward)\b/i;
// Determiner+"walk home" noun phrases are recounting references, not stagings
// (keep in sync with RouteContinuityValidator WALK_HOME_NOUN_PHRASE).
const WALK_HOME_NOUN_PHRASE_RE = /\b(?:the|a|an|that|this|her|his|their|our|my|your|its)\s+walk\s+home\b/gi;

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Canonical route-chronology rank of a cue (exported for the season-plan order repair). */
export function eventOrder(cue: SceneEventOwnershipCue): number {
  return ROUTE_CUE_ORDER[cue] ?? 999;
}

function isHardBeat(beat: RequiredBeat): boolean {
  return beat.tier === 'authored' || beat.tier === 'signature' || beat.tier === 'coldopen';
}

/** Remove authored beats on post-encounter scenes that would regress route-cue order. */
export function stripRegressiveAuthoredBeats(scenes: PlannedScene[]): number {
  let stripped = 0;
  const sorted = [...scenes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const encounterIndex = sorted.findIndex((scene) => scene.kind === 'encounter');
  const THREAT_ORDER = eventOrder('threatEncounter');

  const stripEarlyBeats = (scene: PlannedScene) => {
    const beats = scene.requiredBeats ?? [];
    const kept = beats.filter((beat) => {
      if (!isHardBeat(beat)) return true;
      const text = cleanText(beat.mustDepict || beat.sourceTurn);
      const cues = detectPrimaryStoryEventCues(text);
      if (cues.size === 0) return true;
      const minOrder = Math.min(...[...cues].map((cue) => eventOrder(cue)));
      if (minOrder >= THREAT_ORDER) return true;
      stripped += 1;
      return false;
    });
    if (kept.length !== beats.length) scene.requiredBeats = kept;
  };

  if (encounterIndex >= 0) {
    for (let i = encounterIndex + 1; i < sorted.length; i += 1) {
      stripEarlyBeats(sorted[i]);
    }
    return stripped;
  }

  let maxCueOrder = -1;
  for (const scene of sorted) {
    const beats = scene.requiredBeats ?? [];
    const kept = beats.filter((beat) => {
      if (!isHardBeat(beat)) return true;
      const text = cleanText(beat.mustDepict || beat.sourceTurn);
      const cues = detectPrimaryStoryEventCues(text);
      if (cues.size === 0) return true;
      const minOrder = Math.min(...[...cues].map((cue) => eventOrder(cue)));
      if (minOrder < maxCueOrder) {
        stripped += 1;
        return false;
      }
      return true;
    });
    if (kept.length !== beats.length) scene.requiredBeats = kept;
    for (const beat of kept) {
      if (!isHardBeat(beat)) continue;
      const cues = detectPrimaryStoryEventCues(cleanText(beat.mustDepict || beat.sourceTurn));
      for (const cue of cues) maxCueOrder = Math.max(maxCueOrder, eventOrder(cue));
    }
  }
  return stripped;
}

type OwnershipSourceText = {
  id: string;
  text: string;
  source?: SceneConstructionProfile['obligations'][number]['source'] | 'sceneTurn';
  slot?: SceneConstructionProfile['obligations'][number]['slot'] | 'primary_turn';
};

function activeProfileTexts(profile: SceneConstructionProfile | undefined): OwnershipSourceText[] {
  if (!profile) return [];
  const active = profile.obligations
    .filter((item) => item.slot === 'primary_turn' || item.slot === 'must_stage' || item.slot === 'must_support')
    .map((item) => ({ id: item.id, text: item.text, source: item.source, slot: item.slot }));
  return [
    { id: profile.primaryTurn.id, text: profile.primaryTurn.text, source: profile.primaryTurn.source, slot: 'primary_turn' },
    ...active,
  ];
}

function contractTexts(scene: SceneEventOwnershipSceneLike): OwnershipSourceText[] {
  const out: OwnershipSourceText[] = [];
  const profileTexts = activeProfileTexts(scene.sceneConstructionProfile);
  if (profileTexts.length > 0) {
    for (const item of profileTexts) {
      if (cleanText(item.text)) out.push(item);
    }
    for (const key of scene.ownedChronologyKeys ?? []) {
      out.push({ id: `chronology:${key}`, text: key, slot: 'primary_turn' });
    }
    return out.filter((item) => cleanText(item.text));
  }
  const turn = scene.turnContract;
  if (turn) {
    out.push({ id: turn.turnId || `${scene.id ?? 'scene'}-turn`, text: [...new Set([turn.centralTurn, turn.turnEvent].map(cleanText).filter(Boolean))].join(' '), slot: 'primary_turn' });
  }
  for (const beat of scene.requiredBeats ?? []) {
    if (!isHardBeat(beat)) continue;
    out.push({ id: beat.id, text: cleanText(beat.mustDepict || beat.sourceTurn) });
  }
  for (const contract of scene.storyCircleBeatContracts ?? []) {
    for (const atom of contract.eventAtoms ?? []) out.push({ id: `${contract.id}:atom`, text: atom });
    out.push({ id: contract.id, text: contract.sourceText });
  }
  for (const field of scene.authoredTreatmentFields ?? []) {
    out.push({ id: field.id, text: [field.fieldName, field.sourceText, field.requiredRealization.join(' ')].map(cleanText).filter(Boolean).join(' ') });
  }
  for (const key of scene.ownedChronologyKeys ?? []) {
    out.push({ id: `chronology:${key}`, text: key });
  }
  return out.filter((item) => cleanText(item.text));
}

function cuesFor(text: string): SceneEventOwnershipCue[] {
  const cues = new Set<SceneEventOwnershipCue>();
  for (const cue of detectPrimaryStoryEventCues(text)) cues.add(cue as StoryEventCue);
  const walkText = text.replace(WALK_HOME_NOUN_PHRASE_RE, ' ');
  if (WALK_HOME_ESCORT_RE.test(walkText) || (WALK_HOME_GESTURE_RE.test(walkText) && WALK_HOME_CONTEXT_RE.test(walkText))) cues.add('walkHome');
  return [...cues].sort((a, b) => eventOrder(a) - eventOrder(b));
}

function eventKey(cue: SceneEventOwnershipCue): string {
  return `cue:${cue}`;
}

function makeOwnedEvent(scene: SceneEventOwnershipSceneLike, cue: SceneEventOwnershipCue, text: string, sourceContractIds: string[]): SceneOwnedEvent {
  return {
    key: eventKey(cue),
    cue,
    text: cleanText(text) || cue,
    sourceContractIds: sourceContractIds.length ? Array.from(new Set(sourceContractIds)) : [`${scene.id ?? 'scene'}:${cue}`],
  };
}

function mergeEvents(events: SceneOwnedEvent[]): SceneOwnedEvent[] {
  const byKey = new Map<string, SceneOwnedEvent>();
  for (const event of events) {
    const existing = byKey.get(event.key);
    if (!existing) {
      byKey.set(event.key, { ...event, sourceContractIds: [...event.sourceContractIds] });
      continue;
    }
    existing.sourceContractIds = Array.from(new Set([...existing.sourceContractIds, ...event.sourceContractIds]));
    if (event.text.length > existing.text.length) existing.text = event.text;
  }
  return [...byKey.values()].sort((a, b) => eventOrder(a.cue) - eventOrder(b.cue));
}

function primaryCuesForScene(scene: SceneEventOwnershipSceneLike, sourceTexts: OwnershipSourceText[]): Set<SceneEventOwnershipCue> {
  const primaryTexts = sourceTexts.filter((source) => source.slot === 'primary_turn').map((source) => source.text);
  const turn = scene.sceneConstructionProfile ? undefined : scene.turnContract;
  if (turn) primaryTexts.push(turn.centralTurn, turn.turnEvent);
  const primary = new Set<SceneEventOwnershipCue>();
  for (const text of primaryTexts) {
    if (isGenericPlannerTurnScaffold(text)) continue;
    for (const cue of cuesFor(cleanText(text))) primary.add(cue);
  }
  return primary;
}

function ownershipCuesForSource(
  source: OwnershipSourceText,
  primaryCues: Set<SceneEventOwnershipCue>,
): SceneEventOwnershipCue[] {
  if (source.id.startsWith('chronology:') && CANONICAL_CUE_KEYS.has(source.text as SceneEventOwnershipCue)) {
    return [source.text as SceneEventOwnershipCue];
  }
  // A generic planner scaffold turn ("Let the fallout settle into the next
  // pressure: <whole-episode summary>…") is not an event — the same rule
  // SceneTurnRealizationValidator and encounterTurnRealizationGuard already
  // apply. Detecting cues in it grants a filler scene ownership of events the
  // episode SUMMARY mentions (bite-me 2026-07-04: release scene s1-6 "owned"
  // arrival/socialMeet/lateNightWriting off its planner turn, so the route-cue
  // order repair moved it ahead of s1-5 — fan-recognition before the blog
  // exists, a blocking QA timeline error).
  if (isGenericPlannerTurnScaffold(source.text)) return [];
  const cues = cuesFor(source.text);
  if (source.slot === 'primary_turn' || source.slot === 'must_stage') return cues;
  if (source.slot !== 'must_support' || cues.length === 0 || primaryCues.size === 0) return [];
  if (isAbstractSupportSource(source)) return [];
  const filtered = cues.filter((cue) => primaryCues.has(cue));
  return filtered.length === cues.length ? filtered : [];
}

function isAbstractSupportSource(source: OwnershipSourceText): boolean {
  if (source.slot !== 'must_support') return false;
  return source.source === 'storyCircle'
    || source.source === 'arcPressure'
    || source.source === 'seasonPromise'
    || source.source === 'stakesArchitecture'
    || source.source === 'mechanicPressure'
    || source.source === 'relationshipPacing'
    || source.source === 'branchConsequence'
    || source.source === 'endingRealization'
    || source.source === 'failureModeAudit'
    || source.source === 'characterTreatment'
    || source.source === 'worldTreatment'
    || source.source === 'setupPayoff'
    || source.source === 'choicePressure'
    || source.source === 'coldOpenProfile';
}

export function compileSceneEventOwnershipProfile<T extends SceneEventOwnershipSceneLike>(
  scene: T,
  previousOwnedEvents: SceneOwnedEvent[],
  options: { episodeNumber?: number } = {},
): SceneEventOwnershipProfile {
  const sourceTexts = contractTexts(scene);
  const primaryCues = primaryCuesForScene(scene, sourceTexts);
  const owned: SceneOwnedEvent[] = [];
  for (const source of sourceTexts) {
    const cues = ownershipCuesForSource(source, primaryCues);
    for (const cue of cues) {
      owned.push(makeOwnedEvent(scene, cue, source.text, [source.id]));
    }
  }

  const ownedEvents = mergeEvents(owned);
  const incomingContext = mergeEvents(previousOwnedEvents);
  const forbiddenRestageEvents = incomingContext.filter((event) => DUPLICATE_SENSITIVE_CUES.has(event.cue));
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  for (const event of ownedEvents) {
    if (seen.has(event.key)) continue;
    seen.add(event.key);
    const earlier = incomingContext.find((candidate) => candidate.key === event.key);
    if (earlier && DUPLICATE_SENSITIVE_CUES.has(event.cue)) {
      diagnostics.push(`Scene "${scene.id ?? 'scene'}" also owns ${event.cue}, already owned by an earlier scene; route later references as aftermath instead of restaging.`);
    }
  }

  return {
    id: `${scene.id ?? slug(scene.name || scene.title || 'scene')}-event-ownership`,
    episodeNumber: options.episodeNumber ?? scene.episodeNumber,
    sceneId: scene.id ?? 'scene',
    ownedEvents,
    incomingContext,
    outgoingResidue: ownedEvents,
    forbiddenRestageEvents,
    sourceContractIds: Array.from(new Set(ownedEvents.flatMap((event) => event.sourceContractIds))),
    diagnostics,
    promptGuidance: [
      'Dramatize owned events on-page in this scene.',
      'Treat incoming context as already happened; use it only as recap, consequence, or residue.',
      'Do not restage forbidden events here. If they matter, show aftermath instead.',
    ],
  };
}

export function attachSceneEventOwnershipProfiles<T extends SceneEventOwnershipSceneLike>(
  scenes: T[],
  options: { episodeNumber?: number } = {},
): SceneEventOwnershipDiagnostic[] {
  const diagnostics: SceneEventOwnershipDiagnostic[] = [];
  const demoteToAftermath = isGateEnabled('GATE_OWNERSHIP_AFTERMATH_DEMOTION');
  const encounterIndex = scenes.findIndex((entry) => entry.kind === 'encounter' || entry.isEncounter);
  let previousOwnedEvents: SceneOwnedEvent[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const profile = compileSceneEventOwnershipProfile(scene, previousOwnedEvents, options);
    // Deterministic demote-to-aftermath repair (bite-me 2026-07-04: five of
    // twelve Ep1 runs hard-aborted at SceneConstructionGate on duplicate
    // ownership with NO retry path — the planned blueprint is deterministic,
    // so regenerating reproduces the identical conflict). When a later,
    // non-encounter-capable scene "owns" a duplicate-sensitive event an
    // earlier scene already owns, it could never legally stage it anyway:
    // drop it from ownership and let the existing forbidden-restage /
    // incoming-context machinery route the reference as aftermath — exactly
    // what the gate's own diagnostic instructs. Kill-switch:
    // GATE_OWNERSHIP_AFTERMATH_DEMOTION=0 restores the hard-abort behavior.
    if (demoteToAftermath && scene.kind !== 'encounter' && !scene.isEncounter) {
      const incomingKeys = new Set(profile.incomingContext.map((event) => event.key));
      const demoted = profile.ownedEvents.filter(
        (event) => DUPLICATE_SENSITIVE_CUES.has(event.cue) && incomingKeys.has(event.key),
      );
      if (demoted.length > 0) {
        const demotedKeys = new Set(demoted.map((event) => event.key));
        profile.ownedEvents = profile.ownedEvents.filter((event) => !demotedKeys.has(event.key));
        profile.outgoingResidue = profile.outgoingResidue.filter((event) => !demotedKeys.has(event.key));
        profile.diagnostics = profile.diagnostics.filter(
          (message) => !demoted.some((event) => message.includes(`also owns ${event.cue}`)),
        );
        for (const event of demoted) {
          const message = `Demoted duplicate ownership of ${event.cue} on scene "${profile.sceneId}" to aftermath; an earlier scene owns it and this scene is not encounter-capable.`;
          console.info(`[SceneEventOwnership] ${message}`);
          diagnostics.push({
            sceneId: scene.id,
            episodeNumber: profile.episodeNumber,
            severity: 'warning',
            message,
          });
        }
      }
      if (encounterIndex >= 0 && sceneIndex > encounterIndex && previousOwnedEvents.length > 0) {
        const maxPreviousOrder = Math.max(...previousOwnedEvents.map((event) => eventOrder(event.cue)));
        // If an earlier scene already owns a causal dependent (e.g. blogAftermath),
        // do not demote this scene's prerequisite (lateNightWriting) as regressive —
        // that is a chronology inversion for repairCausalCueOwnershipOrder to fix,
        // not an aftermath restage (bite-me 2026-07-09).
        const regressed = profile.ownedEvents.filter((event) => {
          if (eventOrder(event.cue) >= maxPreviousOrder) return false;
          for (const [dependent, prerequisites] of CAUSAL_CUE_OWNERSHIP_PREREQUISITES) {
            if (
              prerequisites.includes(event.cue)
              && previousOwnedEvents.some((prior) => prior.cue === dependent)
            ) {
              return false;
            }
          }
          return true;
        });
        if (regressed.length > 0) {
          const regressedKeys = new Set(regressed.map((event) => event.key));
          profile.ownedEvents = profile.ownedEvents.filter((event) => !regressedKeys.has(event.key));
          profile.outgoingResidue = profile.outgoingResidue.filter((event) => !regressedKeys.has(event.key));
          profile.diagnostics = profile.diagnostics.filter(
            (message) => !regressed.some((event) => message.includes(`also owns ${event.cue}`)),
          );
          for (const event of regressed) {
            const message = `Demoted regressive ownership of ${event.cue} on scene "${profile.sceneId}" to aftermath; route chronology already advanced past order ${maxPreviousOrder}.`;
            console.info(`[SceneEventOwnership] ${message}`);
            diagnostics.push({
              sceneId: scene.id,
              episodeNumber: profile.episodeNumber,
              severity: 'warning',
              message,
            });
          }
        }
      }
    }
    scene.sceneEventOwnership = profile;
    previousOwnedEvents = mergeEvents([...previousOwnedEvents, ...profile.ownedEvents]);
    for (const message of profile.diagnostics) {
      diagnostics.push({
        sceneId: scene.id,
        episodeNumber: profile.episodeNumber,
        severity: 'error',
        message,
      });
    }
  });
  diagnostics.push(...validateSceneEventOwnershipPlan(scenes, options));
  return diagnostics;
}

export function validateSceneEventOwnershipPlan<T extends SceneEventOwnershipSceneLike>(
  scenes: T[],
  options: { episodeNumber?: number } = {},
): SceneEventOwnershipDiagnostic[] {
  const diagnostics: SceneEventOwnershipDiagnostic[] = [];
  const firstOwnerByKey = new Map<string, { scene: T; event: SceneOwnedEvent; index: number }>();
  let previous: { scene: T; event: SceneOwnedEvent; index: number } | undefined;

  scenes.forEach((scene, index) => {
    for (const event of scene.sceneEventOwnership?.ownedEvents ?? []) {
      const current = { scene, event, index };
      const first = firstOwnerByKey.get(event.key);
      if (first && first.scene.id !== scene.id && !DUPLICATE_SENSITIVE_CUES.has(event.cue)) {
        continue;
      }
      if (previous && eventOrder(event.cue) < eventOrder(previous.event.cue)) {
        diagnostics.push({
          sceneId: scene.id,
          episodeNumber: options.episodeNumber ?? scene.episodeNumber,
          severity: 'error',
          message: `Scene "${scene.id ?? index}" owns ${event.cue} after earlier scene "${previous.scene.id ?? previous.index}" owns ${previous.event.cue}; route event ownership is out of order.`,
        });
      }
      previous = current;
      if (first && first.scene.id !== scene.id && DUPLICATE_SENSITIVE_CUES.has(event.cue)) {
        diagnostics.push({
          sceneId: scene.id,
          episodeNumber: options.episodeNumber ?? scene.episodeNumber,
          severity: 'error',
          message: `Scene "${scene.id ?? index}" duplicates ownership of ${event.cue}; first owner is "${first.scene.id ?? first.index}".`,
        });
      } else {
        firstOwnerByKey.set(event.key, current);
      }
    }
  });

  return diagnostics;
}

/**
 * Causal cue prerequisites that must be owned earlier than their dependents.
 * Keep in sync with SceneOwnershipPreflightValidator.CAUSAL_CUE_PREREQUISITES.
 * (Canonical export lives above attachSceneEventOwnershipProfiles.)
 */
const DEFAULT_LATE_NIGHT_WRITING_TURN =
  'At 4am the protagonist writes the first anonymous public post under a codename.';

function sceneOwnsCue(scene: SceneEventOwnershipSceneLike, cue: SceneEventOwnershipCue): boolean {
  return (scene.sceneEventOwnership?.ownedEvents ?? []).some((event) => event.cue === cue);
}

function scenePrimaryCueText(scene: SceneEventOwnershipSceneLike): string {
  return [
    scene.sceneConstructionProfile?.primaryTurn?.text,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.dramaticPurpose,
    scene.narrativeFunction,
    scene.description,
    scene.title,
    scene.name,
    ...(scene.requiredBeats ?? []).filter(isHardBeat).map((beat) => beat.mustDepict || beat.sourceTurn),
  ].map(cleanText).filter(Boolean).join(' ');
}

function sceneLooksLikeWritingOwner(scene: SceneEventOwnershipSceneLike): boolean {
  if (sceneOwnsCue(scene, 'lateNightWriting')) return true;
  if (sceneOwnsCue(scene, 'blogAftermath')) return false;
  const cues = detectPrimaryStoryEventCues(scenePrimaryCueText(scene));
  return cues.has('lateNightWriting') && !cues.has('blogAftermath');
}

function sceneLooksLikeBlogAftermath(scene: SceneEventOwnershipSceneLike): boolean {
  if (sceneOwnsCue(scene, 'blogAftermath')) return true;
  const id = cleanText(scene.id);
  if (/^s\d+-blog-aftermath$/i.test(id)) return true;
  const cues = detectPrimaryStoryEventCues(scenePrimaryCueText(scene));
  return cues.has('blogAftermath') && !cues.has('lateNightWriting');
}

function isSyntheticBlogAftermathHelper(scene: SceneEventOwnershipSceneLike): boolean {
  const origin = (scene as { planningOrigin?: { kind?: string; splitKind?: string } }).planningOrigin;
  if (origin?.kind === 'binder_split'
    && (origin.splitKind === 'viral_aftermath' || origin.splitKind === 'public_blog_aftermath')) {
    return true;
  }
  return /^s\d+-blog-aftermath$/i.test(cleanText(scene.id));
}

function extractWritingSeedText(aftermath: SceneEventOwnershipSceneLike): string {
  const candidates = [
    ...(aftermath.requiredBeats ?? []).map((beat) => beat.mustDepict || beat.sourceTurn),
    aftermath.turnContract?.centralTurn,
    aftermath.turnContract?.turnEvent,
    aftermath.dramaticPurpose,
    aftermath.description,
  ].map(cleanText).filter(Boolean);
  for (const text of candidates) {
    if (detectPrimaryStoryEventCues(text).has('lateNightWriting')) return text;
  }
  return DEFAULT_LATE_NIGHT_WRITING_TURN;
}

function makeLateNightWritingScene<T extends SceneEventOwnershipSceneLike>(
  template: T,
  episodeNumber: number,
  order: number,
  writingText: string,
): T {
  const id = `s${episodeNumber}-late-night-writing`;
  const base = {
    id,
    episodeNumber,
    order,
    kind: 'standard',
    title: 'Late-night writing',
    name: 'Late-night writing',
    description: writingText,
    dramaticPurpose: writingText,
    narrativeFunction: writingText,
    narrativeRole: 'development',
    location: (template as { location?: string }).location || 'Apartment',
    locations: (template as { locations?: string[] }).locations?.length
      ? [...((template as { locations?: string[] }).locations ?? [])]
      : ['Apartment'],
    mood: (template as { mood?: string }).mood || 'intimate',
    purpose: 'transition' as const,
    dramaticQuestion: 'Will the private night become public testimony?',
    wantVsNeed: 'Want: process the night. Need: claim authorship.',
    conflictEngine: 'Exhaustion and the urge to publish collide.',
    npcsPresent: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    keyBeats: [writingText],
    leadsTo: [],
    spineUnitId: undefined,
    requiredBeats: [{
      id: `${id}-writing`,
      sourceTurn: writingText,
      mustDepict: writingText,
      tier: 'authored' as const,
    }],
    ownedChronologyKeys: ['lateNightWriting'],
    planningOrigin: {
      kind: 'binder_split' as const,
      splitKind: 'late_night_writing' as const,
      parentSceneId: template.id,
      reason: 'Inserted lateNightWriting owner so blogAftermath cannot precede its causal prerequisite.',
    },
    turnContract: {
      turnId: `${id}-turn`,
      source: 'treatment' as const,
      centralTurn: writingText,
      beforeState: 'The night is still private.',
      turnEvent: writingText,
      afterState: 'Private experience has become a public post.',
      handoff: 'Hand public attention forward without restaging the writing moment.',
    },
  };
  return base as unknown as T;
}

function renormalizeSceneOrders<T extends SceneEventOwnershipSceneLike>(scenes: T[]): void {
  scenes.forEach((scene, index) => {
    scene.order = index;
  });
}

type TransitionOutLike = {
  toSceneId: string;
  connector?: 'therefore' | 'but';
  causalLink?: string;
  pressureChange?: string;
};

function syncTransitionOutForLeadsTo(
  scene: { leadsTo?: string[]; transitionOut?: TransitionOutLike[] | TransitionOutLike; name?: string; title?: string; description?: string; dramaticPurpose?: string },
): void {
  const leadsTo = Array.isArray(scene.leadsTo) ? scene.leadsTo : [];
  if (!('transitionOut' in scene) && leadsTo.length === 0) return;
  const existing = Array.isArray(scene.transitionOut)
    ? scene.transitionOut
    : scene.transitionOut
      ? [scene.transitionOut]
      : [];
  const byTarget = new Map(
    existing
      .filter((transition) => transition?.toSceneId)
      .map((transition) => [transition.toSceneId, transition]),
  );
  const fromLabel = cleanText(scene.name || scene.title || scene.dramaticPurpose || scene.description || 'this scene') || 'this scene';
  scene.transitionOut = leadsTo.map((toSceneId) => {
    const existingTransition = byTarget.get(toSceneId);
    if (existingTransition?.causalLink && existingTransition?.pressureChange) {
      return {
        ...existingTransition,
        toSceneId,
        connector: existingTransition.connector === 'but' ? 'but' : 'therefore',
      };
    }
    return {
      toSceneId,
      connector: existingTransition?.connector === 'but' ? 'but' : 'therefore',
      causalLink: existingTransition?.causalLink
        || `${fromLabel} changes the situation, therefore ${toSceneId} becomes necessary.`,
      pressureChange: existingTransition?.pressureChange
        || `${fromLabel} escalates into the pressure of ${toSceneId}.`,
    };
  });
}

function repairSequentialLeadsTo<T extends SceneEventOwnershipSceneLike>(scenes: T[]): void {
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index] as T & {
      leadsTo?: string[];
      transitionOut?: TransitionOutLike[] | TransitionOutLike;
    };
    if (!Array.isArray(scene.leadsTo)) continue;
    const next = scenes[index + 1];
    if (!next?.id) {
      scene.leadsTo = [];
      syncTransitionOutForLeadsTo(scene);
      continue;
    }
    // Preserve multi-branch graphs; only fix empty or single sequential links.
    if (scene.leadsTo.length <= 1) {
      scene.leadsTo = [next.id];
    }
    // Causal reorder can change leadsTo after StoryArchitect.repairSceneTransitions;
    // keep transitionOut aligned so DramaticStructure does not abort on the new edge.
    syncTransitionOutForLeadsTo(scene);
  }
}

/**
 * Deterministic plan-time repair for causal cue ownership inversions
 * (bite-me 2026-07-09: s1-blog-aftermath before s1-7 lateNightWriting).
 * Reorders or inserts a writing owner before blogAftermath, then refreshes
 * ownership profiles. Does not weaken SceneOwnershipPreflightValidator.
 */
export function repairCausalCueOwnershipOrder<T extends SceneEventOwnershipSceneLike>(
  scenes: T[],
  options: { episodeNumber?: number } = {},
): SceneEventOwnershipDiagnostic[] {
  if (scenes.length === 0) return [];
  const diagnostics: SceneEventOwnershipDiagnostic[] = [];

  // Reorder from text/id cues BEFORE attaching ownership so regressive
  // demotion cannot strip lateNightWriting while blogAftermath sits earlier.
  const episodeNumbers = Array.from(new Set(
    scenes.map((scene) => scene.episodeNumber ?? options.episodeNumber ?? 1),
  )).sort((a, b) => a - b);

  let changed = false;
  for (const episodeNumber of episodeNumbers) {
    for (let pass = 0; pass < 3; pass += 1) {
      const episodeScenes = scenes.filter(
        (scene) => (scene.episodeNumber ?? options.episodeNumber ?? 1) === episodeNumber,
      );
      const aftermathScenes = episodeScenes.filter(sceneLooksLikeBlogAftermath);
      if (aftermathScenes.length === 0) break;

      let writingOwner = episodeScenes.find(sceneLooksLikeWritingOwner);
      if (!writingOwner) {
        const aftermath = aftermathScenes[0];
        const writingText = extractWritingSeedText(aftermath);
        const aftermathIndex = scenes.indexOf(aftermath);
        const created = makeLateNightWritingScene(
          aftermath,
          episodeNumber,
          (aftermath.order ?? Math.max(0, aftermathIndex)) - 0.25,
          writingText,
        );
        (created as { spineUnitId?: string }).spineUnitId = undefined;
        scenes.splice(Math.max(0, aftermathIndex), 0, created);
        writingOwner = created;
        changed = true;
        diagnostics.push({
          sceneId: created.id,
          episodeNumber,
          severity: 'warning',
          message: `Inserted lateNightWriting owner "${created.id}" before blogAftermath so causal ownership can seal.`,
        });
        continue;
      }

      let passChanged = false;
      for (const aftermath of aftermathScenes) {
        const writingIndex = scenes.indexOf(writingOwner);
        const aftermathIndex = scenes.indexOf(aftermath);
        if (writingIndex < 0 || aftermathIndex < 0) continue;
        if (writingIndex < aftermathIndex) continue;

        const [moved] = scenes.splice(writingIndex, 1);
        const targetIndex = writingIndex < aftermathIndex ? aftermathIndex - 1 : aftermathIndex;
        scenes.splice(targetIndex, 0, moved);
        if (isSyntheticBlogAftermathHelper(aftermath)) {
          (aftermath as { spineUnitId?: string }).spineUnitId = undefined;
        }
        changed = true;
        passChanged = true;
        diagnostics.push({
          sceneId: moved.id,
          episodeNumber,
          severity: 'warning',
          message: `Reordered lateNightWriting owner "${moved.id}" before blogAftermath owner "${aftermath.id}".`,
        });
        writingOwner = moved;
      }

      if (!passChanged) break;
    }
  }

  if (changed) {
    renormalizeSceneOrders(scenes);
    repairSequentialLeadsTo(scenes);
  }

  attachSceneEventOwnershipProfiles(scenes, options);

  // Final causal check — surface residual inversions as errors for the gate.
  for (const [dependent, prerequisites] of CAUSAL_CUE_OWNERSHIP_PREREQUISITES) {
    scenes.forEach((scene, index) => {
      if (!sceneOwnsCue(scene, dependent)) return;
      const episodeNumber = scene.episodeNumber ?? options.episodeNumber ?? 1;
      for (const prerequisite of prerequisites) {
        const hasEarlier = scenes
          .slice(0, index)
          .some((candidate) =>
            (candidate.episodeNumber ?? options.episodeNumber ?? 1) === episodeNumber
            && sceneOwnsCue(candidate, prerequisite),
          );
        if (hasEarlier) continue;
        diagnostics.push({
          sceneId: scene.id,
          episodeNumber,
          severity: 'error',
          message: `Scene "${scene.id ?? 'scene'}" owns ${dependent} before its prerequisite event ${prerequisite} has an earlier owner.`,
        });
      }
    });
  }

  return diagnostics;
}

export function overlayBlueprintSceneEventOwnership<T extends SceneEventOwnershipSceneLike>(
  seasonScenes: T[] | undefined,
  blueprintScenes: Array<SceneEventOwnershipSceneLike> | undefined,
  episodeNumber: number,
): number {
  if (!seasonScenes?.length || !blueprintScenes?.length) return 0;
  const byId = new Map(blueprintScenes.map((scene) => [scene.id, scene]));
  let updated = 0;
  for (const planned of seasonScenes) {
    if (planned.episodeNumber !== episodeNumber) continue;
    const blueprint = byId.get(planned.id);
    if (!blueprint?.sceneEventOwnership) continue;
    planned.sceneEventOwnership = blueprint.sceneEventOwnership;
    updated += 1;
  }
  return updated;
}

export function buildSceneEventOwnershipPromptSection(scene: SceneEventOwnershipSceneLike | undefined): string {
  const profile = scene?.sceneEventOwnership;
  if (!profile) return '';
  const owned = profile.ownedEvents.slice(0, 6);
  const context = profile.incomingContext.slice(-6);
  const forbidden = profile.forbiddenRestageEvents.slice(-6);
  if (owned.length === 0 && context.length === 0 && forbidden.length === 0) return '';
  // Chronology keys arrive as slugs ("kylie-forms-dusk-club-mika-stela");
  // render them as words so the directive reads as an event, not an id.
  const ownedText = (event: SceneOwnedEvent): string =>
    /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/.test(event.text) ? event.text.replace(/-/g, ' ') : event.text;
  return `
### Scene Event Ownership
${owned.length ? `Owned events — HARD CONTRACT: each must be depicted as on-page action in THIS scene (the final story contract fails otherwise; a mention or recap does not count):\n${owned.map((event) => `- ${event.cue}: ${ownedText(event)}`).join('\n')}\n` : ''}
${context.length ? `Already happened before this scene; use only as consequence, residue, or brief recap:\n${context.map((event) => `- ${event.cue}: ${event.text}`).join('\n')}\n` : ''}
${forbidden.length ? `Do not restage these events in this scene:\n${forbidden.map((event) => `- ${event.cue}`).join('\n')}\n` : ''}
If an already-owned event must be mentioned, make the sentence clearly aftermath, memory, public reaction, changed access, or consequence. Do not write it as if it is happening for the first time.
`.trimEnd() + '\n';
}
