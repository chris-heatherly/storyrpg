import type { Beat, Choice, Scene, Story } from '../../types';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type {
  ArcPressureTreatmentContract,
  AuthoredTreatmentFieldContract,
  AuthoredTreatmentFieldKind,
  BranchConsequenceRealizationContract,
  EndingRealizationContract,
  FailureModeAuditContract,
  PlannedScene,
  SeasonScenePlan,
  StoryCircleBeatRealizationContract,
  StakesArchitectureContract,
  WorldTreatmentRealizationContract,
} from '../../types/scenePlan';
import {
  branchConsequenceMatchThreshold,
  buildBranchConsequenceContracts,
} from '../utils/branchConsequenceContracts';
import {
  buildEndingRealizationContracts,
  endingRealizationMatchThreshold,
} from '../utils/endingRealizationContracts';
import {
  buildFailureModeAuditContracts,
  failureModeAuditMatchThreshold,
} from '../utils/failureModeAuditContracts';
import {
  buildStakesArchitectureContracts,
  stakesArchitectureMatchThreshold,
} from '../utils/stakesArchitectureContracts';
import {
  buildStoryCircleBeatContracts,
  storyCircleBeatMatchThreshold,
} from '../utils/storyCircleBeatContracts';
import {
  arcPressureMatchThreshold,
  buildArcPressureContracts,
} from '../utils/arcPressureContracts';
import {
  buildAuthoredTreatmentFieldContracts,
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from '../utils/treatmentFieldContracts';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface TreatmentFieldUtilizationInput {
  story?: Story;
  seasonPlan?: SeasonPlan;
  sourceAnalysis?: SourceMaterialAnalysis;
  treatmentSourced?: boolean;
  phase?: 'plan' | 'final';
}

const FINAL_FIELD_KINDS = new Set<AuthoredTreatmentFieldKind>([
  'pressure_lane',
  'encounter_anchor',
  'encounter_conflict',
  'stakes_layer',
  'theme_angle',
  'lie_pressure',
  'encounter_buildup',
  'major_choice_pressure',
  'alternative_path',
  'information_movement',
  'consequence_seed',
  'ending_turnout',
  'resolved_episode_tension',
  'cliffhanger_hook',
  'cliffhanger_question',
  'next_episode_pressure',
  'cliffhanger_setup',
  'cliffhanger_type',
  'emotional_charge',
  'end_state_change',
]);

const ENDING_KINDS = new Set<AuthoredTreatmentFieldKind>([
  'ending_turnout',
  'resolved_episode_tension',
  'cliffhanger_hook',
  'cliffhanger_question',
  'next_episode_pressure',
  'cliffhanger_setup',
  'cliffhanger_type',
  'emotional_charge',
  'end_state_change',
]);

function contractsFromAnalysis(analysis?: SourceMaterialAnalysis): AuthoredTreatmentFieldContract[] {
  return buildAuthoredTreatmentFieldContracts(
    (analysis?.episodeBreakdown ?? []).map((episode) => ({
      episodeNumber: episode.episodeNumber,
      treatmentGuidance: episode.treatmentGuidance,
    })),
  );
}

function worldContractsFromInput(input: TreatmentFieldUtilizationInput): WorldTreatmentRealizationContract[] {
  const contracts = input.seasonPlan?.worldTreatmentContracts ?? input.sourceAnalysis?.worldTreatmentContracts ?? [];
  return contracts.filter((contract) => contract.blockingLevel !== 'warning');
}

function stakesContractsFromInput(input: TreatmentFieldUtilizationInput): StakesArchitectureContract[] {
  const contracts = input.seasonPlan?.stakesArchitectureContracts
    ?? input.sourceAnalysis?.stakesArchitectureContracts
    ?? buildStakesArchitectureContracts({
      guidance: input.sourceAnalysis?.treatmentSeasonGuidance,
      totalEpisodes: input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes ?? 1,
      treatmentSourced: input.treatmentSourced ?? input.sourceAnalysis?.sourceFormat === 'story_treatment',
    });
  return contracts.filter((contract) => contract.blockingLevel !== 'warning');
}

function storyCircleContractsFromInput(input: TreatmentFieldUtilizationInput): StoryCircleBeatRealizationContract[] {
  const contracts = input.seasonPlan?.storyCircleBeatContracts
    ?? input.seasonPlan?.scenePlan?.storyCircleBeatContracts
    ?? input.sourceAnalysis?.storyCircleBeatContracts
    ?? buildStoryCircleBeatContracts({
      guidance: input.sourceAnalysis?.treatmentSeasonGuidance,
      storyCircle: input.seasonPlan?.storyCircle ?? input.sourceAnalysis?.storyCircle,
      legacyStructure: input.seasonPlan?.legacyStructure ?? input.sourceAnalysis?.legacyStructure,
      totalEpisodes: input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes ?? 1,
      treatmentSourced: input.treatmentSourced ?? input.sourceAnalysis?.sourceFormat === 'story_treatment',
    });
  return contracts.filter((contract) => contract.blockingLevel !== 'warning');
}

function arcPressureContractsFromInput(input: TreatmentFieldUtilizationInput): ArcPressureTreatmentContract[] {
  const contracts = input.seasonPlan?.arcPressureContracts
    ?? input.seasonPlan?.scenePlan?.arcPressureContracts
    ?? input.sourceAnalysis?.arcPressureContracts
    ?? buildArcPressureContracts({
      guidance: input.sourceAnalysis?.treatmentSeasonGuidance,
      arcs: input.seasonPlan?.arcs,
      totalEpisodes: input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes ?? 1,
      treatmentSourced: input.treatmentSourced ?? input.sourceAnalysis?.sourceFormat === 'story_treatment',
    });
  return contracts.filter((contract) => contract.blockingLevel !== 'warning');
}

function branchConsequenceContractsFromInput(input: TreatmentFieldUtilizationInput): BranchConsequenceRealizationContract[] {
  const contracts = input.seasonPlan?.branchConsequenceContracts
    ?? input.seasonPlan?.scenePlan?.branchConsequenceContracts
    ?? input.sourceAnalysis?.branchConsequenceContracts
    ?? buildBranchConsequenceContracts({
      branches: input.sourceAnalysis?.treatmentBranches,
      endings: input.seasonPlan?.resolvedEndings ?? input.sourceAnalysis?.resolvedEndings,
      totalEpisodes: input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes ?? 1,
      treatmentSourced: input.treatmentSourced ?? input.sourceAnalysis?.sourceFormat === 'story_treatment',
    });
  return contracts.filter((contract) => contract.blockingLevel !== 'warning');
}

function endingRealizationContractsFromInput(input: TreatmentFieldUtilizationInput): EndingRealizationContract[] {
  const branchContracts = branchConsequenceContractsFromInput(input);
  const contracts = input.seasonPlan?.endingRealizationContracts
    ?? input.seasonPlan?.scenePlan?.endingRealizationContracts
    ?? input.sourceAnalysis?.endingRealizationContracts
    ?? buildEndingRealizationContracts({
      endings: input.seasonPlan?.resolvedEndings ?? input.sourceAnalysis?.resolvedEndings,
      totalEpisodes: input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes ?? 1,
      treatmentSourced: input.treatmentSourced ?? input.sourceAnalysis?.sourceFormat === 'story_treatment',
      branchContracts,
    });
  return contracts.filter((contract) => contract.blockingLevel !== 'warning');
}

function failureModeAuditContractsFromInput(input: TreatmentFieldUtilizationInput): FailureModeAuditContract[] {
  const contracts = input.seasonPlan?.failureModeAuditContracts
    ?? input.seasonPlan?.scenePlan?.failureModeAuditContracts
    ?? input.sourceAnalysis?.failureModeAuditContracts
    ?? buildFailureModeAuditContracts({
      guidance: input.sourceAnalysis?.treatmentSeasonGuidance,
      totalEpisodes: input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes ?? 1,
      treatmentSourced: input.treatmentSourced ?? input.sourceAnalysis?.sourceFormat === 'story_treatment',
      linkedContracts: [
        input.seasonPlan?.stakesArchitectureContracts ?? input.sourceAnalysis?.stakesArchitectureContracts,
        input.seasonPlan?.arcPressureContracts ?? input.sourceAnalysis?.arcPressureContracts,
        input.seasonPlan?.branchConsequenceContracts ?? input.sourceAnalysis?.branchConsequenceContracts,
        input.seasonPlan?.endingRealizationContracts ?? input.sourceAnalysis?.endingRealizationContracts,
        input.seasonPlan?.characterTreatmentContracts ?? input.sourceAnalysis?.characterTreatmentContracts,
        input.seasonPlan?.worldTreatmentContracts ?? input.sourceAnalysis?.worldTreatmentContracts,
        input.seasonPlan?.seasonPromiseContracts,
      ],
    });
  return contracts.filter((contract) => contract.blockingLevel !== 'warning');
}

function deepText(value: unknown, depth = 0): string {
  if (value === undefined || value === null || depth > 8) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => deepText(item, depth + 1)).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(image|audio|video|url|path|base64|mime|embedding|vector)/i.test(key))
      .map(([, item]) => deepText(item, depth + 1))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function choiceText(choice: Choice): string {
  return [
    choice.text,
    choice.lockedText,
    choice.reactionText,
    choice.storyVerb,
    choice.tintFlag,
    choice.visualResidueHint,
    choice.feedbackCue?.echoSummary,
    choice.feedbackCue?.progressSummary,
    choice.reminderPlan?.immediate,
    choice.reminderPlan?.shortTerm,
    choice.reminderPlan?.later,
    ...(choice.residueHints ?? []).map((hint) => hint.description),
    ...(choice.witnessReactions ?? []).map((reaction) => `${reaction.reactionText} ${reaction.residueHint ?? ''}`),
    choice.failureResidue?.description,
    deepText(choice.conditions),
    deepText(choice.consequences),
    deepText(choice.delayedConsequences),
    deepText(choice.mechanicPressure),
  ].filter(Boolean).join(' ');
}

