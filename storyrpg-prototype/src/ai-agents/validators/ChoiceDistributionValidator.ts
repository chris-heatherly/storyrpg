/**
 * Choice Distribution Validator
 *
 * Validates two independent concerns:
 * 1. Choice TYPE distribution (expression, relationship, strategic, dilemma)
 *    matches configured percentage targets.
 * 2. Branching FREQUENCY (choices with nextSceneId) stays within the per-episode cap.
 *
 * Branching is a property of any non-expression choice, not a type.
 */

import { ChoiceType } from '../../types';
import {
  BaseValidator,
  ValidationIssue,
  ValidationResult,
  buildSuccessResult,
  buildFailureResult,
} from './BaseValidator';
import { SKILL_DEFINITIONS } from '../../constants/pipeline';

export interface ChoiceDistributionTargets {
  expression: number;   // Target percentage (0-100)
  relationship: number;
  strategic: number;
  dilemma: number;
}

export interface ChoiceDistributionInput {
  choiceSets: Array<{
    beatId: string;
    choiceType: ChoiceType | string;
    sceneId?: string;
    // Whether any choice in this set routes to a different scene
    hasBranching?: boolean;
  }>;
  targets: ChoiceDistributionTargets;
  maxBranchingChoicesPerEpisode: number;
}

export interface ChoiceDistributionMetrics {
  totalChoiceSets: number;
  counts: Record<string, number>;
  actualPercentages: Record<string, number>;
  targetPercentages: ChoiceDistributionTargets;
  deviations: Record<string, number>;
  branchingCount: number;
  branchingCap: number;
}

// How far off (in percentage points) a type can be before triggering an issue
const DEFAULT_WARNING_TOLERANCE = 15;
const DEFAULT_ERROR_TOLERANCE = 25;

// Minimum choice sets before distribution validation is meaningful
const MIN_CHOICE_SETS_FOR_VALIDATION = 4;

export class ChoiceDistributionValidator extends BaseValidator {
  private warningTolerance: number;
  private errorTolerance: number;

  constructor(
    warningTolerance: number = DEFAULT_WARNING_TOLERANCE,
    errorTolerance: number = DEFAULT_ERROR_TOLERANCE
  ) {
    super('ChoiceDistributionValidator');
    this.warningTolerance = warningTolerance;
    this.errorTolerance = errorTolerance;
  }

  /**
   * Validate choice type distribution and branching frequency.
   */
  validate(input: ChoiceDistributionInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const { choiceSets, targets, maxBranchingChoicesPerEpisode } = input;
    const totalChoiceSets = choiceSets.length;

    // === 1. Branching frequency check (always runs, even with few choice sets) ===
    const branchingCount = choiceSets.filter(cs => cs.hasBranching).length;

    if (branchingCount > maxBranchingChoicesPerEpisode) {
      issues.push(
        this.error(
          `${branchingCount} branching choice sets exceed the cap of ${maxBranchingChoicesPerEpisode} per episode. ` +
          `Too many scene-routing choices creates excessive path divergence.`,
          undefined,
          `Remove nextSceneId from some choices, or increase the branching cap.`
        )
      );
    }

    // Expression choices must never branch
    const expressionBranching = choiceSets.filter(
      cs => cs.choiceType === 'expression' && cs.hasBranching
    );
    for (const cs of expressionBranching) {
      issues.push(
        this.error(
          `Expression choice set "${cs.beatId}" has branching (nextSceneId). ` +
          `Expression choices are cosmetic and must not route to different scenes.`,
          cs.sceneId ? `scene:${cs.sceneId}` : undefined,
          `Remove nextSceneId or change the choice type to relationship/strategic/dilemma.`
        )
      );
    }

    // === 2. Type distribution check (needs enough data) ===
    if (totalChoiceSets < MIN_CHOICE_SETS_FOR_VALIDATION) {
      // Still return branching issues if any
      if (issues.length > 0) {
        const hasErrors = issues.some(i => i.severity === 'error');
        return hasErrors
          ? buildFailureResult(issues, 50)
          : buildSuccessResult(80, issues.map(i => i.message));
      }
      return buildSuccessResult(100, [
        `Only ${totalChoiceSets} choice sets — type distribution validation deferred (need ${MIN_CHOICE_SETS_FOR_VALIDATION}+).`,
      ]);
    }

    // Count by type
    const canonicalTypes: ChoiceType[] = ['expression', 'relationship', 'strategic', 'dilemma'];
    const counts: Record<string, number> = {};
    for (const t of canonicalTypes) {
      counts[t] = 0;
    }

    for (const cs of choiceSets) {
      const type = cs.choiceType as string;
      if (canonicalTypes.includes(type as ChoiceType)) {
        counts[type]++;
      } else {
        issues.push(
          this.warning(
            `Choice set "${cs.beatId}" has unrecognized type "${type}". ` +
            `Expected one of: ${canonicalTypes.join(', ')}.`,
            cs.sceneId ? `scene:${cs.sceneId}` : undefined,
            `Update to a canonical type name.`
          )
        );
      }
    }

    // Calculate actual percentages and deviations
    const actualPercentages: Record<string, number> = {};
    const deviations: Record<string, number> = {};
    for (const t of canonicalTypes) {
      actualPercentages[t] = (counts[t] / totalChoiceSets) * 100;
      deviations[t] = actualPercentages[t] - targets[t as keyof ChoiceDistributionTargets];
    }

    // Check each type against its target
    for (const t of canonicalTypes) {
      const actual = actualPercentages[t];
      const target = targets[t as keyof ChoiceDistributionTargets];
      const deviation = Math.abs(deviations[t]);

      if (deviation > this.errorTolerance) {
        issues.push(
          this.error(
            `Choice type "${t}" is ${actual.toFixed(0)}% (target: ${target}%, deviation: ${deviations[t] > 0 ? '+' : ''}${deviations[t].toFixed(0)}pp).`,
            undefined,
            this.getSuggestion(t, deviations[t])
          )
        );
      } else if (deviation > this.warningTolerance) {
        issues.push(
          this.warning(
            `Choice type "${t}" is ${actual.toFixed(0)}% (target: ${target}%, deviation: ${deviations[t] > 0 ? '+' : ''}${deviations[t].toFixed(0)}pp).`,
            undefined,
            this.getSuggestion(t, deviations[t])
          )
        );
      }
    }

    // Calculate score
    const totalDeviation = canonicalTypes.reduce((sum, t) => sum + Math.abs(deviations[t]), 0);
    const branchingPenalty = branchingCount > maxBranchingChoicesPerEpisode
      ? (branchingCount - maxBranchingChoicesPerEpisode) * 15
      : 0;
    const score = Math.max(0, Math.round(100 - (totalDeviation / 2) - branchingPenalty));

    const hasErrors = issues.some(i => i.severity === 'error');
    if (hasErrors) {
      return buildFailureResult(issues, score, [
        'Regenerate some choice sets with explicit type guidance.',
        'Check that branching choices stay within the per-episode cap.',
      ]);
    }

    return {
      valid: true,
      score,
      issues,
      suggestions: issues.length > 0
        ? ['Choice distribution is acceptable but could be improved.']
        : ['Choice distribution matches targets well.'],
    };
  }

