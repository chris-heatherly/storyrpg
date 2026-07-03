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
  'blogAftermath',
  'endingAftermath',
]);

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

function eventOrder(cue: SceneEventOwnershipCue): number {
  return ROUTE_CUE_ORDER[cue] ?? 999;
}

function isHardBeat(beat: RequiredBeat): boolean {
  return beat.tier === 'authored' || beat.tier === 'signature' || beat.tier === 'coldopen';
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
  let previousOwnedEvents: SceneOwnedEvent[] = [];
  scenes.forEach((scene) => {
    const profile = compileSceneEventOwnershipProfile(scene, previousOwnedEvents, options);
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
