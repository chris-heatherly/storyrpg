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
import { ChoiceDistributionValidator } from './ChoiceDistributionValidator';
import { NPCDepthValidator } from './NPCDepthValidator';
import { ConsequenceBudgetValidator } from './ConsequenceBudgetValidator';
import { StakesTriangleValidator } from './StakesTriangleValidator';
import { FiveFactorValidator } from './FiveFactorValidator';
import { CallbackOpportunitiesValidator } from './CallbackOpportunitiesValidator';
import { ResidueObligationValidator } from './ResidueObligationValidator';
import { PixarPrinciplesValidator } from './PixarPrinciplesValidator';
import { CliffhangerValidator } from './CliffhangerValidator';
import { ChoiceImpactValidator } from './ChoiceImpactValidator';
import { MechanicalStorytellingValidator } from './MechanicalStorytellingValidator';
import { MechanicsLeakageValidator } from './MechanicsLeakageValidator';
import { gateDesignNoteLeak, isEscalatedIssue } from './issueEscalation';
import { StatCheckBalanceValidator } from './StatCheckBalanceValidator';
import { SkillSurfaceValidator } from './SkillSurfaceValidator';
import { SkillCoverageValidator } from './SkillCoverageValidator';
import { BranchMechanicalDivergenceValidator } from './BranchMechanicalDivergenceValidator';
import { buildChoiceAgencyCanonicalReport } from './choiceAgencyCanonicalReport';
import { NPCTier, RelationshipDimension, Consequence, ReminderPlan, SeasonBible, Episode, EpisodePlan } from '../../types';
import type {
  ChoiceAffordanceSource,
  ChoiceConsequenceTier,
  ChoiceImpactFactor,
  ChoiceIntent,
  FailureResidue,
  WitnessReaction,
} from '../../types';
import type { CliffhangerPlan } from '../../types/seasonPlan';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { CharacterBible } from '../agents/CharacterDesigner';
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
  type ValidatorExecutionRecord,
} from '../../types/validation';
import { CHOICE_DENSITY_DEFAULTS } from '../../constants/validation';
import type { SerializedCallbackLedger } from '../pipeline/callbackLedger';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import { createValidatorExecutionRecord } from './validatorExecutionRecords';

// Branching-frequency reference cap fed to ChoiceDistributionValidator's
// reporting pass. The metric only reports branchingCount vs. this cap today;
// enforcing it (and the taxonomy deviation) is deferred to the Phase 2 re-arm.
const CHOICE_DISTRIBUTION_BRANCHING_CAP = 6;

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
    charactersInvolved?: string[];
    beats: Array<{
      id: string;
      text: string;
      isChoicePoint?: boolean;
      textVariants?: Array<{
        condition: unknown;
        text: string;
        callbackHookId?: string;
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
    choiceIntent?: ChoiceIntent;
    impactFactors?: ChoiceImpactFactor[];
    consequenceTier?: ChoiceConsequenceTier;
    stakes?: {
      want: string;
      cost: string;
      identity: string;
    };
    outcomeTexts?: {
      success?: string;
      partial?: string;
      failure?: string;
    };
    lockedText?: string;
    reactionText?: string;
    statCheck?: unknown;
    conditions?: unknown;
    showWhenLocked?: boolean;
    tintFlag?: string;
    delayedConsequences?: unknown[];
    residueHints?: unknown[];
    memorableMoment?: unknown;
    storyVerb?: string;
    affordanceSource?: ChoiceAffordanceSource;
    witnessReactions?: WitnessReaction[];
    failureResidue?: FailureResidue;
  }>;

  // Known flags/scores for callback validation
  knownFlags?: string[];
  knownScores?: string[];
  callbackLedger?: SerializedCallbackLedger;
  generatedThroughEpisode?: number;
  seasonResiduePlan?: SeasonResidueObligation[];
  episodeNumber?: number;

  // Optional encounter structures for Pixar principles validation
  encounterStructures?: EncounterStructure[];

  // Optional contextual inputs for season/episode-level checks
  characterBible?: CharacterBible;
  seasonBible?: SeasonBible;
  episode?: Episode;
  episodePlan?: EpisodePlan;
  cliffhangerPlan?: CliffhangerPlan;
}

