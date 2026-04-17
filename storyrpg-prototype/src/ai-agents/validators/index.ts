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
