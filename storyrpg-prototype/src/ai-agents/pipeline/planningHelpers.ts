import type { WorldBible } from '../agents/WorldBuilder';
import type { StoryArchitectInput, SceneBlueprint } from '../agents/StoryArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { FullCreativeBrief, SourceAnalysisResult } from './FullStoryPipeline';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { SceneSettingContext } from '../utils/styleAdaptation';
import { resolveSceneSettingContext } from '../utils/styleAdaptation';
import { edgesForEpisode } from './seasonScenePlanBuilder';
import { residueObligationsForEpisode } from './residueObligations';

export function buildSeasonPlanDirectives(
  brief: FullCreativeBrief,
  emitWarning?: (message: string) => void,
): StoryArchitectInput['seasonPlanDirectives'] {
  const plan = brief.seasonPlan;
  if (!plan) return undefined;

  const epNum = brief.episode.number;
  const seasonEp = plan.episodes.find((episode) => episode.episodeNumber === epNum);
  if (!seasonEp) {
    emitWarning?.(
      `Season plan directives not found for episode ${epNum}. Generation will proceed without season plan guidance.`,
    );
    return undefined;
  }

  const plannedEncounters = (seasonEp.plannedEncounters || []).map((enc) => ({
    id: enc.id,
    type: enc.type,
    description: enc.description,
    difficulty: enc.difficulty,
    npcsInvolved: enc.npcsInvolved,
    stakes: enc.stakes,
    centralConflict: enc.centralConflict,
    storyCircleTarget: enc.storyCircleTarget,
    storyCircleTargetRationale: enc.storyCircleTargetRationale,
    storyCircleTargetEvidence: enc.storyCircleTargetEvidence,
    aftermathConsequence: enc.aftermathConsequence,
    relevantSkills: enc.relevantSkills,
    encounterBuildup: enc.encounterBuildup,
    encounterSetupContext: enc.encounterSetupContext,
    isBranchPoint: enc.isBranchPoint,
    branchOutcomes: enc.branchOutcomes,
  }));

  const incomingBranchEffects: Array<{ branchName: string; pathName: string; impact: string; description: string }> = [];
  if (seasonEp.incomingBranches) {
    for (const branchId of seasonEp.incomingBranches) {
      const branch = plan.crossEpisodeBranches.find((candidate) => candidate.id === branchId);
      if (!branch) continue;
      for (const path of branch.paths) {
        const affectedEp = path.affectedEpisodes.find((candidate) => candidate.episodeNumber === epNum);
        if (!affectedEp) continue;
        incomingBranchEffects.push({
          branchName: branch.name,
          pathName: path.name,
          impact: affectedEp.impact,
          description: affectedEp.description,
        });
      }
    }
  }

  const consequenceEffects: Array<{ description: string; severity: string }> = [];
  for (const chain of plan.consequenceChains) {
    for (const consequence of chain.consequences) {
      if (consequence.episodeNumber === epNum) {
        consequenceEffects.push({
          description: consequence.description,
          severity: consequence.severity,
        });
      }
    }
  }

  const growthCurveEntry = (plan as unknown as Record<string, unknown>).growthCurve
    ? ((plan as unknown as Record<string, unknown>).growthCurve as Array<Record<string, unknown>>)
        .find((g: Record<string, unknown>) => g.episodeNumber === epNum)
    : undefined;

  const growthContext = growthCurveEntry ? {
    focusSkills: (growthCurveEntry.focusSkills as string[]) ?? [],
    developmentScene: (growthCurveEntry.developmentScene as string) ?? '',
    mentorshipOpportunity: growthCurveEntry.mentorshipOpportunity as {
      npcId: string;
      npcName: string;
      requiredRelationship: { dimension: string; threshold: number };
      attribute: string;
      narrativeHook: string;
    } | null | undefined,
  } : undefined;

  const activeArc = plan.arcs?.find((arc) =>
    epNum >= arc.episodeRange.start && epNum <= arc.episodeRange.end
  );
  const arcPressure = activeArc ? {
    arcId: activeArc.id,
    arcName: activeArc.name,
    arcQuestion: activeArc.arcQuestion,
    seasonQuestionRelation: activeArc.seasonQuestionRelation,
    identityPressureFacet: activeArc.identityPressureFacet,
    midpointRecontextualization: activeArc.midpointRecontextualization,
    lateArcCrisis: activeArc.lateArcCrisis,
    finaleAnswer: activeArc.finaleAnswer,
    handoffPressure: activeArc.handoffPressure,
    episodeTurnout: activeArc.episodeTurnouts?.find((turnout) => turnout.episodeNumber === epNum),
  } : undefined;
  const informationLedgerEntries = (plan.informationLedger || []).filter((entry) =>
    entry.introducedEpisode === epNum ||
    entry.plannedRevealEpisode === epNum ||
    entry.plannedPayoffEpisode === epNum ||
    entry.setupTouchEpisodes?.includes(epNum)
  );
  const seasonPromiseContracts = (plan.seasonPromiseContracts || []).filter((contract) =>
    (contract.targetEpisodeNumbers ?? []).includes(epNum)
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const characterTreatmentContracts = (plan.characterTreatmentContracts || []).filter((contract) =>
    (contract.targetEpisodeNumbers ?? []).includes(epNum)
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const worldTreatmentContracts = (plan.worldTreatmentContracts || []).filter((contract) =>
    (contract.targetEpisodeNumbers ?? []).includes(epNum)
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const stakesArchitectureContracts = (plan.stakesArchitectureContracts || []).filter((contract) =>
    (contract.targetEpisodeNumbers ?? []).includes(epNum)
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const storyCircleBeatContracts = (plan.storyCircleBeatContracts || []).filter((contract) =>
    contract.targetEpisodeNumber === epNum
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const arcPressureContracts = (plan.arcPressureContracts || []).filter((contract) =>
    (contract.targetEpisodeNumbers ?? []).includes(epNum)
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const branchConsequenceContracts = (plan.branchConsequenceContracts || []).filter((contract) =>
    (contract.targetEpisodeNumbers ?? []).includes(epNum)
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const endingRealizationContracts = (plan.endingRealizationContracts || []).filter((contract) =>
    (contract.targetEpisodeNumbers ?? []).includes(epNum)
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const failureModeAuditContracts = (plan.failureModeAuditContracts || []).filter((contract) =>
    (contract.targetEpisodeNumbers ?? []).includes(epNum)
    || (contract.targetSceneIds ?? []).some((sceneId) => (seasonEp.plannedScenes ?? []).some((scene) => scene.id === sceneId))
  );
  const residueDirectives = residueObligationsForEpisode(plan.residuePlan, epNum);

  return {
    endingMode: plan.endingMode,
    resolvedEndings: plan.resolvedEndings,
    plannedEncounters: plannedEncounters.length > 0 ? plannedEncounters : undefined,
    difficultyTier: seasonEp.difficultyTier,
    incomingBranchEffects: incomingBranchEffects.length > 0 ? incomingBranchEffects : undefined,
    flagsToSet: seasonEp.setsFlags?.length ? seasonEp.setsFlags : undefined,
    flagsToCheck: seasonEp.checksFlags?.length ? seasonEp.checksFlags : undefined,
    consequenceEffects: consequenceEffects.length > 0 ? consequenceEffects : undefined,
    endingRoutes: seasonEp.endingRoutes?.length ? seasonEp.endingRoutes : undefined,
    treatmentGuidance: seasonEp.treatmentGuidance,
    growthContext,
    arcPressure,
    characterArchitecture: plan.characterArchitecture,
    characterTreatmentContracts: characterTreatmentContracts.length > 0 ? characterTreatmentContracts : undefined,
    worldTreatmentContracts: worldTreatmentContracts.length > 0 ? worldTreatmentContracts : undefined,
    stakesArchitectureContracts: stakesArchitectureContracts.length > 0 ? stakesArchitectureContracts : undefined,
    storyCircleBeatContracts: storyCircleBeatContracts.length > 0 ? storyCircleBeatContracts : undefined,
    arcPressureContracts: arcPressureContracts.length > 0 ? arcPressureContracts : undefined,
    branchConsequenceContracts: branchConsequenceContracts.length > 0 ? branchConsequenceContracts : undefined,
    endingRealizationContracts: endingRealizationContracts.length > 0 ? endingRealizationContracts : undefined,
    failureModeAuditContracts: failureModeAuditContracts.length > 0 ? failureModeAuditContracts : undefined,
    incomingResidue: residueDirectives.incomingResidue.length > 0 ? residueDirectives.incomingResidue : undefined,
    outgoingResidue: residueDirectives.outgoingResidue.length > 0 ? residueDirectives.outgoingResidue : undefined,
    dueResidue: residueDirectives.dueResidue.length > 0 ? residueDirectives.dueResidue : undefined,
    themeArgument: plan.themeArgument,
    seasonPromiseArchitecture: plan.seasonPromiseArchitecture,
    seasonPromiseContracts: seasonPromiseContracts.length > 0 ? seasonPromiseContracts : undefined,
    informationLedgerEntries: informationLedgerEntries.length > 0 ? informationLedgerEntries : undefined,
    // Scene-first planning: this episode's scenes + the setup/payoff edges that
    // touch it. When present, StoryArchitect elaborates these instead of
    // inventing a scene graph. Read from the season-level scene plan slice.
    plannedScenes: seasonEp.plannedScenes?.length ? seasonEp.plannedScenes : undefined,
    setupPayoffEdges: plan.scenePlan
      ? edgesForEpisode(plan.scenePlan, epNum)
      : undefined,
  };
}

export function createEpisodeOptions(analysis: SourceMaterialAnalysis): SourceAnalysisResult['suggestedOptions'] {
  const total = analysis.totalEstimatedEpisodes;
  const options: SourceAnalysisResult['suggestedOptions'] = [];

  options.push({
    count: 1,
    description: 'Just the first episode (quick preview)',
    episodes: [analysis.episodeBreakdown[0]?.title || 'Episode 1'],
  });

  const thirdCount = Math.max(3, Math.min(5, Math.ceil(total / 3)));
  if (thirdCount < total) {
    options.push({
      count: thirdCount,
      description: `First ${thirdCount} episodes (opening arc)`,
      episodes: analysis.episodeBreakdown.slice(0, thirdCount).map((ep) => ep.title),
    });
  }

  const halfCount = Math.ceil(total / 2);
  if (halfCount > thirdCount && halfCount < total) {
    options.push({
      count: halfCount,
      description: `First ${halfCount} episodes (through midpoint)`,
      episodes: analysis.episodeBreakdown.slice(0, halfCount).map((ep) => ep.title),
    });
  }

  options.push({
    count: total,
    description: `All ${total} episodes (complete story)`,
    episodes: analysis.episodeBreakdown.map((ep) => ep.title),
  });

  return options;
}

export function createWorldBriefFromAnalysis(
  baseBrief: FullCreativeBrief,
  analysis: SourceMaterialAnalysis,
): FullCreativeBrief {
  return {
    ...baseBrief,
    world: {
      ...baseBrief.world,
      premise: `${analysis.setting.worldDetails} Set in ${analysis.setting.location} during ${analysis.setting.timePeriod}.`,
      timePeriod: analysis.setting.timePeriod,
      keyLocations: analysis.keyLocations.map((loc) => ({
        id: loc.id,
        name: loc.name,
        type: 'location',
        description: loc.description,
        importance: loc.importance,
      })),
    },
  };
}

export function createCharacterBriefFromAnalysis(
  baseBrief: FullCreativeBrief,
  analysis: SourceMaterialAnalysis,
): FullCreativeBrief {
  const protagonistId = analysis.protagonist.id;
  const protagonistName = analysis.protagonist.name?.toLowerCase();

  return {
    ...baseBrief,
    protagonist: {
      ...baseBrief.protagonist,
      id: protagonistId,
      name: analysis.protagonist.name,
      description: analysis.protagonist.description,
      fashionStyle: analysis.protagonist.fashionStyle,
    },
    npcs: analysis.majorCharacters
      .filter((char) => char.id !== protagonistId && char.name?.toLowerCase() !== protagonistName)
      .map((char) => ({
        id: char.id,
        name: char.name,
        role:
          char.role === 'antagonist' ||
          char.role === 'ally' ||
          char.role === 'love_interest' ||
          char.role === 'mentor' ||
          char.role === 'rival' ||
          char.role === 'neutral'
            ? char.role
            : 'neutral',
        description: char.description,
        fashionStyle: char.fashionStyle,
        importance:
          char.importance === 'core'
            ? 'major'
            : char.importance === 'supporting'
              ? 'supporting'
              : 'minor',
      })),
  };
}

export function buildSceneSettingContext(
  sceneBlueprint: Pick<SceneBlueprint, 'id' | 'name' | 'description' | 'location' | 'mood'>,
  location: WorldBible['locations'][number] | undefined,
  worldBible: WorldBible,
  brief: FullCreativeBrief,
): SceneSettingContext {
  return resolveSceneSettingContext({
    sceneName: sceneBlueprint.name,
    sceneDescription: sceneBlueprint.description,
    sceneMood: sceneBlueprint.mood,
    authoredLocationId: location?.id,
    authoredLocationName: location?.name,
    authoredLocationType: location?.type,
    authoredLocationDescription: location?.fullDescription || location?.overview,
    locationThreshold: location?.type === 'threshold',
    worldPremise: brief.world.premise,
    worldTimePeriod: brief.world.timePeriod,
    worldTechnologyLevel: brief.world.technologyLevel,
    worldMagicSystem: brief.world.magicSystem,
    worldRules: worldBible.worldRules,
    worldCustoms: worldBible.customs,
    worldBeliefs: worldBible.beliefs,
  });
}

export function inferEnvironmentPersonality(
  location: { type: string; description?: string; fullDescription?: string },
): 'neutral' | 'oppressive' | 'protective' | 'expansive' | 'decaying' | 'thriving' | 'liminal' {
  const desc = `${location.fullDescription || location.description || ''} ${location.type}`.toLowerCase();

  if (desc.includes('oppress') || desc.includes('dark') || desc.includes('prison') || desc.includes('hostile')) {
    return 'oppressive';
  }
  if (desc.includes('safe') || desc.includes('home') || desc.includes('sanctuary') || desc.includes('protect')) {
    return 'protective';
  }
  if (desc.includes('vast') || desc.includes('open') || desc.includes('expanse') || desc.includes('freedom')) {
    return 'expansive';
  }
  if (desc.includes('decay') || desc.includes('ruin') || desc.includes('abandon') || desc.includes('crumbl')) {
    return 'decaying';
  }
  if (desc.includes('thriv') || desc.includes('bustl') || desc.includes('vibrant') || desc.includes('alive')) {
    return 'thriving';
  }
  if (desc.includes('threshold') || desc.includes('border') || desc.includes('boundary') || desc.includes('between')) {
    return 'liminal';
  }

  return 'neutral';
}

export function getLocationInfoForScene(
  scene: SceneContent,
  worldBible: WorldBible,
): {
  locationId: string;
  locationName: string;
  basePersonality: 'neutral' | 'oppressive' | 'protective' | 'expansive' | 'decaying' | 'thriving' | 'liminal';
  description: string;
  isThreshold?: boolean;
} | undefined {
  if (scene.locationId) {
    const authoredLocation = worldBible.locations.find((loc) => loc.id === scene.locationId);
    if (authoredLocation) {
      return {
        locationId: authoredLocation.id,
        locationName: authoredLocation.name,
        basePersonality: inferEnvironmentPersonality(authoredLocation),
        description: authoredLocation.fullDescription || authoredLocation.overview,
        isThreshold: authoredLocation.type === 'threshold',
      };
    }
  }

  if (scene.settingContext?.locationName) {
    const contextualLocation = worldBible.locations.find((loc) => loc.name === scene.settingContext?.locationName);
    if (contextualLocation) {
      return {
        locationId: contextualLocation.id,
        locationName: contextualLocation.name,
        basePersonality: inferEnvironmentPersonality(contextualLocation),
        description: contextualLocation.fullDescription || contextualLocation.overview,
        isThreshold: contextualLocation.type === 'threshold',
      };
    }
  }

  const sceneName = scene.sceneName.toLowerCase();
  for (const loc of worldBible.locations) {
    const locName = loc.name.toLowerCase();
    if (sceneName.includes(locName) || locName.includes(sceneName.split(' ')[0])) {
      return {
        locationId: loc.id,
        locationName: loc.name,
        basePersonality: inferEnvironmentPersonality(loc),
        description: loc.fullDescription || loc.overview,
        isThreshold: loc.type === 'threshold' || sceneName.includes('threshold') || sceneName.includes('boundary'),
      };
    }
  }

  if (worldBible.locations.length > 0) {
    const defaultLoc = worldBible.locations[0];
    return {
      locationId: defaultLoc.id,
      locationName: defaultLoc.name,
      basePersonality: 'neutral',
      description: defaultLoc.fullDescription || defaultLoc.overview,
    };
  }

  return undefined;
}
