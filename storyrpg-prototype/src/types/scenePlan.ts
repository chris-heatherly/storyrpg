/**
 * Season Scene Plan Types
 *
 * Scene-first planning lives here. The pipeline historically planned the
 * 7-point spine and assigned each episode one of its beats, then *invented*
 * scenes per-episode (inside the generation loop, in StoryArchitect) to land
 * that beat. That made beats the primary unit and scenes derivative and
 * episode-local — a scene could not be planned as "the payoff of a scene two
 * episodes earlier" because no season-wide scene list existed at plan time.
 *
 * The Season Scene Plan inverts that. Episodes AND their scenes are enumerated
 * at the SEASON level (by SeasonPlannerAgent), with cross-scene setup/payoff
 * wiring. The 7-point structure stays a season/episode meta-concept: the season
 * owns the {@link SevenPointStructure}, each episode maps to ONE structural role
 * (its `structuralRole`), and a scene serves the season-arc purpose named by its
 * episode's role. Beats (prose units) are NOT planned here — they are generated
 * later, in the per-episode loop, to serve their scene.
 *
 * An encounter is a *kind of scene*, not a parallel structure: an encounter is a
 * {@link PlannedScene} with `kind: 'encounter'` carrying {@link PlannedSceneEncounter}
 * detail. This unifies the spine (quiet scenes and encounters in one ordered
 * list) and means anything that reasons over scenes — pacing, the
 * consequence/branch budget — sees encounters by construction.
 */

import type {
  EncounterCategory,
  StructuralRole,
  SevenPointBeat,
} from './sourceAnalysis';
import type { ChoiceType } from './choice';

// ========================================
// SCENE PLAN CORE TYPES
// ========================================

/**
 * A scene is either a standard dramatic scene or an encounter. Encounters are
 * scenes; this discriminant selects which authoring path elaborates them in the
 * per-episode loop (SceneWriter for `standard`, EncounterArchitect for
 * `encounter`) — both still emit beats.
 */
export type SceneKind = 'standard' | 'encounter';

/**
 * The scene's dramatic function WITHIN its episode's arc. This is distinct from
 * the 7-point structural role, which lives on the episode, not the scene. A
 * scene's role describes how it advances the purpose its episode carries.
 */
/**
 * How deep a budgeted choice's consequence reaches, from cheapest to costliest.
 * The unit a scene/encounter spends from the season consequence budget:
 *  - `callback`   — a later acknowledgement/reference; no mechanical fork.
 *  - `tint`       — colors subsequent state/flavor without altering the path.
 *  - `branchlet`  — a short, reconverging divergence (a local fork).
 *  - `branch`     — a durable, path-defining divergence.
 * Invariants enforced downstream: an 'expression' unit => 'callback'; a
 * 'dilemma' unit => at least 'branchlet'; ANY encounter => at least
 * 'branchlet', never 'callback' (branch points sit higher still).
 */
export type ConsequenceTier = 'callback' | 'tint' | 'branchlet' | 'branch';

export type SceneNarrativeRole =
  | 'setup'        // plants a question, goal, or thread the episode/season will pay off
  | 'development'  // escalates or complicates an established line
  | 'turn'         // reverses, reveals, or recontextualizes — the scene's hinge
  | 'payoff'       // discharges a setup planted earlier (this episode or prior)
  | 'release';     // aftermath / breather that resettles stakes after a turn or payoff

/**
 * A single authored unit the scene MUST depict (the "expand, do not rewrite"
 * contract). When a story is generated from an authored treatment, each authored
 * episode turn, signature staged moment, and encounter anchor becomes a discrete
 * required beat bound to the scene that lands it — not a free-text prompt hint.
 * The downstream beat-author stage must realize every `mustDepict`; the
 * SignatureDevicePresenceValidator is the backstop.
 *
 * Tiers grade how fixed the beat is:
 *  - `signature`  — a staged device/image the prose MUST show (e.g. the joined-
 *                   blood archive floor); never invented away, never inverted.
 *  - `authored`   — an authored episode turn that must occur, in order, undropped.
 *  - `seed`       — an authored cold-open / consequence-seed / information-ledger
 *                   plant distributed from `treatmentGuidance`. The prose SHOULD
 *                   land it if the scene can carry it, but it is ADVISORY — counted,
 *                   never blocking — because it is finer-grained than a turn and may
 *                   legitimately sit in a sibling scene.
 *  - `connective` — tissue the model may freely author around the fixed beats
 *                   (the band that preserves legitimate inference).
 */