/**
 * Resolve the stakes triangle the validator should score for a choice.
 *
 * ChoiceAuthor writes the AUTHORED triangle to `choice.stakes`; `stakesAnnotation`
 * historically carried StoryArchitect's placeholder sentinel and would otherwise be
 * scored instead of the real content (the false-positive "WANT is a project title"
 * blocking errors). Prefer the authored stakes, fall back to the annotation only when
 * the choice was never authored (genuinely un-authored choices still surface the
 * placeholder so the Karpathy repair loop / StakesTriangleValidator sentinel can score
 * them 0 and force regeneration). See constants/placeholderStakes.ts.
 */
export function resolveStakesForValidation(choice: {
  stakes?: { want: string; cost: string; identity: string };
  stakesAnnotation?: StakesAnnotation;
}): { want?: string; cost?: string; identity?: string } {
  const authored = choice.stakes;
  const annotation = choice.stakesAnnotation;
  return {
    want: authored?.want ?? annotation?.want,
    cost: authored?.cost ?? annotation?.cost,
    identity: authored?.identity ?? annotation?.identity,
  };
}

export class IntegratedBestPracticesValidator {
  private config: ValidationConfig;
  private choiceDensityValidator: ChoiceDensityValidator;
  private choiceDistributionValidator: ChoiceDistributionValidator;
  private npcDepthValidator: NPCDepthValidator;
  private consequenceBudgetValidator: ConsequenceBudgetValidator;
  private stakesTriangleValidator: StakesTriangleValidator;
  private fiveFactorValidator: FiveFactorValidator;
  private callbackValidator: CallbackOpportunitiesValidator;
  private residueValidator: ResidueObligationValidator;
  private pixarValidator: PixarPrinciplesValidator;
  private cliffhangerValidator: CliffhangerValidator;
  private choiceImpactValidator: ChoiceImpactValidator;
  private mechanicalStorytellingValidator: MechanicalStorytellingValidator;
  private mechanicsLeakageValidator: MechanicsLeakageValidator;
  private statCheckBalanceValidator: StatCheckBalanceValidator;
  private skillSurfaceValidator: SkillSurfaceValidator;
  private skillCoverageValidator: SkillCoverageValidator;
  private branchMechanicalDivergenceValidator: BranchMechanicalDivergenceValidator;

