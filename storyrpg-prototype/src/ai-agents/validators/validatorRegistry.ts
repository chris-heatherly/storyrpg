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

import type { ArtifactKind } from '../pipeline/artifacts/types';
import { GATE_REGISTRY, type GatePlacement } from '../remediation/gateRegistry';

export type ValidatorStage =
  | 'season' // SeasonPlannerAgent.finalizePlan
  | 'architecture' // StoryArchitect.validateBlueprint (per-episode)
  | 'phase' // PhaseValidator across world/character/blueprint
  | 'quick' // IntegratedBestPracticesValidator.runQuickValidation (generation-time)
  | 'full' // IntegratedBestPracticesValidator.runFullValidation (QA-time)
  | 'diagnostic' // narrativeDiagnostics.runNarrativeDiagnostics
  | 'artifact-contract' // artifact evidence contract checks
  | 'final'; // final story assembly gate

export type ValidatorTier = 'blocking' | 'advisory' | 'autofix';

export type ValidatorLifecycle =
  | 'source-analysis'
  | 'season-plan'
  | 'episode-architecture'
  | 'phase-validation'
  | 'quick-validation'
  | 'full-qa'
  | 'narrative-diagnostics'
  | 'plan-fidelity'
  | 'episode-contract'
  | 'artifact-contract'
  | 'final-contract'
  | 'artifact-package';

export type ValidatorExecutionRole =
  | 'primary'
  | 'regression-net'
  | 'shadow'
  | 'repair-router'
  | 'aggregate'
  | 'artifact-only';

/**
 * Where a failed validator's repair lands (S1 gating plan). 'plan-time' fixes the
 * season/episode plan before generation; 'regen-*' re-runs a bounded scope;
 * 'autofix' mutates in place; 'none' means there is no automated remedy (hard gate).
 */
export type ValidatorRemediation =
  | 'autofix'
  | 'regen-scene'
  | 'regen-choices'
  | 'regen-encounter'
  | 'regen-episode'
  | 'plan-time'
  | 'none';

export type ValidatorMemoryEvidenceMode =
  | 'none'
  | 'advisory-memory'
  | 'corroborated-evidence'
  | 'artifact-required';

export interface ValidatorRegistryEntry {
  validator: string;
  stage: ValidatorStage;
  tier: ValidatorTier;
  dispatchedFrom: string;
  /** How a failure of this validator is repaired when remediation is wired up (S1). */
  remediation?: ValidatorRemediation;
  /** Rollout flag gating the remediation path; absent ⇒ not behind a flag. */
  rolloutFlag?: string;
  /** Max remediation attempts before the failure is surfaced/escalated. */
  maxRemediationAttempts?: number;
  /** Canonical lifecycle owner. Defaults from `stage` for legacy entries. */
  lifecycle?: ValidatorLifecycle;
  /** Execution role at the owning lifecycle. Defaults to `primary`. */
  role?: ValidatorExecutionRole;
  /** Runtime gate placement, checked against `GATE_REGISTRY` when rolloutFlag exists. */
  gatePlacement?: GatePlacement;
  /** Artifact contracts this validator contributes to. */
  artifactKinds?: ArtifactKind[];
  /** Blocking entries should have repair coverage unless explicitly allowlisted. */
  repairRequiredForBlocking?: boolean;
  /** Written exception for legacy hard gates that intentionally lack repair. */
  allowBlockingWithoutRepair?: string;
  /**
   * Whether orchestration may attach Cognee-derived context for audit/repair
   * guidance. Validators still decide from current typed artifacts and policy.
   */
  memoryEvidenceMode?: ValidatorMemoryEvidenceMode;
}

export interface ArtifactValidatorOwnershipEntry {
  validator: string;
  artifactKinds: ArtifactKind[];
  role: Extract<ValidatorExecutionRole, 'artifact-only' | 'primary' | 'regression-net'>;
}

export type ArtifactGateTier = 'blocking' | 'advisory';

export interface ArtifactContractEntry {
  id: string;
  artifactKind: ArtifactKind;
  /**
   * Artifact gate tier describes the contract applied when artifact validation is
   * executed. It is independent from ValidatorRegistryEntry.tier; advisory
   * runtime validators can still provide evidence for a blocking artifact
   * contract without changing runtime enforcement.
   */
  tier: ArtifactGateTier;
  contract: string;
}

export interface ArtifactGateDefinition extends ArtifactContractEntry {
  validators: string[];
}