export interface RequiredBeat {
  /** Stable id, unique within the scene (e.g. `s2-3-rb1`). */
  id: string;
  /** The authored source text this beat dramatizes (verbatim authored turn). */
  sourceTurn: string;
  /** What the generated prose must depict to honor this beat. */
  mustDepict: string;
  /** How fixed this beat is — see {@link RequiredBeat}. `coldopen` is the episode-opening
   * cold open — a high-priority, always-due seed split out from generic `seed` plants so it
   * can be enforced (low false-positive: an episode opener is reliably present) without the
   * FP risk of blocking every consequence seed. */
  tier: 'signature' | 'authored' | 'seed' | 'coldopen' | 'connective';
}

export type SceneTurnSource = 'treatment' | 'planner' | 'encounter' | 'choice';

/**
 * Generator-only scene craft contract. A scene is built around one dramatic
 * turn: the state before, the event/reveal/choice that bends it, and the state
 * after. Runtime playback ignores this metadata; validators and repair passes
 * use it to prevent scenes from checking off outline moments without earning
 * them on-page.
 */
export interface SceneTurnContract {
  turnId: string;
  source: SceneTurnSource;
  centralTurn: string;
  beforeState: string;
  turnEvent: string;
  afterState: string;
  handoff: string;
}

export type RelationshipPacingStage =
  | 'unmet'
  | 'noticed'
  | 'spark'
  | 'acquaintance'
  | 'tentative_ally'
  | 'friend'
  | 'trusted_ally'
  | 'intimate';

export type RelationshipPacingSource = 'treatment' | 'planner' | 'encounter' | 'choice';

/**
 * Generator-only relationship pacing contract. It lets planning, prose,
 * choices, validators, and repair agree on what level of relationship has
 * actually been earned on-page. Playback ignores this metadata.
 */
export interface RelationshipPacingContract {
  id: string;
  source: RelationshipPacingSource;
  npcId?: string;
  groupId?: string;
  startStage: RelationshipPacingStage;
  targetStage: RelationshipPacingStage;
  allowedLabels: string[];
  blockedLabels: string[];
  requiredEvidence: string[];
  minScenesSinceIntroduction: number;
  maxDeltaThisScene: number;
  mechanicDimensions: Array<'trust' | 'affection' | 'respect' | 'fear'>;
}

export type MechanicPressureDomain =
  | 'relationship'
  | 'identity'
  | 'skill'
  | 'flag'
  | 'score'
  | 'item'
  | 'route'
  | 'encounter'
  | 'information'
  | 'resource'
  | 'reputation';

export type MechanicPressureFunction =
  | 'plant'
  | 'intensify'
  | 'gate'
  | 'spend'
  | 'payoff'
  | 'complicate'
  | 'resolve';

export type MechanicPressureSource =
  | 'treatment'
  | 'planner'
  | 'choice'
  | 'encounter'
  | 'arc'
  | 'callback';

export interface MechanicPressureRef {
  flag?: string;
  score?: string;
  npcId?: string;
  relationshipDimension?: 'trust' | 'affection' | 'respect' | 'fear';
  identityAxis?: string;
  skill?: string;
  itemId?: string;
  routeId?: string;
  encounterOutcome?: string;
  infoId?: string;
}

/**
 * Generator-only mechanics-as-story-pressure contract. Playback ignores this
 * metadata; planning, authoring, validation, and repair use it to ensure hidden
 * state changes are earned by on-page events and later spent as narrative
 * permission rather than raw numeric cause/effect.
 */
export interface MechanicPressureContract {
  id: string;
  source: MechanicPressureSource;
  domain: MechanicPressureDomain;
  mechanicRef: MechanicPressureRef;
  function: MechanicPressureFunction;
  storyPressure: string;
  evidenceRequired: string[];
  visibleResidue: string[];
  allowedPayoffs: string[];
  blockedPayoffs: string[];
  originatingSceneId?: string;
  payoffWindow?: { minEpisode?: number; maxEpisode?: number; minScenesLater?: number };
  maxMagnitudeThisScene?: number;
  requiredBeforeSpend?: Array<{ domain: MechanicPressureDomain; description: string }>;
}

export type AuthoredTreatmentFieldKind =
  | 'pressure_lane'
  | 'encounter_anchor'
  | 'encounter_conflict'
  | 'stakes_layer'
  | 'theme_angle'
  | 'lie_pressure'
  | 'encounter_buildup'
  | 'major_choice_pressure'
  | 'alternative_path'
  | 'information_movement'
  | 'consequence_seed'
  | 'ending_turnout'
  | 'resolved_episode_tension'
  | 'cliffhanger_hook'
  | 'cliffhanger_question'
  | 'next_episode_pressure'
  | 'cliffhanger_setup'
  | 'cliffhanger_type'
  | 'emotional_charge'
  | 'end_state_change';

