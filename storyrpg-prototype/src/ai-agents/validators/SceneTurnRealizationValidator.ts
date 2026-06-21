import type { Beat, Scene, Story } from '../../types';
import type { PlannedScene, SceneTurnContract, SeasonScenePlan } from '../../types/scenePlan';
import { momentDepicted } from '../remediation/realizationScoring';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface SceneTurnRealizationInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  treatmentSourced?: boolean;
}

interface PlannedSceneRef {
  planned?: PlannedScene;
  episodeNumber: number;
  scene: Scene;
}

const BEFORE_ROLES = new Set(['setup', 'pressure', 'escalation']);
const AFTER_ROLES = new Set(['consequence', 'handoff', 'aftermath']);

const AFTER_PROSE_RE =
  /\b(after|afterward|aftermath|then|later|by the time|at last|finally|so|therefore|because|inside|through|across|toward|back to|home|threshold|doorway|street|morning|evening|night|dawn|sunset|walk|walks|leave|leaves|enter|enters|follow|follows|return|returns|promise|vow|decide|decides)\b/i;

function textOfBeat(beat: Beat): string {
  return [
    beat.text,
    beat.visualMoment,
    beat.primaryAction,
    beat.emotionalRead,
    beat.relationshipDynamic,
    beat.dramaticIntent?.statusBefore,
    beat.dramaticIntent?.visibleTurn,
    beat.dramaticIntent?.statusAfter,
    beat.sequenceIntent?.startState,
    beat.sequenceIntent?.turningPoint,
    beat.sequenceIntent?.endState,
    ...(beat.textVariants || []).map((variant) => variant.text),
  ]
    .filter(Boolean)
    .join(' ');
}

function sceneProse(scene: Scene): string {
  const parts = [scene.name, ...(scene.beats || []).map(textOfBeat)];
  const enc = scene.encounter as
    | { phases?: Array<{ beats?: unknown[] }>; storylets?: unknown }
    | undefined;
  const collect = (beats: unknown[] | undefined): void => {
    for (const raw of beats || []) {
      const beat = raw as Partial<Beat> & { setupText?: string; escalationText?: string };
      parts.push(beat.text || '', beat.setupText || '', beat.escalationText || '');
    }
  };
  if (enc) {
    for (const phase of enc.phases || []) collect(phase.beats);
    const storylets = Array.isArray(enc.storylets)
      ? enc.storylets
      : Object.values((enc.storylets ?? {}) as Record<string, unknown>);
    for (const storylet of storylets) collect((storylet as { beats?: unknown[] } | undefined)?.beats);
  }
  return parts.filter(Boolean).join(' ');
}

function beatRole(beat: Beat): string | undefined {
  return beat.sequenceIntent?.beatRole;
}

function hasBeforeEvidence(scene: Scene, turnIndex: number): boolean {
  if ((scene.beats || []).some((beat) => BEFORE_ROLES.has(beatRole(beat) || ''))) return true;
  if (turnIndex > 0) return true;
  const first = scene.beats?.[0];
  if (!first) return false;
  return Boolean(
    first.sequenceIntent?.startState
    || first.dramaticIntent?.statusBefore
    || /\b(outside|at the door|arrive|arrives|waiting|before|still|not yet|first)\b/i.test(textOfBeat(first)),
  );
}

function bridgeHasAfterEvidence(beat: Beat): boolean {
  if (!beat.nextSceneId && !beat.isChoiceBridge && !beat.routeContext?.originalTargetSceneId) return false;
  const text = textOfBeat(beat);
  const routeText = [
    beat.routeContext?.transitionIntent,
    beat.routeContext?.bridgePurpose,
    beat.routeContext?.choiceSummary,
  ].filter(Boolean).join(' ');
  return AFTER_PROSE_RE.test(`${text} ${routeText}`);
}

function hasAfterEvidence(scene: Scene, turnIndex: number): boolean {
  const beats = scene.beats || [];
  if (beats.some((beat) => AFTER_ROLES.has(beatRole(beat) || ''))) return true;
  if (beats.some(bridgeHasAfterEvidence)) return true;
  for (let i = Math.max(turnIndex + 1, 0); i < beats.length; i += 1) {
    const beat = beats[i];
    if (
      beat.sequenceIntent?.endState
      || beat.dramaticIntent?.statusAfter
      || AFTER_PROSE_RE.test(textOfBeat(beat))
    ) {
      return true;
    }
  }
  return false;
}

