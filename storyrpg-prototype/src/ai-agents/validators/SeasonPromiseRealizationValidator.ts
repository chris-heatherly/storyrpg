import type { Beat, Choice, Scene, Story } from '../../types';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type {
  PlannedScene,
  SeasonPromiseRealizationContract,
  SeasonPromiseRealizationKind,
  SeasonScenePlan,
} from '../../types/scenePlan';
import {
  buildSeasonPromiseContracts,
  seasonPromiseHasProgressionLanguage,
  seasonPromiseMatchThreshold,
} from '../utils/seasonPromiseContracts';
import {
  treatmentFieldCloseMatch,
} from '../utils/treatmentFieldContracts';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface SeasonPromiseRealizationInput {
  story?: Story;
  seasonPlan?: SeasonPlan;
  sourceAnalysis?: SourceMaterialAnalysis;
  treatmentSourced?: boolean;
  phase?: 'plan' | 'final';
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
    choice.visualResidueHint,
    choice.feedbackCue?.echoSummary,
    choice.feedbackCue?.progressSummary,
    choice.reminderPlan?.immediate,
    choice.reminderPlan?.shortTerm,
    choice.reminderPlan?.later,
    ...(choice.residueHints ?? []).map((hint) => hint.description),
    choice.failureResidue?.description,
    deepText(choice.conditions),
    deepText(choice.consequences),
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
    deepText(scene.authoredTreatmentFields),
    deepText(scene.seasonPromiseContracts),
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
    deepText(scene.authoredTreatmentFields),
    deepText(scene.seasonPromiseContracts),
    deepText(scene.encounter),
  ].filter(Boolean).join(' ');
}

function contractsFromInput(input: SeasonPromiseRealizationInput): SeasonPromiseRealizationContract[] {
  if ((input.seasonPlan?.seasonPromiseContracts ?? []).length > 0) {
    return input.seasonPlan?.seasonPromiseContracts ?? [];
  }
  return buildSeasonPromiseContracts({
    guidance: input.sourceAnalysis?.treatmentSeasonGuidance,
    architecture: input.seasonPlan?.seasonPromiseArchitecture,
    totalEpisodes: input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes ?? 1,
    treatmentSourced: input.treatmentSourced ?? (input.sourceAnalysis?.sourceFormat === 'story_treatment'),
  });
}

function contractSeverity(contract: SeasonPromiseRealizationContract): 'error' | 'warning' {
  return contract.blockingLevel === 'warning' ? 'warning' : 'error';
}

