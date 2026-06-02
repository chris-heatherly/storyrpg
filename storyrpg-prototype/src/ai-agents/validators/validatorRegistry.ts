/**
 * Validator dispatch map (docs/PROJECT_AUDIT_2026-05-28.md, Track B4).
 *
 * The ~40 validators are dispatched from FOUR different call sites, so no single
 * place answered "which validators gate a story, at what stage, and do they
 * block?". This declarative manifest is that single auditable source.
 *
 * It is intentionally documentation-grade (a typed const + drift test), NOT a
 * live dispatcher — rewiring the four call sites to consume it is a separate,
 * behavior-sensitive refactor. Keep this in sync when adding/moving a validator;
 * the test in validatorRegistry.test.ts guards internal consistency.
 *
 * Tiers:
 *   - 'blocking'  : failure blocks the run regardless of validation mode.
 *   - 'advisory'  : recorded as a warning; only blocks in strict mode (or, for
 *                   architecture-stage craft checks, retried then degraded — B1).
 *   - 'autofix'   : mutates/repairs in place rather than gating.
 */

export type ValidatorStage =
  | 'season' // SeasonPlannerAgent.finalizePlan
  | 'architecture' // StoryArchitect.validateBlueprint (per-episode)
  | 'phase' // PhaseValidator across world/character/blueprint
  | 'quick' // IntegratedBestPracticesValidator.runQuickValidation (generation-time)
  | 'full' // IntegratedBestPracticesValidator.runFullValidation (QA-time)
  | 'diagnostic' // narrativeDiagnostics.runNarrativeDiagnostics
  | 'final'; // final story assembly gate

export type ValidatorTier = 'blocking' | 'advisory' | 'autofix';

export interface ValidatorRegistryEntry {
  validator: string;
  stage: ValidatorStage;
  tier: ValidatorTier;
  dispatchedFrom: string;
}

export const VALIDATOR_REGISTRY: ValidatorRegistryEntry[] = [
  // --- Season planning (SeasonPlannerAgent.finalizePlan) ---
  { validator: 'SevenPointCoverageValidator', stage: 'season', tier: 'advisory', dispatchedFrom: 'SeasonPlannerAgent' },
  { validator: 'ArcPressureArchitectureValidator', stage: 'season', tier: 'advisory', dispatchedFrom: 'SeasonPlannerAgent' },
  { validator: 'CharacterArchitectureValidator', stage: 'season', tier: 'advisory', dispatchedFrom: 'SeasonPlannerAgent' },
  { validator: 'SeasonPromiseValidator', stage: 'season', tier: 'advisory', dispatchedFrom: 'SeasonPlannerAgent' },
  { validator: 'InformationLedgerValidator', stage: 'season', tier: 'advisory', dispatchedFrom: 'SeasonPlannerAgent' },

  // --- Episode architecture (StoryArchitect.validateBlueprint) — B1 tiering ---
  { validator: 'TreatmentFidelityValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'DramaticStructureValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'ThemePressureValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'SceneTurnContractValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'EpisodePressureArchitectureValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },

  // --- Phase gates (PhaseValidator) ---
  { validator: 'PhaseValidator', stage: 'phase', tier: 'advisory', dispatchedFrom: 'FullStoryPipeline' },

  // --- Quick validation (IntegratedBestPracticesValidator.runQuickValidation) ---
  { validator: 'NPCDepthValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'ChoiceImpactValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'MechanicalStorytellingValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'StatCheckBalanceValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'StakesTriangleValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'FiveFactorValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'ChoiceDensityValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'ChoiceDistributionValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'ConsequenceBudgetValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'CallbackOpportunitiesValidator', stage: 'quick', tier: 'autofix', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'MechanicsLeakageValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },

  // --- Full validation (IntegratedBestPracticesValidator.runFullValidation adds these) ---
  { validator: 'SkillCoverageValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'SkillSurfaceValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'BranchMechanicalDivergenceValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'PixarPrinciplesValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'CliffhangerValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator / FullStoryPipeline' },

  // --- Narrative diagnostics (narrativeDiagnostics.runNarrativeDiagnostics) ---
  { validator: 'SetupPayoffValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'TwistQualityValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'ArcDeltaValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'DivergenceValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'CallbackCoverageValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'NarrativeFailureModeValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },

  // --- Final assembly gate ---
  { validator: 'StructuralValidator', stage: 'final', tier: 'autofix', dispatchedFrom: 'FullStoryPipeline' },
  { validator: 'MicroEpisodeSeasonValidator', stage: 'final', tier: 'advisory', dispatchedFrom: 'FullStoryPipeline' },
  { validator: 'FinalStoryContractValidator', stage: 'final', tier: 'blocking', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'EncounterQualityValidator', stage: 'final', tier: 'blocking', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
];

/** Validators that hard-block a run regardless of validation mode. */
export function blockingValidators(): string[] {
  return VALIDATOR_REGISTRY.filter((e) => e.tier === 'blocking').map((e) => e.validator);
}
