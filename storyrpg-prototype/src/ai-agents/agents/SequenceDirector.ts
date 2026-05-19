import type { Beat, BeatCoveragePlan, SceneVisualSequencePlan, VisualStagingPattern } from '../../types';
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

function inferVisualThread(scene: SceneContent, text: string): string {
  const authored = clean(scene.sequenceIntent?.visualThread);
  if (!isWeak(authored)) return authored;
  const prop = text.match(/\b(letter|key|ring|charm|phone|screen|map|knife|cup|door|window|blood|wound|bag|book|mask|coin|flower|lantern|torch|photograph|ticket)\b/i)?.[0];
  if (prop) return `the ${prop} changing attention, possession, or meaning across the scene`;
  return 'the changing distance, gaze, and hand positions between the visible characters';
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
  const objective = !isWeak(sequence?.objective)
    ? clean(sequence?.objective)
    : `${scene.sceneName || 'The scene'} moves from unresolved pressure to a visible changed state.`;
  const activity = !isWeak(sequence?.activity) ? clean(sequence?.activity) : inferActivity(text);
  const obstacle = !isWeak(sequence?.obstacle)
    ? clean(sequence?.obstacle)
    : 'The visible pressure, uncertainty, danger, or relationship resistance makes the objective difficult.';
  const turningPoint = !isWeak(sequence?.turningPoint)
    ? clean(sequence?.turningPoint)
    : clean(nonEstablishingBeats(scene).find((beat) => beat.isClimaxBeat || beat.isKeyStoryBeat || beat.intensityTier === 'dominant')?.dramaticIntent?.visibleTurn)
      || 'A visible shift changes leverage, attention, distance, or object control.';
  const endState = !isWeak(sequence?.endState)
    ? clean(sequence?.endState)
    : clean((scene.beats || [])[Math.max(0, (scene.beats || []).length - 1)]?.dramaticIntent?.statusAfter)
      || 'By the end, the characters occupy a new emotional, tactical, or informational position.';
  const visualThread = inferVisualThread(scene, text);
  const geography = clean(context.sceneDescription)
    || clean((scene.settingContext as any)?.description)
    || clean(context.locationName)
    || `${scene.sceneName || 'the scene'} geography`;

  return {
    objective,
    activity,
    obstacle,
    geography,
    movementLine: `${activity}; track where attention, distance, and control move from beat to beat.`,
    visualThread,
    shotRhythm: SHOT_RHYTHM,
    powerBlocking: 'Track power through height, foreground/background, distance, who controls the key object, and who has a clear exit.',
    turningPoint,
    endState,
  };
}

export function applySequenceDirectorPlan(scene: SceneContent, context: SequenceDirectorContext = {}): SequenceDirectorDiagnostic {
  const sequencePlan = buildSceneVisualSequencePlan(scene, context);
  const warnings: string[] = [];
  scene.sceneVisualSequencePlan = sequencePlan;
  scene.sequenceIntent = {
    ...(scene.sequenceIntent || {}),
    objective: scene.sequenceIntent?.objective || sequencePlan.objective,
    activity: scene.sequenceIntent?.activity || sequencePlan.activity,
    obstacle: scene.sequenceIntent?.obstacle || sequencePlan.obstacle,
    startState: scene.sequenceIntent?.startState || clean(scene.beats?.[0]?.visualMoment) || `The sequence begins in ${sequencePlan.geography}.`,
    turningPoint: scene.sequenceIntent?.turningPoint || sequencePlan.turningPoint,
    endState: scene.sequenceIntent?.endState || sequencePlan.endState,
    visualThread: scene.sequenceIntent?.visualThread || sequencePlan.visualThread,
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
      visualThread: beat.sequenceIntent?.visualThread || sequencePlan.visualThread,
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

    beat.coveragePlan = {
      stagingPattern,
      shotDistance,
      cameraAngle,
      cameraSide,
      focalCharacterIds: existing?.focalCharacterIds?.length ? existing.focalCharacterIds : requiredVisibleCharacterIds.slice(0, 1),
      requiredVisibleCharacterIds,
      optionalVisibleCharacterIds: existing?.optionalVisibleCharacterIds || [],
      offscreenCharacterIds: existing?.offscreenCharacterIds || offscreenIds(scene, requiredVisibleCharacterIds),
      relationshipBlocking: existing?.relationshipBlocking
        || beat.relationshipDynamic
        || `${sequencePlan.visualThread}; show who gains or loses distance, control, or attention.`,
      coverageReason: existing?.coverageReason
        || `${role} beat in the scene sequence: ${beat.dramaticIntent?.visibleTurn || beat.visualMoment || beat.primaryAction || beat.text}`,
      visualContinuity: existing?.visualContinuity || {
        mode: role === 'turn' ? 'preserve_scene_axis' : 'fresh_composition',
        reason: `SequenceDirector: preserve ${sequencePlan.visualThread} while varying shot size, camera side, and focal subject.`,
        preserve: ['environment', 'lighting'],
      },
    };
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
