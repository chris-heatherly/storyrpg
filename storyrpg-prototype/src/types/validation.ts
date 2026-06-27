/**
 * Validation Types for Best Practices Enforcement
 *
 * These types support the validation layer that enforces
 * interactive storytelling best practices during content generation.
 */

import {
  FiveFactorImpact,
  TimingMetadata,
  ConsequenceBudgetCategory,
  NPCTier,
  RelationshipDimension,
  Consequence,
} from './index';

// ========================================
// ENFORCEMENT LEVELS
// ========================================

export type EnforcementLevel = 'error' | 'warning' | 'suggestion';

export type ValidationCategory =
  | 'stakes_triangle'
  | 'five_factor'
  | 'choice_impact'
  | 'mechanical_storytelling'
  | 'stat_check_balance'
  | 'skill_surface'
  | 'skill_coverage'
  | 'branch_mechanical_divergence'
  | 'choice_density'
  | 'choice_distribution'
  | 'consequence_budget'
  | 'mechanics_leakage'
  | 'npc_depth'
  | 'callback_opportunities'
  | 'residue_obligations'
  | 'pov_clarity'
  | 'voice_fidelity'
  | 'pixar_principles'
  | 'cliffhanger'
  | 'setup_payoff'
  | 'twist_quality'
  | 'arc_delta'
  | 'divergence'
  | 'branch_topology'
  | 'treatment_fidelity'
  | 'image_completeness';

// ========================================
// VALIDATION ISSUES
// ========================================

export interface ValidationLocation {
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  npcId?: string;
}

export interface ValidationIssue {
  category: ValidationCategory;
  level: EnforcementLevel;
  message: string;
  location: ValidationLocation;
  suggestion?: string;
}

// ========================================
// STAKES TRIANGLE VALIDATION
// ========================================

export interface StakesQualityScore {
  want: number;      // 0-100: How clear is the desire?
  cost: number;      // 0-100: How meaningful is the risk?
  identity: number;  // 0-100: How revealing is the choice?
  overall: number;   // 0-100: Average of all three
}

export interface StakesValidationResult {
  passed: boolean;
  score: StakesQualityScore;
  issues: ValidationIssue[];
}

// ========================================
// FIVE-FACTOR VALIDATION
// ========================================

export interface FiveFactorValidationResult {
  passed: boolean;
  impact: FiveFactorImpact;
  factorCount: number;
  issues: ValidationIssue[];
}

// ========================================
// CHOICE DENSITY VALIDATION
// ========================================

export interface ChoiceDensityMetrics {
  totalReadingTimeSeconds: number;
  choiceCount: number;
  averageGapSeconds: number;
  firstChoiceSeconds: number;
  longestGapSeconds: number;
  beatsWithTiming: Array<{
    beatId: string;
    timing: TimingMetadata;
  }>;
}

export interface ChoiceDensityValidationResult {
  passed: boolean;
  metrics: ChoiceDensityMetrics;
  issues: ValidationIssue[];
}

// ========================================
// CONSEQUENCE BUDGET VALIDATION
// ========================================

export interface ConsequenceBudgetAllocation {
  callback: number;   // Percentage (target: 60%)
  tint: number;       // Percentage (target: 25%)
  branchlet: number;  // Percentage (target: 10%)
  branch: number;     // Percentage (target: 5%)
}

export interface ConsequenceBudgetValidationResult {
  passed: boolean;
  allocation: ConsequenceBudgetAllocation;
  issues: ValidationIssue[];
  consequencesByCategory: {
    [K in ConsequenceBudgetCategory]: number;
  };
}

// ========================================
// NPC DEPTH VALIDATION
// ========================================

export interface NPCDepthRequirements {
  tier: NPCTier;
  requiredDimensions: number;
  actualDimensions: RelationshipDimension[];
  missingDimensions: RelationshipDimension[];
}

export interface NPCDepthValidationResult {
  passed: boolean;
  npcAnalysis: Map<string, NPCDepthRequirements>;
  issues: ValidationIssue[];
}

// ========================================
// COMPREHENSIVE VALIDATION REPORT
// ========================================

