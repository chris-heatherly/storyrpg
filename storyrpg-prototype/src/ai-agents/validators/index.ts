/**
 * Validators Index
 *
 * Export all validator classes for best practices enforcement.
 */

export { ChoiceDensityValidator } from './ChoiceDensityValidator';
export type { BeatWithTiming, SceneWithTiming } from './ChoiceDensityValidator';

export { ChoiceDistributionValidator } from './ChoiceDistributionValidator';
export type { ChoiceDistributionTargets, ChoiceDistributionInput, ChoiceDistributionMetrics } from './ChoiceDistributionValidator';

export { NPCDepthValidator } from './NPCDepthValidator';

export { ConsequenceBudgetValidator } from './ConsequenceBudgetValidator';

export { StakesTriangleValidator } from './StakesTriangleValidator';

export { FiveFactorValidator } from './FiveFactorValidator';

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