export type AuthoredTreatmentFieldRealization =
  | 'scene_turn'
  | 'encounter'
  | 'choice'
  | 'information_ledger'
  | 'consequence'
  | 'mechanic_pressure'
  | 'cliffhanger'
  | 'episode_ending'
  | 'final_prose'
  | 'next_episode_plan';

export type SeasonPromiseRealizationKind =
  | 'genre_progression'
  | 'tone_progression'
  | 'logline_engine'
  | 'core_fantasy'
  | 'audience_promise'
  | 'premise_promise'
  | 'theme_question'
  | 'inaction_pressure'
  | 'season_dramatic_question'
  | 'central_pressure'
  | 'player_promise'
  | 'emotional_promise'
  | 'fresh_variation_plan'
  | 'typical_episode_engine'
  | 'season_resolution_obligation'
  | 'future_open_thread';

export type SeasonPromiseRealizationTarget =
  | 'metadata'
  | 'episode_plan'
  | 'scene_turn'
  | 'choice'
  | 'encounter'
  | 'information_ledger'
  | 'consequence_chain'
  | 'mechanic_pressure'
  | 'cliffhanger'
  | 'episode_ending'
  | 'final_prose'
  | 'next_episode_plan';

/**
 * Generator-only season promise contract. These make top-level authored
 * promises traceable as story obligations without changing playback rules.
 */
