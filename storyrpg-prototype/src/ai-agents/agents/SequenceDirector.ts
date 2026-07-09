import type { Beat, BeatCoveragePlan, SceneVisualSequencePlan, VisualStagingPattern } from '../../types';
import {
  defaultRelationshipBlocking,
  defaultVisualContinuityReason,
  defaultVisualThreadForLocation,
  isUnsafeCoverageMetadataText,
} from '../utils/coverageMetadataHygiene';
import type { GeneratedBeat, SceneContent } from './SceneWriter';

export interface SequenceDirectorDiagnostic {
  sceneId: string;
  sceneName: string;
  applied: boolean;
  sequencePlan: SceneVisualSequencePlan;
  coverageBeatIds: string[];
  warnings: string[];
}

export interface SequenceDirectorContext {
  sceneDescription?: string;
  locationName?: string;
  genre?: string;
  tone?: string;
  protagonistId?: string;
}

const SHOT_RHYTHM: SceneVisualSequencePlan['shotRhythm'] = [
  'establishing',
  'relationship',
  'insert',
  'reaction',
  'confrontation',
  'reversal',
  'outcome',
  'aftermath',
];

const CAMERA_SIDES = ['front-left', 'side-profile', 'front-right', 'over-shoulder', 'high-side', 'low-side'];
const CAMERA_ANGLES = ['eye-level', 'high angle', 'low angle', 'overhead', 'dutch angle', 'ground-level'];

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isEstablishing(beat: GeneratedBeat): boolean {
  return beat.shotType === 'establishing';
}

function visibleText(beat: GeneratedBeat): string {
  return [
    beat.text,
    beat.visualMoment,
    beat.primaryAction,
    beat.emotionalRead,
    beat.relationshipDynamic,
    beat.mustShowDetail,
    beat.dramaticIntent?.visibleTurn,
    beat.dramaticIntent?.visualSubtextCue,
  ].map(clean).filter(Boolean).join(' ');
}

function isWeak(value: unknown): boolean {
  const text = clean(value);
  return text.length < 8 || /\b(derive|unknown|not provided|n\/a|tbd)\b/i.test(text);
}

function isPlaceholderText(value: unknown): boolean {
  const text = clean(value);
  return !text || /\b(derive|unknown|not provided|n\/a|tbd|placeholder|fill later)\b/i.test(text);
}

function isGenericVisualPlanText(value: unknown): boolean {
  const text = clean(value).toLowerCase();
  if (!text) return true;
  if (text.length < 16) return true;
  return /\b(scene|sequence|clear|visible|emotional|spatial|dynamic|geography|track power|leverage|attention|distance|control)\b/.test(text)
    && !/\b(door|window|table|desk|bed|screen|phone|letter|key|card|ring|map|bar|booth|stairs|street|car|threshold|rope|laptop|knife|cup|bag|mirror|hall|corridor|kitchen|office|club|apartment|market|station|bridge|gate|lamp|light)\b/.test(text);
}