function beatText(beat: Beat): string {
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
    ...(beat.textVariants ?? []).map((variant) => variant.text),
    ...((beat.choices ?? []) as Choice[]).map(choiceText),
    deepText(beat.onShow),
  ].filter(Boolean).join(' ');
}

function sceneText(scene: Scene): string {
  return [
    scene.name,
    scene.sequenceIntent?.startState,
    scene.sequenceIntent?.turningPoint,
    scene.sequenceIntent?.endState,
    scene.turnContract?.centralTurn,
    scene.turnContract?.afterState,
    deepText(scene.relationshipPacing),
    deepText(scene.mechanicPressure),
    deepText(scene.stakesArchitectureContracts),
    deepText(scene.arcPressureContracts),
    deepText(scene.branchConsequenceContracts),
    deepText(scene.endingRealizationContracts),
    deepText(scene.failureModeAuditContracts),
    deepText(scene.encounter),
    ...(scene.beats ?? []).map(beatText),
  ].filter(Boolean).join(' ');
}

function plannedSceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.beforeState,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    scene.signatureMoment,
    deepText(scene.requiredBeats),
    deepText(scene.relationshipPacing),
    deepText(scene.mechanicPressure),
    deepText(scene.storyCircleBeatContracts),
    deepText(scene.arcPressureContracts),
    deepText(scene.encounter),
    deepText(scene.worldTreatmentContracts),
    deepText(scene.stakesArchitectureContracts),
    deepText(scene.branchConsequenceContracts),
    deepText(scene.endingRealizationContracts),
    deepText(scene.failureModeAuditContracts),
  ].filter(Boolean).join(' ');
}

function episodeStoryText(story: Story | undefined, episodeNumber: number): string {
  const episode = story?.episodes?.find((candidate) => candidate.number === episodeNumber);
  if (!episode) return '';
  return [
    episode.title,
    episode.synopsis,
    ...(episode.scenes ?? []).map(sceneText),
    deepText(episode.onComplete),
  ].filter(Boolean).join(' ');
}

function finalSceneText(story: Story | undefined, episodeNumber: number): string {
  const episode = story?.episodes?.find((candidate) => candidate.number === episodeNumber);
  const scenes = episode?.scenes ?? [];
  if (scenes.length === 0) return '';
  const terminal = scenes.filter((scene) => (scene.leadsTo ?? []).length === 0);
  return (terminal.length ? terminal : scenes.slice(-1)).map(sceneText).join(' ');
}

function targetedStoryText(
  story: Story | undefined,
  scenePlan: SeasonScenePlan | undefined,
  contract: AuthoredTreatmentFieldContract,
): string {
  const targetIds = new Set(contract.targetSceneIds);
  if (targetIds.size === 0 && scenePlan) {
    for (const planned of scenePlan.scenes ?? []) {
      if ((planned.authoredTreatmentFields ?? []).some((field) => field.id === contract.id)) {
        targetIds.add(planned.id);
      }
    }
  }
  if (targetIds.size === 0) return '';
  const parts: string[] = [];
  for (const episode of story?.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (targetIds.has(scene.id)) parts.push(sceneText(scene));
    }
  }
  return parts.join(' ');
}

function planEpisodeText(plan: SeasonPlan | undefined, episodeNumber: number): string {
  const episode = plan?.episodes?.find((candidate) => candidate.episodeNumber === episodeNumber);
  const scenes = plan?.scenePlan?.scenes?.filter((scene) => scene.episodeNumber === episodeNumber) ?? [];
  const choiceMoments = plan?.choiceMoments?.filter((moment) => moment.episode === episodeNumber || moment.paysOffEpisode === episodeNumber) ?? [];
  const info = plan?.informationLedger?.filter((entry) =>
    entry.introducedEpisode === episodeNumber
    || entry.plannedRevealEpisode === episodeNumber
    || entry.plannedPayoffEpisode === episodeNumber
    || (entry.setupTouchEpisodes ?? []).includes(episodeNumber)
  ) ?? [];
  const chains = plan?.consequenceChains?.filter((chain) =>
    chain.origin?.episodeNumber === episodeNumber
    || (chain.consequences ?? []).some((consequence) => consequence.episodeNumber === episodeNumber)
  ) ?? [];
  return [
    episode?.title,
    episode?.synopsis,
    episode?.cliffhangerPlan?.hook,
    episode?.cliffhangerPlan?.setup,
    episode?.cliffhangerPlan?.resolvedEpisodeTension,
    episode?.cliffhangerPlan?.newOpenQuestion,
    episode?.cliffhangerPlan?.emotionalCharge,
    episode?.cliffhangerPlan?.nextEpisodePressure,
    episode?.cliffhangerPlan?.type,
    ...scenes.map(plannedSceneText),
    deepText(choiceMoments),
    deepText(info),
    deepText(chains),
  ].filter(Boolean).join(' ');
}

function nextEpisodePlanText(plan: SeasonPlan | undefined, episodeNumber: number): string {
  const next = plan?.episodes?.find((candidate) => candidate.episodeNumber === episodeNumber + 1);
  const scenes = plan?.scenePlan?.scenes?.filter((scene) => scene.episodeNumber === episodeNumber + 1) ?? [];
  return [
    next?.title,
    next?.synopsis,
    next?.cliffhangerPlan?.hook,
    ...scenes.slice(0, 2).map(plannedSceneText),
  ].filter(Boolean).join(' ');
}

