import type { RequiredBeat, SceneConstructionProfile, SceneEventOwnershipProfile, SceneTurnContract, StoryCircleBeatRealizationContract } from '../../types/scenePlan';
import type { StoryCircleRoleAssignment } from '../../types/sourceAnalysis';
import { atomizeTreatmentText } from '../utils/treatmentEventAtomizer';
import { detectPrimaryStoryEventCues } from '../remediation/storyEventCues';
import { anchoredSceneLocationCues } from '../utils/sceneLocationCues';
import { BaseValidator, buildFailureResult, buildSuccessResult, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface SceneOwnershipPreflightScene {
  id?: string;
  episodeNumber?: number;
  order?: number;
  kind?: string;
  isEncounter?: boolean;
  name?: string;
  title?: string;
  location?: string;
  locations?: string[];
  timeOfDay?: string;
  timeJumpFromPrevious?: string;
  timeJump?: string;
  dramaticPurpose?: string;
  description?: string;
  requiredBeats?: RequiredBeat[];
  treatmentAtomIds?: string[];
  ownedChronologyKeys?: string[];
  sourceContextIds?: string[];
  coldOpenProfile?: unknown;
  turnContract?: SceneTurnContract;
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
  sceneEventOwnership?: SceneEventOwnershipProfile;
  sceneConstructionProfile?: SceneConstructionProfile;
}

export interface SceneOwnershipPreflightInput {
  episodeNumber?: number;
  storyCircleRole?: StoryCircleRoleAssignment[];
  scenes: SceneOwnershipPreflightScene[];
}

const HARD_TIERS = new Set<RequiredBeat['tier']>(['authored', 'signature', 'coldopen']);
const TIME_CUE_RE = /\b(?:night (?:one|two|three|four|\d+)|\d+\s*(?:am|pm)|morning|dawn|dusk|sunset|midnight|noon|afternoon|evening|later|earlier|next (?:day|morning|night)|previous (?:day|night)|same night|the next day)\b/gi;

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function beatText(beat: RequiredBeat): string {
  return cleanText(beat.mustDepict || beat.sourceTurn);
}

function isOpeningScene(scene: SceneOwnershipPreflightScene, scenes: SceneOwnershipPreflightScene[]): boolean {
  if (scene.coldOpenProfile) return true;
  const first = [...scenes].sort((a, b) =>
    (a.order ?? 999) - (b.order ?? 999) || cleanText(a.id).localeCompare(cleanText(b.id)),
  )[0];
  return first?.id === scene.id;
}

function uniqueTimeCues(texts: string[]): string[] {
  return Array.from(new Set(texts.flatMap((text) =>
    Array.from(text.matchAll(TIME_CUE_RE)).map((match) => match[0].toLowerCase()),
  )));
}

function uniqueLocationCues(scene: SceneOwnershipPreflightScene, texts: string[]): string[] {
  // Declared location labels are one spatial anchor; only hard-beat texts can
  // introduce a genuinely conflicting second location (see anchoredSceneLocationCues).
  return anchoredSceneLocationCues([scene.location, ...(scene.locations ?? [])], texts);
}

function sceneOwnsEncounterCue(scene: SceneOwnershipPreflightScene): boolean {
  if (scene.sceneEventOwnership) {
    return (scene.sceneEventOwnership.ownedEvents ?? []).some((event) => event.cue === 'threatEncounter');
  }
  const profile = scene.sceneConstructionProfile;
  if (profile) {
    const texts = profile.obligations
      .filter((obligation) => obligation.slot === 'primary_turn' || obligation.slot === 'must_stage')
      .map((obligation) => obligation.text)
      .filter(Boolean);
    return texts.some((text) => detectPrimaryStoryEventCues(text).has('threatEncounter'));
  }
  const texts = [
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    ...(scene.requiredBeats ?? []).filter((beat) => HARD_TIERS.has(beat.tier)).map(beatText),
  ].map(cleanText).filter(Boolean);
  return texts.some((text) => detectPrimaryStoryEventCues(text).has('threatEncounter'));
}

function sceneHasMustStageObligation(scene: SceneOwnershipPreflightScene): boolean {
  if ((scene.requiredBeats ?? []).some((beat) => HARD_TIERS.has(beat.tier) && beatText(beat))) return true;
  return Boolean((scene.sceneConstructionProfile?.obligations ?? []).some((obligation) =>
    obligation.slot === 'must_stage'
    || (obligation.slot === 'primary_turn' && detectPrimaryStoryEventCues(obligation.text).size > 0)
  ));
}

function encounterCueText(scene: SceneOwnershipPreflightScene): string {
  return [
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.description,
    scene.dramaticPurpose,
    scene.sceneConstructionProfile?.primaryTurn?.text,
    ...(scene.sceneConstructionProfile?.obligations ?? [])
      .filter((obligation) => obligation.slot === 'primary_turn' || obligation.slot === 'must_stage')
      .map((obligation) => obligation.text),
  ].map(cleanText).filter(Boolean).join(' ');
}

function isQuestionOnlyText(text: string): boolean {
  return /\?$/.test(text) || /^(?:can|will|would|could|should|what|why|how|whether)\b/i.test(text);
}

function isAbstractEncounterShell(scene: SceneOwnershipPreflightScene): boolean {
  if (scene.kind !== 'encounter' && !scene.isEncounter) return false;
  if ((scene.sceneEventOwnership?.ownedEvents ?? []).length > 0) return false;
  if ((scene.treatmentAtomIds ?? []).length > 0 || (scene.ownedChronologyKeys ?? []).length > 0) return false;
  if (sceneHasMustStageObligation(scene)) return false;
  const text = encounterCueText(scene);
  if (!text) return true;
  const cues = detectPrimaryStoryEventCues(text);
  if (cues.size > 0) return false;
  return isQuestionOnlyText(text) || !/\b(?:arrives?|meets?|enters?|attacks?|confronts?|escapes?|discovers?|takes?|gives?|hands?|walks?|writes?|publishes?|reveals?|refuses?|chooses?|finds?|follows?)\b/i.test(text);
}

function sceneHasRole(scene: SceneOwnershipPreflightScene, beat: string): boolean {
  if ((scene.storyCircleBeatContracts ?? []).some((contract) => contract.beat === beat)) return true;
  const profile = scene.coldOpenProfile as { storyCircleBeats?: unknown[] } | undefined;
  return Boolean(profile?.storyCircleBeats?.includes(beat));
}

export class SceneOwnershipPreflightValidator extends BaseValidator {
  constructor() {
    super('SceneOwnershipPreflightValidator');
  }

  validate(input: SceneOwnershipPreflightInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const scenes = [...(input.scenes ?? [])].sort((a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || cleanText(a.id).localeCompare(cleanText(b.id)),
    );

    const primaryAtomOwners = new Map<string, string>();
    for (const scene of scenes) {
      const sceneId = scene.id ?? 'scene';
      for (const atomId of scene.treatmentAtomIds ?? []) {
        const first = primaryAtomOwners.get(atomId);
        if (first && first !== sceneId) {
          issues.push(this.error(
            `Treatment atom "${atomId}" has multiple primary scene owners: "${first}" and "${sceneId}".`,
            sceneId,
            'Assign each playable treatment fact to exactly one primary scene and route other mentions as context.',
          ));
        } else {
          primaryAtomOwners.set(atomId, sceneId);
        }
      }

      const hardTexts = (scene.requiredBeats ?? [])
        .filter((beat) => HARD_TIERS.has(beat.tier))
        .map(beatText)
        .filter(Boolean);
      const timeCues = uniqueTimeCues(hardTexts);
      if (timeCues.length >= 2 && scene.kind !== 'encounter' && !scene.isEncounter) {
        issues.push(this.error(
          `Scene "${sceneId}" owns hard obligations with multiple time cues (${timeCues.join(', ')}).`,
          sceneId,
          'Split or route time-separated treatment facts before SceneWriter.',
        ));
      }
      const locationCues = uniqueLocationCues(scene, hardTexts);
      if (locationCues.length >= 2 && scene.kind !== 'encounter' && !scene.isEncounter) {
        issues.push(this.error(
          `Scene "${sceneId}" owns hard obligations tied to multiple major location cues (${locationCues.join(', ')}).`,
          sceneId,
          'Keep one primary dramatic location per scene and route the next location to another scene.',
        ));
      }

      for (const beat of scene.requiredBeats ?? []) {
        const text = beatText(beat);
        if (beat.tier === 'coldopen' && !isOpeningScene(scene, scenes)) {
          issues.push(this.error(
            `Scene "${sceneId}" carries a cold-open required beat but is not the episode-opening owner.`,
            sceneId,
            'Move this beat to the cold open, retier it as a scene-local authored beat, or demote it to context.',
          ));
        }
        if (beat.tier !== 'signature' && HARD_TIERS.has(beat.tier)) {
          const atoms = atomizeTreatmentText({
            episodeNumber: scene.episodeNumber ?? input.episodeNumber ?? 1,
            text,
            idPrefix: `${sceneId}-${beat.id}`,
          });
          if (atoms.length > 0 && atoms.every((atom) => atom.ownershipIntent === 'ledger_only')) {
            issues.push(this.error(
              `Scene "${sceneId}" promotes broad/logline treatment text to a hard required beat: "${text}".`,
              sceneId,
              'Keep broad premise, theme, future payoff, and Story Circle summary text as support or ledger metadata.',
            ));
          }
        }
      }

      if (sceneOwnsEncounterCue(scene) && scene.kind !== 'encounter' && !scene.isEncounter) {
        issues.push(this.error(
          `Scene "${sceneId}" owns a concrete encounter/threat cue but is not an encounter-capable scene.`,
          sceneId,
          'Route concrete encounter obligations to an encounter scene or split the scene before prose generation.',
        ));
      }
    }

    const concreteEncounterOwners = scenes.filter(sceneOwnsEncounterCue);
    if (concreteEncounterOwners.length > 0) {
      const ownerIds = concreteEncounterOwners.map((scene) => scene.id ?? 'scene').join(', ');
      for (const scene of scenes) {
        if (!isAbstractEncounterShell(scene)) continue;
        const sceneId = scene.id ?? 'scene';
        issues.push(this.error(
          `Scene "${sceneId}" is an abstract encounter shell while concrete encounter ownership belongs to ${ownerIds}.`,
          sceneId,
          'Demote this shell to pressure/context, merge its pressure into the concrete encounter owner, or give it a distinct playable event before prose generation.',
        ));
      }
    }

    const roleBeats = (input.storyCircleRole ?? [])
      .filter((role) => role.roleKind !== 'expansion')
      .map((role) => role.beat);
    for (const beat of roleBeats) {
      if (!scenes.some((scene) => sceneHasRole(scene, beat))) {
        issues.push(this.error(
          `Episode ${input.episodeNumber ?? 'unknown'} has no scene owner for required Story Circle role "${beat}".`,
          `episode-${input.episodeNumber ?? 'unknown'}`,
          'Bind the episode Story Circle role to an on-page scene before SceneWriter.',
        ));
      }
    }

    return issues.length > 0
      ? buildFailureResult(issues, 0, issues.map((issue) => issue.suggestion).filter(Boolean) as string[])
      : buildSuccessResult();
  }
}