  constructor(agentConfig: AgentConfig, config?: Partial<ValidationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.choiceDensityValidator = new ChoiceDensityValidator(
      this.config.rules.choiceDensity
    );
    this.choiceDistributionValidator = new ChoiceDistributionValidator();
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
    // Quick validation can surface callback debt, but it cannot currently repair
    // callback_opportunities findings in-place. Keep the signal as a warning here;
    // final-contract validation still owns blocking treatment/callback fidelity.
    this.callbackValidator = new CallbackOpportunitiesValidator({ level: 'warning' });
    this.residueValidator = new ResidueObligationValidator();
    this.pixarValidator = new PixarPrinciplesValidator();
    this.cliffhangerValidator = new CliffhangerValidator(agentConfig);
    this.choiceImpactValidator = new ChoiceImpactValidator();
    this.mechanicalStorytellingValidator = new MechanicalStorytellingValidator();
    this.mechanicsLeakageValidator = new MechanicsLeakageValidator();
    this.statCheckBalanceValidator = new StatCheckBalanceValidator();
    this.skillSurfaceValidator = new SkillSurfaceValidator();
    this.skillCoverageValidator = new SkillCoverageValidator();
    this.branchMechanicalDivergenceValidator = new BranchMechanicalDivergenceValidator();
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
    const executionRecords: ValidatorExecutionRecord[] = [];
    const recordQuickExecution = (validatorId: string, issues: Array<{ level?: string; severity?: string; message?: string; location?: unknown; suggestion?: string }>): void => {
      executionRecords.push(createValidatorExecutionRecord({
        validatorId,
        lifecycle: 'quick-validation',
        issues,
      }));
    };

    // 1. NPC Depth (structural, fast)
    if (this.config.rules.npcDepth.enabled) {
      const npcResult = await this.npcDepthValidator.validate({
        npcs: input.npcs,
      });
      recordQuickExecution('NPCDepthValidator', npcResult.issues);

      for (const issue of npcResult.issues) {
        if (issue.level === 'error') {
          blockingIssues.push(issue);
        } else if (issue.level === 'warning') {
          warningCount++;
        }
      }
    }

    // 1.5 Choice impact contract (fast, deterministic)
    if (input.choices.length > 0) {
      const impactResult = this.choiceImpactValidator.validate({ choices: input.choices as any });
      recordQuickExecution('ChoiceImpactValidator', impactResult.issues);
      for (const issue of impactResult.issues) {
        const mapped = toValidationIssue('choice_impact', issue);
        if (mapped.level === 'error') {
          blockingIssues.push(mapped);
        } else if (mapped.level === 'warning') {
          warningCount++;
        }
      }

      const mechanicalResult = this.mechanicalStorytellingValidator.validate({
        choices: input.choices as any,
        storyNpcs: input.npcs,
        sceneNpcIdsBySceneId: Object.fromEntries(
          input.scenes.map((scene) => [scene.id, scene.charactersInvolved || []])
        ),
      });
      recordQuickExecution('MechanicalStorytellingValidator', mechanicalResult.issues);
      for (const issue of mechanicalResult.issues) {
        const mapped = toValidationIssue('mechanical_storytelling', issue);
        if (mapped.level === 'error') {
          blockingIssues.push(mapped);
        } else if (mapped.level === 'warning') {
          warningCount++;
        }
      }

      const balanceResult = this.statCheckBalanceValidator.validate({ choices: input.choices as any });
      recordQuickExecution('StatCheckBalanceValidator', balanceResult.issues);
      for (const issue of balanceResult.issues) {
        const mapped = toValidationIssue('stat_check_balance', issue);
        if (mapped.level === 'error') {
          blockingIssues.push(mapped);
        } else if (mapped.level === 'warning') {
          warningCount++;
        }
      }
    }

    // 2. Stakes Triangle (check for missing components only, skip LLM scoring)
    // Required for dilemma choices and any choice that branches (has nextSceneId)
    if (this.config.rules.stakesTriangle.enabled) {
      const stakesTriangleIssues: ValidationIssue[] = [];
      for (const choice of input.choices) {
        const isHighStakes = choice.choiceType === 'dilemma' || choice.nextSceneId;
        if (isHighStakes) {
          const stakes = resolveStakesForValidation(choice);
          if (!stakes?.want || !stakes?.cost || !stakes?.identity) {
            const missing: string[] = [];
            if (!stakes?.want) missing.push('WANT');
            if (!stakes?.cost) missing.push('COST');
            if (!stakes?.identity) missing.push('IDENTITY');
            const label = choice.choiceType === 'dilemma' ? 'DILEMMA' : `BRANCHING ${choice.choiceType.toUpperCase()}`;

            const issue: ValidationIssue = {
              category: 'stakes_triangle',
              level: 'error',
              message: `${label} choice "${choice.id}" missing stakes: ${missing.join(', ')}`,
              location: { choiceId: choice.id },
              suggestion: `Add ${missing.join(' and ')} to complete the Stakes Triangle`,
            };
            stakesTriangleIssues.push(issue);
            blockingIssues.push(issue);
          }
        }
      }
      recordQuickExecution('StakesTriangleValidator', stakesTriangleIssues);
    }

    // 3. Five-Factor (heuristic check only, no LLM)
    // Required for dilemma choices and any choice that branches
    if (this.config.rules.fiveFactor.enabled) {
      const fiveFactorIssues: ValidationIssue[] = [];
      for (const choice of input.choices) {
        const isHighStakes = choice.choiceType === 'dilemma' || choice.nextSceneId;
        if (isHighStakes) {
          const impact = this.fiveFactorValidator.analyzeConsequencesHeuristic(
            choice.consequences
          );
          const factorCount = this.fiveFactorValidator.countFactors(impact);
          const label = choice.choiceType === 'dilemma' ? 'DILEMMA' : `BRANCHING ${choice.choiceType.toUpperCase()}`;

          if (factorCount === 0 && choice.consequences.length === 0) {
            const issue: ValidationIssue = {
              category: 'five_factor',
              level: 'error',
              message: `${label} choice "${choice.id}" has no consequences and affects 0 factors`,
              location: { choiceId: choice.id },
              suggestion: 'Add consequences that change OUTCOME, PROCESS, INFORMATION, RELATIONSHIP, or IDENTITY',
            };
            fiveFactorIssues.push(issue);
            blockingIssues.push(issue);
          }
        }
      }
      recordQuickExecution('FiveFactorValidator', fiveFactorIssues);
    }

    // 4. Choice Density - critical check for having ANY choices
    if (this.config.rules.choiceDensity.enabled && input.scenes.length > 0) {
      const densityResult = await this.choiceDensityValidator.validate({
        beats: input.scenes.flatMap(s => s.beats),
        scenes: input.scenes,
      });
      recordQuickExecution('ChoiceDensityValidator', densityResult.issues);

      for (const issue of densityResult.issues) {
        if (issue.level === 'error') {
          blockingIssues.push(issue);
        } else if (issue.level === 'warning') {
          warningCount++;
        }
      }
    }

    // 5. Consequence Budget
    // Generated episodes are slices of the season, not the season budget itself.
    // The 60/25/10/5 target is enforced at plan/season scope, so quick validation
    // should not warn or block merely because this slice's local mix differs.
    if (this.config.rules.consequenceBudget.enabled && input.choices.length > 0) {
      const budgetResult = await this.consequenceBudgetValidator.validate({
        choices: input.choices.map(c => ({
          id: c.id,
          choiceType: c.choiceType,
          consequences: c.consequences,
        })),
      });
      recordQuickExecution('ConsequenceBudgetValidator', budgetResult.issues);
    }

    // 6. Callback Opportunities — drive SceneWriter textVariants repair
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
        callbackLedger: input.callbackLedger,
        generatedThroughEpisode: input.generatedThroughEpisode,
      });
      recordQuickExecution('CallbackOpportunitiesValidator', callbackResult.issues);

      for (const issue of callbackResult.issues) {
        if (issue.level === 'error') {
          blockingIssues.push(issue);
        } else if (issue.level === 'warning') {
          warningCount++;
        }
      }
    }

    if (input.episode && input.seasonResiduePlan?.length && input.episodeNumber) {
      const residueResult = this.residueValidator.validate({
        episode: input.episode,
        seasonResiduePlan: input.seasonResiduePlan,
        callbackLedger: input.callbackLedger,
        episodeNumber: input.episodeNumber,
        generatedThroughEpisode: input.generatedThroughEpisode || input.episodeNumber,
      });
      recordQuickExecution('ResidueObligationValidator', residueResult.issues);
      for (const issue of residueResult.issues) {
        const mapped: ValidationIssue = {
          category: 'residue_obligations',
          level: issue.severity === 'error' ? 'error' : 'warning',
          message: issue.message,
          location: {},
          suggestion: issue.suggestion,
        };
        if (mapped.level === 'error') {
          blockingIssues.push(mapped);
        } else {
          warningCount++;
        }
      }
    }

    // 7. Fiction-first mechanics leakage — block raw mechanics in prose
    const leakageResult = this.mechanicsLeakageValidator.validate({
      texts: collectPlayerFacingTexts(input),
      scanDesignNotes: gateDesignNoteLeak(),
    });
    recordQuickExecution('MechanicsLeakageValidator', leakageResult.issues);
    for (const issue of leakageResult.issues) {
      const mapped = toValidationIssue('mechanics_leakage', issue);
      if (mapped.level === 'error') {
        blockingIssues.push(mapped);
      } else if (mapped.level === 'warning') {
        warningCount++;
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
      executionRecords,
    };
  }

  /**
   * Full validation for QA-time (comprehensive report)
   * Runs all validators including LLM-based analysis
   */
  async runFullValidation(input: ValidationInput): Promise<ComprehensiveValidationReport> {
    const startTime = Date.now();
    const allIssues: ValidationIssue[] = [];
    const executionRecords: ValidatorExecutionRecord[] = [];
    const recordFullExecution = (validatorId: string, issues: Array<{ level?: string; severity?: string; message?: string; location?: unknown; suggestion?: string }>): void => {
      executionRecords.push(createValidatorExecutionRecord({
        validatorId,
        lifecycle: 'full-qa',
        issues,
      }));
    };

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
        // totalChoices is the real choice inventory, NOT the choice-point-beat
        // count. ChoiceDensityValidator.choiceCount counts beats flagged
        // isChoicePoint (used for pacing/gap math) — that under-counts the
        // story's actual choices (e.g. reported 2 for a 14-choice story).
        totalChoices: input.choices.length,
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
      recordFullExecution('ChoiceDensityValidator', densityResult.issues);

      metrics.choiceDensity = {
        averageGapSeconds: densityResult.metrics.averageGapSeconds,
        firstChoiceSeconds: densityResult.metrics.firstChoiceSeconds,
        // Headline count = real choices, not choice-point beats (see init above).
        totalChoices: input.choices.length,
      };
    }

    // 1.6 Choice TYPE distribution (taxonomy) — GENERATED-SLICE reporting only.
    // Choice-type BALANCE is a whole-season property and is validated at plan time
    // (seasonChoicePlan runs ChoiceDistributionValidator over the full season's moments
    // vs target). Comparing a generated K-of-N slice against the 35/30/20/15 target was a
    // category error (it made a legitimate partial-season strategic shortfall read as a
    // −20pp defect). So here we report the slice counts/percentages WITHOUT a target
    // comparison; per-episode conformance is ChoiceTypePlanConformanceValidator's job.
    if (input.choices.length > 0) {
      const raw = this.choiceDistributionValidator.computeMetrics({
        choiceSets: input.choices.map((c) => ({
          beatId: c.id,
          choiceType: c.choiceType,
          sceneId: c.sceneId,
          hasBranching: Boolean(c.nextSceneId),
        })),
        targets: { expression: 35, relationship: 30, strategic: 20, dilemma: 15 },
        maxBranchingChoicesPerEpisode: CHOICE_DISTRIBUTION_BRANCHING_CAP,
      });
      recordFullExecution('ChoiceDistributionValidator', []);
      metrics.choiceDistribution = {
        totalChoiceSets: raw.totalChoiceSets,
        counts: raw.counts,
        actualPercentages: raw.actualPercentages,
        branchingCount: raw.branchingCount,
        branchingCap: raw.branchingCap,
        scope: 'generated-slice',
        note: 'Generated slice only — choice-type balance is validated against target at the season-plan level, not here.',
      };
    }

    // 1.5 Choice Impact Validation
    if (input.choices.length > 0) {
      const impactResult = this.choiceImpactValidator.validate({ choices: input.choices as any });
      const impactIssues = impactResult.issues.map((issue) => toValidationIssue('choice_impact', issue));
      allIssues.push(...impactIssues);
      recordFullExecution('ChoiceImpactValidator', impactIssues);
      metrics.choiceImpact = {
        meaningfulChoices: impactResult.metrics.meaningfulChoices,
        choicesWithImpactFactors: impactResult.metrics.choicesWithImpactFactors,
        flavorBranches: impactResult.metrics.flavorBranches,
      };

      const mechanicalResult = this.mechanicalStorytellingValidator.validate({
        choices: input.choices as any,
        storyNpcs: input.npcs,
        sceneNpcIdsBySceneId: Object.fromEntries(
          input.scenes.map((scene) => [scene.id, scene.charactersInvolved || []])
        ),
      });
      const mechanicalIssues = mechanicalResult.issues.map((issue) => toValidationIssue('mechanical_storytelling', issue));
      allIssues.push(...mechanicalIssues);
      recordFullExecution('MechanicalStorytellingValidator', mechanicalIssues);
      metrics.mechanicalStorytelling = {
        meaningfulChoices: mechanicalResult.metrics.meaningfulChoices,
        choicesWithStoryVerb: mechanicalResult.metrics.choicesWithStoryVerb,
        choicesWithAffordanceSource: mechanicalResult.metrics.choicesWithAffordanceSource,
        choicesWithWitnessReactions: mechanicalResult.metrics.choicesWithWitnessReactions,
        statChecksWithPlayableFailure: mechanicalResult.metrics.statChecksWithPlayableFailure,
        invalidWitnessReferences: mechanicalResult.metrics.invalidWitnessReferences,
        invalidRelationshipReferences: mechanicalResult.metrics.invalidRelationshipReferences,
      };

      const balanceResult = this.statCheckBalanceValidator.validate({ choices: input.choices as any });
      const balanceIssues = balanceResult.issues.map((issue) => toValidationIssue('stat_check_balance', issue));
      allIssues.push(...balanceIssues);
      recordFullExecution('StatCheckBalanceValidator', balanceIssues);
      metrics.statCheckBalance = balanceResult.metrics;

      // Skill coverage is a SEASON property — never gated against a generated K-of-N
      // slice (that is a category error). Reported here for visibility only; the
      // season plan owns balance (validateSeasonSkillPlan) and per-episode conformance
      // is checked by SkillPlanConformanceValidator.
      const coverageResult = this.skillCoverageValidator.validate({
        choices: input.choices as any,
        encounters: input.encounterStructures,
      });
      const coverageIssues = coverageResult.issues.map((issue) => toValidationIssue('skill_coverage', issue));
      allIssues.push(...coverageIssues);
      recordFullExecution('SkillCoverageValidator', coverageIssues);
      metrics.skillCoverage = coverageResult.metrics;
    }

    const skillSurfaceResult = this.skillSurfaceValidator.validate({ scenes: input.scenes as any, choices: input.choices as any });
    const skillSurfaceIssues = skillSurfaceResult.issues.map((issue) => toValidationIssue('skill_surface', issue));
    allIssues.push(...skillSurfaceIssues);
    recordFullExecution('SkillSurfaceValidator', skillSurfaceIssues);
    metrics.skillSurface = skillSurfaceResult.metrics;

    const branchMechanicalResult = this.branchMechanicalDivergenceValidator.validate({ scenes: input.scenes as any });
    const branchMechanicalIssues = branchMechanicalResult.issues.map((issue) => toValidationIssue('branch_mechanical_divergence', issue));
    allIssues.push(...branchMechanicalIssues);
    recordFullExecution('BranchMechanicalDivergenceValidator', branchMechanicalIssues);
    metrics.branchMechanicalDivergence = branchMechanicalResult.metrics;

    // 1.6 Mechanics Leakage Validation
    const leakageResult = this.mechanicsLeakageValidator.validate({
      texts: collectPlayerFacingTexts(input),
      scanDesignNotes: gateDesignNoteLeak(),
    });
    const leakageIssues = leakageResult.issues.map((issue) => toValidationIssue('mechanics_leakage', issue));
    allIssues.push(...leakageIssues);
    recordFullExecution('MechanicsLeakageValidator', leakageIssues);
    metrics.mechanicsLeakage = leakageResult.metrics;

    // 2. NPC Depth Validation
    if (this.config.rules.npcDepth.enabled && input.npcs.length > 0) {
      const npcInput: NPCDepthInput = { npcs: input.npcs };
      const npcResult = await this.npcDepthValidator.validate(npcInput);
      allIssues.push(...npcResult.issues);
      recordFullExecution('NPCDepthValidator', npcResult.issues);

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
      recordFullExecution('ConsequenceBudgetValidator', budgetResult.issues);

      const totalConsequences = Object.values(budgetResult.consequencesByCategory)
        .reduce((sum, count) => sum + count, 0);

      metrics.consequenceBudget = {
        allocation: budgetResult.allocation,
        totalConsequences,
        scope: 'generated-slice',
        note: 'Generated slice only — consequence-budget percentages are planned and enforced at season scope, not episode scope.',
      };
    }

    // 4. Stakes Triangle Validation (with LLM)
    if (this.config.rules.stakesTriangle.enabled) {
      const nonExpressionChoices = input.choices.filter(c => c.choiceType !== 'expression');

      if (nonExpressionChoices.length > 0) {
        const stakesInputs: StakesTriangleInput[] = nonExpressionChoices.map(c => {
          const stakes = resolveStakesForValidation(c);
          return {
            choiceId: c.id,
            choiceType: c.choiceType,
            choiceText: c.text,
            want: stakes.want,
            cost: stakes.cost,
            identity: stakes.identity,
            context: c.sceneContext || '',
          };
        });

        const stakesResults = await this.stakesTriangleValidator.validateBatch(stakesInputs);

        // Collect issues from all results
        const stakesEntries = Array.from(stakesResults.results.entries());
        const stakesIssues: ValidationIssue[] = [];
        for (const [, result] of stakesEntries) {
          stakesIssues.push(...result.issues);
        }
        allIssues.push(...stakesIssues);
        recordFullExecution('StakesTriangleValidator', stakesIssues);

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
          impactFactors: (c as { impactFactors?: FiveFactorInput['impactFactors'] }).impactFactors,
        }));

        const fiveFactorResults = await this.fiveFactorValidator.validateBatch(fiveFactorInputs);

        // Collect issues from all results
        const fiveFactorEntries = Array.from(fiveFactorResults.results.entries());
        const fiveFactorIssues: ValidationIssue[] = [];
        for (const [, result] of fiveFactorEntries) {
          fiveFactorIssues.push(...result.issues);
        }
        allIssues.push(...fiveFactorIssues);
        recordFullExecution('FiveFactorValidator', fiveFactorIssues);

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
        callbackLedger: input.callbackLedger,
        generatedThroughEpisode: input.generatedThroughEpisode,
      });

      allIssues.push(...callbackResult.issues);
      recordFullExecution('CallbackOpportunitiesValidator', callbackResult.issues);

      metrics.callbackOpportunities = {
        callbackScore: callbackResult.callbackScore,
        choicesWithCallbacks: callbackResult.metrics.choicesWithCallbacks,
        flagsSet: callbackResult.metrics.flagsSet,
        flagsReferenced: callbackResult.metrics.flagsReferenced,
        textVariantsCount: callbackResult.metrics.textVariantsCount,
        choicesWithReminderPlans: callbackResult.metrics.choicesWithReminderPlans,
      };
    }

    // 7. Pixar Principles Validation (optional — requires seasonBible)
    if (input.seasonBible) {
      const pixarIssues: ValidationIssue[] = [];
      try {
        const pixarReport = this.pixarValidator.validateSeason(
          input.seasonBible,
          input.characterBible,
        );
        // Convert each Pixar issue into a ValidationIssue
        for (const pxIssue of pixarReport.issues ?? []) {
          const level: 'error' | 'warning' | 'suggestion' =
            pxIssue.severity === 'error' || pxIssue.severity === 'critical'
              ? 'error'
              : pxIssue.severity === 'warning'
              ? 'warning'
              : 'suggestion';
          const issue: ValidationIssue = {
            category: 'pixar_principles',
            level,
            message:
              pxIssue.description ||
              (pxIssue as unknown as { message?: string }).message ||
              pxIssue.type,
            location: {
              sceneId: pxIssue.location?.sceneId,
              beatId: pxIssue.location?.beatId,
              choiceId: (pxIssue.location as unknown as { choiceId?: string })?.choiceId,
            },
            suggestion: pxIssue.suggestion,
          };
          allIssues.push(issue);
          pixarIssues.push(issue);
        }
      } catch (err) {
        // Keep validator non-fatal; Pixar coverage is advisory
        console.warn('[IBPV] PixarPrinciplesValidator failed:', err);
      }

      // Encounter-level Pixar surprise checks
      if (input.encounterStructures && input.encounterStructures.length > 0) {
        for (const enc of input.encounterStructures) {
          try {
            const issues = this.pixarValidator.validateEncounter(
              enc,
              enc.sceneId || '',
            );
            for (const pxIssue of issues ?? []) {
              const level: 'error' | 'warning' | 'suggestion' =
                pxIssue.severity === 'error' || pxIssue.severity === 'critical'
                  ? 'error'
                  : pxIssue.severity === 'warning'
                  ? 'warning'
                  : 'suggestion';
              const issue: ValidationIssue = {
                category: 'pixar_principles',
                level,
                message: pxIssue.description || pxIssue.type,
                location: {
                  sceneId: pxIssue.location?.sceneId,
                },
                suggestion: pxIssue.suggestion,
              };
              allIssues.push(issue);
              pixarIssues.push(issue);
            }
          } catch (err) {
            console.warn('[IBPV] PixarPrinciplesValidator.validateEncounter failed:', err);
          }
        }
      }
      recordFullExecution('PixarPrinciplesValidator', pixarIssues);
    }

    // 8. Cliffhanger Validation (episode-level)
    if (input.episode && (input.episodePlan || input.cliffhangerPlan)) {
      const cliffhangerIssues: ValidationIssue[] = [];
      try {
        const analysis = this.cliffhangerValidator.quickAnalyze(
          input.episode,
          input.cliffhangerPlan || input.episodePlan!,
        );
        if (analysis.quality === 'missing' || analysis.quality === 'weak') {
          const issue: ValidationIssue = {
            category: 'cliffhanger',
            level: analysis.quality === 'missing' ? 'error' : 'warning',
            message: `Episode cliffhanger is ${analysis.quality} (score ${analysis.score}/100)`,
            location: { sceneId: undefined },
            suggestion: analysis.suggestions.join('; '),
          };
          allIssues.push(issue);
          cliffhangerIssues.push(issue);
        }
      } catch (err) {
        console.warn('[IBPV] CliffhangerValidator failed:', err);
      }
      recordFullExecution('CliffhangerValidator', cliffhangerIssues);
    }

    const choiceAgencyCanonicalReport = buildChoiceAgencyCanonicalReport(allIssues);

    // Categorize issues. Escalated correctness classes (witness-id integrity,
    // design-note leak) are promoted into the blocking set when their rollout flag
    // is on — see issueEscalation. Default-off ⇒ `escalatedAdvisory` is empty and
    // every line below is byte-identical to the historical behavior.
    const errorIssues = allIssues.filter(i => i.level === 'error');
    const escalatedAdvisory = allIssues.filter(i => i.level !== 'error' && isEscalatedIssue(i));
    const blockingIssues = escalatedAdvisory.length ? [...errorIssues, ...escalatedAdvisory] : errorIssues;
    const warnings = allIssues.filter(i => i.level === 'warning' && !isEscalatedIssue(i));
    const suggestions = allIssues.filter(i => i.level === 'suggestion');

    // Calculate overall score
    const overallScore = this.calculateOverallScore(metrics, blockingIssues.length, warnings.length);

    // Determine if validation passed. Advisory mode normally passes regardless,
    // but an escalated correctness class hard-gates even in advisory mode.
    const hasEscalatedBlocker = blockingIssues.some(isEscalatedIssue);
    const overallPassed = hasEscalatedBlocker
      ? false
      : this.config.mode === 'advisory' ||
        (blockingIssues.length === 0 && (this.config.mode !== 'strict' || warnings.length === 0));

    return {
      overallPassed,
      overallScore,
      qualityScore: overallScore,
      blockingIssues,
      warnings,
      suggestions,
      metrics,
      choiceAgencyCanonicalReport,
      executionRecords,
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
      pixarPrinciples: this.pixarValidator,
      cliffhanger: this.cliffhangerValidator,
      mechanicalStorytelling: this.mechanicalStorytellingValidator,
      statCheckBalance: this.statCheckBalanceValidator,
      skillSurface: this.skillSurfaceValidator,
      skillCoverage: this.skillCoverageValidator,
      branchMechanicalDivergence: this.branchMechanicalDivergenceValidator,
    };
  }
}

