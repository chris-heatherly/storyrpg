/**
 * Explicit validator → quality-domain routing for QualityScore v4.
 *
 * QualityScore v3 routed every finding by substring-sniffing the validator
 * name + message (`mapFindingToDomain`), which misfiled findings whose message
 * merely *mentioned* another domain's vocabulary — e.g. a choice-agency defect
 * inside an encounter scene landed in the 2%-weight encounters domain because
 * the word "encounter" matched first. This map is the authoritative routing
 * for known finding producers; the keyword sniff remains only as a fallback
 * for sources not listed here.
 *
 * Keys are matched case-insensitively after stripping non-alphanumerics, so
 * `RouteContinuityValidator`, `route_continuity_validator`, and
 * `routecontinuity` all resolve to the same tag.
 */

import type { QualityDomainId } from './qualityScoring';

export interface QualityDomainTag {
  domainId: QualityDomainId;
  /** Optional concept pin; when absent the domain's keyword→concept match runs. */
  conceptId?: string;
}

function normalizeTagKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const RAW_TAGS: Record<string, QualityDomainTag> = {
  // --- Story Circle spine ---
  StoryCircleCoverageValidator: { domainId: 'story_circle_spine' },
  EpisodeStoryCircleValidator: { domainId: 'story_circle_spine' },
  StoryCircleAnchorConformanceValidator: { domainId: 'story_circle_spine' },

  // --- Dramatic structure / season architecture ---
  DramaticStructureValidator: { domainId: 'dramatic_structure_architecture' },
  SetupPayoffValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'setup_payoff_architecture' },
  SeasonPromiseValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'season_dramatic_question' },
  SeasonPromiseRealizationValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'season_dramatic_question' },
  CliffhangerValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'cold_opens_cliffhangers' },
  TwistQualityValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'setup_payoff_architecture' },
  InformationLedgerValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'information_reveal_control' },
  InformationLedgerScheduleValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'information_reveal_control' },
  SignatureDevicePresenceValidator: { domainId: 'dramatic_structure_architecture' },
  ArcPressureArchitectureValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'arc_pressure_reversals_turns' },
  EpisodePressureArchitectureValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'arc_pressure_reversals_turns' },
  StakesLadderValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'stakes_escalation' },
  ThemePressureValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'theme_pressure' },
  ThematicSquareTurnValidator: { domainId: 'dramatic_structure_architecture', conceptId: 'theme_pressure' },
  TreatmentFidelityValidator: { domainId: 'dramatic_structure_architecture' },
  TreatmentEventLedgerValidator: { domainId: 'dramatic_structure_architecture' },
  TreatmentAtomCoverageValidator: { domainId: 'dramatic_structure_architecture' },
  AuthoredEpisodeConformanceValidator: { domainId: 'dramatic_structure_architecture' },

  // --- Scene coherence / prose continuity ---
  SceneTurnRealizationValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'scene_clear_dramatic_turn' },
  SceneTurnContractValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'scene_clear_dramatic_turn' },
  SceneTransitionContinuityValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'clean_transitions_continuity' },
  PovClarityValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'pov_clarity' },
  RouteContinuityValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'clean_transitions_continuity' },
  EmptyPlayableSceneValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'concrete_on_page_realization' },
  PlanningRegisterLeakValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'no_planning_register_or_mechanics_leakage' },
  RequiredBeatRealizationValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'concrete_on_page_realization' },
  DuplicateEstablishingBeatValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'no_out_of_place_story_concepts' },
  SceneSpatialUnitValidator: { domainId: 'scene_coherence_prose_continuity', conceptId: 'clean_transitions_continuity' },
  NarrativeFailureModeValidator: { domainId: 'scene_coherence_prose_continuity' },
  SceneOwnershipPreflightValidator: { domainId: 'scene_coherence_prose_continuity' },
  ContinuityQA: { domainId: 'scene_coherence_prose_continuity', conceptId: 'clean_transitions_continuity' },

  // --- Prose craft (pillar 1: well written) ---
  SentenceOpenerVarietyValidator: { domainId: 'prose_craft', conceptId: 'rhythm_pacing' },
  OutcomeTextQualityValidator: { domainId: 'prose_craft', conceptId: 'filler_density' },
  IntensityDistributionValidator: { domainId: 'prose_craft', conceptId: 'rhythm_pacing' },
  ProseCraftJudge: { domainId: 'prose_craft' },

  // --- Choice agency ---
  ChoiceDensityValidator: { domainId: 'choice_agency' },
  ChoiceDistributionValidator: { domainId: 'choice_agency', conceptId: 'distribution_percentages' },
  StakesTriangleValidator: { domainId: 'choice_agency', conceptId: 'want_cost_identity' },
  FiveFactorValidator: { domainId: 'choice_agency', conceptId: 'meaningful_agency' },
  ChoiceImpactValidator: { domainId: 'choice_agency', conceptId: 'choice_affects_story_state' },
  ConsequenceBudgetValidator: { domainId: 'choice_agency', conceptId: 'choice_affects_story_state' },
  ChoiceCoverageValidator: { domainId: 'choice_agency', conceptId: 'meaningful_agency' },
  ChoiceTypePlanConformanceValidator: { domainId: 'choice_agency' },
  ConsequenceTierPlanConformanceValidator: { domainId: 'choice_agency', conceptId: 'choice_affects_story_state' },
  ChoiceQualityQA: { domainId: 'choice_agency' },
  StakesQA: { domainId: 'choice_agency', conceptId: 'want_cost_identity' },

  // --- Branching / consequence memory (pillar 4: responsive world) ---
  DivergenceValidator: { domainId: 'branching_consequence_memory', conceptId: 'meaningfully_different_branches' },
  BranchMechanicalDivergenceValidator: { domainId: 'branching_consequence_memory', conceptId: 'meaningfully_different_branches' },
  ConvergenceLedgerValidator: { domainId: 'branching_consequence_memory', conceptId: 'branch_residue_survives' },
  ResidueObligationValidator: { domainId: 'branching_consequence_memory', conceptId: 'branch_residue_survives' },
  EndingReachabilityValidator: { domainId: 'branching_consequence_memory', conceptId: 'ending_route_effects' },
  CallbackCoverageValidator: { domainId: 'branching_consequence_memory', conceptId: 'cross_episode_payoffs' },
  CallbackOpportunitiesValidator: { domainId: 'branching_consequence_memory', conceptId: 'cross_episode_payoffs' },
  SceneGraphBranchValidator: { domainId: 'branching_consequence_memory', conceptId: 'branch_graph_correctness' },
  BranchMetrics: { domainId: 'branching_consequence_memory', conceptId: 'meaningfully_different_branches' },
  ResponsivenessJudge: { domainId: 'branching_consequence_memory', conceptId: 'choice_reflected_in_prose' },

  // --- Character / NPC / relationship quality ---
  CharacterArchitectureValidator: { domainId: 'character_npc_relationship_quality' },
  NPCDepthValidator: { domainId: 'character_npc_relationship_quality', conceptId: 'npc_desire_pressure_function' },
  CharacterIntroductionValidator: { domainId: 'character_npc_relationship_quality', conceptId: 'character_introductions' },
  CharacterTreatmentRealizationValidator: { domainId: 'character_npc_relationship_quality' },
  RelationshipArcLedgerValidator: { domainId: 'character_npc_relationship_quality', conceptId: 'relationship_pacing_earned' },
  RelationshipPacingValidator: { domainId: 'character_npc_relationship_quality', conceptId: 'relationship_pacing_earned' },
  RelationshipValueLadderValidator: { domainId: 'character_npc_relationship_quality', conceptId: 'relationship_payoffs_visible' },
  ArcDeltaValidator: { domainId: 'character_npc_relationship_quality', conceptId: 'character_change_pressure' },
  CanonConsistencyValidator: { domainId: 'character_npc_relationship_quality' },
  CharacterConsistencyQA: { domainId: 'character_npc_relationship_quality' },
  VoiceValidator: { domainId: 'character_npc_relationship_quality' },

  // --- Gameplay mechanics as fiction ---
  MechanicsLeakageValidator: { domainId: 'gameplay_mechanics_as_fiction', conceptId: 'fiction_first_presentation' },
  FlagContractValidator: { domainId: 'gameplay_mechanics_as_fiction', conceptId: 'flags_scores_tags_reliable' },
  StatCheckBalanceValidator: { domainId: 'gameplay_mechanics_as_fiction', conceptId: 'skill_stat_surfaces_diegetic' },
  SkillSurfaceValidator: { domainId: 'gameplay_mechanics_as_fiction', conceptId: 'skill_stat_surfaces_diegetic' },
  SkillCoverageValidator: { domainId: 'gameplay_mechanics_as_fiction', conceptId: 'skill_stat_surfaces_diegetic' },
  SkillPlanConformanceValidator: { domainId: 'gameplay_mechanics_as_fiction', conceptId: 'skill_stat_surfaces_diegetic' },
  MechanicalStorytellingValidator: { domainId: 'gameplay_mechanics_as_fiction', conceptId: 'mechanics_create_story_pressure' },
  NarrativeMechanicPressureValidator: { domainId: 'gameplay_mechanics_as_fiction', conceptId: 'mechanics_create_story_pressure' },

  // --- Encounters ---
  EncounterQualityValidator: { domainId: 'encounters', conceptId: 'encounter_story_pressure' },
  EncounterAnchorContentValidator: { domainId: 'encounters', conceptId: 'setup_context_prior_scenes' },
  EncounterProseIntegrityValidator: { domainId: 'encounters' },
  EncounterSetPieceDepthValidator: { domainId: 'encounters' },
  IncrementalEncounterValidator: { domainId: 'encounters', conceptId: 'skill_approach_variety' },
  ChargeMaterializationValidator: { domainId: 'encounters', conceptId: 'cost_aftermath_consequence' },
  EncounterStoryCircleTargetValidator: { domainId: 'encounters', conceptId: 'encounter_story_circle_target' },
};

const VALIDATOR_QUALITY_TAGS: Map<string, QualityDomainTag> = new Map(
  Object.entries(RAW_TAGS).map(([key, tag]) => [normalizeTagKey(key), tag]),
);

/** Resolve the explicit domain tag for a validator name, if one is registered. */
export function lookupQualityDomainTag(validator: string | undefined): QualityDomainTag | undefined {
  if (!validator) return undefined;
  return VALIDATOR_QUALITY_TAGS.get(normalizeTagKey(validator));
}
