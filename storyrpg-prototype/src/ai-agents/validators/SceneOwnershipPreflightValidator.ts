import type { RequiredBeat, SceneConstructionProfile, SceneEventOwnershipProfile, SceneTurnContract, StoryCircleBeatRealizationContract } from '../../types/scenePlan';
import type { EpisodeSpineContract } from '../../types/episodeSpine';
import type { StoryCircleRoleAssignment } from '../../types/sourceAnalysis';
import { atomizeTreatmentText } from '../utils/treatmentEventAtomizer';
import { detectPrimaryStoryEventCues } from '../remediation/storyEventCues';
import { detectSpatialUnitViolations } from '../utils/sceneSpatialUnitPolicy';
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
  spineUnitId?: string;
}

export interface SceneOwnershipPreflightInput {
  episodeNumber?: number;
  storyCircleRole?: StoryCircleRoleAssignment[];
  episodeSpine?: EpisodeSpineContract;
  /** Canonical event order permits multiple causal events in one scene. */
  episodeEventPlan?: {
    orderedEventIds: string[];
    assignments: Array<{ eventId: string; sceneId: string }>;
  };
  scenes: SceneOwnershipPreflightScene[];
}

const HARD_TIERS = new Set<RequiredBeat['tier']>(['authored', 'signature', 'coldopen']);
const FIRST_EVENT_RE = /\b(?:first|first-ever|for the first time|initial)\b/i;
const SINGLE_OWNER_CUES = new Set([
  'venueDoor',
  'objectHandoff',
  'threatEncounter',
  'antagonistContact',
  'blogAftermath',
]);
const CAUSAL_CUE_PREREQUISITES = new Map<string, string[]>([
  ['blogAftermath', ['lateNightWriting']],
]);

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

