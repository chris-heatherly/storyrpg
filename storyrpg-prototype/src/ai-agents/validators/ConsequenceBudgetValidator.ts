/**
 * Consequence Budget Validator
 *
 * Classifies and validates consequence distribution against budget:
 * - Callback Lines: ~60% (cheap, high-impact NPC memory)
 * - Scene Tints: ~25% (medium cost, flavor variations)
 * - Branchlets: ~10% (expensive, unique scenes)
 * - Structural Branches: ~5% (very expensive, different paths)
 *
 * This is a hybrid validator that uses heuristics for classification
 * and optionally LLM for complex cases.
 */

import { Consequence, ConsequenceBudgetCategory } from '../../types';
import {
  ValidationIssue,
  ConsequenceBudgetAllocation,
  ConsequenceBudgetValidationResult,
  ConsequenceBudgetInput,
  ValidationConfig,
} from '../../types/validation';

// Target budget allocation (percentages)
const TARGET_BUDGET: ConsequenceBudgetAllocation = {
  callback: 60,
  tint: 25,
  branchlet: 10,
  branch: 5,
};

export class ConsequenceBudgetValidator {
  private config: ValidationConfig['rules']['consequenceBudget'];

  constructor(config?: Partial<ValidationConfig['rules']['consequenceBudget']>) {
    this.config = {
      enabled: true,
      level: 'warning',
      budgetTolerance: 15, // +/- 15% tolerance
      ...config,
    };
  }

  /**
   * Classify a consequence into a budget category based on type and impact
   */
  classifyConsequence(consequence: { type: string; [key: string]: unknown }): ConsequenceBudgetCategory {
    const type = consequence.type;

    // Callback Lines: Small state changes, relationship tweaks, flags
    if (
      type === 'setFlag' ||
      type === 'addTag' ||
      type === 'removeTag' ||
      (type === 'relationship' && Math.abs(Number(consequence.change) || 0) <= 10) ||
      (type === 'changeScore' && Math.abs(Number(consequence.change) || 0) <= 5)
    ) {
      return 'callback';
    }

    // Scene Tints: Medium state changes that affect flavor
    if (
      (type === 'changeScore' && Math.abs(Number(consequence.change) || 0) <= 15) ||
      (type === 'relationship' && Math.abs(Number(consequence.change) || 0) <= 25) ||
      type === 'attribute'
    ) {
      return 'tint';
    }

    // Branchlets: Significant changes that might lead to unique content
    if (
      (type === 'changeScore' && Math.abs(Number(consequence.change) || 0) <= 30) ||
      (type === 'relationship' && Math.abs(Number(consequence.change) || 0) <= 50) ||
      type === 'addItem' ||
      type === 'removeItem' ||
      type === 'setScore'
    ) {
      return 'branchlet';
    }

    // Structural Branches: Major changes that fundamentally alter the story
    if (
      (type === 'changeScore' && Math.abs(Number(consequence.change) || 0) > 30) ||
      (type === 'relationship' && Math.abs(Number(consequence.change) || 0) > 50) ||
      type === 'skill'
    ) {
      return 'branch';
    }

    // Default to callback for unknown types
    return 'callback';
  }

  /**
   * Classify consequence based on choice type context
   */
  classifyByChoiceType(
    consequence: { type: string; [key: string]: unknown },
    choiceType: string,
    hasBranching?: boolean
  ): ConsequenceBudgetCategory {
    // Expression choices should only produce callbacks
    if (choiceType === 'expression') {
      return 'callback';
    }

    // Dilemmas should have significant consequences
    if (choiceType === 'dilemma') {
      const baseCategory = this.classifyConsequence(consequence);
      // Upgrade to at least branchlet for dilemmas
      if (baseCategory === 'callback' || baseCategory === 'tint') {
        return 'branchlet';
      }
      return baseCategory;
    }

    // Choices that branch (any type with nextSceneId) produce tints or higher
    if (hasBranching) {
      const baseCategory = this.classifyConsequence(consequence);
      // Upgrade callback to tint for branching choices
      if (baseCategory === 'callback') {
        return 'tint';
      }
      return baseCategory;
    }

    // Default classification
    return this.classifyConsequence(consequence);
  }