function isSpecificButUnconventional(value: unknown): boolean {
  const text = clean(value);
  if (text.length < 16) return false;
  return /\b(presses?|slides?|holds?|drops?|hides?|opens?|closes?|crosses?|backs?|steps?|leans?|turns?|waits?|watches?|writes?|types?|searches?|carries?|passes?|refuses?|chooses?)\b/i.test(text)
    || /\b[A-Z][a-z]+(?:'s)?\b/.test(text)
    || /\b(left|right|near|behind|between|under|against|across|toward|away from|beside)\b/i.test(text);
}

function isStrongAuthoredText(value: unknown): boolean {
  if (isPlaceholderText(value) || isWeak(value)) return false;
  if (isUnsafeCoverageMetadataText(clean(value))) return false;
  return !isGenericVisualPlanText(value) || isSpecificButUnconventional(value);
}

function safeVisualThread(value: unknown, locationName?: string): string {
  const text = clean(value);
  if (text && isStrongAuthoredText(text)) return text;
  return defaultVisualThreadForLocation(locationName);
}

function authoredTextOr(value: unknown, fallback: string): string {
  return isStrongAuthoredText(value) ? clean(value) : fallback;
}

function authoredListOr<T>(value: unknown, fallback: T[], minimum = 1): T[] {
  return Array.isArray(value) && value.length >= minimum ? value as T[] : fallback;
}

function isQuietScene(text: string): boolean {
  return /\b(say|says|ask|asks|answer|answers|whisper|whispers|talk|argue|confess|apologize|remember|realize|think|quiet|silence|process|writes?|typing|draft)\b/i.test(text)
    && !/\b(chase|fight|attack|sprint|shoot|stab|explode|crash|battle|escape)\b/i.test(text);
}

function inferAnchorZones(text: string, sceneName?: string): string[] {
  const zones: string[] = [];
  const candidates: Array<[RegExp, string]> = [
    [/\b(apartment|bedroom|room|home)\b/i, 'room interior where private choices become visible'],
    [/\b(bed|nightstand)\b/i, 'bed or nightstand holding personal residue'],
    [/\b(desk|laptop|screen|phone|blog|write|typing|draft)\b/i, 'desk/screen workspace where attention narrows'],
    [/\b(window|balcony|city|street)\b/i, 'window or street edge connecting the room to the outside pressure'],
    [/\b(club|bar|booth|dance floor|velvet|rope)\b/i, 'public threshold, crowd, bar/booth, and private edge of the room'],
    [/\b(door|gate|threshold|entrance|exit)\b/i, 'door or threshold where access and refusal are staged'],
    [/\b(market|street|alley|corridor|hall)\b/i, 'route through public space with changing exits'],
    [/\b(table|counter)\b/i, 'table or counter where object control can pass between characters'],
    [/\b(car|train|station|platform)\b/i, 'vehicle or platform boundary that controls escape'],
  ];
  for (const [pattern, zone] of candidates) {
    if (pattern.test(text)) zones.push(zone);
  }
  if (zones.length === 0) zones.push(`${sceneName || 'scene'} playable foreground, threshold, and background pressure`);
  if (zones.length === 1) zones.push('opposing edge of the space where the visible consequence lands');
  return Array.from(new Set(zones)).slice(0, 4);
}

function inferBoundaryOrThreshold(text: string, anchorZones: string[]): string {
  const match = text.match(/\b(door|gate|window|screen|phone|laptop|table|bar|booth|velvet rope|threshold|stairs|corridor|street|car|bed|desk)\b/i)?.[0];
  if (match) return `the ${match} marks where attention, access, or power changes`;
  return `${anchorZones[0] || 'the main scene boundary'} marks the visible line characters cross or fail to cross`;
}

function inferPhysicalCarrier(text: string, visualThread: string, quiet: boolean): string | undefined {
  const prop = text.match(/\b(letter|key card|key|ring|phone|screen|laptop|map|knife|cup|glass|door|window|blood|wound|bag|book|mask|coin|flower|lantern|torch|photograph|ticket|pendant|shoe|shoes|draft|notebook)\b/i)?.[0];
  if (prop) return `the ${prop} carries the visible change as it is handled, withheld, moved, or reinterpreted`;
  if (quiet) return `${visualThread}; give the conversation a visible task, object, threshold, or repeated gesture that changes by the end`;
  return undefined;
}

function concreteGeography(scene: SceneContent, context: SequenceDirectorContext, text: string, anchorZones: string[]): string {
  const authored = clean(context.sceneDescription)
    || clean((scene.settingContext as any)?.description)
    || clean(context.locationName);
  if (authored && !isGenericVisualPlanText(authored)) return authored;
  return `${scene.sceneName || 'Scene'} staged as ${anchorZones.join('; ')}. Preserve entrances, exits, useful props, and the main light source so attention can move coherently across beats.`;
}

function nonEstablishingBeats(scene: SceneContent): GeneratedBeat[] {
  return (scene.beats || []).filter((beat) => !isEstablishing(beat));
}

function sceneText(scene: SceneContent): string {
  return [
    scene.sceneName,
    scene.transitionIn,
    ...(scene.keyMoments || []),
    ...(scene.sceneTakeaways || []),
    ...(scene.beats || []).map((beat) => beat.text),
  ].filter(Boolean).join(' ');
}

function inferActivity(text: string): string {
  const lowered = text.toLowerCase();
  if (/\b(chase|run|flee|escape|pursue|sprint|race)\b/.test(lowered)) return 'a pursuit through changing geography';
  if (/\b(search|investigat|inspect|clue|evidence|proof|discover)\b/.test(lowered)) return 'an investigation carried by clues, hands, looks, and changing attention';
  if (/\b(argue|confront|accuse|warn|confess|apologize|negotiate|persuade)\b/.test(lowered)) return 'a charged exchange carried by blocking, distance, and object control';
  if (/\b(fight|strike|duel|battle|attack|defend|parry)\b/.test(lowered)) return 'a physical confrontation with escalating tactical position';
  if (/\b(rest|recover|aftermath|settle|quiet|breathe)\b/.test(lowered)) return 'a recovery sequence carried by posture, breath, and visible residue';
  if (/\b(walk|travel|cross|enter|leave|arrive|road|street|market|corridor)\b/.test(lowered)) return 'movement through the location while pressure follows and changes position';
  return 'a visible exchange where distance, posture, attention, or object control changes';
}

function inferVisualThread(scene: SceneContent, text: string, locationName?: string): string {
  const authored = clean(scene.sequenceIntent?.visualThread);
  if (authored && isStrongAuthoredText(authored)) return authored;
  const prop = text.match(/\b(letter|key|ring|charm|phone|screen|map|knife|cup|door|window|blood|wound|bag|book|mask|coin|flower|lantern|torch|photograph|ticket)\b/i)?.[0];
  if (prop) return `the ${prop} changing attention, possession, or meaning across the scene`;
  return defaultVisualThreadForLocation(locationName);
}

function inferBeatRole(index: number, count: number, beat: GeneratedBeat): NonNullable<Beat['sequenceIntent']>['beatRole'] {
  if (beat.sequenceIntent?.beatRole) return beat.sequenceIntent.beatRole;
  if (beat.intensityTier === 'rest') return index >= count - 1 ? 'aftermath' : 'pressure';
  if (index === 0) return 'setup';
  if (index === count - 1) return beat.isChoicePoint ? 'handoff' : 'consequence';
  if (beat.isClimaxBeat || beat.isKeyStoryBeat || beat.intensityTier === 'dominant') return 'turn';
  if (index === Math.max(1, Math.floor(count / 2))) return 'turn';
  return index < count / 2 ? 'pressure' : 'escalation';
}

function inferStagingPattern(beat: GeneratedBeat, visibleIds: string[], role: NonNullable<Beat['sequenceIntent']>['beatRole']): VisualStagingPattern {
  if (isEstablishing(beat)) return 'environment';
  if (/\b(clue|detail|object|letter|key|ring|phone|screen|map|knife|cup|wound|blood|hand|door)\b/i.test(visibleText(beat))) return 'insert';
  if (visibleIds.length >= 3) return 'ensemble';
  if (visibleIds.length === 2) return role === 'turn' ? 'ots-listener' : 'two-shot';
  if (role === 'aftermath') return 'environmental-aftermath';
  if (role === 'turn' || role === 'consequence') return 'solo-reaction';
  return 'single';
}

function inferShotDistance(beat: GeneratedBeat, role: NonNullable<Beat['sequenceIntent']>['beatRole'], index: number): BeatCoveragePlan['shotDistance'] {
  if (isEstablishing(beat)) return 'ELS';
  if (role === 'setup') return 'LS';
  if (role === 'pressure') return index % 2 === 0 ? 'MLS' : 'MS';
  if (role === 'escalation') return 'MS';
  if (role === 'turn') return /\b(clue|detail|object|hand|eyes|mouth|wound)\b/i.test(visibleText(beat)) ? 'CU' : 'MCU';
  if (role === 'handoff' || role === 'aftermath') return 'LS';
  return 'MS';
}

function collectVisibleIds(beat: GeneratedBeat, scene: SceneContent): string[] {
  const coverage = beat.coveragePlan;
  const cast = beat.visualCast;
  const ids = [
    ...(coverage?.requiredVisibleCharacterIds || []),
    ...(cast?.foregroundCharacterIds || []),
    ...(cast?.activeCharacterIds || []),
    ...((beat as any).characters || []),
  ].filter(Boolean);
  if (ids.length) return Array.from(new Set(ids));
  if (isEstablishing(beat)) return [];
  return Array.from(new Set((scene.charactersInvolved || []).slice(0, 3)));
}

function offscreenIds(scene: SceneContent, visibleIds: string[]): string[] {
  return (scene.charactersInvolved || []).filter((id) => !visibleIds.includes(id));
}

export function buildSceneVisualSequencePlan(scene: SceneContent, context: SequenceDirectorContext = {}): SceneVisualSequencePlan {
  const text = sceneText(scene);
  const sequence = scene.sequenceIntent;
  const authoredPlan = scene.sceneVisualSequencePlan;
  const quiet = isQuietScene(text);
  const inferredObjective = !isWeak(sequence?.objective)
    ? clean(sequence?.objective)
    : `${scene.sceneName || 'The scene'} moves from unresolved pressure to a visible changed state.`;
  let activity = !isWeak(sequence?.activity) ? clean(sequence?.activity) : inferActivity(text);
  const inferredObstacle = !isWeak(sequence?.obstacle)
    ? clean(sequence?.obstacle)
    : 'The visible pressure, uncertainty, danger, or relationship resistance makes the objective difficult.';
  let turningPoint = !isWeak(sequence?.turningPoint)
    ? clean(sequence?.turningPoint)
    : clean(nonEstablishingBeats(scene).find((beat) => beat.isClimaxBeat || beat.isKeyStoryBeat || beat.intensityTier === 'dominant')?.dramaticIntent?.visibleTurn)
      || 'A visible shift changes leverage, attention, distance, or object control.';
  let endState = !isWeak(sequence?.endState)
    ? clean(sequence?.endState)
    : clean((scene.beats || [])[Math.max(0, (scene.beats || []).length - 1)]?.dramaticIntent?.statusAfter)
      || 'By the end, the characters occupy a new emotional, tactical, or informational position.';
  const inferredVisualThread = inferVisualThread(scene, text, context.locationName);
  const inferredAnchorZones = inferAnchorZones(text, scene.sceneName);
  let anchorZones = authoredListOr<string>(authoredPlan?.anchorZones, inferredAnchorZones, 2);
  let visualThread = authoredTextOr(authoredPlan?.visualThread, inferredVisualThread);
  let boundaryOrThreshold = authoredTextOr(authoredPlan?.boundaryOrThreshold, inferBoundaryOrThreshold(text, anchorZones));
  let physicalCarrier = authoredTextOr(authoredPlan?.physicalCarrier, inferPhysicalCarrier(text, visualThread, quiet) || '');
  if (physicalCarrier && isGenericVisualPlanText(activity)) {
    activity = `${activity}, externalized through ${physicalCarrier}`;
  } else if (isGenericVisualPlanText(activity)) {
    activity = `${activity} through ${anchorZones.join(' and ')}`;
  }
  if (isGenericVisualPlanText(turningPoint)) {
    turningPoint = `${turningPoint} around ${physicalCarrier || boundaryOrThreshold}`;
  }
  if (isGenericVisualPlanText(endState)) {
    endState = `${endState} at ${anchorZones[Math.max(0, anchorZones.length - 1)]}`;
  }
  const inferredGeography = concreteGeography(scene, context, text, anchorZones);
  const geography = authoredTextOr(authoredPlan?.geography, inferredGeography);
  const movementLine = authoredTextOr(
    authoredPlan?.movementLine,
    `${activity}; attention travels through ${anchorZones.join(' -> ')} while ${boundaryOrThreshold}.`,
  );
  const powerBlocking = authoredTextOr(
    authoredPlan?.powerBlocking,
    `${sequence?.startState || 'At first, pressure controls the scene'}; ${turningPoint}; by the end, ${endState}`,
  );

  const objective = authoredTextOr(authoredPlan?.objective, inferredObjective);
  activity = authoredTextOr(authoredPlan?.activity, activity);
  const obstacle = authoredTextOr(authoredPlan?.obstacle, inferredObstacle);
  turningPoint = authoredTextOr(authoredPlan?.turningPoint, turningPoint);
  endState = authoredTextOr(authoredPlan?.endState, endState);
  anchorZones = authoredListOr<string>(authoredPlan?.anchorZones, anchorZones, 2);
  visualThread = authoredTextOr(authoredPlan?.visualThread, visualThread);
  boundaryOrThreshold = authoredTextOr(authoredPlan?.boundaryOrThreshold, boundaryOrThreshold);
  physicalCarrier = authoredTextOr(authoredPlan?.physicalCarrier, physicalCarrier);

  const defaultAvoid = [
    'unrelated hero portraits',
    'repeating the same centered character pose',
    'camera choices that ignore the scene geography or visual thread',
  ];

  return {
    objective,
    activity,
    obstacle,
    geography,
    movementLine,
    visualThread,
    shotRhythm: Array.isArray(authoredPlan?.shotRhythm) && authoredPlan.shotRhythm.length >= 2
      ? authoredPlan.shotRhythm
      : SHOT_RHYTHM,
    powerBlocking,
    turningPoint,
    endState,
    anchorZones,
    boundaryOrThreshold,
    physicalCarrier: physicalCarrier || undefined,
    rhythmIntent: authoredTextOr(
      authoredPlan?.rhythmIntent,
      `${activity} moves from ${anchorZones[0]} toward ${anchorZones[Math.max(0, anchorZones.length - 1)]}, using scale, subject, and screen direction only as needed to clarify the visible change.`,
    ),
    avoid: authoredListOr<string>(authoredPlan?.avoid, defaultAvoid),
  };
}

export function applySequenceDirectorPlan(scene: SceneContent, context: SequenceDirectorContext = {}): SequenceDirectorDiagnostic {
  const sequencePlan = buildSceneVisualSequencePlan(scene, context);
  const warnings: string[] = [];
  scene.sceneVisualSequencePlan = sequencePlan;
  const resolvedVisualThread = safeVisualThread(
    scene.sequenceIntent?.visualThread || sequencePlan.visualThread,
    context.locationName || sequencePlan.geography,
  );
  sequencePlan.visualThread = resolvedVisualThread;
  scene.sequenceIntent = {
    ...(scene.sequenceIntent || {}),
    objective: scene.sequenceIntent?.objective || sequencePlan.objective,
    activity: scene.sequenceIntent?.activity || sequencePlan.activity,
    obstacle: scene.sequenceIntent?.obstacle || sequencePlan.obstacle,
    startState: scene.sequenceIntent?.startState || clean(scene.beats?.[0]?.visualMoment) || `The sequence begins in ${sequencePlan.geography}.`,
    turningPoint: scene.sequenceIntent?.turningPoint || sequencePlan.turningPoint,
    endState: scene.sequenceIntent?.endState || sequencePlan.endState,
    visualThread: resolvedVisualThread,
  };

  const coverageBeatIds: string[] = [];
  const beats = scene.beats || [];
  beats.forEach((beat, index) => {
    const visibleBeats = beats.filter((candidate) => !isEstablishing(candidate));
    const role = isEstablishing(beat)
      ? 'setup'
      : inferBeatRole(visibleBeats.indexOf(beat), visibleBeats.length, beat);
    beat.sequenceIntent = {
      ...(scene.sequenceIntent || {}),
      ...(beat.sequenceIntent || {}),
      beatRole: role,
      visualThread: safeVisualThread(
        beat.sequenceIntent?.visualThread || sequencePlan.visualThread,
        context.locationName || sequencePlan.geography,
      ),
      turningPoint: beat.sequenceIntent?.turningPoint || sequencePlan.turningPoint,
      endState: beat.sequenceIntent?.endState || sequencePlan.endState,
    };

    const visibleIds = collectVisibleIds(beat, scene);
    const existing = beat.coveragePlan;
    const stagingPattern = existing?.stagingPattern || inferStagingPattern(beat, visibleIds, role);
    const shotDistance = existing?.shotDistance || inferShotDistance(beat, role, index);
    const cameraAngle = existing?.cameraAngle || CAMERA_ANGLES[index % CAMERA_ANGLES.length];
    const cameraSide = existing?.cameraSide || CAMERA_SIDES[index % CAMERA_SIDES.length];
    const requiredVisibleCharacterIds = existing?.requiredVisibleCharacterIds?.length
      ? existing.requiredVisibleCharacterIds
      : visibleIds;
    const continuityMode = role === 'turn' ? 'preserve_scene_axis' : 'fresh_composition';
    const authoredBlocking = isStrongAuthoredText(existing?.relationshipBlocking)
      ? existing!.relationshipBlocking
      : (isStrongAuthoredText(beat.relationshipDynamic) ? beat.relationshipDynamic : undefined);

    beat.coveragePlan = {
      stagingPattern,
      shotDistance,
      cameraAngle,
      cameraSide,
      focalCharacterIds: existing?.focalCharacterIds?.length ? existing.focalCharacterIds : requiredVisibleCharacterIds.slice(0, 1),
      requiredVisibleCharacterIds,
      optionalVisibleCharacterIds: existing?.optionalVisibleCharacterIds || [],
      offscreenCharacterIds: existing?.offscreenCharacterIds || offscreenIds(scene, requiredVisibleCharacterIds),
      relationshipBlocking: authoredBlocking || defaultRelationshipBlocking(),
      coverageReason: isStrongAuthoredText(existing?.coverageReason) ? existing!.coverageReason
        : `${role} beat in the scene sequence: ${beat.dramaticIntent?.visibleTurn || beat.visualMoment || beat.primaryAction || beat.text}`,
      visualContinuity: (() => {
        const existingContinuity = existing?.visualContinuity;
        if (
          existingContinuity
          && isStrongAuthoredText(existingContinuity.reason)
          && !isUnsafeCoverageMetadataText(existingContinuity.reason)
        ) {
          return existingContinuity;
        }
        return {
          mode: continuityMode,
          reason: defaultVisualContinuityReason(continuityMode),
          preserve: existingContinuity?.preserve?.length ? existingContinuity.preserve : ['environment', 'lighting'],
        };
      })(),
    };
    if (existing?.relationshipBlocking && !isStrongAuthoredText(existing.relationshipBlocking)) {
      warnings.push(`Repaired weak relationshipBlocking for ${beat.id}.`);
    }
    if (existing?.coverageReason && !isStrongAuthoredText(existing.coverageReason)) {
      warnings.push(`Repaired weak coverageReason for ${beat.id}.`);
    }
    coverageBeatIds.push(beat.id);
  });

  if (beats.length > 1 && coverageBeatIds.length !== beats.length) {
    warnings.push(`Only ${coverageBeatIds.length}/${beats.length} beats received coverage plans.`);
  }

  return {
    sceneId: scene.sceneId,
    sceneName: scene.sceneName,
    applied: true,
    sequencePlan,
    coverageBeatIds,
    warnings,
  };
}