  /**
   * Compute distribution metrics without validation (for reporting).
   */
  computeMetrics(input: ChoiceDistributionInput): ChoiceDistributionMetrics {
    const canonicalTypes: ChoiceType[] = ['expression', 'relationship', 'strategic', 'dilemma'];
    const counts: Record<string, number> = {};
    for (const t of canonicalTypes) {
      counts[t] = 0;
    }
    for (const cs of input.choiceSets) {
      const type = cs.choiceType as string;
      if (type in counts) counts[type]++;
    }

    const total = input.choiceSets.length;
    const actualPercentages: Record<string, number> = {};
    const deviations: Record<string, number> = {};
    for (const t of canonicalTypes) {
      actualPercentages[t] = total > 0 ? (counts[t] / total) * 100 : 0;
      deviations[t] = actualPercentages[t] - input.targets[t as keyof ChoiceDistributionTargets];
    }

    return {
      totalChoiceSets: total,
      counts,
      actualPercentages,
      targetPercentages: input.targets,
      deviations,
      branchingCount: input.choiceSets.filter(cs => cs.hasBranching).length,
      branchingCap: input.maxBranchingChoicesPerEpisode,
    };
  }

  private getSuggestion(type: string, deviation: number): string {
    switch (type) {
      case 'expression':
        return deviation > 0
          ? 'Convert some expression choices to relationship or strategic types.'
          : 'Add low-stakes personality/voice choices to balance the distribution.';
      case 'relationship':
        return deviation > 0
          ? 'Some relationship choices might work better as expression or strategic.'
          : 'Add NPC interaction choices that shift trust/affection/respect.';
      case 'strategic':
        return deviation > 0
          ? 'Some strategic choices could be recategorized as expression if they lack stat impact.'
          : 'Add skill-check or investigation choices to provide more strategic agency.';
      case 'dilemma':
        return deviation > 0
          ? 'Dilemmas are high-impact — use sparingly so each feels weighty.'
          : 'Add a value-testing choice with no clearly right answer.';
      default:
        return `Adjust the number of "${type}" choices.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Attribute Coverage Scoring
// ---------------------------------------------------------------------------

export function validateAttributeCoverage(
  statChecks: Array<{ skillWeights?: Record<string, number>; skill?: string; attribute?: string }>
): { coverage: Record<string, number>; warnings: string[] } {
  const attrExercise: Record<string, number> = {
    charm: 0, wit: 0, courage: 0, empathy: 0, resolve: 0, resourcefulness: 0,
  };
  let totalWeight = 0;

  for (const check of statChecks) {
    const weights: Record<string, number> = {};

    if (check.skillWeights) {
      Object.assign(weights, check.skillWeights);
    } else if (check.skill) {
      weights[check.skill] = 1.0;
    }

    for (const [skill, skillWeight] of Object.entries(weights)) {
      const def = SKILL_DEFINITIONS[skill.toLowerCase()];
      if (!def) continue;
      for (const [attr, attrWeight] of Object.entries(def.attributeWeights)) {
        attrExercise[attr] = (attrExercise[attr] ?? 0) + skillWeight * (attrWeight ?? 0);
      }
      totalWeight += skillWeight;
    }
  }

  const warnings: string[] = [];
  if (totalWeight > 0) {
    const normalized: Record<string, number> = {};
    for (const [attr, val] of Object.entries(attrExercise)) {
      normalized[attr] = val / totalWeight;
    }

    const coveredCount = Object.values(normalized).filter(v => v >= 0.10).length;
    if (coveredCount < 4) {
      const uncovered = Object.entries(normalized)
        .filter(([, v]) => v < 0.10)
        .map(([attr]) => attr);
      warnings.push(
        `Only ${coveredCount}/6 attributes get >= 10% exercise. Under-covered: ${uncovered.join(', ')}. ` +
        `Consider adding challenges that test skills using ${uncovered.slice(0, 2).join(' or ')}.`
      );
    }
    return { coverage: normalized, warnings };
  }

  return { coverage: attrExercise, warnings };
}

// ---------------------------------------------------------------------------
// Growth-Difficulty Sequence Validation
// ---------------------------------------------------------------------------

interface SceneLike {
  id: string;
  name?: string;
  choicePoint?: {
    consequenceDomain?: string;
    type?: string;
  };
  competenceArc?: {
    testsNow?: string;
    shortfall?: string;
    growthPath?: string;
  };
  encounterDifficulty?: number;
  leadsTo?: string[];
}

export function validateGrowthDifficultySequence(
  scenes: SceneLike[],
  choices?: Array<{ sceneId: string; statCheck?: { difficulty: number; skillWeights?: Record<string, number> } }>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const sceneMap = new Map(scenes.map(s => [s.id, s]));

  function findPredecessors(targetId: string): Set<string> {
    const preds = new Set<string>();
    for (const scene of scenes) {
      if (scene.leadsTo?.includes(targetId)) {
        preds.add(scene.id);
        for (const pred of findPredecessors(scene.id)) {
          preds.add(pred);
        }
      }
    }
    return preds;
  }

  function isGrowthScene(s: SceneLike): boolean {
    return (s.choicePoint?.consequenceDomain === 'resource') ||
           (!!s.competenceArc?.growthPath);
  }

  for (const scene of scenes) {
    const isHard = (scene.encounterDifficulty != null && scene.encounterDifficulty > 50);
    if (!isHard) continue;

    const predecessors = findPredecessors(scene.id);
    const hasPrecedingGrowth = [...predecessors].some(predId => {
      const pred = sceneMap.get(predId);
      return pred ? isGrowthScene(pred) : false;
    });

    const hasFailureGrowthBranch = scenes.some(s =>
      predecessors.has(s.id) && isGrowthScene(s) && s.leadsTo?.some(lt => {
        const target = sceneMap.get(lt);
        return target && target.id !== scene.id;
      })
    );

    if (!hasPrecedingGrowth && !hasFailureGrowthBranch) {
      issues.push({
        severity: 'warning',
        message: `Scene "${scene.name ?? scene.id}" has a hard check (difficulty > 50) with no preceding growth opportunity and no failure-recovery branch.`,
        location: `scene:${scene.id}`,
        suggestion: 'Add a development scene before this encounter or create a failure-recovery branch that routes through growth.',
      });
    }
  }

  if (choices) {
    for (const choice of choices) {
      if (!choice.statCheck || choice.statCheck.difficulty <= 50) continue;
      const scene = sceneMap.get(choice.sceneId);
      if (!scene) continue;

      const predecessors = findPredecessors(choice.sceneId);
      const hasPrecedingGrowth = [...predecessors].some(predId => {
        const pred = sceneMap.get(predId);
        return pred ? isGrowthScene(pred) : false;
      });

      if (!hasPrecedingGrowth) {
        issues.push({
          severity: 'warning',
          message: `Choice in scene "${scene.name ?? scene.id}" has difficulty ${choice.statCheck.difficulty} with no preceding growth opportunity.`,
          location: `scene:${choice.sceneId}`,
          suggestion: 'Place a development scene earlier in the path, or lower the difficulty.',
        });
      }
    }
  }

  return issues;
}
