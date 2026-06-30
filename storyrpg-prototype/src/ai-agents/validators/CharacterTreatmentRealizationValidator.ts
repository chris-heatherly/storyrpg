import type { Beat, Choice, Scene, Story } from '../../types';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type {
  CharacterTreatmentFieldKind,
  CharacterTreatmentRealizationContract,
  PlannedScene,
  SeasonScenePlan,
} from '../../types/scenePlan';
import {
  buildCharacterTreatmentContracts,
  characterTreatmentMatchThreshold,
} from '../utils/characterTreatmentContracts';
import {
  treatmentFieldCloseMatch,
} from '../utils/treatmentFieldContracts';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface CharacterTreatmentRealizationInput {
  story?: Story;
  seasonPlan?: SeasonPlan;
  sourceAnalysis?: SourceMaterialAnalysis;
  treatmentSourced?: boolean;
  phase?: 'plan' | 'final';
}

const EARLY_KINDS = new Set<CharacterTreatmentFieldKind>([
  'role_fact',
  'origin_pressure',
  'conscious_want',
  'lie_pressure',
  'wound_pressure',
  'starting_identity',
]);

const LATE_KINDS = new Set<CharacterTreatmentFieldKind>([
  'dramatic_need',
  'truth_target',
  'arc_mode',
  'ending_state',
  'climax_choice',
]);

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
    scene.turnContract?.beforeState,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    deepText(scene.relationshipPacing),
    deepText(scene.mechanicPressure),
    deepText(scene.authoredTreatmentFields),
    deepText(scene.seasonPromiseContracts),
    deepText(scene.characterTreatmentContracts),
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
    deepText(scene.characterTreatmentContracts),
    deepText(scene.encounter),
  ].filter(Boolean).join(' ');
}

function contractsFromInput(input: CharacterTreatmentRealizationInput): CharacterTreatmentRealizationContract[] {
  if ((input.seasonPlan?.characterTreatmentContracts ?? []).length > 0) {
    return input.seasonPlan?.characterTreatmentContracts ?? [];
  }
  if ((input.sourceAnalysis?.characterTreatmentContracts ?? []).length > 0) {
    return input.sourceAnalysis?.characterTreatmentContracts ?? [];
  }
  return buildCharacterTreatmentContracts({
    guidance: input.sourceAnalysis?.treatmentSeasonGuidance?.protagonistGuidance,
    characterArchitecture: input.sourceAnalysis?.characterArchitecture,
    protagonist: input.sourceAnalysis?.protagonist,
    endings: input.sourceAnalysis?.resolvedEndings,
    totalEpisodes: input.seasonPlan?.totalEpisodes ?? input.sourceAnalysis?.totalEstimatedEpisodes ?? 1,
    treatmentSourced: input.treatmentSourced ?? (input.sourceAnalysis?.sourceFormat === 'story_treatment'),
  });
}

function contractSeverity(contract: CharacterTreatmentRealizationContract): 'error' | 'warning' {
  return contract.blockingLevel === 'warning' ? 'warning' : 'error';
}

function targetedPlanScenes(scenePlan: SeasonScenePlan | undefined, contract: CharacterTreatmentRealizationContract): PlannedScene[] {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of scenePlan?.scenes ?? []) {
    if ((scene.characterTreatmentContracts ?? []).some((field) => field.id === contract.id)) {
      targetIds.add(scene.id);
    }
  }
  return (scenePlan?.scenes ?? []).filter((scene) =>
    targetIds.has(scene.id) || (contract.targetEpisodeNumbers ?? []).includes(scene.episodeNumber)
  );
}