  /**
   * Calculate the current budget allocation from choices
   */
  calculateAllocation(input: ConsequenceBudgetInput): {
    allocation: ConsequenceBudgetAllocation;
    byCategory: { [K in ConsequenceBudgetCategory]: number };
    total: number;
  } {
    const counts: { [K in ConsequenceBudgetCategory]: number } = {
      callback: 0,
      tint: 0,
      branchlet: 0,
      branch: 0,
    };

    for (const choice of input.choices) {
      for (const consequence of choice.consequences || []) {
        // Use provided category or classify
        const category = (consequence.budgetCategory as ConsequenceBudgetCategory) ||
          this.classifyByChoiceType(consequence, choice.choiceType);
        counts[category]++;
      }
    }

    const total = Object.values(counts).reduce((sum, c) => sum + c, 0);

    // Calculate percentages
    const allocation: ConsequenceBudgetAllocation = {
      callback: total > 0 ? (counts.callback / total) * 100 : 0,
      tint: total > 0 ? (counts.tint / total) * 100 : 0,
      branchlet: total > 0 ? (counts.branchlet / total) * 100 : 0,
      branch: total > 0 ? (counts.branch / total) * 100 : 0,
    };

    return {
      allocation,
      byCategory: counts,
      total,
    };
  }

  /**
   * Validate consequence budget allocation
   */
  async validate(input: ConsequenceBudgetInput): Promise<ConsequenceBudgetValidationResult> {
    const issues: ValidationIssue[] = [];
    const { allocation, byCategory, total } = this.calculateAllocation(input);

    // Skip validation if no consequences
    if (total === 0) {
      return {
        passed: true,
        allocation,
        issues: [],
        consequencesByCategory: byCategory,
      };
    }

    const tolerance = this.config.budgetTolerance;

    // Check each category against target
    const categories: ConsequenceBudgetCategory[] = ['callback', 'tint', 'branchlet', 'branch'];

    for (const category of categories) {
      const actual = allocation[category];
      const target = TARGET_BUDGET[category];
      const deviation = actual - target;

      if (Math.abs(deviation) > tolerance) {
        const direction = deviation > 0 ? 'over' : 'under';
        const level = Math.abs(deviation) > tolerance * 2 ? 'warning' : 'suggestion';

        issues.push({
          category: 'consequence_budget',
          level,
          message: `${category.toUpperCase()} consequences are ${direction}-allocated: ${Math.round(actual)}% (target: ${target}% ± ${tolerance}%)`,
          location: {},
          suggestion: this.getSuggestion(category, direction),
        });
      }
    }

    // Check for missing category types
    for (const category of categories) {
      if (byCategory[category] === 0 && TARGET_BUDGET[category] >= 10) {
        issues.push({
          category: 'consequence_budget',
          level: 'suggestion',
          message: `No ${category} consequences found`,
          location: {},
          suggestion: `Consider adding ${category} consequences for variety`,
        });
      }
    }

    // Determine if validation passed
    const hasBlockingIssues = issues.some(i => i.level === 'error');
    const hasWarnings = issues.some(i => i.level === 'warning');

    return {
      passed: !hasBlockingIssues && (this.config.level !== 'warning' || !hasWarnings),
      allocation,
      issues,
      consequencesByCategory: byCategory,
    };
  }

  /**
   * Get suggestion for budget deviation
   */
  private getSuggestion(category: ConsequenceBudgetCategory, direction: 'over' | 'under'): string {
    const suggestions: Record<ConsequenceBudgetCategory, { over: string; under: string }> = {
      callback: {
        over: 'Convert some callbacks to scene tints for more visible impact',
        under: 'Add more callback lines where NPCs remember small details',
      },
      tint: {
        over: 'Some tints could be simplified to callbacks',
        under: 'Add conditional text variants based on player choices',
      },
      branchlet: {
        over: 'Consider if some branchlets could be tints instead',
        under: 'Add unique scene variations for major choices',
      },
      branch: {
        over: 'Reserve structural branches for climactic moments only',
        under: 'Consider adding a major story branch for key decisions',
      },
    };

    return suggestions[category][direction];
  }

  /**
   * Suggest budget category for a new consequence
   */
  suggestCategory(
    choiceType: string,
    consequenceType: string,
    currentAllocation: ConsequenceBudgetAllocation
  ): ConsequenceBudgetCategory {
    // Find the most underallocated category
    const categories: ConsequenceBudgetCategory[] = ['callback', 'tint', 'branchlet', 'branch'];
    let bestCategory: ConsequenceBudgetCategory = 'callback';
    let bestDeficit = -Infinity;

    for (const category of categories) {
      const deficit = TARGET_BUDGET[category] - currentAllocation[category];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestCategory = category;
      }
    }

    // But also respect choice type constraints
    if (choiceType === 'expression') {
      return 'callback';
    }

    if (choiceType === 'dilemma' && (bestCategory === 'callback' || bestCategory === 'tint')) {
      return 'branchlet';
    }

    return bestCategory;
  }
}
