/**
 * Season Budget Validator
 *
 * Validates the season choice/consequence "dramatic diet" over a
 * {@link SeasonScenePlan} BEFORE episodes generate. It reasons over the budgeted
 * units (every encounter + every standard scene that carries a budgeted choice),
 * measured on WEIGHTED totals (a scene choice weighs {@link SCENE_BUDGET_WEIGHT},
 * an encounter weighs {@link ENCOUNTER_BUDGET_WEIGHT} — "budget the spine, not
 * the texture").
 *
 * Two distributions are checked against their season targets, each within
 * {@link BUDGET_TOLERANCE} (a per-type/per-tier deviation > `warn` is a warning,
 * > `error` is an error):
 *   - the choice-type mix vs {@link CHOICE_TYPE_TARGET} (expression / relationship
 *     / strategic / dilemma);
 *   - the consequence-tier mix vs {@link CONSEQUENCE_TARGET} (callback / tint /
 *     branchlet / branch).
 *
 * Plus the hard invariants of the model:
 *   - an encounter is NEVER an 'expression' choice (encounters are stakes-driven);
 *   - an encounter (which always branches in spirit) is NEVER a 'callback'
 *     consequence — it earns at least a 'branchlet';
 *   - any 'expression' unit resolves to a 'callback' consequence (voice, no stakes).
 *
 * This is a season-altitude validator and runs after allocation, before the plan
 * is finalized. Default-advisory: it returns issues for the diagnostics trail;
 * gating to blocking (GATE_SEASON_BUDGETS) is the caller's choice.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import {
  BUDGET_TOLERANCE,
  CHOICE_TYPE_TARGET,
  CONSEQUENCE_TARGET,
  type ConsequenceTier,
  type SeasonScenePlan,
} from '../../types/scenePlan';
import {
  buildBudgetUnits,
  weightedChoiceMix,
  weightedConsequenceMix,
} from '../pipeline/seasonBudgetAllocator';

type ChoiceTypeKey = 'expression' | 'relationship' | 'strategic' | 'dilemma';

export class SeasonBudgetValidator extends BaseValidator {
  constructor() {
    super('SeasonBudgetValidator');
  }

  validate(plan: SeasonScenePlan): ValidationResult {
    const issues: ValidationIssue[] = [];

    const units = buildBudgetUnits(plan);
    if (units.length === 0) {
      issues.push(this.warning(
        'Season plan has no budgeted units (no encounters and no choice-bearing scenes).',
        'scenePlan',
        'Allocate at least one budgeted choice or encounter before validating the dramatic diet.',
      ));
      return finalize(issues);
    }

    // --- Distribution checks against target, within tolerance bands ----------
    const choiceMix = weightedChoiceMix(units);
    for (const type of Object.keys(CHOICE_TYPE_TARGET) as ChoiceTypeKey[]) {
      this.pushDeviation(
        issues,
        `choice-type "${type}"`,
        choiceMix.percentages[type] ?? 0,
        CHOICE_TYPE_TARGET[type],
        `choiceMix:${type}`,
      );
    }

    const consequenceMix = weightedConsequenceMix(units);
    for (const tier of Object.keys(CONSEQUENCE_TARGET) as ConsequenceTier[]) {
      this.pushDeviation(
        issues,
        `consequence-tier "${tier}"`,
        consequenceMix.percentages[tier] ?? 0,
        CONSEQUENCE_TARGET[tier],
        `consequenceMix:${tier}`,
      );
    }

    // --- Hard invariants -----------------------------------------------------
    for (const unit of units) {
      const isEncounter = unit.kind === 'encounter';

      if (isEncounter && unit.choiceType === 'expression') {
        issues.push(this.error(
          `Encounter "${unit.id}" has choiceType 'expression'; encounters are stakes-driven and are never 'expression'.`,
          unit.id,
          "Re-allocate this encounter to 'relationship', 'strategic', or 'dilemma'.",
        ));
      }

      if (isEncounter && unit.consequenceTier === 'callback') {
        issues.push(this.error(
          `Encounter "${unit.id}" has consequenceTier 'callback'; an encounter earns at least a 'branchlet'.`,
          unit.id,
          "Raise this encounter's consequence to 'branchlet' or 'branch'.",
        ));
      }

      if (unit.choiceType === 'expression' && unit.consequenceTier && unit.consequenceTier !== 'callback') {
        issues.push(this.error(
          `Unit "${unit.id}" is an 'expression' choice but its consequenceTier is '${unit.consequenceTier}'; expression units must resolve to 'callback'.`,
          unit.id,
          "Set this expression unit's consequenceTier to 'callback', or change its choiceType.",
        ));
      }
    }

    return finalize(issues);
  }

  /**
   * Compare one measured percentage to its target and push a warning/error when
   * the absolute deviation exceeds the tolerance band.
   */
  private pushDeviation(
    issues: ValidationIssue[],
    label: string,
    actualPct: number,
    targetPct: number,
    location: string,
  ): void {
    const deviation = Math.abs(actualPct - targetPct);
    if (deviation <= BUDGET_TOLERANCE.warn) {
      return;
    }
    const detail = `${label} is ${actualPct.toFixed(1)}% (target ${targetPct}%, deviation ${deviation.toFixed(1)} pts).`;
    const suggestion = `Reconcile the ${label} mix toward its ${targetPct}% target.`;
    if (deviation > BUDGET_TOLERANCE.error) {
      issues.push(this.error(`Budget out of band: ${detail}`, location, suggestion));
    } else {
      issues.push(this.warning(`Budget drift: ${detail}`, location, suggestion));
    }
  }
}

function finalize(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const score = Math.max(0, 100 - errors * 10 - (issues.length - errors) * 2);
  return {
    valid: errors === 0,
    score,
    issues,
    suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
  };
}
