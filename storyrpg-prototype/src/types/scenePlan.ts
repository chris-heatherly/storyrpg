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
  /** How fixed this beat is — see {@link RequiredBeat}. */
  tier: 'signature' | 'authored' | 'connective';
}

/**
 * Encounter detail carried by a `kind: 'encounter'` scene. Absorbs the fields
 * of the legacy season-level PlannedEncounter so encounters no longer need a
 * parallel list — the scene id IS the encounter id.
 */
export interface PlannedSceneEncounter {
  /** What kind of encounter. */
  type: EncounterCategory;
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
