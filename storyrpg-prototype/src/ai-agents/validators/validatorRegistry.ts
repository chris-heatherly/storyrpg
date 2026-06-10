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
}

export const VALIDATOR_REGISTRY: ValidatorRegistryEntry[] = [
  // --- Season planning (SeasonPlannerAgent.finalizePlan) ---
  // 7-point spine GATE (tier 1, blocking): SeasonPlanner.execute throws when the season's
  // 3-act/7-point spine is incomplete or out of canonical order. (Tier 2 — each episode's
  // blueprint must realize its assigned beats — is an inline validateBlueprint throw in
  // StoryArchitect, like the scene-count/branching checks, so it has no separate registry row.)
  { validator: 'SevenPointCoverageValidator', stage: 'season', tier: 'blocking', dispatchedFrom: 'SeasonPlannerAgent (execute)' },
  { validator: 'ArcPressureArchitectureValidator', stage: 'season', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_ARC_PRESSURE', dispatchedFrom: 'SeasonPlannerAgent' },
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
  { validator: 'ChoiceDensityValidator', stage: 'quick', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_CHOICE_DENSITY', dispatchedFrom: 'IntegratedBestPracticesValidator / FullStoryPipeline' },
  { validator: 'ChoiceDistributionValidator', stage: 'quick', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_CHOICE_DISTRIBUTION', dispatchedFrom: 'IntegratedBestPracticesValidator' },
  { validator: 'ConsequenceBudgetValidator', stage: 'quick', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_CONSEQUENCE_BUDGET', dispatchedFrom: 'IntegratedBestPracticesValidator / FullStoryPipeline' },
  { validator: 'CallbackOpportunitiesValidator', stage: 'quick', tier: 'autofix', dispatchedFrom: 'IntegratedBestPracticesValidator' },
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
  { validator: 'SetupPayoffValidator', stage: 'diagnostic', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_SETUP_PAYOFF', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'TwistQualityValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  // tier stays 'advisory' (not 'blocking'): enforced via guaranteed autofix.
  { validator: 'ArcDeltaValidator', stage: 'diagnostic', tier: 'advisory', remediation: 'autofix', rolloutFlag: 'GATE_ARC_DELTA', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'DivergenceValidator', stage: 'diagnostic', tier: 'advisory', dispatchedFrom: 'narrativeDiagnostics' },
  { validator: 'CallbackCoverageValidator', stage: 'diagnostic', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_CALLBACK_COVERAGE', dispatchedFrom: 'narrativeDiagnostics' },
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
  { validator: 'MicroEpisodeSeasonValidator', stage: 'final', tier: 'advisory', dispatchedFrom: 'FullStoryPipeline' },
  { validator: 'FinalStoryContractValidator', stage: 'final', tier: 'blocking', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
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
  { validator: 'MechanicsLeakageValidator (design-note class)', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_DESIGN_NOTE_LEAK', dispatchedFrom: 'IntegratedBestPracticesValidator / FinalStoryContractValidator' },
  // (b) Witness-id integrity: unknown-NPC witness references (already errors from
  //     MechanicalStorytellingValidator) become blocking instead of downgraded.
  { validator: 'MechanicalStorytellingValidator (witness-id class)', stage: 'final', tier: 'advisory', remediation: 'regen-choices', rolloutFlag: 'GATE_WITNESS_ID_INTEGRITY', dispatchedFrom: 'IntegratedBestPracticesValidator / FinalStoryContractValidator' },

  // --- Treatment-fidelity guardrails (Remediation §4.1–§4.5) ---
  // The five NEW validators that assert the generated story is a faithful EXPANSION
  // of the authored treatment (episode identity, encounter-anchor content, INFO
  // schedule, signature devices, 7-point anchoring) rather than a re-cut. All are
  // tiered 'blocking' (§4 calls them blocking) but ship DEFAULT-OFF behind a per-rule
  // rollout flag (treatmentFidelityGate.ts); with every flag unset they never gate.
  // §4.6: when the source is an authored treatment, FinalStoryContractValidator does
  // NOT downgrade these findings to warnings (validateFidelityFindings).
  { validator: 'AuthoredEpisodeConformanceValidator', stage: 'final', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_AUTHORED_EPISODE_CONFORMANCE', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'EncounterAnchorContentValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_ENCOUNTER_ANCHOR_CONTENT', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'InformationLedgerScheduleValidator', stage: 'final', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_INFORMATION_LEDGER_SCHEDULE', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'SignatureDevicePresenceValidator', stage: 'final', tier: 'blocking', remediation: 'regen-scene', rolloutFlag: 'GATE_SIGNATURE_DEVICE_PRESENCE', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },
  { validator: 'SevenPointAnchorConformanceValidator', stage: 'final', tier: 'blocking', remediation: 'plan-time', rolloutFlag: 'GATE_SEVEN_POINT_ANCHOR_CONFORMANCE', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract)' },

  // --- Gen-4 audit follow-ups (default-off; the metric is always recorded) ---
  // Dead-branch: a planned multi-target branch point whose choices collapsed to a
  // single target (assembled linear). GATE_BRANCH_FANOUT promotes it to an error.
  { validator: 'SceneGraphBranchValidator (branch-fan-out class)', stage: 'final', tier: 'advisory', remediation: 'regen-choices', rolloutFlag: 'GATE_BRANCH_FANOUT', dispatchedFrom: 'FullStoryPipeline (validateSceneGraphBranching)' },
  // Duplicate establishing-beat: two scenes on a linear path both staged as a first
  // entry into the same location (dual-first-entry). Surfaced to the continuity pass.
  { validator: 'DuplicateEstablishingBeatValidator', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_DUPLICATE_ESTABLISHING_BEAT', dispatchedFrom: 'FullStoryPipeline (continuity check)' },
  // Treatment-seed on-page presence: each declared treatment_seed_* must be set via a
  // setFlag consequence on some choice in its episode (presence-only, deterministic).
  { validator: 'TreatmentSeedOnPageValidator', stage: 'final', tier: 'advisory', remediation: 'plan-time', rolloutFlag: 'GATE_TREATMENT_SEED_ONPAGE', dispatchedFrom: 'FullStoryPipeline (episode validation)' },
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
  { validator: 'encounterOutcomeFlags (reconvergence-desync class)', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_ENCOUNTER_OUTCOME_VARIANT', dispatchedFrom: 'FinalStoryContractValidator' },
  // Continuity remediation: promote cross-scene continuity ERRORS from the advisory QA
  // report to blocking so the final-contract repair loop engages.
  { validator: 'ContinuityChecker (cross-scene error class)', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_CONTINUITY_REMEDIATION', dispatchedFrom: 'FinalStoryContractValidator' },

  // --- 2026-06-09 storytelling-quality audit (time/place + character-introduction) ---
  // Unacknowledged time/place jump between adjacent scenes: planned Scene.timeline
  // changed but the arriving scene has no transitionIn / transition prose. Backstop for
  // the plan-time timeline + SceneWriter/EncounterArchitect transition-handoff fix.
  { validator: 'SceneTransitionContinuityValidator', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_SCENE_TRANSITION_CONTINUITY', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
  // Characters without on-page introduction: cold prose name-drops before any cast
  // presence, and cast-in-metadata-only NPCs the prose never names. Backstop for the
  // first-appearance directive / notYetIntroducedNames ban-list / introduction key beats.
  { validator: 'CharacterIntroductionValidator', stage: 'final', tier: 'advisory', remediation: 'regen-scene', rolloutFlag: 'GATE_CHARACTER_INTRODUCTION', dispatchedFrom: 'FullStoryPipeline (enforceFinalStoryContract via runFidelityValidators)' },
];

/** Validators that hard-block a run regardless of validation mode. */
export function blockingValidators(): string[] {
  return VALIDATOR_REGISTRY.filter((e) => e.tier === 'blocking').map((e) => e.validator);
}

/** Remediation route declared for a validator (by name), or undefined if none/unknown. */
export function remediationRoute(validator: string): ValidatorRemediation | undefined {
  return VALIDATOR_REGISTRY.find((e) => e.validator === validator)?.remediation;
}
