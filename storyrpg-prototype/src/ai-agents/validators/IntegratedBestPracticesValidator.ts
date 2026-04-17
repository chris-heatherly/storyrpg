/**
 * Integrated Best Practices Validator
 *
 * Orchestrates all validators to provide:
 * - Quick validation (generation-time, blocking errors only)
 * - Full validation (QA-time, comprehensive report)
 *
 * Coordinates:
 * - ChoiceDensityValidator
 * - NPCDepthValidator
 * - ConsequenceBudgetValidator
 * - StakesTriangleValidator
 * - FiveFactorValidator
 */

import { AgentConfig } from '../config';
import { ChoiceDensityValidator } from './ChoiceDensityValidator';
import { NPCDepthValidator } from './NPCDepthValidator';
import { ConsequenceBudgetValidator } from './ConsequenceBudgetValidator';
import { StakesTriangleValidator } from './StakesTriangleValidator';
import { FiveFactorValidator } from './FiveFactorValidator';
import { CallbackOpportunitiesValidator } from './CallbackOpportunitiesValidator';
import { NPCTier, RelationshipDimension, Consequence, ReminderPlan } from '../../types';
import { StakesAnnotation } from '../agents/ChoiceAuthor';
import {
  ValidationIssue,
  ComprehensiveValidationReport,
  QuickValidationResult,
  ValidationMetrics,
  ValidationConfig,
  ChoiceDensityInput,
  NPCDepthInput,
  ConsequenceBudgetInput,
  StakesTriangleInput,
  FiveFactorInput,
} from '../../types/validation';
import { CHOICE_DENSITY_DEFAULTS } from '../../constants/validation';

// Default validation configuration
const DEFAULT_CONFIG: ValidationConfig = {
  enabled: true,
  mode: 'advisory',
  rules: {
    stakesTriangle: {
      enabled: true,
      level: 'error',
      threshold: 60,
    },
    fiveFactor: {
      enabled: true,
      level: 'error',
    },
    choiceDensity: {
      enabled: true,
      level: 'warning',
      firstChoiceMaxSeconds: CHOICE_DENSITY_DEFAULTS.firstChoiceMaxSeconds,
      averageGapMaxSeconds: CHOICE_DENSITY_DEFAULTS.averageGapMaxSeconds,
    },
    consequenceBudget: {
      enabled: true,
      level: 'warning',
      budgetTolerance: 15,
    },
    npcDepth: {
      enabled: true,
      level: 'error',
    },
  },
};

export interface ValidationInput {
  // Scene content for choice density and callbacks
  scenes: Array<{
    id: string;
    beats: Array<{
      id: string;
      text: string;
      isChoicePoint?: boolean;
      textVariants?: Array<{
        condition: unknown;
        text: string;
      }>;
      speaker?: string;
    }>;
  }>;

  // NPC data for depth validation
  npcs: Array<{
    id: string;
    name: string;
    tier: NPCTier;
    relationshipDimensions: RelationshipDimension[];
  }>;

  // Choice data for stakes, five-factor, and budget validation
  choices: Array<{
    id: string;
    text: string;
    choiceType: string;
    sceneId?: string;
    consequences: Consequence[];
    stakesAnnotation?: StakesAnnotation;
    sceneContext?: string;
    nextSceneId?: string; // Present if this choice routes to a different scene
    reminderPlan?: ReminderPlan;
  }>;

  // Known flags/scores for callback validation
  knownFlags?: string[];
  knownScores?: string[];
}

export class IntegratedBestPracticesValidator {
  private config: ValidationConfig;
  private choiceDensityValidator: ChoiceDensityValidator;
  private npcDepthValidator: NPCDepthValidator;
  private consequenceBudgetValidator: ConsequenceBudgetValidator;
  private stakesTriangleValidator: StakesTriangleValidator;
  private fiveFactorValidator: FiveFactorValidator;
  private callbackValidator: CallbackOpportunitiesValidator;

  constructor(agentConfig: AgentConfig, config?: Partial<ValidationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize all validators
    this.choiceDensityValidator = new ChoiceDensityValidator(
      this.config.rules.choiceDensity
    );
    this.npcDepthValidator = new NPCDepthValidator(
      this.config.rules.npcDepth
    );
    this.consequenceBudgetValidator = new ConsequenceBudgetValidator(
      this.config.rules.consequenceBudget
    );
    this.stakesTriangleValidator = new StakesTriangleValidator(
      agentConfig,
      this.config.rules.stakesTriangle
    );
    this.fiveFactorValidator = new FiveFactorValidator(
      agentConfig,
      this.config.rules.fiveFactor
    );
    this.callbackValidator = new CallbackOpportunitiesValidator();
  }