export interface ValidationMetrics {
  stakesTriangle: {
    averageScore: number;
    choicesEvaluated: number;
    choicesPassed: number;
  };
  fiveFactor: {
    averageFactorCount: number;
    choicesEvaluated: number;
    choicesPassed: number;
  };
  choiceDensity: {
    averageGapSeconds: number;
    firstChoiceSeconds: number;
    totalChoices: number;
  };
  consequenceBudget: {
    allocation: ConsequenceBudgetAllocation;
    totalConsequences: number;
    scope?: 'generated-slice';
    note?: string;
  };
  npcDepth: {
    coreNPCsValid: number;
    coreNPCsTotal: number;
    supportingNPCsValid: number;
    supportingNPCsTotal: number;
  };
  callbackOpportunities?: {
    callbackScore: number;
    choicesWithCallbacks: number;
    flagsSet: number;
    flagsReferenced: number;
    textVariantsCount: number;
    choicesWithReminderPlans: number;
  };
  choiceImpact?: {
    meaningfulChoices: number;
    choicesWithImpactFactors: number;
    flavorBranches: number;
  };
  mechanicsLeakage?: {
    textsChecked: number;
    leaksFound: number;
  };
  mechanicalStorytelling?: {
    meaningfulChoices: number;
    choicesWithStoryVerb: number;
    choicesWithAffordanceSource: number;
    choicesWithWitnessReactions: number;
    statChecksWithPlayableFailure: number;
    invalidWitnessReferences: number;
    invalidRelationshipReferences?: number;
  };
  statCheckBalance?: {
    checkedChoices: number;
    hardChecks: number;
    unsupportedHardChecks: number;
  };
  skillSurface?: {
    scenesChecked: number;
    scenesWithSkillSurface: number;
    passiveInsights: number;
    preparedAdvantages: number;
  };
  skillCoverage?: {
    checkedStatChecks: number;
    coveredSkills: number;
    coveredAttributes: number;
    dominantSkill?: string;
    dominantSkillShare: number;
  };
  branchMechanicalDivergence?: {
    branchChoices: number;
    branchesWithResidue: number;
    branchesWithoutResidue: number;
  };
  choiceDistribution?: {
    totalChoiceSets: number;
    counts: Record<string, number>;
    actualPercentages: Record<string, number>;
    branchingCount: number;
    branchingCap: number;
    // G10: this block reports the GENERATED slice only. Choice-type BALANCE is a
    // whole-season property validated at plan time (seasonChoicePlan), so a K-of-N
    // generation is NOT compared against the 35/30/20/15 target here — that was a
    // category error that made a legitimate partial-season slice read as a defect.
    // `scope` marks the unit; target/deviation are intentionally omitted.
    scope?: 'generated-slice';
    note?: string;
    // Retained optional for backward-compat with any reader that expects them; not
    // populated for a generated slice.
    targetPercentages?: {
      expression: number;
      relationship: number;
      strategic: number;
      dilemma: number;
    };
    deviations?: Record<string, number>;
  };
}

export type ChoiceAgencyContract =
  | 'choice_classification_invalid'
  | 'choice_impact_domain_missing'
  | 'choice_stakes_missing'
  | 'choice_stakes_weak'
  | 'choice_reactive_surface_missing'
  | 'playable_failure_missing'
  | 'branch_residue_missing'
  | 'branch_residue_not_distinct'
  | 'branch_residue_contract_mismatch'
  | 'skill_surface_missing'
  | 'skill_surface_mechanics_leak'
  | 'choice_reference_invalid';

export type ChoiceAgencyRepairRoute =
  | 'choice-repair'
  | 'choice-stakes-repair'
  | 'branch-residue-repair'
  | 'skill-surface-repair'
  | 'reference-integrity-repair'
  | 'none';

export interface ChoiceAgencyFinding {
  id: string;
  contract: ChoiceAgencyContract;
  sourceValidator: string;
  severity: 'error' | 'warning' | 'info' | 'suggestion';
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  repairRoute: ChoiceAgencyRepairRoute;
  message: string;
  suggestion?: string;
  rawCategory?: string;
  dedupeKey: string;
}