function sameSceneCausalPrerequisiteIsOrdered(
  scene: SceneOwnershipPreflightScene,
  dependentCue: string,
  prerequisiteCue: string,
  episodeEventPlan: SceneOwnershipPreflightInput['episodeEventPlan'],
): boolean {
  if (!episodeEventPlan) return false;
  const orderByEventId = new Map(episodeEventPlan.orderedEventIds.map((eventId, index) => [eventId, index]));
  const eventIdsForScene = new Set(
    episodeEventPlan.assignments
      .filter((assignment) => assignment.sceneId === scene.id)
      .map((assignment) => assignment.eventId),
  );
  const owned = scene.sceneEventOwnership?.ownedEvents ?? [];
  const prerequisiteOrders = owned
    .filter((event) => event.cue === prerequisiteCue && eventIdsForScene.has(event.eventContractId ?? event.key))
    .map((event) => orderByEventId.get(event.eventContractId ?? event.key))
    .filter((order): order is number => order != null);
  const dependentOrders = owned
    .filter((event) => event.cue === dependentCue && eventIdsForScene.has(event.eventContractId ?? event.key))
    .map((event) => orderByEventId.get(event.eventContractId ?? event.key))
    .filter((order): order is number => order != null);
  return prerequisiteOrders.some((prerequisiteOrder) =>
    dependentOrders.some((dependentOrder) => prerequisiteOrder < dependentOrder),
  );
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
    const eventOwners = new Map<string, string>();
    const ownedCueIndices = new Map<string, number[]>();
    for (const scene of scenes) {
      const sceneId = scene.id ?? 'scene';
      const sceneIndex = scenes.indexOf(scene);
      for (const event of scene.sceneEventOwnership?.ownedEvents ?? []) {
        const cueIndices = ownedCueIndices.get(event.cue) ?? [];
        cueIndices.push(sceneIndex);
        ownedCueIndices.set(event.cue, cueIndices);
        if (!SINGLE_OWNER_CUES.has(event.cue) && !FIRST_EVENT_RE.test(event.text)) continue;
        const firstOwner = eventOwners.get(event.key);
        if (firstOwner && firstOwner !== sceneId) {
          issues.push(this.error(
            `Scene "${sceneId}" duplicates first-event ownership of ${event.cue}; first owner is "${firstOwner}".`,
            sceneId,
            'Keep the first event on one scene owner and route later mentions as consequence, callback, or aftermath.',
          ));
        } else {
          eventOwners.set(event.key, sceneId);
        }
      }
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
      const spatialViolation = detectSpatialUnitViolations({
        sceneId,
        kind: scene.kind,
        isEncounter: scene.isEncounter,
        locations: scene.locations,
        location: scene.location,
        requiredBeats: scene.requiredBeats,
        sceneEventOwnership: scene.sceneEventOwnership,
      });
      if (spatialViolation) {
        issues.push(this.error(
          `Scene "${sceneId}" owns hard obligations tied to multiple major location cues (${spatialViolation.locationCues.join(', ')}).`,
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

    for (const [cue, prerequisiteCues] of CAUSAL_CUE_PREREQUISITES) {
      for (const cueIndex of ownedCueIndices.get(cue) ?? []) {
        for (const prerequisiteCue of prerequisiteCues) {
          const prerequisiteIndices = ownedCueIndices.get(prerequisiteCue) ?? [];
          if (prerequisiteIndices.some((index) => index < cueIndex)) continue;
          if (sameSceneCausalPrerequisiteIsOrdered(
            scenes[cueIndex],
            cue,
            prerequisiteCue,
            input.episodeEventPlan,
          )) continue;
          const sceneId = scenes[cueIndex]?.id ?? 'scene';
          issues.push(this.error(
            `Scene "${sceneId}" owns ${cue} before its prerequisite event ${prerequisiteCue} has an earlier owner.`,
            sceneId,
            `Assign ${prerequisiteCue} to an earlier scene, or defer ${cue} until after that event.`,
          ));
        }
      }
    }

    if (input.episodeSpine) {
      const ownerByUnit = new Map<string, { scene: SceneOwnershipPreflightScene; index: number }>();
      const canonicalOwnerByUnit = new Map<string, string>();
      for (const assignment of input.episodeEventPlan?.assignments ?? []) {
        const unitId = assignment.eventId
          .replace(/^event:/, '')
          .replace(/:aftermath$/, '');
        if (input.episodeSpine.units.some((unit) => unit.id === unitId)) {
          canonicalOwnerByUnit.set(unitId, assignment.sceneId);
        }
      }
      scenes.forEach((scene, index) => {
        const canonicalUnitIds = [...canonicalOwnerByUnit.entries()]
          .filter(([, sceneId]) => sceneId === scene.id)
          .map(([unitId]) => unitId);
        const unitIds = input.episodeEventPlan && canonicalUnitIds.length > 0
          ? canonicalUnitIds
          : scene.spineUnitId
            ? [scene.spineUnitId]
            : [];
        for (const unitId of unitIds) {
          const prior = ownerByUnit.get(unitId);
          if (prior && prior.scene.id !== scene.id) {
            issues.push(this.error(
              `ESC unit "${unitId}" has multiple scene owners: "${prior.scene.id ?? 'scene'}" and "${scene.id ?? 'scene'}".`,
              scene.id,
              'Assign each ESC event unit to exactly one scene before prose generation.',
            ));
            continue;
          }
          ownerByUnit.set(unitId, { scene, index });
        }
      });
      for (const unit of input.episodeSpine.units) {
        const owner = ownerByUnit.get(unit.id);
        if (!owner) {
          issues.push(this.error(
            `ESC unit "${unit.id}" (${unit.kind}) has no scene owner.`,
            `episode-${input.episodeSpine.episodeNumber}`,
            'Project every in-scope ESC unit onto one scene before prose generation.',
          ));
          continue;
        }
        for (const prerequisiteId of unit.prerequisites) {
          const prerequisiteOwner = ownerByUnit.get(prerequisiteId);
          if (!prerequisiteOwner) {
            issues.push(this.error(
              `ESC unit "${unit.id}" depends on "${prerequisiteId}", but the prerequisite has no scene owner.`,
              owner.scene.id,
              'Project the prerequisite unit before its dependent event.',
            ));
          } else if (
            prerequisiteOwner.index > owner.index
            || (prerequisiteOwner.index === owner.index && !input.episodeEventPlan)
          ) {
            issues.push(this.error(
              `ESC causal inversion: "${unit.id}" (${unit.kind}) is owned by "${owner.scene.id ?? 'scene'}" before prerequisite "${prerequisiteId}" owned by "${prerequisiteOwner.scene.id ?? 'scene'}".`,
              owner.scene.id,
              'Reorder scene ownership to preserve prerequisite → event → aftermath.',
            ));
          }
        }
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
