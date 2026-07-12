import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import type { EpisodeEventPlan } from '../../types/narrativeContract';
import type { PlannedScene } from '../../types/scenePlan';

export interface LockedBlueprintProjection {
  scenes: SceneBlueprint[];
  restoredSceneIds: string[];
  missingPlannedSceneIds: string[];
  outsidePlanSceneIds: string[];
}

function purposeForPlannedScene(scene: PlannedScene): SceneBlueprint['purpose'] {
  if (scene.kind === 'encounter' || scene.narrativeRole === 'turn' || scene.narrativeRole === 'payoff') {
    return 'bottleneck';
  }
  if (scene.narrativeRole === 'release') return 'transition';
  return 'branch';
}

function buildMissingSceneShell(scene: PlannedScene): SceneBlueprint {
  const localPurpose = scene.dramaticPurpose || scene.title;
  const isEncounter = scene.kind === 'encounter';
  const sceneEventOwnership = scene.sceneEventOwnership;
  return {
    id: scene.id,
    name: scene.title || `Scene ${scene.order + 1}`,
    description: localPurpose,
    location: scene.locations?.[0] || '',
    timeOfDay: scene.timeOfDay as SceneBlueprint['timeOfDay'],
    timeJumpFromPrevious: scene.timeJump,
    mood: isEncounter ? 'tense' : 'charged',
    purpose: purposeForPlannedScene(scene),
    dramaticQuestion: localPurpose,
    wantVsNeed: scene.stakes || localPurpose,
    conflictEngine: scene.stakes || scene.encounter?.centralConflict || localPurpose,
    npcsPresent: [...(scene.npcsInvolved ?? [])],
    narrativeFunction: localPurpose,
    narrativeRole: scene.narrativeRole,
    planningOrigin: scene.planningOrigin,
    plannedHasChoice: scene.hasChoice,
    dramaticPurpose: localPurpose,
    setsUp: [...(scene.setsUp ?? [])],
    paysOff: [...(scene.paysOff ?? [])],
    requiredBeats: scene.requiredBeats ? [...scene.requiredBeats] : undefined,
    treatmentAtomIds: scene.treatmentAtomIds ? [...scene.treatmentAtomIds] : undefined,
    ownedChronologyKeys: scene.ownedChronologyKeys ? [...scene.ownedChronologyKeys] : undefined,
    sourceContextIds: scene.sourceContextIds ? [...scene.sourceContextIds] : undefined,
    nonCopyableContext: scene.nonCopyableContext ? [...scene.nonCopyableContext] : undefined,
    signatureMoment: scene.signatureMoment,
    turnContract: scene.turnContract,
    coldOpenProfile: scene.coldOpenProfile,
    sceneConstructionProfile: scene.sceneConstructionProfile,
    sceneEventOwnership,
    narrativeEventIds: scene.narrativeEventIds ? [...scene.narrativeEventIds] : undefined,
    narrativeEventOrder: scene.narrativeEventOrder,
    narrativeEventPlanVersion: scene.narrativeEventPlanVersion,
    realizedEventIds: scene.narrativeEventIds ? [...scene.narrativeEventIds] : undefined,
    supportingContractIds: sceneEventOwnership?.sourceContractIds
      ? [...sceneEventOwnership.sourceContractIds]
      : undefined,
    relationshipPacing: scene.relationshipPacing ? [...scene.relationshipPacing] : undefined,
    mechanicPressure: scene.mechanicPressure ? [...scene.mechanicPressure] : undefined,
    authoredTreatmentFields: scene.authoredTreatmentFields ? [...scene.authoredTreatmentFields] : undefined,
    seasonPromiseContracts: scene.seasonPromiseContracts ? [...scene.seasonPromiseContracts] : undefined,
    stakesArchitectureContracts: scene.stakesArchitectureContracts ? [...scene.stakesArchitectureContracts] : undefined,
    storyCircleBeatContracts: scene.storyCircleBeatContracts ? [...scene.storyCircleBeatContracts] : undefined,
    arcPressureContracts: scene.arcPressureContracts ? [...scene.arcPressureContracts] : undefined,
    branchConsequenceContracts: scene.branchConsequenceContracts ? [...scene.branchConsequenceContracts] : undefined,
    endingRealizationContracts: scene.endingRealizationContracts ? [...scene.endingRealizationContracts] : undefined,
    failureModeAuditContracts: scene.failureModeAuditContracts ? [...scene.failureModeAuditContracts] : undefined,
    characterTreatmentContracts: scene.characterTreatmentContracts ? [...scene.characterTreatmentContracts] : undefined,
    worldTreatmentContracts: scene.worldTreatmentContracts ? [...scene.worldTreatmentContracts] : undefined,
    choicePoint: scene.hasChoice && scene.choiceType
      ? {
          type: scene.choiceType,
          stakes: { want: '', cost: '', identity: '' },
          description: '',
          optionHints: [],
        }
      : undefined,
    keyBeats: [localPurpose],
    leadsTo: [],
    requires: [],
    spineUnitId: scene.spineUnitId,
    encounterProfile: scene.encounterProfile || scene.encounter?.encounterProfile,
    isEncounter,
    plannedEncounterId: isEncounter ? scene.id : undefined,
    encounterType: scene.encounter?.type,
    encounterStyle: scene.encounter?.style,
    encounterDescription: scene.encounter?.description || scene.encounter?.sourceSynopsis,
    encounterCentralConflict: scene.encounter?.centralConflict,
    encounterStoryCircleTarget: scene.encounter?.storyCircleTarget,
    encounterStoryCircleTargetRationale: scene.encounter?.storyCircleTargetRationale,
    encounterStoryCircleTargetEvidence: scene.encounter?.storyCircleTargetEvidence,
    encounterStakes: scene.stakes,
    encounterRelevantSkills: scene.encounter?.relevantSkills,
    encounterDifficulty: scene.encounter?.difficulty,
    encounterBuildup: scene.dramaticPurpose,
  };
}

/**
 * Restore the model's scene vector onto the immutable episode topology. This
 * only restores shells already present in the locked plan; it never invents a
 * scene, event, or reader-facing prose. Existing model metadata is retained
 * for matching ids and canonical ownership is reprojected by the caller.
 */
export function projectBlueprintOntoLockedEpisodePlan(
  blueprint: EpisodeBlueprint,
  lockedPlan: EpisodeEventPlan,
  plannedScenes: PlannedScene[],
): LockedBlueprintProjection {
  const existingById = new Map((blueprint.scenes ?? []).map((scene) => [scene.id, scene]));
  const plannedById = new Map(plannedScenes.map((scene) => [scene.id, scene]));
  const expectedIds = new Set(lockedPlan.sceneOrder);
  const restoredSceneIds: string[] = [];
  const missingPlannedSceneIds: string[] = [];
  const scenes: SceneBlueprint[] = [];

  for (const sceneId of lockedPlan.sceneOrder) {
    const existing = existingById.get(sceneId);
    if (existing) {
      scenes.push(existing);
      continue;
    }
    const planned = plannedById.get(sceneId);
    if (!planned) {
      missingPlannedSceneIds.push(sceneId);
      continue;
    }
    scenes.push(buildMissingSceneShell(planned));
    restoredSceneIds.push(sceneId);
  }

  return {
    scenes: [
      ...scenes,
      ...(blueprint.scenes ?? []).filter((scene) => !expectedIds.has(scene.id)),
    ],
    restoredSceneIds,
    missingPlannedSceneIds,
    outsidePlanSceneIds: (blueprint.scenes ?? [])
      .filter((scene) => !expectedIds.has(scene.id))
      .map((scene) => scene.id),
  };
}