export interface ChoiceAgencyCanonicalReport {
  findings: ChoiceAgencyFinding[];
  suppressedDuplicates: Array<{
    suppressed: ChoiceAgencyFinding;
    canonicalId: string;
    reason: string;
  }>;
  metrics: {
    rawFindingCount: number;
    canonicalFindingCount: number;
    suppressedDuplicateCount: number;
    byContract: Record<ChoiceAgencyContract, number>;
  };
}

export type ValidatorExecutionLifecycle =
  | 'source-analysis'
  | 'season-plan'
  | 'episode-architecture'
  | 'phase-validation'
  | 'quick-validation'
  | 'full-qa'
  | 'narrative-diagnostics'
  | 'plan-fidelity'
  | 'episode-contract'
  | 'final-contract'
  | 'artifact-package';

export type ValidatorExecutionRole =
  | 'primary'
  | 'regression-net'
  | 'shadow'
  | 'repair-router'
  | 'aggregate'
  | 'artifact-only';

export type ValidatorExecutionSeverity = 'error' | 'warning' | 'info' | 'suggestion';

export type ValidatorExecutionRepairRoute =
  | 'autofix'
  | 'regen-scene'
  | 'regen-choices'
  | 'regen-encounter'
  | 'regen-episode'
  | 'plan-time'
  | 'none';

export interface ValidatorExecutionIssue {
  severity: ValidatorExecutionSeverity;
  message: string;
  code?: string;
  location?: unknown;
  source?: string;
  suggestion?: string;
}

export interface ValidatorExecutionRecord {
  validatorId: string;
  lifecycle: ValidatorExecutionLifecycle;
  role: ValidatorExecutionRole;
  gateFlag?: string;
  gateEnabled: boolean;
  placement?: string;
  passed: boolean;
  issues: ValidatorExecutionIssue[];
  repair?: {
    attempted: boolean;
    succeeded?: boolean;
    route?: ValidatorExecutionRepairRoute;
    residualBlockingCount?: number;
  };
}

export type TreatmentObligationContract =
  | 'treatment_plan_conformance'
  | 'treatment_obligation_realization'
  | 'treatment_information_schedule'
  | 'treatment_signature_realization'
  | 'treatment_character_realization'
  | 'treatment_season_promise_realization'
  | 'treatment_encounter_anchor_realization'
  | 'treatment_failure_mode_realization'
  | 'treatment_scope_notice';

export type TreatmentRepairRoute =
  | 'plan-repair'
  | 'scene-regen'
  | 'encounter-regen'
  | 'ledger-repair'
  | 'judge-and-regen'
  | 'final-contract-only'
  | 'none';

export interface TreatmentObligationFinding {
  id: string;
  contract: TreatmentObligationContract;
  sourceValidator: string;
  severity: 'error' | 'warning' | 'info' | 'suggestion';
  repairRoute: TreatmentRepairRoute;
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  obligationId?: string;
  sourceFieldId?: string;
  sourceTextFingerprint?: string;
  sourceTextExcerpt?: string;
  phase: 'plan' | 'final' | 'shadow';
  targetSurface:
    | 'plan'
    | 'scene-prose'
    | 'choice'
    | 'encounter'
    | 'information-ledger'
    | 'signature-device'
    | 'character-arc'
    | 'season-promise'
    | 'ending'
    | 'failure-mode'
    | 'scope';
  message: string;
  suggestion?: string;
  rawCategory?: string;
  dedupeKey: string;
}

export interface TreatmentObligationCanonicalReport {
  findings: TreatmentObligationFinding[];
  suppressedDuplicates: Array<{
    suppressed: TreatmentObligationFinding;
    canonicalId: string;
    reason: string;
  }>;
  groupedEvidence: Array<{
    canonicalId: string;
    evidence: TreatmentObligationFinding[];
  }>;
  metrics: {
    rawFindingCount: number;
    canonicalFindingCount: number;
    suppressedDuplicateCount: number;
    byContract: Record<TreatmentObligationContract, number>;
    byRepairRoute: Record<TreatmentRepairRoute, number>;
  };
}

