import type { Episode } from '../../types';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import type { SerializedCallbackLedger } from '../pipeline/callbackLedger';
import {
  AUTO_RESIDUE_OBLIGATION_TAG,
  type ResidueObligationMetrics,
  isExcludedResidueFlag,
} from '../pipeline/residueObligations';
import {
  choiceSetsFlag,
  findResidueEvidence,
  isPlayerFacingCallbackText,
} from '../pipeline/choiceMemoryDebt';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { SceneContent } from '../agents/SceneWriter';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface ResidueObligationValidatorInput {
  episode: Episode;
  blueprint?: EpisodeBlueprint;
  seasonResiduePlan: SeasonResidueObligation[];
  callbackLedger?: SerializedCallbackLedger;
  episodeNumber: number;
  generatedThroughEpisode: number;
}

export type ResidueObligationValidationResult = ValidationResult & {
  metrics: ResidueObligationMetrics;
};

export class ResidueObligationValidator extends BaseValidator {
  constructor() {
    super('ResidueObligationValidator');
  }

  validate(input: ResidueObligationValidatorInput): ResidueObligationValidationResult {
    const sceneContents = episodeToSceneContents(input.episode);
    const choiceSets = episodeToChoiceSets(input.episode);
    const metrics: ResidueObligationMetrics = {
      plannedOutgoing: [],
      createdOutgoing: [],
      missingOutgoing: [],
      dueIncoming: [],
      paidIncoming: [],
      missingIncoming: [],
      futureWindow: [],
      terminalSliceOk: [],
      unplannedConsequentialFlags: [],
      autoInjected: [],
      unrepairable: [],
      outOfSliceSource: [],
      metadataOnly: [],
    };

    const issues: ValidationIssue[] = [];
    const obligations = input.seasonResiduePlan || [];
    const sourceGeneratedOrLedgered = (obligation: SeasonResidueObligation): boolean => {
      if (obligation.sourceEpisodeNumber <= input.generatedThroughEpisode) return true;
      return (input.callbackLedger?.hooks || []).some((hook) =>
        hook.residueObligationId === obligation.id ||
        hook.id === `flag:${obligation.flag}` ||
        hook.flags?.includes(obligation.flag),
      );
    };

    for (const obligation of obligations) {
      if (obligation.targetEpisodeNumbers.some((target) => target > input.generatedThroughEpisode)) {
        metrics.futureWindow.push(obligation.id);
      }
      if (obligation.payoffPolicy === 'terminal_slice_ok' && obligation.sourceEpisodeNumber === input.generatedThroughEpisode) {
        metrics.terminalSliceOk.push(obligation.id);
      }
      if (obligation.sourceEpisodeNumber === input.episodeNumber) {
        metrics.plannedOutgoing.push(obligation.id);
        if (choiceSets.some((set) => set.choices.some((choice) => choiceSetsFlag(choice, obligation.flag)))) {
          metrics.createdOutgoing.push(obligation.id);
        } else {
          metrics.missingOutgoing.push(obligation.id);
          issues.push(this.error(
            `Planned residue obligation "${obligation.id}" did not create flag "${obligation.flag}".`,
            `episode:${input.episodeNumber}`,
            'Ensure the assigned choice point has an option that sets the planned flag.',
          ));
        }
      }

      const dueHere =
        obligation.sourceEpisodeNumber <= input.episodeNumber &&
        obligation.targetEpisodeNumbers.includes(input.episodeNumber);
      if (!dueHere) continue;
      metrics.dueIncoming.push(obligation.id);
      if (!sourceGeneratedOrLedgered(obligation)) {
        metrics.outOfSliceSource.push(obligation.id);
        continue;
      }
      if (
        obligation.payoffPolicy === 'terminal_slice_ok' &&
        input.episodeNumber === input.generatedThroughEpisode
      ) {
        metrics.terminalSliceOk.push(obligation.id);
        continue;
      }
      const evidence = findResidueEvidence(sceneContents, choiceSets, obligation);
      if (evidence.paid) {
        metrics.paidIncoming.push(obligation.id);
      } else if (evidence.metadataOnly) {
        metrics.metadataOnly.push(obligation.id);
        metrics.missingIncoming.push(obligation.id);
        issues.push(this.warning(
          `Due residue obligation "${obligation.id}" only has metadata linkage, not player-facing evidence in episode ${input.episodeNumber}.`,
          `episode:${input.episodeNumber}`,
          'Pay it through beat text, a flag-gated textVariant, dialogue, choice text, or encounter outcome before QA.',
        ));
      } else {
        metrics.missingIncoming.push(obligation.id);
        issues.push(this.warning(
          `Due residue obligation "${obligation.id}" has no player-facing evidence in episode ${input.episodeNumber}.`,
          `episode:${input.episodeNumber}`,
          'Pay it through beat text, a flag-gated textVariant, dialogue, choice text, or encounter outcome before QA.',
        ));
      }
    }

    const plannedOutgoingFlags = new Set(
      obligations
        .filter((obligation) => obligation.sourceEpisodeNumber === input.episodeNumber)
        .map((obligation) => obligation.flag),
    );
    for (const choiceSet of choiceSets) {
      for (const choice of choiceSet.choices) {
        for (const consequence of choice.consequences || []) {
          if (
            consequence.type === 'setFlag' &&
            typeof consequence.flag === 'string' &&
            consequence.value !== false &&
            !plannedOutgoingFlags.has(consequence.flag) &&
            !isExcludedResidueFlag(consequence.flag)
          ) {
            metrics.unplannedConsequentialFlags.push(consequence.flag);
            issues.push(this.warning(
              `Choice "${choice.id}" sets unplanned consequential flag "${consequence.flag}".`,
              `episode:${input.episodeNumber}`,
              'Add a season residue obligation for this flag or remove the consequential flag.',
            ));
          }
        }
      }
    }

    for (const scene of input.episode.scenes || []) {
      for (const beat of scene.beats || []) {
        for (const variant of beat.textVariants || []) {
          if (variant.reminderTag === AUTO_RESIDUE_OBLIGATION_TAG && variant.residueObligationId) {
            metrics.autoInjected.push(variant.residueObligationId);
          }
          if (variant.residueObligationId && !isPlayerFacingCallbackText(variant.text)) {
            metrics.unrepairable.push(variant.residueObligationId);
            issues.push(this.error(
              `Residue variant "${variant.residueObligationId}" contains non-player-facing or planning prose.`,
              `episode:${input.episodeNumber}:scene:${scene.id}:beat:${beat.id}`,
              'Rewrite the variant as short in-fiction acknowledgment with no raw flags or design notes.',
            ));
          }
        }
      }
    }

    dedupeMetrics(metrics);
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const score = Math.max(0, 100 - errorCount * 25 - issues.length * 5);
    return {
      valid: errorCount === 0,
      score,
      issues,
      suggestions: issues.length ? ['Fulfill due planned residue before final packaging.'] : [],
      metrics,
    };
  }
}

function episodeToSceneContents(episode: Episode): SceneContent[] {
  return (episode.scenes || []).map((scene) => ({
    sceneId: scene.id,
    sceneName: scene.name,
    locationId: undefined,
    beats: scene.beats as SceneContent['beats'],
    startingBeatId: scene.startingBeatId,
    moodProgression: [],
    charactersInvolved: scene.charactersInvolved || [],
    keyMoments: [],
    continuityNotes: [],
  }));
}

function episodeToChoiceSets(episode: Episode): ChoiceSet[] {
  const sets: ChoiceSet[] = [];
  for (const scene of episode.scenes || []) {
    for (const beat of scene.beats || []) {
      if (!beat.choices?.length) continue;
      sets.push({
        beatId: beat.id,
        sceneId: scene.id,
        choiceType: beat.choices[0].choiceType || 'expression',
        choices: beat.choices as ChoiceSet['choices'],
        overallStakes: { want: '', cost: '', identity: '' },
        designNotes: '',
      });
    }
  }
  return sets;
}

function dedupeMetrics(metrics: ResidueObligationMetrics): void {
  for (const key of Object.keys(metrics) as Array<keyof ResidueObligationMetrics>) {
    metrics[key] = Array.from(new Set(metrics[key])) as string[];
  }
}
