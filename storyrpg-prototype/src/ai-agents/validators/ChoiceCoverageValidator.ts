/**
 * Choice Coverage Validator (D4 — planner coverage).
 *
 * The planner (StoryArchitect blueprint + choiceTypePlanner) decides which scenes
 * SHOULD carry a choice point. Content generation then authors choices into beats.
 * Nothing checked that the authored output actually covers the planned set — a
 * scene planned as a decision point could ship with zero choices and slip through.
 *
 * This validator cross-checks: every scene the blueprint planned with a choicePoint
 * must have an authored choice in the final story; and (informational) a scene that
 * authored a choice with no plan is surfaced so the mismatch is visible.
 *
 * Advisory — surfaces gaps, never blocks. Pure + unit-testable: the caller derives
 * the two id sets (planned vs authored) so this stays free of pipeline types.
 */

import {
  BaseValidator,
  ValidationIssue,
  ValidationResult,
  buildSuccessResult,
  buildFailureResult,
} from './BaseValidator';

export interface ChoiceCoverageInput {
  /** Scene ids the blueprint planned with a (non-encounter) choice point. */
  plannedChoiceSceneIds: string[];
  /** Scene ids that actually authored at least one choice in the final story. */
  authoredChoiceSceneIds: string[];
  /**
   * When true (authored_lite + ESC), missing planned choices are errors that
   * block rather than advisory warnings.
   */
  blocking?: boolean;
}

export interface ChoiceCoverageMetrics {
  planned: number;
  authored: number;
  covered: number;
  missing: string[];
  unplanned: string[];
  coverageRatio: number;
}

export class ChoiceCoverageValidator extends BaseValidator {
  constructor() {
    super('ChoiceCoverageValidator');
  }

  validate(input: ChoiceCoverageInput): ValidationResult & { metrics: ChoiceCoverageMetrics } {
    const issues: ValidationIssue[] = [];
    const planned = new Set((input.plannedChoiceSceneIds ?? []).filter(Boolean));
    const authored = new Set((input.authoredChoiceSceneIds ?? []).filter(Boolean));

    const missing = [...planned].filter((id) => !authored.has(id));
    const unplanned = [...authored].filter((id) => !planned.has(id));
    const covered = planned.size - missing.length;

    for (const id of missing) {
      issues.push(
        input.blocking
          ? this.error(
              `Scene "${id}" was planned as a choice point but authored no choice.`,
              `scene:${id}`,
              'Re-author the scene with its planned choice, or remove the choicePoint from the blueprint.',
            )
          : this.warning(
              `Scene "${id}" was planned as a choice point but authored no choice.`,
              `scene:${id}`,
              'Re-author the scene with its planned choice, or remove the choicePoint from the blueprint.',
            ),
      );
    }
    for (const id of unplanned) {
      issues.push(
        this.info(
          `Scene "${id}" authored a choice with no planned choice point (unplanned coverage).`,
          `scene:${id}`,
        ),
      );
    }

    const coverageRatio = planned.size === 0 ? 1 : covered / planned.size;
    const metrics: ChoiceCoverageMetrics = {
      planned: planned.size,
      authored: authored.size,
      covered,
      missing,
      unplanned,
      coverageRatio,
    };

    if (missing.length > 0) {
      const score = Math.max(30, Math.round(coverageRatio * 100));
      return { ...buildFailureResult(issues, score), metrics };
    }
    // Success, but keep any info issues (unplanned coverage) instead of dropping them.
    return { ...buildSuccessResult(100), issues, metrics };
  }
}