function targetedStoryText(input: CharacterTreatmentRealizationInput, contract: CharacterTreatmentRealizationContract): string {
  const targetIds = new Set(contract.targetSceneIds);
  for (const scene of input.seasonPlan?.scenePlan?.scenes ?? []) {
    if ((scene.characterTreatmentContracts ?? []).some((field) => field.id === contract.id)) {
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

function protagonistText(input: CharacterTreatmentRealizationInput): string {
  const rosterProtagonist = input.story?.npcs?.find((npc) => npc.role === 'protagonist');
  return [
    input.sourceAnalysis?.protagonist.name,
    input.sourceAnalysis?.protagonist.description,
    input.sourceAnalysis?.protagonist.arc,
    deepText(input.sourceAnalysis?.protagonist.fashionStyle),
    input.seasonPlan?.protagonist.name,
    input.seasonPlan?.protagonist.description,
    rosterProtagonist?.name,
    rosterProtagonist?.pronouns,
    rosterProtagonist?.description,
    rosterProtagonist?.want,
    rosterProtagonist?.fear,
    rosterProtagonist?.flaw,
    deepText(rosterProtagonist?.arc),
    deepText(rosterProtagonist?.voiceProfile),
  ].filter(Boolean).join(' ');
}

function endingText(plan: SeasonPlan | undefined, contract: CharacterTreatmentRealizationContract): string {
  const targetIds = new Set(contract.targetEndingIds ?? []);
  const endings = plan?.resolvedEndings ?? [];
  const targeted = targetIds.size > 0 ? endings.filter((ending) => targetIds.has(ending.id)) : endings;
  return targeted.map((ending) => [
    ending.id,
    ending.name,
    ending.summary,
    ending.emotionalRegister,
    ending.themePayoff,
    ending.targetConditions.join(' '),
    ending.stateDrivers.map((driver) => `${driver.type} ${driver.label} ${driver.details ?? ''}`).join(' '),
  ].join(' ')).join(' ');
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
    episode?.cliffhangerPlan?.resolvedEpisodeTension,
    episode?.cliffhangerPlan?.nextEpisodePressure,
    ...scenes.map(plannedSceneText),
    deepText(choiceMoments),
    deepText(info),
    deepText(chains),
  ].filter(Boolean).join(' ');
}

function hasVisualProfile(input: CharacterTreatmentRealizationInput, contract: CharacterTreatmentRealizationContract): boolean {
  if (contract.contractKind !== 'visual_identity') return true;
  return Boolean(input.sourceAnalysis?.protagonist.fashionStyle)
    || treatmentFieldCloseMatch(contract.sourceText, protagonistText(input), 0.2)
    || targetedPlanScenes(input.seasonPlan?.scenePlan, contract).length > 0;
}

function hasPlanMetadata(plan: SeasonPlan | undefined, contract: CharacterTreatmentRealizationContract): boolean {
  if ((plan?.characterTreatmentContracts ?? []).some((field) => field.id === contract.id)) return true;
  return (plan?.scenePlan?.scenes ?? []).some((scene) =>
    (scene.characterTreatmentContracts ?? []).some((field) => field.id === contract.id && (field.targetSceneIds?.length ?? 0) > 0)
  );
}

function hasStructuredPlanUse(input: CharacterTreatmentRealizationInput, contract: CharacterTreatmentRealizationContract): boolean {
  if (!hasVisualProfile(input, contract)) return false;
  if (contract.contractKind === 'ending_state') {
    return (contract.targetEndingIds ?? []).length > 0
      || treatmentFieldCloseMatch(contract.sourceText, endingText(input.seasonPlan, contract), 0.18);
  }
  const targetScenes = targetedPlanScenes(input.seasonPlan?.scenePlan, contract);
  const planText = [
    protagonistText(input),
    input.seasonPlan?.seasonSynopsis,
    input.seasonPlan?.characterArchitecture?.protagonist.lie,
    input.seasonPlan?.characterArchitecture?.protagonist.originPressure,
    input.seasonPlan?.characterArchitecture?.protagonist.truth,
    input.seasonPlan?.characterArchitecture?.protagonist.want,
    input.seasonPlan?.characterArchitecture?.protagonist.need,
    input.seasonPlan?.characterArchitecture?.protagonist.arcMode,
    input.seasonPlan?.characterArchitecture?.protagonist.climaxChoice.choiceQuestion,
    ...(input.seasonPlan?.arcs ?? []).map((arc) => [
      arc.arcQuestion,
      arc.identityPressureFacet,
      arc.midpointRecontextualization?.description,
      arc.lateArcCrisis?.description,
      arc.finaleAnswer,
      arc.handoffPressure,
      deepText(arc.episodeTurnouts),
    ].join(' ')),
    ...(contract.targetEpisodeNumbers ?? []).map((episodeNumber) => episodePlanText(input.seasonPlan, episodeNumber)),
    ...targetScenes.map(plannedSceneText),
    endingText(input.seasonPlan, contract),
  ].filter(Boolean).join(' ');

  if (treatmentFieldCloseMatch(contract.sourceText, planText, characterTreatmentMatchThreshold(contract))) return true;

  if (contract.contractKind === 'canonical_identity') {
    return treatmentFieldCloseMatch(contract.characterName, protagonistText(input), 0.8);
  }
  if (contract.contractKind === 'visual_identity') {
    return hasVisualProfile(input, contract);
  }
  if (contract.contractKind === 'starting_identity') {
    return targetScenes.some((scene) => scene.episodeNumber === 1 && scene.order <= 1 && Boolean(scene.turnContract || scene.hasChoice || scene.dramaticPurpose));
  }
  if (contract.contractKind === 'climax_choice') {
    return targetScenes.some((scene) => scene.hasChoice || scene.narrativeRole === 'release' || scene.narrativeRole === 'turn')
      || (input.seasonPlan?.choiceMoments ?? []).some((moment) => moment.episode === input.seasonPlan?.totalEpisodes);
  }
  if (contract.contractKind === 'role_fact') {
    return targetScenes.some((scene) => Boolean(scene.turnContract) || (scene.mechanicPressure ?? []).length > 0)
      || (input.seasonPlan?.informationLedger ?? []).some((entry) => treatmentFieldCloseMatch(contract.sourceText, deepText(entry), 0.18));
  }
  if (EARLY_KINDS.has(contract.contractKind)) {
    return targetScenes.some((scene) => scene.episodeNumber <= Math.max(1, Math.ceil((input.seasonPlan?.totalEpisodes ?? 1) / 2)) && (scene.hasChoice || Boolean(scene.turnContract) || (scene.mechanicPressure ?? []).length > 0));
  }
  if (LATE_KINDS.has(contract.contractKind)) {
    return targetScenes.some((scene) => scene.hasChoice || scene.narrativeRole === 'turn' || scene.narrativeRole === 'release' || (scene.mechanicPressure ?? []).some((pressure) => pressure.function === 'resolve' || pressure.function === 'gate'))
      || Boolean(input.seasonPlan?.seasonPromiseArchitecture?.seasonCompleteness);
  }
  if (contract.contractKind === 'pressure_point') {
    return targetScenes.some((scene) => (scene.mechanicPressure ?? []).length > 0 || Boolean(scene.turnContract))
      || (input.seasonPlan?.informationLedger ?? []).some((entry) => treatmentFieldCloseMatch(contract.sourceText, deepText(entry), 0.18));
  }
  return targetScenes.length > 0;
}

function hasFinalRealization(input: CharacterTreatmentRealizationInput, contract: CharacterTreatmentRealizationContract): boolean {
  if (!hasVisualProfile(input, contract)) return false;
  if (contract.contractKind === 'visual_identity') return true;

  const text = [
    targetedStoryText(input, contract),
    protagonistText(input),
    contract.contractKind === 'ending_state' || contract.contractKind === 'climax_choice' || contract.contractKind === 'truth_target' || contract.contractKind === 'arc_mode'
      ? endingText(input.seasonPlan, contract)
      : '',
  ].filter(Boolean).join(' ');

  if (treatmentFieldCloseMatch(contract.sourceText, text, characterTreatmentMatchThreshold(contract))) return true;
  const hasReaderText = text.trim().length > 80;
  if (!hasReaderText && contract.contractKind !== 'canonical_identity') return false;

  if (contract.contractKind === 'canonical_identity') {
    return treatmentFieldCloseMatch(contract.characterName, protagonistText(input), 0.8);
  }
  if (contract.contractKind === 'starting_identity') {
    return /\b(order|watch|observe|avoid|second|baseline|start|arrive|first|before|hesitat|flinch|guard|notice)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'conscious_want') {
    return /\b(want|trying|goal|build|choose|desire|appetite|friend|write|blog|prove|pursue|claim)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'dramatic_need' || contract.contractKind === 'truth_target') {
    return /\b(voice|truth|free|known|choose|refuse|claim|author|self|own|become|cost|brave|honest)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'lie_pressure' || contract.contractKind === 'wound_pressure') {
    return /\b(chosen|safe|known|flinch|hurt|public|humiliat|avoid|apolog|edit|take|fear|guard|believe|protect|betray)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'ending_state' || contract.contractKind === 'climax_choice' || contract.contractKind === 'arc_mode') {
    return /\b(choice|choose|refuse|accept|become|ending|walk|life|final|truth|lie|voice|blog|saved|lost|free|surrender|claim)\b/i.test(text)
      && hasStructuredPlanUse(input, contract);
  }
  if (contract.contractKind === 'role_fact' || contract.contractKind === 'origin_pressure' || contract.contractKind === 'pressure_point') {
    return hasStructuredPlanUse(input, contract) && hasReaderText;
  }
  return hasStructuredPlanUse(input, contract) && hasReaderText;
}

function issueLocation(contract: CharacterTreatmentRealizationContract): string {
  const sceneId = contract.targetSceneIds[0] ?? 'episode';
  const episode = contract.targetEpisodeNumbers[0] ?? 1;
  return `characterTreatment:ep${episode}:${sceneId}:${contract.id}`;
}

export class CharacterTreatmentRealizationValidator extends BaseValidator {
  constructor() {
    super('CharacterTreatmentRealizationValidator');
  }

  validatePlan(input: Pick<CharacterTreatmentRealizationInput, 'seasonPlan' | 'sourceAnalysis' | 'treatmentSourced'>): ValidationResult {
    return this.validate({ ...input, phase: 'plan' });
  }

  validate(input: CharacterTreatmentRealizationInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const contracts = contractsFromInput(input);
    if (contracts.length === 0) return { valid: true, score: 100, issues, suggestions: [] };

    for (const contract of contracts) {
      const metadata = hasPlanMetadata(input.seasonPlan, contract);
      const planUse = hasStructuredPlanUse(input, contract);
      if (!metadata || !planUse) {
        const message = `Protagonist treatment field "${contract.fieldName}" was not consumed into concrete plan artifacts: "${contract.sourceText}".`;
        const suggestion = 'Assign this character field to the character bible, scene turn, choice, mechanic pressure, information ledger, visual profile, finale choice, or ending target before prose generation.';
        issues.push(contractSeverity(contract) === 'error'
          ? this.error(message, issueLocation(contract), suggestion)
          : this.warning(message, issueLocation(contract), suggestion));
        if (input.phase === 'plan') continue;
      }

      if (input.phase !== 'plan' && input.story && !hasFinalRealization(input, contract)) {
        const message = `Protagonist treatment field "${contract.fieldName}" was planned but not realized as reader-facing character pressure: "${contract.sourceText}".`;
        const suggestion = 'Repair the assigned scene/cluster, choice, character bible, or finale/ending so this protagonist field becomes visible as baseline, behavior, choice pressure, subtext, consequence residue, route pressure, or end-state change.';
        issues.push(contractSeverity(contract) === 'error'
          ? this.error(message, issueLocation(contract), suggestion)
          : this.warning(message, issueLocation(contract), suggestion));
      }
    }

    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    return {
      valid: errorCount === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 8),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter(Boolean) as string[],
    };
  }
}