export interface SeasonPromiseRealizationContract {
  id: string;
  sourceText: string;
  contractKind: SeasonPromiseRealizationKind;
  requiredRealization: SeasonPromiseRealizationTarget[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

export type StakesArchitectureContractKind =
  | 'material_stake'
  | 'relational_stake'
  | 'identity_stake'
  | 'existential_stake'
  | 'stakes_escalation_step'
  | 'personal_stakes_prerequisite'
  | 'emotional_stakes_anchor';

export type StakesArchitectureRealizationTarget =
  | 'stakes_layer'
  | 'scene_turn'
  | 'choice'
  | 'mechanic_pressure'
  | 'relationship_pacing'
  | 'character_treatment'
  | 'world_location'
  | 'information_ledger'
  | 'episode_ending'
  | 'final_prose';

/**
 * Generator-only stakes architecture contract. These make top-level authored
 * material/relational/identity/existential stakes traceable without changing
 * reader playback rules or duplicating the dramatic-structure validators.
 */
export interface StakesArchitectureContract {
  id: string;
  source: 'treatment' | 'analysis_fallback';
  fieldName: string;
  sourceText: string;
  contractKind: StakesArchitectureContractKind;
  stakeLayer?: 'material' | 'relational' | 'identity' | 'existential';
  requiredRealization: StakesArchitectureRealizationTarget[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  prerequisiteContractIds: string[];
  linkedContractIds: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

export type BranchConsequenceContractKind =
  | 'branch_origin_choice'
  | 'branch_path_state'
  | 'branch_later_payoff'
  | 'branch_reconvergence_residue'
  | 'branch_state_change'
  | 'branch_ending_eligibility';

export type BranchConsequenceRealizationTarget =
  | 'choice'
  | 'season_flag'
  | 'consequence_chain'
  | 'mechanic_pressure'
  | 'information_ledger'
  | 'scene_turn'
  | 'text_variant'
  | 'ending_target'
  | 'final_prose';

export interface BranchConsequenceRealizationContract {
  id: string;
  source: 'treatment' | 'analysis_fallback';
  branchId: string;
  branchName: string;
  fieldName: string;
  sourceText: string;
  contractKind: BranchConsequenceContractKind;
  requiredRealization: BranchConsequenceRealizationTarget[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  targetEndingIds: string[];
  stateDomains: MechanicPressureDomain[];
  linkedContractIds: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

export type EndingRealizationContractKind =
  | 'ending_identity'
  | 'ending_summary'
  | 'ending_emotional_register'
  | 'ending_theme_payoff'
  | 'ending_state_driver'
  | 'ending_target_condition'
  | 'ending_choice_pattern'
  | 'ending_final_line';

export type EndingRealizationTarget =
  | 'resolved_ending'
  | 'season_flag'
  | 'choice_moment'
  | 'condition'
  | 'mechanic_pressure'
  | 'finale_choice'
  | 'ending_route'
  | 'final_prose';

export interface EndingRealizationContract {
  id: string;
  source: 'treatment' | 'analysis_fallback';
  endingId: string;
  endingName: string;
  fieldName: string;
  sourceText: string;
  contractKind: EndingRealizationContractKind;
  requiredRealization: EndingRealizationTarget[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  targetEndingIds: string[];
  stateDomains: MechanicPressureDomain[];
  linkedContractIds: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

export type FailureModeAuditCode =
  | 'escalation_trap'
  | 'mystery_box_collapse'
  | 'character_drift'
  | 'shaggy_dog'
  | 'passive_protagonist'
  | 'reset_disease'
  | 'theme_drift'
  | 'unmotivated_escalation'
  | 'snowglobe_arc'
  | 'inverted_thematic_rhyme'
  | 'convenient_coincidence'
  | 'telegraphed_twist'
  | 'cheating_twist';

export type FailureModeAuditContractKind =
  | 'avoidance_claim'
  | 'watch_item'
  | 'mitigation'
  | 'setup_payoff_claim'
  | 'agency_claim'
  | 'causality_claim'
  | 'theme_rhyme_claim'
  | 'episode_state_change_claim'
  | 'arc_state_change_claim'
  | 'reveal_fair_play_claim';

export type FailureModeAuditRealizationTarget =
  | 'season_plan'
  | 'scene_turn'
  | 'choice'
  | 'mechanic_pressure'
  | 'information_ledger'
  | 'setup_payoff'
  | 'arc_pressure'
  | 'season_promise'
  | 'character_treatment'
  | 'branch_consequence'
  | 'ending_route'
  | 'final_prose';

export interface FailureModeAuditContract {
  id: string;
  source: 'treatment' | 'analysis_fallback';
  code: FailureModeAuditCode;
  label: string;
  status: 'avoided' | 'watch_item' | 'unknown';
  sourceText: string;
  contractKind: FailureModeAuditContractKind;
  requiredRealization: FailureModeAuditRealizationTarget[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  linkedContractIds: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

export type SevenPointBeatRealizationTarget =
  | 'season_plan'
  | 'scene_turn'
  | 'mechanic_pressure'
  | 'information_ledger'
  | 'episode_ending'
  | 'final_prose';

/**
 * Generator-only realization contract for authored 3-act / 7-point beat text.
 * The existing seven-point validators prove placement and order; this contract
 * makes the authored beat content traceable into scene turns and final prose.
 */
export interface SevenPointBeatRealizationContract {
  id: string;
  beat: SevenPointBeat;
  sourceText: string;
  targetEpisodeNumber?: number;
  requiredRealization: SevenPointBeatRealizationTarget[];
  eventAtoms: string[];
  stateChange?: string;
  targetSceneIds: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

export type ArcPressureTreatmentContractKind =
  | 'arc_identity'
  | 'arc_question'
  | 'season_relation'
  | 'lie_facet'
  | 'arc_midpoint_recontextualization'
  | 'arc_late_crisis'
  | 'arc_finale_answer'
  | 'arc_handoff_pressure'
  | 'arc_episode_turnout';

export type ArcPressureTreatmentRealizationTarget =
  | 'season_arc'
  | 'scene_turn'
  | 'choice'
  | 'mechanic_pressure'
  | 'information_ledger'
  | 'episode_ending'
  | 'next_arc_plan'
  | 'final_prose';

/**
 * Generator-only realization contract for authored arc-plan fields. Acts and
 * seven-point beats keep positional authority; these contracts make each
 * authored arc's question, reframe, crisis, answer, handoff, and per-episode
 * turnout traceable into scene pressure and final prose.
 */
export interface ArcPressureTreatmentContract {
  id: string;
  source: 'treatment' | 'analysis_fallback';
  arcId: string;
  arcTitle: string;
  fieldName: string;
  sourceText: string;
  contractKind: ArcPressureTreatmentContractKind;
  requiredRealization: ArcPressureTreatmentRealizationTarget[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  eventAtoms: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

export type CharacterTreatmentSubject = 'protagonist' | 'supporting_character';

export type CharacterTreatmentFieldKind =
  | 'canonical_identity'
  | 'role_fact'
  | 'origin_pressure'
  | 'conscious_want'
  | 'dramatic_need'
  | 'lie_pressure'
  | 'wound_pressure'
  | 'truth_target'
  | 'arc_mode'
  | 'starting_identity'
  | 'ending_state'
  | 'climax_choice'
  | 'pressure_point'
  | 'visual_identity';

export type CharacterTreatmentRealizationTarget =
  | 'character_bible'
  | 'season_arc'
  | 'scene_turn'
  | 'choice'
  | 'mechanic_pressure'
  | 'information_ledger'
  | 'ending_target'
  | 'finale_choice'
  | 'visual_profile'
  | 'final_prose';

/**
 * Generator-only character treatment contract. These make authored protagonist
 * facts traceable obligations without changing playback rules.
 */
export interface CharacterTreatmentRealizationContract {
  id: string;
  source: 'treatment' | 'analysis_fallback';
  subject: CharacterTreatmentSubject;
  characterId?: string;
  characterName: string;
  fieldName: string;
  sourceText: string;
  contractKind: CharacterTreatmentFieldKind;
  requiredRealization: CharacterTreatmentRealizationTarget[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  targetEndingIds: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

export type WorldTreatmentFieldKind =
  | 'world_premise'
  | 'time_period'
  | 'supernatural_rule'
  | 'dramatic_rule'
  | 'faction_power'
  | 'taboo_or_cost'
  | 'scarcity'
  | 'sacred_object'
  | 'danger_zone'
  | 'location_identity'
  | 'location_purpose'
  | 'location_mood'
  | 'location_history'
  | 'location_choice_pressure';

export type WorldTreatmentRealizationTarget =
  | 'world_bible'
  | 'season_plan'
  | 'location_introduction'
  | 'scene_turn'
  | 'choice'
  | 'mechanic_pressure'
  | 'information_ledger'
  | 'encounter'
  | 'final_prose';

/**
 * Generator-only world/location treatment contract. These make authored setting
 * rules, factions, taboos, and per-location purpose/choice pressure traceable
 * without adding reader-visible mechanics.
 */
export interface WorldTreatmentRealizationContract {
  id: string;
  source: 'treatment' | 'analysis_fallback';
  fieldName: string;
  sourceText: string;
  contractKind: WorldTreatmentFieldKind;
  requiredRealization: WorldTreatmentRealizationTarget[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  locationId?: string;
  locationName?: string;
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

/**
 * Generator-only treatment-field utilization contract. These are the parsed
 * authored treatment fields that must be consumed by planning artifacts and
 * realized fiction-first on the page. Playback ignores this metadata.
 */
export interface AuthoredTreatmentFieldContract {
  id: string;
  episodeNumber: number;
  fieldName: string;
  sourceText: string;
  contractKind: AuthoredTreatmentFieldKind;
  requiredRealization: AuthoredTreatmentFieldRealization[];
  targetSceneIds: string[];
  blockingLevel: 'treatment' | 'structural' | 'warning';
}

/**
 * Encounter detail carried by a `kind: 'encounter'` scene. Absorbs the fields
 * of the legacy season-level PlannedEncounter so encounters no longer need a
 * parallel list — the scene id IS the encounter id.
 */
export interface PlannedSceneEncounter {
  /** What kind of encounter. */
  type: EncounterCategory;
  /**
   * The FULL authored encounter description from the treatment/season plan.
   * The scene's `title` is a truncated label — this is what downstream
   * generation (the encounter directive → EncounterArchitect) must receive.
   * G12 endsong: losing this to the 60-char title staged the siege from the
   * fragment "…a sustained defensive set piece (wall bre".
   */
  description?: string;
  /** Optional narrative style layer for non-combat parity. */
  style?: 'action' | 'social' | 'romantic' | 'dramatic' | 'mystery' | 'stealth' | 'adventure' | 'mixed';
  /** Difficulty relative to story progression. */
  difficulty: 'easy' | 'moderate' | 'hard' | 'extreme';
  /** Skills/approaches that should be relevant. */
  relevantSkills: string[];
  /** Authored treatment pressure this encounter should manifest through play. */
  centralConflict?: string;
  /** What the episode should show after this encounter resolves. */
  aftermathConsequence?: string;
  /** Does this encounter's outcome branch the story? */
  isBranchPoint: boolean;
  /** If branching, the major outcomes. */
  branchOutcomes?: {
    victory: string;
    partialVictory?: string;
    defeat: string;
    escape?: string;
  };
  /**
   * Authored required beats this encounter must stage — typically the central
   * staged image/device the encounter exists to depict. Distinct from the
   * scene-level {@link PlannedScene.requiredBeats}: these are anchored to the
   * encounter's play, not its surrounding scene prose. Empty/undefined for
   * inferred encounters.
   */
  requiredBeats?: RequiredBeat[];
}

/**
 * A single planned scene in the season scene plan. Planned at the season level,
 * sliced per episode for the generation loop, and elaborated into a runtime
 * SceneBlueprint (and ultimately a Scene with beats) downstream.
 */
export interface PlannedScene {
  /** Stable id, unique across the season. For encounters, this is the encounter id. */
  id: string;
  /** Episode this scene belongs to. */
  episodeNumber: number;
  /** Ordinal position within the episode (0-based), defining the planned reading order. */
  order: number;
  /** Standard scene or encounter. */
  kind: SceneKind;

  /** Short scene title / slug-like label. */
  title: string;
  /**
   * What story this scene tells and how it serves the purpose its episode
   * carries (the episode's 7-point role). This is the brief the scene is
   * written to — beats generated later must serve it.
   */
  dramaticPurpose: string;
  /** The scene's function within its episode's arc. */
  narrativeRole: SceneNarrativeRole;

  /** Primary location(s) for the scene. */
  locations: string[];
  /** NPCs expected to feature. */
  npcsInvolved: string[];

  /**
   * Planned diegetic time-of-day for the scene (canonical vocabulary:
   * dawn/morning/midday/afternoon/dusk/evening/night, synonyms normalized
   * downstream). Optional — when absent, the blueprint timeline backfill
   * infers it from scene text or inherits it from the previous scene.
   */
  timeOfDay?: string;
  /**
   * Planned gap between the previous scene and this one (e.g. "later that
   * night", "the next morning", "continuous"). Optional; derived
   * deterministically when absent.
   */
  timeJump?: string;

  /**
   * Scene ids (this season) that this scene PLANTS for — i.e. setups this scene
   * establishes that a later scene discharges. The forward half of the
   * setup/payoff graph.
   */
  setsUp: string[];
  /**
   * Scene ids (this season) whose setups this scene DISCHARGES. The backward
   * half of the setup/payoff graph. A payoff scene should list at least one.
   */
  paysOff: string[];

  /** What's narratively at stake in this scene. */
  stakes?: string;

  /**
   * The act this scene belongs to, copied from the episode/treatment for
   * planning context. Optional — not all sources label acts.
   */
  actLabel?: string;
  /** The arc this scene belongs to, copied for planning context. */
  arcLabel?: string;

  /**
   * Present iff `kind === 'encounter'`. Carries the encounter-specific plan.
   * Standard scenes leave this undefined.
   */
  encounter?: PlannedSceneEncounter;

  // --- Authored-treatment fidelity ("expand, do not rewrite") ---

  /**
   * Authored units this scene MUST depict, bound here from the treatment's
   * episode turns / signature moments (Phase 3 / §5). Beats generated downstream
   * must realize every entry; the model invents only the connective tissue
   * around them. Undefined/empty for from-scratch runs and scenes the treatment
   * is silent on (inference is allowed and expected there).
   */
  requiredBeats?: RequiredBeat[];
  /**
   * A single staged signature device/image the prose MUST show in this scene
   * (e.g. the Ep1 joined-blood archive floor). Convenience surface for the most
   * important `tier: 'signature'` beat; the SignatureDevicePresenceValidator
   * asserts it lands in final prose and is not inverted.
   */
  signatureMoment?: string;

  /**
   * The dramatic center of this scene. For treatment runs this is usually the
   * authored episode turn bound to the scene; otherwise it is inferred from the
   * planned scene purpose, role, stakes, encounter, or choice pressure.
   */
  turnContract?: SceneTurnContract;

  /**
   * Relationship pacing contracts for NPC/group bonds this scene is allowed to
   * advance. Writer/choice agents use these to keep instant chemistry distinct
   * from earned friendship, trust, intimacy, or inner-circle membership.
   *
   * Relationship pacing is now relationship-specific sugar over the broader
   * mechanicPressure layer; validators may read both during the migration.
   */
  relationshipPacing?: RelationshipPacingContract[];

  /**
   * Hidden state changes expressed as story pressure: what on-page evidence
   * earns the state residue, what permission it creates, and what later payoffs
   * it can or cannot justify. Generator-only; never rendered to players.
   */
  mechanicPressure?: MechanicPressureContract[];

  /**
   * Treatment-field obligations assigned to this scene. This is stricter than a
   * prompt hint: validators use it to ensure authored pressure lanes, encounter
   * shape, choices, information movement, endings, and cliffhangers are consumed
   * structurally and then realized in reader-facing prose.
   */
  authoredTreatmentFields?: AuthoredTreatmentFieldContract[];

  /**
   * Top-level season-promise obligations assigned to this scene. These are
   * broader than per-episode treatment fields: genre/tone movement, logline
   * engine, premise/core fantasy, theme question, and inaction pressure.
   */
  seasonPromiseContracts?: SeasonPromiseRealizationContract[];

  /**
   * Authored stakes-architecture obligations assigned to this scene. These
   * preserve load-bearing material, relational, identity, existential,
   * escalation, prerequisite, and emotional-anchor stakes as staged pressure.
   */
  stakesArchitectureContracts?: StakesArchitectureContract[];

  /**
   * Authored cross-episode branch / consequence-chain obligations assigned to
   * this scene. These keep Section 11 branches from becoming generic route
   * labels by preserving origin choice, path state, later payoff,
   * reconvergence residue, state domains, and ending eligibility.
   */
  branchConsequenceContracts?: BranchConsequenceRealizationContract[];

  /**
   * Authored alternate-ending obligations assigned to this scene. These keep
   * Section 14 ending summaries, state drivers, target conditions, choice
   * patterns, theme payoffs, and final lines traceable into finale/route prose.
   */
  endingRealizationContracts?: EndingRealizationContract[];

  /**
   * Authored failure-mode audit obligations assigned to this scene. These keep
   * Section 15 from remaining a prose-only QA note by preserving concrete
   * mitigations for escalation, mystery, passivity, reset, coincidence, and
   * twist fairness as staged story pressure.
   */
  failureModeAuditContracts?: FailureModeAuditContract[];

  /**
   * Authored 7-point beat realization obligations assigned to this scene. These
   * ensure a scene that carries Hook/Midpoint/Climax/etc. stages the authored
   * beat events and state change, not only the structural label.
   */
  sevenPointBeatContracts?: SevenPointBeatRealizationContract[];

  /**
   * Authored arc-pressure obligations assigned to this scene. These ensure an
   * arc's question, midpoint reframe, late crisis, finale answer, handoff, and
   * episode turnout are staged as story movement, not only stored on SeasonArc.
   */
  arcPressureContracts?: ArcPressureTreatmentContract[];

  /**
   * Authored protagonist/core-character obligations assigned to this scene.
   * These keep character fields such as starting identity, Lie, Want/Need,
   * pressure points, climax choice, and ending states from remaining prompt-only.
   */
  characterTreatmentContracts?: CharacterTreatmentRealizationContract[];

  /**
   * Authored world/location obligations assigned to this scene. These keep
   * load-bearing setting rules, factions, location purpose/history, and location
   * choice pressure from remaining prompt-only.
   */
  worldTreatmentContracts?: WorldTreatmentRealizationContract[];

  // --- Season choice/consequence budget (allocated at plan time) ---

  /**
   * Whether this scene carries a budgeted central choice. Always true for
   * encounters; true for standard scenes that the budget allocator marks as
   * choice-bearing. Tactical choices inside an encounter are NOT budgeted units
   * ("budget the spine, not the texture").
   */
  hasChoice?: boolean;
  /**
   * The dramatic role of this unit's central choice. Drives the weighted choice
   * mix against {@link CHOICE_TYPE_TARGET}. Encounters are never 'expression'.
   */
  choiceType?: ChoiceType;
  /**
   * How deep this unit's consequence reaches. Drives the weighted consequence
   * mix against {@link CONSEQUENCE_TARGET}, subject to the per-type invariants.
   */
  consequenceTier?: ConsequenceTier;
  /**
   * This unit's share of the weighted budget: {@link SCENE_BUDGET_WEIGHT} for a
   * standard choice-scene, {@link ENCOUNTER_BUDGET_WEIGHT} for an encounter (a
   * concentrated, intense serving of one role). All budgets are measured on
   * weighted totals.
   */
  budgetWeight?: number;

  // --- Consequence-intelligence diagnostics (default-off; Plan Part 4/9) ---

  /**
   * Diagnostics only: the aggregated inbound dramatic charge at this scene
   * (`charge(scene)` from the Convergence Ledger). Populated by later phases when
   * `CONSEQUENCE_CHARGE`/`CONVERGENCE_LEDGER` are on; never read by the player.
   */
  chargeScore?: number;
  /**
   * Diagnostics only: a short human-readable explanation of WHY this unit's
   * consequence tier was chosen (e.g. "elevated by major promise payoff" or
   * "demoted: under-charged"). For the diagnostics trail, not behavior.
   */
  tierRationale?: string;
}

/**
 * A directed setup -> payoff edge in the season scene plan. Derived from the
 * `setsUp`/`paysOff` arrays on PlannedScene; materialized here so validators and
 * branch/consequence budgeting can traverse the graph without re-deriving it.
 */
export interface SetupPayoffEdge {
  /** Scene id that plants the setup. */
  from: string;
  /** Scene id that discharges it. */
  to: string;
  /** What is being set up and paid off (human-readable). */
  description?: string;
  /**
   * Relationship of payoff to the setup's episode. `same_episode` resolves
   * within one episode; `cross_episode` spans episodes (the case impossible to
   * plan before scene-first planning existed).
   */
  span: 'same_episode' | 'cross_episode';
}

/**
 * The season-wide scene spine: every planned scene across the season, in order,
 * plus the resolved setup/payoff graph. Stored on the SeasonPlan; each episode
 * also carries its own slice via {@link SeasonEpisode.plannedScenes}.
 */
export interface SeasonScenePlan {
  /** All planned scenes across the season, in planned order. */
  scenes: PlannedScene[];
  /** Scene ids grouped by episode number, preserving per-episode order. */
  byEpisode: Record<number, string[]>;
  /** Resolved setup -> payoff edges across the whole season. */
  setupPayoffEdges: SetupPayoffEdge[];
  /** Parsed treatment-field obligations assigned across the scene plan. */
  authoredTreatmentFields?: AuthoredTreatmentFieldContract[];
  /** Top-level season-promise obligations assigned across the scene plan. */
  seasonPromiseContracts?: SeasonPromiseRealizationContract[];
  /** Top-level stakes architecture obligations assigned across the scene plan. */
  stakesArchitectureContracts?: StakesArchitectureContract[];
  /** Authored cross-episode branch / consequence-chain obligations assigned across the scene plan. */
  branchConsequenceContracts?: BranchConsequenceRealizationContract[];
  /** Authored alternate-ending obligations assigned across the scene plan. */
  endingRealizationContracts?: EndingRealizationContract[];
  /** Authored failure-mode audit obligations assigned across the scene plan. */
  failureModeAuditContracts?: FailureModeAuditContract[];
  /** Authored 7-point beat realization obligations assigned across the scene plan. */
  sevenPointBeatContracts?: SevenPointBeatRealizationContract[];
  /** Authored arc-pressure obligations assigned across the scene plan. */
  arcPressureContracts?: ArcPressureTreatmentContract[];
  /** Protagonist/core-character obligations assigned across the scene plan. */
  characterTreatmentContracts?: CharacterTreatmentRealizationContract[];
  /** World/location obligations assigned across the scene plan. */
  worldTreatmentContracts?: WorldTreatmentRealizationContract[];
}

/**
 * Re-export for callers that build a scene plan from the still-present
 * StructuralRole assignment on episodes. Scenes do not carry a role themselves;
 * this is here purely so scene-plan builders can read the episode's role when
 * authoring `dramaticPurpose`.
 */
export type { StructuralRole };

// ========================================
// SEASON BUDGET TARGETS & CONSTANTS
// ========================================

/**
 * Target distribution of the weighted choice mix across budgeted units, as
 * percentages summing to 100. Encounters claim their non-expression slots
 * first, which auto-skews standard scenes toward expression/relationship.
 */
export const CHOICE_TYPE_TARGET: {
  expression: number;
  relationship: number;
  strategic: number;
  dilemma: number;
} = { expression: 35, relationship: 30, strategic: 20, dilemma: 15 };

/**
 * Target distribution of the weighted consequence mix across budgeted units, as
 * percentages summing to 100. Unified across scenes and encounters; branch /
 * branchlet sit higher than the old scenes-only split because encounters
 * legitimately branch.
 */
export const CONSEQUENCE_TARGET: Record<ConsequenceTier, number> = {
  callback: 50,
  tint: 25,
  branchlet: 17,
  branch: 8,
};

/**
 * Scene-ONLY consequence texture target (Plan Part 3, Layer D — the
 * two-population calibration fix). The legacy {@link CONSEQUENCE_TARGET} above is
 * a *unified* target measured across scenes AND encounters together; it
 * mis-calibrates under encounter load because heavy encounters alone can exceed
 * the unified heavy-tier %. This target governs the STANDARD-SCENE texture
 * population only — encounters are budgeted by their own invariant (branch-point
 * → `branch`; others → `branchlet`, escalating at pinch2/climax), not against a
 * scene-texture %. It reserves a small, deliberate number of non-encounter
 * majors (branchlet 8 / branch 2).
 *
 * Consumed by the two-population allocator/validator under `CONSEQUENCE_TWO_POP`
 * (default-off). With the flag unset, {@link CONSEQUENCE_TARGET} remains the only
 * target in effect.
 */
export const SCENE_CONSEQUENCE_TARGET: Record<ConsequenceTier, number> = {
  callback: 60,
  tint: 30,
  branchlet: 8,
  branch: 2,
};

/** Weighted budget share of a standard choice-bearing scene. */
export const SCENE_BUDGET_WEIGHT = 1;

/**
 * Weighted budget share of an encounter — a concentrated serving of one role,
 * counted as three scene-choices' worth ("dramatic diet").
 */
export const ENCOUNTER_BUDGET_WEIGHT = 3;

/**
 * Per-type tolerance (in percentage points) the weighted mix may drift from
 * target before the budget validator complains: `warn` raises an advisory,
 * `error` is the hard-gate threshold (gated behind GATE_SEASON_BUDGETS).
 */
export const BUDGET_TOLERANCE = { warn: 15, error: 25 };