function contractPlanTargets(
  plan: SeasonPlan | undefined,
  contract: AuthoredTreatmentFieldContract,
): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  const scenes = plan?.scenePlan?.scenes ?? [];
  for (const scene of scenes) {
    if ((scene.authoredTreatmentFields ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return scenes.filter((scene) => scene.episodeNumber === contract.episodeNumber && targetIds.has(scene.id));
}

function hasPlannedContractMetadata(plan: SeasonPlan | undefined, contract: AuthoredTreatmentFieldContract): boolean {
  if ((plan?.scenePlan?.authoredTreatmentFields ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.authoredTreatmentFields ?? []).some((field) => field.id === contract.id && (field.targetSceneIds?.length ?? 0) > 0)
  );
}

function hasStructuredPlanUse(plan: SeasonPlan | undefined, contract: AuthoredTreatmentFieldContract): boolean {
  const targets = contractPlanTargets(plan, contract);
  const targetText = targets.map(plannedSceneText).join(' ');
  const episodeText = planEpisodeText(plan, contract.episodeNumber);
  const haystack = `${targetText} ${episodeText}`;
  const match = treatmentFieldCloseMatch(contract.sourceText, haystack, matchThreshold(contract));

  switch (contract.contractKind) {
    case 'encounter_anchor':
    case 'encounter_conflict':
    case 'encounter_buildup':
      return targets.some((scene) => scene.kind === 'encounter' || Boolean(scene.encounter))
        || match;
    case 'major_choice_pressure':
      return targets.some((scene) => scene.hasChoice)
        || (plan?.choiceMoments ?? []).some((moment) =>
          moment.episode === contract.episodeNumber
          && treatmentFieldCloseMatch(contract.sourceText, deepText(moment), 0.25)
        )
        || match;
    case 'alternative_path':
      return targets.some((scene) => scene.consequenceTier === 'branch' || scene.consequenceTier === 'branchlet')
        || (plan?.choiceMoments ?? []).some((moment) => moment.episode === contract.episodeNumber)
        || match;
    case 'information_movement':
      return (plan?.informationLedger ?? []).some((entry) =>
        (entry.introducedEpisode === contract.episodeNumber
          || entry.plannedRevealEpisode === contract.episodeNumber
          || entry.plannedPayoffEpisode === contract.episodeNumber)
        && treatmentFieldCloseMatch(contract.sourceText, deepText(entry), 0.22)
      ) || targets.some((scene) => (scene.mechanicPressure ?? []).some((pressure) => pressure.domain === 'information'))
        || match;
    case 'consequence_seed':
      return (plan?.consequenceChains ?? []).some((chain) =>
        chain.origin?.episodeNumber === contract.episodeNumber
        && treatmentFieldCloseMatch(contract.sourceText, deepText(chain), 0.22)
      ) || targets.some((scene) => (scene.mechanicPressure ?? []).length > 0 || (scene.requiredBeats ?? []).some((beat) => beat.tier === 'seed'))
        || match;
    case 'ending_turnout':
    case 'resolved_episode_tension':
    case 'cliffhanger_hook':
    case 'cliffhanger_question':
    case 'next_episode_pressure':
    case 'cliffhanger_setup':
    case 'cliffhanger_type':
    case 'emotional_charge':
    case 'end_state_change':
      return Boolean(plan?.episodes?.find((ep) => ep.episodeNumber === contract.episodeNumber)?.cliffhangerPlan)
        || targets.some((scene) => scene.narrativeRole === 'release')
        || match;
    default:
      return targets.some((scene) => Boolean(scene.turnContract) || (scene.mechanicPressure ?? []).length > 0)
        || match;
  }
}

function matchThreshold(contract: AuthoredTreatmentFieldContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'cliffhanger_type') return 0.8;
  if (tokenCount <= 1) return 0.95;
  if (tokenCount <= 3) return 0.45;
  if (ENDING_KINDS.has(contract.contractKind)) return 0.25;
  return 0.28;
}

function finalRealizationText(
  input: TreatmentFieldUtilizationInput,
  contract: AuthoredTreatmentFieldContract,
): string {
  const targetText = targetedStoryText(input.story, input.seasonPlan?.scenePlan, contract);
  const episodeText = episodeStoryText(input.story, contract.episodeNumber);
  const endingText = ENDING_KINDS.has(contract.contractKind)
    ? finalSceneText(input.story, contract.episodeNumber)
    : '';
  const nextText = contract.contractKind === 'next_episode_pressure' || contract.contractKind === 'cliffhanger_question'
    ? [
      episodeStoryText(input.story, contract.episodeNumber + 1),
      nextEpisodePlanText(input.seasonPlan, contract.episodeNumber),
    ].join(' ')
    : '';
  return [targetText, endingText, episodeText, nextText].filter(Boolean).join(' ');
}

function hasFinalRealization(
  input: TreatmentFieldUtilizationInput,
  contract: AuthoredTreatmentFieldContract,
): boolean {
  if (!FINAL_FIELD_KINDS.has(contract.contractKind)) return true;
  const text = finalRealizationText(input, contract);
  if (treatmentFieldCloseMatch(contract.sourceText, text, matchThreshold(contract))) return true;

  // A declared cliffhanger type is often a controlled vocabulary word. It may
  // be fulfilled structurally by the plan while the final prose renders the
  // actual reveal/danger/invitation rather than the literal type label.
  if (contract.contractKind === 'cliffhanger_type') {
    const plan = input.seasonPlan?.episodes?.find((ep) => ep.episodeNumber === contract.episodeNumber)?.cliffhangerPlan;
    return Boolean(plan?.type && treatmentFieldCloseMatch(contract.sourceText, plan.type, 0.8) && finalSceneText(input.story, contract.episodeNumber).trim());
  }

  // Short stakes layers such as "Identity" or "Relational" should pass when the
  // matching layer is carried in plan metadata and the major scene has prose.
  if (contract.contractKind === 'stakes_layer') {
    return hasStructuredPlanUse(input.seasonPlan, contract) && finalRealizationText(input, contract).trim().length > 0;
  }

  // Mechanic/information/branch contracts may be realized by structured state
  // residue plus any reader-facing episode text that acknowledges the moment.
  if (
    contract.contractKind === 'alternative_path'
    || contract.contractKind === 'information_movement'
    || contract.contractKind === 'consequence_seed'
    || contract.contractKind === 'end_state_change'
  ) {
    return hasStructuredPlanUse(input.seasonPlan, contract) && text.length > 0;
  }

  return false;
}

function issueLocation(contract: AuthoredTreatmentFieldContract, plan?: SeasonPlan): string {
  const sceneId = contract.targetSceneIds[0]
    ?? contractPlanTargets(plan, contract)[0]?.id
    ?? 'episode';
  return `treatmentField:ep${contract.episodeNumber}:${sceneId}:${contract.id}`;
}

function worldContractTargets(
  plan: SeasonPlan | undefined,
  contract: WorldTreatmentRealizationContract,
): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  const scenes = plan?.scenePlan?.scenes ?? [];
  for (const scene of scenes) {
    if ((scene.worldTreatmentContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return scenes.filter((scene) => targetIds.has(scene.id));
}

function worldIssueLocation(contract: WorldTreatmentRealizationContract, plan?: SeasonPlan): string {
  const sceneId = contract.targetSceneIds[0]
    ?? worldContractTargets(plan, contract)[0]?.id
    ?? (contract.locationId ? `location:${contract.locationId}` : 'season');
  return `worldTreatment:${sceneId}:${contract.id}`;
}

function hasWorldPlannedContractMetadata(plan: SeasonPlan | undefined, contract: WorldTreatmentRealizationContract): boolean {
  if ((plan?.scenePlan?.worldTreatmentContracts ?? []).some((field) => field.id === contract.id)) return true;
  if ((plan?.worldTreatmentContracts ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.worldTreatmentContracts ?? []).some((field) => field.id === contract.id)
  );
}

function locationMatches(contract: WorldTreatmentRealizationContract, text: string): boolean {
  return Boolean(
    contract.locationName && treatmentFieldCloseMatch(contract.locationName, text, 0.45)
  ) || Boolean(
    contract.locationId && text.toLowerCase().includes(contract.locationId.toLowerCase())
  );
}

function hasWorldStructuredPlanUse(plan: SeasonPlan | undefined, contract: WorldTreatmentRealizationContract): boolean {
  const targets = worldContractTargets(plan, contract);
  const targetText = targets.map(plannedSceneText).join(' ');
  const planText = [
    plan?.seasonSynopsis,
    deepText(plan?.locationIntroductions),
    deepText(plan?.informationLedger),
    deepText(plan?.choiceMoments),
    deepText(plan?.consequenceChains),
    ...(plan?.scenePlan?.scenes ?? []).map(plannedSceneText),
  ].filter(Boolean).join(' ');
  const match = treatmentFieldCloseMatch(contract.sourceText, `${targetText} ${planText}`, worldMatchThreshold(contract));

  switch (contract.contractKind) {
    case 'location_identity':
      return Boolean((contract.locationId || contract.locationName)
        && (plan?.locationIntroductions ?? []).some((location) =>
          location.locationId === contract.locationId
          || locationMatches(contract, location.locationName)
        ))
        || targets.length > 0
        || match;
    case 'location_choice_pressure':
      return targets.some((scene) => scene.hasChoice || (scene.mechanicPressure ?? []).length > 0)
        || match;
    case 'danger_zone':
      return targets.some((scene) => scene.kind === 'encounter' || Boolean(scene.encounter) || (scene.mechanicPressure ?? []).length > 0)
        || match;
    case 'supernatural_rule':
    case 'dramatic_rule':
    case 'taboo_or_cost':
    case 'scarcity':
    case 'sacred_object':
    case 'location_history':
      return targets.some((scene) => (scene.mechanicPressure ?? []).length > 0)
        || (plan?.informationLedger ?? []).some((entry) => treatmentFieldCloseMatch(contract.sourceText, deepText(entry), 0.22))
        || match;
    case 'location_purpose':
      return targets.some((scene) => Boolean(scene.turnContract) || (scene.mechanicPressure ?? []).length > 0)
        || match;
    default:
      return match || targets.length > 0;
  }
}

function worldFinalText(input: TreatmentFieldUtilizationInput, contract: WorldTreatmentRealizationContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.worldTreatmentContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  const sceneParts: string[] = [];
  for (const episode of input.story?.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (targetIds.size === 0 || targetIds.has(scene.id)) {
        sceneParts.push([
          scene.name,
          scene.timeline?.location,
          ...(scene.beats ?? []).map(beatText),
        ].filter(Boolean).join(' '));
      }
    }
  }
  return sceneParts.filter(Boolean).join(' ');
}

function hasWorldFinalRealization(input: TreatmentFieldUtilizationInput, contract: WorldTreatmentRealizationContract): boolean {
  const text = worldFinalText(input, contract);
  if (
    shouldDeferPartialSliceFinalRealization(input, contract.targetEpisodeNumbers, contract.targetSceneIds, contract.sourceText)
    && hasWorldStructuredPlanUse(input.seasonPlan, contract)
  ) {
    return true;
  }
  if (contract.contractKind === 'location_identity') {
    return Boolean(locationMatches(contract, text) || treatmentFieldCloseMatch(contract.sourceText, text, worldMatchThreshold(contract)));
  }
  if (contract.contractKind === 'time_period') return true;
  if (
    contract.contractKind === 'location_purpose'
    && treatmentFieldTokens(contract.sourceText).length <= 5
    && hasWorldStructuredPlanUse(input.seasonPlan, contract)
    && text.trim().length > 0
  ) {
    return true;
  }
  return treatmentFieldCloseMatch(contract.sourceText, text, worldMatchThreshold(contract));
}

function worldMatchThreshold(contract: WorldTreatmentRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'time_period') return 0.8;
  if (contract.contractKind === 'location_identity') return 0.25;
  if (tokenCount <= 2) return 0.7;
  if (tokenCount <= 5) return 0.4;
  return 0.25;
}

function stakesContractTargets(
  plan: SeasonPlan | undefined,
  contract: StakesArchitectureContract,
): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  const scenes = plan?.scenePlan?.scenes ?? [];
  for (const scene of scenes) {
    if ((scene.stakesArchitectureContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return scenes.filter((scene) => targetIds.has(scene.id));
}

function stakesIssueLocation(contract: StakesArchitectureContract, plan?: SeasonPlan): string {
  const sceneId = contract.targetSceneIds[0]
    ?? stakesContractTargets(plan, contract)[0]?.id
    ?? 'season';
  return `stakesArchitecture:${sceneId}:${contract.id}`;
}

function hasStakesPlannedContractMetadata(plan: SeasonPlan | undefined, contract: StakesArchitectureContract): boolean {
  if ((plan?.scenePlan?.stakesArchitectureContracts ?? []).some((field) => field.id === contract.id)) return true;
  if ((plan?.stakesArchitectureContracts ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.stakesArchitectureContracts ?? []).some((field) => field.id === contract.id)
  );
}

function prerequisiteOrderValid(plan: SeasonPlan | undefined, contract: StakesArchitectureContract): boolean {
  if (contract.prerequisiteContractIds.length === 0) return true;
  const scenes = plan?.scenePlan?.scenes ?? [];
  const targetScenes = stakesContractTargets(plan, contract);
  const targetEpisode = Math.min(...targetScenes.map((scene) => scene.episodeNumber), ...contract.targetEpisodeNumbers);
  if (!Number.isFinite(targetEpisode)) return false;
  for (const prerequisiteId of contract.prerequisiteContractIds) {
    const prerequisiteScenes = scenes.filter((scene) =>
      (scene.stakesArchitectureContracts ?? []).some((field) => field.id === prerequisiteId)
    );
    if (prerequisiteScenes.length === 0) return false;
    if (!prerequisiteScenes.some((scene) => scene.episodeNumber <= targetEpisode)) return false;
  }
  return true;
}

function escalationOrderValid(plan: SeasonPlan | undefined, contract: StakesArchitectureContract): boolean {
  if (contract.contractKind !== 'stakes_escalation_step') return true;
  const contracts = plan?.stakesArchitectureContracts ?? plan?.scenePlan?.stakesArchitectureContracts ?? [];
  const steps = contracts
    .filter((candidate) => candidate.contractKind === 'stakes_escalation_step')
    .map((candidate) => ({
      candidate,
      firstEpisode: Math.min(...(candidate.targetEpisodeNumbers.length ? candidate.targetEpisodeNumbers : [Number.MAX_SAFE_INTEGER])),
    }))
    .sort((a, b) => a.candidate.id.localeCompare(b.candidate.id));
  let previous = 0;
  for (const step of steps) {
    if (step.firstEpisode < previous) return false;
    previous = step.firstEpisode;
  }
  return true;
}

function hasStakesStructuredPlanUse(plan: SeasonPlan | undefined, contract: StakesArchitectureContract): boolean {
  const targets = stakesContractTargets(plan, contract);
  const targetText = targets.map(plannedSceneText).join(' ');
  const planText = [
    plan?.seasonSynopsis,
    deepText(plan?.informationLedger),
    deepText(plan?.choiceMoments),
    deepText(plan?.consequenceChains),
    deepText(plan?.resolvedEndings),
    ...(plan?.scenePlan?.scenes ?? []).map(plannedSceneText),
  ].filter(Boolean).join(' ');
  const match = treatmentFieldCloseMatch(contract.sourceText, `${targetText} ${planText}`, stakesArchitectureMatchThreshold(contract));
  if (!prerequisiteOrderValid(plan, contract) || !escalationOrderValid(plan, contract)) return false;

  switch (contract.contractKind) {
    case 'material_stake':
      return targets.some((scene) => (scene.mechanicPressure ?? []).length > 0 || scene.hasChoice || (scene.locations ?? []).length > 0)
        || (plan?.informationLedger ?? []).some((entry) => treatmentFieldCloseMatch(contract.sourceText, deepText(entry), 0.22))
        || match;
    case 'relational_stake':
      return targets.some((scene) => scene.hasChoice || (scene.relationshipPacing ?? []).length > 0 || (scene.mechanicPressure ?? []).some((pressure) => pressure.domain === 'relationship'))
        || match;
    case 'identity_stake':
      return targets.some((scene) => scene.hasChoice || Boolean(scene.turnContract) || (scene.mechanicPressure ?? []).some((pressure) => pressure.domain === 'identity'))
        || match;
    case 'existential_stake':
      return targets.some((scene) => scene.narrativeRole === 'payoff' || scene.narrativeRole === 'release' || scene.kind === 'encounter' || (scene.mechanicPressure ?? []).length > 0)
        || match;
    case 'stakes_escalation_step':
      return targets.some((scene) => scene.kind === 'encounter' || scene.hasChoice || Boolean(scene.turnContract) || (scene.mechanicPressure ?? []).length > 0)
        || match;
    case 'personal_stakes_prerequisite':
      return targets.some((scene) => Boolean(scene.turnContract) || (scene.mechanicPressure ?? []).length > 0 || scene.hasChoice)
        || match;
    case 'emotional_stakes_anchor':
      return targets.some((scene) => (scene.mechanicPressure ?? []).length > 0 || (scene.worldTreatmentContracts ?? []).length > 0 || Boolean(scene.signatureMoment))
        || match;
    default:
      return match || targets.length > 0;
  }
}

function stakesFinalText(input: TreatmentFieldUtilizationInput, contract: StakesArchitectureContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.stakesArchitectureContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  const sceneParts: string[] = [];
  for (const episode of input.story?.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (targetIds.size === 0 || targetIds.has(scene.id)) {
        sceneParts.push(sceneText(scene));
      }
    }
  }
  return sceneParts.filter(Boolean).join(' ');
}

function hasStakesFinalRealization(input: TreatmentFieldUtilizationInput, contract: StakesArchitectureContract): boolean {
  const text = stakesFinalText(input, contract);
  if (
    shouldDeferPartialSliceFinalRealization(input, contract.targetEpisodeNumbers, contract.targetSceneIds, contract.sourceText, { broadTokenThreshold: Number.POSITIVE_INFINITY })
    && hasStakesStructuredPlanUse(input.seasonPlan, contract)
  ) {
    return true;
  }
  if (treatmentFieldCloseMatch(contract.sourceText, text, stakesArchitectureMatchThreshold(contract))) return true;
  if (!hasStakesStructuredPlanUse(input.seasonPlan, contract) || !text.trim()) return false;
  // Stakes can be realized fiction-first without repeating exact nouns when the
  // assigned scene has visible action/choice/pressure text.
  if (contract.contractKind === 'material_stake') return /\b(access|key|letter|blog|post|money|readers?|safe|apartment|resource|proof|evidence|reputation|deal|column|lost|kept|risk|cost)\b/i.test(text);
  if (contract.contractKind === 'relational_stake') return /\b(trust|friend|betray|forgive|loyal|confess|protect|choose|distance|closer|withheld|alliance|love|fear)\b/i.test(text);
  if (contract.contractKind === 'identity_stake') return /\b(voice|name|author|refuse|choose|become|self|truth|lie|claim|identity|belongs|owned|free)\b/i.test(text);
  if (contract.contractKind === 'existential_stake') return /\b(life|death|human|monster|survive|die|turn|blood|legacy|final|moon|judgment|destroy|save)\b/i.test(text);
  if (contract.contractKind === 'emotional_stakes_anchor') return /\b(holds?|takes?|gives?|keeps?|wears?|places?|circle|card|quartz|chain|scarf|letter|threshold|object|promise|name)\b/i.test(text);
  return true;
}

function storyCircleContractTargets(
  plan: SeasonPlan | undefined,
  contract: StoryCircleBeatRealizationContract,
): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  const scenes = plan?.scenePlan?.scenes ?? [];
  for (const scene of scenes) {
    if ((scene.storyCircleBeatContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return scenes.filter((scene) => targetIds.has(scene.id));
}

function storyCircleIssueLocation(contract: StoryCircleBeatRealizationContract, plan?: SeasonPlan): string {
  const sceneId = contract.targetSceneIds[0]
    ?? storyCircleContractTargets(plan, contract)[0]?.id
    ?? 'episode';
  return `storyCircleBeat:ep${contract.targetEpisodeNumber ?? 'unknown'}:${sceneId}:${contract.id}`;
}

function hasStoryCirclePlannedContractMetadata(plan: SeasonPlan | undefined, contract: StoryCircleBeatRealizationContract): boolean {
  if ((plan?.scenePlan?.storyCircleBeatContracts ?? []).some((field) => field.id === contract.id)) return true;
  if ((plan?.storyCircleBeatContracts ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.storyCircleBeatContracts ?? []).some((field) => field.id === contract.id)
  );
}

function hasStoryCircleStructuredPlanUse(plan: SeasonPlan | undefined, contract: StoryCircleBeatRealizationContract): boolean {
  const targets = storyCircleContractTargets(plan, contract);
  const targetText = targets.map(plannedSceneText).join(' ');
  const episodeText = contract.targetEpisodeNumber
    ? planEpisodeText(plan, contract.targetEpisodeNumber)
    : '';
  const text = `${targetText} ${episodeText}`;
  const match = treatmentFieldCloseMatch(contract.sourceText, text, storyCircleBeatMatchThreshold(contract));
  return targets.some((scene) =>
    Boolean(scene.turnContract)
    || (scene.requiredBeats ?? []).some((beat) => beat.id.includes(`story-circle-${contract.beat}`) || treatmentFieldCloseMatch(contract.sourceText, `${beat.sourceTurn} ${beat.mustDepict}`, 0.25))
    || (scene.mechanicPressure ?? []).some((pressure) => pressure.id.includes(contract.id) || treatmentFieldCloseMatch(contract.sourceText, pressure.storyPressure, 0.25))
    || (contract.beat === 'return' && scene.hasChoice)
    || (contract.beat === 'change' && scene.narrativeRole === 'release')
  ) || match;
}

function storyCircleFinalText(input: TreatmentFieldUtilizationInput, contract: StoryCircleBeatRealizationContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.storyCircleBeatContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  const sceneParts: string[] = [];
  for (const episode of input.story?.episodes ?? []) {
    if (contract.targetEpisodeNumber && episode.number !== contract.targetEpisodeNumber) continue;
    for (const scene of episode.scenes ?? []) {
      if (targetIds.size === 0 || targetIds.has(scene.id)) {
        sceneParts.push([
          ...(scene.beats ?? []).map(beatText),
          deepText(scene.encounter),
        ].filter(Boolean).join(' '));
      }
    }
  }
  return sceneParts.filter(Boolean).join(' ');
}

function generatedEpisodeIncludes(input: TreatmentFieldUtilizationInput, episodeNumber: number | undefined): boolean {
  if (!episodeNumber || !input.story) return true;
  return (input.story.episodes ?? []).some((episode) => episode.number === episodeNumber);
}

function generatedEpisodeNumbers(input: TreatmentFieldUtilizationInput): Set<number> {
  return new Set(
    (input.story?.episodes ?? [])
      .map((episode) => episode.number)
      .filter((episodeNumber): episodeNumber is number => typeof episodeNumber === 'number'),
  );
}

function isPartialGeneratedSlice(input: TreatmentFieldUtilizationInput): boolean {
  const generated = generatedEpisodeNumbers(input);
  if (generated.size === 0) return false;
  const totalEpisodes = input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes;
  return typeof totalEpisodes === 'number' && totalEpisodes > generated.size;
}

function spansUngeneratedEpisode(input: TreatmentFieldUtilizationInput, targetEpisodeNumbers: number[]): boolean {
  if (!isPartialGeneratedSlice(input) || targetEpisodeNumbers.length <= 1) return false;
  const generated = generatedEpisodeNumbers(input);
  return targetEpisodeNumbers.some((episodeNumber) => !generated.has(episodeNumber));
}

function hasGeneratedSceneTarget(input: TreatmentFieldUtilizationInput, targetSceneIds: string[]): boolean {
  if (targetSceneIds.length === 0) return false;
  const generatedSceneIds = new Set<string>();
  for (const episode of input.story?.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      generatedSceneIds.add(scene.id);
    }
  }
  return targetSceneIds.some((sceneId) => generatedSceneIds.has(sceneId));
}

function shouldDeferPartialSliceFinalRealization(
  input: TreatmentFieldUtilizationInput,
  targetEpisodeNumbers: number[],
  targetSceneIds: string[],
  sourceText: string,
  options: { broadTokenThreshold?: number } = {},
): boolean {
  if (!spansUngeneratedEpisode(input, targetEpisodeNumbers)) return false;
  const tokenCount = treatmentFieldTokens(sourceText).length;
  const generatedSceneTarget = hasGeneratedSceneTarget(input, targetSceneIds);
  const broadTokenThreshold = options.broadTokenThreshold ?? 6;

  // Multi-episode contracts often name the whole season rule/arc/audit in a
  // single source string, while the partial run can only prove the generated
  // slice. Keep scene-local, compact obligations enforceable; defer broad
  // season-spanning prose checks to the ledger/full-season pass.
  return !generatedSceneTarget
    || tokenCount > broadTokenThreshold
    || /(?:;|\bE\d\b|\bep\s*\d\b|\bepisode(?:s)?\b|→|->|midpoint|finale|season|across|threaded|every episode|later|payoff)/i.test(sourceText);
}

function hasStoryCircleFinalRealization(input: TreatmentFieldUtilizationInput, contract: StoryCircleBeatRealizationContract): boolean {
  if (!generatedEpisodeIncludes(input, contract.targetEpisodeNumber)) return true;
  const text = storyCircleFinalText(input, contract);
  if (!text.trim()) return false;
  if (treatmentFieldCloseMatch(contract.sourceText, text, storyCircleBeatMatchThreshold(contract))) return true;
  const atoms = contract.eventAtoms.length > 0 ? contract.eventAtoms : [contract.sourceText];
  const depictedAtoms = atoms.filter((atom) => treatmentFieldCloseMatch(atom, text, Math.min(0.4, storyCircleBeatMatchThreshold(contract) + 0.08)));
  return depictedAtoms.length >= Math.max(1, Math.ceil(Math.min(atoms.length, 3) / 2));
}

function arcPressureContractTargets(
  plan: SeasonPlan | undefined,
  contract: ArcPressureTreatmentContract,
): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  const scenes = plan?.scenePlan?.scenes ?? [];
  for (const scene of scenes) {
    if ((scene.arcPressureContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return scenes.filter((scene) => targetIds.has(scene.id));
}

function arcPressureIssueLocation(contract: ArcPressureTreatmentContract, plan?: SeasonPlan): string {
  const sceneId = contract.targetSceneIds[0]
    ?? arcPressureContractTargets(plan, contract)[0]?.id
    ?? 'episode';
  return `arcPressure:${contract.arcId}:${sceneId}:${contract.id}`;
}

function hasArcPressurePlannedContractMetadata(plan: SeasonPlan | undefined, contract: ArcPressureTreatmentContract): boolean {
  if ((plan?.scenePlan?.arcPressureContracts ?? []).some((field) => field.id === contract.id)) return true;
  if ((plan?.arcPressureContracts ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.arcPressureContracts ?? []).some((field) => field.id === contract.id)
  );
}

function hasArcPressureStructuredPlanUse(plan: SeasonPlan | undefined, contract: ArcPressureTreatmentContract): boolean {
  const targets = arcPressureContractTargets(plan, contract);
  const targetText = targets.map(plannedSceneText).join(' ');
  const episodeText = contract.targetEpisodeNumbers.map((episodeNumber) => planEpisodeText(plan, episodeNumber)).join(' ');
  const arcText = deepText((plan?.arcs ?? []).filter((arc) => arc.id === contract.arcId || arc.name === contract.arcTitle));
  const text = `${targetText} ${episodeText} ${arcText}`;
  const match = treatmentFieldCloseMatch(contract.sourceText, text, arcPressureMatchThreshold(contract));

  switch (contract.contractKind) {
    case 'arc_identity':
      return Boolean((plan?.arcs ?? []).some((arc) =>
        arc.id === contract.arcId
        || treatmentFieldCloseMatch(contract.arcTitle, arc.name, 0.45)
      ));
    case 'arc_question':
    case 'season_relation':
      return targets.some((scene) => Boolean(scene.turnContract) || scene.hasChoice || (scene.mechanicPressure ?? []).length > 0)
        || match;
    case 'lie_facet':
      return targets.some((scene) => scene.hasChoice || (scene.mechanicPressure ?? []).some((pressure) => pressure.domain === 'identity') || Boolean(scene.turnContract))
        || match;
    case 'arc_midpoint_recontextualization':
      return targets.some((scene) =>
        scene.narrativeRole === 'turn'
        || (scene.mechanicPressure ?? []).some((pressure) => pressure.domain === 'information')
        || (scene.requiredBeats ?? []).some((beat) => treatmentFieldCloseMatch(contract.sourceText, `${beat.sourceTurn} ${beat.mustDepict}`, 0.25))
      ) || match;
    case 'arc_late_crisis':
      return targets.some((scene) =>
        scene.kind === 'encounter'
        || scene.hasChoice
        || scene.narrativeRole === 'payoff'
        || (scene.mechanicPressure ?? []).length > 0
      ) || match;
    case 'arc_finale_answer':
    case 'arc_episode_turnout':
      return targets.some((scene) => scene.narrativeRole === 'release' || Boolean(scene.turnContract) || (scene.mechanicPressure ?? []).length > 0)
        || contract.targetEpisodeNumbers.some((episodeNumber) => Boolean(plan?.episodes.find((episode) => episode.episodeNumber === episodeNumber)?.cliffhangerPlan))
        || match;
    case 'arc_handoff_pressure':
      return targets.some((scene) => scene.narrativeRole === 'release' || (scene.mechanicPressure ?? []).some((pressure) => pressure.function === 'plant'))
        || contract.targetEpisodeNumbers.some((episodeNumber) => nextEpisodePlanText(plan, episodeNumber).trim().length > 0)
        || match;
    default:
      return match || targets.length > 0;
  }
}

function arcPressureFinalText(input: TreatmentFieldUtilizationInput, contract: ArcPressureTreatmentContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.arcPressureContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  const parts: string[] = [];
  for (const episode of input.story?.episodes ?? []) {
    if (contract.targetEpisodeNumbers.length > 0 && !contract.targetEpisodeNumbers.includes(episode.number)) continue;
    for (const scene of episode.scenes ?? []) {
      if (targetIds.size === 0 || targetIds.has(scene.id)) {
        parts.push([
          ...(scene.beats ?? []).map(beatText),
          deepText(scene.encounter),
        ].filter(Boolean).join(' '));
      }
    }
  }
  return parts.filter(Boolean).join(' ');
}

function hasArcPressureFinalRealization(input: TreatmentFieldUtilizationInput, contract: ArcPressureTreatmentContract): boolean {
  if (contract.targetEpisodeNumbers.length > 0 && input.story) {
    const generatedAny = contract.targetEpisodeNumbers.some((episodeNumber) => generatedEpisodeIncludes(input, episodeNumber));
    if (!generatedAny) return true;
  }
  const text = arcPressureFinalText(input, contract);
  if (
    shouldDeferPartialSliceFinalRealization(input, contract.targetEpisodeNumbers, contract.targetSceneIds, contract.sourceText, { broadTokenThreshold: 12 })
    && hasArcPressureStructuredPlanUse(input.seasonPlan, contract)
  ) {
    return true;
  }
  if (contract.contractKind === 'arc_identity') return true;
  if (!text.trim()) return false;
  if (treatmentFieldCloseMatch(contract.sourceText, text, arcPressureMatchThreshold(contract))) return true;
  const atoms = contract.eventAtoms.length > 0 ? contract.eventAtoms : [contract.sourceText];
  const depictedAtoms = atoms.filter((atom) => treatmentFieldCloseMatch(atom, text, Math.min(0.4, arcPressureMatchThreshold(contract) + 0.08)));
  if (depictedAtoms.length >= Math.max(1, Math.ceil(Math.min(atoms.length, 3) / 2))) return true;
  if (!hasArcPressureStructuredPlanUse(input.seasonPlan, contract)) return false;
  if (contract.contractKind === 'arc_late_crisis') return /\b(cost|lost|loss|cannot|no longer|fail|break|danger|warning|betray|crack|narrow|choice)\b/i.test(text);
  if (contract.contractKind === 'arc_midpoint_recontextualization') return /\b(realizes?|truth|actually|underneath|reframe|wrong|mirror|changed|reveals?|understand)\b/i.test(text);
  if (contract.contractKind === 'lie_facet' || contract.contractKind === 'arc_question') return /\b(want|choose|voice|claim|observe|desire|safe|known|lie|truth|appetite|approval|refuse)\b/i.test(text);
  if (contract.contractKind === 'arc_handoff_pressure') return /\b(next|later|carries?|left with|still|door|threshold|warning|question|pressure|returns?|arrives?)\b/i.test(text);
  return /\b(changed|chooses?|leaves?|returns?|ends?|after|therefore|because|now|no longer|cannot)\b/i.test(text);
}

function failureModeTargets(
  plan: SeasonPlan | undefined,
  contract: FailureModeAuditContract,
): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  const scenes = plan?.scenePlan?.scenes ?? [];
  for (const scene of scenes) {
    if ((scene.failureModeAuditContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return scenes.filter((scene) => targetIds.has(scene.id));
}

function failureModeIssueLocation(contract: FailureModeAuditContract, plan?: SeasonPlan): string {
  const sceneId = contract.targetSceneIds[0]
    ?? failureModeTargets(plan, contract)[0]?.id
    ?? 'season';
  return `failureModeAudit:${contract.code}:${sceneId}:${contract.id}`;
}

function hasFailureModePlannedContractMetadata(plan: SeasonPlan | undefined, contract: FailureModeAuditContract): boolean {
  if ((plan?.scenePlan?.failureModeAuditContracts ?? []).some((field) => field.id === contract.id)) return true;
  if ((plan?.failureModeAuditContracts ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.failureModeAuditContracts ?? []).some((field) => field.id === contract.id)
  );
}

function hasFailureModeStructuredPlanUse(plan: SeasonPlan | undefined, contract: FailureModeAuditContract): boolean {
  const targets = failureModeTargets(plan, contract);
  const targetText = targets.map(plannedSceneText).join(' ');
  const planText = [
    deepText(plan?.scenePlan?.setupPayoffEdges),
    deepText(plan?.informationLedger),
    deepText(plan?.consequenceChains),
    deepText(plan?.choiceMoments),
    deepText(plan?.episodes?.map((episode) => [episode.cliffhangerPlan, episode.endingRoutes, episode.treatmentGuidance])),
    deepText(plan?.arcs),
    deepText(plan?.seasonPromiseContracts),
    deepText(plan?.stakesArchitectureContracts),
    deepText(plan?.arcPressureContracts),
    deepText(plan?.branchConsequenceContracts),
    deepText(plan?.endingRealizationContracts),
    deepText(plan?.characterTreatmentContracts),
    deepText(plan?.worldTreatmentContracts),
    ...(plan?.scenePlan?.scenes ?? []).map(plannedSceneText),
  ].filter(Boolean).join(' ');
  const match = treatmentFieldCloseMatch(contract.sourceText, `${targetText} ${planText}`, failureModeAuditMatchThreshold(contract));
  const linked = contract.linkedContractIds.length > 0;
  switch (contract.contractKind) {
    case 'agency_claim':
      return targets.some((scene) => scene.hasChoice || scene.narrativeRole === 'turn')
        || (plan?.choiceMoments ?? []).some((moment) => treatmentFieldCloseMatch(contract.sourceText, deepText(moment), 0.22))
        || deepText((plan?.episodes ?? []).map((episode) => episode.endingRoutes)).trim().length > 0
        || match;
    case 'setup_payoff_claim':
    case 'reveal_fair_play_claim':
      return linked
        || (plan?.scenePlan?.setupPayoffEdges ?? []).length > 0
        || (plan?.informationLedger ?? []).some((entry) => treatmentFieldCloseMatch(contract.sourceText, deepText(entry), 0.2))
        || (plan?.consequenceChains ?? []).some((chain) => treatmentFieldCloseMatch(contract.sourceText, deepText(chain), 0.2))
        || match;
    case 'episode_state_change_claim':
    case 'arc_state_change_claim':
      return linked
        || (plan?.episodes ?? []).some((episode) => Boolean(episode.cliffhangerPlan?.resolvedEpisodeTension || episode.cliffhangerPlan?.nextEpisodePressure))
        || (plan?.arcs ?? []).some((arc) => treatmentFieldCloseMatch(contract.sourceText, deepText(arc), 0.2))
        || targets.some((scene) => (scene.mechanicPressure ?? []).length > 0)
        || match;
    case 'theme_rhyme_claim':
      return linked
        || (plan?.seasonPromiseContracts ?? []).length > 0
        || (plan?.arcPressureContracts ?? []).length > 0
        || match;
    case 'watch_item':
    case 'mitigation':
    case 'causality_claim':
      return linked
        || targets.some((scene) => (scene.mechanicPressure ?? []).length > 0)
        || (plan?.consequenceChains ?? []).some((chain) => treatmentFieldCloseMatch(contract.sourceText, deepText(chain), 0.2))
        || match;
    default:
      return linked || targets.length > 0 || match;
  }
}

function failureModeFinalText(input: TreatmentFieldUtilizationInput, contract: FailureModeAuditContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.failureModeAuditContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  const parts: string[] = [];
  for (const episode of input.story?.episodes ?? []) {
    if (contract.targetEpisodeNumbers.length > 0 && !contract.targetEpisodeNumbers.includes(episode.number)) continue;
    for (const scene of episode.scenes ?? []) {
      if (targetIds.size === 0 || targetIds.has(scene.id)) {
        parts.push(sceneText(scene));
      }
    }
  }
  return parts.filter(Boolean).join(' ');
}

function hasFailureModeFinalRealization(input: TreatmentFieldUtilizationInput, contract: FailureModeAuditContract): boolean {
  const text = failureModeFinalText(input, contract);
  if (
    shouldDeferPartialSliceFinalRealization(input, contract.targetEpisodeNumbers, contract.targetSceneIds, contract.sourceText)
    && hasFailureModeStructuredPlanUse(input.seasonPlan, contract)
  ) {
    return true;
  }
  if (treatmentFieldCloseMatch(contract.sourceText, text, failureModeAuditMatchThreshold(contract))) return true;
  if (!hasFailureModeStructuredPlanUse(input.seasonPlan, contract) || !text.trim()) return false;
  switch (contract.contractKind) {
    case 'agency_claim':
      return /\b(choose|chooses|decide|decides|refuse|refuses|accept|accepts|confront|confronts|publish|publishes|use|uses|prepared|because of (?:you|her|his|their)|through (?:choice|preparation|sacrifice|leverage|action|information))\b/i.test(text);
    case 'setup_payoff_claim':
    case 'reveal_fair_play_claim':
      return /\b(setup|payoff|pays off|returns?|again|earlier|clue|foreshadow|plant|seed|reveal|truth|because|recognizes?|remembers?)\b/i.test(text);
    case 'episode_state_change_claim':
    case 'arc_state_change_claim':
      return /\b(changed|now|no longer|cannot|keeps?|loses?|left with|afterward|from now on|irreversible|opens?|blocks?|carries?|residue|ends? with)\b/i.test(text);
    case 'theme_rhyme_claim':
      return /\b(voice|choice|known|owned|truth|lie|self|want|need|love|trust|freedom|refuse|belong|same question|again)\b/i.test(text);
    case 'watch_item':
    case 'mitigation':
    case 'causality_claim':
      return /\b(because|planned|prepared|watching|set up|loosened|sent|deliberate|earned|caused|warned|followed|already|before|so that|therefore)\b/i.test(text);
    default:
      return /\b(because|choice|changed|reveals?|pays?|returns?|now|after|therefore|cannot)\b/i.test(text);
  }
}

function branchContractTargets(
  plan: SeasonPlan | undefined,
  contract: BranchConsequenceRealizationContract,
): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  const scenes = plan?.scenePlan?.scenes ?? [];
  for (const scene of scenes) {
    if ((scene.branchConsequenceContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return scenes.filter((scene) => targetIds.has(scene.id));
}

function branchIssueLocation(contract: BranchConsequenceRealizationContract, plan?: SeasonPlan): string {
  const sceneId = contract.targetSceneIds[0]
    ?? branchContractTargets(plan, contract)[0]?.id
    ?? 'season';
  return `branchConsequence:${contract.branchId}:${sceneId}:${contract.id}`;
}

function hasBranchPlannedContractMetadata(plan: SeasonPlan | undefined, contract: BranchConsequenceRealizationContract): boolean {
  if ((plan?.scenePlan?.branchConsequenceContracts ?? []).some((field) => field.id === contract.id)) return true;
  if ((plan?.branchConsequenceContracts ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.branchConsequenceContracts ?? []).some((field) => field.id === contract.id)
  );
}

function hasBranchStructuredPlanUse(plan: SeasonPlan | undefined, contract: BranchConsequenceRealizationContract): boolean {
  const targets = branchContractTargets(plan, contract);
  const targetText = targets.map(plannedSceneText).join(' ');
  const planText = [
    deepText(plan?.crossEpisodeBranches),
    deepText(plan?.consequenceChains),
    deepText(plan?.seasonFlags),
    deepText(plan?.choiceMoments),
    deepText(plan?.resolvedEndings),
    ...(plan?.scenePlan?.scenes ?? []).map(plannedSceneText),
  ].filter(Boolean).join(' ');
  const match = treatmentFieldCloseMatch(contract.sourceText, `${targetText} ${planText}`, branchConsequenceMatchThreshold(contract));
  switch (contract.contractKind) {
    case 'branch_origin_choice':
      return targets.some((scene) => scene.hasChoice || (scene.mechanicPressure ?? []).length > 0)
        || (plan?.choiceMoments ?? []).some((moment) => treatmentFieldCloseMatch(contract.sourceText, deepText(moment), 0.22))
        || match;
    case 'branch_path_state':
    case 'branch_state_change':
      return (plan?.seasonFlags ?? []).some((flag) => treatmentFieldCloseMatch(contract.sourceText, deepText(flag), 0.22))
        || targets.some((scene) => (scene.mechanicPressure ?? []).length > 0)
        || match;
    case 'branch_later_payoff':
    case 'branch_reconvergence_residue':
      return (plan?.consequenceChains ?? []).some((chain) => treatmentFieldCloseMatch(contract.sourceText, deepText(chain), 0.22))
        || targets.some((scene) => scene.narrativeRole === 'payoff' || scene.narrativeRole === 'release' || (scene.mechanicPressure ?? []).length > 0)
        || match;
    case 'branch_ending_eligibility':
      return contract.targetEndingIds.length > 0
        || (plan?.resolvedEndings ?? []).some((ending) => treatmentFieldCloseMatch(contract.sourceText, deepText(ending), 0.22))
        || match;
    default:
      return match || targets.length > 0;
  }
}

function branchFinalText(input: TreatmentFieldUtilizationInput, contract: BranchConsequenceRealizationContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.branchConsequenceContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  const parts: string[] = [];
  for (const episode of input.story?.episodes ?? []) {
    if (contract.targetEpisodeNumbers.length > 0 && !contract.targetEpisodeNumbers.includes(episode.number)) continue;
    for (const scene of episode.scenes ?? []) {
      if (targetIds.size === 0 || targetIds.has(scene.id)) {
        parts.push(sceneText(scene));
      }
    }
  }
  return parts.filter(Boolean).join(' ');
}

function hasBranchFinalRealization(input: TreatmentFieldUtilizationInput, contract: BranchConsequenceRealizationContract): boolean {
  const text = branchFinalText(input, contract);
  if (treatmentFieldCloseMatch(contract.sourceText, text, branchConsequenceMatchThreshold(contract))) return true;
  if (!hasBranchStructuredPlanUse(input.seasonPlan, contract) || !text.trim()) return false;
  if (contract.stateDomains.includes('resource') || contract.stateDomains.includes('item')) return /\b(access|key|card|quartz|kept|lost|takes?|gives?|threshold|ward|sanctuary|resource|object)\b/i.test(text);
  if (contract.stateDomains.includes('relationship')) return /\b(trust|friend|betray|forgive|loyal|confess|protect|withhold|distance|choose)\b/i.test(text);
  if (contract.stateDomains.includes('information')) return /\b(learn|know|secret|warning|clue|reveal|confess|misread|truth|lie)\b/i.test(text);
  if (contract.stateDomains.includes('route')) return /\b(route|path|ending|choice|eligible|cannot|opens?|blocks?|available|lost)\b/i.test(text);
  return /\b(changed|because|later|remains?|carries?|after|therefore|kept|lost|opens?|blocks?)\b/i.test(text);
}

function endingContractTargets(
  plan: SeasonPlan | undefined,
  contract: EndingRealizationContract,
): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  const scenes = plan?.scenePlan?.scenes ?? [];
  for (const scene of scenes) {
    if ((scene.endingRealizationContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return scenes.filter((scene) => targetIds.has(scene.id));
}

function endingIssueLocation(contract: EndingRealizationContract, plan?: SeasonPlan): string {
  const sceneId = contract.targetSceneIds[0]
    ?? endingContractTargets(plan, contract)[0]?.id
    ?? 'season';
  return `endingRealization:${contract.endingId}:${sceneId}:${contract.id}`;
}

function hasEndingPlannedContractMetadata(plan: SeasonPlan | undefined, contract: EndingRealizationContract): boolean {
  if ((plan?.scenePlan?.endingRealizationContracts ?? []).some((field) => field.id === contract.id)) return true;
  if ((plan?.endingRealizationContracts ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.endingRealizationContracts ?? []).some((field) => field.id === contract.id)
  );
}

function hasEndingStructuredPlanUse(plan: SeasonPlan | undefined, contract: EndingRealizationContract): boolean {
  const targets = endingContractTargets(plan, contract);
  const targetText = targets.map(plannedSceneText).join(' ');
  const endingText = deepText((plan?.resolvedEndings ?? []).filter((ending) => ending.id === contract.endingId));
  const planText = [
    endingText,
    deepText((plan?.episodes ?? []).map((episode) => episode.endingRoutes)),
    deepText(plan?.seasonFlags),
    deepText(plan?.choiceMoments),
    deepText(plan?.crossEpisodeBranches),
    deepText(plan?.consequenceChains),
    ...(plan?.scenePlan?.scenes ?? []).map(plannedSceneText),
  ].filter(Boolean).join(' ');
  const routeSupportText = [
    deepText((plan?.episodes ?? []).map((episode) => episode.endingRoutes)),
    deepText(plan?.seasonFlags),
    deepText(plan?.choiceMoments),
    deepText(plan?.crossEpisodeBranches),
    deepText(plan?.consequenceChains),
    targetText,
  ].filter(Boolean).join(' ');
  const match = treatmentFieldCloseMatch(contract.sourceText, `${targetText} ${planText}`, endingRealizationMatchThreshold(contract));
  const routeMatch = treatmentFieldCloseMatch(contract.sourceText, routeSupportText, endingRealizationMatchThreshold(contract));
  switch (contract.contractKind) {
    case 'ending_identity':
    case 'ending_summary':
    case 'ending_theme_payoff':
    case 'ending_emotional_register':
      return Boolean(endingText) || match;
    case 'ending_state_driver':
    case 'ending_target_condition':
    case 'ending_choice_pattern':
      return targets.some((scene) => scene.hasChoice || (scene.mechanicPressure ?? []).length > 0)
        || (plan?.choiceMoments ?? []).some((moment) => treatmentFieldCloseMatch(contract.sourceText, deepText(moment), 0.22))
        || (plan?.seasonFlags ?? []).some((flag) => treatmentFieldCloseMatch(contract.sourceText, deepText(flag), 0.22))
        || contract.linkedContractIds.length > 0
        || routeMatch;
    case 'ending_final_line':
      return targets.some((scene) => scene.narrativeRole === 'release')
        || match;
    default:
      return match || targets.length > 0;
  }
}

function endingFinalText(input: TreatmentFieldUtilizationInput, contract: EndingRealizationContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.endingRealizationContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  const parts: string[] = [];
  for (const episode of input.story?.episodes ?? []) {
    if (contract.targetEpisodeNumbers.length > 0 && !contract.targetEpisodeNumbers.includes(episode.number)) continue;
    for (const scene of episode.scenes ?? []) {
      if (targetIds.size === 0 || targetIds.has(scene.id)) {
        parts.push(sceneText(scene));
      }
    }
  }
  return parts.filter(Boolean).join(' ');
}

function hasEndingFinalRealization(input: TreatmentFieldUtilizationInput, contract: EndingRealizationContract): boolean {
  const text = endingFinalText(input, contract);
  if (contract.contractKind === 'ending_identity') return true;
  if (treatmentFieldCloseMatch(contract.sourceText, text, endingRealizationMatchThreshold(contract))) return true;
  if (!hasEndingStructuredPlanUse(input.seasonPlan, contract) || !text.trim()) return false;
  if (contract.contractKind === 'ending_emotional_register') return true;
  if (contract.contractKind === 'ending_theme_payoff') return /\b(voice|truth|lie|love|owned|free|choice|self|cost|become|refuse|surrender)\b/i.test(text);
  if (contract.contractKind === 'ending_state_driver' || contract.contractKind === 'ending_target_condition') return /\b(choice|because|kept|lost|accepted|refused|stood|gave|took|opened|blocked|route|final|ends?)\b/i.test(text);
  return /\b(final|dawn|ending|voice|choice|because|now|never|still|becomes?)\b/i.test(text);
}

export class TreatmentFieldUtilizationValidator extends BaseValidator {
  constructor() {
    super('TreatmentFieldUtilizationValidator');
  }

  validatePlan(input: Pick<TreatmentFieldUtilizationInput, 'seasonPlan' | 'sourceAnalysis'>): ValidationResult {
    return this.validate({ ...input, phase: 'plan', treatmentSourced: true });
  }

  validate(input: TreatmentFieldUtilizationInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const contracts = contractsFromAnalysis(input.sourceAnalysis);
    const worldContracts = worldContractsFromInput(input);
    const stakesContracts = stakesContractsFromInput(input);
    const storyCircleContracts = storyCircleContractsFromInput(input);
    const arcPressureContracts = arcPressureContractsFromInput(input);
    const branchConsequenceContracts = branchConsequenceContractsFromInput(input);
    const endingRealizationContracts = endingRealizationContractsFromInput(input);
    const failureModeAuditContracts = failureModeAuditContractsFromInput(input);
    if (
      contracts.length === 0
      && worldContracts.length === 0
      && stakesContracts.length === 0
      && storyCircleContracts.length === 0
      && arcPressureContracts.length === 0
      && branchConsequenceContracts.length === 0
      && endingRealizationContracts.length === 0
      && failureModeAuditContracts.length === 0
    ) {
      return { valid: true, score: 100, issues, suggestions: [] };
    }

    for (const contract of contracts) {
      const planHasMetadata = hasPlannedContractMetadata(input.seasonPlan, contract);
      const planUse = hasStructuredPlanUse(input.seasonPlan, contract);
      if (!planHasMetadata || !planUse) {
        issues.push(this.error(
          `Episode ${contract.episodeNumber} treatment field "${contract.fieldName}" was not consumed into a concrete plan artifact: "${contract.sourceText}".`,
          issueLocation(contract, input.seasonPlan),
          'Assign the field to a scene turn, encounter, choice, information ledger entry, consequence chain, mechanic pressure contract, or cliffhanger/ending plan before prose generation.',
        ));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasFinalRealization(input, contract)) {
        issues.push(this.error(
          `Episode ${contract.episodeNumber} treatment field "${contract.fieldName}" was planned but not realized in reader-facing story pressure: "${contract.sourceText}".`,
          issueLocation(contract, input.seasonPlan),
          'Repair the assigned scene/cluster or episode ending so this authored field becomes visible as action, choice pressure, encounter behavior, information movement, consequence residue, changed state, or cliffhanger pressure.',
        ));
      }
    }

    for (const contract of worldContracts) {
      const planHasMetadata = hasWorldPlannedContractMetadata(input.seasonPlan, contract);
      const planUse = hasWorldStructuredPlanUse(input.seasonPlan, contract);
      if (!planHasMetadata || !planUse) {
        issues.push(this.error(
          `World/location treatment field "${contract.fieldName}" was not consumed into a concrete plan artifact: "${contract.sourceText}".`,
          worldIssueLocation(contract, input.seasonPlan),
          'Assign the world/location field to the world bible, location introduction, scene turn, choice pressure, encounter, information ledger entry, or mechanic pressure contract before prose generation.',
        ));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasWorldFinalRealization(input, contract)) {
        issues.push(this.error(
          `World/location treatment field "${contract.fieldName}" was planned but not realized in reader-facing story pressure: "${contract.sourceText}".`,
          worldIssueLocation(contract, input.seasonPlan),
          'Repair the assigned scene/cluster so this authored setting field becomes visible as location purpose, rule pressure, faction leverage, taboo/cost, information movement, choice pressure, or changed access.',
        ));
      }
    }

    for (const contract of stakesContracts) {
      const planHasMetadata = hasStakesPlannedContractMetadata(input.seasonPlan, contract);
      const planUse = hasStakesStructuredPlanUse(input.seasonPlan, contract);
      if (!planHasMetadata || !planUse) {
        issues.push(this.error(
          `Stakes architecture field "${contract.fieldName}" was not consumed into a concrete plan artifact: "${contract.sourceText}".`,
          stakesIssueLocation(contract, input.seasonPlan),
          'Assign the stakes field to a scene turn, choice pressure, encounter, information ledger entry, consequence chain, mechanic pressure contract, relationship/world/character contract, or episode ending before prose generation.',
        ));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasStakesFinalRealization(input, contract)) {
        issues.push(this.error(
          `Stakes architecture field "${contract.fieldName}" was planned but not realized in reader-facing story pressure: "${contract.sourceText}".`,
          stakesIssueLocation(contract, input.seasonPlan),
          'Repair the assigned scene/cluster or ending so this authored stake becomes visible as material cost/access/resource, relational risk, identity pressure, existential threat, escalation, or emotional-anchor residue.',
        ));
      }
    }

    for (const contract of storyCircleContracts) {
      const planHasMetadata = hasStoryCirclePlannedContractMetadata(input.seasonPlan, contract);
      const planUse = hasStoryCircleStructuredPlanUse(input.seasonPlan, contract);
      if (!planHasMetadata || !planUse) {
        issues.push(this.error(
          `Story Circle beat "${contract.beat}" was not consumed into a concrete plan artifact: "${contract.sourceText}".`,
          storyCircleIssueLocation(contract, input.seasonPlan),
          'Assign the authored beat text to a scene turn, required beat, choice/encounter, mechanic pressure contract, information movement, or episode ending before prose generation.',
        ));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasStoryCircleFinalRealization(input, contract)) {
        issues.push(this.error(
          `Story Circle beat "${contract.beat}" was planned but its authored event/state change was not realized in generated prose: "${contract.sourceText}".`,
          storyCircleIssueLocation(contract, input.seasonPlan),
          'Repair the assigned scene/cluster or finale/ending so the authored Story Circle beat is staged as visible event, reveal, choice, cost, changed state, or handoff.',
        ));
      }
    }

    for (const contract of arcPressureContracts) {
      const planHasMetadata = hasArcPressurePlannedContractMetadata(input.seasonPlan, contract);
      const planUse = hasArcPressureStructuredPlanUse(input.seasonPlan, contract);
      if (!planHasMetadata || !planUse) {
        issues.push(this.error(
          `Arc pressure field "${contract.fieldName}" for "${contract.arcTitle}" was not consumed into a concrete plan artifact: "${contract.sourceText}".`,
          arcPressureIssueLocation(contract, input.seasonPlan),
          'Assign the authored arc field to a SeasonArc field plus scene turn, required beat, choice/encounter, mechanic pressure contract, information movement, episode ending, or next-arc handoff before prose generation.',
        ));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasArcPressureFinalRealization(input, contract)) {
        issues.push(this.error(
          `Arc pressure field "${contract.fieldName}" for "${contract.arcTitle}" was planned but not realized in reader-facing story movement: "${contract.sourceText}".`,
          arcPressureIssueLocation(contract, input.seasonPlan),
          'Repair the assigned scene/cluster or episode ending so this authored arc pressure becomes visible as tested question, Lie pressure, reframe, cost, changed episode state, or next-arc residue.',
        ));
      }
    }

    for (const contract of branchConsequenceContracts) {
      const planHasMetadata = hasBranchPlannedContractMetadata(input.seasonPlan, contract);
      const planUse = hasBranchStructuredPlanUse(input.seasonPlan, contract);
      if (!planHasMetadata || !planUse) {
        issues.push(this.error(
          `Cross-episode branch field "${contract.fieldName}" for "${contract.branchName}" was not consumed into a concrete plan artifact: "${contract.sourceText}".`,
          branchIssueLocation(contract, input.seasonPlan),
          'Assign the authored branch field to a branch path, choice moment, season flag, consequence chain, mechanic pressure contract, scene turn, text variant, or ending eligibility target before prose generation.',
        ));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasBranchFinalRealization(input, contract)) {
        issues.push(this.error(
          `Cross-episode branch field "${contract.fieldName}" for "${contract.branchName}" was planned but not realized as durable reader-facing branch pressure: "${contract.sourceText}".`,
          branchIssueLocation(contract, input.seasonPlan),
          'Repair the origin/payoff/reconvergence scene or branch choice so this authored branch state survives as visible residue, conditional prose, changed access/resource/relationship/information, or ending eligibility.',
        ));
      }
    }

    for (const contract of endingRealizationContracts) {
      const planHasMetadata = hasEndingPlannedContractMetadata(input.seasonPlan, contract);
      const planUse = hasEndingStructuredPlanUse(input.seasonPlan, contract);
      if (!planHasMetadata || !planUse) {
        issues.push(this.error(
          `Alternate ending field "${contract.fieldName}" for "${contract.endingName}" was not consumed into a concrete plan artifact: "${contract.sourceText}".`,
          endingIssueLocation(contract, input.seasonPlan),
          'Assign the authored ending field to resolvedEndings, finale choice pressure, ending route conditions, season flags, choice moments, mechanic pressure, or final prose before finale generation.',
        ));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasEndingFinalRealization(input, contract)) {
        issues.push(this.error(
          `Alternate ending field "${contract.fieldName}" for "${contract.endingName}" was planned but not realized as earned route/finale payoff: "${contract.sourceText}".`,
          endingIssueLocation(contract, input.seasonPlan),
          'Repair the finale choice or ending prose so the authored ending summary, state driver, target condition, repeated choice pattern, emotional register, or theme payoff is earned by prior route mechanics.',
        ));
      }
    }

    for (const contract of failureModeAuditContracts) {
      const planHasMetadata = hasFailureModePlannedContractMetadata(input.seasonPlan, contract);
      const planUse = hasFailureModeStructuredPlanUse(input.seasonPlan, contract);
      if (!planHasMetadata || !planUse) {
        issues.push(this.error(
          `Failure mode audit field "${contract.label}" (${contract.contractKind}) was not consumed into a concrete plan artifact: "${contract.sourceText}".`,
          failureModeIssueLocation(contract, input.seasonPlan),
          'Assign the authored failure-mode mitigation to a scene turn, choice, setup/payoff edge, information ledger entry, mechanic pressure contract, arc pressure, ending route, or final-prose obligation before prose generation.',
        ));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasFailureModeFinalRealization(input, contract)) {
        issues.push(this.error(
          `Failure mode audit field "${contract.label}" (${contract.contractKind}) was planned but not realized as reader-facing mitigation: "${contract.sourceText}".`,
          failureModeIssueLocation(contract, input.seasonPlan),
          'Repair the assigned scene/cluster, choice, information movement, or ending so this audit mitigation is staged as agency, cause/effect, setup/payoff, fair-play clue, irreversible state change, or thematic rhyme.',
        ));
      }
    }

    return {
      valid: issues.length === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 8),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter(Boolean) as string[],
    };
  }
}