export interface ComprehensiveValidationReport {
  overallPassed: boolean;
  overallScore: number;
  /** Alias for overallScore used by generation telemetry and round summaries. */
  qualityScore?: number;
  blockingIssues: ValidationIssue[];
  warnings: ValidationIssue[];
  suggestions: ValidationIssue[];
  metrics: ValidationMetrics;
  /** Shadow-only canonical grouping for choice-agency overlap; does not affect pass/fail or scoring. */
  choiceAgencyCanonicalReport?: ChoiceAgencyCanonicalReport;
  /** Registry-normalized validator execution ownership records. Additive telemetry only. */
  executionRecords?: ValidatorExecutionRecord[];
  timestamp: Date;
  duration: number;
}

// ========================================
// QUICK VALIDATION (GENERATION-TIME)
// ========================================

export interface QuickValidationResult {
  canProceed: boolean;
  blockingIssues: ValidationIssue[];
  warningCount: number;
  /** Registry-normalized validator execution ownership records. Additive telemetry only. */
  executionRecords?: ValidatorExecutionRecord[];
}

// ========================================
// VALIDATION CONFIGURATION
// ========================================

export interface ValidationRuleConfig {
  enabled: boolean;
  level: EnforcementLevel;
  threshold?: number;
  tolerance?: number;
}

export interface ValidationConfig {
  enabled: boolean;
  mode: 'strict' | 'advisory' | 'disabled';
  /** Run HTTP HEAD checks against every image URL after assembly (default: true) */
  assetHttpCheck?: boolean;
  /** Treat asset HTTP failures as a hard pipeline error (default: false) */
  assetHttpCheckFailFast?: boolean;
  /** Run a Playwright browser playthrough after save to verify images render (default: true when proxy+app are running) */
  playwrightQA?: boolean;
  /** Max remediation+retest cycles when Playwright finds issues (default: 1) */
  playwrightQAMaxRetries?: number;
  /** Encounter tiers to test across retries (default: ['success','failure']) */
  playwrightQAEncounterTiers?: ('success' | 'complicated' | 'failure')[];
  rules: {
    stakesTriangle: ValidationRuleConfig;
    fiveFactor: ValidationRuleConfig;
    choiceDensity: ValidationRuleConfig & {
      firstChoiceMaxSeconds: number;
      averageGapMaxSeconds: number;
    };
    consequenceBudget: ValidationRuleConfig & {
      budgetTolerance: number;
    };
    npcDepth: ValidationRuleConfig & {
      minMajorDimensions?: number; // Min dimensions for major/core NPCs (default 4)
    };
  };
}

// ========================================
// VALIDATOR INTERFACES
// ========================================

export interface BaseValidator<TInput, TResult> {
  validate(input: TInput): Promise<TResult>;
}

export interface ChoiceDensityInput {
  beats: Array<{
    id: string;
    text: string;
    isChoicePoint?: boolean;
  }>;
  scenes: Array<{
    id: string;
    beats: Array<{
      id: string;
      text: string;
      isChoicePoint?: boolean;
    }>;
  }>;
}

export interface NPCDepthInput {
  npcs: Array<{
    id: string;
    name: string;
    tier: NPCTier;
    relationshipDimensions: RelationshipDimension[];
  }>;
}

export interface ConsequenceBudgetInput {
  choices: Array<{
    id: string;
    choiceType: string;
    consequences: Array<{
      type: string;
      budgetCategory?: ConsequenceBudgetCategory;
    }>;
  }>;
}

export interface StakesTriangleInput {
  choiceId: string;
  choiceType: string;
  choiceText: string;
  want?: string;
  cost?: string;
  identity?: string;
  context: string;
}

export interface FiveFactorInput {
  choiceId: string;
  choiceType: string;
  choiceText: string;
  consequences: Consequence[];
  context: string;
  /** E3: factors the AUTHOR declared this choice touches (outcome/process/
   * information/relationship/identity). Counted directly when present — the
   * consequence heuristic underreads them (audit: declared factors ignored). */
  impactFactors?: Array<'outcome' | 'process' | 'information' | 'relationship' | 'identity'>;
}

// ========================================
// VALIDATION ERROR CLASS
// ========================================

export class ValidationError extends Error {
  constructor(
    message: string,
    public issues: ValidationIssue[]
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
