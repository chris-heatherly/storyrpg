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
  | 'choice_density'
  | 'consequence_budget'
  | 'npc_depth'
  | 'callback_opportunities';

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
}

export interface ComprehensiveValidationReport {
  overallPassed: boolean;
  overallScore: number;
  blockingIssues: ValidationIssue[];
  warnings: ValidationIssue[];
  suggestions: ValidationIssue[];
  metrics: ValidationMetrics;
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
