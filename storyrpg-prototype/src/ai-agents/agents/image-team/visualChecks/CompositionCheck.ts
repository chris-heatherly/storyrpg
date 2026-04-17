/**
 * CompositionCheck — VisualCheck wrapper around `CompositionValidatorAgent`.
 *
 * Template for Phase 7. Each existing image-team LLM validator follows the
 * same pattern:
 *   1. Accept the existing validator's request shape as the check input.
 *   2. Invoke `agent.execute(request)`.
 *   3. Translate the `AgentResponse<TReport>` into a `VisualCheckResult`.
 *
 * This keeps prompts and output shapes untouched; only the surface contract
 * changes. Callers move from direct `imageTeam.validateComposition(...)` to
 * `judge.run([new CompositionCheck(agent)], request)`.
 */

import {
  CompositionValidatorAgent,
  type CompositionRequest,
  type CompositionValidation,
} from '../CompositionValidatorAgent';
import type {
  VisualCheck,
  VisualCheckContext,
  VisualCheckResult,
  VisualCheckIssue,
} from '../VisualQualityJudge';

export const COMPOSITION_CHECK_ID = 'composition';

export class CompositionCheck
  implements VisualCheck<CompositionRequest, CompositionValidation>
{
  readonly id = COMPOSITION_CHECK_ID;
  readonly severity = 'warning' as const;
  readonly description = 'Validates image composition against shot type and intended framing';

  constructor(private readonly agent: CompositionValidatorAgent) {}

  async run(
    input: CompositionRequest,
    _ctx: VisualCheckContext
  ): Promise<VisualCheckResult<CompositionValidation>> {
    const response = await this.agent.execute(input);

    if (!response.success || !response.data) {
      return {
        checkId: this.id,
        severity: this.severity,
        passed: false,
        issues: [
          {
            checkId: this.id,
            severity: this.severity,
            message: response.error ?? 'Composition validator returned no data',
            code: 'validator_failed',
          },
        ],
        error: response.error ? new Error(response.error) : undefined,
      };
    }

    const report = response.data;
    const issues: VisualCheckIssue[] = (report.ruleViolations ?? []).map((rule) => ({
      checkId: this.id,
      severity: this.severity,
      message: rule,
      code: 'composition_rule_violation',
    }));

    if (report.poseAnalysis?.poseIssues?.length) {
      for (const pose of report.poseAnalysis.poseIssues) {
        issues.push({
          checkId: this.id,
          severity: this.severity,
          message: pose,
          code: 'pose_issue',
        });
      }
    }

    return {
      checkId: this.id,
      severity: this.severity,
      passed: report.isValid,
      score: report.score,
      issues,
      output: report,
    };
  }
}