  /**
   * Quick validation for generation-time (blocking errors only)
   * Runs fast checks without LLM calls where possible
   */
  async runQuickValidation(input: ValidationInput): Promise<QuickValidationResult> {
    if (!this.config.enabled || this.config.mode === 'disabled') {
      return { canProceed: true, blockingIssues: [], warningCount: 0 };
    }

    const blockingIssues: ValidationIssue[] = [];
    let warningCount = 0;

    // 1. NPC Depth (structural, fast)
    if (this.config.rules.npcDepth.enabled) {
      const npcResult = await this.npcDepthValidator.validate({
        npcs: input.npcs,
      });

      for (const issue of npcResult.issues) {
        if (issue.level === 'error') {
          blockingIssues.push(issue);
        } else if (issue.level === 'warning') {
          warningCount++;
        }
      }
    }

    // 2. Stakes Triangle (check for missing components only, skip LLM scoring)
    // Required for dilemma choices and any choice that branches (has nextSceneId)
    if (this.config.rules.stakesTriangle.enabled) {
      for (const choice of input.choices) {
        const isHighStakes = choice.choiceType === 'dilemma' || choice.nextSceneId;
        if (isHighStakes) {
          const stakes = choice.stakesAnnotation;
          if (!stakes?.want || !stakes?.cost || !stakes?.identity) {
            const missing: string[] = [];
            if (!stakes?.want) missing.push('WANT');
            if (!stakes?.cost) missing.push('COST');
            if (!stakes?.identity) missing.push('IDENTITY');
            const label = choice.choiceType === 'dilemma' ? 'DILEMMA' : `BRANCHING ${choice.choiceType.toUpperCase()}`;

            blockingIssues.push({
              category: 'stakes_triangle',
              level: 'error',
              message: `${label} choice "${choice.id}" missing stakes: ${missing.join(', ')}`,
              location: { choiceId: choice.id },
              suggestion: `Add ${missing.join(' and ')} to complete the Stakes Triangle`,
            });
          }
        }
      }
    }

    // 3. Five-Factor (heuristic check only, no LLM)
    // Required for dilemma choices and any choice that branches
    if (this.config.rules.fiveFactor.enabled) {
      for (const choice of input.choices) {
        const isHighStakes = choice.choiceType === 'dilemma' || choice.nextSceneId;
        if (isHighStakes) {
          const impact = this.fiveFactorValidator.analyzeConsequencesHeuristic(
            choice.consequences
          );
          const factorCount = this.fiveFactorValidator.countFactors(impact);
          const label = choice.choiceType === 'dilemma' ? 'DILEMMA' : `BRANCHING ${choice.choiceType.toUpperCase()}`;

          if (factorCount === 0 && choice.consequences.length === 0) {
            blockingIssues.push({
              category: 'five_factor',
              level: 'error',
              message: `${label} choice "${choice.id}" has no consequences and affects 0 factors`,
              location: { choiceId: choice.id },
              suggestion: 'Add consequences that change OUTCOME, PROCESS, INFORMATION, RELATIONSHIP, or IDENTITY',
            });
          }
        }
      }
    }

    // 4. Choice Density - critical check for having ANY choices
    if (this.config.rules.choiceDensity.enabled && input.scenes.length > 0) {
      const densityResult = await this.choiceDensityValidator.validate({
        beats: input.scenes.flatMap(s => s.beats),
        scenes: input.scenes,
      });

      for (const issue of densityResult.issues) {
        if (issue.level === 'error') {
          blockingIssues.push(issue);
        } else if (issue.level === 'warning') {
          warningCount++;
        }
      }
    }

    // In advisory mode, we still block on errors but allow warnings
    // In strict mode, we block on both errors and warnings
    // Errors should ALWAYS block - they indicate broken output
    const canProceed = blockingIssues.length === 0;

    return {
      canProceed,
      blockingIssues,
      warningCount,
    };
  }

