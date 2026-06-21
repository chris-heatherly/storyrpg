import type { Beat, Choice, Scene, Story } from '../../types';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type {
  AuthoredTreatmentFieldContract,
  AuthoredTreatmentFieldKind,
  PlannedScene,
  SeasonScenePlan,
} from '../../types/scenePlan';
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
    deepText(scene.encounter),
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
    if (contracts.length === 0) {
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

    return {
      valid: issues.length === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 8),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter(Boolean) as string[],
    };
  }
}