function episodePlanText(plan: SeasonPlan | undefined, episodeNumber: number): string {
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
    episode?.narrativeFunction?.setup,
    episode?.narrativeFunction?.conflict,
    episode?.narrativeFunction?.resolution,
    episode?.cliffhangerPlan?.hook,
    episode?.cliffhangerPlan?.setup,
    episode?.cliffhangerPlan?.resolvedEpisodeTension,
    episode?.cliffhangerPlan?.newOpenQuestion,
    episode?.cliffhangerPlan?.emotionalCharge,
    episode?.cliffhangerPlan?.nextEpisodePressure,
    ...scenes.map(plannedSceneText),
    deepText(choiceMoments),
    deepText(info),
    deepText(chains),
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

function targetedPlanScenes(scenePlan: SeasonScenePlan | undefined, contract: SeasonPromiseRealizationContract): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of scenePlan?.scenes ?? []) {
    if ((scene.seasonPromiseContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return (scenePlan?.scenes ?? []).filter((scene) =>
    targetIds.has(scene.id) || (contract.targetEpisodeNumbers ?? []).includes(scene.episodeNumber)
  );
}

function targetedStoryText(input: SeasonPromiseRealizationInput, contract: SeasonPromiseRealizationContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.seasonPromiseContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  const parts: string[] = [];
  for (const episode of input.story?.episodes ?? []) {
    if ((contract.targetEpisodeNumbers ?? []).includes(episode.number)) {
      parts.push(episode.title, episode.synopsis);
    }
    for (const scene of episode.scenes ?? []) {
      if (targetIds.has(scene.id) || (contract.targetEpisodeNumbers ?? []).includes(episode.number)) {
        parts.push(sceneText(scene));
      }
    }
  }
  return parts.filter(Boolean).join(' ');
}

function hasMetadataPreservation(input: SeasonPromiseRealizationInput, contract: SeasonPromiseRealizationContract): boolean {
  if (contract.contractKind !== 'genre_progression' && contract.contractKind !== 'tone_progression') return true;
  const fieldText = contract.contractKind === 'genre_progression'
    ? [input.story?.genre, input.seasonPlan?.genre, input.sourceAnalysis?.genre].filter(Boolean).join(' ')
    : [input.seasonPlan?.tone, input.sourceAnalysis?.tone].filter(Boolean).join(' ');
  return treatmentFieldCloseMatch(contract.sourceText, fieldText, seasonPromiseMatchThreshold(contract));
}

function hasStructuredPlanUse(input: SeasonPromiseRealizationInput, contract: SeasonPromiseRealizationContract): boolean {
  if (!hasMetadataPreservation(input, contract)) return false;

  const targetScenes = targetedPlanScenes(input.seasonPlan?.scenePlan, contract);
  const planText = [
    input.seasonPlan?.seasonSynopsis,
    input.seasonPlan?.seasonPromiseArchitecture?.seasonDramaticQuestion,
    input.seasonPlan?.seasonPromiseArchitecture?.centralPressure.description,
    input.seasonPlan?.seasonPromiseArchitecture?.centralPressure.pressuresLieBy,
    input.seasonPlan?.seasonPromiseArchitecture?.seasonPromise.premisePromise,
    input.seasonPlan?.seasonPromiseArchitecture?.seasonPromise.playerExperiencePromise,
    input.seasonPlan?.seasonPromiseArchitecture?.seasonPromise.emotionalPromise,
    ...(input.seasonPlan?.seasonPromiseArchitecture?.seasonPromise.variationPlan ?? []),
    ...(contract.targetEpisodeNumbers ?? []).map((episodeNumber) => episodePlanText(input.seasonPlan, episodeNumber)),
    ...targetScenes.map(plannedSceneText),
  ].filter(Boolean).join(' ');

  if (treatmentFieldCloseMatch(contract.sourceText, planText, seasonPromiseMatchThreshold(contract))) return true;
  if (contract.contractKind === 'genre_progression' || contract.contractKind === 'tone_progression') {
    return !seasonPromiseHasProgressionLanguage(contract.sourceText) || targetScenes.length > 0;
  }
  if (contract.contractKind === 'theme_question') {
    return targetScenes.some((scene) => scene.hasChoice || scene.kind === 'encounter' || (scene.mechanicPressure ?? []).some((pressure) => pressure.domain === 'identity'));
  }
  if (contract.contractKind === 'season_dramatic_question') {
    return targetScenes.some((scene) => Boolean(scene.turnContract) || scene.hasChoice || scene.kind === 'encounter')
      && Boolean(input.seasonPlan?.seasonPromiseArchitecture?.seasonDramaticQuestion);
  }
  if (contract.contractKind === 'inaction_pressure' || contract.contractKind === 'central_pressure') {
    return targetScenes.some((scene) => scene.hasChoice || scene.kind === 'encounter' || (scene.mechanicPressure ?? []).length > 0)
      || (input.seasonPlan?.consequenceChains ?? []).length > 0;
  }
  if (contract.contractKind === 'player_promise') {
    return targetScenes.some((scene) => scene.hasChoice || (scene.mechanicPressure ?? []).some((pressure) => pressure.domain === 'route'))
      || (input.seasonPlan?.choiceMoments ?? []).length > 0;
  }
  if (contract.contractKind === 'audience_promise') {
    return targetScenes.length >= Math.min(2, contract.targetEpisodeNumbers.length || 1);
  }
  if (contract.contractKind === 'emotional_promise' || contract.contractKind === 'fresh_variation_plan') {
    return targetScenes.length >= Math.min(2, contract.targetEpisodeNumbers.length || 1);
  }
  if (contract.contractKind === 'typical_episode_engine') {
    const targetEpisodes = contract.targetEpisodeNumbers ?? [];
    const representedEpisodes = new Set(targetScenes.map((scene) => scene.episodeNumber));
    const hasChoiceOrEncounter = targetScenes.some((scene) => scene.hasChoice || scene.kind === 'encounter');
    const hasInfoOrConsequence = (input.seasonPlan?.informationLedger ?? []).some((entry) => targetEpisodes.includes(entry.introducedEpisode) || targetEpisodes.includes(entry.plannedRevealEpisode ?? -1) || targetEpisodes.includes(entry.plannedPayoffEpisode ?? -1))
      || (input.seasonPlan?.consequenceChains ?? []).some((chain) => (chain.consequences ?? []).some((consequence) => targetEpisodes.includes(consequence.episodeNumber)));
    return representedEpisodes.size >= Math.min(2, targetEpisodes.length || 1) && hasChoiceOrEncounter && hasInfoOrConsequence;
  }
  if (contract.contractKind === 'season_resolution_obligation') {
    const finale = input.seasonPlan?.episodes?.find((episode) => episode.episodeNumber === input.seasonPlan?.totalEpisodes)
      || input.seasonPlan?.episodes?.[input.seasonPlan.episodes.length - 1];
    return Boolean(finale?.cliffhangerPlan || input.seasonPlan?.seasonPromiseArchitecture?.seasonCompleteness)
      || targetScenes.some((scene) => scene.narrativeRole === 'release' || (scene.mechanicPressure ?? []).some((pressure) => pressure.function === 'resolve'));
  }
  if (contract.contractKind === 'future_open_thread') {
    return Boolean(input.seasonPlan?.seasonPromiseArchitecture?.seasonCompleteness?.openFuturePressure)
      || (input.seasonPlan?.informationLedger ?? []).some((entry) => (entry.plannedPayoffEpisode ?? entry.plannedRevealEpisode ?? 0) >= (input.seasonPlan?.totalEpisodes ?? 1))
      || targetScenes.some((scene) => (scene.mechanicPressure ?? []).some((pressure) => pressure.domain === 'information' || pressure.payoffWindow));
  }
  return targetScenes.length > 0;
}

function hasFinalRealization(input: SeasonPromiseRealizationInput, contract: SeasonPromiseRealizationContract): boolean {
  if (!hasMetadataPreservation(input, contract)) return false;

  if (
    (contract.contractKind === 'genre_progression' || contract.contractKind === 'tone_progression')
    && !seasonPromiseHasProgressionLanguage(contract.sourceText)
  ) {
    return true;
  }

  const text = [
    targetedStoryText(input, contract),
    ...(contract.targetEpisodeNumbers ?? []).map((episodeNumber) => episodeStoryText(input.story, episodeNumber)),
  ].filter(Boolean).join(' ');
  if (treatmentFieldCloseMatch(contract.sourceText, text, seasonPromiseMatchThreshold(contract))) return true;

  const hasReaderText = text.trim().length > 80;
  if (!hasReaderText) return false;

  if (contract.contractKind === 'theme_question') {
    return /\b(choice|choose|decide|refuse|accept|voice|truth|self|cost|risk|trust|love|become|want|need)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'season_dramatic_question') {
    return /\b(choice|choose|decide|refuse|accept|truth|self|voice|author|story|want|need|become|known|chosen)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'inaction_pressure' || contract.contractKind === 'central_pressure') {
    return /\b(cost|threat|danger|lose|loss|cannot|must|narrow|hunted|pressure|risk|refuse|choice|consequence|door|access|safety|voice)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'player_promise') {
    return /\b(choice|choose|decide|accept|refuse|write|voice|blog|route|ending|loyal|ward|open|closed|cost|consequence|steer)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'typical_episode_engine') {
    return /\b(choice|choose|encounter|date|conversation|friend|reveal|detail|cost|shift|tilt|romance|question|tell|ward|mirror)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'season_resolution_obligation') {
    return /\b(resolve|answer|keeps?|surrenders?|freed|forgiven|sanctuary|design|walks?|life|finale|changed|saved|lost)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'future_open_thread') {
    return /\b(open|future|next|arrives?|letter|truth|visit|entangled|reclaimed|season|remains|thread|pressure)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (
    contract.contractKind === 'genre_progression'
    || contract.contractKind === 'tone_progression'
    || contract.contractKind === 'audience_promise'
    || contract.contractKind === 'emotional_promise'
    || contract.contractKind === 'fresh_variation_plan'
  ) {
    return contract.targetEpisodeNumbers.filter((episodeNumber) => episodeStoryText(input.story, episodeNumber).trim().length > 0).length >= Math.min(2, contract.targetEpisodeNumbers.length || 1);
  }
  return hasStructuredPlanUse(input, contract) && hasReaderText;
}

function issueLocation(contract: SeasonPromiseRealizationContract): string {
  const sceneId = contract.targetSceneIds[0] ?? 'episode';
  const episode = contract.targetEpisodeNumbers[0] ?? 1;
  return `seasonPromise:ep${episode}:${sceneId}:${contract.id}`;
}

export class SeasonPromiseRealizationValidator extends BaseValidator {
  constructor() {
    super('SeasonPromiseRealizationValidator');
  }

  validatePlan(input: Pick<SeasonPromiseRealizationInput, 'seasonPlan' | 'sourceAnalysis' | 'treatmentSourced'>): ValidationResult {
    return this.validate({ ...input, phase: 'plan' });
  }

  validate(input: SeasonPromiseRealizationInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const contracts = contractsFromInput(input);
    if (contracts.length === 0) return { valid: true, score: 100, issues, suggestions: [] };

    for (const contract of contracts) {
      const planUse = hasStructuredPlanUse(input, contract);
      if (!planUse) {
        const message = `Season promise "${contract.contractKind}" was not consumed into concrete plan artifacts: "${contract.sourceText}".`;
        const suggestion = 'Assign this top-level promise to episode plans, planned scenes, choices, encounters, information ledger entries, consequence chains, mechanic pressure, or ending/cliffhanger plans.';
        issues.push(contractSeverity(contract) === 'error'
          ? this.error(message, issueLocation(contract), suggestion)
          : this.warning(message, issueLocation(contract), suggestion));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasFinalRealization(input, contract)) {
        const message = `Season promise "${contract.contractKind}" was planned but not realized as reader-facing story material: "${contract.sourceText}".`;
        const suggestion = 'Repair the assigned scene/cluster or episode band so the promise appears as staged action, choice pressure, encounter behavior, consequence residue, tone/genre movement, or changed state.';
        issues.push(contractSeverity(contract) === 'error'
          ? this.error(message, issueLocation(contract), suggestion)
          : this.warning(message, issueLocation(contract), suggestion));
      }
    }

    return {
      valid: issues.filter((issue) => issue.severity === 'error').length === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 8),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter(Boolean) as string[],
    };
  }
}