  /**
   * Full validation for QA-time (comprehensive report)
   * Runs all validators including LLM-based analysis
   */
  async runFullValidation(input: ValidationInput): Promise<ComprehensiveValidationReport> {
    const startTime = Date.now();
    const allIssues: ValidationIssue[] = [];

    // Initialize metrics
    const metrics: ValidationMetrics = {
      stakesTriangle: {
        averageScore: 0,
        choicesEvaluated: 0,
        choicesPassed: 0,
      },
      fiveFactor: {
        averageFactorCount: 0,
        choicesEvaluated: 0,
        choicesPassed: 0,
      },
      choiceDensity: {
        averageGapSeconds: 0,
        firstChoiceSeconds: 0,
        totalChoices: 0,
      },
      consequenceBudget: {
        allocation: { callback: 0, tint: 0, branchlet: 0, branch: 0 },
        totalConsequences: 0,
      },
      npcDepth: {
        coreNPCsValid: 0,
        coreNPCsTotal: 0,
        supportingNPCsValid: 0,
        supportingNPCsTotal: 0,
      },
    };

    // 1. Choice Density Validation
    if (this.config.rules.choiceDensity.enabled && input.scenes.length > 0) {
      const densityInput: ChoiceDensityInput = {
        beats: input.scenes.flatMap(s => s.beats),
        scenes: input.scenes,
      };

      const densityResult = await this.choiceDensityValidator.validate(densityInput);
      allIssues.push(...densityResult.issues);

      metrics.choiceDensity = {
        averageGapSeconds: densityResult.metrics.averageGapSeconds,
        firstChoiceSeconds: densityResult.metrics.firstChoiceSeconds,
        totalChoices: densityResult.metrics.choiceCount,
      };
    }

    // 2. NPC Depth Validation
    if (this.config.rules.npcDepth.enabled && input.npcs.length > 0) {
      const npcInput: NPCDepthInput = { npcs: input.npcs };
      const npcResult = await this.npcDepthValidator.validate(npcInput);
      allIssues.push(...npcResult.issues);

      const summary = this.npcDepthValidator.getSummary(npcResult);
      metrics.npcDepth = {
        coreNPCsValid: summary.coreNPCsValid,
        coreNPCsTotal: summary.coreNPCsTotal,
        supportingNPCsValid: summary.supportingNPCsValid,
        supportingNPCsTotal: summary.supportingNPCsTotal,
      };
    }

    // 3. Consequence Budget Validation
    if (this.config.rules.consequenceBudget.enabled && input.choices.length > 0) {
      const budgetInput: ConsequenceBudgetInput = {
        choices: input.choices.map(c => ({
          id: c.id,
          choiceType: c.choiceType,
          consequences: c.consequences,
        })),
      };

      const budgetResult = await this.consequenceBudgetValidator.validate(budgetInput);
      allIssues.push(...budgetResult.issues);

      const totalConsequences = Object.values(budgetResult.consequencesByCategory)
        .reduce((sum, count) => sum + count, 0);

      metrics.consequenceBudget = {
        allocation: budgetResult.allocation,
        totalConsequences,
      };
    }

    // 4. Stakes Triangle Validation (with LLM)
    if (this.config.rules.stakesTriangle.enabled) {
      const nonExpressionChoices = input.choices.filter(c => c.choiceType !== 'expression');

      if (nonExpressionChoices.length > 0) {
        const stakesInputs: StakesTriangleInput[] = nonExpressionChoices.map(c => ({
          choiceId: c.id,
          choiceType: c.choiceType,
          choiceText: c.text,
          want: c.stakesAnnotation?.want,
          cost: c.stakesAnnotation?.cost,
          identity: c.stakesAnnotation?.identity,
          context: c.sceneContext || '',
        }));

        const stakesResults = await this.stakesTriangleValidator.validateBatch(stakesInputs);

        // Collect issues from all results
        const stakesEntries = Array.from(stakesResults.results.entries());
        for (const [, result] of stakesEntries) {
          allIssues.push(...result.issues);
        }

        metrics.stakesTriangle = {
          averageScore: stakesResults.averageScore,
          choicesEvaluated: stakesResults.totalCount,
          choicesPassed: stakesResults.passedCount,
        };
      }
    }

    // 5. Five-Factor Validation (with LLM)
    if (this.config.rules.fiveFactor.enabled) {
      const nonExpressionChoices = input.choices.filter(c => c.choiceType !== 'expression');

      if (nonExpressionChoices.length > 0) {
        const fiveFactorInputs: FiveFactorInput[] = nonExpressionChoices.map(c => ({
          choiceId: c.id,
          choiceType: c.choiceType,
          choiceText: c.text,
          consequences: c.consequences,
          context: c.sceneContext || '',
        }));

        const fiveFactorResults = await this.fiveFactorValidator.validateBatch(fiveFactorInputs);

        // Collect issues from all results
        const fiveFactorEntries = Array.from(fiveFactorResults.results.entries());
        for (const [, result] of fiveFactorEntries) {
          allIssues.push(...result.issues);
        }

        metrics.fiveFactor = {
          averageFactorCount: fiveFactorResults.averageFactorCount,
          choicesEvaluated: fiveFactorResults.totalCount,
          choicesPassed: fiveFactorResults.passedCount,
        };
      }
    }

    // 6. Callback Opportunities Validation
    if (input.choices.length > 0) {
      const callbackResult = await this.callbackValidator.validate({
        scenes: input.scenes,
        choices: input.choices.map(c => ({
          id: c.id,
          sceneId: c.sceneId || '',
          text: c.text,
          consequences: c.consequences,
          reminderPlan: c.reminderPlan,
        })),
        knownFlags: input.knownFlags,
        knownScores: input.knownScores,
      });

      allIssues.push(...callbackResult.issues);

      metrics.callbackOpportunities = {
        callbackScore: callbackResult.callbackScore,
        choicesWithCallbacks: callbackResult.metrics.choicesWithCallbacks,
        flagsSet: callbackResult.metrics.flagsSet,
        flagsReferenced: callbackResult.metrics.flagsReferenced,
        textVariantsCount: callbackResult.metrics.textVariantsCount,
        choicesWithReminderPlans: callbackResult.metrics.choicesWithReminderPlans,
      };
    }

    // Categorize issues
    const blockingIssues = allIssues.filter(i => i.level === 'error');
    const warnings = allIssues.filter(i => i.level === 'warning');
    const suggestions = allIssues.filter(i => i.level === 'suggestion');

    // Calculate overall score
    const overallScore = this.calculateOverallScore(metrics, blockingIssues.length, warnings.length);

    // Determine if validation passed
    const overallPassed = this.config.mode === 'advisory' ||
      (blockingIssues.length === 0 && (this.config.mode !== 'strict' || warnings.length === 0));

    return {
      overallPassed,
      overallScore,
      blockingIssues,
      warnings,
      suggestions,
      metrics,
      timestamp: new Date(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Calculate overall validation score (0-100)
   */
  private calculateOverallScore(
    metrics: ValidationMetrics,
    errorCount: number,
    warningCount: number
  ): number {
    let score = 100;

    // Deduct for errors (major penalty)
    score -= errorCount * 15;

    // Deduct for warnings (minor penalty)
    score -= warningCount * 5;

    // Factor in component scores
    const componentScores: number[] = [];

    // Stakes Triangle score (if evaluated)
    if (metrics.stakesTriangle.choicesEvaluated > 0) {
      const passRate = metrics.stakesTriangle.choicesPassed / metrics.stakesTriangle.choicesEvaluated;
      componentScores.push(passRate * 100);
    }

    // Five-Factor score (if evaluated)
    if (metrics.fiveFactor.choicesEvaluated > 0) {
      const passRate = metrics.fiveFactor.choicesPassed / metrics.fiveFactor.choicesEvaluated;
      componentScores.push(passRate * 100);
    }

    // NPC Depth score (if evaluated)
    if (metrics.npcDepth.coreNPCsTotal > 0) {
      const coreRate = metrics.npcDepth.coreNPCsValid / metrics.npcDepth.coreNPCsTotal;
      componentScores.push(coreRate * 100);
    }

    // Choice Density score
    if (metrics.choiceDensity.totalChoices > 0) {
      const densityConfig = this.config.rules.choiceDensity;
      let densityScore = 100;

      if (metrics.choiceDensity.firstChoiceSeconds > densityConfig.firstChoiceMaxSeconds) {
        const overage = metrics.choiceDensity.firstChoiceSeconds - densityConfig.firstChoiceMaxSeconds;
        densityScore -= Math.min(30, overage / 2);
      }

      if (metrics.choiceDensity.averageGapSeconds > densityConfig.averageGapMaxSeconds) {
        const overage = metrics.choiceDensity.averageGapSeconds - densityConfig.averageGapMaxSeconds;
        densityScore -= Math.min(30, overage / 3);
      }

      componentScores.push(Math.max(0, densityScore));
    }

    // Average component scores into overall
    if (componentScores.length > 0) {
      const avgComponentScore = componentScores.reduce((sum, s) => sum + s, 0) / componentScores.length;
      score = Math.round((score + avgComponentScore) / 2);
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Get current validation configuration
   */
  getConfig(): ValidationConfig {
    return this.config;
  }

  /**
   * Update validation configuration
   */
  setConfig(config: Partial<ValidationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Access individual validators for specific use cases
   */
  get validators() {
    return {
      choiceDensity: this.choiceDensityValidator,
      npcDepth: this.npcDepthValidator,
      consequenceBudget: this.consequenceBudgetValidator,
      stakesTriangle: this.stakesTriangleValidator,
      fiveFactor: this.fiveFactorValidator,
      callbackOpportunities: this.callbackValidator,
    };
  }
}