export const VALIDATOR_REGISTRY: ValidatorRegistryEntry[] = [
  // --- Season planning (SeasonPlannerAgent.finalizePlan) ---
  // Story Circle spine GATE (tier 1, blocking): SeasonPlanner.execute throws when the
  // eight-beat Story Circle spine is incomplete, out of canonical order, or non-contiguous.
  // Tier 2 — each episode blueprint must fill all eight episodeCircle beats and bind
  // them to scenes — is EpisodeStoryCircleValidator inside StoryArchitect.
  { validator: 'StoryCircleCoverageValidator', stage: 'season', tier: 'blocking', dispatchedFrom: 'SeasonPlannerAgent (execute)' },
  { validator: 'ArcPressureArchitectureValidator', stage: 'season', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_ARC_PRESSURE', dispatchedFrom: 'SeasonPlannerAgent' },
  { validator: 'CharacterArchitectureValidator', stage: 'season', tier: 'advisory', dispatchedFrom: 'SeasonPlannerAgent' },
  { validator: 'SeasonPromiseValidator', stage: 'season', tier: 'advisory', dispatchedFrom: 'SeasonPlannerAgent' },
  { validator: 'InformationLedgerValidator', stage: 'season', tier: 'advisory', dispatchedFrom: 'SeasonPlannerAgent' },

  // --- Episode architecture (StoryArchitect.validateBlueprint) — B1 tiering ---
  { validator: 'TreatmentFidelityValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'DramaticStructureValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'ThemePressureValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'SceneTurnContractValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'EpisodePressureArchitectureValidator', stage: 'architecture', tier: 'advisory', dispatchedFrom: 'StoryArchitect' },
  { validator: 'EpisodeStoryCircleValidator', stage: 'architecture', tier: 'blocking', remediation: 'plan-time', dispatchedFrom: 'StoryArchitect.validateBlueprint' },
  // Scene-construction preflight: each scene owns one primary turn and one owner per
  // route event before prose. Blocking (regenerate) behind GATE_SCENE_CONSTRUCTION_PREFLIGHT;
  // detection (profiles + SceneOwnershipPreflightValidator) always runs and is saved to
  // the construction report.
  { validator: 'SceneOwnershipPreflightValidator', stage: 'architecture', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_SCENE_CONSTRUCTION_PREFLIGHT', dispatchedFrom: 'StoryArchitect / ContentGenerationPhase (SceneConstructionGate)' },

  // --- Phase gates (PhaseValidator) ---
  { validator: 'PhaseValidator', stage: 'phase', tier: 'advisory', dispatchedFrom: 'FullStoryPipeline' },

  // --- Quick validation (IntegratedBestPracticesValidator.runQuickValidation) ---
  // tier stays 'advisory' (not 'blocking'): runtime enforcement is a guaranteed
  // deterministic autofix in applyCraftAutofix, not a hard throw.
  { validator: 'NPCDepthValidator', stage: 'quick', tier: 'advisory', remediation: 'autofix', rolloutFlag: 'GATE_NPC_DEPTH', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'ChoiceImpactValidator', stage: 'quick', tier: 'advisory', remediation: 'autofix', rolloutFlag: 'GATE_CHOICE_IMPACT', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'MechanicalStorytellingValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  // tier stays 'advisory' (not 'blocking'): enforced via guaranteed autofix.
  { validator: 'StatCheckBalanceValidator', stage: 'quick', tier: 'advisory', remediation: 'autofix', rolloutFlag: 'GATE_STAT_CHECK_BALANCE', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  // Bucket C judge-stabilization: ChoiceAuthor.validateChoiceQuality runs this LLM
  // judge and, on a sub-threshold overall score, regenerates the choice set via
  // executeRevision (regen-choices). The score boundary is hysteresis-stabilized
  // behind GATE_JUDGE_STABILIZATION so a borderline draw degrades to advisory
  // (uses the original choices) instead of triggering a noisy revision.
  { validator: 'StakesTriangleValidator', stage: 'quick', tier: 'advisory', remediation: 'regen-choices', rolloutFlag: 'GATE_JUDGE_STABILIZATION', dispatchedFrom: 'IntegratedBestPracticesValidator / ChoiceAuthor' },
  // FiveFactorValidator is a pure diagnostic for Bucket C: its quick-val and
  // ChoiceAuthor paths gate on binary error-level issues (0 factors / no
  // consequences), not a numeric judge score, so hysteresis is a no-op here.
  { validator: 'FiveFactorValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'ChoiceDensityValidator', stage: 'quick', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_CHOICE_DENSITY', dispatchedFrom: 'IntegratedBestPracticesValidator / FullStoryPipeline' },
  { validator: 'ChoiceDistributionValidator', stage: 'quick', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_CHOICE_DISTRIBUTION', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'ConsequenceBudgetValidator', stage: 'quick', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_CONSEQUENCE_BUDGET', dispatchedFrom: 'IntegratedBestPracticesValidator / FullStoryPipeline' },
  { validator: 'CallbackOpportunitiesValidator', stage: 'quick', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator / FinalStoryContractValidator (opportunity heuristics only)' },
  // tier stays 'advisory' (not 'blocking'): the safe isolated-token class is
  // enforced via autofix; in-prose leaks defer to B1 regen.
  { validator: 'MechanicsLeakageValidator', stage: 'quick', tier: 'advisory', remediation: 'autofix', rolloutFlag: 'GATE_MECHANICS_LEAKAGE', dispatchedFrom: 'IntegratedBestPracticesValidator' },

  // --- Full validation (IntegratedBestPracticesValidator.runFullValidation adds these) ---
  { validator: 'SkillCoverageValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'SkillSurfaceValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'BranchMechanicalDivergenceValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'PixarPrinciplesValidator', stage: 'full', tier: 'advisory', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  // Cliffhanger soft-gate (Bucket C): FullStoryPipeline.repairWeakCliffhangerBeforeImages
  // rewrites the weak final beat via improveCliffhanger (regen-scene). The repair
  // is non-blocking; GATE_CLIFFHANGER hysteresis-stabilizes the score boundary so a
  // borderline draw degrades to advisory (keep original beat) instead of triggering
  // a noisy LLM repair. Default-off keeps the prior < 'good' repair behavior.
  { validator: 'CliffhangerValidator', stage: 'full', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_CLIFFHANGER', dispatchedFrom: 'IntegratedBestPracticesValidator / FullStoryPipeline' },

  // --- Narrative diagnostics (narrativeDiagnostics.runNarrativeDiagnostics) ---
  { validator: 'SetupPayoffValidator', stage: 'diagnostic', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_SETUP_PAYOFF', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'TwistQualityValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  // tier stays 'advisory' (not 'blocking'): enforced via guaranteed autofix.
  { validator: 'ArcDeltaValidator', stage: 'diagnostic', tier: 'advisory', remediation: 'autofix', rolloutFlag: 'GATE_ARC_DELTA', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'DivergenceValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'CallbackCoverageValidator', stage: 'diagnostic', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_CALLBACK_COVERAGE', dispatchedFrom: 'narrativeDiagnostics (CallbackLedger hygiene)' },
  { validator: 'NarrativeFailureModeValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  // E5 / #26C / D4 — advisory diagnostics added 2026-06.
  { validator: 'IntensityDistributionValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  // PARTIAL gate (cast-reference subset; see propIntroductionGate.ts SCOPE NOTE):
  // the all-scenes seam in FullStoryPipeline hard-blocks on error-severity
  // unresolved references when GATE_PROP_INTRODUCTION=1. Default-off, advisory.
  { validator: 'PropIntroductionValidator', stage: 'diagnostic', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_PROP_INTRODUCTION', dispatchedFrom: 'narrativeDiagnostics / FullStoryPipeline' },
  { validator: 'ChoiceCoverageValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },

  // --- Final assembly gate ---
  { validator: 'StructuralValidator', stage: 'final', tier: 'autofix', dispatchedFrom: 'FullStoryPipeline' },
  { validator: 'FinalStoryContractValidator', stage: 'final', tier: 'blocking', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'ResidueObligationValidator', stage: 'final', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_RESIDUE_CONSUME', dispatchedFrom: 'FinalStoryContractValidator (planned residue source of truth)' },
  { validator: 'EncounterQualityValidator', stage: 'final', tier: 'blocking', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  // Season Canon (P2) — state-scoped promise gate. Fires only when a promise is
  // due/dangling/invalid for the episode being sealed (never a blanket alarm).
  // Wired into the per-episode seal by the incremental runner (P4).
  { validator: 'PromiseLedgerValidators', stage: 'final', tier: 'blocking', dispatchedFrom: 'FullStoryPipeline (episode seal, P4)' },
  // Season Canon (P3) — knowledge-state / impossible-knowledge gate. Checks the
  // episode's structured knowledge claims against the frozen canon's
  // who-knows-what-when ledger. Wired into the per-episode seal by the runner (P4).
  { validator: 'CanonConsistencyValidator', stage: 'final', tier: 'blocking', dispatchedFrom: 'FullStoryPipeline (episode seal, P4)' },
  // --- Per-issue-class escalation (issueEscalation.ts) ---
  // Two correctness classes that ship as advisory warnings by default can be
  // promoted to hard blockers via their rollout flag, WITHOUT making every
  // best-practices finding blocking. Default-off ⇒ behavior unchanged.
  // (a) Design-note / meta-narration leak: GATE_DESIGN_NOTE_LEAK also turns on the
  //     MechanicsLeakageValidator design-note scan; flagged prose then blocks the
  //     final contract (remediation = SceneWriter regen of the leaking beat).
  { validator: 'MechanicsLeakageValidator (design-note class)', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_DESIGN_NOTE_LEAK', dispatchedFrom: 'IntegratedBestPracticesValidator / FinalStoryContractValidator' },
  // (b) Witness-id integrity: unknown-NPC witness references (already errors from
  //     MechanicalStorytellingValidator) become blocking instead of downgraded.
  { validator: 'MechanicalStorytellingValidator (witness-id class)', stage: 'final', tier: 'blocking', remediation: 'regen-choices', rolloutFlag: 'GATE_WITNESS_ID_INTEGRITY', dispatchedFrom: 'IntegratedBestPracticesValidator / FinalStoryContractValidator' },

  // --- Treatment-fidelity guardrails (Remediation §4.1–§4.5) ---
  // The five NEW validators that assert the generated story is a faithful EXPANSION
  // of the authored treatment (episode identity, encounter-anchor content, INFO
  // schedule, signature devices, Story Circle anchoring) rather than a re-cut. All are
  // tiered 'blocking' (§4 calls them blocking) but ship DEFAULT-OFF behind a per-rule
  // rollout flag (treatmentFidelityGate.ts); with every flag unset they never gate.
  // §4.6: when the source is an authored treatment, FinalStoryContractValidator does
  // NOT downgrade these findings to warnings (validateFidelityFindings).
  // WS1 (2026-06-12): primary dispatch relocated to PLAN placement (fail-fast
  // before generation via runPlanTimeFidelityChecks); the final dispatch
  // remains as a regression net for mid-run plan drift.
  { validator: 'AuthoredEpisodeConformanceValidator', stage: 'final', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_AUTHORED_EPISODE_CONFORMANCE', dispatchedFrom: 'FullStoryPipeline (runPlanTimeFidelityChecks pre-generation; enforceFinalStoryContract as net)' },
  { validator: 'EncounterAnchorContentValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_ENCOUNTER_ANCHOR_CONTENT', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'InformationLedgerScheduleValidator', stage: 'final', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_INFORMATION_LEDGER_SCHEDULE', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'SignatureDevicePresenceValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_SIGNATURE_DEVICE_PRESENCE', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'StoryCircleAnchorConformanceValidator', stage: 'final', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_STORY_CIRCLE_ANCHOR_CONFORMANCE', dispatchedFrom: 'FullStoryPipeline (runPlanTimeFidelityChecks pre-generation; enforceFinalStoryContract as net)' },

  // --- Gen-4 audit follow-ups (default-off; the metric is always recorded) ---
  { validator: 'SceneGraphBranchValidator', stage: 'final', tier: 'advisory', remediation: 'regen-choices', dispatchedFrom: 'FullStoryPipeline (validateSceneGraphBranching)' },
  // Dead-branch: a planned multi-target branch point whose choices collapsed to a
  // single target (assembled linear). GATE_BRANCH_FANOUT promotes it to an error.
  { validator: 'SceneGraphBranchValidator (branch-fan-out class)', stage: 'final', tier: 'blocking', remediation: 'regen-choices', rolloutFlag: 'GATE_BRANCH_FANOUT', dispatchedFrom: 'FullStoryPipeline (validateSceneGraphBranching)' },
  // Duplicate establishing-beat: two scenes on a linear path both staged as a first
  // entry into the same location (dual-first-entry). Surfaced to the continuity pass.
  { validator: 'DuplicateEstablishingBeatValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_DUPLICATE_ESTABLISHING_BEAT', dispatchedFrom: 'FullStoryPipeline (continuity check)' },
  // Treatment-seed on-page presence: each declared treatment_seed_* must be set via a
  // setFlag consequence on some choice in its episode (presence-only, deterministic).
  { validator: 'TreatmentSeedOnPageValidator', stage: 'final', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_TREATMENT_SEED_ONPAGE', dispatchedFrom: 'FullStoryPipeline (episode validation)' },
  // Ending reachability: each declared ending-axis (treatment_branch_*) must be set via a
  // setFlag consequence on some choice in its episode, so the named ending it drives is
  // mechanically reachable (presence-only, deterministic).
  { validator: 'EndingReachabilityValidator', stage: 'final', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_ENDING_REACHABILITY', dispatchedFrom: 'FullStoryPipeline (episode validation)' },
  // Protagonist pronoun integrity: the resolver ALWAYS repairs safe wrong-gender cases
  // in place at the final contract; GATE_PROTAGONIST_PRONOUN promotes ambiguous residue
  // to a blocking issue routed to scene/encounter regen.
  { validator: 'protagonistPronounResolver (ambiguous-residue class)', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_PROTAGONIST_PRONOUN', dispatchedFrom: 'FinalStoryContractValidator' },
  // Encounter-outcome state: flags are always seeded; this flags a reconvergence scene
  // that ignores the outcome (no outcome-conditioned variant) for regen.
  { validator: 'encounterOutcomeFlags (reconvergence-desync class)', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_ENCOUNTER_OUTCOME_VARIANT', dispatchedFrom: 'FinalStoryContractValidator' },
  // Continuity remediation: promote cross-scene continuity ERRORS from the advisory QA
  // report to blocking so the final-contract repair loop engages.
  { validator: 'ContinuityChecker (cross-scene error class)', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_CONTINUITY_REMEDIATION', dispatchedFrom: 'FinalStoryContractValidator' },

  // --- 2026-06-09 storytelling-quality audit (time/place + character-introduction) ---
  // Unacknowledged time/place jump between adjacent scenes: planned Scene.timeline
  // changed but the arriving scene has no transitionIn / transition prose. Backstop for
  // the plan-time timeline + SceneWriter/EncounterArchitect transition-handoff fix.
  { validator: 'SceneTransitionContinuityValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_SCENE_TRANSITION_CONTINUITY', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Scene turn realization: generated scenes must orbit one central dramatic turn
  // and show before-state -> turn event -> aftermath/handoff instead of checking off
  // outline moments as isolated mentions.
  { validator: 'SceneTurnRealizationValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_SCENE_TURN_REALIZATION', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  { validator: 'SceneTurnRealizationValidator (episode Story Circle structural class)', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_EPISODE_STORY_CIRCLE_REALIZATION', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Relationship pacing: generated prose may show instant chemistry, but earned
  // labels like friend/trusted ally/inner circle must match scene history and
  // relationship mechanics.
  { validator: 'RelationshipPacingValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_RELATIONSHIP_PACING', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Spatial unit enforcement: major named locations are full scene units. A scene
  // may hand off to the next place, but it cannot conduct introductions, choices,
  // encounters, reveals, or relationship turns in two major locations at once.
  { validator: 'SceneSpatialUnitValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_SCENE_SPATIAL_UNIT', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Deterministic relationship arc ledger: relationship stages, private contact,
  // group membership, and high-stage labels must be earned by full scenes,
  // relationship choices, stat movement, and evidence tags.
  { validator: 'RelationshipArcLedgerValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_RELATIONSHIP_ARC_LEDGER', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // McKee thematic-square relationship turns: relationshipValueEvidence must
  // match deterministic Love/Indifference/Hate/Control rungs and allowed surfaces.
  { validator: 'ThematicSquareTurnValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_THEMATIC_SQUARE_TURN', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Narrative mechanic pressure: hidden flags/scores/skills/items/routes/relationships
  // must originate in visible story evidence, leave residue, and be spent as earned
  // narrative permission.
  { validator: 'NarrativeMechanicPressureValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_NARRATIVE_MECHANIC_PRESSURE', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Sustained set pieces must preserve escalating encounter structure instead of
  // collapsing to one decision plus summary.
  { validator: 'EncounterSetPieceDepthValidator', stage: 'final', tier: 'blocking', remediation: 'regen-encounter', rolloutFlag: 'GATE_ENCOUNTER_SETPIECE_DEPTH', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Standard-scene required beats must be dramatized on-page, not merely present
  // in scene-plan metadata.
  { validator: 'RequiredBeatRealizationValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_REQUIRED_BEAT_REALIZATION', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Treatment field utilization: every parsed authored treatment field must be
  // consumed into a plan artifact and realized on-page as story pressure,
  // encounter content, choice pressure, information movement, consequence
  // residue, ending turnout, or cliffhanger pressure.
  { validator: 'TreatmentFieldUtilizationValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_TREATMENT_FIELD_UTILIZATION', dispatchedFrom: 'FullStoryPipeline (runPlanTimeFidelityChecks pre-generation; enforceFinalStoryContract via runFidelityValidators)' },
  // Season promise realization: top-level treatment promises must become
  // visible scenes, choices, encounters, information movement, consequence
  // pressure, tonal progression, and changed state rather than metadata-only
  // guidance.
  { validator: 'SeasonPromiseRealizationValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_SEASON_PROMISE_REALIZATION', dispatchedFrom: 'FullStoryPipeline (runPlanTimeFidelityChecks pre-generation; enforceFinalStoryContract via runFidelityValidators)' },
  // Character treatment realization: authored protagonist fields must become
  // concrete character-bible, scene-turn, choice, mechanic-pressure, visual, and
  // ending-route obligations, then show up fiction-first on-page.
  { validator: 'CharacterTreatmentRealizationValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_CHARACTER_TREATMENT_REALIZATION', dispatchedFrom: 'FullStoryPipeline (runPlanTimeFidelityChecks pre-generation; enforceFinalStoryContract via runFidelityValidators)' },
  // Failure-mode audit realization: authored Section 15 avoided/watch-item claims
  // are treated as QA contracts and routed through concrete setup/payoff, agency,
  // causality, state-change, fair-play reveal, and theme-rhyme surfaces.
  { validator: 'NarrativeFailureModeValidator (failure-mode-audit contracts)', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_FAILURE_MODE_AUDIT_REALIZATION', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Characters without on-page introduction: cold prose name-drops before any cast
  // presence, and cast-in-metadata-only NPCs the prose never names. Backstop for the
  // first-appearance directive / notYetIntroducedNames ban-list / introduction key beats.
  { validator: 'CharacterIntroductionValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_CHARACTER_INTRODUCTION', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
];

/** Validators that hard-block a run regardless of validation mode. */
export function blockingValidators(): string[] {
  return VALIDATOR_REGISTRY.filter((e) => e.tier === 'blocking').map((e) => e.validator);
}

/** Remediation route declared for a validator (by name), or undefined if none/unknown. */
export function remediationRoute(validator: string): ValidatorRemediation | undefined {
  return VALIDATOR_REGISTRY.find((e) => e.validator === validator)?.remediation;
}

export function memoryEvidenceModeForValidator(validator: string): ValidatorMemoryEvidenceMode {
  const entry = VALIDATOR_REGISTRY.find((e) => e.validator === validator);
  if (entry?.memoryEvidenceMode) return entry.memoryEvidenceMode;
  if (!entry) return 'advisory-memory';
  if (entry.stage === 'final' && entry.tier === 'blocking') return 'corroborated-evidence';
  if (entry.stage === 'artifact-contract') return 'artifact-required';
  return 'advisory-memory';
}

export const ARTIFACT_VALIDATOR_OWNERSHIP: ArtifactValidatorOwnershipEntry[] = [
  { validator: 'AuthoredEpisodeConformanceValidator', artifactKinds: ['source-analysis'], role: 'primary' },
  { validator: 'StoryCircleAnchorConformanceValidator', artifactKinds: ['source-analysis'], role: 'primary' },
  { validator: 'TreatmentFidelityValidator', artifactKinds: ['source-analysis'], role: 'primary' },
  { validator: 'quoteRecallValidator', artifactKinds: ['source-analysis'], role: 'artifact-only' },
  { validator: 'SignatureDevicePresenceValidator', artifactKinds: ['source-analysis'], role: 'primary' },

  { validator: 'StoryCircleCoverageValidator', artifactKinds: ['season-plan'], role: 'primary' },
  { validator: 'SeasonPromiseValidator', artifactKinds: ['season-plan'], role: 'primary' },
  { validator: 'SeasonBudgetValidator', artifactKinds: ['season-plan'], role: 'artifact-only' },
  { validator: 'ArcPressureArchitectureValidator', artifactKinds: ['season-plan'], role: 'primary' },
  { validator: 'InformationLedgerScheduleValidator', artifactKinds: ['season-plan'], role: 'primary' },
  { validator: 'ConsequenceBudgetValidator', artifactKinds: ['season-plan'], role: 'primary' },

  { validator: 'CharacterArchitectureValidator', artifactKinds: ['character-bible'], role: 'primary' },
  { validator: 'NPCDepthValidator', artifactKinds: ['character-bible'], role: 'primary' },
  { validator: 'CharacterIntroductionValidator', artifactKinds: ['character-bible'], role: 'primary' },

  { validator: 'ArcDeltaValidator', artifactKinds: ['character-arc-plan'], role: 'primary' },
  { validator: 'CharacterArcTracker', artifactKinds: ['character-arc-plan'], role: 'artifact-only' },

  { validator: 'NPCDepthValidator', artifactKinds: ['npc-payoff-ledger'], role: 'primary' },
  { validator: 'ReferencedEventPresenceValidator', artifactKinds: ['npc-payoff-ledger'], role: 'artifact-only' },
  { validator: 'SetupPayoffValidator', artifactKinds: ['npc-payoff-ledger'], role: 'primary' },

  { validator: 'SetupPayoffValidator', artifactKinds: ['thread-ledger'], role: 'primary' },
  { validator: 'CallbackCoverageValidator', artifactKinds: ['thread-ledger'], role: 'primary' },
  { validator: 'CallbackOpportunitiesValidator', artifactKinds: ['thread-ledger'], role: 'primary' },

  { validator: 'InformationLedgerValidator', artifactKinds: ['information-ledger'], role: 'primary' },
  { validator: 'InformationLedgerScheduleValidator', artifactKinds: ['information-ledger'], role: 'primary' },

  { validator: 'DramaticStructureValidator', artifactKinds: ['episode-blueprint'], role: 'primary' },
  { validator: 'EpisodePressureArchitectureValidator', artifactKinds: ['episode-blueprint'], role: 'primary' },
  { validator: 'EpisodeStoryCircleValidator', artifactKinds: ['episode-blueprint'], role: 'primary' },
  { validator: 'RequiredBeatRealizationValidator', artifactKinds: ['episode-blueprint'], role: 'artifact-only' },
  { validator: 'EncounterAnchorContentValidator', artifactKinds: ['episode-blueprint'], role: 'primary' },
  { validator: 'TreatmentFidelityValidator', artifactKinds: ['episode-blueprint'], role: 'primary' },

  { validator: 'SceneGraphBranchValidator', artifactKinds: ['scene-plan'], role: 'primary' },
  { validator: 'SceneTurnContractValidator', artifactKinds: ['scene-plan'], role: 'primary' },
  { validator: 'EpisodeStoryCircleValidator', artifactKinds: ['scene-plan'], role: 'primary' },
  { validator: 'SceneTurnRealizationValidator (episode Story Circle structural class)', artifactKinds: ['scene-plan'], role: 'regression-net' },
  { validator: 'SceneSpineValidator', artifactKinds: ['scene-plan'], role: 'artifact-only' },
  { validator: 'SceneTransitionContinuityValidator', artifactKinds: ['scene-plan'], role: 'primary' },
  { validator: 'ArcPressureArchitectureValidator', artifactKinds: ['scene-plan'], role: 'primary' },
  { validator: 'TreatmentSeedOnPageValidator', artifactKinds: ['scene-plan'], role: 'primary' },

  { validator: 'DivergenceValidator', artifactKinds: ['branch-plan'], role: 'primary' },
  { validator: 'BranchMechanicalDivergenceValidator', artifactKinds: ['branch-plan'], role: 'primary' },
  { validator: 'SceneGraphBranchValidator', artifactKinds: ['branch-plan'], role: 'primary' },
  { validator: 'ConvergenceLedgerValidator', artifactKinds: ['branch-plan'], role: 'artifact-only' },
  { validator: 'EndingReachabilityValidator', artifactKinds: ['branch-plan'], role: 'primary' },

  { validator: 'ChoiceDensityValidator', artifactKinds: ['choice-consequence-plan'], role: 'primary' },
  { validator: 'ChoiceDistributionValidator', artifactKinds: ['choice-consequence-plan'], role: 'primary' },
  { validator: 'ChoiceImpactValidator', artifactKinds: ['choice-consequence-plan'], role: 'primary' },
  { validator: 'ChoiceTypePlanConformanceValidator', artifactKinds: ['choice-consequence-plan'], role: 'artifact-only' },
  { validator: 'ConsequenceBudgetValidator', artifactKinds: ['choice-consequence-plan'], role: 'primary' },
  { validator: 'FlagContractValidator', artifactKinds: ['choice-consequence-plan'], role: 'artifact-only' },
  { validator: 'SkillSurfaceValidator', artifactKinds: ['choice-consequence-plan'], role: 'primary' },
  { validator: 'StatCheckBalanceValidator', artifactKinds: ['choice-consequence-plan'], role: 'primary' },
  { validator: 'MechanicsLeakageValidator', artifactKinds: ['choice-consequence-plan'], role: 'primary' },

  { validator: 'EncounterAnchorContentValidator', artifactKinds: ['encounter-plan'], role: 'primary' },
  { validator: 'EncounterQualityValidator', artifactKinds: ['encounter-plan'], role: 'primary' },
  { validator: 'EncounterSetPieceDepthValidator', artifactKinds: ['encounter-plan'], role: 'artifact-only' },
  { validator: 'BranchMechanicalDivergenceValidator', artifactKinds: ['encounter-plan'], role: 'primary' },
  { validator: 'OutcomeTextQualityValidator', artifactKinds: ['encounter-plan'], role: 'artifact-only' },

  { validator: 'StructuralValidator', artifactKinds: ['runtime-episode'], role: 'primary' },
  { validator: 'FinalStoryContractValidator', artifactKinds: ['runtime-episode'], role: 'primary' },
  { validator: 'MechanicsLeakageValidator', artifactKinds: ['runtime-episode'], role: 'primary' },
  { validator: 'SceneGraphBranchValidator', artifactKinds: ['runtime-episode'], role: 'primary' },
  { validator: 'ArcDeltaValidator', artifactKinds: ['runtime-episode'], role: 'primary' },
  { validator: 'SetupPayoffValidator', artifactKinds: ['runtime-episode'], role: 'primary' },
  { validator: 'TreatmentFidelityValidator', artifactKinds: ['runtime-episode'], role: 'primary' },
  { validator: 'SceneTurnRealizationValidator (episode Story Circle structural class)', artifactKinds: ['runtime-episode'], role: 'regression-net' },
  { validator: 'storyPathAnalyzer', artifactKinds: ['runtime-episode'], role: 'artifact-only' },

  { validator: 'decodeStory', artifactKinds: ['story-package'], role: 'artifact-only' },
  { validator: 'storyAssetWalker', artifactKinds: ['story-package'], role: 'artifact-only' },
  { validator: 'FinalStoryContractValidator', artifactKinds: ['story-package'], role: 'primary' },
  { validator: 'SceneTurnRealizationValidator (episode Story Circle structural class)', artifactKinds: ['story-package'], role: 'regression-net' },
  { validator: 'validate-assets', artifactKinds: ['story-package'], role: 'artifact-only' },
  { validator: 'check-reader-boundary', artifactKinds: ['story-package'], role: 'artifact-only' },
];

export const ARTIFACT_CONTRACT_REGISTRY: ArtifactContractEntry[] = [
  {
    id: 'source-analysis-source-contract',
    artifactKind: 'source-analysis',
    tier: 'blocking',
    contract: 'Preserve source identity, authored episode order, required beats, quote anchors, signature devices, and Story Circle anchors.',
  },
  {
    id: 'season-plan-structure-contract',
    artifactKind: 'season-plan',
    tier: 'blocking',
    contract: 'Preserve season spine, promise architecture, arc pressure, episode dependencies, information schedule, and consequence budget.',
  },
  {
    id: 'character-bible-npc-contract',
    artifactKind: 'character-bible',
    tier: 'blocking',
    contract: 'Preserve valid NPC identities, character architecture, role/voice consistency, introductions, and relationship trajectory readiness.',
  },
  {
    id: 'character-arc-contract',
    artifactKind: 'character-arc-plan',
    tier: 'blocking',
    contract: 'Preserve protagonist identity deltas, NPC relationship trajectories, milestone targets, and per-episode required movement.',
  },
  {
    id: 'npc-payoff-contract',
    artifactKind: 'npc-payoff-ledger',
    tier: 'blocking',
    contract: 'Track NPC-specific promises, relationship consequences, debts, secrets, tells, reversals, reconciliations, and payoffs.',
  },
  {
    id: 'thread-callback-contract',
    artifactKind: 'thread-ledger',
    tier: 'blocking',
    contract: 'Preserve setup/payoff coupling, callback due episodes, plants, payoffs, abandoned hooks, and overdue hooks.',
  },
  {
    id: 'information-ledger-contract',
    artifactKind: 'information-ledger',
    tier: 'blocking',
    contract: 'Preserve clues, mysteries, withheld knowledge, reveal/payoff schedule, audience knowledge state, and related flags.',
  },
  {
    id: 'episode-blueprint-contract',
    artifactKind: 'episode-blueprint',
    tier: 'blocking',
    contract: 'Preserve Story Circle role, episodeCircle, central conflict, arc movement, NPC payoffs, due callbacks, reveals, encounter purpose, and treatment beats.',
  },
  {
    id: 'scene-plan-contract',
    artifactKind: 'scene-plan',
    tier: 'blocking',
    contract: 'Preserve scene-first graph reachability, bottlenecks, reconvergence, turn contracts, pressure architecture, and setup/payoff placement.',
  },
  {
    id: 'branch-plan-contract',
    artifactKind: 'branch-plan',
    tier: 'blocking',
    contract: 'Preserve branch-and-bottleneck topology, no expression branching, reconvergence, branch residue, and cross-episode branch axes.',
  },
  {
    id: 'choice-consequence-contract',
    artifactKind: 'choice-consequence-plan',
    tier: 'blocking',
    contract: 'Preserve choice density/distribution, five-factor impact, stakes triangle, consequence tiering, flag contracts, skill surfaces, and fiction-first mechanics.',
  },
  {
    id: 'encounter-plan-contract',
    artifactKind: 'encounter-plan',
    tier: 'blocking',
    contract: 'Preserve encounter conflict manifestation, depth, clocks, NPC states, escalation, partial-victory cost, storylets, and playable failure.',
  },
  {
    id: 'runtime-episode-contract',
    artifactKind: 'runtime-episode',
    tier: 'blocking',
    contract: 'Preserve playable runtime Episode shape, valid targets, terminal routing, no unresolved templates, no mechanics leakage, arc movement, and path traversal.',
  },
  {
    id: 'story-package-contract',
    artifactKind: 'story-package',
    tier: 'blocking',
    contract: 'Preserve package decode, asset resolution, manifest integrity, reader safety, and playable exported content.',
  },
];

export interface NormalizedValidatorOwnershipEntry extends ValidatorRegistryEntry {
  lifecycle: ValidatorLifecycle;
  role: ValidatorExecutionRole;
}

export interface ValidatorOwnershipViolation {
  validator: string;
  problem: string;
}

export interface ValidateValidatorOwnershipRegistryOptions {
  validatorRegistry?: readonly ValidatorRegistryEntry[];
  artifactValidatorOwnership?: readonly ArtifactValidatorOwnershipEntry[];
  artifactContractRegistry?: readonly ArtifactContractEntry[];
  intentionallyUngatedArtifactKinds?: ReadonlySet<ArtifactKind>;
}

const gateById = new Map(GATE_REGISTRY.map((gate) => [gate.id, gate]));

function lifecycleForStage(stage: ValidatorStage): ValidatorLifecycle {
  switch (stage) {
    case 'season':
      return 'season-plan';
    case 'architecture':
      return 'episode-architecture';
    case 'phase':
      return 'phase-validation';
    case 'quick':
      return 'quick-validation';
    case 'full':
      return 'full-qa';
    case 'diagnostic':
      return 'narrative-diagnostics';
    case 'artifact-contract':
      return 'artifact-contract';
    case 'final':
      return 'final-contract';
  }
}

function normalizeEntry(entry: ValidatorRegistryEntry): NormalizedValidatorOwnershipEntry {
  return {
    ...entry,
    lifecycle: entry.lifecycle ?? lifecycleForStage(entry.stage),
    role: entry.role ?? 'primary',
  };
}

export function validatorById(validator: string): NormalizedValidatorOwnershipEntry | undefined {
  const entry = VALIDATOR_REGISTRY.find((candidate) => candidate.validator === validator);
  return entry ? normalizeEntry(entry) : undefined;
}

export function validatorsForLifecycle(lifecycle: ValidatorLifecycle): NormalizedValidatorOwnershipEntry[] {
  return VALIDATOR_REGISTRY.map(normalizeEntry).filter((entry) => entry.lifecycle === lifecycle);
}

export function validatorForGate(flag: string): NormalizedValidatorOwnershipEntry | undefined {
  const entry = VALIDATOR_REGISTRY.find((candidate) => candidate.rolloutFlag === flag);
  return entry ? normalizeEntry(entry) : undefined;
}

export function artifactValidatorsForKind(
  kind: ArtifactKind,
  ownership: readonly ArtifactValidatorOwnershipEntry[] = ARTIFACT_VALIDATOR_OWNERSHIP,
): ArtifactValidatorOwnershipEntry[] {
  const seen = new Set<string>();
  const result: ArtifactValidatorOwnershipEntry[] = [];
  for (const entry of ownership) {
    if (!entry.artifactKinds.includes(kind) || seen.has(entry.validator)) continue;
    seen.add(entry.validator);
    result.push(entry);
  }
  return result;
}

export function validatorNamesForArtifact(kind: ArtifactKind): string[] {
  return artifactValidatorsForKind(kind).map((entry) => entry.validator);
}

export function artifactContractForKind(
  kind: ArtifactKind,
  contracts: readonly ArtifactContractEntry[] = ARTIFACT_CONTRACT_REGISTRY,
): ArtifactContractEntry | undefined {
  return contracts.find((entry) => entry.artifactKind === kind);
}

export function artifactGateDefinitions(
  contracts: readonly ArtifactContractEntry[] = ARTIFACT_CONTRACT_REGISTRY,
  ownership: readonly ArtifactValidatorOwnershipEntry[] = ARTIFACT_VALIDATOR_OWNERSHIP,
): ArtifactGateDefinition[] {
  return contracts.map((contract) => ({
    ...contract,
    validators: artifactValidatorsForKind(contract.artifactKind, ownership).map((entry) => entry.validator),
  }));
}

export function artifactGatesForKind(kind: ArtifactKind): ArtifactGateDefinition[] {
  return artifactGateDefinitions().filter((gate) => gate.artifactKind === kind);
}

export function blockingArtifactGatesForKind(kind: ArtifactKind): ArtifactGateDefinition[] {
  return artifactGatesForKind(kind).filter((gate) => gate.tier === 'blocking');
}

export function validateValidatorOwnershipRegistry(
  options: ValidateValidatorOwnershipRegistryOptions = {},
): ValidatorOwnershipViolation[] {
  const violations: ValidatorOwnershipViolation[] = [];
  const validatorRegistry = options.validatorRegistry ?? VALIDATOR_REGISTRY;
  const artifactValidatorOwnership = options.artifactValidatorOwnership ?? ARTIFACT_VALIDATOR_OWNERSHIP;
  const artifactContractRegistry = options.artifactContractRegistry ?? ARTIFACT_CONTRACT_REGISTRY;
  const intentionallyUngatedArtifactKinds = options.intentionallyUngatedArtifactKinds ?? new Set<ArtifactKind>();
  const knownValidators = new Set(validatorRegistry.map((entry) => entry.validator));

  for (const entry of validatorRegistry) {
    if (!entry.rolloutFlag) continue;
    const gate = gateById.get(entry.rolloutFlag);
    if (!gate) {
      violations.push({
        validator: entry.validator,
        problem: `references unknown rolloutFlag ${entry.rolloutFlag}`,
      });
      continue;
    }
    if (entry.gatePlacement && entry.gatePlacement !== gate.placement && !gate.auditPlacements?.includes(entry.gatePlacement)) {
      violations.push({
        validator: entry.validator,
        problem: `gatePlacement ${entry.gatePlacement} is not registered for ${entry.rolloutFlag}`,
      });
    }
    // Audit 2026-07-01 (4.5/M11): a row still labeled 'advisory' after its gate
    // was promoted to default-ON blocking silently bypasses the repair-first
    // check below — the tier must be promoted together with the gate.
    if (entry.tier === 'advisory' && gate.kind === 'blocking' && gate.defaultOn) {
      violations.push({
        validator: entry.validator,
        problem: `tier says advisory but ${entry.rolloutFlag} is a default-ON blocking gate — promote the registry row's tier/remediation together with the gate`,
      });
    }
    const repairFirstViolation =
      entry.tier === 'blocking' &&
      gate.defaultOn &&
      gate.placement === 'season-final' &&
      !entry.remediation &&
      !entry.allowBlockingWithoutRepair;
    if (repairFirstViolation) {
      violations.push({
        validator: entry.validator,
        problem: `default-on season-final blocking gate ${entry.rolloutFlag} needs remediation metadata or an explicit exception`,
      });
    }
  }

  const artifactContractIds = new Set<string>();
  const artifactContractKinds = new Map<ArtifactKind, number>();
  for (const contract of artifactContractRegistry) {
    if (artifactContractIds.has(contract.id)) {
      violations.push({
        validator: contract.id,
        problem: 'duplicate artifact contract id',
      });
    }
    artifactContractIds.add(contract.id);

    artifactContractKinds.set(contract.artifactKind, (artifactContractKinds.get(contract.artifactKind) ?? 0) + 1);

    if (contract.tier !== 'blocking' && contract.tier !== 'advisory') {
      violations.push({
        validator: contract.id,
        problem: `artifact contract has unknown tier ${String(contract.tier)}`,
      });
    }
    if (!contract.contract.trim()) {
      violations.push({
        validator: contract.id,
        problem: 'artifact contract text is empty',
      });
    }
  }

  for (const [kind, count] of artifactContractKinds) {
    if (count !== 1) {
      violations.push({
        validator: kind,
        problem: `artifact kind has ${count} artifact contract entries`,
      });
    }
  }

  const ownershipKinds = new Set<ArtifactKind>();
  const ownershipPairs = new Set<string>();
  for (const entry of artifactValidatorOwnership) {
    if (entry.role === 'artifact-only') continue;
    if (!knownValidators.has(entry.validator)) {
      violations.push({
        validator: entry.validator,
        problem: 'artifact ownership entry is not artifact-only and has no validator registry row',
      });
    }
  }

  for (const entry of artifactValidatorOwnership) {
    for (const kind of entry.artifactKinds) {
      ownershipKinds.add(kind);
      const key = `${kind}:${entry.validator}`;
      if (ownershipPairs.has(key)) {
        violations.push({
          validator: entry.validator,
          problem: `duplicate artifact ownership entry for ${kind}`,
        });
      }
      ownershipPairs.add(key);
    }
  }

  for (const kind of ownershipKinds) {
    if (intentionallyUngatedArtifactKinds.has(kind)) continue;
    if (!artifactContractKinds.has(kind)) {
      violations.push({
        validator: kind,
        problem: 'artifact ownership kind has no artifact contract entry',
      });
    }
  }

  for (const kind of artifactContractKinds.keys()) {
    if (!ownershipKinds.has(kind)) {
      violations.push({
        validator: kind,
        problem: 'artifact contract kind has no validator ownership entries',
      });
    }
  }

  return violations;
}
