/**
 * ChoiceImpactValidator
 *
 * Deterministic enforcement for the Story Quality Contract's choice rules:
 * meaningful choices declare impact factors, stakes, and consequence tiers;
 * flavor/expression choices never branch.
 */

import type { Choice, ChoiceImpactFactor } from '../../types/choice';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface ChoiceImpactInput {
  choices: Array<Choice & { sceneId?: string; beatId?: string }>;
}

export interface ChoiceImpactMetrics {
  totalChoices: number;
  meaningfulChoices: number;
  choicesWithImpactFactors: number;
  flavorBranches: number;
}

export interface ChoiceImpactResult extends ValidationResult {
  metrics: ChoiceImpactMetrics;
}

const IMPACT_FACTORS: ChoiceImpactFactor[] = [
  'outcome',
  'process',
  'information',
  'relationship',
  'identity',
];

export class ChoiceImpactValidator extends BaseValidator {
  constructor() {
    super('ChoiceImpactValidator');
  }

  validate(input: ChoiceImpactInput): ChoiceImpactResult {
    const issues: ValidationIssue[] = [];
    let meaningfulChoices = 0;
    let choicesWithImpactFactors = 0;
    let flavorBranches = 0;

    for (const choice of input.choices) {
      const location = [choice.sceneId, choice.beatId, choice.id].filter(Boolean).join(':') || choice.id;
      const isFlavor = choice.choiceIntent === 'flavor' || choice.choiceType === 'expression';
      const isMeaningful = !isFlavor;

      if (isFlavor && choice.nextSceneId) {
        flavorBranches++;
        issues.push(this.error(
          `Flavor/expression choice "${choice.id}" branches to ${choice.nextSceneId}.`,
          location,
          'Remove nextSceneId or reclassify this as a meaningful branching choice with impact factors.',
        ));
      }

      if (!isMeaningful) continue;
      meaningfulChoices++;

      const factors = (choice.impactFactors ?? []).filter((factor) => IMPACT_FACTORS.includes(factor));
      if (factors.length > 0) {
        choicesWithImpactFactors++;
      } else {
        issues.push(this.warning(
          `Meaningful choice "${choice.id}" has no impactFactors.`,
          location,
          'Declare at least one of outcome, process, information, relationship, or identity.',
        ));
      }

      const needsStakes = choice.choiceIntent === 'branching'
        || choice.choiceIntent === 'dilemma'
        || choice.choiceType === 'dilemma'
        || Boolean(choice.nextSceneId);
      if (needsStakes && !hasCompleteStakes(choice)) {
        issues.push(this.warning(
          `Choice "${choice.id}" needs complete stakes metadata.`,
          location,
          'Add stakes.want, stakes.cost, and stakes.identity so repair prompts can preserve the choice geometry.',
        ));
      }

      if (choice.consequenceTier && choice.consequenceTier !== 'callback' && !hasDurableImpact(choice)) {
        issues.push(this.warning(
          `Choice "${choice.id}" is tiered as ${choice.consequenceTier} but has no durable consequence or route impact.`,
          location,
          'Add consequences, nextSceneId, tintFlag, delayedConsequences, or lower the consequence tier.',
        ));
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    const score = Math.max(0, 100 - errors * 30 - warnings * 8);

    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics: {
        totalChoices: input.choices.length,
        meaningfulChoices,
        choicesWithImpactFactors,
        flavorBranches,
      },
    };
  }
}

function hasCompleteStakes(choice: Choice): boolean {
  return Boolean(choice.stakes?.want?.trim() && choice.stakes?.cost?.trim() && choice.stakes?.identity?.trim());
}

function hasDurableImpact(choice: Choice): boolean {
  return Boolean(
    choice.nextSceneId
      || choice.tintFlag
      || (choice.consequences && choice.consequences.length > 0)
      || (choice.delayedConsequences && choice.delayedConsequences.length > 0)
      || choice.memorableMoment,
  );
}