function hasChoiceAftermathRisk(scene: Scene): boolean {
  const beats = scene.beats || [];
  const choiceIndex = beats.findIndex((beat) => beat.isChoicePoint || (beat.choices?.length ?? 0) > 0);
  if (choiceIndex < 0) return false;
  return choiceIndex >= beats.length - 1 && beats.some((beat) => beat.nextSceneId || beat.isChoiceBridge || beat.choices?.some((choice) => choice.nextSceneId));
}

function sceneIndex(story: Story, sceneId: string): { episodeNumber: number; index: number } | undefined {
  for (const episode of story.episodes || []) {
    const index = (episode.scenes || []).findIndex((scene) => scene.id === sceneId);
    if (index >= 0) return { episodeNumber: episode.number, index };
  }
  return undefined;
}

function collectScenes(input: SceneTurnRealizationInput): PlannedSceneRef[] {
  const plannedById = new Map<string, PlannedScene>();
  for (const planned of input.scenePlan?.scenes || []) plannedById.set(planned.id, planned);
  const refs: PlannedSceneRef[] = [];
  for (const episode of input.story.episodes || []) {
    for (const scene of episode.scenes || []) {
      refs.push({ episodeNumber: episode.number, scene, planned: plannedById.get(scene.id) });
    }
  }
  return refs;
}

function contractFor(scene: Scene, planned?: PlannedScene): SceneTurnContract | undefined {
  return scene.turnContract || planned?.turnContract;
}

function isEncounterScene(scene: Scene, planned?: PlannedScene): boolean {
  return Boolean(scene.encounter) || planned?.kind === 'encounter' || contractFor(scene, planned)?.source === 'encounter';
}

export class SceneTurnRealizationValidator extends BaseValidator {
  constructor() {
    super('SceneTurnRealizationValidator');
  }

  validate(input: SceneTurnRealizationInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const refs = collectScenes(input);

    for (const { episodeNumber, scene, planned } of refs) {
      const contract = contractFor(scene, planned);
      if (!contract?.centralTurn?.trim()) continue;
      if (isEncounterScene(scene, planned)) continue;

      const prose = sceneProse(scene);
      const beats = scene.beats || [];
      if (!prose.trim() || beats.length === 0) {
        issues.push(this.error(
          `Scene "${scene.id}" has a dramatic turn contract but no reader-facing prose to realize it: "${contract.centralTurn}".`,
          `sceneTurn:ep${episodeNumber}:${scene.id}:${contract.turnId}`,
          'Generate reader-facing scene prose that establishes, dramatizes, and follows through on the scene turn.',
        ));
        continue;
      }

      const turnIndex = beats.findIndex((beat) => momentDepicted('RequiredBeatRealizationValidator', contract.centralTurn, textOfBeat(beat)));
      const eventDepicted = turnIndex >= 0 || momentDepicted('RequiredBeatRealizationValidator', contract.centralTurn, prose);
      const before = hasBeforeEvidence(scene, turnIndex);
      const after = hasAfterEvidence(scene, turnIndex);
      const riskyChoiceExit = hasChoiceAftermathRisk(scene);
      const isTreatmentTurn = contract.source === 'treatment';
      const structurallyRisky = riskyChoiceExit && !after;
      const severity: 'error' | 'warning' = isTreatmentTurn || structurallyRisky ? 'error' : 'warning';

      if (!eventDepicted) {
        issues.push(this.createIssue(
          severity,
          `Scene "${scene.id}" does not dramatize its central turn on-page: "${contract.centralTurn}".`,
          `sceneTurn:ep${episodeNumber}:${scene.id}:${contract.turnId}`,
          'Make the central turn a visible event, reveal, choice, or consequence in the scene prose.',
        ));
        continue;
      }

      const missing: string[] = [];
      if (!before) missing.push('before-state setup');
      if (!after) missing.push('after-state aftermath/handoff');
      if (missing.length > 0) {
        issues.push(this.createIssue(
          severity,
          `Scene "${scene.id}" mentions its central turn but does not give it a complete scene shape (${missing.join(', ')} missing): "${contract.centralTurn}".`,
          `sceneTurn:ep${episodeNumber}:${scene.id}:${contract.turnId}`,
          'Build the scene around setup/pre-turn pressure, the turn event, and an immediate consequence or grounded handoff before routing onward.',
        ));
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    return {
      valid: errors === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 15),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}

export function sceneTurnLocationFor(story: Story, sceneId: string, turnId = 'turn'): string | undefined {
  const ref = sceneIndex(story, sceneId);
  return ref ? `sceneTurn:ep${ref.episodeNumber}:${sceneId}:${turnId}` : undefined;
}