function toValidationIssue(
  category: ValidationIssue['category'],
  issue: {
    severity: 'error' | 'warning' | 'info';
    message: string;
    location?: string;
    suggestion?: string;
  }
): ValidationIssue {
  const level: ValidationIssue['level'] =
    issue.severity === 'error'
      ? 'error'
      : issue.severity === 'warning'
      ? 'warning'
      : 'suggestion';

  return {
    category,
    level,
    message: issue.message,
    location: parseIssueLocation(issue.location),
    suggestion: issue.suggestion,
  };
}

function parseIssueLocation(raw?: string): ValidationIssue['location'] {
  if (!raw) return {};

  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return {
      sceneId: parts[0],
      beatId: parts[1],
      choiceId: parts[2],
    };
  }
  if (parts.length === 2) {
    return {
      beatId: parts[0],
      choiceId: parts[1],
    };
  }
  if (parts.length === 1) {
    return { choiceId: parts[0] };
  }
  return {};
}

function collectPlayerFacingTexts(input: ValidationInput): Array<{
  id: string;
  text: string;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  source?: string;
}> {
  const texts: Array<{
    id: string;
    text: string;
    sceneId?: string;
    beatId?: string;
    choiceId?: string;
    source?: string;
  }> = [];

  const add = (
    id: string,
    text: string | undefined,
    source: string,
    location: { sceneId?: string; beatId?: string; choiceId?: string } = {}
  ) => {
    if (!text || !text.trim()) return;
    texts.push({ id, text, source, ...location });
  };

  for (const scene of input.scenes) {
    for (const beat of scene.beats) {
      add(`${scene.id}:${beat.id}`, beat.text, 'beat', {
        sceneId: scene.id,
        beatId: beat.id,
      });
      for (const [index, variant] of (beat.textVariants || []).entries()) {
        add(`${scene.id}:${beat.id}:variant:${index}`, variant.text, 'textVariant', {
          sceneId: scene.id,
          beatId: beat.id,
        });
      }
      for (const [index, insight] of ((beat as any).skillInsights || []).entries()) {
        add(`${scene.id}:${beat.id}:skillInsight:${index}`, insight.text, 'skillInsight', {
          sceneId: scene.id,
          beatId: beat.id,
        });
      }
    }
  }

  for (const choice of input.choices) {
    add(choice.id, choice.text, 'choice', {
      sceneId: choice.sceneId,
      choiceId: choice.id,
    });
    add(`${choice.id}:locked`, choice.lockedText, 'lockedText', {
      sceneId: choice.sceneId,
      choiceId: choice.id,
    });
    add(`${choice.id}:reaction`, choice.reactionText, 'reactionText', {
      sceneId: choice.sceneId,
      choiceId: choice.id,
    });
    add(`${choice.id}:success`, choice.outcomeTexts?.success, 'outcomeText', {
      sceneId: choice.sceneId,
      choiceId: choice.id,
    });
    add(`${choice.id}:partial`, choice.outcomeTexts?.partial, 'outcomeText', {
      sceneId: choice.sceneId,
      choiceId: choice.id,
    });
    add(`${choice.id}:failure`, choice.outcomeTexts?.failure, 'outcomeText', {
      sceneId: choice.sceneId,
      choiceId: choice.id,
    });
    for (const [index, modifier] of (((choice.statCheck as any)?.modifiers || []) as Array<{ hint?: string }>).entries()) {
      add(`${choice.id}:modifier:${index}`, modifier.hint, 'preparedAdvantageHint', {
        sceneId: choice.sceneId,
        choiceId: choice.id,
      });
    }
  }

  return texts;
}
