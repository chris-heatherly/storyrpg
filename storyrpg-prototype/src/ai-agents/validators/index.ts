/**
 * Validators Index
 *
 * Export all validator classes for best practices enforcement.
 */

export { ChoiceDensityValidator } from './ChoiceDensityValidator';
export type { BeatWithTiming, SceneWithTiming } from './ChoiceDensityValidator';

export { ChoiceDistributionValidator } from './ChoiceDistributionValidator';
export type { ChoiceDistributionTargets, ChoiceDistributionInput, ChoiceDistributionMetrics } from './ChoiceDistributionValidator';
export { SceneGraphBranchValidator } from './SceneGraphBranchValidator';
export type {
  SceneGraphBranchIssue,
  SceneGraphBranchMetrics,
  SceneGraphBranchValidationOptions,
  SceneGraphBranchValidationResult,
} from './SceneGraphBranchValidator';

export { NPCDepthValidator } from './NPCDepthValidator';

export { ConsequenceBudgetValidator } from './ConsequenceBudgetValidator';

export { StakesTriangleValidator } from './StakesTriangleValidator';

export { FiveFactorValidator } from './FiveFactorValidator';
export { ChoiceImpactValidator } from './ChoiceImpactValidator';
export type { ChoiceImpactInput, ChoiceImpactMetrics, ChoiceImpactResult } from './ChoiceImpactValidator';
export { MechanicalStorytellingValidator } from './MechanicalStorytellingValidator';
export type {
  MechanicalStorytellingInput,
  MechanicalStorytellingMetrics,
  MechanicalStorytellingResult,
} from './MechanicalStorytellingValidator';
export { TreatmentFidelityValidator } from './TreatmentFidelityValidator';
export type {
  TreatmentFidelityValidationInput,
  TreatmentFidelityValidationResult,
  TreatmentFinalStoryValidationInput,
} from './TreatmentFidelityValidator';
export { MechanicsLeakageValidator } from './MechanicsLeakageValidator';
export type {
  MechanicsLeakageInput,
  MechanicsLeakageResult,
  MechanicsLeakageText,
} from './MechanicsLeakageValidator';
export { StatCheckBalanceValidator } from './StatCheckBalanceValidator';
export type { StatCheckBalanceChoice, StatCheckBalanceInput, StatCheckBalanceResult } from './StatCheckBalanceValidator';
export { SkillSurfaceValidator } from './SkillSurfaceValidator';
export type { SkillSurfaceInput, SkillSurfaceResult, SkillSurfaceScene } from './SkillSurfaceValidator';
export { SkillCoverageValidator } from './SkillCoverageValidator';
export type { SkillCoverageInput, SkillCoverageResult } from './SkillCoverageValidator';
export { BranchMechanicalDivergenceValidator } from './BranchMechanicalDivergenceValidator';
export type {
  BranchMechanicalDivergenceInput,
  BranchMechanicalDivergenceResult,
  BranchMechanicalScene,
} from './BranchMechanicalDivergenceValidator';

export { CallbackOpportunitiesValidator } from './CallbackOpportunitiesValidator';
export {
  runNarrativeDiagnostics,
  type NarrativeDiagnosticCheck,
  type NarrativeDiagnosticIssue,
  type NarrativeDiagnosticsInput,
  type NarrativeDiagnosticsReport,
  type NarrativeDiagnosticStatus,
} from './narrativeDiagnostics';

export { IntegratedBestPracticesValidator } from './IntegratedBestPracticesValidator';
export type { ValidationInput } from './IntegratedBestPracticesValidator';

// Base validator class for extending
export { BaseValidator } from './BaseValidator';
export type { ValidationIssue, ValidationResult } from './BaseValidator';

// Structural validator (story-shape integrity + auto-fix)
export { StructuralValidator } from './StructuralValidator';
export type { StructuralIssue, StructuralReport } from './StructuralValidator';

// Future validators (available but not yet integrated into pipeline)
// TODO: Integrate these validators when multi-episode/season generation is enabled
export { SeasonValidator } from './SeasonValidator';
export { CliffhangerValidator } from './CliffhangerValidator';
export { PhaseValidator } from './PhaseValidator';
export { PixarPrinciplesValidator } from './PixarPrinciplesValidator';

// Setup/payoff + twist + arc + divergence validators (Phases 5–8)
export { SetupPayoffValidator } from './SetupPayoffValidator';
export type { SetupPayoffInput, SetupPayoffMetrics, SetupPayoffResult } from './SetupPayoffValidator';
export { TwistQualityValidator } from './TwistQualityValidator';
export type { TwistQualityInput, TwistQualityMetrics, TwistQualityResult } from './TwistQualityValidator';
export { ArcDeltaValidator } from './ArcDeltaValidator';
export type { ArcDeltaInput, ArcDeltaMetrics, ArcDeltaResult } from './ArcDeltaValidator';
export { DivergenceValidator } from './DivergenceValidator';
export type { DivergenceInput, DivergenceMetrics, DivergenceResult } from './DivergenceValidator';
export {
  SevenPointCoverageValidator,
  seasonPlanToCoverageInput,
} from './SevenPointCoverageValidator';
export type { SevenPointCoverageInput } from './SevenPointCoverageValidator';
export { simulateEpisodePaths } from './pathSimulator';
export type { TerminalState, PathSimulationResult, SimulatorOptions } from './pathSimulator';

// Incremental validators (per-scene validation during content generation)
export {
  IncrementalValidationRunner,
  IncrementalVoiceValidator,
  IncrementalStakesValidator,
  IncrementalSensitivityChecker,
  IncrementalContinuityChecker,
  IncrementalEncounterValidator,
  formatValidationResult,
  aggregateValidationResults,
  DEFAULT_INCREMENTAL_CONFIG,
} from './IncrementalValidators';
export { PovClarityValidator, hasPlayerReference } from './PovClarityValidator';
export { SceneCraftValidator } from './SceneCraftValidator';
export { auditSequencePlanSpecificity } from './sequencePlanSpecificityAudit';
export type {
  SequencePlanSpecificityIssue,
  SequencePlanSpecificityResult,
} from './sequencePlanSpecificityAudit';
export type {
  IncrementalValidationConfig,
  SceneValidationResult,
  IncrementalVoiceResult,
  IncrementalStakesResult,
  IncrementalSensitivityResult,
  IncrementalContinuityResult,
  IncrementalEncounterResult,
  CharacterVoiceProfile,
} from './IncrementalValidators';
export type { PovClarityIssue, PovClarityResult, PovClarityContext } from './PovClarityValidator';
export type { SceneCraftOptions, SceneCraftResult } from './SceneCraftValidator';
