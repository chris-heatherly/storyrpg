/**
 * Story Architect Agent
 *
 * The master narrative designer responsible for:
 * - Creating episode blueprints with scene graphs
 * - Designing branch-and-bottleneck structure
 * - Establishing narrative arcs and pacing
 * - Defining major choice points and their stakes
 */

import { AgentConfig, GenerationSettingsConfig } from '../config';
import {
  StoryAnchors,
  EncounterStoryCircleTarget,
  EncounterStoryCircleTargetEvidence,
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
  STORY_CIRCLE_BEATS,
  TreatmentEpisodeGuidance,
  ThemeArgumentContract,
} from '../../types/sourceAnalysis';
import { BaseAgent, AgentResponse, AgentMessage, TruncatedLLMResponseError } from './BaseAgent';
import {
  BRANCH_AND_BOTTLENECK,
  CRAFT_PRESSURE_GUIDANCE,
  CORE_DRAMATIC_STRUCTURE_RULES,
  buildStructuralContextSection as buildSharedStructuralContextSection,
  buildGenreAwareJeopardyGuidance,
} from '../prompts/storytellingPrinciples';
import { STORY_ARCHITECT_BLUEPRINT_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import { PLACEHOLDER_STAKES, isPlaceholderStake } from '../constants/placeholderStakes';
import type { EncounterCost, EncounterNarrativeStyle, EncounterType, NarrativeSequenceIntent, StakesLayers } from '../../types';
import type {
  ArcEpisodeTurnout,
  CliffhangerPlan,
  InformationLedgerEntry,
  SeasonPromiseArchitecture,
  SeasonResidueObligation,
} from '../../types/seasonPlan';
import { assignInfoLedgerPhasesToScenes } from '../pipeline/infoRevealAssignment';
import {
  normalizeCharacterSlug,
  resolveCharacterIntroMode,
  resolveEnsembleNpcIdsFromText,
  resolveRosterCharacter,
  isNamedIntroductionStaging,
  isGlimpseNameDrop,
  type CharacterIntroMode,
} from '../utils/npcIntroductionLedger';
import { MIN_SCENES_PER_EPISODE } from '../pipeline/seasonScenePlanBuilder';
import { assignBlueprintTimeline, normalizeTimeOfDay, prettifyEmbeddedLocationIds, type SceneTimeOfDay } from '../utils/sceneTimeline';
import { extractEpisodeInvariants } from '../utils/episodeInvariants';
import { buildEncounterEventSignature, compareEncounterEventSignatures } from '../utils/encounterEventSignature';
import { applySceneContract, isGenericScenePlannerText, isQuestionShapedTurnText } from '../utils/sceneContractBuilders';
import { collectColdOpenProfileIssues } from '../utils/coldOpenProfile';
import type { ResidueRequirement } from '../pipeline/reconvergenceResidue';
import type { TreatmentEventAtom } from '../../types/treatmentEvent';
import type {
  PlannedScene,
  SetupPayoffEdge,
  SceneNarrativeRole,
  RequiredBeat,
  ArcPressureTreatmentContract,
  AuthoredTreatmentFieldContract,
  BranchConsequenceRealizationContract,
  CharacterTreatmentRealizationContract,
  ColdOpenProfile,
  EndingRealizationContract,
  FailureModeAuditContract,
  MechanicPressureContract,
  RelationshipPacingContract,
  SceneConstructionProfile,
  SceneEventOwnershipProfile,
  SceneTurnContract,
  SeasonPromiseRealizationContract,
  StoryCircleBeatRealizationContract,
  StakesArchitectureContract,
  WorldTreatmentRealizationContract,
} from '../../types/scenePlan';
import type { EpisodeSpineContract, EncounterSpineProfile } from '../../types/episodeSpine';
import type {
  EpisodeEventPlan,
  NarrativeContractGraph,
  NarrativeCharacterPresenceContract,
  NarrativeCharacterRoleConstraint,
  NarrativeIdentityScheduleContract,
  NarrativeRealizationTask,
} from '../../types/narrativeContract';
import type { CharacterArchitecture, EndingMode, StoryEndingTarget } from '../../types/sourceAnalysis';
import { TreatmentFidelityValidator } from '../validators/TreatmentFidelityValidator';
import { DramaticStructureValidator } from '../validators/DramaticStructureValidator';
import { ThemePressureValidator } from '../validators/ThemePressureValidator';
import { SceneTurnContractValidator } from '../validators/SceneTurnContractValidator';
import { EpisodePressureArchitectureValidator } from '../validators/EpisodePressureArchitectureValidator';
import { EpisodeStoryCircleValidator, hasConcreteStoryCircleBeatText } from '../validators/EpisodeStoryCircleValidator';
import { BlueprintContractHygieneValidator } from '../validators/BlueprintContractHygieneValidator';
import { SceneOwnershipPreflightValidator } from '../validators/SceneOwnershipPreflightValidator';
import { EpisodeSpineContractValidator } from '../validators/EpisodeSpineContractValidator';
import type { PipelineFailureMetadata } from '../pipeline/errors';
import {
  analyzeEpisodeTreatmentDensity,
  describeTreatmentDensityReport,
  isUnsafeTreatmentDensityReport,
  type TreatmentDensityReport,
} from '../remediation/gateRepairRouter';
import { isGateEnabled } from '../remediation/gateDefaults';
import { classifyTreatmentObligation } from '../validators/treatmentObligationClassifier';
import { treatmentFieldTokens } from '../utils/treatmentFieldContracts';
import { storyCircleRoleBeats } from '../utils/storyCircleDistribution';
import { buildScopedEpisodeCircle } from '../utils/episodeCircleBuilder';
import {
  buildEncounterStoryCircleTargetRationale,
  isEncounterStoryCircleTarget,
  normalizeEncounterStoryCircleTarget,
} from '../utils/encounterStoryCircleTarget';
import {
  rebindPlannedSceneObligations,
  type PlannedSceneBindingReport,
} from '../remediation/plannedSceneObligationBinder';
import {
  arcPressureContractTargetsEpisode,
  isSceneBoundArcPressureKind,
} from '../utils/arcPressureContracts';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import {
  buildEpisodeCircleBeatContracts,
  normalizeStoryCircleContractForSceneProse,
  type EpisodeCircleContractScene,
} from '../utils/storyCircleBeatContracts';
import {
  BLUEPRINT_SCANNED_SCENE_FIELDS,
  isBlueprintHygieneUnsafeText,
  pickBlueprintSafeText,
  sanitizeBlueprintText,
} from '../utils/blueprintTextHygiene';
import { applySceneConstructionProfilesToScenes } from '../utils/sceneConstructionProfile';
import {
  attachSceneEventOwnershipProfiles,
  repairCausalCueOwnershipOrder,
} from '../utils/sceneEventOwnership';
import { reprojectEpisodeEventPlan, validateCanonicalEpisodeBlueprintProjection } from '../pipeline/narrativeContractCompiler';
import { finalizeEpisodeSceneOwnership } from '../utils/episodeSceneOwnership';
import { normalizeRelationshipPacingStages } from '../utils/relationshipPacingStagePolicy';
import { getFlagRegistry } from '../pipeline/flagRegistry';
import { getStoryLexicon, lexiconAlternation } from '../config/storyLexicon';
import {
  detectPrimaryStoryEventCues,
  STORY_EVENT_CUE_DESCRIPTIONS,
  STORY_EVENT_CUE_ORDER,
  type StoryEventCue,
} from '../remediation/storyEventCues';

/**
 * Smallest episode (by scene count) that should be asked to carry a SECOND
 * scene-graph branch. Below this, a single branch-and-bottleneck is all the
 * scene budget can support without starving scenes; at or above it there is
 * room for an arm to diverge for a span and reconverge, then branch again.
 * The default branch floor scales 1→2 at this threshold (see
 * {@link StoryArchitect.effectiveMinBranchesPerEpisode}); an explicit
 * `minSceneGraphBranchesPerEpisode` override is always respected when higher.
 */
const BRANCH_FLOOR_2_MIN_SCENES = 6;
const MAX_BINDER_SPLIT_SCENE_CAP_EXTENSION = 4;
export const EPISODE_BLUEPRINT_SCENE_OWNERSHIP_VERSION = 'episode-scene-ownership-v2';

function collapseUnplannedCanonicalSceneShells(
  scenes: PlannedScene[],
  eventPlan: EpisodeEventPlan,
): PlannedScene[] {
  const allowedIds = new Set(eventPlan.sceneOrder);
  const committed = scenes.filter((scene) => allowedIds.has(scene.id));
  const extras = scenes.filter((scene) => !allowedIds.has(scene.id));
  if (extras.length === 0) return committed;

  // The obligation binder can create a helper while splitting a broad treatment
  // summary. Canonical planning has already decided the complete scene set, so a
  // helper with no depiction assignment is metadata to fold into its nearest
  // committed scene, never a new event owner.
  for (const extra of extras) {
    const target = committed
      .filter((scene) => scene.order <= extra.order)
      .sort((a, b) => b.order - a.order)[0]
      ?? committed.slice().sort((a, b) => a.order - b.order)[0];
    if (!target) continue;

    target.requiredBeats = [...(target.requiredBeats ?? []), ...(extra.requiredBeats ?? [])]
      .filter((beat, index, beats) => beats.findIndex((candidate) => candidate.id === beat.id) === index);
    target.authoredTreatmentFields = [
      ...(target.authoredTreatmentFields ?? []),
      ...(extra.authoredTreatmentFields ?? []).map((field) => ({
        ...field,
        targetSceneIds: [target.id],
      })),
    ].filter((field, index, fields) => fields.findIndex((candidate) => candidate.id === field.id) === index);
    target.narrativeConstraints = Array.from(new Set([
      ...(target.narrativeConstraints ?? []),
      ...(extra.narrativeConstraints ?? []),
    ].filter(Boolean)));
    target.mechanicPressure = [
      ...(target.mechanicPressure ?? []),
      ...(extra.mechanicPressure ?? []),
    ];
    target.relationshipPacing = [
      ...(target.relationshipPacing ?? []),
      ...(extra.relationshipPacing ?? []),
    ];
    target.setsUp = Array.from(new Set([...(target.setsUp ?? []), ...(extra.setsUp ?? [])]));
    target.paysOff = Array.from(new Set([...(target.paysOff ?? []), ...(extra.paysOff ?? [])]));
  }

  return committed.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// Input types
export interface StoryArchitectInput {
  /** Explicit generation mode; authored modes may never fall back to invent-mode. */
  sourceKind?: 'invent' | 'authored' | 'authored_lite' | 'derived_from_lite';
  // Story context
  storyTitle: string;
  genre: string;
  synopsis: string;
  tone: string;

  // Episode details
  episodeNumber: number;
  episodeTitle: string;
  episodeSynopsis: string;

  // Characters available
  protagonistDescription: string;
  availableNPCs: Array<{
    id: string;
    name: string;
    description?: string;
    role?: string;
    relationshipContext?: string;
    initialRelationship?: Partial<Record<'trust' | 'affection' | 'respect' | 'fear', number>>;
  }>;

  // World context
  worldContext: string;
  currentLocation: string;

  // Previous episode context (if any)
  previousEpisodeSummary?: string;

  // Constraints (caps—engine may generate fewer)
  targetSceneCount: number; // Max scenes per episode (cap)
  majorChoiceCount: number; // Suggested 2-3 major choices per episode

  // Pacing preferences
  pacing?: 'tight' | 'moderate' | 'expansive';

  // User instructions
  userPrompt?: string;

  /**
   * Season-level narrative anchors (from SeasonPlan.anchors). When present,
   * StoryArchitect keeps the episode's drama grounded to the same stakes,
   * goal, and final climax the rest of the pipeline targets.
   */
  seasonAnchors?: StoryAnchors;

  /**
   * Season-level Story Circle beat map (from SeasonPlan.storyCircle). This is
   * the primary macro structure for the episode blueprint.
   */
  seasonStoryCircle?: StoryCircleStructure;

  /**
   * Which Story Circle beat(s) this episode carries at the season level.
   * Longer seasons may pass expansion roles; shorter seasons may fuse adjacent
   * primary beats.
   */
  episodeStoryCircleRole?: StoryCircleRoleAssignment[];

  /**
   * Role-mapped episode ending contract. The final non-encounter scene should
   * resolve the episode's immediate tension, then open this hook.
   */
  cliffhangerPlan?: CliffhangerPlan;

  // Season plan data (encounter and branching directives from the master blueprint)
  seasonPlanDirectives?: {
    endingMode?: EndingMode;
    resolvedEndings?: StoryEndingTarget[];
    // Planned encounters for this episode
    plannedEncounters?: Array<{
      id: string;
      type: string;
      description: string;
      difficulty: string;
      npcsInvolved: string[];
      stakes: string;
      centralConflict?: string;
      storyCircleTarget?: EncounterStoryCircleTarget;
      storyCircleTargetRationale?: string;
      storyCircleTargetEvidence?: EncounterStoryCircleTargetEvidence;
      aftermathConsequence?: string;
      relevantSkills: string[];
      encounterBuildup?: string;
      encounterSetupContext?: string[];
      isBranchPoint: boolean;
      branchOutcomes?: {
        victory: string;
        defeat: string;
        escape?: string;
      };
      encounterProfile?: EncounterSpineProfile;
    }>;
    // Difficulty tier for this episode
    difficultyTier?: string;
    // Cross-episode branch effects that apply to this episode
    incomingBranchEffects?: Array<{
      branchName: string;
      pathName: string;
      impact: string;
      description: string;
    }>;
    // Flags this episode should set for later episodes
    flagsToSet?: Array<{ flag: string; description: string }>;
    // Flags from earlier episodes this episode should check
    flagsToCheck?: Array<{ flag: string; ifTrue: string; ifFalse: string }>;
    // Consequence chain effects that land in this episode
    consequenceEffects?: Array<{
      description: string;
      severity: string;
    }>;
    endingRoutes?: Array<{
      endingId: string;
      role: 'opens' | 'reinforces' | 'threatens' | 'locks';
      description: string;
    }>;
    treatmentGuidance?: TreatmentEpisodeGuidance;
    growthContext?: {
      focusSkills: string[];
      developmentScene: string;
      mentorshipOpportunity?: {
        npcId: string;
        npcName: string;
        requiredRelationship: { dimension: string; threshold: number };
        attribute: string;
        narrativeHook: string;
      } | null;
    };
    arcPressure?: {
      arcId: string;
      arcName: string;
      arcQuestion?: string;
      seasonQuestionRelation?: string;
      identityPressureFacet?: string;
      midpointRecontextualization?: {
        episodeNumber: number;
        questionBefore: string;
        questionAfter: string;
        description: string;
      };
      lateArcCrisis?: {
        episodeNumber: number;
        apparentFailure: string;
        irreversibleCost: string;
        description: string;
      };
      finaleAnswer?: string;
      handoffPressure?: string;
      episodeTurnout?: ArcEpisodeTurnout;
    };
    characterArchitecture?: CharacterArchitecture;
    characterTreatmentContracts?: CharacterTreatmentRealizationContract[];
    worldTreatmentContracts?: WorldTreatmentRealizationContract[];
    stakesArchitectureContracts?: StakesArchitectureContract[];
    storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
    arcPressureContracts?: ArcPressureTreatmentContract[];
    branchConsequenceContracts?: BranchConsequenceRealizationContract[];
    endingRealizationContracts?: EndingRealizationContract[];
    failureModeAuditContracts?: FailureModeAuditContract[];
    incomingResidue?: SeasonResidueObligation[];
    outgoingResidue?: SeasonResidueObligation[];
    dueResidue?: SeasonResidueObligation[];
    themeArgument?: ThemeArgumentContract;
    seasonPromiseArchitecture?: SeasonPromiseArchitecture;
    seasonPromiseContracts?: SeasonPromiseRealizationContract[];
    informationLedgerEntries?: InformationLedgerEntry[];
    /**
     * Scene-first planning: this episode's scenes, enumerated at the season
     * level (encounters included as `kind: 'encounter'`). When present,
     * StoryArchitect ELABORATES these into the scene graph instead of inventing
     * scenes from the episode's beat. The setup/payoff edges that touch this
     * episode are provided so the graph can honor cross-scene relationships.
     */
    plannedScenes?: PlannedScene[];
    setupPayoffEdges?: SetupPayoffEdge[];
    /** Episode Spine Contract for this episode when treatment-sourced. */
    episodeSpine?: EpisodeSpineContract;
    /** Immutable canonical event ownership and chronology projection. */
    episodeEventPlan?: EpisodeEventPlan;
    /** Source graph required to restore the immutable ownership projection after LLM parsing. */
    narrativeContractGraph?: NarrativeContractGraph;
  };

  /**
   * Characters the season plan schedules THIS episode to introduce (from
   * `SeasonEpisode.introducesCharacters` / `SeasonPlan.characterIntroductions`).
   * The blueprint guarantees each one an on-page introduction key beat
   * ({@link StoryArchitect.ensureCharacterIntroductionBeats}).
   */
  introducesCharacters?: Array<{ id: string; name: string }>;

  // Pipeline memory context (optimization hints from prior runs, Claude only)
  memoryContext?: string;
}

interface StoryArchitectRetryState {
  contractAttempts: number;
  formatAttempts: number;
}

type PlannedEncounterDirective = NonNullable<NonNullable<StoryArchitectInput['seasonPlanDirectives']>['plannedEncounters']>[number];

export type DramaticTurnDriver =
  | 'protagonist'
  | 'player_choice'
  | 'npc'
  | 'antagonist'
  | 'world'
  | 'coincidence';

export type InformationOwner =
  | 'player'
  | 'audience'
  | 'protagonist'
  | 'ally'
  | 'antagonist'
  | 'world';

export type ResidueType =
  | 'information'
  | 'relationship'
  | 'identity'
  | 'resource'
  | 'danger'
  | 'promise'
  | 'wound'
  | 'reputation'
  | 'access';

export type EpisodeTurnType =
  | 'reversal'
  | 'revelation'
  | 'escalation'
  | 'choice'
  | 'cost'
  | 'payoff';

export type BPlotMode =
  | 'scene'
  | 'underlay'
  | 'offscreen_pressure';

export type CPlotFunction =
  | 'future_seed'
  | 'callback'
  | 'world_pressure'
  | 'tonal_counterweight';

export type CPlotTargetPayoff =
  | 'later_scene'
  | 'later_episode'
  | 'later_arc'
  | 'season';

export interface EpisodePressureLaneA {
  externalPressure: string;
  climaxIntersection: string;
}

export interface EpisodePressureLaneB {
  mode: BPlotMode;
  relationshipOrIdentityPressure: string;
  offscreenNpcMotivation?: string;
  protagonistVisibleSignals: string[];
  scenesOrEpisodes?: string[];
  climaxIntersection: string;
}

export interface EpisodePressureLaneC {
  function: CPlotFunction;
  seed: string;
  visiblePlant: string;
  payoffPlan: string;
  targetPayoff?: CPlotTargetPayoff;
}

export interface EpisodePressureLanes {
  aPlot: EpisodePressureLaneA;
  bPlot?: EpisodePressureLaneB;
  cPlot?: EpisodePressureLaneC;
}

export interface OpeningPromise {
  hook: string;
  episodePromise: string;
  activePressure: string;
  optionalStakes?: string;
}

export interface DramaticStructureAudit {
  episodeQuestion: string;
  episodeQuestionSetup?: string;
  episodeQuestionAnswer?: string;
  themeQuestion?: string;
  themePressure: string;
  themeAngle?: string;
  themeChoicePressure?: string;
  openingPromise?: OpeningPromise;
  episodePressureLanes?: EpisodePressureLanes;
  episodeEndStateDelta?: string;
  nextEpisodePressure?: string;
  personalStake: string;
  stakesLayers?: StakesLayers;
  majorTurns: Array<{
    id: string;
    description: string;
    driver: DramaticTurnDriver;
    protagonistInfluence: string;
    turnType?: EpisodeTurnType;
    closesQuestion?: string;
    opensQuestion?: string;
    memorableImageOrLine?: string;
  }>;
  informationPlan: Array<{
    item: string;
    knownBy: InformationOwner[];
    revealTiming: string;
    payoff: string;
  }>;
}

export interface SceneDramaticStructure {
  question: string;
  turn: string;
  pressurePeak: string;
  changedState: string;
}

export interface SceneTransitionOut {
  toSceneId: string;
  connector: 'therefore' | 'but';
  causalLink: string;
  pressureChange: string;
}

export interface SceneResidue {
  type: ResidueType;
  description: string;
}

// Output types
export interface SceneBlueprint {
  id: string;
  name: string;
  description: string;
  location: string;
  mood: string;
  purpose: 'bottleneck' | 'branch' | 'transition';

  /**
   * Planned diegetic time-of-day for the scene. Assigned by the LLM at plan
   * time (invention path) or carried from the planned scene (elaborate path);
   * gaps are backfilled deterministically by {@link assignBlueprintTimeline}
   * (text inference, then inheritance from the previous scene). Never
   * fabricated — stays undefined when no scene ever names a time.
   */
  timeOfDay?: SceneTimeOfDay;
  /**
   * Planned gap between the previous scene and this one (e.g. "continuous",
   * "later that night", "the next morning"). Drives the SceneWriter transition
   * handoff: when this names a jump, the scene's opening must acknowledge it.
   */
  timeJumpFromPrevious?: string;

  // Expert Design Elements
  dramaticQuestion: string; // What are we here to find out?
  wantVsNeed: string; // Protagonist's conscious goal vs dramatic necessity
  conflictEngine: string; // What or who opposes them in this scene?
  dramaticStructure?: SceneDramaticStructure;
  personalStake?: string;
  themePressure?: string;
  narrativeConstraints?: string[];
  stakesLayers?: StakesLayers;
  transitionOut?: SceneTransitionOut[];
  residue?: SceneResidue[];

  // NPCs present in this scene
  npcsPresent: string[];
  /** Immutable generator-only character presence policy for first-contact surfaces. */
  characterPresenceContracts?: NarrativeCharacterPresenceContract[];
  identityScheduleContracts?: NarrativeIdentityScheduleContract[];
  characterRoleConstraints?: NarrativeCharacterRoleConstraint[];

  // Narrative function
  narrativeFunction: string;

  // === SCENE-FIRST PLANNING ===
  // Populated when the scene came from the season-level scene plan (elaborate
  // mode) rather than being invented here. These let SceneWriter author beats
  // that serve the scene's planned purpose and discharge the right setups.
  // The scene's dramatic function within its episode's arc.
  narrativeRole?: SceneNarrativeRole;
  // Generator-only provenance for scenes inserted by the treatment binder.
  planningOrigin?: PlannedScene['planningOrigin'];
  /** Typed non-owning behavior that must be concretized inside the primary event. */
  behavioralIntents?: PlannedScene['behavioralIntents'];
  // Elaborate-mode planned-scene choice budget hint. Used only for validation
  // and repair policy; player-facing scenes never render this directly.
  plannedHasChoice?: boolean;
  // Planning-only statement of what story this scene tells (the brief beats serve).
  dramaticPurpose?: string;
  // Scene ids (this season) this scene plants for / discharges.
  setsUp?: string[];
  paysOff?: string[];

  // Authored INFO-ledger reveals assigned to land on-page in THIS scene (Step 1 of the
  // info-reveal pipeline). Set deterministically by assignInfoRevealsToScenes for each
  // ledger entry whose plannedRevealEpisode is this episode. SceneWriter dramatizes them
  // (Step 2) and emitSceneInfoReveals flags them (Step 3) so the schedule validator can
  // confirm the reveal landed. Empty/undefined when no reveal is scheduled here.
  revealsInfoIds?: string[];
  setsUpInfoIds?: string[];
  paysOffInfoIds?: string[];

  // === AUTHORED-TREATMENT FIDELITY ("expand, do not rewrite") ===
  // Carried verbatim from PlannedScene when the run is treatment-sourced so
  // SceneWriter can render an explicit "depict each, in order" required-beats
  // checklist (plan §5.4 / GAP-B). Undefined/empty for from-scratch runs and
  // scenes the treatment is silent on — the SceneWriter prompt is then unchanged.
  requiredBeats?: RequiredBeat[];
  treatmentAtomIds?: string[];
  ownedChronologyKeys?: string[];
  sourceContextIds?: string[];
  nonCopyableContext?: Array<Pick<TreatmentEventAtom, 'id' | 'sourceText' | 'eventText' | 'sourceSection'>>;
  signatureMoment?: string;
  turnContract?: SceneTurnContract;
  coldOpenProfile?: ColdOpenProfile;
  sceneConstructionProfile?: SceneConstructionProfile;
  sceneEventOwnership?: SceneEventOwnershipProfile;
  narrativeEventIds?: string[];
  narrativeEventOrder?: number;
  narrativeEventPlanVersion?: number;
  /** Structured elaboration acknowledgement; always constrained by the episode plan. */
  realizedEventIds?: string[];
  /** Immutable canonical event assignment for this scene. */
  assignedEventIds?: string[];
  /** Story Architect/SceneWriter claims, distinct from prose verification. */
  claimedEventIds?: string[];
  /** Deterministic prose-gate output; architecture does not author this field. */
  verifiedEventIds?: string[];
  supportingContractIds?: string[];
  /** Blocking reader-facing evidence compiled from the owning event contracts. */
  canonicalEvidenceRequirements?: Array<{
    eventId: string;
    kind: string;
    acceptedPatterns: string[];
    requiredSurface?: string;
  }>;
  /** Immutable owner-stage realization tasks projected from the canonical graph. */
  realizationTasks?: NarrativeRealizationTask[];
  relationshipPacing?: RelationshipPacingContract[];
  mechanicPressure?: MechanicPressureContract[];
  authoredTreatmentFields?: AuthoredTreatmentFieldContract[];
  seasonPromiseContracts?: SeasonPromiseRealizationContract[];
  stakesArchitectureContracts?: StakesArchitectureContract[];
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
  arcPressureContracts?: ArcPressureTreatmentContract[];
  branchConsequenceContracts?: BranchConsequenceRealizationContract[];
  endingRealizationContracts?: EndingRealizationContract[];
  failureModeAuditContracts?: FailureModeAuditContract[];
  characterTreatmentContracts?: CharacterTreatmentRealizationContract[];
  worldTreatmentContracts?: WorldTreatmentRealizationContract[];
  residueObligationIds?: string[];
  recommendedBeatCount?: number;
  // Treatment invariants — lines the prose must HOLD (events the episode states must
  // NOT happen, e.g. "she does not go home with him"). Advisory SceneWriter guidance;
  // empty for from-scratch runs and episodes with no stated negative constraint.
  invariants?: string[];

  // Key beats to hit
  keyBeats: string[];
  sequenceIntent?: NarrativeSequenceIntent;

  // Choice point (if any)
  choicePoint?: {
    type: 'expression' | 'relationship' | 'strategic' | 'dilemma';
    // Whether this choice point should route to different scenes.
    // Only non-expression types may branch. Capped per episode.
    branches?: boolean;
    stakes: {
      want: string;
      cost: string;
      identity: string;
    };
    stakesLayers?: StakesLayers;
    themeAnswer?: string;
    description: string;
    optionHints: string[];
    consequenceDomain?: 'relationship' | 'reputation' | 'danger' | 'information' | 'identity' | 'leverage' | 'resource';
    reminderPlan?: {
      immediate: string;
      shortTerm: string;
      later?: string;
    };
    expectedResidue?: string[];
    competenceArc?: {
      testsNow: string;
      shortfall?: string;
      growthPath?: string;
    };
    failureBranchPurpose?: 'recovery' | 'training' | 'leverage' | 'alliance' | 'investigation' | 'regrouping';
    /**
     * Authored consequence-seed flag names this choice MUST set on-page (§3.3).
     * Populated deterministically from the treatment's consequence seeds so a
     * later `treatment_seed_*` precondition can be satisfied. The choice author
     * (and the {@link emitTreatmentSeedConsequences} backstop) emits a `setFlag`
     * for each. Names match the SeasonPlannerAgent convention
     * (`treatment_seed_ep<N>_<idx>`).
     */
    setsTreatmentSeeds?: string[];
    /**
     * Ending-axis flag names (`treatment_branch_*`) this scene's choices must
     * set on-page so the season's named endings are mechanically REACHABLE.
     * These axes are declared in `seasonPlan.seasonFlags` (with a `setInEpisode`)
     * and READ by the finale's ending-route logic — but nothing set them, so the
     * endings were unreachable (Gen-4 defect). Populated deterministically by
     * {@link registerBranchAxisEmitters}; emitted as `setFlag` consequences by
     * the branch-axis backstop ({@link emitSceneBranchAxes}). Distinct from
     * `setsTreatmentSeeds` (which is the `treatment_seed_*` foreshadow channel).
     */
    setsBranchAxes?: string[];
    residueObligationIds?: string[];
  };

  // Scene connections
  leadsTo: string[]; // Scene IDs this can lead to
  requires?: string[]; // Scene IDs that must come before

  // Choice payoff context: describes what player choice leads to this scene.
  // Populate this for any scene that can be entered by a player choice, including
  // bottleneck and transition scenes. Multiple choice routes may also be bridged
  // with route metadata at assembly time.
  // Example: "Player chose to kiss Catherine on the moors"
  incomingChoiceContext?: string;

  // WS2a (reconvergence residue by construction): stamped deterministically by
  // attachResidueRequirements (pipeline/reconvergenceResidue.ts) when this scene
  // is a reconvergence target — ≥2 distinct planned paths land here (blueprint
  // leadsTo graph and/or a BranchManager reconvergence point). SceneWriter renders
  // it as a MANDATORY deliverable (an early flag-gated textVariant acknowledging
  // the incoming path) so the SceneGraphBranchValidator's missing_branch_residue
  // gate passes by construction instead of aborting the run after authoring.
  residueRequirement?: ResidueRequirement;

  // Encounter configuration (if this scene is an interactive encounter)
  isEncounter?: boolean;
  plannedEncounterId?: string;
  encounterType?: EncounterType;
  encounterStyle?: EncounterNarrativeStyle;
  encounterDescription?: string;
  encounterCentralConflict?: string;
  encounterStoryCircleTarget?: EncounterStoryCircleTarget;
  encounterStoryCircleTargetRationale?: string;
  encounterStoryCircleTargetEvidence?: EncounterStoryCircleTargetEvidence;
  encounterStakes?: string;
  encounterRequiredNpcIds?: string[];
  encounterRelevantSkills?: string[];
  encounterBeatPlan?: string[];
  encounterDifficulty?: 'easy' | 'moderate' | 'hard' | 'extreme';
  encounterPartialVictoryCost?: Partial<EncounterCost>;
  /** ESC encounter profile — stages EncounterArchitect play (e.g. staged_rescue). */
  encounterProfile?: EncounterSpineProfile;
  /** ESC unit id this scene projects, when treatment-sourced. */
  spineUnitId?: string;

  // For the encounter scene: describes the stakes and what prior scenes must establish.
  // For non-encounter scenes: describes how THIS scene specifically builds toward the episode encounter
  // (what it plants, reveals, or establishes that makes the encounter's choices more meaningful).
  encounterBuildup?: string;

  // For encounter scenes only: explicit list of flags and relationship thresholds from earlier
  // scenes that are designed to echo INSIDE the encounter as narrative shading, unlocked choices,
  // or stat bonuses. Format: "flag:<name> — <effect>", "relationship:<npcId>.<dim> <op> <n> — <effect>"
  // e.g. ["flag:defended_heathcliff — unlocks defiance choice",
  //        "relationship:hindley.trust < -20 — harshens Hindley's opening dialogue"]
  encounterSetupContext?: string[];
}

export interface EpisodeBlueprint {
  episodeId: string;
  number?: number;  // Episode number in the season
  title: string;
  synopsis: string;

  /** Episode-level Story Circle summary retained for validators that aggregate blueprint text. */
  arc: StoryCircleStructure;

  /**
   * Episode-level Story Circle. This must fill all eight beats so each episode
   * has its own complete loop.
   */
  episodeCircle?: StoryCircleStructure;

  /**
   * Season-level Story Circle beat(s) this episode carries.
   */
  storyCircleRole?: StoryCircleRoleAssignment[];

  // Themes to weave through
  themes: string[];
  dramaticAudit?: DramaticStructureAudit;

  // Scene graph
  scenes: SceneBlueprint[];
  startingSceneId: string;
  treatmentBindingReport?: PlannedSceneBindingReport;
  /** Immutable canonical event plan used to produce this blueprint. */
  episodeEventPlan?: EpisodeEventPlan;
  sceneOwnershipStamp?: {
    version: string;
    finalizedAt: string;
    source: 'story_architect' | 'pipeline_resume';
    issues: string[];
    drainedRequiredBeatIds: string[];
  };

  // Branch structure
  bottleneckScenes: string[]; // Scene IDs that all paths must pass through

  // State tracking hints
  suggestedFlags: Array<{ name: string; description: string }>;
  suggestedScores: Array<{ name: string; description: string }>;
  suggestedTags: Array<{ name: string; description: string }>;

  // Consequence hints for future episodes
  narrativePromises: Array<{
    description: string;
    setupScene: string;
    importance: 'minor' | 'moderate' | 'major';
  }>;
}

export class StoryArchitect extends BaseAgent {
  private failureMetadata(
    failure: PipelineFailureMetadata,
    diagnostics?: Record<string, unknown>,
  ): Record<string, unknown> {
    return { failure, ...(diagnostics ? { diagnostics } : {}) };
  }
  private encounterMinimums: {
    short: number;    // 3-4 scenes
    medium: number;   // 5-7 scenes
    long: number;     // 8+ scenes
  };
  private sceneGraphBranching: {
    required: boolean;
    minPerEpisode: number;
    allowLinearBottleneckEpisodes: boolean;
  };
  private lastStructuralFeedback: string[] = [];
  /** Story Circle spine gate (tier 2): block when episodeCircle obligations are not realized. Default ON. */
  private storyCircleBlocking: boolean;

  constructor(config: AgentConfig, generationConfig?: GenerationSettingsConfig) {
    super('Story Architect', config);
    this.includeSystemPrompt = true;
    this.storyCircleBlocking =
      generationConfig?.storyCircleBlocking !== false;
    
    // Configure minimum encounters per episode length
    this.encounterMinimums = {
      short: generationConfig?.minEncountersShort ?? 1,
      medium: generationConfig?.minEncountersMedium ?? 1,
      long: generationConfig?.minEncountersLong ?? 1,
    };
    this.sceneGraphBranching = {
      required: generationConfig?.requireSceneGraphBranching !== false,
      minPerEpisode: generationConfig?.minSceneGraphBranchesPerEpisode ?? 1,
      allowLinearBottleneckEpisodes: generationConfig?.allowLinearBottleneckEpisodes === true,
    };
  }
  
  // Get minimum encounters based on scene count
  private getMinEncounters(sceneCount: number): number {
    if (sceneCount <= 4) return this.encounterMinimums?.short ?? 0;
    if (sceneCount <= 7) return this.encounterMinimums?.medium ?? 1;
    return this.encounterMinimums?.long ?? 1;
  }

  private getMinEncountersForBlueprint(sceneCount: number, input?: StoryArchitectInput): number {
    const plannedEncounterCount = input?.seasonPlanDirectives?.plannedEncounters?.length ?? 0;
    if (plannedEncounterCount > 0) return plannedEncounterCount;
    return this.getMinEncounters(sceneCount);
  }

  private getMinimumChoiceSceneCount(sceneCount: number): number {
    return Math.ceil(sceneCount * 0.4);
  }

  private createExpressionChoicePoint(scene: SceneBlueprint, reason: string): NonNullable<SceneBlueprint['choicePoint']> {
    const sceneGoal = scene.dramaticQuestion || scene.narrativeFunction || scene.description || scene.name;

    return {
      type: 'expression',
      branches: false,
      stakes: {
        want: `Express how the protagonist responds to ${sceneGoal}`,
        cost: 'The story beat continues, but the response colors how others read the protagonist.',
        identity: 'This choice defines the protagonist through tone, values, and emotional posture.',
      },
      description: `Let the player choose how they meet this moment: ${reason}.`,
      optionHints: [
        'Answer with restraint and careful attention.',
        'Answer with directness, making the feeling plain.',
        'Answer obliquely, revealing only part of the truth.',
      ],
      consequenceDomain: 'identity',
      reminderPlan: {
        immediate: 'Reflect the chosen tone in the next line of dialogue or narration.',
        shortTerm: 'Let a later scene echo how the protagonist carried themself here.',
      },
      expectedResidue: [
        `The protagonist's response in ${scene.name} leaves an emotional trace.`,
      ],
    };
  }

  private assignResidueObligationsToScenes(
    blueprint: EpisodeBlueprint,
    directives: StoryArchitectInput['seasonPlanDirectives'],
  ): void {
    const scenes = blueprint.scenes || [];
    if (!scenes.length || !directives) return;
    const due = directives.dueResidue || directives.incomingResidue || [];
    const outgoing = directives.outgoingResidue || [];

    for (const obligation of due) {
      const scene = this.selectResidueTargetScene(scenes, obligation, false);
      if (!scene) continue;
      scene.residueObligationIds = Array.from(new Set([...(scene.residueObligationIds || []), obligation.id]));
    }

    const choiceScenes = scenes.filter((scene) => scene.choicePoint);
    for (const obligation of outgoing) {
      const scene = this.selectResidueTargetScene(choiceScenes.length ? choiceScenes : scenes, obligation, true);
      if (!scene?.choicePoint) continue;
      scene.choicePoint.residueObligationIds = Array.from(new Set([
        ...(scene.choicePoint.residueObligationIds || []),
        obligation.id,
      ]));
      scene.residueObligationIds = Array.from(new Set([...(scene.residueObligationIds || []), obligation.id]));
    }
  }

  private selectResidueTargetScene(
    scenes: SceneBlueprint[],
    obligation: SeasonResidueObligation,
    preferChoicePoint: boolean,
  ): SceneBlueprint | undefined {
    if (!scenes.length) return undefined;
    const targetSceneIds = new Set(obligation.targetSceneIds || []);
    const candidates = scenes
      .filter((scene) => targetSceneIds.size === 0 || targetSceneIds.has(scene.id))
      .filter((scene) => !preferChoicePoint || Boolean(scene.choicePoint));
    const pool = candidates.length ? candidates : scenes;
    return [...pool].sort((a, b) =>
      this.residueSceneScore(b, obligation, preferChoicePoint) -
      this.residueSceneScore(a, obligation, preferChoicePoint)
    )[0];
  }

  private residueSceneScore(
    scene: SceneBlueprint,
    obligation: SeasonResidueObligation,
    preferChoicePoint: boolean,
  ): number {
    let score = preferChoicePoint && scene.choicePoint ? 8 : 0;
    if (obligation.targetSceneIds?.includes(scene.id)) score += 20;
    const npcs = new Set(scene.npcsPresent || []);
    for (const npcId of obligation.targetNpcIds || []) if (npcs.has(npcId)) score += 5;
    const text = [
      scene.name,
      scene.description,
      scene.dramaticQuestion,
      scene.narrativeFunction,
      ...(scene.keyBeats || []),
    ].join(' ').toLowerCase();
    for (const topic of obligation.targetTopics || []) {
      if (topic && text.includes(topic.toLowerCase())) score += 3;
    }
    return score;
  }

  private addChoicePointIfEligible(scene: SceneBlueprint, reason: string): boolean {
    if (scene.choicePoint || scene.isEncounter) return false;
    scene.choicePoint = this.createExpressionChoicePoint(scene, reason);
    console.log(`[StoryArchitect] Auto-added expression choicePoint to ${scene.id}: ${reason}`);
    return true;
  }

  /**
   * Step 1 of the info-reveal pipeline: deterministically assign each authored INFO
   * ledger entry whose reveal episode is THIS episode to a specific scene, recording it
   * on `scene.revealsInfoIds`. Additive + idempotent — a no-op when there is no ledger
   * or no reveal scheduled this episode, so non-treatment / no-ledger runs are unchanged.
   */
  /**
   * Plan-time diegetic timeline (time/location continuity fix, 2026-06-09).
   * Keeps a valid LLM-assigned `timeOfDay`, infers missing ones from scene
   * text, inherits across gaps, and derives `timeJumpFromPrevious` for every
   * scene — so SceneWriter always knows whether a scene is continuous or a
   * time/place jump that must be acknowledged on-page.
   */
  private assignSceneTimeline(blueprint: EpisodeBlueprint): void {
    assignBlueprintTimeline(blueprint.scenes || []);
  }

  private plannedSceneStagingText(scene: PlannedScene): string {
    return [
      scene.title,
      scene.turnContract?.turnEvent,
      scene.turnContract?.centralTurn,
      scene.dramaticPurpose,
      ...(scene.requiredBeats ?? [])
        .filter((beat) => beat.tier === 'authored' || beat.tier === 'signature')
        .map((beat) => beat.mustDepict || beat.sourceTurn),
    ].filter(Boolean).join(' ');
  }

  private sceneBlueprintStagingText(scene: SceneBlueprint): string {
    return [
      scene.name,
      scene.description,
      scene.dramaticPurpose,
      scene.dramaticQuestion,
      scene.narrativeFunction,
      scene.conflictEngine,
      scene.encounterDescription,
      scene.encounterCentralConflict,
      ...(scene.keyBeats || []),
      ...(scene.encounterBeatPlan || []),
      scene.turnContract?.turnEvent,
      scene.turnContract?.centralTurn,
      ...(scene.requiredBeats ?? [])
        .filter((beat) => beat.tier !== 'seed' && beat.tier !== 'connective')
        .map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ].filter(Boolean).join(' ');
  }

  private resolveIntroModeForCharacter(
    character: { id: string; name: string },
    stagingText: string,
  ): CharacterIntroMode {
    return resolveCharacterIntroMode({ characterName: character.name, stagingText });
  }

  private isAnonymousPlantNpcRef(
    npcRef: string,
    stagingText: string,
    roster: Array<{ id: string; name: string }>,
  ): boolean {
    const resolved = resolveRosterCharacter(npcRef, roster) ?? { id: npcRef, name: npcRef };
    return this.resolveIntroModeForCharacter(resolved, stagingText) === 'anonymous_plant';
  }

  private findIntroductionSceneForCharacter(
    character: { id: string; name: string },
    blueprint: EpisodeBlueprint,
    input: StoryArchitectInput,
  ): SceneBlueprint | undefined {
    const planned = [...(input.seasonPlanDirectives?.plannedScenes ?? [])].sort((a, b) => a.order - b.order);
    const normalizeName = (value: string) =>
      value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const name = normalizeName(character.name);
    const firstName = name.split(/\s+/).filter(Boolean)[0] ?? '';
    const characterSlug = normalizeCharacterSlug(character.id || character.name);
    const matchesCharacter = (text: string): boolean => {
      const haystack = normalizeName(text);
      if (!haystack) return false;
      if (haystack.includes(name)) return true;
      return firstName.length > 2 && new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);
    };
    const plannedCastsCharacter = (plannedScene: PlannedScene): boolean =>
      (plannedScene.npcsInvolved ?? []).some((npc) => {
        const value = String(npc || '');
        if (matchesCharacter(value)) return true;
        return normalizeCharacterSlug(value) === characterSlug;
      });
    const isAnonymousPlantForCharacter = (stagingText: string, plannedScene?: PlannedScene): boolean => {
      if (this.resolveIntroModeForCharacter(character, stagingText) !== 'anonymous_plant') return false;
      if (!plannedScene) return true;
      if (plannedCastsCharacter(plannedScene)) return true;
      // Encounter plants often list the roster id on the planned encounter while
      // the scene turn stages only stranger / suit / rescuer language.
      const plannedEncounters = input.seasonPlanDirectives?.plannedEncounters ?? [];
      return plannedEncounters.some((enc) => {
        const listed = (enc.npcsInvolved ?? []).some((npc) => {
          const value = String(npc || '');
          return matchesCharacter(value) || normalizeCharacterSlug(value) === characterSlug;
        });
        if (!listed) return false;
        return enc.id === plannedScene.id
          || Boolean((plannedScene as { plannedEncounterId?: string }).plannedEncounterId === enc.id)
        || plannedScene.kind === 'encounter';
      });
    };

    const sceneForPlanned = (plannedScene: PlannedScene): SceneBlueprint | undefined =>
      blueprint.scenes.find((candidate) => candidate.id === plannedScene.id);

    const blueprintIndex = (scene: SceneBlueprint | undefined): number =>
      scene ? blueprint.scenes.findIndex((candidate) => candidate.id === scene.id) : -1;

    const isPassingMentionOnly = (text: string): boolean => {
      if (!firstName) return false;
      const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\s+wants\\b`, 'i').test(text)
        || new RegExp(`warns that\\s+${escaped}\\b`, 'i').test(text);
    };

    const isForeshadowNameDropOnly = (text: string): boolean => {
      if (!firstName || firstName.length < 3) return false;
      const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const foreshadow = new RegExp(
        `\\b(?:friend|introduces?|mentions?|names?|other friend|take you to|would take you)\\b[^.!?]{0,120}\\b${escaped}\\b`,
        'i',
      );
      const physicalStaging = new RegExp(
        `\\b${escaped}\\b[^.!?]{0,100}\\b(?:walks?|walking|slides?|appears?|arrives?|interrupts?|laughs?|greets?|says|calls?|links?|loops?|pulls?|meet)\\b`,
        'i',
      );
      return foreshadow.test(text) && !physicalStaging.test(text);
    };

    const detectAnonymousOnlyGlimpse = (text: string): boolean =>
      isGlimpseNameDrop({ characterName: character.name, stagingText: text });

    const candidates: Array<{ scene: SceneBlueprint; index: number; named: boolean }> = [];
    const considerPlannedScene = (plannedScene: PlannedScene, stagingText: string): void => {
      const strongNamed = isNamedIntroductionStaging({
        characterName: character.name,
        stagingText,
      });
      const namedMention = matchesCharacter(stagingText)
        && !detectAnonymousOnlyGlimpse(stagingText)
        && !isPassingMentionOnly(stagingText)
        && !isForeshadowNameDropOnly(stagingText);
      const anonymousPlant = isAnonymousPlantForCharacter(stagingText, plannedScene);
      // Glimpse-only name-drops are neither intro nor plant candidates.
      if (!strongNamed && !namedMention && !anonymousPlant) return;
      if (isPassingMentionOnly(stagingText) || isForeshadowNameDropOnly(stagingText)) return;
      if (
        plannedScene.order === 0
        && !matchesCharacter(plannedScene.turnContract?.turnEvent || plannedScene.title || '')
        && !anonymousPlant
      ) {
        return;
      }
      const scene = sceneForPlanned(plannedScene);
      if (!scene) return;
      // Prefer real named staging (strong or on-page name) over anonymous plant.
      candidates.push({
        scene,
        index: blueprintIndex(scene),
        named: (strongNamed || namedMention) && !anonymousPlant,
      });
    };

    const explicitCastScenes = planned.filter((plannedScene) => plannedCastsCharacter(plannedScene));
    const stagingSources = explicitCastScenes.length > 0 ? explicitCastScenes : planned;
    for (const plannedScene of stagingSources) {
      considerPlannedScene(plannedScene, this.plannedSceneStagingText(plannedScene));
    }

    // Also consider blueprint keyBeats / signature — plans often name a first
    // meeting only in keyMoments that plannedSceneStagingText omits.
    for (const scene of blueprint.scenes || []) {
      const plannedScene = planned.find((entry) => entry.id === scene.id);
      const staging = [
        plannedScene ? this.plannedSceneStagingText(plannedScene) : '',
        this.sceneBlueprintStagingText(scene),
        ...(scene.keyBeats || []),
        scene.signatureMoment,
      ].filter(Boolean).join(' ');
      if (detectAnonymousOnlyGlimpse(staging)) continue;
      const namedMatch = isNamedIntroductionStaging({
        characterName: character.name,
        stagingText: staging,
      });
      if (!namedMatch || isPassingMentionOnly(staging) || isForeshadowNameDropOnly(staging)) continue;
      const index = blueprintIndex(scene);
      if (index < 0) continue;
      if (!candidates.some((entry) => entry.scene.id === scene.id && entry.named)) {
        candidates.push({ scene, index, named: true });
      }
    }

    for (const plannedScene of planned) {
      const ownedEvents = plannedScene.sceneEventOwnership?.ownedEvents ?? [];
      if (!ownedEvents.some((event) => matchesCharacter(event.text || ''))) continue;
      const ownedText = ownedEvents.map((event) => event.text || '').join(' ');
      if (detectAnonymousOnlyGlimpse(ownedText)) continue;
      if (!isNamedIntroductionStaging({ characterName: character.name, stagingText: ownedText })
        && !matchesCharacter(ownedText)) continue;
      const scene = sceneForPlanned(plannedScene);
      if (!scene) continue;
      const named = isNamedIntroductionStaging({ characterName: character.name, stagingText: ownedText });
      candidates.push({ scene, index: blueprintIndex(scene), named });
    }

    // Prefer earliest NAMED introduction over anonymous plant — never attach an
    // anonymous intro beat to a later charcoal-suit scene when an earlier scene
    // already stages a real named first meeting.
    candidates.sort((left, right) => {
      if (left.named !== right.named) return left.named ? -1 : 1;
      return left.index - right.index;
    });
    const namedCandidate = candidates.find((entry) => entry.named && entry.index >= 0);
    if (namedCandidate) return namedCandidate.scene;
    return candidates.find((entry) => entry.index >= 0)?.scene ?? candidates[0]?.scene;
  }

  /**
   * On-page character introductions (uncontextualized-character fix,
   * 2026-06-09). The season plan schedules which episode introduces each
   * character (`SeasonEpisode.introducesCharacters`), but nothing downstream
   * enforced an introduction — characters shipped name-dropped with no
   * on-page establishment (bite-me-g10 Victor) or metadata-only (endsong-g10
   * Sylvanor). For each character this episode introduces: make sure some
   * scene carries them, and give the FIRST scene that does an explicit
   * introduction key beat the SceneWriter must hit. Idempotent.
   */
  /**
   * Multi-party cast hygiene: when a scene's required beats / turn contract name
   * ≥2 NPCs in a group-formation beat ("become friends", "trio", club formation),
   * union those roster ids into `npcsPresent` so the writer and final intro
   * validator see the same ensemble obligation.
   */
  private ensureEnsembleCastObligations(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const roster = (input.availableNPCs ?? []).map((npc) => ({ id: npc.id, name: npc.name }));
    if (roster.length === 0) return;
    for (const scene of blueprint.scenes || []) {
      const staging = [
        scene.turnContract?.centralTurn,
        scene.turnContract?.turnEvent,
        scene.signatureMoment,
        ...(scene.requiredBeats ?? []).map((beat) => `${beat.mustDepict || ''} ${beat.sourceTurn || ''}`),
        ...(scene.keyBeats || []),
      ].filter(Boolean).join(' ');
      if (!staging.trim()) continue;
      const required = resolveEnsembleNpcIdsFromText({
        stagingText: staging,
        roster,
      });
      if (required.length < 2) continue;
      const present = new Set((scene.npcsPresent || []).map((id) => normalizeCharacterSlug(id)));
      for (const npcId of required) {
        if (present.has(normalizeCharacterSlug(npcId))) continue;
        scene.npcsPresent = [...(scene.npcsPresent || []), npcId];
        present.add(normalizeCharacterSlug(npcId));
      }
    }
  }

  private ensureCharacterIntroductionBeats(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const roster = (input.availableNPCs ?? []).map((npc) => ({ id: npc.id, name: npc.name }));
    const intros = (input.introducesCharacters ?? []).map((character) =>
      resolveRosterCharacter(character.id, roster)
        ?? resolveRosterCharacter(character.name, roster)
        ?? character,
    );
    const scenes = blueprint.scenes || [];
    if (intros.length === 0 || scenes.length === 0) return;
    const normalizeName = (value: string) =>
      value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const introductionKeyFor = (character: { id: string; name: string }) =>
      normalizeCharacterSlug(character.id || character.name);
    const sceneCastsCharacter = (scene: SceneBlueprint, characterId: string, characterName: string): boolean => {
      const id = normalizeName(characterId);
      const name = normalizeName(characterName);
      return (scene.npcsPresent || []).some((npc) => {
        const value = normalizeName(String(npc || ''));
        return value === id || value === name || value.includes(name) || name.includes(value);
      });
    };
    const sceneMentionsCharacter = (scene: SceneBlueprint, name: string): boolean => {
      const needle = normalizeName(name);
      if (!needle) return false;
      const haystack = normalizeName([
        scene.name,
        scene.description,
        scene.dramaticPurpose,
        scene.dramaticQuestion,
        scene.narrativeFunction,
        scene.conflictEngine,
        scene.turnContract?.turnEvent,
        scene.turnContract?.centralTurn,
        ...(scene.requiredBeats ?? [])
          .filter((beat) => beat.tier !== 'seed' && beat.tier !== 'connective')
          .map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
      ].filter(Boolean).join(' '));
      return haystack.includes(needle);
    };
    const sceneAlreadyHasIntroBeat = (
      scene: SceneBlueprint,
      character: { id: string; name: string },
      introductionKey: string,
    ): boolean => (scene.requiredBeats ?? []).some((beat) => {
      if (beat.id === `${scene.id}-intro-${introductionKey}`) return true;
      const text = normalizeName(`${beat.id || ''} ${beat.mustDepict || ''} ${beat.sourceTurn || ''}`);
      return text.includes('-intro-')
        && (text.includes(normalizeName(character.name)) || text.includes(introductionKey.replace(/-/g, ' ')));
    });

    const introducedKeys = new Set<string>();
    const planned = [...(input.seasonPlanDirectives?.plannedScenes ?? [])].sort((a, b) => a.order - b.order);
    const introductionPriority = (character: { id: string; name: string }): number => {
      const needle = normalizeName(character.name);
      const firstName = needle.split(/\s+/).filter(Boolean)[0] ?? '';
      const characterSlug = normalizeCharacterSlug(character.id || character.name);
      for (const plannedScene of planned) {
        const staging = this.plannedSceneStagingText(plannedScene);
        const text = normalizeName(staging);
        const fullIndex = text.indexOf(needle);
        const firstIndex = firstName.length > 2 ? text.search(new RegExp(`\\b${firstName}\\b`)) : -1;
        let index = fullIndex >= 0 ? fullIndex : firstIndex;
        if (index < 0) {
          const castTied = (plannedScene.npcsInvolved ?? []).some((npc) => {
            const value = String(npc || '');
            return normalizeName(value).includes(needle)
              || normalizeCharacterSlug(value) === characterSlug;
          });
          if (castTied && this.resolveIntroModeForCharacter(character, staging) === 'anonymous_plant') {
            index = 0;
          }
        }
        if (index >= 0) return plannedScene.order * 1000 + index;
      }
      return Number.MAX_SAFE_INTEGER;
    };
    const sortedIntros = [...intros].sort((left, right) => introductionPriority(left) - introductionPriority(right));
    for (const character of sortedIntros) {
      const introductionKey = introductionKeyFor(character);
      if (introducedKeys.has(introductionKey)) continue;

      // Conservative placement: a hard first-meeting beat goes ONLY on a scene
      // whose authored staging text/cast actually stages the character. Season
      // plans blanket-cast NPCs onto every scene, so blueprint-cast/mention
      // fallbacks and socialMeet round-robin placed intros on unrelated scenes
      // (storyrpg-lite 2026-07-04T21-46-05: Mika's "first meeting" forced onto
      // the s1-7 consequence scene after she'd been cast in s1-2..s1-6).
      // Characters the plan never stages textually are handled by the runtime
      // first-appearance directive + CharacterIntroductionValidator repair.
      const target = this.findIntroductionSceneForCharacter(character, blueprint, input);
      if (!target) {
        console.warn(
          `[StoryArchitect] Episode ${input.episodeNumber} is planned to introduce "${character.name}" but no planned scene stages them in its authored text; relying on the runtime first-appearance directive instead of forcing a hard intro beat.`,
        );
        continue;
      }
      introducedKeys.add(introductionKey);
      const plannedForTarget = planned.find((scene) => scene.id === target.id);
      const stagingText = [
        plannedForTarget ? this.plannedSceneStagingText(plannedForTarget) : '',
        this.sceneBlueprintStagingText(target),
        ...(target.keyBeats || []),
        target.signatureMoment,
      ].filter(Boolean).join(' ');
      // If this scene's authored staging is a real named introduction, force
      // named — never attach an anonymous_plant beat on "You meet X" scenes.
      // Glimpse name-drops elsewhere do not force named (those get scrubbed for plants).
      const targetIsNamedIntro = isNamedIntroductionStaging({
        characterName: character.name,
        stagingText,
      });
      let introMode = this.resolveIntroModeForCharacter(character, stagingText);
      if (targetIsNamedIntro) {
        introMode = 'named';
      }
      if (introMode === 'named') {
        if (!sceneCastsCharacter(target, character.id, character.name)) {
          target.npcsPresent = [...(target.npcsPresent || []), character.id];
        }
      } else {
        // anonymous_plant: keep identity linked for later reveal, but do NOT
        // force the roster id into cast (validator treats cast as "must name").
        target.npcsPresent = (target.npcsPresent || []).filter((npc) =>
          normalizeCharacterSlug(String(npc || '')) !== introductionKey
          && normalizeName(String(npc || '')) !== normalizeName(character.name));
        if (target.encounterRequiredNpcIds?.length) {
          target.encounterRequiredNpcIds = target.encounterRequiredNpcIds.filter((npc) =>
            normalizeCharacterSlug(String(npc || '')) !== introductionKey
            && normalizeName(String(npc || '')) !== normalizeName(character.name));
        }
      }
      // Pre-intro cast trim: the reader cannot have "met" this character in a
      // scene that plays before their first meeting — drop them from earlier
      // planned casts so the writer and the introduction ledger agree.
      const nameNeedle = normalizeName(character.name);
      const firstNameNeedle = nameNeedle.split(/\s+/).filter(Boolean)[0] ?? '';
      const beatNamesCharacter = (beat: string): boolean => {
        const normalizedBeat = normalizeName(String(beat || ''));
        if (normalizedBeat.includes(nameNeedle)) return true;
        return firstNameNeedle.length >= 3 && new RegExp(`\\b${firstNameNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(normalizedBeat);
      };
      const targetIndex = scenes.findIndex((scene) => scene.id === target.id);
      for (let earlier = 0; earlier < targetIndex; earlier += 1) {
        const scene = scenes[earlier];
        if (!sceneCastsCharacter(scene, character.id, character.name)) {
          // Still scrub name-forcing keyMoments for anonymous plants so early
          // scenes don't instruct "meets X and sees Y" while the gate forbids naming.
          if (introMode === 'anonymous_plant') {
            scene.keyBeats = (scene.keyBeats || []).filter((beat) => !beatNamesCharacter(beat));
          }
          continue;
        }
        if (introMode === 'named' && sceneMentionsCharacter(scene, character.name)) continue; // authored text stages them — leave the cast honest
        scene.npcsPresent = (scene.npcsPresent || []).filter((npc) =>
          normalizeCharacterSlug(String(npc || '')) !== introductionKey);
        if (introMode === 'anonymous_plant') {
          scene.keyBeats = (scene.keyBeats || []).filter((beat) => !beatNamesCharacter(beat));
        }
      }
      // anonymous_plant on the plant scene: strip name-forcing keyMoments that
      // collide with the no-roster-name policy ("meets X and sees Y").
      if (introMode === 'anonymous_plant') {
        target.keyBeats = (target.keyBeats || []).filter((beat) => {
          const normalizedBeat = normalizeName(String(beat || ''));
          if (normalizedBeat.includes('anonymous first contact') || normalizedBeat.includes('anonymous plant')) {
            return true;
          }
          return !beatNamesCharacter(beat);
        });
      }
      const already = (target.keyBeats || []).some((beat) => {
        const normalizedBeat = normalizeName(String(beat || ''));
        return normalizedBeat.includes(`first meeting with ${normalizeName(character.name)}`)
          || normalizedBeat.includes(`introduce ${normalizeName(character.name)}`)
          || normalizedBeat.includes(`anonymous first contact`)
          || normalizedBeat.includes(`anonymous plant`);
      });
      if (!already) {
        target.keyBeats = [
          introMode === 'anonymous_plant'
            ? `Anonymous first contact (linked to ${character.name}): stage them as a stranger/anonymous figure with distinctive visual cues — do NOT use their roster name yet; keep identity linked for a later reveal`
            : `First meeting with ${character.name}: this is the reader's FIRST time seeing them — establish who they are and how they relate to the protagonist through action or dialogue before they drive the plot`,
          ...(target.keyBeats || []),
        ];
      }
      const introBeatId = `${target.id}-intro-${introductionKey}`;
      if (!sceneAlreadyHasIntroBeat(target, character, introductionKey)) {
        target.requiredBeats = [
          ...(target.requiredBeats ?? []),
          {
            id: introBeatId,
            sourceTurn: introMode === 'anonymous_plant'
              ? `Anonymous first contact (linked to ${character.name})`
              : `First meeting with ${character.name}`,
            mustDepict: introMode === 'anonymous_plant'
              ? `You meet a stranger for the first time in this scene — stage them with distinctive visual cues as an anonymous figure (do NOT use the roster name ${character.name} yet); show first-contact behavior and keep their true identity linked for a later reveal.`
              : `You meet ${character.name} for the first time in this scene — show how they enter your attention, how they name themselves or are named to you, and one concrete identifying detail before any familiarity or group-belonging language.`,
            contractKind: introMode === 'anonymous_plant' ? 'identity_constraint' : 'depiction',
            tier: 'authored',
          },
        ];
      }
    }
  }

  private assignInfoReveals(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const entries = input.seasonPlanDirectives?.informationLedgerEntries;
    const scenes = blueprint.scenes ?? [];
    if (!entries?.length || scenes.length === 0) return;
    const assignment = assignInfoLedgerPhasesToScenes(scenes, entries, input.episodeNumber);
    if (assignment.size === 0) return;
    for (const scene of scenes) {
      const phases = assignment.get(scene.id);
      if (!phases) continue;
      if (phases.setupInfoIds?.length) {
        scene.setsUpInfoIds = [...new Set([...(scene.setsUpInfoIds ?? []), ...phases.setupInfoIds])];
      }
      if (phases.revealInfoIds?.length) {
        scene.revealsInfoIds = [...new Set([...(scene.revealsInfoIds ?? []), ...phases.revealInfoIds])];
      }
      if (phases.payoffInfoIds?.length) {
        scene.paysOffInfoIds = [...new Set([...(scene.paysOffInfoIds ?? []), ...phases.payoffInfoIds])];
      }
    }
  }

  private isFirstSeasonEpisode(input: StoryArchitectInput): boolean {
    return input.episodeNumber === 1;
  }

  private repairChoiceDensity(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const scenes = blueprint.scenes || [];
    if (scenes.length === 0) return;

    const minimumChoiceScenes = this.getMinimumChoiceSceneCount(scenes.length);
    let choiceSceneCount = scenes.filter(scene => scene.choicePoint).length;

    const startingScene = scenes.find(scene => scene.id === blueprint.startingSceneId) || scenes[0];
    if (startingScene && !startingScene.choicePoint) {
      if (this.isFirstSeasonEpisode(input)) {
        if (this.addChoicePointIfEligible(startingScene, 'early player agency')) {
          choiceSceneCount++;
        }
      } else {
        const followUps = startingScene.leadsTo
          .map(id => scenes.find(scene => scene.id === id))
          .filter((scene): scene is SceneBlueprint => Boolean(scene));
        const secondSceneHasChoice = followUps.some(scene => scene.choicePoint);

        if (!secondSceneHasChoice) {
          if (this.addChoicePointIfEligible(startingScene, 'early player agency')) {
            choiceSceneCount++;
          } else {
            const repairedFollowUp = followUps.find(scene => this.addChoicePointIfEligible(scene, 'early player agency after an encounter opening'));
            if (repairedFollowUp) choiceSceneCount++;
          }
        }
      }
    }

    const sceneMap = new Map(scenes.map(scene => [scene.id, scene]));
    const visited = new Set<string>();
    const repairLongNonChoiceRuns = (sceneId: string, nonChoiceStreak: number): void => {
      const visitKey = `${sceneId}:${nonChoiceStreak}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);

      const scene = sceneMap.get(sceneId);
      if (!scene) return;

      // Encounter scenes carry their player choice inside the encounter beats,
      // so they break a passive-scene run even without a standalone choicePoint.
      let currentStreak = scene.choicePoint || scene.isEncounter ? 0 : nonChoiceStreak + 1;
      if (currentStreak > 2 && this.addChoicePointIfEligible(scene, 'breaking up a long passive scene run')) {
        choiceSceneCount++;
        currentStreak = 0;
      }

      for (const nextId of scene.leadsTo) {
        repairLongNonChoiceRuns(nextId, currentStreak);
      }
    };

    if (startingScene) {
      repairLongNonChoiceRuns(startingScene.id, 0);
    }

    const preferredScenes = [
      ...scenes.filter(scene => scene.purpose === 'bottleneck'),
      ...scenes.filter(scene => scene.purpose === 'transition'),
      ...scenes.filter(scene => scene.purpose === 'branch'),
    ];
    const seen = new Set<string>();
    for (const scene of preferredScenes) {
      if (choiceSceneCount >= minimumChoiceScenes) break;
      if (seen.has(scene.id)) continue;
      seen.add(scene.id);
      if (this.addChoicePointIfEligible(scene, 'meeting the episode choice-density requirement')) {
        choiceSceneCount++;
      }
    }
  }

  private tokenizeEncounterText(value: string | undefined): string[] {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4);
  }

  private sceneMatchesPlannedEncounter(
    scene: SceneBlueprint,
    plannedEncounter: PlannedEncounterDirective
  ): boolean {
    if (!scene.isEncounter || !scene.encounterType) return false;
    if (scene.plannedEncounterId) {
      return scene.plannedEncounterId === plannedEncounter.id;
    }

    const sceneTokens = new Set([
      ...this.tokenizeEncounterText(scene.name),
      ...this.tokenizeEncounterText(scene.description),
      ...this.tokenizeEncounterText(scene.encounterDescription),
      ...scene.npcsPresent.map((npcId) => npcId.toLowerCase()),
    ]);
    const plannedTokens = this.tokenizeEncounterText(plannedEncounter.description);
    const overlap = plannedTokens.filter((token) => sceneTokens.has(token));

    return overlap.length >= Math.min(3, plannedTokens.length);
  }

  private authoredTurnTexts(scene: SceneBlueprint): string[] {
    return [
      ...(scene.requiredBeats || [])
        .filter((beat) => beat.tier === 'authored' || beat.tier === 'signature')
        .flatMap((beat) => [beat.mustDepict, beat.sourceTurn]),
      scene.turnContract?.centralTurn,
      scene.turnContract?.turnEvent,
    ]
      .filter((value): value is string => Boolean(value?.trim()));
  }

  private plannedEncounterTexts(plannedEncounter: PlannedEncounterDirective): string[] {
    return [
      plannedEncounter.description,
      plannedEncounter.centralConflict,
      plannedEncounter.stakes,
      plannedEncounter.aftermathConsequence,
      ...(plannedEncounter.npcsInvolved || []),
    ].filter((value): value is string => Boolean(value?.trim()));
  }

  private authoredTurnsAreCompatibleWithPlannedEncounter(
    scene: SceneBlueprint,
    plannedEncounter: PlannedEncounterDirective,
  ): boolean {
    const authoredTexts = this.authoredTurnTexts(scene);
    if (authoredTexts.length === 0) return true;

    const plannedTexts = this.plannedEncounterTexts(plannedEncounter);
    const signature = compareEncounterEventSignatures(
      buildEncounterEventSignature(plannedTexts),
      buildEncounterEventSignature(authoredTexts),
    );
    if (signature.matched) return true;

    const plannedTokens = new Set(plannedTexts.flatMap((text) => this.tokenizeEncounterText(text)));
    const authoredTokens = authoredTexts.flatMap((text) => this.tokenizeEncounterText(text));
    const hits = authoredTokens.filter((token) => plannedTokens.has(token)).length;
    const requiredHits = Math.min(4, Math.max(2, Math.ceil(plannedTokens.size * 0.25)));
    return hits >= requiredHits;
  }

  private normalizeEncounterType(value: string | undefined): EncounterType {
    const validTypes: EncounterType[] = [
      'combat',
      'chase',
      'heist',
      'negotiation',
      'investigation',
      'survival',
      'social',
      'romantic',
      'dramatic',
      'puzzle',
      'exploration',
      'stealth',
      'mixed',
    ];
    return validTypes.includes(value as EncounterType) ? value as EncounterType : 'dramatic';
  }

  private normalizeEncounterDifficulty(value: string | undefined): 'easy' | 'moderate' | 'hard' | 'extreme' {
    const normalized = (value || '').toLowerCase();
    if (normalized.includes('extreme') || normalized.includes('climax') || normalized.includes('finale') || normalized.includes('peak')) {
      return 'extreme';
    }
    if (normalized.includes('hard') || normalized.includes('high') || normalized.includes('danger')) {
      return 'hard';
    }
    if (normalized.includes('easy') || normalized.includes('intro') || normalized.includes('low')) {
      return 'easy';
    }
    return 'moderate';
  }

  private inferEncounterStyle(type: EncounterType, description: string): EncounterNarrativeStyle {
    const text = description.toLowerCase();
    if (type === 'romantic' || text.includes('romantic') || text.includes('desire')) return 'romantic';
    if (type === 'social' || type === 'negotiation') return 'social';
    if (type === 'stealth') return 'stealth';
    if (type === 'investigation' || type === 'puzzle') return 'mystery';
    if (type === 'exploration' || text.includes('unknown')) return 'adventure';
    if (type === 'combat' || type === 'chase' || type === 'survival' || text.includes('attack')) return 'action';
    return 'dramatic';
  }

  private defaultSkillsForEncounterType(type: EncounterType): string[] {
    switch (type) {
      case 'combat':
      case 'chase':
      case 'survival':
        return ['resolve', 'athletics', 'awareness'];
      case 'stealth':
      case 'heist':
        return ['stealth', 'deception', 'awareness'];
      case 'investigation':
      case 'puzzle':
        return ['investigation', 'insight', 'focus'];
      case 'romantic':
        return ['empathy', 'honesty', 'resolve'];
      case 'social':
      case 'negotiation':
        return ['persuasion', 'empathy', 'resolve'];
      case 'exploration':
        return ['awareness', 'survival', 'resolve'];
      default:
        return ['resolve', 'empathy', 'awareness'];
    }
  }

  private buildEncounterBeatPlan(plannedEncounter: PlannedEncounterDirective, existingBeats: string[] | undefined): string[] {
    const beats = [...(existingBeats || []).filter((beat) => beat.trim())];
    const description = plannedEncounter.description || 'The planned encounter arrives and forces a decisive response.';
    const stakes = plannedEncounter.stakes || 'The outcome changes what the protagonist can risk next.';
    const outcomes = plannedEncounter.branchOutcomes;

    beats.push(`Opening pressure: ${description}`);
    beats.push(`Escalation: ${stakes}`);
    if (outcomes?.victory || outcomes?.defeat || outcomes?.escape) {
      beats.push(`Outcome fork: victory means ${outcomes.victory || 'gaining ground'}, defeat means ${outcomes.defeat || 'paying a visible cost'}${outcomes.escape ? `, escape means ${outcomes.escape}` : ''}`);
    } else {
      beats.push('Decision point: the protagonist must choose whether to fight, flee, freeze, bargain, or reveal who they are becoming.');
    }

    return Array.from(new Set(beats)).slice(0, Math.max(3, Math.min(5, beats.length)));
  }

  private scoreSceneForPlannedEncounter(scene: SceneBlueprint, plannedEncounter: PlannedEncounterDirective): number {
    if (!this.authoredTurnsAreCompatibleWithPlannedEncounter(scene, plannedEncounter)) return -1;

    const plannedTokens = new Set([
      ...this.tokenizeEncounterText(plannedEncounter.description),
      ...this.tokenizeEncounterText(plannedEncounter.stakes),
      ...(plannedEncounter.npcsInvolved || []).map((npcId) => npcId.toLowerCase()),
    ]);
    const sceneTokens = new Set([
      ...this.tokenizeEncounterText(scene.name),
      ...this.tokenizeEncounterText(scene.description),
      ...this.tokenizeEncounterText(scene.encounterDescription),
      ...this.tokenizeEncounterText(scene.narrativeFunction),
      ...(scene.keyBeats || []).flatMap((beat) => this.tokenizeEncounterText(beat)),
      ...(scene.npcsPresent || []).map((npcId) => npcId.toLowerCase()),
    ]);

    let score = 0;
    for (const token of plannedTokens) {
      if (sceneTokens.has(token)) score += 2;
    }
    if (scene.isEncounter) score += 6;
    if (scene.purpose === 'bottleneck') score += 3;
    if (scene.encounterType === plannedEncounter.type) score += 2;
    if (scene.name.toLowerCase().includes('encounter') || scene.name.toLowerCase().includes('confront')) score += 2;
    return score;
  }

  private findSceneForPlannedEncounter(blueprint: EpisodeBlueprint, plannedEncounter: PlannedEncounterDirective): SceneBlueprint | undefined {
    const exact = blueprint.scenes.find((scene) => scene.plannedEncounterId === plannedEncounter.id);
    if (exact) return exact;

    const ranked = [...blueprint.scenes]
      .map((scene, index) => ({ scene, index, score: this.scoreSceneForPlannedEncounter(scene, plannedEncounter) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || (a.scene.isEncounter === b.scene.isEncounter ? 0 : a.scene.isEncounter ? -1 : 1));

    const semanticMatch = ranked.find((entry) => entry.score >= 6);
    if (semanticMatch) return semanticMatch.scene;

    const preferredIndex = Math.min(Math.max(1, Math.floor(blueprint.scenes.length * 0.65)), Math.max(0, blueprint.scenes.length - 2));
    return blueprint.scenes.find((scene, index) =>
      this.authoredTurnsAreCompatibleWithPlannedEncounter(scene, plannedEncounter)
      && (scene.isEncounter || (scene.purpose === 'bottleneck' && index >= preferredIndex))
    )
      || blueprint.scenes.find((scene) => this.authoredTurnsAreCompatibleWithPlannedEncounter(scene, plannedEncounter))
      || undefined;
  }

  private applyPlannedEncounterToScene(scene: SceneBlueprint, plannedEncounter: PlannedEncounterDirective): void {
    const effectivePlannedEncounter = scene.encounterDescription?.trim()
      ? {
          ...plannedEncounter,
          description: scene.encounterDescription,
          centralConflict: scene.encounterCentralConflict || plannedEncounter.centralConflict,
        }
      : plannedEncounter;
    const encounterType = this.normalizeEncounterType(effectivePlannedEncounter.type);
    const encounterStoryCircleTarget = normalizeEncounterStoryCircleTarget(
      effectivePlannedEncounter.storyCircleTarget,
      undefined,
      [
        effectivePlannedEncounter.description,
        effectivePlannedEncounter.stakes,
        effectivePlannedEncounter.centralConflict,
        effectivePlannedEncounter.aftermathConsequence,
      ].filter(Boolean).join(' '),
    );
    const existingSkills = scene.encounterRelevantSkills || [];
    const plannedSkills = effectivePlannedEncounter.relevantSkills || [];
    const stagingText = [
      this.sceneBlueprintStagingText(scene),
      effectivePlannedEncounter.description,
      effectivePlannedEncounter.centralConflict,
      effectivePlannedEncounter.stakes,
    ].filter(Boolean).join(' ');
    const npcIds = new Set([...(scene.npcsPresent || []), ...(scene.encounterRequiredNpcIds || [])]);
    for (const npcRef of effectivePlannedEncounter.npcsInvolved || []) {
      // anonymous_plant roster ids must not be cast as named members until named intro.
      // Resolve display name when possible so slug ids still detect named staging.
      const displayName = String(npcRef).includes(' ') || /[A-Z]/.test(String(npcRef))
        ? String(npcRef)
        : String(npcRef).replace(/^char-/, '').replace(/-/g, ' ');
      if (resolveCharacterIntroMode({ characterName: displayName, stagingText }) === 'anonymous_plant') {
        continue;
      }
      npcIds.add(npcRef);
    }

    scene.isEncounter = true;
    scene.plannedEncounterId = effectivePlannedEncounter.id;
    scene.encounterType = encounterType;
    scene.encounterStyle = scene.encounterStyle || this.inferEncounterStyle(encounterType, effectivePlannedEncounter.description);
    scene.encounterDescription = scene.encounterDescription?.trim()
      ? scene.encounterDescription
      : effectivePlannedEncounter.description;
    scene.encounterCentralConflict = scene.encounterCentralConflict?.trim()
      ? scene.encounterCentralConflict
      : effectivePlannedEncounter.centralConflict;
    scene.encounterStoryCircleTarget = encounterStoryCircleTarget;
    scene.encounterStoryCircleTargetRationale = effectivePlannedEncounter.storyCircleTargetRationale
      || buildEncounterStoryCircleTargetRationale(
        encounterStoryCircleTarget,
        undefined,
        effectivePlannedEncounter.description,
      );
    scene.encounterStoryCircleTargetEvidence = effectivePlannedEncounter.storyCircleTargetEvidence;
    scene.encounterStakes = scene.encounterStakes?.trim()
      ? scene.encounterStakes
      : effectivePlannedEncounter.stakes || `The outcome of ${effectivePlannedEncounter.description} changes the protagonist's immediate safety and trust.`;
    scene.encounterRequiredNpcIds = Array.from(npcIds);
    scene.npcsPresent = Array.from(npcIds);
    scene.encounterRelevantSkills = Array.from(new Set([
      ...existingSkills,
      ...plannedSkills,
      ...this.defaultSkillsForEncounterType(encounterType),
    ])).slice(0, 5);
    scene.encounterBeatPlan = this.buildEncounterBeatPlan(effectivePlannedEncounter, scene.encounterBeatPlan);
    scene.encounterDifficulty = scene.encounterDifficulty || this.normalizeEncounterDifficulty(effectivePlannedEncounter.difficulty);
    scene.encounterBuildup = scene.encounterBuildup?.trim()
      ? scene.encounterBuildup
      : effectivePlannedEncounter.encounterBuildup || `Earlier scenes establish why ${effectivePlannedEncounter.description} is unavoidable and personal.`;
    scene.encounterSetupContext = Array.from(new Set([
      ...(scene.encounterSetupContext || []),
      ...(effectivePlannedEncounter.encounterSetupContext || []),
    ]));
    if (effectivePlannedEncounter.encounterProfile) {
      scene.encounterProfile = effectivePlannedEncounter.encounterProfile;
    }
    scene.purpose = scene.purpose || 'bottleneck';
  }

  private repairPlannedEncounterCoverage(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const plannedEncounters = input.seasonPlanDirectives?.plannedEncounters || [];
    if (plannedEncounters.length === 0 || blueprint.scenes.length === 0) return;

    this.repairPreEncounterSpentEvents(blueprint, plannedEncounters);

    for (const plannedEncounter of plannedEncounters) {
      const matchedScene = this.findSceneForPlannedEncounter(blueprint, plannedEncounter);
      if (!matchedScene) continue;

      const wasBound = matchedScene.plannedEncounterId === plannedEncounter.id && matchedScene.isEncounter;
      this.applyPlannedEncounterToScene(matchedScene, plannedEncounter);
      if (!blueprint.bottleneckScenes.includes(matchedScene.id)) {
        blueprint.bottleneckScenes.push(matchedScene.id);
      }

      if (!wasBound) {
        console.warn(
          `[StoryArchitect] Repaired planned encounter "${plannedEncounter.id}" by binding it to scene "${matchedScene.id}"`
        );
      }
    }
  }

  private hydrateIncompleteEncounterContracts(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const plannedEncounters = input.seasonPlanDirectives?.plannedEncounters || [];
    for (const scene of blueprint.scenes) {
      if (!scene.isEncounter) continue;

      const plannedEncounter = plannedEncounters.find((encounter) =>
        scene.plannedEncounterId === encounter.id || this.sceneMatchesPlannedEncounter(scene, encounter)
      ) || plannedEncounters.find((encounter) => this.findSceneForPlannedEncounter(blueprint, encounter)?.id === scene.id);
      if (plannedEncounter) {
        this.applyPlannedEncounterToScene(scene, plannedEncounter);
      }

      const encounterType = this.normalizeEncounterType(
        scene.encounterType || (scene as SceneBlueprint & { encounter?: { type?: string } }).encounter?.type || plannedEncounter?.type,
      );
      const description = scene.encounterDescription?.trim()
        || (scene as SceneBlueprint & { encounter?: { description?: string } }).encounter?.description
        || plannedEncounter?.description
        || scene.description
        || scene.turnContract?.centralTurn
        || scene.name
        || 'The encounter forces a decisive response.';
      const centralConflict = scene.encounterCentralConflict?.trim()
        || (scene as SceneBlueprint & { encounter?: { centralConflict?: string } }).encounter?.centralConflict
        || plannedEncounter?.centralConflict
        || scene.turnContract?.turnEvent
        || description;
      const stakes = scene.encounterStakes?.trim()
        || plannedEncounter?.stakes
        || `The outcome of ${description} changes the protagonist's immediate safety, trust, and next available choice.`;
      const difficulty = scene.encounterDifficulty || this.normalizeEncounterDifficulty(plannedEncounter?.difficulty);
      const existingSkills = scene.encounterRelevantSkills?.filter((skill) => skill.trim()) || [];
      const nestedSkills = (scene as SceneBlueprint & { encounter?: { relevantSkills?: string[] } }).encounter?.relevantSkills || [];
      const relevantSkills = Array.from(new Set([
        ...existingSkills,
        ...nestedSkills,
        ...(plannedEncounter?.relevantSkills || []),
        ...this.defaultSkillsForEncounterType(encounterType),
      ])).slice(0, 5);

      scene.encounterType = encounterType;
      scene.encounterStyle = scene.encounterStyle || this.inferEncounterStyle(encounterType, description);
      scene.encounterDescription = description;
      scene.encounterCentralConflict = centralConflict;
      scene.encounterStakes = stakes;
      scene.encounterDifficulty = difficulty;
      scene.encounterRelevantSkills = relevantSkills;
      scene.encounterBuildup = scene.encounterBuildup?.trim()
        || plannedEncounter?.encounterBuildup
        || `Earlier scenes establish why ${description} is unavoidable and personal.`;
      scene.encounterBeatPlan = this.buildEncounterBeatPlan({
        id: plannedEncounter?.id || scene.plannedEncounterId || scene.id,
        type: encounterType,
        description,
        centralConflict,
        stakes,
        difficulty,
        relevantSkills,
        storyCircleTarget: plannedEncounter?.storyCircleTarget || scene.encounterStoryCircleTarget,
        storyCircleTargetRationale: plannedEncounter?.storyCircleTargetRationale || scene.encounterStoryCircleTargetRationale,
        storyCircleTargetEvidence: plannedEncounter?.storyCircleTargetEvidence || scene.encounterStoryCircleTargetEvidence,
        aftermathConsequence: plannedEncounter?.aftermathConsequence,
        encounterBuildup: plannedEncounter?.encounterBuildup,
        encounterSetupContext: plannedEncounter?.encounterSetupContext,
        npcsInvolved: plannedEncounter?.npcsInvolved ?? [],
        isBranchPoint: plannedEncounter?.isBranchPoint ?? scene.purpose === 'branch',
      }, scene.encounterBeatPlan);
      scene.encounterStoryCircleTarget = normalizeEncounterStoryCircleTarget(
        scene.encounterStoryCircleTarget || plannedEncounter?.storyCircleTarget,
        blueprint.storyCircleRole,
        [description, stakes, centralConflict, scene.description].filter(Boolean).join(' '),
      );
      scene.encounterStoryCircleTargetRationale = scene.encounterStoryCircleTargetRationale
        || plannedEncounter?.storyCircleTargetRationale
        || buildEncounterStoryCircleTargetRationale(
          scene.encounterStoryCircleTarget,
          blueprint.storyCircleRole,
          description,
        );
      scene.encounterStoryCircleTargetEvidence = scene.encounterStoryCircleTargetEvidence || plannedEncounter?.storyCircleTargetEvidence;
      scene.encounterSetupContext = Array.from(new Set([
        ...(scene.encounterSetupContext || []),
        ...(plannedEncounter?.encounterSetupContext || []),
      ]));
    }
  }

  private sceneEventSignatureText(scene: SceneBlueprint): string[] {
    return [
      scene.name,
      scene.description,
      scene.dramaticPurpose,
      scene.narrativeFunction,
      scene.encounterDescription,
      ...(scene.keyBeats || []),
      ...(scene.requiredBeats || []).flatMap((beat) => [beat.mustDepict, beat.sourceTurn]),
      scene.turnContract?.centralTurn,
      scene.turnContract?.turnEvent,
      scene.turnContract?.afterState,
      scene.turnContract?.handoff,
      ...(scene.npcsPresent || []),
    ].filter((value): value is string => Boolean(value?.trim()));
  }

  private repairPreEncounterSpentEvents(
    blueprint: EpisodeBlueprint,
    plannedEncounters: NonNullable<StoryArchitectInput['seasonPlanDirectives']>['plannedEncounters'],
  ): void {
    if (!plannedEncounters?.length) return;
    for (const plannedEncounter of plannedEncounters) {
      const encounterIndex = blueprint.scenes.findIndex((scene) =>
        scene.plannedEncounterId === plannedEncounter.id
        || scene.id === plannedEncounter.id
        || (scene.isEncounter && this.sceneMatchesPlannedEncounter(scene, plannedEncounter))
      );
      if (encounterIndex < 0) continue;
      const encounterScene = blueprint.scenes[encounterIndex];
      const encounterSignature = buildEncounterEventSignature([
        plannedEncounter.description,
        plannedEncounter.centralConflict,
        plannedEncounter.stakes,
        plannedEncounter.aftermathConsequence,
        ...(plannedEncounter.npcsInvolved || []),
      ]);
      if (encounterSignature.pressureActions.size === 0) continue;

      let owner: { scene: SceneBlueprint; index: number; score: number; matchedSignals: string[] } | undefined;
      for (let index = 0; index < encounterIndex; index += 1) {
        const scene = blueprint.scenes[index];
        if (scene.isEncounter || scene.plannedEncounterId) continue;
        if (!this.authoredTurnsAreCompatibleWithPlannedEncounter(scene, plannedEncounter)) continue;
        const match = compareEncounterEventSignatures(
          encounterSignature,
          buildEncounterEventSignature(this.sceneEventSignatureText(scene)),
        );
        if (!match.matched) continue;
        if (!owner || match.score > owner.score || (match.score === owner.score && index > owner.index)) {
          owner = { scene, index, score: match.score, matchedSignals: match.matchedSignals };
        }
      }
      if (!owner) continue;

      this.applyPlannedEncounterToScene(owner.scene, plannedEncounter);
      const duplicateTargets = encounterScene.leadsTo || [];
      for (const scene of blueprint.scenes) {
        const repairedTargets: string[] = [];
        for (const target of scene.leadsTo || []) {
          if (target === encounterScene.id) {
            repairedTargets.push(...duplicateTargets);
          } else {
            repairedTargets.push(target);
          }
        }
        scene.leadsTo = repairedTargets.filter((target, index, arr) =>
          target && target !== scene.id && arr.indexOf(target) === index,
        );
      }
      blueprint.scenes.splice(encounterIndex, 1);
      blueprint.bottleneckScenes = Array.from(new Set(
        (blueprint.bottleneckScenes || [])
          .map((id) => id === encounterScene.id ? owner!.scene.id : id)
          .filter((id) => blueprint.scenes.some((scene) => scene.id === id)),
      ));
      console.warn(
        `[StoryArchitect] Repaired pre-encounter spend for "${plannedEncounter.id}": ` +
        `promoted scene "${owner.scene.id}" and removed duplicate "${encounterScene.id}" ` +
        `(${owner.matchedSignals.join(', ') || 'event signature'}).`,
      );
    }
  }

  /**
   * Effective scene-graph branch floor for an episode of `sceneCount` scenes.
   * The implicit default stays at 1 (golden-stable); a story opts into richer
   * branching by setting `minSceneGraphBranchesPerEpisode` (e.g. 2). When opted
   * in, the floor is still capped to what a large-enough episode can host
   * ({@link BRANCH_FLOOR_2_MIN_SCENES}) so a small episode is never forced to
   * carry a second branch-and-bottleneck. Callers further cap this by
   * {@link feasibleBranchSlotCount} so validation never demands more branches
   * than the graph can structurally carry / the repair can synthesize.
   *
   * The companion improvement — {@link synthesizeBranchForCandidate}'s deeper,
   * later-reconverging routing (vs. the old next-2-scenes skip-insert) — applies
   * unconditionally whenever the repair synthesizes a branch, independent of the
   * floor.
   */
  private effectiveMinBranchesPerEpisode(sceneCount: number): number {
    const configured = this.sceneGraphBranching.minPerEpisode;
    // Only cap an OPTED-IN floor (>1) by episode size; never auto-raise the default.
    if (configured > 1 && sceneCount < BRANCH_FLOOR_2_MIN_SCENES) return 1;
    return configured;
  }

  /**
   * How many distinct, valid scene-graph branch points this scene list can carry.
   * A branch point must be a non-encounter scene with at least two distinct
   * downstream scenes to route to, so only scenes before the final two indices
   * are eligible. We cap the demanded floor by this so a raised default never
   * causes a spurious hard-abort on a graph that simply has no room.
   */
  private feasibleBranchSlotCount(scenes: SceneBlueprint[]): number {
    return scenes.filter((scene, index) => this.canHostSafeSceneGraphBranch(scenes, index)).length;
  }

  private carriesMandatorySequentialBeat(scene: SceneBlueprint | undefined): boolean {
    if (!scene) return false;
    if (scene.isEncounter || scene.plannedEncounterId) return true;
    if (scene.purpose === 'bottleneck') return true;
    if (/treatment|encounter|required|anchor|^enc-/i.test(`${scene.id} ${scene.name || ''}`)) return true;
    return (scene.requiredBeats || []).some((b) => b?.tier === 'authored' || b?.tier === 'signature');
  }

  private canHostSafeSceneGraphBranch(scenes: SceneBlueprint[], index: number): boolean {
    const scene = scenes[index];
    if (!scene || index >= scenes.length - 2 || scene.isEncounter) return false;
    const downstream = scenes.slice(index + 1);
    if (downstream.length < 2) return false;
    const firstMandatoryPos = downstream.findIndex((candidate) => this.carriesMandatorySequentialBeat(candidate));
    return firstMandatoryPos !== 0;
  }

  private repairSceneGraphBranchCoverage(blueprint: EpisodeBlueprint): void {
    if (!this.sceneGraphBranching.required || this.sceneGraphBranching.allowLinearBottleneckEpisodes) return;
    const scenes = blueprint.scenes || [];
    if (scenes.length < 3) return;

    const isValidBranchScene = (scene: SceneBlueprint): boolean =>
      Boolean(scene.choicePoint?.branches) &&
      scene.choicePoint?.type !== 'expression' &&
      new Set(scene.leadsTo || []).size >= 2 &&
      !scene.isEncounter;

    // Raise the floor to 2 on big-enough episodes, but never above what the graph
    // can carry — otherwise validation would hard-abort a blueprint repair can't fix.
    const targetFloor = Math.min(
      this.effectiveMinBranchesPerEpisode(scenes.length),
      this.feasibleBranchSlotCount(scenes),
    );

    const sceneIndex = new Map(scenes.map((scene, index) => [scene.id, index]));

    // Synthesize branches one at a time until the floor is met. Each pass grabs a
    // fresh eligible candidate (one not already a valid branch) so we never double
    // up on the same scene, and bails the moment no candidate / no deep-enough
    // routing remains — falling back to the existing graph rather than corrupting it.
    let guard = scenes.length; // hard upper bound; one branch per scene at most
    while (scenes.filter(isValidBranchScene).length < targetFloor && guard-- > 0) {
      const synthesized = this.synthesizeBranchForCandidate(scenes, sceneIndex);
      if (!synthesized) break;
    }
  }

  /**
   * Turn the best still-linear scene into a reconvergent scene-graph branch.
   * Returns the chosen scene id on success, or null when no eligible candidate /
   * valid two-target routing exists (caller then falls back to the current graph).
   *
   * Routing: instead of fanning out to the immediate next two scenes (which merge
   * one step later — a trivially shallow branch), one arm takes the next scene and
   * the other arm SKIPS AHEAD to a later reconvergence scene (a downstream
   * bottleneck/encounter where possible, else ≥2 steps ahead). The skipped span
   * stays reachable through the near arm's existing linear chain, so the two arms
   * diverge for a real stretch before reconverging — with no orphaned or
   * unreachable scenes. When no deeper target is available (e.g. a 3-scene
   * episode) it falls back to the original next-two behavior.
   */
  private synthesizeBranchForCandidate(
    scenes: SceneBlueprint[],
    sceneIndex: Map<string, number>,
  ): string | null {
    const isAlreadyBranch = (scene: SceneBlueprint): boolean =>
      Boolean(scene.choicePoint?.branches) &&
      scene.choicePoint?.type !== 'expression' &&
      new Set(scene.leadsTo || []).size >= 2 &&
      !scene.isEncounter;

    // A scene carrying an authored/signature required beat, planned encounter, or
    // fixed bottleneck is MANDATORY sequential setup. The far arm must NOT skip past
    // one, or a player on that arm bypasses a required story turn.
    const carriesMandatoryBeat = (scene: SceneBlueprint | undefined): boolean =>
      this.carriesMandatorySequentialBeat(scene);

    const eligible = (scene: SceneBlueprint, index: number): boolean =>
      index < scenes.length - 2 && !scene.isEncounter && !isAlreadyBranch(scene);
    // A SAFE branch point is one whose immediately-next scene carries no mandatory beat,
    // so the far arm can skip it without bypassing a plot turn. We prefer these.
    const safe = (scene: SceneBlueprint, index: number): boolean =>
      eligible(scene, index) && !carriesMandatoryBeat(scenes[index + 1]);

    // Prefer a safe branch point. In a dense treatment episode where every content
    // scene carries an authored turn, do not synthesize an unsafe scene skip just
    // to satisfy branch coverage; branch validation treats that as a linear
    // bottleneck and route/residue choices can still carry agency.
    const candidate =
      scenes.find((s, i) => safe(s, i) && s.choicePoint && s.choicePoint.type !== 'expression') ||
      scenes.find((s, i) => safe(s, i) && s.choicePoint) ||
      scenes.find((s, i) => safe(s, i));
    if (!candidate) return null;

    const candidateIndex = sceneIndex.get(candidate.id) ?? 0;
    const downstream = scenes
      .slice(candidateIndex + 1)
      .map((scene) => scene.id)
      .filter((id, index, arr) => arr.indexOf(id) === index);
    if (downstream.length < 2) return null;

    // Near arm: the immediately-next scene (keeps the linear chain intact so the
    // skipped span stays reachable). Far arm: a later reconvergence scene.
    const nearArmId = downstream[0];

    // Reconverge no later than the first downstream mandatory-beat scene so the far
    // arm never skips a plot turn. If no mandatory scene exists downstream, use the
    // whole remaining window.
    const firstMandatoryPos = downstream.findIndex((id) => carriesMandatoryBeat(scenes[sceneIndex.get(id) ?? -1]));
    const farBoundary = firstMandatoryPos >= 1 ? firstMandatoryPos : downstream.length - 1;

    // Prefer a downstream bottleneck/encounter (the designed merge point) within the
    // safe window [1..farBoundary]; else reconverge ≥2 steps ahead when the window
    // allows, else at the boundary itself.
    const deeperTargetId =
      downstream.slice(1, farBoundary + 1).find((id) => {
        const scene = scenes[sceneIndex.get(id) ?? -1];
        return scene && (scene.isEncounter || scene.purpose === 'bottleneck');
      }) ||
      downstream[Math.min(2, farBoundary)];

    const targetIds = Array.from(new Set([nearArmId, deeperTargetId])).slice(0, 2);
    if (targetIds.length < 2) return null;

    candidate.purpose = 'branch';
    candidate.leadsTo = targetIds;
    if (!candidate.choicePoint || candidate.choicePoint.type === 'expression') {
      candidate.choicePoint = {
        // 1.2: a routing branch needs `branches: true`, not type `dilemma`.
        // Forcing dilemma here was a major driver of the dilemma monoculture;
        // a path choice is strategic by default. The LLM's own non-expression
        // type is preserved below.
        type: 'strategic',
        branches: true,
        stakes: {
          want: candidate.choicePoint?.stakes?.want || `Choose how to handle ${candidate.name}`,
          cost: candidate.choicePoint?.stakes?.cost || 'One path skips a chance for safety, trust, or information.',
          identity: candidate.choicePoint?.stakes?.identity || 'This choice defines the protagonist under pressure.',
        },
        description: candidate.choicePoint?.description || `Choose the route through ${candidate.name}.`,
        optionHints: [],
        consequenceDomain: candidate.choicePoint?.consequenceDomain || 'identity',
        reminderPlan: candidate.choicePoint?.reminderPlan,
        expectedResidue: candidate.choicePoint?.expectedResidue || [
          `The decision in ${candidate.name} changes who arrives with trust, leverage, or suspicion.`,
        ],
      };
    }

    candidate.choicePoint.type = candidate.choicePoint.type === 'expression' ? 'strategic' : candidate.choicePoint.type;
    candidate.choicePoint.branches = true;
    candidate.choicePoint.optionHints = targetIds.map((targetId) => {
      const target = scenes.find((scene) => scene.id === targetId);
      return target ? `Move toward ${target.name}` : `Move toward ${targetId}`;
    });
    candidate.choicePoint.consequenceDomain = candidate.choicePoint.consequenceDomain || 'identity';
    candidate.choicePoint.expectedResidue = candidate.choicePoint.expectedResidue?.length
      ? candidate.choicePoint.expectedResidue
      : [`The decision in ${candidate.name} changes who arrives with trust, leverage, or suspicion.`];

    console.warn(
      `[StoryArchitect] Repaired scene-graph branching by turning "${candidate.id}" into a branch scene with leadsTo: ${targetIds.join(', ')}`
    );
    return candidate.id;
  }

  /**
   * Does this episode have to carry a real scene-graph branch? True by default;
   * linear-bottleneck episodes are exempt. Mirrors the gate the
   * content-time {@link SceneGraphBranchValidator} enforces.
   */
  private episodeRequiresSceneGraphBranch(): boolean {
    return this.sceneGraphBranching.required
      && !this.sceneGraphBranching.allowLinearBottleneckEpisodes;
  }

  /**
   * Plan-time blueprint adequacy check. A branching-required episode whose
   * blueprint is too small to carry a branch (or has no valid branch scene even
   * after {@link repairSceneGraphBranchCoverage}) will hard-abort at content-time
   * scene-graph branching validation — but only AFTER the expensive scene/choice/
   * encounter pass. Detect it here, right after the repair pipeline, so the
   * caller can regenerate (freeform path) or fail fast (deterministic elaborate
   * path) before that work is wasted.
   *
   * Returns adequate=true for exempt episodes, and for branchable episodes whose
   * repair already produced a valid branch — so it only fires on genuinely
   * under-sized/branchless blueprints (golden parity).
   */
  /**
   * Adequacy check that self-heals before failing. repairSceneGraphBranchCoverage
   * runs early in the repair pipeline; later repair steps can change beat
   * ownership or scene shape enough that a branch slot only becomes feasible by
   * gate time — assessBlueprintBranchAdequacy then demands a branch nobody
   * re-attempted (bite-me 2026-07-02T19-39-25 BlueprintAdequacyGate abort:
   * "0 valid branch scene(s); need at least 1"). Re-running the repair against
   * the CURRENT graph state synthesizes the branch whenever the gate's own
   * feasibility count says one fits, so the gate only fails when the plan is
   * genuinely too small — never from repair/gate ordering drift.
   */
  private ensureBlueprintBranchAdequacy(blueprint: EpisodeBlueprint): {
    adequate: boolean;
    sceneCount: number;
    validBranchCount: number;
    reason: string;
  } {
    let adequacy = this.assessBlueprintBranchAdequacy(blueprint);
    if (!adequacy.adequate) {
      this.repairSceneGraphBranchCoverage(blueprint);
      // The normal repair pipeline runs repairSceneTransitions AFTER the branch
      // repair; a branch synthesized here (post-pipeline) must restore that
      // invariant or its new edge ships without transitionOut metadata and the
      // DramaticStructure transition rule blocks the episode.
      this.repairSceneTransitions(blueprint);
      adequacy = this.assessBlueprintBranchAdequacy(blueprint);
    }
    return adequacy;
  }

  private assessBlueprintBranchAdequacy(blueprint: EpisodeBlueprint): {
    adequate: boolean;
    sceneCount: number;
    validBranchCount: number;
    reason: string;
  } {
    const sceneCount = blueprint.scenes?.length ?? 0;
    const validBranchCount = (blueprint.scenes || []).filter(scene =>
      scene.choicePoint?.branches &&
      scene.choicePoint.type !== 'expression' &&
      new Set(scene.leadsTo || []).size >= 2
    ).length;

    if (!this.episodeRequiresSceneGraphBranch()) {
      return { adequate: true, sceneCount, validBranchCount, reason: '' };
    }
    if (sceneCount < MIN_SCENES_PER_EPISODE) {
      return {
        adequate: false,
        sceneCount,
        validBranchCount,
        reason: `only ${sceneCount} scene(s) — a branch needs at least ${MIN_SCENES_PER_EPISODE} (one branch scene plus two distinct downstream targets)`,
      };
    }
    // Effective floor (default 1, raised to 2 on big-enough episodes), capped by
    // what the graph can structurally carry so this never demands more branches
    // than repairSceneGraphBranchCoverage could have synthesized.
    const requiredBranches = Math.min(
      this.effectiveMinBranchesPerEpisode(sceneCount),
      this.feasibleBranchSlotCount(blueprint.scenes || []),
    );
    if (validBranchCount < requiredBranches) {
      return {
        adequate: false,
        sceneCount,
        validBranchCount,
        reason: `${validBranchCount} valid branch scene(s); need at least ${requiredBranches} (a non-expression choicePoint with branches=true and two distinct leadsTo targets)`,
      };
    }
    return { adequate: true, sceneCount, validBranchCount, reason: '' };
  }

  private collectAuthoredResidue(guidance: TreatmentEpisodeGuidance | undefined): string[] {
    if (!guidance) return [];

    return Array.from(new Set([
      ...(guidance.alternativePaths || []),
      ...(guidance.consequenceSeeds || []),
      guidance.consequenceResidue,
      guidance.connectsBy,
    ].map((value) => value?.trim()).filter(Boolean) as string[]));
  }

  private hasBlueprintText(value: unknown): value is string {
    return typeof value === 'string'
      && value.trim().length > 0
      && !/\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i.test(value);
  }

  private hasConcretePersonalStake(value: unknown): value is string {
    if (!this.hasBlueprintText(value)) return false;
    const text = value.trim();
    const personalTerms = /\b(friend|family|sibling|parent|child|lover|ally|mentor|home|name|reputation|trust|promise|vow|identity|future|memory|belonging|freedom|dignity|relationship|bond|wound|secret|debt|cost|lose|loss|save|protect|betray|exile|access)\b/i;
    const abstractOnly = /\b(everything|the world|the realm|the kingdom|the city|all hope|fate|destiny|survival|stakes are high|danger grows)\b/i;
    return personalTerms.test(text) || !abstractOnly.test(text);
  }

  private pickBlueprintText(...values: Array<string | undefined>): string {
    return values.find((value) => this.hasBlueprintText(value)) || '';
  }

  private pickPersonalStake(...values: Array<string | undefined>): string {
    return values.find((value) => this.hasConcretePersonalStake(value)) || this.pickBlueprintText(...values);
  }

  private hasThemeChoiceAction(value: unknown): value is string {
    return this.hasBlueprintText(value)
      && /\b(player|protagonist|choice|chooses|choose|decision|decides|act|acts|action|refusal|refuses|sacrifice|risks|commit|commits|reveals|hides|protects|betrays|trusts|confronts|accepts|rejects|identity|cost|open|block|archive|read|wait|decline|publish|invite|thank|kiss|scream|run|freeze|fight)\b/i.test(value);
  }

  private hasExternalThemeResolutionText(value: unknown): value is string {
    return this.hasBlueprintText(value)
      && /\b(coincidence|coincidentally|prophecy|prophec|destiny|fate|deus ex|rescued by|saves them without|villain decides|antagonist decides|external rescue|outside force|randomly|by chance)\b/i.test(value);
  }

  private playableChoicePressureFallback(): string {
    return 'how the protagonist chooses to respond when the scene pressure changes their safety, trust, cost, and identity';
  }

  private normalizeChoicePressureText(value: string | undefined): string | undefined {
    if (!this.hasChoicePressureSafeBlueprintText(value)) return undefined;
    if (this.hasExternalThemeResolutionText(value)) return this.playableChoicePressureFallback();
    return value;
  }

  private buildTreatmentThemeChoicePressure(
    guidance: TreatmentEpisodeGuidance | undefined,
    themePressure: string,
  ): string {
    const authoredChoice = guidance?.forcedChoice || guidance?.majorChoicePressures?.[0] || themePressure;
    const playableChoice = this.hasExternalThemeResolutionText(authoredChoice)
      ? this.playableChoicePressureFallback()
      : authoredChoice;
    const playableTheme = this.hasExternalThemeResolutionText(themePressure)
      ? 'the scene pressure'
      : themePressure;
    return `Player/protagonist choice makes the theme answerable: ${playableChoice}. The action tests ${playableTheme}`;
  }

  private normalizeInformationPlan(
    items: unknown,
    guidance: TreatmentEpisodeGuidance | undefined,
    fallbackItem: string,
    fallbackPayoff: string,
  ): DramaticStructureAudit['informationPlan'] {
    const rawItems = Array.isArray(items) ? items : items ? [items] : [];
    const normalized = rawItems.map((raw, index) => {
      const item = raw && typeof raw === 'object' ? raw as Partial<DramaticStructureAudit['informationPlan'][number]> : {};
      const fallback = index === 0
        ? fallbackItem
        : (guidance?.cSeed || guidance?.informationMovement || guidance?.visualAnchor || fallbackItem);
      return {
        item: this.pickBlueprintText(item.item, fallback),
        knownBy: this.sanitizeInformationOwners(item.knownBy),
        revealTiming: this.pickBlueprintText(item.revealTiming, 'During this episode.'),
        payoff: this.pickBlueprintText(item.payoff, fallbackPayoff),
      };
    });

    return normalized.length > 0
      ? normalized
      : [{
          item: fallbackItem,
          knownBy: ['player', 'protagonist'],
          revealTiming: 'During this episode.',
          payoff: fallbackPayoff,
        }];
  }

  private shouldRemoveCurrentExistentialStake(value: string | undefined): boolean {
    if (!this.hasBlueprintText(value)) return true;
    return /\bexistential\b/i.test(value)
      && /\bunknown to|unaware|hidden from|not yet known|audience knows/i.test(value);
  }

  private mergeTreatmentStakesLayers(
    existing: StakesLayers | undefined,
    inferred: StakesLayers,
  ): StakesLayers {
    const merged: StakesLayers = {
      ...inferred,
      ...(existing || {}),
    };
    if (this.shouldRemoveCurrentExistentialStake(merged.existential)) {
      delete merged.existential;
    }
    return merged;
  }

  private inferTreatmentStakesLayers(guidance: TreatmentEpisodeGuidance | undefined, input: StoryArchitectInput): StakesLayers {
    const authored = (guidance?.stakesLayers || []).join(' ');
    const layers: StakesLayers = {};

    const materialSource = [
      guidance?.entryGoal,
      guidance?.obstacle,
      guidance?.aPressure,
      authored,
    ].filter(Boolean).join(' ');
    const relationalSource = [
      guidance?.bPressure,
      guidance?.powerShift,
      authored,
      input.availableNPCs?.[0]?.name,
    ].filter(Boolean).join(' ');
    const identitySource = [
      guidance?.liePressure,
      guidance?.themePressure,
      guidance?.forcedChoice,
      authored,
    ].filter(Boolean).join(' ');

    layers.material = materialSource || 'Access, evidence, time, safety, or leverage can be lost by how this scene turns.';
    layers.relational = relationalSource || 'Trust, intimacy, reputation, or alliance pressure changes around the protagonist.';
    layers.identity = identitySource || 'The protagonist must show who they are becoming under pressure.';

    if (!this.shouldRemoveCurrentExistentialStake(authored)
      && /\bexistential|survival|life|death|freedom|home|meaning|irreversible\b/i.test(authored)) {
      layers.existential = authored;
    }

    return layers;
  }

  private splitAuthoredChoiceOptions(pressure: string): string[] {
    const cleaned = pressure
      .replace(/^\s*[-*]\s+/, '')
      .replace(/\s+[—–-]\s+(?=WANT:|COST:|IDENTITY:).*/i, '')
      .replace(/\s*\(\d+\)\s*/g, ' | ')
      .trim();
    const options = cleaned
      .split(/\s*(?:\||,?\s+or\s+|\/|;)\s*/i)
      .map((option) => option.replace(/^\(?\d+\)?\.?\s*/, '').trim())
      .filter((option) => option.length > 0);
    return Array.from(new Set(options)).slice(0, 4);
  }

  private chooseAuthoredChoicePressure(guidance: TreatmentEpisodeGuidance | undefined): string | undefined {
    const pressures = guidance?.majorChoicePressures || [];
    return pressures.find((pressure) => this.splitAuthoredChoiceOptions(pressure).length >= 2)
      || pressures.find((pressure) => this.hasBlueprintText(pressure));
  }

  private findSceneForAuthoredChoice(blueprint: EpisodeBlueprint): SceneBlueprint | undefined {
    return blueprint.scenes?.find((scene) => scene.choicePoint && !scene.isEncounter)
      || blueprint.scenes?.find((scene) => scene.choicePoint)
      || blueprint.scenes?.find((scene) => !scene.isEncounter)
      || blueprint.scenes?.[0];
  }

  private inferChoiceConsequenceDomain(pressure: string, guidance: TreatmentEpisodeGuidance | undefined): NonNullable<SceneBlueprint['choicePoint']>['consequenceDomain'] {
    const text = [pressure, guidance?.bPressure, guidance?.consequenceResidue, guidance?.connectsBy, guidance?.informationMovement].filter(Boolean).join(' ').toLowerCase();
    if (/\b(trust|friend|family|lover|relationship|mika|stela|radu|daniel|victor)\b/.test(text)) return 'relationship';
    if (/\b(photo|publish|blog|message|secret|read|archive|name|codename|information|laptop)\b/.test(text)) return 'information';
    if (/\b(key|card|quartz|access|money|resource|object|item)\b/.test(text)) return 'resource';
    if (/\b(reputation|public|column|blog|publish)\b/.test(text)) return 'reputation';
    if (/\b(danger|threat|attack|safety)\b/.test(text)) return 'danger';
    return 'identity';
  }

  /** ESC lockdown: every non-encounter plannedHasChoice scene must keep a choicePoint. */
  private materializePlannedHasChoicePoints(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    for (const scene of blueprint.scenes || []) {
      if (scene.isEncounter || scene.plannedHasChoice !== true || scene.choicePoint) continue;
      const pressure = this.localChoicePressures(scene)[0]
        || guidance?.majorChoicePressures?.find((candidate) => this.hasBlueprintText(candidate))
        || scene.dramaticPurpose
        || scene.description
        || `Choose how to handle ${scene.name}`;
      this.applyTreatmentChoicePressureToScene(scene, pressure, guidance, this.localChoiceResidue(scene));
    }
  }

  private collectMissingPlannedChoicePoints(blueprint: EpisodeBlueprint): string[] {
    return (blueprint.scenes || [])
      .filter((scene) => !scene.isEncounter && scene.plannedHasChoice === true && !scene.choicePoint)
      .map((scene) => scene.id);
  }

  private repairTreatmentMajorChoicePressure(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    // Prefer per-scene major_choice_pressure contracts. Create a real choicePoint
    // from that pressure — do not require a prior "The decision turns on…" stub.
    const localChoiceScenes = (blueprint.scenes || []).filter((scene) =>
      !scene.isEncounter
      && scene.plannedHasChoice !== false
      && this.localChoicePressures(scene).length > 0
    );
    if (localChoiceScenes.length > 0) {
      for (const scene of localChoiceScenes) {
        const pressure = this.localChoicePressures(scene).find((candidate) => this.splitAuthoredChoiceOptions(candidate).length >= 2)
          || this.localChoicePressures(scene)[0];
        if (!pressure) continue;
        this.applyTreatmentChoicePressureToScene(scene, pressure, guidance, this.localChoiceResidue(scene));
      }
      return;
    }

    const pressure = this.chooseAuthoredChoicePressure(guidance);
    if (!pressure) return;

    const scene = this.findSceneForAuthoredChoice(blueprint);
    if (!scene || scene.isEncounter || scene.plannedHasChoice === false) return;

    const personalStake = this.pickPersonalStake(
      scene.personalStake,
      blueprint.dramaticAudit?.personalStake,
      guidance?.liePressure,
      guidance?.bPressure,
      guidance?.consequenceResidue,
      `The protagonist's identity, reputation, trust, and future options are at risk.`
    );
    const residue = this.collectAuthoredResidue(guidance);
    this.applyTreatmentChoicePressureToScene(scene, pressure, guidance, residue);
    scene.personalStake = personalStake;
  }

  /**
   * Surface the treatment's intended choice menus to ChoiceAuthor across ALL choice
   * scenes. {@link repairTreatmentMajorChoicePressure} fully reshapes only ONE authored
   * choice scene; the rest get empty `optionHints` and ChoiceAuthor improvises, so the
   * generated decisions drift from the treatment (the dark-wine drink/sip/refuse, the
   * Ileana powder-room reach, the Sunday-breakfast blog fork all vanished). This fills
   * each remaining choice scene's empty `optionHints` from the treatment's
   * `majorChoicePressures` positionally (split into the authored option menu) and records
   * `alternativePaths` as expected residue. Additive (never overwrites an authored 2+
   * menu) and gated on guidance presence — a no-op for non-treatment runs.
   */
  private seedChoiceMenusFromTreatment(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    const localChoiceScenes = (blueprint.scenes || []).filter((scene) =>
      !scene.isEncounter
      && scene.plannedHasChoice !== false
      && this.localChoicePressures(scene).length > 0
    );
    if (localChoiceScenes.length > 0) {
      for (const scene of localChoiceScenes) {
        const pressure = this.localChoicePressures(scene).find((candidate) => this.splitAuthoredChoiceOptions(candidate).length >= 2);
        if (!pressure) continue;
        if (!scene.choicePoint) {
          this.applyTreatmentChoicePressureToScene(scene, pressure, guidance, this.localChoiceResidue(scene));
          continue;
        }
        if ((scene.choicePoint.optionHints?.length ?? 0) >= 2) continue;
        scene.choicePoint.optionHints = this.splitAuthoredChoiceOptions(pressure);
        scene.choicePoint.description = scene.choicePoint.description || `Treatment-defined pressure: ${pressure}`;
        scene.choicePoint.expectedResidue = Array.from(new Set([
          ...(scene.choicePoint.expectedResidue || []),
          ...this.localChoiceResidue(scene),
        ]));
      }
      return;
    }

    const pressures = (guidance?.majorChoicePressures || []).filter(
      (pressure) => this.splitAuthoredChoiceOptions(pressure).length >= 2,
    );
    if (pressures.length === 0) return;
    const altResidue = guidance?.alternativePaths || [];
    const choiceScenes = (blueprint.scenes || []).filter((s) =>
      !s.isEncounter
      && s.plannedHasChoice !== false
      && (s.choicePoint || s.plannedHasChoice === true)
    );
    for (let i = 0; i < choiceScenes.length && i < pressures.length; i += 1) {
      const scene = choiceScenes[i];
      if (!scene.choicePoint) {
        this.applyTreatmentChoicePressureToScene(scene, pressures[i], guidance, altResidue);
        continue;
      }
      const cp = scene.choicePoint;
      if ((cp.optionHints?.length ?? 0) >= 2) continue; // already carries an authored menu
      cp.optionHints = this.splitAuthoredChoiceOptions(pressures[i]);
      if (!cp.description?.trim()) cp.description = `Treatment-defined pressure: ${pressures[i]}`;
      if (altResidue.length) {
        cp.expectedResidue = Array.from(new Set([...(cp.expectedResidue || []), ...altResidue]));
      }
    }
  }

  private ensureDramaticAuditMinimums(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    const audit = blueprint.dramaticAudit || {} as DramaticStructureAudit;
    const themePressure = this.pickBlueprintText(
      audit.themePressure,
      guidance?.themePressure,
      guidance?.liePressure,
      `This episode tests the theme through protagonist choice, cost, identity, relationship, and information pressure.`
    );
    const personalStake = this.pickPersonalStake(
      audit.personalStake,
      guidance?.liePressure,
      guidance?.bPressure,
      guidance?.consequenceResidue,
      `The protagonist's identity, reputation, trust, and future options are at risk.`
    );
    const stakesLayers = this.mergeTreatmentStakesLayers(
      audit.stakesLayers,
      this.inferTreatmentStakesLayers(guidance, input)
    );

    blueprint.dramaticAudit = {
      ...audit,
      episodeQuestion: this.pickBlueprintText(
        audit.episodeQuestion,
        guidance?.dramaticQuestion,
        `Will the protagonist change the situation in ${input.episodeTitle}?`
      ),
      themeQuestion: this.pickBlueprintText(
        audit.themeQuestion,
        'What does the protagonist owe the truth of who they are becoming?'
      ),
      themePressure,
      themeAngle: this.pickBlueprintText(audit.themeAngle, guidance?.themePressure, themePressure),
      themeChoicePressure: this.hasThemeChoiceAction(audit.themeChoicePressure)
        ? audit.themeChoicePressure
        : this.buildTreatmentThemeChoicePressure(guidance, themePressure),
      personalStake,
      stakesLayers,
      majorTurns: Array.isArray(audit.majorTurns) && audit.majorTurns.length > 0
        ? audit.majorTurns
        : [{
            id: 'turn-1',
            description: guidance?.forcedChoice || guidance?.obstacle || `The protagonist must act in ${input.episodeTitle}.`,
            turnType: 'choice',
            driver: 'player_choice',
            protagonistInfluence: guidance?.forcedChoice || 'The player/protagonist action changes the episode pressure.',
            closesQuestion: 'The opening pressure becomes a decision.',
            opensQuestion: guidance?.cliffhangerQuestion || guidance?.nextEpisodePressure || guidance?.endingPressure || guidance?.nextEpisodeCausality || 'The choice leaves visible residue.',
            memorableImageOrLine: guidance?.visualAnchor || input.episodeTitle,
          }],
      informationPlan: this.normalizeInformationPlan(
        audit.informationPlan,
        guidance,
        guidance?.informationMovement || guidance?.cSeed || themePressure,
        guidance?.nextEpisodePressure || guidance?.cliffhangerQuestion || guidance?.endingPressure || guidance?.nextEpisodeCausality || 'The information changes what the player can choose next.',
      ),
    };

    for (const scene of blueprint.scenes || []) {
      scene.themePressure = this.pickBlueprintText(scene.themePressure, themePressure);
      scene.personalStake = this.pickPersonalStake(scene.personalStake, personalStake);
      scene.stakesLayers = this.mergeTreatmentStakesLayers(scene.stakesLayers, stakesLayers);
      if (scene.choicePoint) {
        scene.choicePoint.themeAnswer = this.hasThemeChoiceAction(scene.choicePoint.themeAnswer)
          && !this.hasExternalThemeResolutionText(scene.choicePoint.themeAnswer)
          ? scene.choicePoint.themeAnswer
          : this.buildTreatmentThemeChoicePressure(guidance, scene.themePressure || themePressure);
        scene.choicePoint.stakesLayers = this.mergeTreatmentStakesLayers(scene.choicePoint.stakesLayers, stakesLayers);
      }
    }
  }

  private repairTreatmentForwardPressure(blueprint: EpisodeBlueprint, guidance: TreatmentEpisodeGuidance | undefined): void {
    const endingPressure = guidance?.endingPressure
      || guidance?.cliffhangerHook
      || guidance?.cliffhangerQuestion
      || guidance?.nextEpisodePressure
      || guidance?.authoredCliffhanger
      || guidance?.endingTurnout
      || guidance?.nextEpisodeCausality;
    if (!this.hasBlueprintText(endingPressure)) return;

    const finalScenes = (blueprint.scenes || []).filter((scene) => (scene.leadsTo || []).length === 0);
    const finalScene = finalScenes[0] || blueprint.scenes?.[blueprint.scenes.length - 1];
    if (!finalScene) return;

    finalScene.keyBeats = Array.isArray(finalScene.keyBeats) ? finalScene.keyBeats : [];
    if (!finalScene.keyBeats.some((beat) => beat.includes(endingPressure))) {
      finalScene.keyBeats.push(endingPressure);
    }
    finalScene.narrativeFunction = finalScene.narrativeFunction
      ? `${finalScene.narrativeFunction} ${endingPressure}`
      : endingPressure;
    finalScene.dramaticStructure = {
      question: finalScene.dramaticStructure?.question || guidance?.dramaticQuestion || blueprint.dramaticAudit?.episodeQuestion || 'What changes because of this scene?',
      turn: finalScene.dramaticStructure?.turn || guidance?.forcedChoice || guidance?.informationMovement || endingPressure,
      pressurePeak: finalScene.dramaticStructure?.pressurePeak || guidance?.endingTurnout || guidance?.consequenceResidue || endingPressure,
      changedState: finalScene.dramaticStructure?.changedState || endingPressure,
    };
    finalScene.residue = Array.isArray(finalScene.residue) ? finalScene.residue : [];
    if (!finalScene.residue.some((item) => item.description?.includes(endingPressure))) {
      finalScene.residue.push({ type: 'promise', description: endingPressure });
    }

    blueprint.arc = blueprint.arc || {
      you: '',
      need: '',
      go: '',
      search: '',
      find: '',
      take: '',
      return: '',
      change: '',
    };
    if (!blueprint.arc.change?.includes(endingPressure)) {
      blueprint.arc.change = [blueprint.arc.change, endingPressure].filter(Boolean).join(' ');
    }
  }

  private repairTreatmentDramaticAudit(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance || {};

    const stakesLayers = this.inferTreatmentStakesLayers(guidance, input);
    const episodeQuestion = guidance.dramaticQuestion
      || blueprint.dramaticAudit?.episodeQuestion
      || `Will the protagonist change the situation in ${input.episodeTitle}?`;
    const themePressure = guidance.themePressure
      || guidance.liePressure
      || `This episode tests the theme through the protagonist's choice, cost, identity, and relationship pressure.`;
    const themeChoicePressure = this.hasThemeChoiceAction(blueprint.dramaticAudit?.themeChoicePressure)
      ? blueprint.dramaticAudit!.themeChoicePressure
      : this.buildTreatmentThemeChoicePressure(guidance, themePressure);
    const personalStake = guidance.liePressure
      || guidance.bPressure
      || guidance.consequenceResidue
      || `The protagonist's identity, reputation, trust, and future options are at risk.`;
    const nextEpisodePressure = guidance.nextEpisodePressure
      || guidance.cliffhangerQuestion
      || guidance.cliffhangerHook
      || guidance.nextEpisodeCausality
      || guidance.endingPressure
      || guidance.authoredCliffhanger
      || guidance.endingTurnout
      || guidance.consequenceResidue
      || `The changed state of ${input.episodeTitle} creates the next pressure.`;
    const openingPromise = {
      hook: this.pickBlueprintText(
        blueprint.dramaticAudit?.openingPromise?.hook,
        guidance.openingImage,
        guidance.coldOpenFunction,
        guidance.entryGoal,
        input.episodeSynopsis,
      ),
      episodePromise: this.pickBlueprintText(
        blueprint.dramaticAudit?.openingPromise?.episodePromise,
        guidance.episodePromise,
        episodeQuestion,
      ),
      activePressure: this.pickBlueprintText(
        blueprint.dramaticAudit?.openingPromise?.activePressure,
        guidance.obstacle,
        guidance.aPressure,
        guidance.forcedChoice,
        input.episodeSynopsis,
      ),
      optionalStakes: this.pickBlueprintText(
        blueprint.dramaticAudit?.openingPromise?.optionalStakes,
        personalStake,
      ),
    };
    const episodePressureLanes = {
      aPlot: {
        externalPressure: this.pickBlueprintText(
          blueprint.dramaticAudit?.episodePressureLanes?.aPlot?.externalPressure,
          guidance.aPressure,
          guidance.entryGoal,
          input.episodeSynopsis,
        ),
        climaxIntersection: this.pickBlueprintText(
          blueprint.dramaticAudit?.episodePressureLanes?.aPlot?.climaxIntersection,
          guidance.endingTurnout,
          guidance.exitShift,
          nextEpisodePressure,
        ),
      },
      ...(blueprint.dramaticAudit?.episodePressureLanes?.bPlot || guidance.bPressure ? {
        bPlot: {
          mode: blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.mode
            || 'scene',
          relationshipOrIdentityPressure: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.relationshipOrIdentityPressure,
            guidance.bPressure,
            personalStake,
          ),
          protagonistVisibleSignals: Array.isArray(blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.protagonistVisibleSignals)
            && blueprint.dramaticAudit!.episodePressureLanes!.bPlot!.protagonistVisibleSignals.length > 0
            ? blueprint.dramaticAudit!.episodePressureLanes!.bPlot!.protagonistVisibleSignals
            : [this.pickBlueprintText(guidance.bPressure, personalStake)],
          climaxIntersection: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.climaxIntersection,
            guidance.exitShift,
            guidance.consequenceResidue,
            nextEpisodePressure,
          ),
          scenesOrEpisodes: blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.scenesOrEpisodes,
        },
      } : {}),
      ...(blueprint.dramaticAudit?.episodePressureLanes?.cPlot || guidance.cSeed ? {
        cPlot: {
          function: blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.function || 'future_seed',
          seed: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.seed,
            guidance.cSeed,
            nextEpisodePressure,
          ),
          visiblePlant: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.visiblePlant,
            guidance.cSeed,
            guidance.visualAnchor,
            nextEpisodePressure,
          ),
          payoffPlan: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.payoffPlan,
            `Carry forward from ${input.episodeTitle}.`,
          ),
          targetPayoff: blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.targetPayoff || 'later_episode',
        },
      } : {}),
    };

    blueprint.dramaticAudit = {
      episodeQuestion: this.pickBlueprintText(blueprint.dramaticAudit?.episodeQuestion, episodeQuestion),
      episodeQuestionSetup: this.pickBlueprintText(blueprint.dramaticAudit?.episodeQuestionSetup, guidance.openingImage, guidance.openingSituation, guidance.entryGoal, episodeQuestion),
      episodeQuestionAnswer: this.pickBlueprintText(blueprint.dramaticAudit?.episodeQuestionAnswer, guidance.exitShift, guidance.endingTurnout, nextEpisodePressure),
      themeQuestion: this.pickBlueprintText(blueprint.dramaticAudit?.themeQuestion, 'What does the protagonist owe the truth of who they are becoming?'),
      themePressure: this.pickBlueprintText(blueprint.dramaticAudit?.themePressure, themePressure),
      themeAngle: this.pickBlueprintText(blueprint.dramaticAudit?.themeAngle, guidance.themePressure, themePressure),
      themeChoicePressure,
      openingPromise,
      episodePressureLanes,
      episodeEndStateDelta: this.pickBlueprintText(blueprint.dramaticAudit?.episodeEndStateDelta, guidance.endStateChange, guidance.exitShift, guidance.consequenceResidue, nextEpisodePressure),
      nextEpisodePressure: this.pickBlueprintText(blueprint.dramaticAudit?.nextEpisodePressure, nextEpisodePressure),
      personalStake: this.pickPersonalStake(blueprint.dramaticAudit?.personalStake, personalStake),
      stakesLayers: this.mergeTreatmentStakesLayers(blueprint.dramaticAudit?.stakesLayers, stakesLayers),
      majorTurns: Array.isArray(blueprint.dramaticAudit?.majorTurns) && blueprint.dramaticAudit!.majorTurns.length > 0
        ? blueprint.dramaticAudit!.majorTurns
        : [
            {
              id: 'turn-1',
              description: guidance.entryGoal || guidance.openingImage || `The episode opens its pressure in ${input.episodeTitle}.`,
              turnType: 'escalation',
              driver: 'protagonist',
              protagonistInfluence: guidance.entryGoal || 'The protagonist enters with intent and chooses how to meet the pressure.',
              closesQuestion: 'The opening situation becomes active.',
              opensQuestion: episodeQuestion,
              memorableImageOrLine: guidance.visualAnchor || guidance.openingImage || input.episodeTitle,
            },
            {
              id: 'turn-2',
              description: guidance.forcedChoice || guidance.obstacle || `The protagonist must make a consequential choice.`,
              turnType: 'choice',
              driver: 'player_choice',
              protagonistInfluence: guidance.forcedChoice || 'The player choice reshapes the pressure and residue.',
              closesQuestion: 'Passive chronology ends.',
              opensQuestion: guidance.consequenceResidue || nextEpisodePressure,
              memorableImageOrLine: guidance.visualAnchor || guidance.consequenceResidue || input.episodeTitle,
            },
            {
              id: 'turn-3',
              description: guidance.exitShift || guidance.endingTurnout || nextEpisodePressure,
              turnType: 'cost',
              driver: 'protagonist',
              protagonistInfluence: guidance.exitShift || 'The protagonist leaves changed by the choice and its cost.',
              closesQuestion: episodeQuestion,
              opensQuestion: nextEpisodePressure,
              memorableImageOrLine: guidance.visualAnchor || guidance.endingTurnout || nextEpisodePressure,
            },
          ],
      informationPlan: this.normalizeInformationPlan(
        blueprint.dramaticAudit?.informationPlan,
        guidance,
        guidance.informationMovement || guidance.cSeed || guidance.visualAnchor || nextEpisodePressure,
        nextEpisodePressure,
      ),
    };

    for (const scene of blueprint.scenes || []) {
      scene.personalStake = this.pickPersonalStake(scene.personalStake, personalStake);
      scene.themePressure = this.pickBlueprintText(scene.themePressure, themePressure);
      scene.stakesLayers = this.mergeTreatmentStakesLayers(scene.stakesLayers, stakesLayers);
      if (scene.choicePoint) {
        scene.choicePoint.stakesLayers = this.mergeTreatmentStakesLayers(scene.choicePoint.stakesLayers, stakesLayers);
      }
    }

  }

  private sanitizeInformationOwners(owners: unknown): InformationOwner[] {
    const rawOwners = Array.isArray(owners) ? owners : owners ? [owners] : [];
    const mapped = rawOwners.flatMap((owner): InformationOwner[] => {
      const value = String(owner || '').toLowerCase();
      if (!value.trim()) return [];
      if (['player', 'audience', 'protagonist', 'ally', 'antagonist', 'world'].includes(value)) {
        return [value as InformationOwner];
      }
      if (/\b(player|reader|audience)\b/.test(value)) return ['player'];
      if (/\b(protagonist|lead|hero|heroine|kylie|aethavyr)\b/.test(value)) return ['protagonist'];
      if (/\b(ally|friend|stela|mika|radu|companion|support)\b/.test(value)) return ['ally'];
      if (/\b(antagonist|villain|victor|enemy|opponent)\b/.test(value)) return ['antagonist'];
      if (/\b(world|public|city|court|community|society)\b/.test(value)) return ['world'];
      return [];
    });
    const unique = Array.from(new Set(mapped));
    return unique.length > 0 ? unique : ['player', 'protagonist'];
  }

  private repairTreatmentResidue(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    const authoredResidue = this.collectAuthoredResidue(guidance);
    if (authoredResidue.length === 0) return;

    blueprint.narrativePromises = Array.isArray(blueprint.narrativePromises)
      ? blueprint.narrativePromises
      : [];

    const setupScene = blueprint.startingSceneId || blueprint.scenes?.[0]?.id || `episode-${input.episodeNumber}`;
    for (const residue of authoredResidue) {
      const alreadyPromised = blueprint.narrativePromises.some((promise) =>
        promise.description?.includes(residue)
      );
      if (!alreadyPromised) {
        blueprint.narrativePromises.push({
          description: `Treatment residue to carry forward: ${residue}`,
          setupScene,
          importance: 'moderate',
        });
      }
    }

    const choiceScene = blueprint.scenes?.find((scene) => scene.choicePoint);
    if (!choiceScene?.choicePoint) return;

    choiceScene.choicePoint.expectedResidue = Array.from(new Set([
      ...(choiceScene.choicePoint.expectedResidue || []),
      ...authoredResidue,
    ]));

    choiceScene.choicePoint.reminderPlan = {
      immediate: choiceScene.choicePoint.reminderPlan?.immediate
        || this.fictionFirstImmediateResidue(authoredResidue[0]),
      shortTerm: choiceScene.choicePoint.reminderPlan?.shortTerm
        || this.fictionFirstShortTermResidue(authoredResidue[0]),
      ...(choiceScene.choicePoint.reminderPlan?.later
        ? { later: choiceScene.choicePoint.reminderPlan.later }
        : { later: this.fictionFirstLaterResidue(authoredResidue[0]) }),
    };

    this.registerConsequenceSeedEmitters(blueprint, input, guidance);
    this.registerBranchAxisEmitters(blueprint, input);
    this.registerConsequenceChainEmitters(blueprint, input);
  }

  private fictionFirstResidueSummary(text: string): string {
    return text
      .replace(/\bshow\s+immediate\s+residue\s+from\s+(?:the\s+)?authored\s+path:?\s*/gi, '')
      .replace(/\bkeep\s+this\s+authored\s+residue\s+visible\s+after\s+reconvergence:?\s*/gi, '')
      .replace(/\bfuture\s+scenes?\s+should\s+remember:?\s*/gi, '')
      .replace(/\bauthored\s+(?:path|residue)\b/gi, 'choice')
      .replace(/\breconvergence\b/gi, 'the aftermath')
      .replace(/\bresidue\b/gi, 'aftermath')
      .replace(/\bthe\s+next\s+scene\b/gi, 'what follows')
      .replace(/\blater\s+episode\b/gi, 'later')
      .replace(/\bin\s+a\s+later\s+episode\b/gi, 'later')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private fictionFirstImmediateResidue(text: string): string {
    const summary = this.fictionFirstResidueSummary(text);
    return summary || 'The room remembers what you chose.';
  }

  private fictionFirstShortTermResidue(text: string): string {
    const summary = this.fictionFirstResidueSummary(text);
    return summary
      ? `${summary} The next silence, glance, or opened door carries it forward.`
      : 'The next silence, glance, or opened door carries what changed.';
  }

  private fictionFirstLaterResidue(text: string): string {
    const summary = this.fictionFirstResidueSummary(text);
    return summary
      ? `${summary} It waits for the moment someone notices.`
      : 'What changed waits for the moment someone notices.';
  }

  /**
   * Treatment fidelity — make the season's ending-axis flags REACHABLE on-page.
   *
   * The SeasonPlanner declares each ending state-driver as a `treatment_branch_*`
   * entry in `seasonPlan.seasonFlags` (with a `setInEpisode`), surfaced to this
   * episode as `seasonPlanDirectives.flagsToSet`. The finale's ending-route logic
   * READS those axes — but nothing ever SET them (only destination-keyed
   * `treatment_branch_<sceneId>` and `route_*` flags were emitted, and `route_*`
   * only in route-sliced plans), so the named endings were mechanically
   * unreachable in `standard` mode (Gen-4 defect).
   *
   * This deterministically, for the ending axes whose `setInEpisode` is this
   * episode:
   *   (a) registers each axis flag in `suggestedFlags` so the pipeline tracks it
   *       and downstream episodes can forward-condition on it; and
   *   (b) records the axis flags on a choice-bearing scene's
   *       `choicePoint.setsBranchAxes` so the branch-axis emitter
   *       ({@link emitSceneBranchAxes}) attaches a real `setFlag` (round-robin
   *       across the scene's choices, so distinct choices drive distinct axes).
   *
   * Works across regular and route-sliced plans because the axes come
   * from `flagsToSet` (derived from `seasonFlags`), not from the
   * `route_*` path.
   */
  private registerBranchAxisEmitters(
    blueprint: EpisodeBlueprint,
    input: StoryArchitectInput,
  ): void {
    // Emit every seasonFlag scheduled for this episode (ending axes AND
    // season-anchor flags). Previously only `treatment_branch_*` were wired,
    // so other setInEpisode flags never received a ChoiceAuthor setFlag and
    // downstream residue/flag contracts stayed unpaid.
    const axisFlags = (input.seasonPlanDirectives?.flagsToSet || [])
      .map((f) => f.flag)
      .filter((flag): flag is string => typeof flag === 'string' && flag.trim().length > 0);
    if (axisFlags.length === 0) return;

    const scenes = blueprint.scenes || [];
    if (scenes.length === 0) return;

    blueprint.suggestedFlags = Array.isArray(blueprint.suggestedFlags) ? blueprint.suggestedFlags : [];
    const knownFlagNames = new Set(blueprint.suggestedFlags.map((f) => f.name));
    const flagDescriptionByName = new Map(
      (input.seasonPlanDirectives?.flagsToSet || []).map((f) => [f.flag, f.description]),
    );
    for (const flag of axisFlags) {
      getFlagRegistry().registerBranchAxis(flag, `blueprint:${blueprint.episodeId ?? 'episode'}`);
      if (knownFlagNames.has(flag)) continue;
      knownFlagNames.add(flag);
      blueprint.suggestedFlags.push({
        name: flag,
        description: flagDescriptionByName.get(flag) || `Ending-axis flag set on-page so its ending is reachable: ${flag}`,
      });
    }

    // Prefer a genuine branch point (choicePoint.branches truthy) so distinct
    // choices can drive distinct axes; else fall back to the last choice-bearing scene.
    const choiceScenes = scenes.filter((s) => s.choicePoint);
    if (choiceScenes.length === 0) return;
    const axisHost = choiceScenes.find((s) => s.choicePoint?.branches)
      || choiceScenes[choiceScenes.length - 1];
    if (axisHost.choicePoint) {
      axisHost.choicePoint.setsBranchAxes = Array.from(new Set([
        ...(axisHost.choicePoint.setsBranchAxes || []),
        ...axisFlags,
      ]));
    }
  }

  /**
   * Treatment fidelity §3.3 — make authored consequence seeds SET on-page, not
   * only read. The SeasonPlannerAgent encodes each authored seed as a
   * `flag:treatment_seed_ep<N>_<idx> — <seed>` directive on the encounter's
   * `encounterSetupContext` (a READ/precondition position), and as a
   * cross-episode consequence chain — but nothing ever SET the flag, so any later
   * `treatment_seed_*` precondition could never be true.
   *
   * This deterministically:
   *   (a) registers each seed flag in `suggestedFlags` so the pipeline tracks it
   *       as a known flag the episode establishes; and
   *   (b) records the seed on the origin scene's `choicePoint.setsTreatmentSeeds`
   *       so the choice author / downstream emitter attaches a `setFlag`.
   *
   * The flag id matches the SeasonPlannerAgent convention exactly
   * (`treatment_seed_ep<episodeNumber>_<index+1>`) so the emitted flag is the same
   * name the encounter's precondition reads.
   */
  private registerConsequenceSeedEmitters(
    blueprint: EpisodeBlueprint,
    input: StoryArchitectInput,
    guidance: TreatmentEpisodeGuidance | undefined,
  ): void {
    const seeds = guidance?.consequenceSeeds || [];
    if (seeds.length === 0) return;

    const parsedFromId = Number((blueprint.episodeId || '').match(/(\d+)/)?.[1]);
    const episodeNumber = input.episodeNumber
      ?? blueprint.number
      ?? (Number.isFinite(parsedFromId) ? parsedFromId : undefined);
    if (episodeNumber == null) return;

    // Choose the origin scene that should SET the seed: prefer the planned
    // encounter (the episode's hinge), else the last choice-bearing scene, else
    // the last scene. This mirrors the season scene plan's origin-scene rule.
    const scenes = blueprint.scenes || [];
    if (scenes.length === 0) return;
    const originScene =
      scenes.find((s) => s.isEncounter)
      || [...scenes].reverse().find((s) => s.choicePoint)
      || scenes[scenes.length - 1];

    blueprint.suggestedFlags = Array.isArray(blueprint.suggestedFlags) ? blueprint.suggestedFlags : [];
    const knownFlagNames = new Set(blueprint.suggestedFlags.map((f) => f.name));
    const emittedFlags: string[] = [];
    const sceneTextForSeed = (scene: EpisodeBlueprint['scenes'][number]): string => [
      scene.id,
      scene.name,
      scene.description,
      scene.location,
      scene.narrativeFunction,
      scene.dramaticPurpose,
      scene.choicePoint?.description,
      ...(scene.keyBeats || []),
      ...(scene.choicePoint?.optionHints || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const seedTokens = (seed: string): string[] => seed
      .toLowerCase()
      .split(/[^a-z0-9âăîșşțţéèêëáàäöüóòíìúùç]+/i)
      .map((token) => token.trim())
      .filter((token) =>
        token.length >= 3 &&
        ![
          'the', 'and', 'or', 'did', 'didn', 'with', 'that', 'this', 'into', 'from', 'when', 'then', 'their', 'there',
          'accept', 'accepted', 'decline', 'declined', 'take', 'takes', 'took', 'give', 'gives', 'gave',
          'kylie', 'protagonist',
        ].includes(token)
      );
    const originIndexForHost = scenes.indexOf(originScene);
    const eligibleChoiceScenes =
      scenes.slice(0, originIndexForHost + 1).filter((scene) => scene.choicePoint);
    const fallbackSeedHost =
      (originScene.choicePoint ? originScene : undefined)
      || [...scenes.slice(0, originIndexForHost + 1)].reverse().find((s) => s.choicePoint)
      || [...scenes].reverse().find((s) => s.choicePoint);
    const bestSeedHostFor = (seed: string): EpisodeBlueprint['scenes'][number] | undefined => {
      const tokens = seedTokens(seed);
      if (tokens.length === 0) return fallbackSeedHost;
      let bestScene: EpisodeBlueprint['scenes'][number] | undefined;
      let bestScore = 0;
      for (const scene of eligibleChoiceScenes) {
        const haystack = sceneTextForSeed(scene);
        const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
        if (score > bestScore) {
          bestScore = score;
          bestScene = scene;
        }
      }
      return bestScore > 0 ? bestScene : fallbackSeedHost;
    };
    const flagsByHost = new Map<EpisodeBlueprint['scenes'][number], string[]>();

    seeds.slice(0, 4).forEach((seed, index) => {
      const flagName = getFlagRegistry().mintTreatmentSeedFlag(episodeNumber, index + 1, `blueprint:${blueprint.episodeId ?? 'episode'}`);
      emittedFlags.push(flagName);
      if (!knownFlagNames.has(flagName)) {
        knownFlagNames.add(flagName);
        blueprint.suggestedFlags.push({
          name: flagName,
          description: `Authored consequence seed set on-page in episode ${episodeNumber}: ${seed}`,
        });
      }
      // Record the seed directive on the origin scene's setup context so the
      // encounter that READS this precondition also has a matching SET on-page.
      // The `flag:<name> — <desc>` form is the same shape the planner emits.
      const directive = `flag:${flagName} — ${seed}`;
      originScene.encounterSetupContext = Array.from(new Set([
        ...(originScene.encounterSetupContext || []),
        directive,
      ]));

      const host = bestSeedHostFor(seed);
      if (host?.choicePoint) {
        flagsByHost.set(host, [...(flagsByHost.get(host) || []), flagName]);
      }
    });

    // Carry the flag names on a CHOICE-BEARING scene's choicePoint so the
    // deterministic emitter (emitTreatmentSeedConsequences) attaches a real `setFlag`
    // to one of that scene's authored choices. The origin scene is often the
    // encounter (the episode's hinge), which has NO choicePoint and never reaches
    // ChoiceAuthor — so depending on `originScene.choicePoint` silently dropped the
    // seed for those episodes (the choicePoint-guard skip). Route through the
    // nearest choice-bearing scene at/before the origin instead, so an episode that
    // authored consequenceSeeds always emits them on-page even when its origin is an
    // encounter. The encounter still READS the flag via its encounterSetupContext.
    if (emittedFlags.length > 0) {
      for (const [seedHost, flags] of flagsByHost) {
        if (seedHost.choicePoint) {
          seedHost.choicePoint.setsTreatmentSeeds = Array.from(new Set([
            ...(seedHost.choicePoint.setsTreatmentSeeds || []),
            ...flags,
          ]));
        }
      }
    }
  }

  /**
   * Treatment fidelity — make planned consequence-chain residue flags SET on-page.
   *
   * SeasonPlanner encodes each authored consequence chain as a
   * `consequence_<slug>` SeasonResidueObligation. Those land on
   * `outgoingResidue` / `choicePoint.residueObligationIds`, but if ChoiceAuthor
   * never stamps the matching setFlag the ledger seals with `missingOutgoing`.
   * Mirror {@link registerBranchAxisEmitters}: record the chain flags on
   * `setsBranchAxes` so {@link emitSceneBranchAxes} attaches real setFlag
   * consequences (and applyChoiceResidueBackstop remains a second backstop).
   */
  private registerConsequenceChainEmitters(
    blueprint: EpisodeBlueprint,
    input: StoryArchitectInput,
  ): void {
    const outgoing = input.seasonPlanDirectives?.outgoingResidue || [];
    const chainFlags = outgoing
      .map((obligation) => obligation.flag)
      .filter((flag): flag is string =>
        typeof flag === 'string'
        && flag.startsWith('consequence_')
        && flag.trim().length > 0
      );
    if (chainFlags.length === 0) return;

    const scenes = blueprint.scenes || [];
    if (scenes.length === 0) return;

    blueprint.suggestedFlags = Array.isArray(blueprint.suggestedFlags) ? blueprint.suggestedFlags : [];
    const knownFlagNames = new Set(blueprint.suggestedFlags.map((f) => f.name));
    for (const flag of chainFlags) {
      if (knownFlagNames.has(flag)) continue;
      knownFlagNames.add(flag);
      const obligation = outgoing.find((entry) => entry.flag === flag);
      blueprint.suggestedFlags.push({
        name: flag,
        description: obligation?.authoringGuidance
          || obligation?.choiceAnchor
          || `Treatment consequence-chain flag set on-page: ${flag}`,
      });
    }

    const choiceScenes = scenes.filter((s) => s.choicePoint);
    if (choiceScenes.length === 0) return;
    // Prefer a scene already assigned this residue; else last choice-bearing scene.
    const host = choiceScenes.find((scene) =>
      chainFlags.some((flag) => {
        const obligation = outgoing.find((entry) => entry.flag === flag);
        return obligation && scene.choicePoint?.residueObligationIds?.includes(obligation.id);
      })
    ) || choiceScenes.find((s) => s.choicePoint?.branches)
      || choiceScenes[choiceScenes.length - 1];
    if (!host.choicePoint) return;
    host.choicePoint.setsBranchAxes = Array.from(new Set([
      ...(host.choicePoint.setsBranchAxes || []),
      ...chainFlags,
    ]));
    for (const flag of chainFlags) {
      const obligation = outgoing.find((entry) => entry.flag === flag);
      if (!obligation) continue;
      host.choicePoint.residueObligationIds = Array.from(new Set([
        ...(host.choicePoint.residueObligationIds || []),
        obligation.id,
      ]));
      host.residueObligationIds = Array.from(new Set([
        ...(host.residueObligationIds || []),
        obligation.id,
      ]));
    }
  }

  private validatePlannedEncounterCoverage(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const plannedEncounters = input.seasonPlanDirectives?.plannedEncounters || [];
    if (plannedEncounters.length === 0) return;

    const encounterScenes = blueprint.scenes.filter((scene) => scene.isEncounter && scene.encounterType);
    if (encounterScenes.length < plannedEncounters.length) {
      throw new Error(
        `Blueprint defines ${encounterScenes.length} encounter scene(s), but season plan requires ${plannedEncounters.length}`
      );
    }

    for (const plannedEncounter of plannedEncounters) {
      const matchedScene = encounterScenes.find((scene) => this.sceneMatchesPlannedEncounter(scene, plannedEncounter));
      if (!matchedScene) {
        throw new Error(
          `Blueprint is missing required planned encounter "${plannedEncounter.id}" (${plannedEncounter.type}): ${plannedEncounter.description}`
        );
      }
      if (matchedScene.plannedEncounterId !== plannedEncounter.id) {
        throw new Error(
          `Encounter scene "${matchedScene.id}" must set plannedEncounterId="${plannedEncounter.id}" to bind the blueprint to the season plan`
        );
      }
      matchedScene.encounterType = this.normalizeEncounterType(plannedEncounter.type);
      matchedScene.encounterStoryCircleTarget = normalizeEncounterStoryCircleTarget(
        matchedScene.encounterStoryCircleTarget || plannedEncounter.storyCircleTarget,
        undefined,
        [
          matchedScene.encounterDescription,
          matchedScene.encounterStakes,
          plannedEncounter.description,
          plannedEncounter.stakes,
          plannedEncounter.centralConflict,
          plannedEncounter.aftermathConsequence,
        ].filter(Boolean).join(' '),
      );
      matchedScene.encounterStoryCircleTargetRationale = matchedScene.encounterStoryCircleTargetRationale
        || plannedEncounter.storyCircleTargetRationale
        || buildEncounterStoryCircleTargetRationale(
          matchedScene.encounterStoryCircleTarget,
          undefined,
          plannedEncounter.description,
        );
      if (!matchedScene.encounterStakes?.trim()) {
        throw new Error(`Encounter scene "${matchedScene.id}" is missing encounterStakes`);
      }
      if (!matchedScene.encounterRelevantSkills || matchedScene.encounterRelevantSkills.length === 0) {
        throw new Error(`Encounter scene "${matchedScene.id}" is missing encounterRelevantSkills`);
      }
      if (!matchedScene.encounterBeatPlan || matchedScene.encounterBeatPlan.length < 3) {
        throw new Error(`Encounter scene "${matchedScene.id}" must include encounterBeatPlan with at least 3 planned beats`);
      }
      const requiredNpcIds = new Set(matchedScene.encounterRequiredNpcIds || []);
      const sceneNpcIds = new Set(matchedScene.npcsPresent || []);
      const missingNpcIds: string[] = [];
      const stagingText = [
        this.sceneBlueprintStagingText(matchedScene),
        plannedEncounter.description,
        plannedEncounter.centralConflict,
        plannedEncounter.stakes,
      ].filter(Boolean).join(' ');
      for (const npcId of plannedEncounter.npcsInvolved || []) {
        const displayName = String(npcId).includes(' ') || /[A-Z]/.test(String(npcId))
          ? String(npcId)
          : String(npcId).replace(/^char-/, '').replace(/-/g, ' ');
        if (resolveCharacterIntroMode({ characterName: displayName, stagingText }) === 'anonymous_plant') {
          continue;
        }
        if (!requiredNpcIds.has(npcId)) {
          missingNpcIds.push(npcId);
          requiredNpcIds.add(npcId);
        }
        if (!sceneNpcIds.has(npcId)) {
          sceneNpcIds.add(npcId);
        }
      }
      if (missingNpcIds.length > 0) {
        console.warn(
          `[StoryArchitect] Encounter scene "${matchedScene.id}" omitted planned NPC(s) ${missingNpcIds.join(', ')} in encounterRequiredNpcIds; auto-merging from season plan`
        );
      }
      matchedScene.encounterRequiredNpcIds = Array.from(requiredNpcIds);
      matchedScene.npcsPresent = Array.from(sceneNpcIds);
    }
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Story Architect

You are the master narrative designer for interactive fiction. Your primary job is to design episodes built around a single, intensely dramatic ENCOUNTER that everything else exists to earn.

${BRANCH_AND_BOTTLENECK}

## THE ENCOUNTER-FIRST DESIGN PROCESS

**The encounter IS the episode.** Everything else is setup.

Design every episode using this process — in this order:

### Step 1: Choose the Encounter
Identify the most dramatically charged moment this episode can contain. Ask: "What is the ONE scene where the stakes are highest, the conflict is most intense, and the player's choices feel most consequential?" That is your encounter. It is the episode's reason for existing.

You are NOT limited to the source material. Feel free to invent or heighten a confrontation, crisis, or conflict that maximises drama — as long as it fits the themes and characters. A quiet Victorian novel can become an intense social encounter. A romantic story can have a harrowing escape. A literary classic can have a scene of shocking confrontation.

### Step 2: Design What Players Need to Know
Before the encounter, players must:
- Know who the enemy/obstacle is and why they're a threat
- Understand the personal stakes (not just plot stakes — what does THIS mean for this character's identity?)
- Have formed opinions, relationships, and loyalties that make each encounter choice feel loaded
- Be emotionally invested in the outcome

For every scene before the encounter, ask: **"What does this scene give the player that makes the encounter's choices matter more?"**

### Step 3: Design the Encounter's Internal Choices
The encounter must have multiple meaningful choices at each beat. Each choice should:
- Draw on what was established in earlier scenes (relationships, information, values)
- Have a different skill/attribute that makes it viable for different player builds
- Carry the IDENTITY stakes from the episode (not just tactical stakes)
- Make the player understand the risk domain and leverage in story terms, even though the numbers stay hidden

### Step 4: Place the Encounter at the Episode's Climax
The encounter goes at the dramatic peak — roughly two-thirds to three-quarters of the way through. Everything before it is buildup. Everything after it is consequence.

---

## ENCOUNTER TYPES (All Genres — Required Every Episode)

**Encounters are not limited to action stories.** Every genre has scenes of intense, skill-tested conflict.

- **Combat**: Fights, duels, physical confrontations, battles. *(adventure, action)*
- **Chase**: Pursuit, escape, race against time. *(thriller, gothic)*
- **Stealth**: Infiltration, avoiding detection, moving unseen. *(spy, heist)*
- **Social**: The most versatile type. Use for ANY high-stakes interpersonal confrontation where failure has real consequences — accusations, ultimatums, confessions forced under pressure, an argument that could end a relationship, persuasion against someone who doesn't want to be persuaded.
  - Literary examples: Hindley's public humiliation of Heathcliff (Wuthering Heights); Rochester's interrogation of Jane (Jane Eyre); Darcy's disastrous first proposal (Pride and Prejudice); the final confrontation between Edmund and his father (King Lear); Hester refusing to name Dimmesdale (The Scarlett Letter).
  - **USE THIS for any literary, romantic, gothic, or character-driven story.**
- **Puzzle**: Investigation, deduction under pressure, decrypting a situation. *(mystery, thriller)*
- **Exploration**: Dangerous terrain, survival, navigating the unknown. *(adventure, gothic)*
- **Mixed**: Two types combined (e.g. a chase that turns into a social confrontation).

When in doubt, **use social**. Almost every story has a scene where the protagonist is directly confronted by another character with something real at stake. That is your encounter.

For encounter scenes, set:
- \`isEncounter: true\`
- \`plannedEncounterId\`: If this episode has pre-planned encounters, copy the exact encounter ID here
- \`encounterType\`: "combat" | "chase" | "stealth" | "social" | "romantic" | "dramatic" | "puzzle" | "exploration" | "investigation" | "negotiation" | "survival" | "heist" | "mixed"
- \`encounterStyle\`: "action" | "social" | "romantic" | "dramatic" | "mystery" | "stealth" | "adventure" | "mixed"
- \`encounterDescription\`: Exactly what the protagonist must overcome — be specific
- \`encounterStoryCircleTarget\`: "go" | "search" | "find" | "take" — preserve the planned encounter target exactly
- \`encounterStoryCircleTargetRationale\`: Why the encounter is a threshold, adaptation test, acquisition, or price
- \`encounterStakes\`: The personal stakes this encounter is cashing in
- \`encounterRequiredNpcIds\`: Every NPC ID that must actively participate in the encounter
- \`encounterRelevantSkills\`: The skills/approaches the encounter should test
- \`encounterBeatPlan\`: At least 3 short beat intents in order (opening pressure, escalation, crisis/resolution)
- \`encounterDifficulty\`: "easy" | "moderate" | "hard" | "extreme"
- \`encounterBuildup\`: What earlier scenes must establish so this encounter's choices feel earned
- \`encounterSetupContext\`: Array of strings naming the specific flags and relationship thresholds from earlier scenes that are designed to pay off INSIDE the encounter

**\`encounterSetupContext\` format** — one entry per payoff:
- \`"flag:<flagName> — <effect>"\` e.g. \`"flag:defended_heathcliff — unlocks defiance choice in the confrontation"\`
- \`"relationship:<npcId>.<dimension> <op> <threshold> — <effect>"\` e.g. \`"relationship:hindley.trust < -20 — Hindley's opening line is crueller and colder"\`

Every flag set by a pre-encounter choice, and every relationship dimension involving an encounter NPC, should appear here with a description of how it echoes. This list is passed directly to the EncounterArchitect so it can author the conditional content.

Encounters are ALWAYS bottleneck scenes. They provide agency through skill choices WITHIN the encounter, not through plot branching.

---

## PRE-ENCOUNTER SCENES: The Setup

For every scene that comes BEFORE the encounter, fill in \`encounterBuildup\` — a sentence describing what this specific scene contributes to making the encounter land:

- "Establishes Hindley's cruelty so the player feels the stakes when Heathcliff finally stands up to him"
- "Shows Catherine's fascination with the Linton world — the competing pull that makes the encounter's choice hard"
- "Reveals information that becomes a weapon in the encounter's skill checks"

Every non-encounter scene must earn its place by making the encounter MORE meaningful.

---

## Choice Types (Player Experience)

- **Expression (~35%)**: Personality/voice choices. Cosmetic, no plot impact. NEVER branches.
- **Relationship (~30%)**: Bond building with NPCs. Affect trust, affection, respect, fear. May branch.
- **Strategic (~20%)**: Skill/stat-based choices. May branch.
- **Dilemma (~15%)**: Value-testing, high impact, no clearly right answer. May branch.

**Vary \`choicePoint.type\` across scenes to roughly match this mix.** Most
choice points are expression / relationship / strategic — only about **1 in 7**
should be a \`dilemma\`, reserved for genuine no-right-answer value tests. Do NOT
default every choice point to \`dilemma\`. The single \`dilemma\` in the JSON
example below is one illustration, not a template to repeat.

## Branching

Branching is a PROPERTY of any non-expression choice.
- Set \`branches: true\` on the choicePoint when the scene should diverge
- Include at least ${this.sceneGraphBranching?.minPerEpisode ?? 1} scene-graph branch choice point(s) per episode unless the request explicitly says linear
- A scene-graph branch means: a non-expression choicePoint with \`branches: true\` AND at least two distinct \`leadsTo\` scene IDs
- Max 1-2 branching choice points per episode; keep them small and reconvergent
- Encounter outcomes (victory/defeat/escape) are valuable, but they DO NOT count as regular scene-graph branching

## Choice Architecture Rules

1. **Choice Density**: At least 50% of scenes MUST have a choicePoint.
2. **Season Opening Choice Rule**: In Episode 1, the first scene MUST have a choicePoint. No delayed second-scene exception.
3. **No Choice Gaps**: Never more than 2 consecutive scenes without a choicePoint.
4. **Stakes Triangle**: Every choicePoint must define Want, Cost, and Identity.
5. **Consequence Legibility**: Major choicePoints should name the consequence domain and how the story will remember the decision.
6. **Competence Arc**: When a future confrontation can be softened or redirected through prep, define what the player can try now, what they lack, and what growth path could help later.

## Scene Types

- **BOTTLENECK**: All players experience this. Use for the encounter, crucial revelations, and emotional peaks.
- **BRANCH**: Player choice leads to meaningfully different paths that eventually reconverge.
- **TRANSITION**: Connects scenes, lower stakes, moves story forward.

## Scene Count Guidelines

- 3-6 scenes is required
- The encounter is typically scene 3-5 (two-thirds of the way through)
- 2-3 scenes before the encounter: setup and escalation
- 1-2 scenes after: consequence and resolution

## Tint System

Dilemma choices set tint flags (e.g., "tint:mercy") that color subsequent scenes. Plan for NPC reactions and textVariants conditioned on these flags.

## Callback & Flag Planning

Expression choices should set memorable flags. Plan at least 1 callback per episode where a later scene references an earlier choice.

Remember: The encounter is the heart. Design outward from it.
`
  }

  /**
   * Map a planned scene's narrative role onto the SceneBlueprint purpose. The
   * hinge roles (turn/payoff) become bottlenecks; setup/development/release are
   * transitions until the branch-coverage repair promotes one to a branch.
   */
  private purposeForRole(role: SceneNarrativeRole | undefined, isEncounter: boolean): SceneBlueprint['purpose'] {
    if (isEncounter) return 'bottleneck';
    if (role === 'turn' || role === 'payoff') return 'bottleneck';
    return 'transition';
  }

  private normalizePlannerText(value: string | undefined): string {
    return (value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sceneEventCueCount(value: string | undefined): number {
    const text = this.normalizePlannerText(value);
    const cues = [
      /\b(?:lands?|arrives?|arrival|unpacks?|suitcases?|address|airport|station|new home|new city)\b/,
      /\b(?:club|venue|side entrance|key card|keycard|private door|service entrance|threshold|invitation)\b/,
      /\b(?:bookshop|bookstore|quartz|crystal|stone|charm|token|talisman|gift|ward|protection)\b/,
      /\b(?:rooftop|roof|terrace|bar|party|table|booth|stranger|date|podcast|kitchen entrance|walk over|follow|notices across)\b/,
      /\b(?:park|garden|alley|street|shadow|pinned|attacker|scream|freeze|fight back|rescues?|ambush|threat|1 ?am)\b/,
      /\b(?:blog|post|readership|reads?|views|comments|viral|codename|draft|dashboard|profile|public pressure|public signal)\b/,
      /\b(?:dm pile|brand deal|message pile|horrible dream|coming over|cliffhanger|episode end)\b/,
    ];
    return cues.filter((cue) => cue.test(text)).length;
  }

  private countActionVerbSeries(value: string | undefined): number {
    const text = this.normalizePlannerText(value);
    if (!text) return 0;
    const matches = text.match(/\b(?:accepts?|adopts?|arrives?|befriends?|explores?|finds?|follows?|forms?|introduces?|lands?|leaves?|meets?|offers?|opens?|starts?|takes?|turns?|unpacks?|walks?|wand(?:er)?s?|writes?)\b/g);
    return matches?.length ?? 0;
  }

  private isBroadPlannedSceneSummary(value: string | undefined): boolean {
    const text = value?.trim();
    if (!text) return false;
    const cueCount = this.sceneEventCueCount(text);
    if (cueCount >= 3) return true;
    if (this.countActionVerbSeries(text) >= 3 && text.length > 120) return true;
    if (
      cueCount >= 2
      && text.length > 140
      && /\b(?:who|and)\s+(?:\w+\s+){0,4}(?:befriends?|introduces?|forms?|meets?|owned by|wanders?|explores?)\b/i.test(text)
    ) {
      return true;
    }
    return cueCount >= 2 && text.length > 170 && /,\s+.*,\s+/.test(text);
  }

  private isGenericPlannedScenePlaceholder(value: string | undefined): boolean {
    const text = this.normalizePlannerText(value);
    return /^(?:setup|development|turn|payoff|release|transition|bottleneck)?\s*scene(?:\s+\d+)?$/.test(text)
      || /^purpose\s+s\d+-\d+$/.test(text)
      || /^encounter\s+(?:treatment-)?enc/.test(text);
  }

  private isChoiceMenuPlanningText(value: string | undefined): boolean {
    const text = value?.trim();
    if (!text) return false;
    const namesCodenames = /\bwhat\s+name\s+do\s+you\s+give\s+him\b/i.test(text)
      && (/\b(?:canonical|the\s+stranger|the\s+velvet|the\s+suit)\b/i.test(text) || /\bmr\.\.\.\./i.test(text));
    const mixedParkMenu = /\bscream\s*,\s*run\s*,\s*freeze\b/i.test(text)
      && (/\bwhat\s+name\s+do\s+you\s+give\s+him\b/i.test(text) || /\bmr\.\.\.\./i.test(text));
    const truncatedParkMenu = /\bscream\s*,\s*run\s*,\s*freeze\b/i.test(text)
      && /\bMr\.\.\.\./.test(text);
    return namesCodenames || mixedParkMenu || truncatedParkMenu;
  }

  private firstConcreteRequiredBeat(requiredBeats: RequiredBeat[]): string | undefined {
    const concreteRequired = requiredBeats.find((beat) => {
      const text = beat.mustDepict || beat.sourceTurn;
      return beat.tier !== 'seed'
        && beat.tier !== 'connective'
        && this.hasChoicePressureSafeBlueprintText(text);
    });
    if (concreteRequired) return concreteRequired.mustDepict || concreteRequired.sourceTurn;

    const seedRequired = requiredBeats.find((beat) => {
      const text = beat.mustDepict || beat.sourceTurn;
      return beat.tier === 'seed' && this.hasChoicePressureSafeBlueprintText(text);
    });
    return seedRequired?.mustDepict || seedRequired?.sourceTurn;
  }

  private hasReaderSafeBlueprintText(value: unknown): value is string {
    return this.hasBlueprintText(value)
      && !isPlanningRegisterText(value)
      && !this.isChoiceMenuPlanningText(value)
      && !isBlueprintHygieneUnsafeText(value);
  }

  private hasChoicePressureSafeBlueprintText(value: unknown): value is string {
    return this.hasReaderSafeBlueprintText(value);
  }

  private localAuthoredFieldText(
    scene: PlannedScene,
    kinds: AuthoredTreatmentFieldContract['contractKind'][],
  ): string | undefined {
    for (const kind of kinds) {
      const match = (scene.authoredTreatmentFields || [])
        .find((field) => field.contractKind === kind && this.hasReaderSafeBlueprintText(field.sourceText));
      if (match?.sourceText) return match.sourceText;
    }
    return undefined;
  }

  private collectLocalSceneKeyBeats(scene: PlannedScene, requiredBeats: RequiredBeat[], localPurpose: string): string[] {
    const candidates = [
      localPurpose,
      scene.turnContract?.turnEvent,
      scene.turnContract?.centralTurn,
      scene.signatureMoment,
      this.localAuthoredFieldText(scene, [
        'cliffhanger_hook',
        'cliffhanger_question',
        'ending_turnout',
        'resolved_episode_tension',
        'end_state_change',
      ]),
      ...(requiredBeats || []).map((beat) => beat.mustDepict || beat.sourceTurn),
    ];
    const out: string[] = [];
    for (const candidate of candidates) {
      const trimmed = candidate?.trim();
      if (!trimmed || this.isBroadPlannedSceneSummary(trimmed)) continue;
      if (!this.hasReaderSafeBlueprintText(trimmed)) continue;
      if (this.isGenericPlannedScenePlaceholder(trimmed)) continue;
      if (out.some((existing) => existing === trimmed)) continue;
      out.push(trimmed);
      if (out.length >= 8) break;
    }
    return out.length > 0 ? out : [localPurpose];
  }

  private localPurposeForPlannedScene(scene: PlannedScene, requiredBeats: RequiredBeat[]): string {
    if (scene.narrativeRole === 'release') {
      const endingPurpose = this.localAuthoredFieldText(scene, [
        'cliffhanger_hook',
        'cliffhanger_question',
        'ending_turnout',
        'resolved_episode_tension',
        'emotional_charge',
        'end_state_change',
      ]);
      if (endingPurpose) return endingPurpose;
    }

    const candidates = [
      scene.turnContract?.turnEvent,
      scene.turnContract?.centralTurn,
      this.firstConcreteRequiredBeat(requiredBeats),
      this.localAuthoredFieldText(scene, [
        'cliffhanger_hook',
        'ending_turnout',
        'resolved_episode_tension',
        'end_state_change',
      ]),
      scene.signatureMoment,
      scene.encounter?.sourceSynopsis,
      scene.encounter?.authoredAnchor,
      scene.encounter?.description,
      scene.encounter?.centralConflict,
      scene.stakes,
      scene.dramaticPurpose,
      scene.title,
    ];
    const concrete = candidates.find((candidate) =>
      this.hasReaderSafeBlueprintText(candidate)
      && !this.isBroadPlannedSceneSummary(candidate)
      && !this.isGenericPlannedScenePlaceholder(candidate)
    );
    if (concrete) return concrete;

    const requiredFallback = this.firstConcreteRequiredBeat(requiredBeats);
    if (requiredFallback && !this.isBroadPlannedSceneSummary(requiredFallback)) {
      const firstSentence = requiredFallback.match(/^[^.!?]+[.!?]/)?.[0]?.trim();
      if (firstSentence && this.hasReaderSafeBlueprintText(firstSentence) && !this.isBroadPlannedSceneSummary(firstSentence)) {
        return firstSentence;
      }
    }

    return pickBlueprintSafeText(scene.title, scene.dramaticPurpose)
      || 'A concrete episode consequence becomes visible.';
  }

  private plannedSceneChoicePressure(scene: PlannedScene, localPurpose: string, requiredBeats: RequiredBeat[]): string {
    const authoredChoicePressure = (scene.authoredTreatmentFields || [])
      .find((field) => field.contractKind === 'major_choice_pressure')?.sourceText;
    const candidates = [
      authoredChoicePressure,
      this.firstConcreteRequiredBeat(requiredBeats),
      scene.signatureMoment,
      localPurpose,
      scene.turnContract?.turnEvent,
      scene.turnContract?.centralTurn,
      scene.stakes,
      scene.dramaticPurpose,
    ];
    const concrete = candidates
      .filter((candidate) =>
        this.hasChoicePressureSafeBlueprintText(candidate)
        && !this.isBroadPlannedSceneSummary(candidate)
        && !this.isGenericPlannedScenePlaceholder(candidate)
      )
      .map((candidate) => this.normalizeChoicePressureText(candidate))
      .find((candidate): candidate is string => Boolean(candidate));
    return concrete || 'the pressure already visible in this moment';
  }

  private normalizeNameMatchText(value: string | undefined): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private npcAliasesForPresence(npc: StoryArchitectInput['availableNPCs'][number]): string[] {
    const name = this.normalizeNameMatchText(npc.name);
    const id = this.normalizeNameMatchText(npc.id);
    const aliases = new Set<string>();
    if (name) aliases.add(name);
    if (id) aliases.add(id);
    for (const part of name.split(' ')) {
      if (part.length >= 4) aliases.add(part);
    }
    return Array.from(aliases).filter(Boolean);
  }

  private plannedSceneNpcPresence(
    scene: PlannedScene,
    requiredBeats: RequiredBeat[],
    input: StoryArchitectInput,
  ): string[] {
    const present = new Set(scene.npcsInvolved ?? []);
    const normalizedPresent = new Set(Array.from(present).map((npc) => this.normalizeNameMatchText(npc)));
    const sceneText = this.normalizeNameMatchText([
      scene.title,
      scene.dramaticPurpose,
      scene.stakes,
      scene.signatureMoment,
      scene.encounter?.sourceSynopsis,
      scene.encounter?.authoredAnchor,
      scene.encounter?.description,
      scene.encounter?.centralConflict,
      scene.turnContract?.centralTurn,
      scene.turnContract?.turnEvent,
      ...(requiredBeats || []).map((beat) => beat.mustDepict || beat.sourceTurn),
    ].filter(Boolean).join(' '));

    for (const npc of input.availableNPCs || []) {
      const aliases = this.npcAliasesForPresence(npc);
      if (aliases.some((alias) => normalizedPresent.has(alias))) {
        present.add(npc.id);
        continue;
      }
      if (aliases.some((alias) => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^| )${escaped}(?: |$)`).test(sceneText);
      })) {
        present.add(npc.id);
      }
    }

    const roster = (input.availableNPCs || []).map((npc) => ({ id: npc.id, name: npc.name }));
    const groupFormationText = this.normalizeNameMatchText([
      scene.dramaticPurpose,
      scene.turnContract?.centralTurn,
      scene.turnContract?.turnEvent,
      scene.stakes,
      ...(scene.sceneEventOwnership?.ownedEvents ?? []).map((event) => event.text),
    ].filter(Boolean).join(' '));
    // Generic formation phrases + named story groups from the lexicon
    // (e.g. "Dusk Club") — never hardcode a specific story's group names here.
    const groupFormationRe = new RegExp(
      `\\b(?:${lexiconAlternation(['three', 'become friends', 'form(?:s|ed)? the', 'social triangle', ...getStoryLexicon().socialGroupNames])})\\b`,
    );
    if (groupFormationRe.test(groupFormationText)) {
      for (const character of input.introducesCharacters ?? []) {
        const resolved = resolveRosterCharacter(character.id, roster)
          ?? resolveRosterCharacter(character.name, roster);
        if (resolved?.id) present.add(resolved.id);
      }
    }
    for (const event of scene.sceneEventOwnership?.ownedEvents ?? []) {
      if (event.cue !== 'socialMeet') continue;
      const eventText = this.normalizeNameMatchText(event.text);
      for (const npc of input.availableNPCs || []) {
        const aliases = this.npcAliasesForPresence(npc);
        if (aliases.some((alias) => new RegExp(`(?:^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(eventText))) {
          present.add(npc.id);
        }
      }
    }

    // Canonicalize to roster ids and dedupe aliases: season plans cast by
    // display name ('Stela Pavel') while text matching adds roster ids
    // ('char-stela-pavel'); carrying both double-lists the character in the
    // SceneWriter prompt and splits introduction-ledger membership.
    const canonical = new Map<string, string>();
    for (const entry of present) {
      const value = String(entry || '').trim();
      if (!value) continue;
      const resolved = resolveRosterCharacter(value, roster);
      const id = resolved?.id ?? value;
      const slug = normalizeCharacterSlug(id);
      if (!canonical.has(slug)) canonical.set(slug, id);
    }
    return Array.from(canonical.values());
  }

  private localChoicePressures(scene: SceneBlueprint): string[] {
    return (scene.authoredTreatmentFields || [])
      .filter((field) => field.contractKind === 'major_choice_pressure')
      .map((field) => field.sourceText)
      .filter((text) => this.hasBlueprintText(text));
  }

  private localChoiceResidue(scene: SceneBlueprint): string[] {
    return (scene.authoredTreatmentFields || [])
      .filter((field) => field.contractKind === 'alternative_path' || field.contractKind === 'consequence_seed')
      .map((field) => field.sourceText)
      .filter((text) => this.hasBlueprintText(text));
  }

  private applyTreatmentChoicePressureToScene(
    scene: SceneBlueprint,
    pressure: string,
    guidance: TreatmentEpisodeGuidance | undefined,
    residue: string[],
  ): void {
    const options = this.splitAuthoredChoiceOptions(pressure);
    const stakesLayers = this.inferTreatmentStakesLayers(guidance, {
      episodeTitle: scene.name,
      episodeSynopsis: scene.description || scene.narrativeFunction || scene.name,
    } as StoryArchitectInput);
    const existingChoice = scene.choicePoint;

    scene.choicePoint = {
      ...(existingChoice || {}),
      type: existingChoice?.type === 'expression' || !existingChoice?.type ? 'dilemma' : existingChoice.type,
      branches: existingChoice?.branches || false,
      stakes: {
        want: pressure,
        cost: guidance?.consequenceResidue || existingChoice?.stakes?.cost || 'Each option leaves a different cost, residue, or lost possibility.',
        identity: guidance?.liePressure || existingChoice?.stakes?.identity || 'The choice defines who the protagonist becomes under pressure.',
      },
      stakesLayers: this.mergeTreatmentStakesLayers(existingChoice?.stakesLayers, stakesLayers),
      themeAnswer: this.hasThemeChoiceAction(existingChoice?.themeAnswer)
        && !this.hasExternalThemeResolutionText(existingChoice?.themeAnswer)
        ? existingChoice?.themeAnswer
        : this.buildTreatmentThemeChoicePressure(guidance, guidance?.themePressure || guidance?.liePressure || pressure),
      description: `Treatment-defined pressure: ${pressure}`,
      optionHints: options.length >= 2 ? options : [pressure],
      consequenceDomain: existingChoice?.consequenceDomain || this.inferChoiceConsequenceDomain(pressure, guidance),
      reminderPlan: {
        immediate: existingChoice?.reminderPlan?.immediate || 'Someone opens a door, withholds a truth, or shifts their tone before the moment passes.',
        shortTerm: existingChoice?.reminderPlan?.shortTerm || 'The next room has to move around what just changed.',
        ...(existingChoice?.reminderPlan?.later
          ? { later: existingChoice.reminderPlan.later }
          : residue[0]
            ? { later: this.fictionFirstLaterResidue(residue[0]) }
            : {}),
      },
      expectedResidue: Array.from(new Set([
        ...(existingChoice?.expectedResidue || []),
        ...residue,
        `Treatment pressure remains visible: ${pressure}`,
      ])),
    };

    scene.keyBeats = Array.isArray(scene.keyBeats) ? scene.keyBeats : [];
    if (!scene.keyBeats.some((beat) => beat.includes(pressure))) {
      scene.keyBeats.push(`Choice pressure: ${pressure}`);
    }
  }

  /** Reconstruct an encounter directive from a `kind: 'encounter'` planned scene. */
  private plannedSceneToEncounterDirective(scene: PlannedScene): PlannedEncounterDirective | undefined {
    const enc = scene.encounter;
    if (!enc) return undefined;
    return {
      id: scene.id,
      type: enc.type,
      // Prefer the FULL authored description — scene.title is a truncated
      // display label, and feeding it here staged the G12 endsong siege from
      // the fragment "…a sustained defensive set piece (wall bre".
      description: enc.sourceSynopsis || enc.authoredAnchor || enc.description || scene.title || scene.dramaticPurpose,
      difficulty: enc.difficulty,
      npcsInvolved: scene.npcsInvolved ?? [],
      stakes: scene.stakes ?? '',
      centralConflict: enc.centralConflict,
      storyCircleTarget: enc.storyCircleTarget,
      storyCircleTargetRationale: enc.storyCircleTargetRationale,
      storyCircleTargetEvidence: enc.storyCircleTargetEvidence,
      aftermathConsequence: enc.aftermathConsequence,
      relevantSkills: enc.relevantSkills ?? [],
      isBranchPoint: enc.isBranchPoint,
      branchOutcomes: enc.branchOutcomes
        ? { victory: enc.branchOutcomes.victory, defeat: enc.branchOutcomes.defeat, escape: enc.branchOutcomes.escape }
        : undefined,
      encounterProfile: enc.encounterProfile || scene.encounterProfile,
    };
  }

  /**
   * Elaborate-mode blueprint construction. Builds an {@link EpisodeBlueprint}
   * deterministically from the season-level planned scenes instead of inventing
   * a scene graph via the LLM. The result is routed through the SAME repair
   * pipeline as the invented path, so choice density, branch coverage, scene
   * transitions, and dramatic-audit minimums are all enforced identically.
   */
  private buildBlueprintFromPlannedScenes(input: StoryArchitectInput): EpisodeBlueprint {
    // Season-plan artifacts are immutable when rehydrated for resume. The
    // binder/finalizer intentionally mutate a working scene projection, never
    // the committed planned-scene payload.
    const plannedScenes = (input.seasonPlanDirectives?.plannedScenes ?? [])
      .map((scene) => JSON.parse(JSON.stringify(scene)) as PlannedScene);
    const binding = rebindPlannedSceneObligations(
      plannedScenes,
      { episodeNumber: input.episodeNumber },
    );
    const canonicalPlan = input.seasonPlanDirectives?.episodeEventPlan;
    const canonicalScenes = canonicalPlan
      ? collapseUnplannedCanonicalSceneShells(binding.scenes, canonicalPlan)
      : binding.scenes;
    const ownership = finalizeEpisodeSceneOwnership(canonicalScenes, {
      episodeNumber: input.episodeNumber,
      storyCircleRole: input.episodeStoryCircleRole,
    });
    if (ownership.routedObligations.length > 0 || ownership.diagnostics.length > 0) {
      console.info(
        `[StoryArchitect] Episode scene ownership finalizer episode ${input.episodeNumber}: ` +
        `${ownership.routedObligations.length} routed obligation(s), ${ownership.diagnostics.length} diagnostic(s)`,
      );
    }
    // Obligation rebinding may change mutable scene metadata, including the
    // provisional order used by legacy helpers. For an ESC-backed episode the
    // immutable EpisodeEventPlan is the chronology authority; reconstruct the
    // working sequence from that projection before creating leadsTo edges.
    const canonicalSceneOrder = new Map(
      (canonicalPlan?.sceneOrder ?? []).map((sceneId, index) => [sceneId, index]),
    );
    const spineUnitOrder = new Map(
      (input.seasonPlanDirectives?.episodeSpine?.units ?? []).map((unit) => [unit.id, unit.order]),
    );
    const planned = canonicalScenes
      .slice()
      .sort((a, b) => {
        const aCanonical = canonicalSceneOrder.get(a.id);
        const bCanonical = canonicalSceneOrder.get(b.id);
        if (aCanonical != null || bCanonical != null) {
          return (aCanonical ?? Number.MAX_SAFE_INTEGER) - (bCanonical ?? Number.MAX_SAFE_INTEGER)
            || a.id.localeCompare(b.id);
        }
        const aSpine = a.spineUnitId ? spineUnitOrder.get(a.spineUnitId) : undefined;
        const bSpine = b.spineUnitId ? spineUnitOrder.get(b.spineUnitId) : undefined;
        if (aSpine != null || bSpine != null) {
          return (aSpine ?? Number.MAX_SAFE_INTEGER) - (bSpine ?? Number.MAX_SAFE_INTEGER)
            || a.id.localeCompare(b.id);
        }
        return a.order - b.order || a.id.localeCompare(b.id);
      });
    planned.forEach((scene, index) => {
      scene.order = index;
    });
    const beatBudgetByScene = new Map(
      binding.report.beatBudgetRecommendations.map((recommendation) => [
        recommendation.sceneId,
        recommendation.recommendedBeatCount,
      ]),
    );
    const bindingSummary = binding.report.decisions.reduce((counts, decision) => {
      counts[decision.action] = (counts[decision.action] ?? 0) + 1;
      return counts;
    }, {} as Record<string, number>);
    if (binding.report.decisions.some((decision) => decision.action !== 'kept')) {
      console.info(
        `[StoryArchitect] Treatment binding rebalance episode ${input.episodeNumber}: ${JSON.stringify(bindingSummary)}`,
      );
    }

    // Treatment invariants (lines the prose must HOLD) extracted from the episode
    // synopsis + turnout — empty unless the treatment states an action-negation.
    const episodeInvariants = extractEpisodeInvariants(
      [input.episodeSynopsis, input.seasonPlanDirectives?.treatmentGuidance?.endingTurnout]
        .filter(Boolean)
        .join('. '),
    );

    const sceneIds = planned.map((s) => s.id);
    const scenes: SceneBlueprint[] = planned.map((p, idx) => {
      const isEncounter = p.kind === 'encounter';
      const nextId = sceneIds[idx + 1];
      const arcPressureBinding = this.sanitizePlannedSceneArcPressure(p, input);
      const openingPremiseContracts = input.seasonPlanDirectives?.narrativeContractGraph?.premiseContracts
        ?? input.seasonPlanDirectives?.episodeEventPlan?.premiseContracts
        ?? [];
      const openingPremiseBeats = input.episodeNumber === 1
        ? openingPremiseContracts
          .filter((contract) => contract.blocking && contract.targetSceneIds.includes(p.id))
          .map((contract) => ({
            id: `${p.id}-${contract.id}`,
            sourceTurn: contract.sourceText,
            mustDepict: contract.sourceText,
            tier: 'authored' as const,
          }))
        : [];
      const requiredBeats = [...arcPressureBinding.requiredBeats, ...openingPremiseBeats, ...(p.encounter?.requiredBeats ?? [])]
        .filter((beat) => !this.isChoiceMenuPlanningText(beat.mustDepict || beat.sourceTurn));
      const localPurpose = this.localPurposeForPlannedScene(p, requiredBeats);
      const localKeyBeats = this.collectLocalSceneKeyBeats(p, requiredBeats, localPurpose);
      const signatureMoment = this.isChoiceMenuPlanningText(p.signatureMoment) ? undefined : p.signatureMoment;
      const spineUnit = p.spineUnitId
        ? input.seasonPlanDirectives?.episodeSpine?.units?.find((unit) => unit.id === p.spineUnitId)
        : undefined;
      const rawTurnContract = p.turnContract as (SceneTurnContract & { pressurePeak?: string }) | undefined;
      const canonicalTurnText = p.narrativeEventPlanVersion != null
        && rawTurnContract?.turnEvent?.trim()
        && !this.isChoiceMenuPlanningText(rawTurnContract.turnEvent)
        ? rawTurnContract.turnEvent.trim()
        : undefined;
      const escTurnText = canonicalTurnText
        || (spineUnit?.text?.trim() && !this.isChoiceMenuPlanningText(spineUnit.text)
          ? spineUnit.text.trim()
          : undefined);
      // ESC fill-slots: when a spine unit owns concrete turn text, copy it into
      // the turnContract so architect/LLM re-author cannot invent a competing turn.
      const turnContract = escTurnText
        ? {
            ...(rawTurnContract ?? {
              turnId: `${p.id}-esc-turn`,
              source: 'treatment' as const,
              beforeState: `Before: ${escTurnText}`,
              afterState: `After: ${escTurnText}`,
              centralTurn: escTurnText,
              turnEvent: escTurnText,
              handoff: `Carry the visible consequence forward from ${escTurnText}`,
            }),
            centralTurn: escTurnText,
            pressurePeak: escTurnText,
            turnEvent: escTurnText,
            handoff: rawTurnContract?.handoff && this.hasReaderSafeBlueprintText(rawTurnContract.handoff)
              ? rawTurnContract.handoff
              : `Carry the visible consequence forward from ${escTurnText}`,
          }
        : rawTurnContract
          ? {
              ...rawTurnContract,
              centralTurn: this.hasReaderSafeBlueprintText(rawTurnContract.centralTurn) ? rawTurnContract.centralTurn : localPurpose,
              pressurePeak: this.hasReaderSafeBlueprintText(rawTurnContract.pressurePeak) ? rawTurnContract.pressurePeak : localPurpose,
              turnEvent: this.hasReaderSafeBlueprintText(rawTurnContract.turnEvent) ? rawTurnContract.turnEvent : localPurpose,
              handoff: this.hasReaderSafeBlueprintText(rawTurnContract.handoff) ? rawTurnContract.handoff : localPurpose,
            }
          : rawTurnContract;
      const locationHintTexts = [
        p.title,
        localPurpose,
        p.turnContract?.turnEvent,
        p.turnContract?.centralTurn,
        p.signatureMoment,
        p.encounter?.sourceSynopsis,
        p.encounter?.authoredAnchor,
        p.encounter?.description,
        p.encounter?.centralConflict,
        ...(p.authoredTreatmentFields || [])
          .filter((field) => [
            'cliffhanger_hook',
            'cliffhanger_question',
            'ending_turnout',
            'resolved_episode_tension',
            'end_state_change',
          ].includes(field.contractKind))
          .map((field) => field.sourceText),
        ...(this.isBroadPlannedSceneSummary(p.dramaticPurpose) ? [] : [p.dramaticPurpose]),
      ];
      const inferredLocation = this.inferPlannedSceneLocationFromRequiredBeats(
        requiredBeats,
        input.currentLocation,
        locationHintTexts,
      );
      // The season plan's location is authoritative when the scene's authored
      // text corroborates it. Inference exists to repair STALE planned
      // locations (episode-default carry-over, raw loc-ids) — it must not
      // override a correct one: storyrpg-lite 2026-07-04T21-46-05 moved the
      // Lumina Books first-meeting scene to Valescu Club because the turn text
      // mentioned the club in passing ("…introduces Kylie to the secret
      // nightlife world of Valescu Club…").
      const repairedLocation = p.spineUnitId && p.locations?.[0]
        ? p.locations[0]
        : this.resolvePlannedSceneLocation({
            plannedLocation: p.locations?.[0],
            inferredLocation,
            currentLocation: input.currentLocation,
            authoredText: [
              ...requiredBeats.map((beat) => beat.mustDepict || beat.sourceTurn || ''),
              ...locationHintTexts,
            ].filter(Boolean).join(' '),
          });
      const scene: SceneBlueprint = {
        id: p.id,
        // Titles may embed raw location ids ("… at loc-valescu-club") — scene
        // names are reader-adjacent (dev overlay, diagnostics, prompts).
        name: prettifyEmbeddedLocationIds(p.title) || `Scene ${idx + 1}`,
        description: localPurpose,
        location: repairedLocation || p.locations?.[0] || input.currentLocation,
        timeOfDay: normalizeTimeOfDay(p.timeOfDay),
        timeJumpFromPrevious: p.timeJump,
        ...(episodeInvariants.length ? { invariants: episodeInvariants } : {}),
        mood: p.narrativeRole === 'release' ? 'reflective' : isEncounter ? 'tense' : 'charged',
        purpose: this.purposeForRole(p.narrativeRole, isEncounter),
        dramaticQuestion: localPurpose,
        wantVsNeed: p.stakes && !this.isBroadPlannedSceneSummary(p.stakes) ? p.stakes : localPurpose,
        conflictEngine: p.stakes && !this.isBroadPlannedSceneSummary(p.stakes)
          ? p.stakes
          : p.encounter?.centralConflict || localPurpose,
        npcsPresent: this.plannedSceneNpcPresence(p, requiredBeats, input),
        characterPresenceContracts: (input.seasonPlanDirectives?.episodeEventPlan?.characterPresenceContracts ?? [])
          .filter((contract) => contract.sceneId === p.id),
        identityScheduleContracts: input.seasonPlanDirectives?.episodeEventPlan?.identityScheduleContracts,
        characterRoleConstraints: (input.seasonPlanDirectives?.episodeEventPlan?.characterRoleConstraints ?? [])
          .filter((contract) => contract.episodeNumber === p.episodeNumber),
        narrativeFunction: localPurpose,
        narrativeConstraints: p.narrativeConstraints,
        narrativeRole: p.narrativeRole,
        planningOrigin: p.planningOrigin,
        plannedHasChoice: p.hasChoice,
        // Preserve the canonical choice taxonomy while materializing the
        // planned scene. Without this, treatment-authored relationship
        // milestones are reclassified as generic dilemmas and the pacing
        // policy correctly (but incorrectly for the source plan) caps them
        // before content generation.
        choicePoint: p.hasChoice && p.choiceType
          ? {
              type: p.choiceType,
              stakes: { want: '', cost: '', identity: '' },
              description: '',
              optionHints: [],
            }
          : undefined,
        dramaticPurpose: localPurpose,
        setsUp: p.setsUp,
        paysOff: p.paysOff,
        // Carry authored required beats (scene-level + any encounter-level staged
        // beats) and the signature moment so SceneWriter can depict them in order.
        requiredBeats,
        treatmentAtomIds: p.treatmentAtomIds,
        ownedChronologyKeys: p.ownedChronologyKeys,
        sourceContextIds: p.sourceContextIds,
        nonCopyableContext: p.nonCopyableContext,
        signatureMoment,
        turnContract,
        coldOpenProfile: p.coldOpenProfile,
        sceneConstructionProfile: p.sceneConstructionProfile,
        sceneEventOwnership: p.sceneEventOwnership,
        narrativeEventIds: p.narrativeEventIds,
        narrativeEventOrder: p.narrativeEventOrder,
        narrativeEventPlanVersion: p.narrativeEventPlanVersion,
        assignedEventIds: p.narrativeEventIds,
        claimedEventIds: [],
        verifiedEventIds: [],
        realizedEventIds: [],
        supportingContractIds: p.sceneEventOwnership?.sourceContractIds,
        relationshipPacing: p.relationshipPacing,
        mechanicPressure: arcPressureBinding.mechanicPressure,
        authoredTreatmentFields: p.authoredTreatmentFields,
        seasonPromiseContracts: p.seasonPromiseContracts,
        stakesArchitectureContracts: p.stakesArchitectureContracts,
        storyCircleBeatContracts: p.storyCircleBeatContracts,
        arcPressureContracts: arcPressureBinding.arcPressureContracts,
        branchConsequenceContracts: p.branchConsequenceContracts,
        endingRealizationContracts: p.endingRealizationContracts,
        failureModeAuditContracts: p.failureModeAuditContracts,
        characterTreatmentContracts: p.characterTreatmentContracts,
        worldTreatmentContracts: p.worldTreatmentContracts,
        setsUpInfoIds: (p as { setsUpInfoIds?: string[] }).setsUpInfoIds,
        revealsInfoIds: (p as { revealsInfoIds?: string[] }).revealsInfoIds,
        paysOffInfoIds: (p as { paysOffInfoIds?: string[] }).paysOffInfoIds,
        themePressure: (p.authoredTreatmentFields || []).find((field) =>
          (field.contractKind === 'theme_angle' || field.contractKind === 'lie_pressure')
          && this.hasReaderSafeBlueprintText(field.sourceText)
        )?.sourceText,
        keyBeats: localKeyBeats,
        leadsTo: nextId ? [nextId] : [],
        spineUnitId: p.spineUnitId,
        encounterProfile: p.encounterProfile || p.encounter?.encounterProfile,
      };
      const recommendedBeatCount = beatBudgetByScene.get(p.id);
      if (recommendedBeatCount) {
        scene.recommendedBeatCount = recommendedBeatCount;
      }
      // ESC lockdown: plannedHasChoice must materialize a real choicePoint here —
      // never leave a flag without a point for ChoiceAuthor / playback.
      if (p.hasChoice && !isEncounter) {
        const guidance = input.seasonPlanDirectives?.treatmentGuidance;
        const pressure = this.localChoicePressures(scene)[0]
          || guidance?.majorChoicePressures?.find((candidate) => this.hasBlueprintText(candidate))
          || p.dramaticPurpose
          || localPurpose
          || `Choose how to handle ${scene.name}`;
        this.applyTreatmentChoicePressureToScene(
          scene,
          pressure,
          guidance,
          this.localChoiceResidue(scene),
        );
      }
      return scene;
    });

    // Apply encounter detail via the shared mapping used by the invented path.
    for (let i = 0; i < planned.length; i += 1) {
      if (planned[i].kind !== 'encounter') continue;
      const directive = this.plannedSceneToEncounterDirective(planned[i]);
      if (directive) this.applyPlannedEncounterToScene(scenes[i], directive);
    }

    const emptyArc: StoryCircleStructure = {
      you: '',
      need: '',
      go: '',
      search: '',
      find: '',
      take: '',
      return: '',
      change: '',
    };
    const arc = { ...emptyArc };
    const storyCircleRole = this.resolveEpisodeStoryCircleRole(input);
    const episodeCircle = this.buildEpisodeCircle(input, arc);

    const bottleneckScenes = scenes.filter((s) => s.purpose === 'bottleneck' || s.isEncounter).map((s) => s.id);

    const blueprint: EpisodeBlueprint = {
      episodeId: input.episodeNumber != null ? `episode-${input.episodeNumber}` : 'episode',
      number: input.episodeNumber,
      title: input.episodeTitle,
      synopsis: input.episodeSynopsis,
      arc,
      episodeCircle,
      storyCircleRole,
      themes: [],
      scenes,
      startingSceneId: sceneIds[0] ?? '',
      bottleneckScenes,
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
      treatmentBindingReport: binding.report,
      episodeEventPlan: input.seasonPlanDirectives?.episodeEventPlan,
    };
    this.applySceneContractsToPlannedBlueprint(blueprint, input);
    this.repairBlueprintHygieneUnsafeText(blueprint, input);
    this.repairBroadArrivalRequiredBeats(blueprint);
    this.repairPlannedSequentialReachability(blueprint);
    return blueprint;
  }

  private repairBroadArrivalRequiredBeats(blueprint: EpisodeBlueprint): void {
    const scenes = blueprint.scenes ?? [];
    for (const scene of scenes) {
      const kept: NonNullable<SceneBlueprint['requiredBeats']> = [];
      for (const beat of scene.requiredBeats ?? []) {
        // sourceTurn and mustDepict usually carry the SAME sentence — naive
        // concatenation self-doubles the text and lets cue regexes match
        // across the seam ("…vanishes. Walking home…" normalizes to
        // "walks…home"), inventing a phantom cue whose sliced beat then
        // carries the doubled text no prose can realize (bite-me 2026-07-05:
        // s1-5-rb1 grew an unfulfillable walkHome beat that blocked the run).
        const text = [...new Set([beat.sourceTurn, beat.mustDepict].map((part) => (part || '').trim()).filter(Boolean))].join(' ');
        if (/\b(?:event|cue)-[a-z-]+$/i.test(beat.id || '')) {
          kept.push(beat);
          continue;
        }
        // Premise contracts are already assigned to their canonical opening
        // scene. They are not composite event bundles: moving or cue-splitting
        // them here silently removes the contract from the SceneWriter input
        // and leaves the final treatment-fidelity gate with no repair surface.
        if (/premise:/i.test(beat.id || '')) {
          kept.push(beat);
          continue;
        }
        if (this.isAbstractStoryCirclePromiseBeat(beat, text)) {
          continue;
        }
        const beatCues = this.sortedEventCues(text);
        if (!this.isCompositeSeedBundleBeat(beat, text) && beatCues.length < 2) {
          kept.push(beat);
          continue;
        }
        for (const cue of beatCues) {
          const target = this.sceneForEventCue(scenes, cue, scene) ?? scene;
          const sliced = this.sliceForEventCue(text, cue);
          const nextBeat = {
            ...beat,
            id: `${beat.id}-event-${cue}`,
            mustDepict: sliced,
            sourceTurn: sliced,
          };
          if (target === scene) kept.push(nextBeat);
          else target.requiredBeats = [...(target.requiredBeats ?? []), nextBeat];
        }
      }
      scene.requiredBeats = kept;
      if (scene.authoredTreatmentFields?.length) {
        const remaining = [];
        for (const field of scene.authoredTreatmentFields) {
          const fieldCues = this.sortedEventCues(field.sourceText || '');
          const target = fieldCues
            .map((cue) => this.sceneForEventCue(scenes, cue, scene))
            .find((candidate): candidate is SceneBlueprint => Boolean(candidate && candidate !== scene));
          if (target) {
            target.authoredTreatmentFields = [...(target.authoredTreatmentFields ?? []), field];
          } else {
            remaining.push(field);
          }
        }
        scene.authoredTreatmentFields = remaining;
      }
      if (scene.signatureMoment) {
        const signatureCues = this.sortedEventCues(scene.signatureMoment);
        // Don't relocate a signature that already sits on a scene owning its own cue
        // (sceneForEventCue excludes `scene`, so without this it would be stolen to
        // any other scene sharing the cue).
        const sceneCues = detectPrimaryStoryEventCues(this.sceneEventText(scene));
        const sceneOwnsSignatureCue = signatureCues.some((cue) => sceneCues.has(cue));
        if (!sceneOwnsSignatureCue) {
          // Only relocate to a scene that doesn't already carry a signature — otherwise
          // the source's signature would be silently dropped on collision.
          const signatureTarget = signatureCues
            .map((cue) => this.sceneForEventCue(scenes, cue, scene))
            .find((candidate): candidate is SceneBlueprint =>
              Boolean(candidate && candidate !== scene && !candidate.signatureMoment));
          if (signatureTarget) {
            signatureTarget.signatureMoment = scene.signatureMoment;
            scene.signatureMoment = undefined;
          }
        }
      }
    }
  }

  private isAbstractStoryCirclePromiseBeat(beat: { id?: string; tier?: string }, text: string): boolean {
    return beat.tier === 'authored'
      && /\bstory-circle\b/i.test(beat.id || '')
      && /\b(?:ordinary world|opening promise|promise:|known world|baseline|new normal)\b/i.test(text)
      && this.sortedEventCues(text).length === 0;
  }

  private isCompositeSeedBundleBeat(beat: { tier?: string }, text: string): boolean {
    return beat.tier === 'seed' && (text.split(';').length >= 4 || this.sortedEventCues(text).length >= 2);
  }

  private sortedEventCues(text: string): StoryEventCue[] {
    return [...detectPrimaryStoryEventCues(text)]
      .sort((a, b) => (STORY_EVENT_CUE_ORDER[a] ?? 999) - (STORY_EVENT_CUE_ORDER[b] ?? 999));
  }

  private sceneEventText(scene: SceneBlueprint): string {
    return [
      scene.id,
      scene.name,
      scene.description,
      scene.location,
      scene.dramaticPurpose,
      scene.turnContract?.centralTurn,
      scene.turnContract?.turnEvent,
      ...(scene.keyBeats ?? []),
    ].filter(Boolean).join(' ');
  }

  private sceneForEventCue(scenes: SceneBlueprint[], cue: StoryEventCue, current: SceneBlueprint): SceneBlueprint | undefined {
    const direct = scenes.find((scene) => scene !== current && detectPrimaryStoryEventCues(this.sceneEventText(scene)).has(cue));
    if (direct) return direct;
    if (cue === 'arrival') return current;
    return undefined;
  }

  private sliceForEventCue(text: string, cue: StoryEventCue): string {
    const clauses = text
      .split(/(?:[.;]|\s+\bthen\b\s+|\s+\band\b\s+)/i)
      .map((part) => part.trim())
      .filter(Boolean);
    const clause = clauses.find((part) => detectPrimaryStoryEventCues(part).has(cue));
    return clause || text;
  }

  private repairPlannedSequentialReachability(blueprint: EpisodeBlueprint): void {
    const scenes = blueprint.scenes ?? [];
    if (scenes.length < 2) return;

    const sceneIds = new Set(scenes.map((scene) => scene.id));
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const validTargets = (scene.leadsTo ?? []).filter((target, targetIndex, targets) =>
        target &&
        target !== scene.id &&
        sceneIds.has(target) &&
        targets.indexOf(target) === targetIndex,
      );
      if (validTargets.length === 0 && index < scenes.length - 1) {
        validTargets.push(scenes[index + 1].id);
      }
      scene.leadsTo = validTargets;
    }

    const startScene = scenes.find((scene) => scene.id === blueprint.startingSceneId) ?? scenes[0];
    if (!startScene) return;

    const byId = new Map(scenes.map((scene) => [scene.id, scene]));
    const reachable = new Set<string>();
    const queue = [startScene.id];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || reachable.has(currentId)) continue;
      reachable.add(currentId);
      for (const targetId of byId.get(currentId)?.leadsTo ?? []) {
        if (!reachable.has(targetId)) queue.push(targetId);
      }
    }

    if (reachable.size === scenes.length) return;

    for (let index = 0; index < scenes.length - 1; index += 1) {
      const scene = scenes[index];
      const nextScene = scenes[index + 1];
      if (reachable.has(nextScene.id)) continue;
      if (!scene.leadsTo.includes(nextScene.id)) {
        scene.leadsTo.push(nextScene.id);
      }
      reachable.add(nextScene.id);
    }
  }

  /** Restore immutable scene chronology after architecture metadata repairs. */
  private restoreCanonicalPlannedSceneOrder(
    blueprint: EpisodeBlueprint,
    input: StoryArchitectInput,
  ): void {
    const canonicalOrder = input.seasonPlanDirectives?.episodeEventPlan?.sceneOrder;
    if (!canonicalOrder?.length || blueprint.scenes.length < 2) return;

    const eventPlan = input.seasonPlanDirectives?.episodeEventPlan;
    const graph = input.seasonPlanDirectives?.narrativeContractGraph;
    if (eventPlan && graph) {
      const eventById = new Map(graph.events.map((event) => [event.id, event]));
      const canonicalOwnerByUnit = new Map<string, string>();
      for (const assignment of eventPlan.assignments) {
        const event = eventById.get(assignment.eventId);
        for (const unitId of event?.targetSpineUnitIds ?? []) {
          const priorOwner = canonicalOwnerByUnit.get(unitId);
          if (priorOwner && priorOwner !== assignment.sceneId) continue;
          canonicalOwnerByUnit.set(unitId, assignment.sceneId);
        }
      }
      for (const scene of blueprint.scenes) {
        const unitId = scene.spineUnitId;
        const canonicalOwner = unitId ? canonicalOwnerByUnit.get(unitId) : undefined;
        if (unitId && canonicalOwner && canonicalOwner !== scene.id) {
          // The event graph may have deliberately moved this unit onto a scene
          // that already owns another compatible event. Do not let the stale
          // one-unit legacy field create a second construction owner.
          scene.spineUnitId = undefined;
        }
      }
    }

    // A canonical scene with no depiction assignment is a generic shell, even
    // if a legacy spineUnitId survived on it. Remove it before content
    // generation and route outgoing edges through the next committed scene.
    if (eventPlan) {
      const assignedSceneIds = new Set(eventPlan.assignments.map((assignment) => assignment.sceneId));
      const removable = blueprint.scenes.filter((scene) =>
        !assignedSceneIds.has(scene.id)
        && !scene.planningOrigin
        && !scene.isEncounter,
      );
      if (removable.length > 0) {
        const removedIds = new Set(removable.map((scene) => scene.id));
        const byId = new Map(blueprint.scenes.map((scene) => [scene.id, scene]));
        for (const scene of blueprint.scenes) {
          if (removedIds.has(scene.id)) continue;
          const nextTargets: string[] = [];
          for (const targetId of scene.leadsTo ?? []) {
            if (!removedIds.has(targetId)) {
              nextTargets.push(targetId);
              continue;
            }
            for (const replacement of byId.get(targetId)?.leadsTo ?? []) {
              if (!removedIds.has(replacement)) nextTargets.push(replacement);
            }
          }
          scene.leadsTo = Array.from(new Set(nextTargets));
        }
        blueprint.scenes = blueprint.scenes.filter((scene) => !removedIds.has(scene.id));
        const survivingIds = new Set(blueprint.scenes.map((scene) => scene.id));
        input.seasonPlanDirectives = {
          ...input.seasonPlanDirectives,
          episodeEventPlan: {
            ...eventPlan,
            sceneOrder: blueprint.scenes.map((scene) => scene.id),
            assignments: eventPlan.assignments.filter((assignment) => survivingIds.has(assignment.sceneId)),
            sceneContexts: eventPlan.sceneContexts.filter((context) => survivingIds.has(context.sceneId)),
          },
        };
      }
    }

    const rank = new Map(canonicalOrder.map((sceneId, index) => [sceneId, index]));
    const currentIndex = new Map(blueprint.scenes.map((scene, index) => [scene.id, index]));
    const ordered = [...blueprint.scenes].sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank != null || bRank != null) {
        return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER)
          || (currentIndex.get(a.id) ?? 0) - (currentIndex.get(b.id) ?? 0);
      }
      // Generic helper shells have no canonical event owner. Keep their
      // existing relative order after committed scenes so they cannot invert
      // explicit spine-unit ownership.
      return (currentIndex.get(a.id) ?? 0) - (currentIndex.get(b.id) ?? 0);
    });
    blueprint.scenes = ordered;
    // `restoreCanonicalPlannedSceneOrder` may replace the episode plan object
    // while collapsing an unowned shell. Rebind the blueprint projection to
    // that committed object; otherwise the runtime story can be correct while
    // the persisted episode-blueprint artifact still carries stale sceneOrder.
    blueprint.episodeEventPlan = input.seasonPlanDirectives?.episodeEventPlan;
  }

  private applySceneContractsToPlannedBlueprint(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    const episodePressure = this.pickBlueprintText(
      blueprint.dramaticAudit?.episodeQuestion,
      guidance?.dramaticQuestion,
      guidance?.forcedChoice,
      guidance?.obstacle,
      input.episodeSynopsis,
    );
    const episodeTheme = this.pickBlueprintText(
      blueprint.dramaticAudit?.themePressure,
      guidance?.themePressure,
      guidance?.liePressure,
    );

    for (let index = 0; index < (blueprint.scenes || []).length; index += 1) {
      const scene = blueprint.scenes[index];
      applySceneContract(scene, {
        episodeNumber: input.episodeNumber,
        episodeTitle: input.episodeTitle,
        episodeSynopsis: input.episodeSynopsis,
        sceneIndex: index,
        nextSceneId: scene.leadsTo?.[0],
        episodePressure,
        episodeTheme,
        role: scene.narrativeRole,
      });
      if (scene.choicePoint) {
        scene.choicePoint.stakes = {
          want: scene.choicePoint.stakes?.want || `Pursue the scene turn: ${scene.turnContract?.centralTurn || scene.name}`,
          cost: isPlaceholderStake(scene.choicePoint.stakes?.cost)
            ? `Risk losing leverage from ${scene.name}.`
            : scene.choicePoint.stakes?.cost || `Risk losing leverage from ${scene.name}.`,
          identity: isPlaceholderStake(scene.choicePoint.stakes?.identity)
            ? scene.personalStake || 'Reveal a specific self-protective or self-authored posture.'
            : scene.choicePoint.stakes?.identity || scene.personalStake || 'Reveal a specific self-protective or self-authored posture.',
        };
      }
    }
  }

  private applyCanonicalEventAcknowledgements(blueprint: EpisodeBlueprint, input: StoryArchitectInput): string[] {
    const eventPlan = input.seasonPlanDirectives?.episodeEventPlan;
    if (!eventPlan) return [];
    const assignedByScene = new Map(eventPlan.sceneContexts.map((context) => [context.sceneId, context.ownedEventIds]));
    const issues: string[] = [];
    for (const scene of blueprint.scenes ?? []) {
      const allowed = assignedByScene.get(scene.id) ?? [];
      const allowedSet = new Set(allowed);
      const requested = scene.claimedEventIds ?? scene.realizedEventIds ?? [];
      const foreign = requested.filter((eventId) => !allowedSet.has(eventId));
      if (foreign.length > 0) {
        issues.push(`Scene "${scene.id}" returned event ID(s) outside its immutable assignment: ${foreign.join(', ')}.`);
      }
      scene.assignedEventIds = [...allowed];
      scene.claimedEventIds = requested.filter((eventId) => allowedSet.has(eventId));
      scene.realizedEventIds = [...scene.claimedEventIds];
      scene.verifiedEventIds = (scene.verifiedEventIds ?? []).filter((eventId) => allowedSet.has(eventId));
      scene.narrativeEventIds = [...allowed];
      scene.narrativeEventPlanVersion = eventPlan.version;
      scene.characterPresenceContracts = (eventPlan.characterPresenceContracts ?? [])
        .filter((contract) => contract.sceneId === scene.id);
      scene.supportingContractIds = Array.from(new Set([
        ...(scene.supportingContractIds ?? []),
        ...(scene.sceneEventOwnership?.sourceContractIds ?? []),
      ]));
      const graph = input.seasonPlanDirectives?.narrativeContractGraph;
      scene.realizationTasks = (graph?.realizationTasks ?? []).filter((task) => task.sceneId === scene.id);
      scene.canonicalEvidenceRequirements = allowed.flatMap((eventId) => {
        const event = graph?.events.find((candidate) => candidate.id === eventId);
        return (event?.evidenceRequirements ?? []).map((requirement) => ({
          eventId,
          kind: requirement.kind,
          acceptedPatterns: [...requirement.acceptedPatterns],
          requiredSurface: requirement.requiredSurface,
        }));
      });
    }
    const graph = input.seasonPlanDirectives?.narrativeContractGraph;
    if (graph) {
      issues.push(...reprojectEpisodeEventPlan(graph, eventPlan, blueprint.scenes, input.episodeNumber).map((issue) => issue.message));
    }
    return issues;
  }

  /**
   * Focused LLM call: author ONE scene's central turn as a concrete, stageable
   * event. Used at two surfaces with the same contract:
   *   - architecture time (`reauthorGenericPlannerTurns`): the planner produced
   *     scaffold ("Aftermath pressure shifts visible leverage around …") — author
   *     the turn from the scene's role, neighbors, and episode context so
   *     SceneWriter has a real event to dramatize;
   *   - final-contract repair (`buildSceneTurnContractRepairHandler`): the scene's
   *     prose already exists — state the turn the prose ALREADY dramatizes,
   *     reusing its concrete nouns and verbs so the realization check clears.
   * Returns null when the model's answer is itself scaffold/question-shaped —
   * callers keep the existing turn and downstream gates stay the net.
   */
  async reauthorSceneTurn(ctx: {
    sceneId: string;
    sceneName?: string;
    role?: string;
    location?: string;
    description?: string;
    choicePoint?: string;
    requiredBeat?: string;
    episodeSynopsis?: string;
    previousTurn?: string;
    nextTurn?: string;
    /** Existing reader-facing prose (final-contract surface). When present, the turn MUST be grounded in it. */
    prose?: string;
    /** Staged plot-event types the turn must NOT introduce (they belong to other scenes in the route). */
    avoidEvents?: string[];
  }): Promise<string | null> {
    const contextLines = [
      ctx.sceneName ? `SCENE: "${ctx.sceneName}" (id ${ctx.sceneId})` : `SCENE id: ${ctx.sceneId}`,
      ctx.role ? `NARRATIVE ROLE: ${ctx.role}` : '',
      ctx.location ? `LOCATION: ${ctx.location}` : '',
      ctx.description ? `SCENE DESCRIPTION: ${ctx.description}` : '',
      ctx.requiredBeat ? `A BEAT THIS SCENE MUST DEPICT: ${ctx.requiredBeat}` : '',
      ctx.choicePoint ? `THE SCENE'S CHOICE POINT: ${ctx.choicePoint}` : '',
      ctx.previousTurn ? `PREVIOUS SCENE'S TURN: ${ctx.previousTurn}` : '',
      ctx.nextTurn ? `NEXT SCENE'S TURN: ${ctx.nextTurn}` : '',
      ctx.episodeSynopsis ? `EPISODE SYNOPSIS: ${ctx.episodeSynopsis}` : '',
      ctx.avoidEvents?.length
        ? `FORBIDDEN EVENT TYPES (these plot events are staged by OTHER scenes — your turn must not introduce or depict any of them): ${ctx.avoidEvents.join('; ')}`
        : '',
    ].filter(Boolean).join('\n');
    const proseBlock = ctx.prose
      ? `\nTHE SCENE'S PROSE (already written — your sentence must state the turn this prose ALREADY dramatizes, reusing its concrete nouns, names, and verbs; do not invent events the prose does not show):\n"""\n${ctx.prose.slice(0, 6000)}\n"""\n`
      : '';

    const prompt = `You are repairing ONE scene's dramatic turn contract in an interactive story episode. The scene's planned "central turn" is placeholder scaffold text (a role summary or a thematic question), not a stageable event.

${contextLines}
${proseBlock}
Write the scene's CENTRAL TURN: exactly ONE declarative sentence (under 35 words) describing the concrete, visible event where this scene pivots. It MUST:
- name WHO does or discovers WHAT (a specific action, reveal, choice, cost, or changed state);
- be stageable on-page — something a reader watches happen, not a theme, mood, or question;
- pivot on THIS scene's own material above — do not invent a NEW plot event (a message arriving, an attack, a rescue, an arrival, a publication) that the scene context does not already contain;
- never use planning language ("the scene establishes/escalates", "pressure", "leverage", "stakes") or restate the episode question;
- never mention stats, dice, or game mechanics.

Return ONLY a JSON object: {"centralTurn": "…"}. No prose outside the JSON.`;

    try {
      const raw = await this.callLLM([{ role: 'user', content: prompt }], 2);
      const parsed = this.parseJSON<{ centralTurn?: unknown }>(raw);
      const text = typeof parsed?.centralTurn === 'string' ? parsed.centralTurn.trim() : '';
      if (
        text.length >= 20
        && text.length <= 400
        && !isGenericScenePlannerText(text)
        && !isQuestionShapedTurnText(text)
        && !/\?\s*$/.test(text)
      ) {
        return text;
      }
      return null;
    } catch (err) {
      console.warn(`[StoryArchitect] reauthorSceneTurn(${ctx.sceneId}) failed (existing turn kept): ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Architecture-time counterpart of the final-contract turn re-author: the
   * final SceneTurnRealizationValidator blocks any planner-source turn that is
   * still `isGenericScenePlannerText` — a defect fully knowable HERE, before a
   * single line of prose is written. Historically it was only detected ~30
   * minutes later at the final contract, where the prose repair loop explicitly
   * skips it (metadata, not prose) and the run aborted (bite-me 2026-07-07
   * s1-7). Re-author each scaffold turn with one focused LLM call, then re-apply
   * scene contracts so names/ladders/before-after states rebuild around the
   * concrete event. A failed re-author keeps the scaffold — the final-contract
   * handler and gate remain the net.
   */
  private async reauthorGenericPlannerTurns(blueprint: EpisodeBlueprint, input: StoryArchitectInput): Promise<void> {
    if (!isGateEnabled('GATE_SCENE_TURN_REAUTHOR')) return;
    // ESC-backed treatment spines already own concrete turns — LLM re-author
    // is a structural drift vector and must not rewrite them.
    if (input.seasonPlanDirectives?.episodeSpine?.units?.length) {
      console.info(
        `[StoryArchitect] Skipping planner-turn re-author for episode ${input.episodeNumber}: Episode Spine Contract is present.`,
      );
      return;
    }
    const scenes = blueprint.scenes ?? [];
    const targets = scenes.filter((scene) =>
      scene.turnContract?.source === 'planner'
      && isGenericScenePlannerText(scene.turnContract.centralTurn));
    if (targets.length === 0) return;

    const concreteTurnOf = (scene: SceneBlueprint | undefined): string | undefined => {
      const turn = scene?.turnContract?.centralTurn;
      return turn && !isGenericScenePlannerText(turn) ? turn : undefined;
    };
    const declarative = (value: string | undefined): string | undefined => {
      const text = (value ?? '').trim();
      return text && !isGenericScenePlannerText(text) && !isQuestionShapedTurnText(text) ? text : undefined;
    };

    // Event-ownership guard: an authored turn must not INTRODUCE a staged
    // plot-event cue the scene does not already carry — the scene would take
    // ownership of that event and the SceneConstructionGate route-chronology
    // check hard-aborts on the conflict (bite-me 2026-07-07 second abort: the
    // re-authored s1-7 turn invented "an anonymous message arrives", which is
    // antagonistContact — owned by chronology BEFORE the earlier blog-aftermath
    // scene's event). One retry with explicit forbidden-event feedback, then
    // keep the scaffold (the prose-grounded final-contract repair is the net
    // and cannot create this conflict).
    const newlyIntroducedCues = (scene: SceneBlueprint, authored: string): StoryEventCue[] => {
      const staged = detectPrimaryStoryEventCues(this.sceneEventText(scene));
      return [...detectPrimaryStoryEventCues(authored)].filter((cue) => !staged.has(cue));
    };

    let repaired = 0;
    for (const scene of targets.slice(0, 6)) {
      const index = scenes.indexOf(scene);
      const nextScene = scene.leadsTo?.[0]
        ? scenes.find((candidate) => candidate.id === scene.leadsTo?.[0])
        : scenes[index + 1];
      console.warn(
        `[StoryArchitect] Scene "${scene.id}" carries a generic planner central turn — re-authoring at architecture time: "${scene.turnContract?.centralTurn}"`,
      );
      const reauthorContext = {
        sceneId: scene.id,
        sceneName: scene.name,
        role: scene.narrativeRole,
        location: scene.location,
        description: declarative(scene.description),
        choicePoint: declarative(scene.choicePoint?.description),
        requiredBeat: (scene.requiredBeats ?? [])
          .map((beat) => declarative(beat.mustDepict || beat.sourceTurn))
          .find(Boolean),
        episodeSynopsis: input.episodeSynopsis,
        previousTurn: concreteTurnOf(scenes[index - 1]),
        nextTurn: concreteTurnOf(nextScene),
      };
      let authored = await this.reauthorSceneTurn(reauthorContext);
      if (authored) {
        const introduced = newlyIntroducedCues(scene, authored);
        if (introduced.length > 0) {
          console.warn(
            `[StoryArchitect] Re-authored turn for "${scene.id}" introduces staged event(s) the scene must not own (${introduced.join(', ')}) — retrying with forbidden-event feedback: "${authored}"`,
          );
          authored = await this.reauthorSceneTurn({
            ...reauthorContext,
            avoidEvents: introduced.map((cue) => STORY_EVENT_CUE_DESCRIPTIONS[cue]),
          });
          if (authored && newlyIntroducedCues(scene, authored).length > 0) {
            console.warn(`[StoryArchitect] Retried turn for "${scene.id}" still introduces foreign staged events — scaffold kept: "${authored}"`);
            authored = null;
          }
        }
      }
      if (!authored) {
        console.warn(`[StoryArchitect] Turn re-author for "${scene.id}" produced no usable turn — scaffold kept (final contract remains the net).`);
        continue;
      }
      // Only the turn is authored; before/after/handoff are cleared so the
      // contract re-application below rebuilds them around the concrete event.
      scene.turnContract = {
        turnId: scene.turnContract?.turnId || `${scene.id}-turn`,
        source: 'planner',
        centralTurn: authored,
        turnEvent: authored,
        beforeState: '',
        afterState: '',
        handoff: '',
      };
      repaired += 1;
    }
    if (repaired > 0) {
      this.applySceneContractsToPlannedBlueprint(blueprint, input);
      console.info(`[StoryArchitect] Re-authored ${repaired} generic planner turn(s) at architecture time.`);
    }
  }

  private safeBlueprintSceneFallback(scene: SceneBlueprint, input: StoryArchitectInput, index: number): string {
    return pickBlueprintSafeText(
      this.firstConcreteRequiredBeat(scene.requiredBeats || []),
      scene.turnContract?.turnEvent,
      scene.turnContract?.centralTurn,
      scene.dramaticStructure?.turn,
      scene.dramaticStructure?.pressurePeak,
      scene.name,
      scene.description,
      input.episodeSynopsis,
    ) || `Episode ${input.episodeNumber ?? ''} scene ${index + 1} leaves a visible consequence.`.replace(/\s+/g, ' ').trim();
  }

  private repairBlueprintHygieneUnsafeText(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    for (let index = 0; index < (blueprint.scenes || []).length; index += 1) {
      const scene = blueprint.scenes[index];
      const sceneFallback = this.safeBlueprintSceneFallback(scene, input, index);
      const sceneRecord = scene as unknown as Record<string, unknown>;
      for (const field of BLUEPRINT_SCANNED_SCENE_FIELDS) {
        const repaired = sanitizeBlueprintText(sceneRecord[field], sceneFallback);
        if (repaired && repaired !== sceneRecord[field]) {
          sceneRecord[field] = repaired;
        }
      }

      scene.requiredBeats = (scene.requiredBeats || []).map((beat) => {
        const sourceTurn = sanitizeBlueprintText(beat.sourceTurn, beat.mustDepict, sceneFallback) || sceneFallback;
        const mustDepict = sanitizeBlueprintText(beat.mustDepict, beat.sourceTurn, sceneFallback) || sourceTurn;
        return {
          ...beat,
          sourceTurn,
          mustDepict,
        };
      });

      if (scene.choicePoint) {
        const decisionFallback = pickBlueprintSafeText(
          this.firstConcreteRequiredBeat(scene.requiredBeats || []),
          scene.turnContract?.turnEvent,
          scene.description,
          sceneFallback,
        ) || sceneFallback;
        const choiceDescription = sanitizeBlueprintText(
          scene.choicePoint.description,
          decisionFallback,
        ) || decisionFallback;
        scene.choicePoint.description = choiceDescription;
        scene.choicePoint.stakes = {
          ...scene.choicePoint.stakes,
          want: sanitizeBlueprintText(scene.choicePoint.stakes?.want, `Pursue ${decisionFallback}.`) || `Pursue ${decisionFallback}.`,
          cost: sanitizeBlueprintText(scene.choicePoint.stakes?.cost, `Risk losing leverage around ${decisionFallback}.`) || `Risk losing leverage around ${decisionFallback}.`,
          identity: sanitizeBlueprintText(scene.choicePoint.stakes?.identity, 'Reveal a self-protective or self-authored posture.') || 'Reveal a self-protective or self-authored posture.',
        };
      }

      if (scene.turnContract) {
        scene.turnContract = {
          ...scene.turnContract,
          centralTurn: sanitizeBlueprintText(scene.turnContract.centralTurn, sceneFallback) || sceneFallback,
          beforeState: sanitizeBlueprintText(scene.turnContract.beforeState, `Before the turn, ${sceneFallback}`) || `Before the turn, ${sceneFallback}`,
          turnEvent: sanitizeBlueprintText(scene.turnContract.turnEvent, sceneFallback) || sceneFallback,
          afterState: sanitizeBlueprintText(scene.turnContract.afterState, `After the turn, consequences remain around ${sceneFallback}.`) || `After the turn, consequences remain around ${sceneFallback}.`,
          handoff: sanitizeBlueprintText(scene.turnContract.handoff, `Carry the visible consequence forward from ${sceneFallback}.`) || `Carry the visible consequence forward from ${sceneFallback}.`,
        };
      }
    }
  }

  private isAuthoredLiteEscEpisode(input: StoryArchitectInput): boolean {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    return guidance?.sourceKind === 'authored_lite'
      && Boolean(input.seasonPlanDirectives?.episodeSpine?.units?.length);
  }

  private validatePreparedBlueprintForPlannedScenes(
    blueprint: EpisodeBlueprint,
    input: StoryArchitectInput,
  ): { success: true; warnings?: string[] } | {
    success: false;
    error: string;
    metadata?: { failure?: PipelineFailureMetadata };
  } {
    const warnings: string[] = [];
    const addWarnings = (items: string[]) => {
      for (const item of items) {
        const text = item.trim();
        if (text && !warnings.includes(text)) warnings.push(text);
      }
    };
    const authoredLiteEsc = this.isAuthoredLiteEscEpisode(input);

    try {
      this.validateBlueprint(blueprint, input);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const cls = StoryArchitect.classifyBlueprintFailure(errorMsg);
      // ESC lockdown: TreatmentFidelity / choice gaps are blocking for authored_lite + ESC.
      const forceHard = authoredLiteEsc && (
        errorMsg.includes('[TreatmentFidelity]')
        || errorMsg.includes('[PlannedChoiceGate]')
        || errorMsg.includes('choicePoint')
      );
      if (!cls.advisoryOnly || forceHard) {
        return { success: false, error: errorMsg };
      }
      addWarnings(errorMsg.split('\n'));
    }

    const structuralIssues = this.collectStructuralIssues(blueprint, input);
    if (structuralIssues.length > 0) {
      const message = structuralIssues.join('\n');
      const cls = StoryArchitect.classifyBlueprintFailure(message);
      if (!cls.advisoryOnly) {
        return { success: false, error: message };
      }
      addWarnings(structuralIssues);
    }

    if (authoredLiteEsc && input.seasonPlanDirectives?.episodeSpine) {
      const projectedScenes = blueprint.scenes.map((bp, index) => {
        const planned = (input.seasonPlanDirectives?.plannedScenes ?? []).find((scene) => scene.id === bp.id);
        return {
          id: bp.id,
          episodeNumber: input.episodeNumber,
          order: index,
          kind: (bp.isEncounter ? 'encounter' : 'standard') as 'standard' | 'encounter',
          title: bp.name,
          dramaticPurpose: bp.dramaticPurpose || bp.description,
          narrativeRole: bp.narrativeRole || 'development',
          locations: bp.location ? [bp.location] : [],
          npcsInvolved: bp.npcsPresent ?? [],
          setsUp: bp.setsUp ?? [],
          paysOff: bp.paysOff ?? [],
          requiredBeats: bp.requiredBeats ?? [],
          spineUnitId: bp.spineUnitId ?? planned?.spineUnitId,
          relationshipPacing: planned?.relationshipPacing,
        };
      });
      const spineResult = new EpisodeSpineContractValidator().validate({
        spine: input.seasonPlanDirectives.episodeSpine,
        scenes: projectedScenes,
        episodeEventPlan: input.seasonPlanDirectives.episodeEventPlan,
        narrativeContractGraph: input.seasonPlanDirectives.narrativeContractGraph,
      });
      if (!spineResult.valid) {
        return {
          success: false,
          error: `[EpisodeSpineContract] Authored-lite ESC drift after elaborate — architect must not change scene order/spineUnitId:\n${spineResult.issues.map((issue) => `[EpisodeSpineContract] ${issue.message}`).join('\n')}`,
          metadata: {
            failure: {
              code: 'episode_plan_invalid',
              ownerStage: 'episode_plan',
              retryClass: 'recompile_episode_plan',
              issueCodes: ['ESC_DRIFT'],
              repairTarget: 'scene-plan',
            },
          },
        };
      }
      // Extra hard-fail: projected spineUnitId order must match ESC unit order.
      const projectedUnitIds = projectedScenes
        .map((scene) => scene.spineUnitId)
        .filter((id): id is string => Boolean(id));
      const escUnitIds = input.seasonPlanDirectives.episodeSpine.units.map((unit) => unit.id);
      const projectedInEscOrder = projectedUnitIds.filter((id) => escUnitIds.includes(id));
      const expectedOrder = escUnitIds.filter((id) => projectedUnitIds.includes(id));
      if (projectedInEscOrder.join('|') !== expectedOrder.join('|')) {
        return {
          success: false,
          error:
            `[EpisodeSpineContract] Authored-lite spineUnitId order drifted after elaborate. ` +
            `expected=${expectedOrder.join(',')} actual=${projectedInEscOrder.join(',')}`,
          metadata: {
            failure: {
              code: 'episode_plan_invalid',
              ownerStage: 'episode_plan',
              retryClass: 'recompile_episode_plan',
              issueCodes: ['ESC_SPINE_ORDER_DRIFT'],
              repairTarget: 'scene-plan',
            },
          },
        };
      }
    }

    return {
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  private sanitizePlannedSceneArcPressure(
    scene: PlannedScene,
    input: StoryArchitectInput,
  ): {
    requiredBeats: RequiredBeat[];
    mechanicPressure: MechanicPressureContract[] | undefined;
    arcPressureContracts: ArcPressureTreatmentContract[] | undefined;
  } {
    const expectedLateCrisisEpisode = input.seasonPlanDirectives?.arcPressure?.lateArcCrisis?.episodeNumber;
    const arcPressureContracts = scene.arcPressureContracts ?? [];
    if (arcPressureContracts.length === 0) {
      return {
        requiredBeats: scene.requiredBeats ?? [],
        mechanicPressure: scene.mechanicPressure,
        arcPressureContracts: scene.arcPressureContracts,
      };
    }

    const removedContracts = arcPressureContracts.filter((contract) =>
      this.shouldRemovePlannedSceneArcPressure(contract, scene, input, expectedLateCrisisEpisode)
    );
    const removedIds = new Set(removedContracts.map((contract) => contract.id));
    const removedText = new Set(removedContracts.map((contract) => contract.sourceText));
    if (removedIds.size === 0) {
      return {
        requiredBeats: scene.requiredBeats ?? [],
        mechanicPressure: scene.mechanicPressure,
        arcPressureContracts: arcPressureContracts.map((contract) => contract.contractKind === 'arc_late_crisis'
          ? {
              ...contract,
              targetEpisodeNumbers: expectedLateCrisisEpisode ? [expectedLateCrisisEpisode] : contract.targetEpisodeNumbers,
              targetSceneIds: contract.targetSceneIds?.length ? contract.targetSceneIds : [scene.id],
            }
          : contract),
      };
    }

    return {
      requiredBeats: (scene.requiredBeats ?? []).filter((beat) =>
        !beat.id.includes('arc-pressure-arc-late-crisis')
        && !removedText.has(beat.sourceTurn)
        && !removedText.has(beat.mustDepict)
      ),
      mechanicPressure: scene.mechanicPressure?.filter((pressure) =>
        !removedIds.has(pressure.id)
        && !removedIds.has(pressure.mechanicRef?.flag ?? '')
        && !removedText.has(pressure.storyPressure)
      ),
      arcPressureContracts: arcPressureContracts.filter((contract) => !removedIds.has(contract.id)),
    };
  }

  private shouldRemovePlannedSceneArcPressure(
    contract: ArcPressureTreatmentContract,
    scene: PlannedScene,
    input: StoryArchitectInput,
    expectedLateCrisisEpisode?: number,
  ): boolean {
    if (!isSceneBoundArcPressureKind(contract.contractKind)) return true;
    if (!arcPressureContractTargetsEpisode(contract, input.episodeNumber)) return true;
    if (contract.targetSceneIds?.length && !contract.targetSceneIds.includes(scene.id)) return true;
    if (
      contract.contractKind === 'arc_late_crisis'
      && expectedLateCrisisEpisode
      && input.episodeNumber !== expectedLateCrisisEpisode
    ) {
      return true;
    }
    return contract.contractKind === 'arc_late_crisis'
      && this.shouldDeferLateCrisisToNextEpisode(contract, input);
  }

  private shouldDeferLateCrisisToNextEpisode(
    contract: ArcPressureTreatmentContract,
    input: StoryArchitectInput,
  ): boolean {
    const nextEpisodeText = [
      input.cliffhangerPlan?.nextEpisodePressure,
      input.seasonPlanDirectives?.treatmentGuidance?.nextEpisodePressure,
      input.seasonPlanDirectives?.treatmentGuidance?.cliffhangerQuestion,
    ].filter(Boolean).join(' ');
    if (!nextEpisodeText) return false;
    const namesNextEpisode = new RegExp(`\\bepisode\\s+${input.episodeNumber + 1}\\b`, 'i').test(nextEpisodeText)
      || /\bnext episode\b/i.test(nextEpisodeText);
    if (!namesNextEpisode) return false;
    const sourceTokens = new Set(treatmentFieldTokens(contract.sourceText));
    const nextTokens = new Set(treatmentFieldTokens(nextEpisodeText));
    let overlap = 0;
    for (const token of sourceTokens) {
      if (nextTokens.has(token)) overlap += 1;
    }
    return overlap >= 3;
  }

  private inferPlannedSceneLocationFromRequiredBeats(
    requiredBeats: Array<{ mustDepict?: string; sourceTurn?: string; tier?: string }>,
    currentLocation: string | undefined,
    additionalHints: Array<string | undefined> = [],
  ): string | undefined {
    const authoredRawText = requiredBeats
      .filter((beat) => beat.tier === 'authored' || beat.tier === 'signature')
      .map((beat) => beat.mustDepict || beat.sourceTurn || '')
      .concat(additionalHints.map((hint) => hint || ''))
      .join(' ');
    const authoredText = authoredRawText
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!authoredText.trim()) return undefined;

    if (/\b(?:blog|post|codename|public account|message pile)\b/.test(authoredText)
      && /\b(?:4\s*am|9\s*am|unable to sleep|home|counter|apartment|launches|writes?|scrolling)\b/.test(authoredText)) {
      return currentLocation;
    }
    if (/\bapartment\b|\bwalk\s*up\b/.test(authoredText)) {
      return currentLocation;
    }
    const namedLocation = this.extractNamedAuthoredLocation(authoredRawText);
    if (namedLocation) return namedLocation;
    if (/\b(?:park|gardens?)\b/.test(authoredText)) {
      return 'Park';
    }
    if (/\b(?:rooftop|roof\s*top|sunset bar)\b/.test(authoredText)) {
      return 'Rooftop Bar';
    }
    // Bookshop before club: a first-meeting bookshop scene often name-drops the
    // club it leads to ("…introduces Kylie to the secret nightlife world of
    // Valescu Club…") — the bookshop staging must win (2026-07-04 s1-2).
    if (/\b(?:bookshop|bookstore|quartz|crystal|talisman)\b/.test(authoredText)) {
      return 'Bookshop';
    }
    if (/\b(?:club|venue|key card|keycard|side entrance|private door|service entrance|vip table)\b/.test(authoredText)) {
      return 'Venue';
    }
    if (/\b(?:estate|country house|hedge maze|rose garden)\b/.test(authoredText)) {
      return 'Estate';
    }
    return undefined;
  }

  /**
   * Arbitrate between the season plan's location and the text-inferred one.
   * Planned wins when it is a real, text-corroborated location; inference wins
   * only for stale planned values (missing, raw loc-id, the episode-default
   * carry-over, or a location the scene's authored text never gestures at).
   */
  private resolvePlannedSceneLocation(opts: {
    plannedLocation: string | undefined;
    inferredLocation: string | undefined;
    currentLocation: string | undefined;
    authoredText: string;
  }): string | undefined {
    const normalize = (value: string) =>
      value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const planned = opts.plannedLocation?.trim();
    if (!planned) return opts.inferredLocation;
    if (!opts.inferredLocation) return undefined;
    if (/^loc-/i.test(planned)) return opts.inferredLocation;
    if (opts.currentLocation && normalize(planned) === normalize(opts.currentLocation)) {
      // Episode-default carry-over — the classic stale value inference repairs.
      return opts.inferredLocation;
    }
    const hay = normalize(opts.authoredText);
    const hayTokens = hay.split(' ').filter(Boolean);
    const plannedTokens = normalize(planned).split(' ').filter((token) => token.length >= 4);
    const corroborated = plannedTokens.some((token) =>
      hayTokens.some((hayToken) => hayToken.startsWith(token) || token.startsWith(hayToken)),
    );
    return corroborated ? undefined : opts.inferredLocation;
  }

  private extractNamedAuthoredLocation(text: string): string | undefined {
    const locationNoun = '(?:Apartment|Archive|Bar|Bookshop|Bookstore|Books|Club|Courtyard|Estate|Gardens?|Hotel|House|Library|Market|Office|Park|Rooftop|Station|Studio|Venue|bookshop|bookstore|bar|club|gardens?|park|venue)';
    const properChunk = "[A-ZÀ-ÖØ-ÞȘȚĂÂÎÉÈÊËÁÀÄÖÜÓÒÍÌÚÙÇ][\\p{L}0-9'’.-]*";
    const pattern = new RegExp(
      `\\b(?:at|inside|outside|into|through|to|from|of|near|within)\\s+(?:the\\s+|a\\s+|an\\s+)?(${properChunk}(?:\\s+${properChunk}){0,3}\\s+${locationNoun})\\b`,
      'u',
    );
    return text.match(pattern)?.[1]?.replace(/[.,;:!?]+$/, '').trim();
  }

  async execute(
    input: StoryArchitectInput,
    retry: number | StoryArchitectRetryState = 0,
  ): Promise<AgentResponse<EpisodeBlueprint>> {
    const maxRetries = 2;
    const maxFormatRetries = 1;
    const retryState: StoryArchitectRetryState = typeof retry === 'number'
      ? { contractAttempts: retry, formatAttempts: 0 }
      : retry;
    const retryCount = retryState.contractAttempts;
    const totalAttempts = retryState.contractAttempts + retryState.formatAttempts;

    // Scene-first (elaborate) mode: when the season plan provides this episode's
    // scenes, build the blueprint from them deterministically and route through
    // the standard repair pipeline. No LLM call. Falls through to invention when
    // no planned scenes are present (default / flag-off path).
    const plannedScenes = input.seasonPlanDirectives?.plannedScenes;
    if (plannedScenes && plannedScenes.length > 0) {
      console.info(`[StoryArchitect] Elaborate-mode: building blueprint from ${plannedScenes.length} planned scene(s)`);
      const blueprint = this.buildBlueprintFromPlannedScenes(input);
      this.repairChoiceDensity(blueprint, input);
      this.repairPlannedEncounterCoverage(blueprint, input);
      this.repairSceneGraphBranchCoverage(blueprint);
      this.hydrateIncompleteEncounterContracts(blueprint, input);
      this.repairPlannedSequentialReachability(blueprint);
      this.repairTreatmentDramaticAudit(blueprint, input);
      this.repairTreatmentMajorChoicePressure(blueprint, input);
      this.seedChoiceMenusFromTreatment(blueprint, input);
      this.materializePlannedHasChoicePoints(blueprint, input);
      this.repairTreatmentForwardPressure(blueprint, input.seasonPlanDirectives?.treatmentGuidance);
      this.repairTreatmentResidue(blueprint, input);
      this.ensureDramaticAuditMinimums(blueprint, input);
      this.repairSceneTransitions(blueprint);
      this.repairSceneTurnContracts(blueprint);
      this.applySceneContractsToPlannedBlueprint(blueprint, input);
      this.applyCanonicalEventAcknowledgements(blueprint, input);
      this.repairBlueprintHygieneUnsafeText(blueprint, input);
      // Fail-fast for the final contract's generic-planner-turn block: author a
      // concrete turn NOW (one focused LLM call per scaffold scene) instead of
      // shipping scaffold metadata that is guaranteed to fail 30 minutes later.
      await this.reauthorGenericPlannerTurns(blueprint, input);
      this.repairDramaticStructureCraft(blueprint);
      this.repairBroadArrivalRequiredBeats(blueprint);
      this.assignInfoReveals(blueprint, input);
      this.assignSceneTimeline(blueprint);
      this.ensureCharacterIntroductionBeats(blueprint, input);
      this.ensureEnsembleCastObligations(blueprint, input);
      this.repairBroadArrivalRequiredBeats(blueprint);
      this.repairPlannedSequentialReachability(blueprint);
      // Later deterministic repairs can insert or split helper scenes. Re-run
      // the existing bounded choice-density repair at the owning boundary so
      // the final architecture gate evaluates the actual blueprint shape.
      this.repairChoiceDensity(blueprint, input);
      this.restoreCanonicalPlannedSceneOrder(blueprint, input);
      this.repairSceneTransitions(blueprint);

      const missingChoicePoints = this.collectMissingPlannedChoicePoints(blueprint);
      if (missingChoicePoints.length > 0) {
        return {
          success: false,
          error:
            `[PlannedChoiceGate] Episode ${input.episodeNumber} has plannedHasChoice scene(s) without choicePoint: ` +
            `${missingChoicePoints.join(', ')}. Materialize a real choicePoint before content generation.`,
          metadata: this.failureMetadata({ code: 'episode_plan_invalid', ownerStage: 'episode_plan', retryClass: 'recompile_episode_plan', issueCodes: ['planned_choice_missing'], repairTarget: 'scene-plan' }),
        };
      }

      const sceneConstructionIssues = this.applySceneConstructionProfiles(blueprint, input);
      if (sceneConstructionIssues.length > 0 && isGateEnabled('GATE_SCENE_CONSTRUCTION_PREFLIGHT')) {
        return {
          success: false,
          error:
            `[SceneConstructionGate] Episode ${input.episodeNumber} has ${sceneConstructionIssues.length} scene construction conflict(s): ` +
            sceneConstructionIssues.slice(0, 5).join(' | ') +
            ` Rebalance the planned scene so each scene has one primary turn and compatible support obligations before content generation.`,
          metadata: this.failureMetadata(
            { code: 'scene_construction_conflict', ownerStage: 'episode_plan', retryClass: 'recompile_episode_plan', issueCodes: sceneConstructionIssues.map((_, index) => `scene_construction_${index + 1}`), repairTarget: 'scene-plan' },
            {
              gate: 'SceneConstructionGate',
              episodeNumber: input.episodeNumber,
              sceneConstructionProfiles: blueprint.scenes.map((scene) => scene.sceneConstructionProfile),
            },
          ),
        };
      }

      const unresolvedBinding = blueprint.treatmentBindingReport?.unresolved ?? [];
      if (unresolvedBinding.length > 0) {
        return {
          success: false,
          error:
            `[TreatmentBindingGate] Episode ${input.episodeNumber} has ${unresolvedBinding.length} unresolved planned-scene obligation binding(s): ` +
            unresolvedBinding.slice(0, 5).map((item) => `${item.contractId} (${item.issueKind ?? 'unresolved'}): ${item.reason}`).join(' | '),
          metadata: this.failureMetadata({ code: 'treatment_binding_conflict', ownerStage: 'episode_plan', retryClass: 'recompile_episode_plan', issueCodes: unresolvedBinding.map((item) => item.issueKind ?? 'unresolved_binding'), repairTarget: 'scene-plan' }),
        };
      }

      const densityIssues = this.collectTreatmentDensityIssues(blueprint, input);
      if (densityIssues.length > 0) {
        return {
          success: false,
          error:
            `[TreatmentDensityGate] Episode ${input.episodeNumber} planned scene plan overload: ${densityIssues.join(' | ')} ` +
            `Regenerate or rebalance the season scene plan so obligations are spread across neighboring scenes before content generation.`,
          metadata: this.failureMetadata(
            { code: 'treatment_density_conflict', ownerStage: 'episode_plan', retryClass: 'recompile_episode_plan', issueCodes: ['treatment_density_overload'], repairTarget: 'scene-plan' },
            this.buildTreatmentDensityDiagnostics(blueprint, input),
          ),
        };
      }

      // Plan-time adequacy gate. This path is deterministic (no LLM), so a
      // re-run produces the same blueprint — regeneration cannot help. If the
      // planned scene plan was too small to carry a required branch, fail fast
      // here (before the content pass) with an attributed message rather than
      // hard-aborting later at content-time branch validation. The root cause is
      // upstream in the season scene-plan allocation; the message deliberately
      // avoids the phase-loop branch-retry keywords so it isn't retried in vain.
      const elaborateAdequacy = this.ensureBlueprintBranchAdequacy(blueprint);
      if (!elaborateAdequacy.adequate) {
        return {
          success: false,
          error:
            `[BlueprintAdequacyGate] Episode ${input.episodeNumber} planned scene plan is under-sized for required branch coverage: ${elaborateAdequacy.reason}. ` +
            `Regenerate the season scene plan so this episode carries an adequately-sized, branchable blueprint before content generation.`,
          metadata: this.failureMetadata({ code: 'branch_structure_invalid', ownerStage: 'episode_plan', retryClass: 'recompile_episode_plan', issueCodes: ['blueprint_adequacy'], repairTarget: 'scene-plan' }),
        };
      }

      const plannedValidation = this.validatePreparedBlueprintForPlannedScenes(blueprint, input);
      if (plannedValidation.success === false) {
        return {
          success: false,
          error: plannedValidation.error,
          metadata: plannedValidation.metadata,
        };
      }
      const plannedHygieneIssues = this.collectBlueprintHygieneIssues(blueprint);
      if (plannedHygieneIssues.length > 0) {
        return {
          success: false,
          error: plannedHygieneIssues.join('\n'),
        };
      }

      return {
        success: true,
        data: blueprint,
        rawResponse: '',
        warnings: plannedValidation.warnings,
      };
    }

    // Treatment-sourced episodes must elaborate from planned scenes / ESC —
    // inventing a parallel scene graph is the primary structural drift vector.
    if (
      input.sourceKind === 'authored'
      || input.sourceKind === 'authored_lite'
      || input.sourceKind === 'derived_from_lite'
      || input.seasonPlanDirectives?.treatmentGuidance
      || input.seasonPlanDirectives?.episodeSpine
    ) {
      return {
        success: false,
        error:
          `Episode ${input.episodeNumber} is ${input.sourceKind || 'treatment'}-sourced but has no plannedScenes to elaborate. ` +
          'Refuse invent-mode StoryArchitect for treatment runs; rebuild the season scene plan / ESC first.',
        metadata: this.failureMetadata({
          code: 'episode_plan_invalid',
          ownerStage: 'episode_plan',
          retryClass: 'recompile_episode_plan',
          issueCodes: ['authored_invent_mode_forbidden'],
          repairTarget: 'scene-plan',
        }),
      };
    }

    const prompt = this.buildPrompt(input);

    console.log(
      `[StoryArchitect] Building episode blueprint...${totalAttempts > 0
        ? ` (contract retries ${retryState.contractAttempts}/${maxRetries}, format retries ${retryState.formatAttempts}/${maxFormatRetries})`
        : ''}`,
    );

    // Hoisted so the catch block can return a parsed-but-advisory-failing
    // blueprint instead of aborting the whole run (validator tiering, B1).
    let parsedBlueprint: EpisodeBlueprint | undefined;

    try {
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: prompt }
      ];

      if (totalAttempts > 0) {
        const structuralFeedback = this.lastStructuralFeedback.length > 0
          ? `\nSTRUCTURAL ISSUES FROM PREVIOUS ATTEMPT:\n${this.lastStructuralFeedback.map(f => `- ${f}`).join('\n')}\n`
          : '';

      messages[0].content += `\n\n⚠️ PREVIOUS ATTEMPT FAILED — FIX ALL ISSUES BELOW:${structuralFeedback}
REQUIREMENTS:
- The scenes array MUST contain 3-${input.targetSceneCount} scenes
- The first scene MUST have a choicePoint
- At least ${Math.ceil(input.targetSceneCount * 0.5)} out of up to ${input.targetSceneCount} scenes must have choicePoint
- Include choicePoint with type, stakes (want/cost/identity), and description for each choice scene
- All leadsTo references must point to valid scene IDs
- Scene graph must be fully connected from startingSceneId
- Include at least one encounter scene with encounterDescription, encounterDifficulty, encounterBuildup, encounterStakes, encounterRelevantSkills, and encounterBeatPlan`;
        this.lastStructuralFeedback = [];
      }

      const rawResponse = await this.callLLM(messages);
      const response = rawResponse;

      console.log(`[StoryArchitect] Received response (${response.length} chars)`);

      let blueprint: EpisodeBlueprint;
      try {
        blueprint = this.unwrapDynamoTypedJson(this.parseJSON<EpisodeBlueprint>(response)) as EpisodeBlueprint;
        parsedBlueprint = blueprint;
      } catch (parseError) {
        console.error(`[StoryArchitect] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        if (parseError instanceof TruncatedLLMResponseError) throw parseError;
        if (retryState.formatAttempts < maxFormatRetries) {
          this.lastStructuralFeedback = [
            'Previous response was not parseable strict JSON. Return one plain JSON object only: no markdown, no comments, no trailing commas, no DynamoDB typed wrappers like {"S":"value"} or {"L":[...]}.',
          ];
          return this.execute(input, { ...retryState, formatAttempts: retryState.formatAttempts + 1 });
        }
        throw parseError;
      }

      // Debug: Log the parsed blueprint structure
      console.log(`[StoryArchitect] Parsed blueprint keys:`, Object.keys(blueprint));
      console.log(`[StoryArchitect] blueprint.scenes type:`, typeof blueprint.scenes, Array.isArray(blueprint.scenes) ? `(array of ${blueprint.scenes.length})` : '');

      // Check for alternative scene key names the LLM might use
      const rawBlueprint = blueprint as unknown as Record<string, unknown>;
      if (!blueprint.scenes && rawBlueprint.sceneGraph) {
        console.log(`[StoryArchitect] Found scenes under 'sceneGraph' key`);
        blueprint.scenes = rawBlueprint.sceneGraph as SceneBlueprint[];
      }
      if (!blueprint.scenes && rawBlueprint.sceneList) {
        console.log(`[StoryArchitect] Found scenes under 'sceneList' key`);
        blueprint.scenes = rawBlueprint.sceneList as SceneBlueprint[];
      }
      const episodeObj = rawBlueprint.episode as Record<string, unknown> | undefined;
      if (!blueprint.scenes && episodeObj?.scenes) {
        console.log(`[StoryArchitect] Found scenes under 'episode.scenes' key`);
        blueprint.scenes = episodeObj.scenes as SceneBlueprint[];
      }

      // Normalize arrays that the LLM might return as strings or undefined
      if (!blueprint.scenes) {
        console.error(`[StoryArchitect] No scenes found! Raw blueprint (first 1000 chars):`, JSON.stringify(blueprint).substring(0, 1000));
        blueprint.scenes = [];
      } else if (!Array.isArray(blueprint.scenes)) {
        blueprint.scenes = [blueprint.scenes as unknown as SceneBlueprint];
      }

      for (let i = 0; i < blueprint.scenes.length; i++) {
        const scene = blueprint.scenes[i];

        // Normalize scalar fields that might be undefined
        if (!scene.id) {
          scene.id = `scene-${i + 1}`;
        }
        if (!scene.name) {
          scene.name = `Scene ${i + 1}`;
        }
        if (!scene.description) {
          scene.description = '';
        }
        if (!scene.location) {
          scene.location = 'location-1'; // Default to first location
        }
        if (!scene.mood) {
          scene.mood = 'neutral';
        }
        // Normalize the plan-time time-of-day to the canonical vocabulary;
        // invalid values drop to undefined and the timeline backfill re-derives.
        scene.timeOfDay = normalizeTimeOfDay(scene.timeOfDay);
        if (!scene.purpose) {
          scene.purpose = 'transition';
        }
        if (!scene.narrativeFunction) {
          scene.narrativeFunction = '';
        }

        // Normalize leadsTo
        if (!scene.leadsTo) {
          scene.leadsTo = [];
        } else if (!Array.isArray(scene.leadsTo)) {
          scene.leadsTo = [scene.leadsTo as unknown as string];
        }

        // Normalize npcsPresent
        if (!scene.npcsPresent) {
          scene.npcsPresent = [];
        } else if (!Array.isArray(scene.npcsPresent)) {
          scene.npcsPresent = [scene.npcsPresent as unknown as string];
        }

        // Normalize keyBeats
        if (!scene.keyBeats) {
          scene.keyBeats = [];
        } else if (!Array.isArray(scene.keyBeats)) {
          scene.keyBeats = [scene.keyBeats as unknown as string];
        }

        if (scene.transitionOut && !Array.isArray(scene.transitionOut)) {
          scene.transitionOut = [scene.transitionOut as unknown as SceneTransitionOut];
        }

        if (scene.residue && !Array.isArray(scene.residue)) {
          scene.residue = [scene.residue as unknown as SceneResidue];
        }

        // Normalize requires
        if (scene.requires && !Array.isArray(scene.requires)) {
          scene.requires = [scene.requires as unknown as string];
        }
        if (scene.requires) {
          scene.requires = scene.requires.filter((targetId) => targetId !== scene.id);
        }

        // Normalize choicePoint
        if (scene.choicePoint) {
          if (!scene.choicePoint.optionHints) {
            scene.choicePoint.optionHints = [];
          } else if (!Array.isArray(scene.choicePoint.optionHints)) {
            scene.choicePoint.optionHints = [scene.choicePoint.optionHints as unknown as string];
          }
          if (scene.choicePoint.expectedResidue && !Array.isArray(scene.choicePoint.expectedResidue)) {
            scene.choicePoint.expectedResidue = [scene.choicePoint.expectedResidue as unknown as string];
          }
          // Ensure stakes exists
          if (!scene.choicePoint.stakes) {
            scene.choicePoint.stakes = { want: '', cost: '', identity: '' };
          }
        }
      }

      const canonicalEventIssues = this.applyCanonicalEventAcknowledgements(blueprint, input);
      if (canonicalEventIssues.length > 0) {
        return {
          success: false,
          error: `[NarrativeContractOutputGate] ${canonicalEventIssues.join(' ')}`,
          metadata: this.failureMetadata({
            code: 'structured_output_invalid',
            ownerStage: 'episode_plan',
            retryClass: retryCount < maxRetries ? 'retry_structured_output' : 'none',
            issueCodes: ['foreign_event_id'],
            repairTarget: 'episode-blueprint',
          }),
        };
      }

      this.assignResidueObligationsToScenes(blueprint, input.seasonPlanDirectives);

      // === AUTO-REPAIR: Fix invalid leadsTo references ===
      // Build set of valid scene IDs
      const validSceneIds = new Set(blueprint.scenes.map(s => s.id));
      
      for (let i = 0; i < blueprint.scenes.length; i++) {
        const scene = blueprint.scenes[i];
        const originalLeadsTo = [...scene.leadsTo];
        
        // Filter out invalid scene references and self-routes. A scene that
        // points to itself becomes its own dependency prerequisite and blocks
        // content generation, especially in compact scene plans.
        scene.leadsTo = scene.leadsTo.filter(targetId => {
          if (targetId === scene.id) {
            console.warn(`[StoryArchitect] Removed self leadsTo reference: ${scene.id} -> ${targetId}`);
            return false;
          }
          if (validSceneIds.has(targetId)) {
            return true;
          }
          console.warn(`[StoryArchitect] Removed invalid leadsTo reference: ${scene.id} -> ${targetId}`);
          return false;
        });
        
        // If leadsTo is now empty and this isn't the last scene, add sequential link
        if (scene.leadsTo.length === 0 && i < blueprint.scenes.length - 1) {
          const nextScene = blueprint.scenes[i + 1];
          scene.leadsTo = [nextScene.id];
          console.log(`[StoryArchitect] Auto-added sequential link: ${scene.id} -> ${nextScene.id}`);
        }

        const distinctLeadsTo = new Set(scene.leadsTo);
        if (scene.choicePoint?.branches && distinctLeadsTo.size < 2) {
          scene.choicePoint.branches = false;
          console.warn(`[StoryArchitect] Removed branches=true from ${scene.id}; fewer than two distinct future scene targets remain`);
        }
        
        // Log if we made repairs
        if (originalLeadsTo.length !== scene.leadsTo.length || 
            !originalLeadsTo.every((id, idx) => scene.leadsTo[idx] === id)) {
          console.log(`[StoryArchitect] Repaired leadsTo for ${scene.id}: [${originalLeadsTo.join(', ')}] -> [${scene.leadsTo.join(', ')}]`);
        }
      }

      if (!blueprint.bottleneckScenes) {
        blueprint.bottleneckScenes = [];
      } else if (!Array.isArray(blueprint.bottleneckScenes)) {
        blueprint.bottleneckScenes = [blueprint.bottleneckScenes as unknown as string];
      }

      // Also repair bottleneckScenes to remove invalid references
      blueprint.bottleneckScenes = blueprint.bottleneckScenes.filter(id => {
        if (validSceneIds.has(id)) return true;
        console.warn(`[StoryArchitect] Removed invalid bottleneck reference: ${id}`);
        return false;
      });

      // Normalize other top-level arrays
      if (!blueprint.themes) {
        blueprint.themes = [];
      } else if (!Array.isArray(blueprint.themes)) {
        blueprint.themes = [blueprint.themes as unknown as string];
      }

      if (!blueprint.suggestedFlags) {
        blueprint.suggestedFlags = [];
      } else if (!Array.isArray(blueprint.suggestedFlags)) {
        blueprint.suggestedFlags = [blueprint.suggestedFlags as unknown as { name: string; description: string }];
      }

      if (!blueprint.suggestedScores) {
        blueprint.suggestedScores = [];
      } else if (!Array.isArray(blueprint.suggestedScores)) {
        blueprint.suggestedScores = [blueprint.suggestedScores as unknown as { name: string; description: string }];
      }

      if (!blueprint.suggestedTags) {
        blueprint.suggestedTags = [];
      } else if (!Array.isArray(blueprint.suggestedTags)) {
        blueprint.suggestedTags = [blueprint.suggestedTags as unknown as { name: string; description: string }];
      }

      if (!blueprint.narrativePromises) {
        blueprint.narrativePromises = [];
      } else if (!Array.isArray(blueprint.narrativePromises)) {
        blueprint.narrativePromises = [blueprint.narrativePromises as unknown as { description: string; setupScene: string; importance: 'minor' | 'moderate' | 'major' }];
      }

      if (blueprint.dramaticAudit) {
        if (!Array.isArray(blueprint.dramaticAudit.majorTurns)) {
          blueprint.dramaticAudit.majorTurns = blueprint.dramaticAudit.majorTurns
            ? [blueprint.dramaticAudit.majorTurns as unknown as DramaticStructureAudit['majorTurns'][number]]
            : [];
        }
        if (!Array.isArray(blueprint.dramaticAudit.informationPlan)) {
          blueprint.dramaticAudit.informationPlan = blueprint.dramaticAudit.informationPlan
            ? [blueprint.dramaticAudit.informationPlan as unknown as DramaticStructureAudit['informationPlan'][number]]
            : [];
        }
        blueprint.dramaticAudit.informationPlan = blueprint.dramaticAudit.informationPlan.map(item => ({
          ...item,
          knownBy: Array.isArray(item.knownBy)
            ? item.knownBy
            : item.knownBy
              ? [item.knownBy as unknown as InformationOwner]
              : [],
        }));
        const bPlot = blueprint.dramaticAudit.episodePressureLanes?.bPlot;
        if (bPlot) {
          bPlot.protagonistVisibleSignals = Array.isArray(bPlot.protagonistVisibleSignals)
            ? bPlot.protagonistVisibleSignals
            : bPlot.protagonistVisibleSignals
              ? [bPlot.protagonistVisibleSignals as unknown as string]
              : [];
          if (bPlot.scenesOrEpisodes && !Array.isArray(bPlot.scenesOrEpisodes)) {
            bPlot.scenesOrEpisodes = [bPlot.scenesOrEpisodes as unknown as string];
          }
        }
      }

      // Ensure startingSceneId is set - default to first scene if not provided
      if (!blueprint.startingSceneId && blueprint.scenes.length > 0) {
        blueprint.startingSceneId = blueprint.scenes[0].id;
        console.log(`[StoryArchitect] Set default startingSceneId to: ${blueprint.startingSceneId}`);
      }

      // Ensure episodeId and title have defaults
      if (!blueprint.episodeId) {
        blueprint.episodeId = 'episode-1';
      }
      if (!blueprint.title) {
        blueprint.title = 'Untitled Episode';
      }
      if (!blueprint.synopsis) {
        blueprint.synopsis = '';
      }

      // Ensure the episode arc object exists with the Story Circle shape.
      if (!blueprint.arc) {
        blueprint.arc = {
          you: '',
          need: '',
          go: '',
          search: '',
          find: '',
          take: '',
          return: '',
          change: '',
        };
      } else {
        const a: Partial<EpisodeBlueprint['arc']> = blueprint.arc as Partial<EpisodeBlueprint['arc']>;
        blueprint.arc = {
          you: a.you ?? '',
          need: a.need ?? '',
          go: a.go ?? '',
          search: a.search ?? '',
          find: a.find ?? '',
          take: a.take ?? '',
          return: a.return ?? '',
          change: a.change ?? '',
        };
      }

      if (!blueprint.storyCircleRole || blueprint.storyCircleRole.length === 0) {
        blueprint.storyCircleRole = this.resolveEpisodeStoryCircleRole(input);
      }
      blueprint.episodeCircle = this.normalizeEpisodeCircle(blueprint.episodeCircle, input, blueprint.arc);

      this.repairChoiceDensity(blueprint, input);
      this.repairPlannedEncounterCoverage(blueprint, input);
      this.repairSceneGraphBranchCoverage(blueprint);
      this.hydrateIncompleteEncounterContracts(blueprint, input);
      this.repairPlannedSequentialReachability(blueprint);
      this.repairTreatmentDramaticAudit(blueprint, input);
      this.repairTreatmentMajorChoicePressure(blueprint, input);
      this.seedChoiceMenusFromTreatment(blueprint, input);
      this.repairTreatmentForwardPressure(blueprint, input.seasonPlanDirectives?.treatmentGuidance);
      this.repairTreatmentResidue(blueprint, input);
      this.ensureDramaticAuditMinimums(blueprint, input);
      this.repairSceneTransitions(blueprint);
      this.repairSceneTurnContracts(blueprint);
      // Freeform-path parity with the planned path: repair hygiene-unsafe
      // planning text (register coercion, then safe fallback) BEFORE the
      // hygiene check throws. Observed live: three attempts in a row kept
      // "The protagonist wants …" in wantVsNeed and aborted the episode.
      this.repairBlueprintHygieneUnsafeText(blueprint, input);
      this.repairDramaticStructureCraft(blueprint);
      this.assignInfoReveals(blueprint, input);
      this.assignSceneTimeline(blueprint);
      this.ensureCharacterIntroductionBeats(blueprint, input);
      this.ensureEnsembleCastObligations(blueprint, input);
      this.repairBroadArrivalRequiredBeats(blueprint);
      this.repairPlannedSequentialReachability(blueprint);

      const sceneConstructionIssues = this.applySceneConstructionProfiles(blueprint, input);
      if (sceneConstructionIssues.length > 0 && isGateEnabled('GATE_SCENE_CONSTRUCTION_PREFLIGHT')) {
        if (retryCount < maxRetries) {
          console.log(`[StoryArchitect] Scene construction found ${sceneConstructionIssues.length} issue(s), retrying with feedback...`);
          this.lastStructuralFeedback = sceneConstructionIssues;
          return this.execute(input, { ...retryState, contractAttempts: retryState.contractAttempts + 1 });
        }
        return {
          success: false,
          error:
            `[SceneConstructionGate] Episode ${input.episodeNumber} has ${sceneConstructionIssues.length} scene construction conflict(s): ` +
            sceneConstructionIssues.slice(0, 5).join(' | ') +
            ` Rebalance the blueprint so each scene has one primary turn and compatible support obligations before content generation.`,
          metadata: this.failureMetadata(
            { code: 'scene_construction_conflict', ownerStage: 'episode_plan', retryClass: 'recompile_episode_plan', issueCodes: sceneConstructionIssues.map((_, index) => `scene_construction_${index + 1}`), repairTarget: 'episode-blueprint' },
            {
              gate: 'SceneConstructionGate',
              episodeNumber: input.episodeNumber,
              sceneConstructionProfiles: blueprint.scenes.map((scene) => scene.sceneConstructionProfile),
            },
          ),
        };
      }

      // Log choice point info BEFORE validation
      const scenesWithChoices = blueprint.scenes?.filter(s => s.choicePoint) || [];
      console.log(`[StoryArchitect] Blueprint has ${blueprint.scenes?.length || 0} scenes, ${scenesWithChoices.length} with choicePoints, ${blueprint.bottleneckScenes.length} bottlenecks, startingSceneId: ${blueprint.startingSceneId}`);
      if (scenesWithChoices.length > 0) {
        console.log(`[StoryArchitect] Scenes with choices: ${scenesWithChoices.map(s => `${s.id} (${s.choicePoint?.type})`).join(', ')}`);
      } else {
        console.warn(`[StoryArchitect] WARNING: No scenes have choicePoints!`);
      }

      // Validate the blueprint (structural graph validation)
      const structuralIssues = this.collectStructuralIssues(blueprint, input);
      if (structuralIssues.length > 0 && retryCount < maxRetries) {
        console.log(`[StoryArchitect] Structural validation found ${structuralIssues.length} issue(s), retrying with feedback...`);
        this.lastStructuralFeedback = structuralIssues;
        return this.execute(input, { ...retryState, contractAttempts: retryState.contractAttempts + 1 });
      }

      const hygieneIssues = this.collectBlueprintHygieneIssues(blueprint);
      if (hygieneIssues.length > 0) {
        throw new Error(hygieneIssues.join('\n'));
      }

      this.validateBlueprint(blueprint, input);

      // Plan-time adequacy backstop (freeform path). validateBlueprint already
      // throws on <3 scenes and repairSceneGraphBranchCoverage forces a branch
      // once there are ≥3 scenes, so this only fires if those didn't take — in
      // which case we want a regeneration, never a shipped blueprint. The
      // "must have at least" wording makes classifyBlueprintFailure treat it as a
      // hard/retryable structural error, and "scene-graph branching" lets the
      // EpisodeArchitecturePhase loop re-author too.
      const adequacy = this.ensureBlueprintBranchAdequacy(blueprint);
      if (!adequacy.adequate) {
        throw new Error(
          `Blueprint must have at least ${MIN_SCENES_PER_EPISODE} scenes with a real scene-graph branching choice point: ${adequacy.reason}.`,
        );
      }

      return {
        success: true,
        data: blueprint,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[StoryArchitect] Error:`, errorMsg);
      if (error instanceof TypeError && error.stack) {
        // Post-parse repair crashes are unlocatable from the message alone —
        // surface where in the ~20 repair helpers it died.
        console.error(`[StoryArchitect] Stack:`, error.stack.split('\n').slice(0, 6).join('\n'));
      }
      if (/residue without description/.test(errorMsg) && parsedBlueprint) {
        // Live-run diagnosis: the deterministic residue repair ran but the
        // validator still saw an empty description — dump the exact shapes.
        console.error('[StoryArchitect] residue-dump:', JSON.stringify(
          (parsedBlueprint.scenes || []).map((scene) => ({
            id: scene.id,
            dramaticQuestion: scene.dramaticQuestion,
            dramaticStructure: scene.dramaticStructure,
            residue: scene.residue,
          })),
        ).slice(0, 6000));
      }

      const cls = StoryArchitect.classifyBlueprintFailure(errorMsg);

      const retryBudgetAvailable = cls.isParseError
        ? retryState.formatAttempts < maxFormatRetries
        : retryState.contractAttempts < maxRetries;
      if (cls.retryable && retryBudgetAvailable) {
        console.log(`[StoryArchitect] Retrying due to blueprint issue: ${errorMsg.slice(0, 120)}`);
        this.lastStructuralFeedback = cls.isParseError
          ? [
              'Previous response was not parseable strict JSON. Return one plain JSON object only: no markdown, no comments, no trailing commas, no DynamoDB typed wrappers like {"S":"value"} or {"L":[...]}.',
            ]
          : [errorMsg];
        return this.execute(input, cls.isParseError
          ? { ...retryState, formatAttempts: retryState.formatAttempts + 1 }
          : { ...retryState, contractAttempts: retryState.contractAttempts + 1 });
      }

      // Validator tiering (B1): craft/fidelity advisories that persist after
      // all retries must NOT abort the whole story. If the ONLY remaining
      // issues are advisory and we have a parsed blueprint, proceed with the
      // blueprint and record the issues as warnings. Hard correctness failures
      // (structural graph, choice density, encounter planning, parse) still
      // block. See docs/PROJECT_AUDIT_2026-05-28.md (Track B1).
      if (cls.advisoryOnly && parsedBlueprint) {
        const warnings = errorMsg.split('\n').map(s => s.trim()).filter(Boolean);
        this.lastAdvisoryWarnings = warnings;
        console.warn(
          `[StoryArchitect] Advisory validation issues persist after ${maxRetries} retries; ` +
            `proceeding with the blueprint and recording ${warnings.length} warning(s) instead of aborting.`,
        );
        return {
          success: true,
          data: parsedBlueprint,
          warnings,
        };
      }

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Tracks advisory (non-fatal) validation warnings from the most recent
   * execute() that succeeded despite craft/fidelity issues (B1).
   */
  public lastAdvisoryWarnings: string[] = [];

  /**
   * Classify a blueprint-validation error message into hard vs advisory.
   *
   * - Hard correctness failures (structural graph, choice density, encounter
   *   planning, unparseable JSON) must block the run.
   * - Advisory craft/fidelity failures (TreatmentFidelity, DramaticStructure,
   *   ThemePressure, SceneTurnContract, EpisodePressure) should be retried, but
   *   after retries are exhausted they degrade to warnings rather than aborting.
   *
   * Pure function of the message text so it can be unit-tested directly.
   * See docs/PROJECT_AUDIT_2026-05-28.md (Track B1).
   */
  static classifyBlueprintFailure(errorMsg: string): {
    hasHard: boolean;
    hasAdvisory: boolean;
    advisoryOnly: boolean;
    retryable: boolean;
    isParseError: boolean;
  } {
    const advisoryTags = ['[TreatmentFidelity]', '[DramaticStructure]', '[ThemePressure]', '[SceneTurnContract]', '[EpisodePressure]'];
    // ESC lockdown: for authored_lite + ESC, TreatmentFidelity choice/turn gaps are hard.
    // Callers pass the authoredLiteEscBlocking hint via a sentinel in the message when needed.
    // Default classify still treats TreatmentFidelity as advisory unless the message
    // includes the hard gate tag from collectMissingPlannedChoicePoints / PlannedChoiceGate.

    // Classify per line. Advisory validator messages carry a `[Tag]` prefix and
    // can incidentally mention hard-error keywords (e.g. TreatmentFidelity's
    // "...into a real choicePoint"), so hard-error keyword checks must only run
    // against lines that are NOT advisory — otherwise the most common advisory
    // failure would be misread as hard and still abort the run.
    const lines = errorMsg.split('\n').map(l => l.trim()).filter(Boolean);
    const isAdvisoryLine = (l: string) => advisoryTags.some(tag => l.includes(tag));
    const hasAdvisory = lines.some(isAdvisoryLine);
    const hardText = lines.filter(l => !isAdvisoryLine(l)).join('\n');

    const isChoiceDensityError = hardText.includes('choice density') ||
                                  hardText.includes('choicePoint') ||
                                  hardText.includes('consecutive scenes without choices');
    const isEncounterPlanningError = hardText.includes('encounter scene') ||
                                     hardText.includes('planned encounter') ||
                                     hardText.includes('season plan requires') ||
                                     hardText.includes('Blueprint only defines');
    const isStructuralError = hardText.includes('non-existent scene') ||
                               hardText.includes('Bottleneck scene') ||
                               hardText.includes('Starting scene') ||
                               hardText.includes('must have at least') ||
                               hardText.includes('must have no more than') ||
                               hardText.includes('[StoryCircleGate]') ||
                               hardText.includes('EpisodeStoryCircleValidator');
    const isDuplicateEventError = hardText.includes('appears to restage the same high-pressure event');
    const isBlueprintHygieneError = hardText.includes('[BlueprintContractHygiene]');
    const isParseError = hardText.includes('Failed to parse JSON response') ||
                         hardText.includes('Expected double-quoted property name') ||
                         hardText.includes('Unexpected token');

    const hasHard = isChoiceDensityError || isEncounterPlanningError || isStructuralError || isDuplicateEventError || isBlueprintHygieneError || isParseError;

    return {
      hasHard,
      hasAdvisory,
      advisoryOnly: hasAdvisory && !hasHard,
      retryable: hasHard || hasAdvisory,
      isParseError,
    };
  }

  private unwrapDynamoTypedJson(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.unwrapDynamoTypedJson(item));
    }
    if (!value || typeof value !== 'object') return value;

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1) {
      if ('S' in record) return String(record.S ?? '');
      if ('N' in record) {
        const asNumber = Number(record.N);
        return Number.isFinite(asNumber) ? asNumber : record.N;
      }
      if ('BOOL' in record) return Boolean(record.BOOL);
      if ('NULL' in record) return null;
      if ('L' in record && Array.isArray(record.L)) {
        return record.L.map((item) => this.unwrapDynamoTypedJson(item));
      }
      if ('M' in record && record.M && typeof record.M === 'object') {
        return this.unwrapDynamoTypedJson(record.M);
      }
    }

    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(record)) {
      out[key] = this.unwrapDynamoTypedJson(inner);
    }
    return out;
  }

  private buildPrompt(input: StoryArchitectInput): string {
    const npcList = input.availableNPCs
      .map(npc => {
        const baseline = npc.initialRelationship
          ? Object.entries(npc.initialRelationship)
              .filter(([, value]) => typeof value === 'number')
              .map(([key, value]) => `${key}=${value}`)
              .join(', ')
          : '';
        return `- ${npc.name} (${npc.id}): ${npc.description || 'No additional description provided.'}${npc.relationshipContext ? ` [${npc.relationshipContext}]` : ''}${baseline ? ` [baseline relationship: ${baseline}]` : ''}`;
      })
      .join('\n');

    return `
Create an episode blueprint for the following story.

## DESIGN PROCESS — FOLLOW IN ORDER

**Before writing any scene, complete these steps mentally:**

1. **ENCOUNTER FIRST**: Identify the single most dramatically charged moment this episode can contain. This is your encounter. It goes into the blueprint as a scene with \`isEncounter: true\`. It is the episode's climax.
2. **WHAT DOES THE PLAYER NEED?** Before reaching the encounter, what must the player know, feel, and care about for the encounter's choices to hit hard? List the relationships, information, and emotional stakes the prior scenes must establish.
3. **DESIGN THE BUILDUP**: Create 2–4 scenes that escalate toward the encounter. Each one must earn its place by giving the player something they need for the encounter. Fill in \`encounterBuildup\` on every non-encounter scene.
4. **DESIGN THE AFTERMATH**: 1–2 scenes after the encounter that play out the consequences.
5. **THEN** write the full JSON blueprint.

Do NOT adapt the source material rigidly. Invent or heighten confrontations, crises, and conflicts to maximise drama. A quiet scene in the source can become an intense encounter if the themes support it.

## Story Context
- **Title**: ${input.storyTitle}
- **Genre**: ${input.genre}
- **Synopsis**: ${input.synopsis}
- **Tone**: ${input.tone}
${input.userPrompt ? `- **User Instructions/Prompt**: ${input.userPrompt}\n` : ''}

## Episode Details
- **Episode ${input.episodeNumber}**: "${input.episodeTitle}"
- **Episode Synopsis**: ${input.episodeSynopsis}
${input.previousEpisodeSummary ? `- **Previous Episode**: ${input.previousEpisodeSummary}` : ''}

## Characters
**Protagonist**: ${input.protagonistDescription}

**Available NPCs**:
${npcList}

## World Context
${input.worldContext}

**Current Location**: ${input.currentLocation}
${input.memoryContext ? `
## Pipeline Memory (Insights from Prior Generations)
${input.memoryContext}
` : ''}
## Requirements
- Scene count: exactly within the hard range of 3-${input.targetSceneCount} scenes
- Episode turns: plan 3-6 major episode turns through the scene graph, keyBeats, encounterBuildup, choicePoints, sequenceIntent, and cliffhanger planning. Do not add a separate chapter-beat schema.
- Major choice points: ${input.majorChoiceCount} significant decisions
- Use branch-and-bottleneck structure
- Every major choice needs WANT, COST, and IDENTITY stakes
- **Encounter as central conflict**: The episode's central conflict MUST manifest in an encounter scene. Buildup scenes make that encounter feel earned; aftermath scenes show what the encounter changed.
- **Encounter is the chronological climax**: Order scenes so the central encounter sits at its true story-time. Every aftermath scene (the next morning, the drive home, the afterglow, a post-event debrief) MUST come AFTER the encounter in both scene order and timeline — never before it; a later-in-time scene placed before the encounter is a continuity inversion. And do NOT dramatize the encounter's central beat (the kiss, the rescue, the confrontation) in an earlier buildup scene and then re-stage it in the encounter — buildup raises pressure toward that beat, it never pre-plays it.
- **Intensity guidance in keyBeats**: For each scene, indicate which keyBeats are the dominant peak(s) (prefix with "PEAK:") and suggest where rest/breathing beats should fall (prefix with "REST:"). The SceneWriter uses this to shape the intensity arc. Example: ["REST: the quiet village at dawn", "PEAK: confrontation erupts at the market", "the aftermath settles"]
- **Diegetic timeline**: Give every scene a "timeOfDay" (dawn|morning|midday|afternoon|dusk|evening|night) and a "timeJumpFromPrevious" describing the gap from the previous scene ("continuous", "later that night", "the next morning — the protagonist returns home"). Time must move plausibly: no noon scene directly after a midnight scene without the jump named, and a location change always needs a timeJumpFromPrevious that says how the protagonist got there.
- **Pressure, not mandatory combat**: Every scene should create story pressure, but the pressure must match the genre and moment. Use physical danger, social cost, mystery revelation, romantic vulnerability, moral compromise, environmental threat, resource loss, or identity pressure as appropriate.
- **Decisive beats**: keyBeats should include specific actions, surprising complications, character development, visible consequences, and forward pressure.
- **Turn ladder, not topic list**: Frame each scene as an active situation. keyBeats should bend or flip something: trust shifts, evidence changes hands, a secret becomes harder to deny, leverage is gained/lost, distance/closeness changes, danger/reputation/resources change, identity is expressed, or knowledge becomes actionable.
- **Sequence intent, not random panels**: Every multi-beat scene should include \`sequenceIntent\` that names the objective, visible activity, obstacle, startState, turningPoint, endState, visualThread, and optional mechanicThread. This field is optional for old content compatibility, but REQUIRED-BY-PROCESS for new generated scenes with multiple beats or storyboard panels.
- **Visible activity, not just topic**: Scene descriptions and keyBeats should name the physical carrier of the scene: object transfer, pursuit, concealment, search, ritual, repair, argument blocking, distance change, environmental pressure, or another visible action pattern. Avoid static "they discuss X" scenes unless the visible business makes the power shift readable.
- **Fiction-first mechanics**: When a key turn should matter later, route it through existing fields only: choice stakes/consequenceDomain, encounterSetupContext, encounterBuildup, flags/relationships implied by choicePoint stakes, stat checks, skill/attribute/relationship conditions, or callback residue. Do not invent a new mechanics layer.
- **Capability growth is story plus mechanics**: If the protagonist falls short, fail forward into preparation, training, mentorship, recovery, alliance, investigation, or alternate leverage. Future encounters should respect improved skills, attributes, relationships, flags, identity, prior choices, and encounter outcomes without exposing stats or grind language.
- **Rest scenes still turn**: REST beats may be quiet, but they should show settling, contrast, recovery, relationship recalibration, or the cost of the prior pressure.
- **Plans go wrong**: When characters follow a plan, include a plausible complication that forces improvisation unless the scene is deliberately a rest beat.
- **No arbitrary escalation treadmill**: Escalate the episode's overall pressure, but do not make every conversation an argument or every beat more dangerous than everything before it.

## Scene Splitting

Split episode turns into separate scenes when there is a meaningful change in location, time, character dynamics, objective, obstacle, or dramatic tension.

Do not create a new scene for tiny tonal shifts. Fold small shifts into beats. A new scene should represent a real change in situation, not just a new topic.

Each scene should have a concise mood label and keyBeats that describe major turns, not topics.
Use keyBeats to show the scene's purpose, pressure, visible action, and handoff into the next scene or encounter.

## Scene Content Purpose

Every scene must have a purpose the player can feel: emotional pressure, action pressure, character development, relationship movement, information gain, consequence, or meaningful aftermath.

Scene descriptions, keyBeats, choice stakes, encounter buildup, and handoffs should all reinforce that purpose.

Do not plan scenes as topic containers. Plan scenes as situations where something changes.

## Scene Arc

Each scene should build toward its keyMoment.

The beat sequence may include rest, contrast, reversal, dread, or aftermath, but the scene should not feel flat. The final beat should land a pointed resolution, consequence, reveal, emotional shift, choice, or handoff.

Non-finale episode endings should open authored forward pressure into the next episode. Finale/resolution endings should resolve the main conflict and show aftermath rather than forcing a fake cliffhanger.

## Conflict And Action Planning

If a scene includes conflict, fighting, weapons, pursuit, survival, or physical action, plan concrete jeopardy and consequence.

For fights or weapon use, keyBeats should include:
- specific maneuvers
- destructive impact
- wounds or visible damage
- tactical reversals
- environmental use
- what winning or losing costs

For non-physical conflict, damage may be emotional, social, relational, resource, reputation, information, or identity damage.

${CRAFT_PRESSURE_GUIDANCE}

${CORE_DRAMATIC_STRUCTURE_RULES}

## P1-P8 Blueprint Audit Requirements

Populate \`dramaticAudit\` at the episode level and \`dramaticStructure\`,
\`personalStake\`, \`stakesLayers\`, \`transitionOut\`, and \`residue\` on every scene.

- \`dramaticAudit.episodeQuestion\`: the episode-level dramatic question.
- \`dramaticAudit.episodeQuestionSetup\`: how the opening scene or opening beat poses/promises the episode question.
- \`dramaticAudit.episodeQuestionAnswer\`: how the climax, encounter, major choice, or final turn answers, complicates, or reframes the question.
- \`dramaticAudit.themeQuestion\`: the working season theme as a question, not a noun. Convert broad themes like "family" or "power" into a playable question.
- \`dramaticAudit.themePressure\`: how this episode tests the season theme as plot pressure.
- \`dramaticAudit.themeAngle\`: the specific angle this episode takes on the theme question. Avoid repeating the same angle as nearby episodes unless it escalates or reverses it.
- \`dramaticAudit.themeChoicePressure\`: how protagonist/player choices can answer, complicate, refuse, or distort the theme question.
- \`dramaticAudit.themeArgumentRole\`: one of establish, counter, complicate, invert, crisis, answer, aftermath.
- \`dramaticAudit.controllingIdeaPressure\`: what in this episode makes the controlling idea more plausible or costly.
- \`dramaticAudit.counterIdeaPressure\`: what in this episode makes the counter-idea persuasive.
- \`dramaticAudit.valueLadderPressure\`: which value rung is tested and how it appears through action, relationship behavior, visual motif, or consequence.
- \`dramaticAudit.openingPromise\`: hook, episodePromise, activePressure, and optionalStakes.
- \`dramaticAudit.episodePressureLanes\`: A/B/C pressure architecture. A-plot is required external pressure; B-plot is protagonist-facing relationship/identity pressure; C-plot is a future seed.
- \`dramaticAudit.episodeEndStateDelta\`: what is different by episode end: identity, relationship, leverage, knowledge, danger, reputation, access, resource, future option, or emotional footing.
- \`dramaticAudit.nextEpisodePressure\`: non-finale forward pressure grown from consequence, choice residue, reveal, relationship rupture, new danger, promise, C-plot seed, or unresolved cost.
- \`dramaticAudit.personalStake\`: the concrete personal stake under the episode plot.
- \`dramaticAudit.stakesLayers\`: the episode stakes taxonomy. Fill material, relational, identity, and/or existential as applicable.
- \`dramaticAudit.majorTurns\`: 3-7 major episode turns; at least 60% should be driven or reshaped by protagonist/player action. Each turn should include turnType and should close, open, or memorably land pressure.
- \`dramaticAudit.informationPlan\`: major clues, secrets, threats, or open questions, who knows them, when the player learns them, and how they pay off.
- \`scene.dramaticStructure\`: question, turn, pressurePeak, changedState.
- Scene Turn Contract: every scene must show entry intent, active obstacle, forced decision, and exit shift through existing fields.
  - Entry intent: use \`dramaticQuestion\`, \`wantVsNeed\`, choice stakes, or \`sequenceIntent.objective\`.
  - Active obstacle: use \`conflictEngine\` or \`sequenceIntent.obstacle\`.
  - Forced decision: use a \`choicePoint\`, or make \`keyBeats\` / \`pressurePeak\` force commitment, refusal, revelation, sacrifice, tradeoff, or irreversible reaction.
  - Exit shift: use \`dramaticStructure.changedState\`, \`sequenceIntent.endState\`, \`residue\`, or \`transitionOut.pressureChange\`.
- Multi-character scenes must shift power at least once: leverage, trust, vulnerability, intimacy, distance, status, information, threat, debt, or public/private advantage changes hands.
- Removability test: every scene must change at least one narrative consequence category: information, relationship, identity, resource/access, danger, promise/setup/payoff, choice consequence, theme pressure, stakes, route state, or emotional footing.
- \`scene.personalStake\`: the concrete personal cost or value at risk in this scene.
- \`scene.themePressure\`: how this scene presses, complicates, sets up, or pays off the theme question. Rest/aftermath scenes may express this through consequence or residue.
- \`scene.stakesLayers\`: the scene stakes taxonomy. Major scenes and encounters need at least three layers.
- \`choicePoint.themeAnswer\`: how this choice lets the protagonist/player answer, complicate, refuse, or distort the theme question.
- \`choicePoint.stakesLayers\`: the stakes taxonomy behind the playable Stakes Triangle.
- \`scene.transitionOut\`: one entry for every \`leadsTo\` target. Use connector "therefore" or "but"; never use simple chronology.
- \`scene.residue\`: what remains changed after the scene. Reconverged paths must preserve residue.

Stakes layers and the Stakes Triangle work together:
- Stakes layers answer: what kind of loss is on the table?
- The Stakes Triangle answers: what does the player want, what does it cost, and what identity does it express?
- Existential stakes must be personally grounded. Do not write only "the world is at risk"; name the person, home, future, freedom, identity, or irreversible loss that makes it felt.
- Major scenes, encounters, dilemmas, and climaxes must stack at least three stakes layers.
- Stakes must escalate gradually. Establish what the protagonist personally stands to lose before expanding to existential or world-scale stakes.
- Key beats should form a stakes ladder: each beat raises risk, reveals cost, narrows options, shifts leverage, or deepens consequence until the pressurePeak. Rest beats can raise dread, clarity, regret, or emotional cost.

Theme pressure rules:
- Use a question, not a noun: "What do you owe family when loyalty costs your selfhood?", not "family".
- Theme must be answerable by protagonist/player choices. Different branches may answer the same question differently; do not force one moral answer.
- Do not resolve the theme through external events alone.
- Do not state the theme question directly in dialogue. Characters can argue values, defend decisions, lie, plead, confess, or threaten, but they should not announce the thesis.

Scene Turn Contract:
- Every scene enters with intent, meets an obstacle, forces a decision, and exits on changed footing.
- "Decision" does not always mean visible player choice. In bottleneck, rest, or aftermath scenes it can be a commitment, refusal, revelation, sacrifice, tradeoff, or irreversible reaction.
- In multi-character scenes, make the power dynamic shift at least once. This may be dominance, leverage, trust, vulnerability, intimacy, distance, information, status, threat, debt, or public/private advantage.
- Every scene must pass the removability test: if removing it changes no later knowledge, relationship, consequence, choice pressure, state, setup/payoff, theme pressure, stakes, route state, or emotional footing, rewrite it.

Episode Pressure Architecture:
- Use Story Circle fractally at the episode level: the blueprint must include a complete \`episodeCircle\` with all eight beats, while the scenes/keyBeats dramatize those beats without exposing labels to the player. Do not force 4-5 literal acts.
- The opening promise should hook the player, state the episode's playable promise, and put active pressure onscreen.
- A-plot is required: the external episode pressure that intersects the climax/encounter/major choice.
- B-plot is playable relationship or identity pressure. It can be a dedicated scene, an underlay inside A-plot scenes, or offscreen NPC motivation that surfaces through protagonist-visible signals. B-plot scenes must still include the protagonist.
- C-plot is a future-pressure seed, not a required scene lane: callback, world-pressure hint, tonal counterweight, object/motif setup, or future reveal. Give it a visible plant and payoff plan; do not bloat the episode with filler.
- The protagonist remains the viewpoint. Do not create non-protagonist POV scenes or omniscient cutaways.

## Genre-Aware Jeopardy Policy
${buildGenreAwareJeopardyGuidance(input.genre)}

Apply the craft guidance through existing fields only: \`keyBeats\`, \`dramaticQuestion\`, \`conflictEngine\`,
\`sequenceIntent\`, \`encounterBeatPlan\`, \`encounterBuildup\`, \`encounterSetupContext\`, choice stakes, consequence domains, and cliffhanger planning. Do not invent
a new chapter-beat layer.
${STORY_ARCHITECT_BLUEPRINT_EXAMPLE}
${this.buildSeasonPlanDirectivesSection(input)}
${this.buildStructuralContextSection(input)}
${this.buildCliffhangerPlanSection(input)}

## Required JSON Structure

{
  "episodeId": "episode-1",
  "title": "Episode Title",
  "synopsis": "Brief episode summary",
  "dramaticAudit": {
    "episodeQuestion": "The episode-level dramatic question the player wants answered",
    "episodeQuestionSetup": "How the opening scene or opening scene poses/promises the episode question",
    "episodeQuestionAnswer": "How the climax, encounter, major choice, or final turn answers, complicates, or reframes the question",
    "themeQuestion": "The season theme as a playable question, not a noun",
    "themePressure": "How the episode tests the season theme through conflict, cost, choice, information, relationship, or identity",
    "themeAngle": "The distinct angle this episode takes on the theme question",
    "themeChoicePressure": "How protagonist/player choices answer, complicate, refuse, or distort the theme question",
    "themeArgumentRole": "establish|counter|complicate|invert|crisis|answer|aftermath",
    "controllingIdeaPressure": "What makes the controlling idea more plausible or costly here",
    "counterIdeaPressure": "What makes the counter-idea genuinely persuasive here",
    "valueLadderPressure": "Which value rung is tested and how it becomes visible",
    "openingPromise": {
      "hook": "Immediate hook for the first scene or opening scene",
      "episodePromise": "The kind of pressure/play this episode promises",
      "activePressure": "The pressure already active at the start",
      "optionalStakes": "Optional personal stakes established in the opening"
    },
    "episodePressureLanes": {
      "aPlot": {
        "externalPressure": "The objective, threat, mystery, mission, survival problem, or main encounter pressure",
        "climaxIntersection": "How the A-plot intersects the climax, encounter, or major choice"
      },
      "bPlot": {
        "mode": "scene|underlay|offscreen_pressure",
        "relationshipOrIdentityPressure": "The protagonist-facing relationship or identity pressure",
        "offscreenNpcMotivation": "Optional NPC motive/secret/fear happening offscreen",
        "protagonistVisibleSignals": ["What the protagonist can notice: behavior, clue, withholding, changed trust, rumor, delayed reveal"],
        "scenesOrEpisodes": ["scene-1"],
        "climaxIntersection": "How B pressure intersects or resonates with the A-plot at climax/major choice"
      },
      "cPlot": {
        "function": "future_seed|callback|world_pressure|tonal_counterweight",
        "seed": "The planted future pressure",
        "visiblePlant": "What the protagonist/player sees now",
        "payoffPlan": "How this can pay off later",
        "targetPayoff": "later_scene|later_episode|later_arc|season"
      }
    },
    "episodeEndStateDelta": "What is different by episode end",
    "nextEpisodePressure": "Forward pressure for non-finale episodes, or aftermath/legacy/future cost for finales",
    "personalStake": "The concrete personal stake underneath the plot stake",
    "stakesLayers": {
      "material": "What can be lost, gained, broken, spent, stolen, or blocked",
      "relational": "Who trusts, loves, fears, depends on, or rejects whom",
      "identity": "Who the protagonist becomes by acting this way",
      "existential": "What survival, freedom, future, home, meaning, or irreversible fate is threatened"
    },
    "majorTurns": [
      {
        "id": "turn-1",
        "description": "A major episode turn",
        "turnType": "reversal|revelation|escalation|choice|cost|payoff",
        "driver": "protagonist",
        "protagonistInfluence": "How the protagonist/player causes or meaningfully reshapes this turn",
        "closesQuestion": "What pressure/question this turn closes or alters",
        "opensQuestion": "What bigger/sharper pressure this turn opens",
        "memorableImageOrLine": "Memorable line, image, reveal, cost, or emotional beat"
      }
    ],
    "informationPlan": [
      {
        "item": "Major clue, secret, threat, or open question",
        "knownBy": ["player", "protagonist"],
        "revealTiming": "When the player/protagonist learns it",
        "payoff": "How this information changes a later choice, reveal, or consequence"
      }
    ]
  },
  "episodeCircle": {
    "you": "Episode-specific realization of \`you\`; must satisfy the full \`you\` definition in the structural context above",
    "need": "Episode-specific realization of \`need\`; must satisfy the full \`need\` definition in the structural context above",
    "go": "Episode-specific realization of \`go\`; must satisfy the full \`go\` definition in the structural context above",
    "search": "Episode-specific realization of \`search\`; must satisfy the full \`search\` definition in the structural context above",
    "find": "Episode-specific realization of \`find\`; must satisfy the full \`find\` definition in the structural context above",
    "take": "Episode-specific realization of \`take\`; must satisfy the full \`take\` definition in the structural context above",
    "return": "Episode-specific realization of \`return\`; must satisfy the full \`return\` definition in the structural context above",
    "change": "Episode-specific realization of \`change\`; must satisfy the full \`change\` definition in the structural context above"
  },
  "storyCircleRole": [
    { "beat": "you|need|go|search|find|take|return|change", "roleKind": "primary|expansion", "source": "llm" }
  ],
  "arc": {
    "you": "Episode-specific ordinary world/status quo pressure",
    "need": "Episode-specific missing need beneath the want",
    "go": "Episode-specific threshold crossing into the episode problem",
    "search": "Episode-specific tests, attempts, and complications",
    "find": "Episode-specific discovery, gain, or apparent answer",
    "take": "Episode-specific cost, loss, or price of the find",
    "return": "Episode-specific return to the original pressure field",
    "change": "Episode-specific changed state after the episode loop"
  },
  "themes": ["theme1", "theme2"],
  "scenes": [
    {
      "id": "scene-1",
      "name": "Scene Name (Buildup)",
      "description": "What happens in this scene",
      "location": "location-1",
      "timeOfDay": "evening",
      "timeJumpFromPrevious": "continuous",
      "mood": "tense/calm/mysterious/etc",
      "purpose": "bottleneck",
      "npcsPresent": ["npc-id"],
      "narrativeFunction": "What this scene accomplishes",
      "dramaticQuestion": "What this scene is here to find out",
      "wantVsNeed": "What you consciously want vs what you actually need this scene (second person — never 'the protagonist')",
      "conflictEngine": "What or who opposes the protagonist here",
      "dramaticStructure": {
        "question": "Scene-level question or pressure",
        "turn": "The reversal, discovery, cost, or recontextualization",
        "pressurePeak": "The highest-cost or lowest-point beat",
        "changedState": "What is different by the end"
      },
      "personalStake": "Specific person, bond, promise, identity, reputation, home, future, or irreversible cost at risk",
      "themePressure": "How this scene presses, complicates, sets up, or pays off the theme question",
      "stakesLayers": {
        "material": "What concrete resource, access, object, safety, or position can change",
        "relational": "Which bond, trust, dependency, loyalty, or rejection is at risk",
        "identity": "Who the protagonist becomes if they act or fail here"
      },
      "sequenceIntent": {
        "objective": "What this visual sequence is trying to accomplish",
        "activity": "The concrete visible activity carrying it",
        "obstacle": "What resists or complicates the objective",
        "startState": "Visible/emotional/mechanical state at the start",
        "turningPoint": "The moment the sequence bends",
        "endState": "What has changed by the end",
        "visualThread": "Recurring prop, distance, blocking, wound, clue, gesture, or motif",
        "mechanicThread": "Optional fiction-first hook such as trust, leverage, clue, danger, resource, identity, callback, or encounter clock"
      },
      "keyBeats": ["beat 1", "beat 2"],
      "leadsTo": ["scene-2"],
      "transitionOut": [
        {
          "toSceneId": "scene-2",
          "connector": "therefore",
          "causalLink": "Why scene-2 happens because of or in reaction to this scene",
          "pressureChange": "What pressure changes across the transition"
        }
      ],
      "residue": [
        {
          "type": "information",
          "description": "What remains changed after this scene"
        }
      ],
      "encounterBuildup": "Establishes the antagonist's power and the protagonist's vulnerability — makes the encounter's stakes personal",
      "choicePoint": {
        "type": "dilemma",
        "stakes": {"want": "goal", "cost": "sacrifice", "identity": "what it reveals"},
        "stakesLayers": {
          "relational": "The ally may stop trusting the protagonist",
          "identity": "The protagonist chooses what kind of person they are becoming"
        },
        "description": "The choice",
        "themeAnswer": "How the protagonist/player choice answers, complicates, refuses, or distorts the theme question",
        "optionHints": ["option 1", "option 2"],
        "consequenceDomain": "relationship",
        "reminderPlan": {
          "immediate": "The ally reacts with visible hurt",
          "shortTerm": "The next shared scene is colder",
          "later": "This choice is named during the encounter"
        },
        "expectedResidue": ["ally trust drops", "tone turns colder"],
        "competenceArc": {
          "testsNow": "Whether the player can keep the ally on-side under pressure",
          "shortfall": "They lack social leverage if trust is already weak",
          "growthPath": "A later prep scene could rebuild trust before the confrontation"
        },
        "failureBranchPurpose": "alliance"
      }
    },
    {
      "id": "scene-2",
      "name": "The Confrontation (ENCOUNTER — Episode Climax)",
      "description": "The protagonist faces the episode's central conflict head-on",
      "location": "location-2",
      "timeOfDay": "night",
      "timeJumpFromPrevious": "later that night — the protagonist crosses the city to the confrontation",
      "mood": "urgent",
      "purpose": "bottleneck",
      "npcsPresent": ["antagonist-id"],
      "narrativeFunction": "The climactic encounter the whole episode has been building to",
      "keyBeats": ["confrontation begins", "escalating pressure", "critical decision moment"],
      "leadsTo": ["scene-3"],
      "isEncounter": true,
      "plannedEncounterId": "enc-1-1",
      "encounterType": "social",
      "encounterStoryCircleTarget": "take",
      "encounterStoryCircleTargetRationale": "The encounter demands a public cost for using the proof; success still wounds trust and identity.",
      "encounterDescription": "Protagonist must stand their ground against the antagonist's accusations/force using the relationships and information built in earlier scenes",
      "encounterStakes": "If the protagonist fails here, they lose both public credibility and a relationship they have been trying to preserve",
      "themePressure": "The confrontation forces the player to decide what truth costs when loyalty is public",
      "dramaticStructure": {
        "question": "Can the protagonist use the proof without losing the ally?",
        "turn": "The antagonist makes the accusation personal.",
        "pressurePeak": "The protagonist must spend trust to land truth.",
        "changedState": "The court knows the truth and the ally sees the cost."
      },
      "personalStake": "The protagonist may lose both public credibility and the ally's trust",
      "stakesLayers": {
        "material": "The court record and access can change",
        "relational": "The ally may stop trusting the protagonist",
        "identity": "The protagonist becomes someone willing to pay for truth"
      },
      "encounterRequiredNpcIds": ["antagonist-id", "ally-id"],
      "encounterRelevantSkills": ["persuasion", "empathy", "resolve"],
      "encounterBeatPlan": [
        "Opening accusation puts the protagonist on the back foot",
        "New evidence or emotional leverage escalates the confrontation",
        "A final all-in choice decides who gives ground and what it costs"
      ],
      "encounterDifficulty": "hard",
      "encounterBuildup": "Scene 1 established the antagonist's leverage and the protagonist's personal stake — players enter this encounter knowing exactly what they stand to lose",
      "encounterSetupContext": [
        "flag:defended_protagonist — unlocks a bold defiance choice inside the encounter",
        "relationship:antagonist-id.trust < -20 — antagonist's opening attack is more vicious",
        "relationship:ally-id.affection > 30 — ally speaks up at a critical moment"
      ]
    },
    {
      "id": "scene-3",
      "name": "Aftermath",
      "description": "Consequences of the encounter play out",
      "location": "location-1",
      "mood": "somber/triumphant/mixed",
      "purpose": "bottleneck",
      "npcsPresent": ["npc-id"],
      "narrativeFunction": "Resolution and setup for next episode",
      "dramaticStructure": {
        "question": "What remains after the confrontation?",
        "turn": "The saved proof leaves a new relational debt.",
        "pressurePeak": "The ally names the cost without forgiving it yet.",
        "changedState": "The protagonist carries truth forward with damaged trust."
      },
      "personalStake": "The protagonist's future with the ally remains uncertain",
      "themePressure": "The aftermath shows the cost of choosing truth over comfort",
      "stakesLayers": {
        "material": "The case outcome changes what resources remain available",
        "relational": "The ally's trust remains wounded",
        "identity": "The protagonist must live with the kind of truth-teller they became"
      },
      "keyBeats": ["immediate consequence", "new reality", "what's changed"],
      "leadsTo": []
    }
  ],
  "startingSceneId": "scene-1",
  "bottleneckScenes": ["scene-1", "scene-3"],
  "suggestedFlags": [{"name": "flag_name", "description": "what it tracks"}],
  "suggestedScores": [{"name": "score_name", "description": "what it measures"}],
  "suggestedTags": [{"name": "tag_name", "description": "identity marker"}],
  "narrativePromises": [{"description": "setup", "setupScene": "scene-1", "importance": "major"}]
}

CRITICAL REQUIREMENTS:
0. Write every scene planning field (description, wantVsNeed, dramaticQuestion, conflictEngine, themePressure) in second person ("you") — never "the protagonist", "the hero", or the character's name as a synopsis subject.
1. The "scenes" array must contain 3-${input.targetSceneCount} scenes
2. Each scene MUST have: id, name, description, location, mood, purpose, npcsPresent, narrativeFunction, keyBeats, leadsTo
2a. Each newly generated multi-beat scene SHOULD include sequenceIntent with a visible activity, visualThread, turningPoint, and endState. Missing sequenceIntent is tolerated for compatibility/fallbacks, but lowers storyboard QA quality.
3. purpose MUST be one of: "bottleneck", "branch", "transition"
4. startingSceneId MUST match one of the scene ids
5. Return ONLY valid JSON, no markdown, no extra text
5a. Include \`dramaticAudit\` with episodeQuestion, episodeQuestionSetup, episodeQuestionAnswer, openingPromise, episodePressureLanes, episodeEndStateDelta, nextEpisodePressure, themeQuestion, themePressure, themeAngle, themeChoicePressure, personalStake, stakesLayers, majorTurns, and informationPlan.
5b. Every scene must include \`dramaticStructure\`, \`personalStake\`, \`themePressure\`, \`stakesLayers\`, \`transitionOut\`, and \`residue\`.
5c. Every \`leadsTo\` target must have a matching \`transitionOut.toSceneId\` whose connector is "therefore" or "but".
5d. Major scenes, encounters, dilemmas, and climaxes must include at least three stakes layers. Dilemmas and climaxes must include relational or identity stakes. Existential stakes must be personally grounded and earned.
5e. Major choicePoints must include \`themeAnswer\`; the theme must be answerable by protagonist/player choice, not by external rescue or coincidence.
5f. Every scene must satisfy the Scene Turn Contract through existing fields: entry intent, active obstacle, forced decision, and exit shift. Multi-character scenes must shift power at least once, and every scene must pass the removability test.
5g. Episode pressure lanes must be protagonist-facing. B-plots may be scenes only when the protagonist directly experiences the relationship/identity pressure. C-plots are future seeds with visible plants and payoff plans, not filler scenes.

CHOICE PAYOFF REQUIREMENTS:
- For every scene that can be reached by a player choice (i.e., it appears in another scene's leadsTo because of a choicePoint), include "incomingChoiceContext" — a string describing what player choice leads to this scene and what it means dramatically.
- Example: "Player chose to defy the authority figure, asserting independence at the cost of safety"
- This context ensures the scene writer and route-bridge system can pay off the choice in text AND visuals.
- Bottleneck and transition scenes still need incomingChoiceContext when a choice can route into them.
- Starting scenes do NOT need incomingChoiceContext.

ENCOUNTER REQUIREMENTS:
- At least ${this.getMinEncountersForBlueprint(input.targetSceneCount, input)} scene(s) MUST be an encounter (isEncounter: true)
- The encounter MUST manifest the episode's central conflict / pressure event. It is where the episode's relationships, information, risks, prior choices, player capabilities, and current stakes are tested through play.
- Encounter scenes MUST have: isEncounter, plannedEncounterId (when pre-planned encounters exist), encounterType, encounterStoryCircleTarget, encounterDescription, encounterStakes, encounterRequiredNpcIds, encounterRelevantSkills, encounterBeatPlan, encounterDifficulty, encounterBuildup
- encounterType MUST be one of: "combat", "chase", "stealth", "social", "romantic", "dramatic", "puzzle", "exploration", "investigation", "negotiation", "survival", "heist", "mixed"
- encounterStoryCircleTarget MUST be one of: "go", "search", "find", "take". Preserve the season plan target exactly; \`go\` forces threshold commitment, \`search\` tests adaptation, \`find\` grants the wanted thing or answer while exposing the next problem, and \`take\` demands payment/cost.
- encounterStyle MUST reflect the dramatic mode of the encounter even when the structural type is broad
- encounterDifficulty MUST be one of: "easy", "moderate", "hard", "extreme"
- encounterStakes must describe the PERSONAL stakes, not just tactical stakes
- encounterRequiredNpcIds must include every character who the encounter actually tests against
- encounterRelevantSkills must contain 2-5 skills or approaches the EncounterArchitect can build choices around
- encounterBeatPlan must contain at least 3 ordered beat intents that describe the encounter arc
- encounterBuildup on the encounter scene: describe the FULL STAKES and what the prior scenes establish to make this encounter land
- encounterBuildup on NON-encounter scenes: describe what THIS scene specifically contributes to making the encounter's choices feel earned
- encounterSetupContext on the encounter scene: list every flag and relationship threshold from prior scenes that should echo inside the encounter (format: "flag:<name> — <effect>" or "relationship:<id>.<dim> <op> <n> — <effect>")
- Encounter scenes should be bottlenecks and should NOT have a regular choicePoint (they have skill-based choices instead)
- The encounter should be the episode's dramatic climax — roughly scene 3 of 5, or scene 4 of 6

CLIFFHANGER REQUIREMENTS:
- The final scene should usually be an aftermath / consequence scene, not the encounter itself.
- The final scene must acknowledge what happened in the episode's central conflict before opening the next pressure.
- If a Cliffhanger Plan is supplied, the final scene's narrativeFunction and keyBeats MUST explicitly support it.
- For high-intensity cliffhangers, make the final keyBeat a concrete shock, emotional rupture, betrayal, reframe, arrival, loss, or decision — not vague unease.
- Do not fake unresolved tension by simply stopping mid-action; make the hook earned by prior setup.

CHOICE DENSITY REQUIREMENTS (CRITICAL - Interactive fiction requires player choices):
6. At least 40% of scenes MUST have a choicePoint defined (branching, dilemma, or flavor)
7. For Episode 1, the FIRST scene MUST have a choicePoint. For later episodes, players need agency early: either the first scene has a choicePoint, OR the first scene is very brief (< 200 words) and the SECOND scene has one
8. NEVER have more than 2 scenes in a row without a choicePoint
9. Every choicePoint must have type, stakes, and description
10. Major branching/dilemma choices MUST have complete stakes (want, cost, identity)
11. BOTTLENECK scenes CAN have flavor choices - players still get agency in HOW they react even if the story beat is fixed
12. Major choicePoints should include consequenceDomain and reminderPlan so later agents know how to preserve residue
13. Use competenceArc and failureBranchPurpose when a future confrontation should open recovery, training, leverage, alliance, investigation, or regrouping paths
14. At least ${this.sceneGraphBranching?.minPerEpisode ?? 1} non-expression choicePoint MUST set branches=true and offer at least two distinct leadsTo targets, unless the user's prompt explicitly asks for a linear episode.

SCENE LINKING & CONTINUITY (CRITICAL):
12. Every scene (except the final scene) MUST have at least one valid ID in the "leadsTo" array.
13. Scene IDs in "leadsTo" MUST exist in your "scenes" array.
14. Ensure the logical flow makes sense - don't just link sequentially if the narrative suggests a different path.
15. NO DEAD ENDS: Every possible path through the episode must reach either a resolution scene or lead to "episode-end".
16. ENCOUNTERS: Encounters are bottlenecks. They should always lead to a resolution or transition scene after they are completed.
17. Naming: Use consistent IDs like scene-1, scene-2, scene-3a, scene-3b, etc.

If you don't include enough choice points, the story will be rejected as non-interactive.
`;
  }

  private buildStructuralContextSection(input: StoryArchitectInput): string {
    const base = buildSharedStructuralContextSection({
      anchors: input.seasonAnchors,
      storyCircle: input.seasonStoryCircle,
      episodeStoryCircleRole: this.resolveEpisodeStoryCircleRole(input),
    });
    const eventPlan = input.seasonPlanDirectives?.episodeEventPlan;
    if (!eventPlan) return base;
    const allowed = eventPlan.sceneContexts
      .map((context) => {
        const owned = context.ownedEventIds.join(', ') || '(no depiction event; annotate pressure only)';
        const forbidden = context.forbiddenRestageEventIds.join(', ') || 'none';
        return `${context.sceneId}: owns [${owned}]; forbidden restages [${forbidden}]`;
      })
      .join('\n');
    return `${base}\n\n## CANONICAL NARRATIVE EVENT PLAN (IMMUTABLE)\n` +
      `Use only the event IDs assigned to each scene. Return them as realizedEventIds and keep supportingContractIds limited to the scene's source contracts. ` +
      `A downstream payoff is a new event; never claim ownership of an upstream episode's event. ` +
      `Do not restage any forbidden event, even when the same location or characters remain present.\n${allowed}`;
  }

  private resolveEpisodeStoryCircleRole(input: StoryArchitectInput): StoryCircleRoleAssignment[] {
    if (input.episodeStoryCircleRole?.length) {
      return input.episodeStoryCircleRole.map((role) => ({ ...role }));
    }
    return [];
  }

  private normalizeEpisodeCircle(
    episodeCircle: Partial<StoryCircleStructure> | undefined,
    input: StoryArchitectInput,
    arc?: EpisodeBlueprint['arc'],
  ): StoryCircleStructure {
    const fallback = this.buildEpisodeCircle(input, arc);
    const normalized = { ...fallback };
    for (const beat of STORY_CIRCLE_BEATS) {
      const value = episodeCircle?.[beat];
      // Hold the model's beat to the same bar the StoryCircleGate applies —
      // a too-short/placeholder beat must keep the concrete fallback instead
      // of overwriting it and aborting the episode at the gate (observed live).
      if (hasConcreteStoryCircleBeatText(value)) {
        normalized[beat] = value.trim();
      }
    }
    return normalized;
  }

  private episodeCircleContractScene(scene: SceneBlueprint, order: number): EpisodeCircleContractScene {
    return {
      id: scene.id,
      order,
      name: scene.name,
      description: scene.description,
      dramaticPurpose: scene.dramaticPurpose,
      narrativeFunction: scene.narrativeFunction,
      narrativeRole: scene.narrativeRole,
      isEncounter: scene.isEncounter,
      hasChoice: Boolean(scene.choicePoint),
      choicePoint: scene.choicePoint,
      keyBeats: scene.keyBeats,
      storyCircleBeatContracts: scene.storyCircleBeatContracts,
    };
  }

  private bindEpisodeCircleContracts(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    if (!blueprint.storyCircleRole || blueprint.storyCircleRole.length === 0) {
      blueprint.storyCircleRole = this.resolveEpisodeStoryCircleRole(input);
    }
    this.rebindInheritedStoryCircleContracts(blueprint);
    blueprint.episodeCircle = blueprint.episodeCircle
      ? { ...blueprint.episodeCircle }
      : this.normalizeEpisodeCircle(undefined, input, blueprint.arc);

    const episodePrefix = `episode-circle-ep${input.episodeNumber}-`;
    for (const scene of blueprint.scenes ?? []) {
      scene.storyCircleBeatContracts = (scene.storyCircleBeatContracts ?? [])
        .filter((contract) => !contract.id.startsWith(episodePrefix));
    }

    const contracts = buildEpisodeCircleBeatContracts({
      episodeNumber: input.episodeNumber,
      episodeCircle: blueprint.episodeCircle,
      storyCircleRole: blueprint.storyCircleRole,
      scenes: (blueprint.scenes ?? []).map((scene, index) => this.episodeCircleContractScene(scene, index)),
    });

    const scenesById = new Map((blueprint.scenes ?? []).map((scene) => [scene.id, scene]));
    for (const contract of contracts) {
      for (const sceneId of contract.targetSceneIds) {
        const scene = scenesById.get(sceneId);
        if (!scene) continue;
        const existing = scene.storyCircleBeatContracts ?? [];
        if (existing.some((candidate) => candidate.id === contract.id)) continue;
        scene.storyCircleBeatContracts = [...existing, contract];
      }
    }
  }

  private rebindInheritedStoryCircleContracts(blueprint: EpisodeBlueprint): void {
    const scenes = blueprint.scenes ?? [];
    if (scenes.length === 0) return;
    const episodeNumber = blueprint.number ?? 1;
    const byId = new Map(scenes.map((scene) => [scene.id, scene]));
    const inherited = new Map<string, NonNullable<SceneBlueprint['storyCircleBeatContracts']>[number]>();
    for (const scene of scenes) {
      const kept = [];
      for (const contract of scene.storyCircleBeatContracts ?? []) {
        if (contract.id?.startsWith(`episode-circle-ep${episodeNumber}-`)) {
          kept.push(contract);
          continue;
        }
        if (typeof contract.targetEpisodeNumber === 'number' && contract.targetEpisodeNumber !== episodeNumber) {
          continue;
        }
        for (const normalized of normalizeStoryCircleContractForSceneProse(contract)) {
          if (normalized.id && !inherited.has(normalized.id)) inherited.set(normalized.id, { ...normalized });
        }
      }
      scene.storyCircleBeatContracts = kept;
    }

    for (const contract of inherited.values()) {
      const target = this.bestBlueprintSceneForStoryCircleContract(contract.sourceText, scenes);
      if (!target) continue;
      contract.targetSceneIds = [target.id];
      target.storyCircleBeatContracts = [...(target.storyCircleBeatContracts ?? []), contract];
    }
  }

  private bestBlueprintSceneForStoryCircleContract(
    sourceText: string | undefined,
    scenes: SceneBlueprint[],
  ): SceneBlueprint | undefined {
    const source = (sourceText || '').toLowerCase();
    if (!source.trim()) return undefined;
    const scored = scenes
      .map((scene, index) => ({
        scene,
        score: this.storyCircleContractSceneCueScore(source, this.blueprintSceneCueText(scene), scene, index),
      }))
      .sort((a, b) => b.score - a.score);
    return scored[0] && scored[0].score > 0 ? scored[0].scene : undefined;
  }

  private blueprintSceneCueText(scene: SceneBlueprint): string {
    return [
      scene.id,
      scene.name,
      scene.description,
      scene.dramaticPurpose,
      scene.narrativeFunction,
      scene.narrativeRole,
      scene.location,
      scene.signatureMoment,
      ...(scene.keyBeats ?? []),
      ...(scene.requiredBeats ?? []).flatMap((beat) => [beat.sourceTurn, beat.mustDepict]),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  private storyCircleContractSceneCueScore(source: string, target: string, scene: SceneBlueprint, index: number): number {
    let score = 0;
    const sourceCues = detectPrimaryStoryEventCues(source);
    const targetCues = detectPrimaryStoryEventCues(target);
    for (const cue of sourceCues) {
      if (targetCues.has(cue)) score += 6;
    }
    if (sourceCues.has('threatEncounter') && targetCues.has('blogAftermath')) score -= 3;
    if (sourceCues.has('blogAftermath') && targetCues.has('threatEncounter')) score -= 3;
    if (sourceCues.has('arrival') && index === 0) score += 2;
    if (score === 0 && this.treatmentCueTokenOverlap(source, target) >= 3) score += 1;
    score += Math.max(0, 1 - index * 0.01);
    return score;
  }

  private treatmentCueTokenOverlap(source: string, target: string): number {
    const stopwords = new Set(['the', 'and', 'that', 'with', 'from', 'this', 'into', 'episode', 'scene', 'story', 'protagonist']);
    const sourceTokens = new Set(source.split(/[^a-z0-9']+/).filter((token) => token.length >= 4 && !stopwords.has(token)));
    const targetTokens = new Set(target.split(/[^a-z0-9']+/).filter((token) => token.length >= 4 && !stopwords.has(token)));
    let matches = 0;
    sourceTokens.forEach((token) => {
      if (targetTokens.has(token)) matches += 1;
    });
    return matches;
  }

  private buildEpisodeCircle(
    input: StoryArchitectInput,
    arc?: EpisodeBlueprint['arc'],
  ): StoryCircleStructure {
    const spineCircle = input.seasonPlanDirectives?.episodeSpine?.episodeCircle;
    if (spineCircle) {
      const empty: StoryCircleStructure = {
        you: '', need: '', go: '', search: '', find: '', take: '', return: '', change: '',
      };
      const fromSpine: StoryCircleStructure = { ...empty };
      for (const beat of STORY_CIRCLE_BEATS) {
        const text = spineCircle[beat];
        if (typeof text === 'string' && text.trim()) fromSpine[beat] = text.trim();
      }
      const hasAny = STORY_CIRCLE_BEATS.some((beat) => fromSpine[beat].trim().length > 0);
      if (hasAny) {
        // Fill any empty active beats via scoped builder, then prefer spine text.
        const guidance = input.seasonPlanDirectives?.treatmentGuidance;
        const scoped = buildScopedEpisodeCircle({
          episodeNumber: input.episodeNumber,
          episodeTitle: input.episodeTitle || `Episode ${input.episodeNumber}`,
          synopsis: input.episodeSynopsis || input.synopsis || 'the episode pressure',
          majorPressure: guidance?.dramaticQuestion || guidance?.episodePromise,
          episodeTurns: guidance?.episodeTurns,
          storyCircleRole: input.episodeStoryCircleRole,
          arc,
          isFutureSeasonScopedText: (text) => this.isLikelyFutureSeasonEpisodeCircleText(text, input),
        });
        for (const beat of STORY_CIRCLE_BEATS) {
          if (!fromSpine[beat].trim() && scoped[beat]?.trim()) fromSpine[beat] = scoped[beat];
        }
        return fromSpine;
      }
    }
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    return buildScopedEpisodeCircle({
      episodeNumber: input.episodeNumber,
      episodeTitle: input.episodeTitle || `Episode ${input.episodeNumber}`,
      synopsis: input.episodeSynopsis || input.synopsis || 'the episode pressure',
      majorPressure: guidance?.dramaticQuestion || guidance?.episodePromise,
      episodeTurns: guidance?.episodeTurns,
      storyCircleRole: input.episodeStoryCircleRole,
      arc,
      isFutureSeasonScopedText: (text) => this.isLikelyFutureSeasonEpisodeCircleText(text, input),
    });
  }

  private isLikelyFutureSeasonEpisodeCircleText(text: string, input: StoryArchitectInput): boolean {
    const explicitEpisode = text.match(/\b(?:ep|episode)\.?\s*#?\s*(\d+)\b/i)?.[1];
    if (explicitEpisode) return Number(explicitEpisode) !== input.episodeNumber;

    const normalizedText = text.toLowerCase();
    const localContext = [
      input.episodeTitle,
      input.episodeSynopsis,
      input.synopsis,
    ].filter(Boolean).join(' ').toLowerCase();
    const futureSeasonMarkers = [
      /\blater\s+(?:episode|season|arc)\b/,
      /\bfinale\b/,
      /\bfinal\s+post\b/,
      /\bhunter\s+moon\b/,
      /\bmountain\s+(?:weekend|wife)\b/,
      /\bcasa\s+(?:lupului|stelarum)\b/,
      /\bmirror\s+behind\s+victor\b/,
      /\bradu'?s?\s+confession\b/,
    ];
    if (!futureSeasonMarkers.some((pattern) => pattern.test(normalizedText))) return false;

    if (input.episodeNumber <= 2) return true;

    const importantTokens = normalizedText
      .split(/[^a-z0-9']+/)
      .filter((token) => token.length >= 5 && !['episode', 'season', 'story'].includes(token));
    const overlap = importantTokens.filter((token) => localContext.includes(token)).length;
    return overlap === 0;
  }

  private buildCliffhangerPlanSection(input: StoryArchitectInput): string {
    const plan = input.cliffhangerPlan;
    if (!plan) return '';

    return `
## Story Circle Cliffhanger Plan (final scene contract)
- Style: ${plan.style}
- Next loop launch beat: ${plan.storyCircleLaunchBeat || 'go'}
- Type: ${plan.type}
- Intensity: ${plan.intensity}
- Hook to deliver: ${plan.hook}
- Setup that must make it earned: ${plan.setup}
- Immediate episode tension to acknowledge/resolve: ${plan.resolvedEpisodeTension}
- New open question: ${plan.newOpenQuestion}
- Emotional charge: ${plan.emotionalCharge}
- Next-episode pressure: ${plan.nextEpisodePressure}

Design the final scene as "aftermath plus hook": show the consequence of this episode's encounter/choice, then end on the new question or pressure above.
`;
  }

  private buildSeasonPlanDirectivesSection(input: StoryArchitectInput): string {
    const directives = input.seasonPlanDirectives;
    if (!directives) return '';

    let section = '\n## SEASON PLAN DIRECTIVES (Master Blueprint)\n';
    section += 'The following directives come from the season-level master plan. Follow them precisely.\n\n';

    if (directives.difficultyTier) {
      section += `**Difficulty Tier**: ${directives.difficultyTier} — calibrate encounters and tension accordingly.\n\n`;
    }

    if (directives.arcPressure) {
      const arc = directives.arcPressure;
      section += '### Arc Pressure Architecture\n';
      section += 'The season Story Circle spine remains authoritative. This arc is a 3-8 episode pressure movement inside that spine; do not create literal act structure or non-protagonist POV scenes.\n\n';
      section += `- Arc: ${arc.arcName} (${arc.arcId})\n`;
      if (arc.arcQuestion) {
        section += `- Arc question: ${arc.arcQuestion}\n`;
      }
      if (arc.seasonQuestionRelation) {
        section += `- Relation to season question/stakes: ${arc.seasonQuestionRelation}\n`;
      }
      if (arc.identityPressureFacet) {
        section += `- Identity pressure facet: ${arc.identityPressureFacet}\n`;
      }
      if (arc.episodeTurnout) {
        section += `- This episode's arc turn-out (${arc.episodeTurnout.turnType}): ${arc.episodeTurnout.description}\n`;
        section += `  Leaves protagonist with: ${arc.episodeTurnout.leavesProtagonistWith}\n`;
        section += `  Why this cannot move later: ${arc.episodeTurnout.whyThisCannotMoveLater}\n`;
      }
      if (arc.midpointRecontextualization) {
        section += `- Arc midpoint recontextualization, Episode ${arc.midpointRecontextualization.episodeNumber}: ${arc.midpointRecontextualization.description}\n`;
        section += `  Before: ${arc.midpointRecontextualization.questionBefore}\n`;
        section += `  After: ${arc.midpointRecontextualization.questionAfter}\n`;
      }
      if (arc.lateArcCrisis) {
        section += `- Late arc crisis, Episode ${arc.lateArcCrisis.episodeNumber}: ${arc.lateArcCrisis.description}\n`;
        section += `  Apparent failure: ${arc.lateArcCrisis.apparentFailure}\n`;
        section += `  Irreversible cost: ${arc.lateArcCrisis.irreversibleCost}\n`;
      }
      if (arc.finaleAnswer) {
        section += `- Arc finale answer: ${arc.finaleAnswer}\n`;
      }
      if (arc.handoffPressure) {
        section += `- Handoff pressure: ${arc.handoffPressure}\n`;
      }
      section += 'Use this episode to land its arc turn-out through consequence, reversal, discovery, cost, escalation, choice residue, crisis, finale, or handoff.\n\n';
    }

    if (directives.characterArchitecture) {
      const architecture = directives.characterArchitecture;
      const protagonist = architecture.protagonist;
      section += '### Character Architecture Pressure\n';
      section += 'Use this as agent-facing psychology only; do not expose Lie/Wound/Truth labels to the player. Express the pressure through wants, choices, costs, relationship behavior, subtext, and consequences.\n\n';
      section += `- Protagonist Lie/protective belief: ${protagonist.lie}\n`;
      section += `- Origin pressure: ${protagonist.originPressure}\n`;
      section += `- Truth/counter-belief: ${protagonist.truth}\n`;
      section += `- Want: ${protagonist.want}\n`;
      section += `- Need: ${protagonist.need}\n`;
      section += `- Arc mode: ${protagonist.arcMode}\n`;
      section += `- Climax choice: ${protagonist.climaxChoice.choiceQuestion}\n`;
      section += `  Truth option: ${protagonist.climaxChoice.integrateTruthOption}\n`;
      section += `  Lie option: ${protagonist.climaxChoice.recommitLieOption}\n`;
      section += `  Active mechanism: ${protagonist.climaxChoice.activeChoiceMechanism}\n`;
      const supporting = architecture.supportingCharacters.filter((character) => character.screenTimeTier !== 'minor');
      if (supporting.length > 0) {
        section += 'Supporting micro-Lies to use only where protagonist-visible:\n';
        for (const character of supporting.slice(0, 5)) {
          section += `- ${character.characterName} (${character.pressureRole}): ${character.microLie} / ${character.truthOrCounterPressure}\n`;
          if (character.protagonistVisibleSignals.length > 0) {
            section += `  Visible signals: ${character.protagonistVisibleSignals.join(' | ')}\n`;
          }
        }
      }
      section += 'Episode scenes should pressure one clean slice of the Lie/Truth gap: expose, reward, punish, tempt, reframe, or force a choice around one aspect of this gap.\n\n';
    }

    if (directives.themeArgument) {
      const argument = directives.themeArgument;
      section += '### Theme Argument / Resonance Pressure\n';
      section += 'Use this as generator-only story logic. Do not write labels such as controlling idea, counter-idea, value ladder, or negation-of-negation in player-facing prose.\n\n';
      section += `- Theme question: ${argument.themeQuestion}\n`;
      section += `- Controlling idea: ${argument.controllingIdea.sentence}\n`;
      section += `- Counter-idea: ${argument.counterIdea.sentence}\n`;
      section += `- Value ladder: positive=${argument.valueLadder.positive}; contrary=${argument.valueLadder.contrary}; contradiction=${argument.valueLadder.contradiction}; negation=${argument.valueLadder.negationOfNegation}\n`;
      section += `- Climax resonant event: ${argument.climaxResonantEvent}\n`;
      section += `- Retroactive reframe: ${argument.retroactiveReframe}\n`;
      if (argument.imageSystem?.length) {
        section += 'Image-system motifs to plant/pay off through existing visual fields:\n';
        for (const motif of argument.imageSystem.slice(0, 4)) {
          section += `- ${motif.motifId}: ${motif.motif} => ${motif.thematicMeaning}; climax treatment: ${motif.climaxTreatment}\n`;
        }
      }
      section += 'This episode should explicitly test the theme question through conflict, cost, choice, relationship pressure, information movement, or identity movement. Major choices should either support, challenge, corrupt, or repair the central value.\n\n';
    }

    if (directives.characterTreatmentContracts?.length) {
      section += '### Protagonist Treatment Realization Contracts\n';
      section += 'These authored protagonist fields are binding story obligations. Do not copy field labels into prose; assign them to scene turns, choices, mechanic pressure, information movement, visual profile, climax choice, or ending state so they can be validated later.\n\n';
      for (const contract of directives.characterTreatmentContracts) {
        section += `- ${contract.fieldName} (${contract.contractKind}): ${contract.sourceText}\n`;
        section += `  Required realization: ${contract.requiredRealization.join(', ')}; target episodes: ${contract.targetEpisodeNumbers.join(', ') || 'planned as needed'}\n`;
      }
      section += 'The opening must establish the starting identity and load-bearing role facts. Major choices should test Want/Need/Lie/Truth pressure. Finale/end-state contracts must become reachable route and ending pressure, not summary-only narration.\n\n';
    }

    if (directives.worldTreatmentContracts?.length) {
      section += '### World/Location Treatment Realization Contracts\n';
      section += 'These authored setting fields are binding only when they carry story law, location purpose, faction pressure, taboo/cost, information movement, or choice pressure. Do not copy them as lore exposition; assign them to world-bible use, scene turns, choices, encounters, information ledger, mechanic pressure, or final prose.\n\n';
      for (const contract of directives.worldTreatmentContracts) {
        section += `- ${contract.fieldName} (${contract.contractKind}${contract.locationName ? ` @ ${contract.locationName}` : ''}): ${contract.sourceText}\n`;
        section += `  Required realization: ${contract.requiredRealization.join(', ')}; target episodes: ${contract.targetEpisodeNumbers.join(', ') || 'planned as needed'}\n`;
      }
      section += 'Major locations must not become interchangeable backdrops. If a scene uses a contracted location, its purpose or choice pressure should shape the turn, the available action, the risk, or the handoff.\n\n';
    }

    if (directives.seasonPromiseArchitecture) {
      const promise = directives.seasonPromiseArchitecture;
      section += '### Season Promise Architecture\n';
      section += 'Follow this contract without adding fixed TV tent-poles, mandatory re-pilots, or penultimate-climax rules. The Story Circle spine remains authoritative.\n\n';
      section += `- Season dramatic question: ${promise.seasonDramaticQuestion}\n`;
      section += `- Central pressure (${promise.centralPressure.type}): ${promise.centralPressure.description}\n`;
      section += `  Pressures the protagonist by: ${promise.centralPressure.pressuresLieBy}\n`;
      section += `- Premise promise: ${promise.seasonPromise.premisePromise}\n`;
      section += `- Player experience promise: ${promise.seasonPromise.playerExperiencePromise}\n`;
      section += `- Emotional promise: ${promise.seasonPromise.emotionalPromise}\n`;
      if (promise.seasonPromise.variationPlan.length > 0) {
        section += 'Fresh promise variations to echo across scenes/choices:\n';
        for (const variation of promise.seasonPromise.variationPlan.slice(0, 5)) {
          section += `- ${variation}\n`;
        }
      }
      section += `- Season completeness target: ${promise.seasonCompleteness.resolvedQuestion}\n`;
      section += `  Stakes resolved/changed: ${promise.seasonCompleteness.resolvedStakes}\n`;
      section += `  Character state change: ${promise.seasonCompleteness.characterStateChange}\n`;
      if (promise.seasonCompleteness.openFuturePressure) {
        section += `  Earned future pressure: ${promise.seasonCompleteness.openFuturePressure}\n`;
      }
      section += 'This episode should either establish, vary, complicate, pay off, or hand forward the season promise.\n\n';
    }

    if (directives.seasonPromiseContracts?.length) {
      section += '### Top-Level Season Promise Realization Contracts\n';
      section += 'These are authored or inferred season-level promises. Realize them as staged evidence in scene purpose, choices, encounters, information movement, consequence pressure, tone, or ending state. Do not copy them as labels or explanation.\n\n';
      for (const contract of directives.seasonPromiseContracts) {
        section += `- ${contract.contractKind}: ${contract.sourceText}\n`;
        section += `  Realize through: ${contract.requiredRealization.join(', ')}\n`;
      }
      section += '\n';
    }

    if (directives.stakesArchitectureContracts?.length) {
      section += '### Stakes Architecture Realization Contracts\n';
      section += 'These authored stakes are binding story pressure. Assign them to concrete scene turns, choices, encounters, information movement, consequence pressure, mechanic pressure, or episode endings. Do not copy them as labels; make the player feel what can be lost, gained, protected, betrayed, or transformed.\n\n';
      for (const contract of directives.stakesArchitectureContracts) {
        section += `- ${contract.fieldName} (${contract.contractKind}${contract.stakeLayer ? ` / ${contract.stakeLayer}` : ''}): ${contract.sourceText}\n`;
        section += `  Required realization: ${contract.requiredRealization.join(', ')}; target episodes: ${contract.targetEpisodeNumbers.join(', ') || 'planned as needed'}\n`;
        if (contract.prerequisiteContractIds.length > 0) {
          section += `  Prerequisites: ${contract.prerequisiteContractIds.join(', ')}\n`;
        }
      }
      section += 'Material stakes should alter resource/access/reputation/information pressure. Relational stakes should alter behavior, trust, betrayal, repair, alliance, or route pressure. Identity stakes should test self-concept and agency. Existential stakes must be grounded by earlier personal stakes before full payoff.\n\n';
    }

    if (directives.storyCircleBeatContracts?.length) {
      section += '### Story Circle Beat Realization Contracts\n';
      section += 'These authored Story Circle beat texts are binding content obligations for this episode. The Story Circle role label is not enough: assign the beat to scene turns, choices, reveals, mechanic pressure, or episode ending state and stage the actual event/function on-page.\n\n';
      for (const contract of directives.storyCircleBeatContracts) {
        section += `- ${contract.beat}: ${contract.sourceText}\n`;
        section += `  Event atoms: ${contract.eventAtoms.join(' | ') || contract.sourceText}\n`;
        if (contract.stateChange) {
          section += `  State change to make visible: ${contract.stateChange}\n`;
        }
      }
      section += 'Honor the full Story Circle definitions in the structural context above; do not solve this with summary sentences or metadata-only labels.\n\n';
    }

    if (directives.arcPressureContracts?.length) {
      section += '### Arc Pressure Treatment Realization Contracts\n';
      section += 'These authored arc-plan fields are binding for this episode. Story Circle roles define placement; these arc contracts define the pressure movement that must be felt through scene turns, choices, information movement, mechanic pressure, episode endings, or handoff. Do not paste arc labels into prose.\n\n';
      for (const contract of directives.arcPressureContracts) {
        section += `- ${contract.arcTitle} / ${contract.fieldName} (${contract.contractKind}): ${contract.sourceText}\n`;
        section += `  Target episodes: ${contract.targetEpisodeNumbers.join(', ') || 'planned as needed'}; realize through: ${contract.requiredRealization.join(', ')}\n`;
        if (contract.eventAtoms.length > 0) {
          section += `  Event atoms: ${contract.eventAtoms.join(' | ')}\n`;
        }
      }
      section += 'Arc questions should be tested by behavior and choice pressure. Midpoints must reframe. Late crises must cost something or narrow options. Finale answers must alter episode state. Handoffs must leave visible residue for the next arc.\n\n';
    }

    if (directives.branchConsequenceContracts?.length) {
      section += '### Cross-Episode Branch / Consequence Contracts\n';
      section += 'These authored Section 11 branch contracts are binding. Origin choices must set specific path state. Later scenes must spend that state through conditional prose, route pressure, consequence chains, mechanic pressure, or text variants. Reconvergence is allowed only when authored residue remains visible.\n\n';
      for (const contract of directives.branchConsequenceContracts) {
        section += `- ${contract.branchName} / ${contract.fieldName} (${contract.contractKind}): ${contract.sourceText}\n`;
        section += `  Target episodes: ${contract.targetEpisodeNumbers.join(', ') || 'planned as needed'}; domains: ${contract.stateDomains.join(', ')}; realize through: ${contract.requiredRealization.join(', ')}\n`;
        if (contract.targetEndingIds.length > 0) {
          section += `  Ending eligibility: ${contract.targetEndingIds.join(', ')}\n`;
        }
      }
      section += 'Do not target every ending by default. A branch path should point only to endings its authored state actually supports. Do not satisfy branch residue with a generic line; show the changed access, item/resource, relationship posture, information, route permission, or ending eligibility.\n\n';
    }

    if (directives.endingRealizationContracts?.length) {
      section += '### Alternate Ending Realization Contracts\n';
      section += 'These authored Section 14 ending contracts are binding route/finale obligations. The finale choice and ending prose must pay off prior branch state, repeated choice patterns, state drivers, target conditions, emotional register, and theme payoff fiction-first.\n\n';
      for (const contract of directives.endingRealizationContracts) {
        section += `- ${contract.endingName} / ${contract.fieldName} (${contract.contractKind}): ${contract.sourceText}\n`;
        section += `  Ending ids: ${contract.targetEndingIds.join(', ')}; domains: ${contract.stateDomains.join(', ')}; realize through: ${contract.requiredRealization.join(', ')}\n`;
        if (contract.linkedContractIds.length > 0) {
          section += `  Linked branch pressure: ${contract.linkedContractIds.join(', ')}\n`;
        }
      }
      section += 'Do not claim transformation or route state that the season has not earned. Endings should feel like the cumulative pattern of choices becoming story, not a menu label or score threshold.\n\n';
    }

    if (directives.failureModeAuditContracts?.length) {
      section += '### Failure Mode Audit Contracts\n';
      section += 'These authored Section 15 audit contracts are binding only as staged mitigations. Do NOT mention failure-mode labels in prose. Instead, make the causal protection visible: agency, setup/payoff, fair-play clues, personal-before-existential stakes, irreversible state change, thematic rhyme, or in-world coincidence mitigation.\n\n';
      for (const contract of directives.failureModeAuditContracts) {
        section += `- ${contract.label} (${contract.status} / ${contract.contractKind}): ${contract.sourceText}\n`;
        section += `  Target episodes: ${contract.targetEpisodeNumbers.join(', ') || 'planned as needed'}; realize through: ${contract.requiredRealization.join(', ')}\n`;
        if (contract.linkedContractIds.length > 0) {
          section += `  Linked pressure/contracts: ${contract.linkedContractIds.join(', ')}\n`;
        }
      }
      section += 'Repair the story shape, not the explanation. A watch item passes only when the risk event has an on-page cause or mitigation planted before/during the event.\n\n';
    }

    if (directives.informationLedgerEntries && directives.informationLedgerEntries.length > 0) {
      section += '### Information Ledger Entries For This Episode\n';
      section += 'Use these to control who knows what and when. Do not reveal withheld information early. Prefer suspense/dramatic irony when the player can know the threat without breaking protagonist POV.\n\n';
      for (const entry of directives.informationLedgerEntries) {
        section += `- ${entry.id} / ${entry.label} (${entry.tensionMode}, ${entry.audienceKnowledgeState})\n`;
        section += `  Description: ${entry.description}\n`;
        section += `  Known by: ${entry.knownBy.join(', ')}\n`;
        if (entry.withheldFrom?.length) {
          section += `  Withheld from: ${entry.withheldFrom.join(', ')}\n`;
        }
        section += `  Introduced: Episode ${entry.introducedEpisode}`;
        if (entry.plannedRevealEpisode) section += ` | Reveal: Episode ${entry.plannedRevealEpisode}`;
        if (entry.plannedPayoffEpisode) section += ` | Payoff: Episode ${entry.plannedPayoffEpisode}`;
        section += '\n';
        if (entry.setupTouchEpisodes.length > 0) {
          section += `  Setup touches: ${entry.setupTouchEpisodes.join(', ')}\n`;
        }
        section += `  Payoff plan: ${entry.payoffPlan}\n`;
      }
      section += 'This episode should perform clear information jobs: plant, touch, reveal, pay off, close, or sharpen key questions.\n\n';
    }

    if (directives.endingMode) {
      section += `**Ending Mode**: ${directives.endingMode}\n`;
      if (directives.resolvedEndings && directives.resolvedEndings.length > 0) {
        section += '### Active Ending Targets\n';
        section += 'Use these endgame routes to shape branch pressure and climax meaning:\n\n';
        for (const ending of directives.resolvedEndings) {
          section += `- **${ending.id} / ${ending.name}**: ${ending.summary}\n`;
          section += `  Theme payoff: ${ending.themePayoff}\n`;
          section += `  Emotional register: ${ending.emotionalRegister}\n`;
          if (ending.stateDrivers.length > 0) {
            section += `  State drivers: ${ending.stateDrivers.map((driver) => `${driver.type}: ${driver.label}`).join('; ')}\n`;
          }
          if (ending.targetConditions.length > 0) {
            section += `  Target conditions: ${ending.targetConditions.join(' | ')}\n`;
          }
        }
        section += '\n';
      }
      if (directives.endingRoutes && directives.endingRoutes.length > 0) {
        section += '### Episode Ending Route Pressure\n';
        section += 'These route beats should be visible in the scenes you design:\n\n';
        for (const route of directives.endingRoutes) {
          section += `- **${route.endingId}** (${route.role}): ${route.description}\n`;
        }
        section += '\n';
      }
    }

    if (directives.treatmentGuidance) {
      const guidance = directives.treatmentGuidance;
      section += '### Authored Treatment Guidance\n';
      section += 'These details came from the user-authored treatment. Preserve them as binding episode intent, not optional flavor. Do not compress away authored setup/opening beats when they are needed to earn the listed choices, consequences, or cliffhanger.\n\n';
      if (guidance.episodePromise) {
        section += `- Episode promise: ${guidance.episodePromise}\n`;
      }
      if (guidance.dramaticQuestion) {
        section += `- Dramatic question: ${guidance.dramaticQuestion}\n`;
      }
      if (guidance.coldOpenFunction) {
        section += `- Cold open / hook function: ${guidance.coldOpenFunction}\n`;
      }
      if (guidance.openingImage) {
        section += `- Opening image: ${guidance.openingImage}\n`;
      }
      if (guidance.toneRegister) {
        section += `- Tone register: ${guidance.toneRegister}\n`;
      }
      if (guidance.synopsis) {
        section += `- Authored synopsis: ${guidance.synopsis}\n`;
      }
      if (guidance.openingSituation) {
        section += `- Opening situation: ${guidance.openingSituation}\n`;
      }
      if (guidance.scenePlanningTargets?.length) {
        section += 'Authored scene planning target(s) from Section 10 — plan scenes around these named dramatic centers, but do not print the labels as prose:\n';
        for (const target of guidance.scenePlanningTargets) {
          section += `- ${target}\n`;
        }
      }
      if (guidance.episodeTurns?.length) {
        section += 'AUTHORED EPISODE TURNS — these are FIXED required beats, not flavor. You are dramatizing an already-authored episode: each turn below MUST occur, in order, and must NOT be dropped, merged, re-ordered, or re-interpreted. Realize each as a concrete scene beat (scene purpose, keyBeats, sequenceIntent, encounter buildup, choice, or aftermath). Invent only the connective tissue between them:\n';
        guidance.episodeTurns.forEach((turn, idx) => {
          section += `${idx + 1}. ${turn}\n`;
        });
      }
      if (guidance.entryGoal || guidance.obstacle || guidance.forcedChoice || guidance.exitShift) {
        section += 'Scene contract that must be expressed through generated scenes:\n';
        if (guidance.entryGoal) section += `- Entry goal: ${guidance.entryGoal}\n`;
        if (guidance.obstacle) section += `- Obstacle: ${guidance.obstacle}\n`;
        if (guidance.forcedChoice) section += `- Forced choice: ${guidance.forcedChoice}\n`;
        if (guidance.exitShift) section += `- Exit shift: ${guidance.exitShift}\n`;
      }
      if (guidance.powerShift || guidance.subtextGap) {
        section += 'Authored scene craft pressure:\n';
        if (guidance.powerShift) section += `- Power shift: ${guidance.powerShift}\n`;
        if (guidance.subtextGap) section += `- Subtext gap: ${guidance.subtextGap}\n`;
      }
      if (guidance.aPressure || guidance.bPressure || guidance.cSeed) {
        section += 'Authored A/B/C pressure lanes:\n';
        if (guidance.aPressure) section += `- A pressure: ${guidance.aPressure}\n`;
        if (guidance.bPressure) section += `- B pressure: ${guidance.bPressure}\n`;
        if (guidance.cSeed) section += `- C seed: ${guidance.cSeed}\n`;
      }
      if (guidance.stakesLayers?.length) {
        section += 'Authored stakes layers to stack visibly in the major scene/encounter:\n';
        for (const layer of guidance.stakesLayers) {
          section += `- ${layer}\n`;
        }
      }
      if (guidance.themePressure) {
        section += `- Theme pressure: ${guidance.themePressure}\n`;
      }
      if (guidance.liePressure) {
        section += `- Lie pressure: ${guidance.liePressure}\n`;
      }
      if (guidance.informationMovement) {
        section += `- Information movement: ${guidance.informationMovement}\n`;
      }
      if (guidance.encounterAnchors?.length) {
        section += `- Encounter anchors: ${guidance.encounterAnchors.join(' | ')}\n`;
      }
      if (guidance.encounterCentralConflict) {
        section += `- Encounter central conflict: ${guidance.encounterCentralConflict}\n`;
      }
      if (guidance.encounterStoryCircleTarget) {
        section += `- Encounter Story Circle target: ${guidance.encounterStoryCircleTarget}\n`;
      }
      if (guidance.encounterStoryCircleTargetRationale) {
        section += `- Encounter target rationale: ${guidance.encounterStoryCircleTargetRationale}\n`;
      }
      if (guidance.encounterBuildup) {
        section += `- Encounter buildup: ${guidance.encounterBuildup}\n`;
      }
      if (guidance.encounterAftermath) {
        section += `- Encounter aftermath/consequence: ${guidance.encounterAftermath}\n`;
      }
      if (guidance.majorChoicePressures?.length) {
        section += 'Major authored choice pressures that MUST become real choicePoint scenes when treatment-driven:\n';
        for (const pressure of guidance.majorChoicePressures) {
          section += `- ${pressure}\n`;
        }
      }
      if (guidance.alternativePaths?.length) {
        section += 'Authored alternative paths and reconvergence/residue notes:\n';
        for (const path of guidance.alternativePaths) {
          section += `- ${path}\n`;
        }
      }
      if (guidance.connectsBy) {
        section += `- Connects by / choice residue: ${guidance.connectsBy}\n`;
      }
      if (guidance.consequenceSeeds?.length) {
        section += 'Authored consequence seeds. Each MUST be SET on-page as a `setFlag` consequence on a choice in the scene that plants it (use the flag name `treatment_seed_ep<thisEpisodeNumber>_<index>`, e.g. the first seed sets `treatment_seed_ep' + (input.episodeNumber ?? '<N>') + '_1`). A later episode reads this flag as a precondition, so it cannot be a callback-only note — it must actually fire. Set it on the choice that causes the seed:\n';
        guidance.consequenceSeeds.forEach((seed, idx) => {
          section += `${idx + 1}. ${seed} → setFlag treatment_seed_ep${input.episodeNumber ?? 'N'}_${idx + 1}\n`;
        });
      }
      if (guidance.consequenceResidue) {
        section += `- Consequence residue: ${guidance.consequenceResidue}\n`;
      }
      if (guidance.visualAnchor) {
        section += `- Visual anchor: ${guidance.visualAnchor}\n`;
      }
      if (guidance.endStateChange) {
        section += `- End-state change / removability proof: ${guidance.endStateChange}\n`;
      }
      if (guidance.nextEpisodeCausality) {
        section += `- Why the next unit exists because of this one: ${guidance.nextEpisodeCausality}\n`;
      }
      if (guidance.resolvedEpisodeTension) {
        section += `- Resolved episode tension: ${guidance.resolvedEpisodeTension}\n`;
      }
      if (guidance.cliffhangerHook) {
        section += `- Cliffhanger hook to deliver: ${guidance.cliffhangerHook}\n`;
      }
      if (guidance.cliffhangerQuestion) {
        section += `- Cliffhanger question that should become next episode pressure: ${guidance.cliffhangerQuestion}\n`;
      }
      if (guidance.nextEpisodePressure) {
        section += `- Next-episode pressure: ${guidance.nextEpisodePressure}\n`;
      }
      if (guidance.cliffhangerSetup) {
        section += `- Cliffhanger setup that earns the ending: ${guidance.cliffhangerSetup}\n`;
      }
      if (guidance.emotionalCharge) {
        section += `- Cliffhanger emotional charge: ${guidance.emotionalCharge}\n`;
      }
      if (guidance.endingPressure || guidance.authoredCliffhanger || guidance.endingTurnout) {
        section += `- Authored ending pressure (MUST be supported by the final scene narrativeFunction/keyBeats unless this is a finale): ${guidance.endingPressure || guidance.authoredCliffhanger || guidance.endingTurnout}\n`;
      }
      if (guidance.resolutionAftermath) {
        section += `- Finale resolution/aftermath: ${guidance.resolutionAftermath}\n`;
      }
      if (guidance.capabilityGrowthGuidance?.length) {
        section += 'Capability/growth/fail-forward guidance to express through existing skills, attributes, relationships, flags, consequences, and encounter outcomes:\n';
        for (const growth of guidance.capabilityGrowthGuidance) {
          section += `- ${growth}\n`;
        }
      }
      section += '\nMechanical intent: for important scenes, plan which skills are tested, where passive insights can reveal usable fiction, which prior flags/items/relationships become prepared advantages, what failure recovery route exists, and what branch residue survives reconvergence. Express these through existing scene blueprint fields, choice setup context, encounterSetupContext, consequence seeds, and keyBeats; do not invent a separate runtime schema.\n';
      section += '\nCRITICAL: At least one authored major choice pressure must appear as a concrete scene choicePoint unless the episode is structurally impossible without breaking the treatment. Alternative paths must leave visible residue after reconvergence. If you change scene order for pacing, keep the authored setup/choice/consequence/cliffhanger chain legible.\n\n';
    }

    if (directives.plannedEncounters && directives.plannedEncounters.length > 0) {
      section += '### Pre-Planned Encounters\n';
      section += 'These encounters MUST be included as encounter scenes in the blueprint. Copy each encounter ID into the scene field `plannedEncounterId` exactly so downstream generation can bind the scene to the season plan.\n\n';
      for (const enc of directives.plannedEncounters) {
        section += `- **${enc.id}** (${enc.type}, ${enc.difficulty}): ${enc.description}\n`;
        section += `  Stakes: ${enc.stakes}\n`;
        if (enc.centralConflict) {
          section += `  Central conflict to manifest through play: ${enc.centralConflict}\n`;
        }
        if (enc.storyCircleTarget) {
          section += `  Encounter Story Circle target: ${enc.storyCircleTarget}\n`;
          section += `  Target rationale: ${enc.storyCircleTargetRationale || 'Honor the season planner target; do not retarget locally.'}\n`;
          if (enc.storyCircleTargetEvidence?.protagonistChange) {
            section += `  Protagonist change evidence: ${enc.storyCircleTargetEvidence.protagonistChange}\n`;
          }
        }
        if (enc.aftermathConsequence) {
          section += `  Aftermath/consequence to pay off after the encounter: ${enc.aftermathConsequence}\n`;
        }
        if (enc.npcsInvolved.length > 0) {
          section += `  NPCs: ${enc.npcsInvolved.join(', ')}\n`;
        }
        if (enc.relevantSkills.length > 0) {
          section += `  Skills: ${enc.relevantSkills.join(', ')}\n`;
        }
        if (enc.encounterBuildup) {
          section += `  Buildup: ${enc.encounterBuildup}\n`;
        }
        if (enc.encounterSetupContext && enc.encounterSetupContext.length > 0) {
          section += `  Setup payoff context:\n`;
          for (const payoff of enc.encounterSetupContext) {
            section += `    - ${payoff}\n`;
          }
        }
        if (enc.isBranchPoint && enc.branchOutcomes) {
          section += `  BRANCH POINT — Victory: ${enc.branchOutcomes.victory} | Defeat: ${enc.branchOutcomes.defeat}${enc.branchOutcomes.escape ? ` | Escape: ${enc.branchOutcomes.escape}` : ''}\n`;
        }
        section += '\n';
      }
    }

    if (directives.incomingBranchEffects && directives.incomingBranchEffects.length > 0) {
      section += '### Cross-Episode Branch Effects\n';
      section += 'Previous player choices affect this episode. Incorporate these variations:\n\n';
      for (const effect of directives.incomingBranchEffects) {
        section += `- **${effect.branchName}** → ${effect.pathName} (${effect.impact}): ${effect.description}\n`;
      }
      section += '\n';
      section += 'For each encounter scene, preserve the planned encounter Story Circle target on the scene as `encounterStoryCircleTarget` and build its `encounterBeatPlan` to realize that target: `go` forces threshold commitment, `search` tests adaptation, `find` grants the wanted thing or answer while exposing the next problem, and `take` demands payment/cost. Do not retarget a planned encounter unless the treatment explicitly contradicts it.\n\n';
    }

    if (directives.flagsToCheck && directives.flagsToCheck.length > 0) {
      section += '### Flags to Check\n';
      section += 'The episode should reference these flags from earlier episodes:\n\n';
      for (const flag of directives.flagsToCheck) {
        section += `- **${flag.flag}**: If set → ${flag.ifTrue} | If not set → ${flag.ifFalse}\n`;
      }
      section += '\n';
    }

    if (directives.flagsToSet && directives.flagsToSet.length > 0) {
      section += '### Flags to Set\n';
      section += 'This episode should establish these flags for future episodes:\n\n';
      for (const flag of directives.flagsToSet) {
        section += `- **${flag.flag}**: ${flag.description}\n`;
      }
      section += '\n';
    }

    if (directives.consequenceEffects && directives.consequenceEffects.length > 0) {
      section += '### Consequence Chain Effects\n';
      section += 'Previous choices ripple into this episode:\n\n';
      for (const effect of directives.consequenceEffects) {
        section += `- (${effect.severity}): ${effect.description}\n`;
      }
      section += '\n';
    }

    if (directives.growthContext) {
      const gc = directives.growthContext;
      section += '### GROWTH PLAN FOR THIS EPISODE\n';
      section += `Focus skills: ${gc.focusSkills.join(', ')}\n`;
      section += `Development scene concept: ${gc.developmentScene}\n`;
      if (gc.mentorshipOpportunity) {
        const m = gc.mentorshipOpportunity;
        section += `Mentorship: ${m.npcName} can teach ${m.attribute} if ${m.requiredRelationship.dimension} >= ${m.requiredRelationship.threshold}\n`;
        section += `Narrative hook: ${m.narrativeHook}\n`;
      } else {
        section += 'No mentorship opportunity this episode.\n';
      }
      section += '\n';
      section += 'Include 1-2 DEVELOPMENT SCENES (purpose: transition, choicePoint.type: strategic,\n';
      section += 'choicePoint.consequenceDomain: resource) with competenceArc filled to link growth\n';
      section += 'to upcoming challenges. Place development scenes BEFORE hard checks when the story calls for preparation.\n\n';
      section += 'Capability comes from story progression AND existing mechanics: skills, attributes,\n';
      section += 'relationships, flags, identity, prior choices, consequences, and encounter outcomes.\n';
      section += 'If a player falls short, plan a fiction-first fail-forward path: preparation,\n';
      section += 'training, mentorship, recovery, alliance, investigation, alternate leverage,\n';
      section += 'or a harder re-approach that reconverges. Do not frame this as grinding,\n';
      section += 'stat math, or a mechanical chore in player-facing prose.\n\n';
      if (gc.mentorshipOpportunity) {
        section += 'Include a MENTORSHIP SCENE where the NPC offers training gated by relationship.\n';
        section += 'Always provide a non-gated alternative so the scene works for all players.\n\n';
      }
    }

    return section;
  }

  /**
   * Collect structural issues without throwing, for use in the Karpathy retry loop.
   * Returns an array of issue descriptions; empty = no issues.
   */
  private collectStructuralIssues(blueprint: EpisodeBlueprint, input: StoryArchitectInput): string[] {
    const issues: string[] = [];
    const sceneIds = new Set(blueprint.scenes.map(s => s.id));

    // Graph connectivity: check for orphaned or dangling references
    for (const scene of blueprint.scenes) {
      for (const targetId of scene.leadsTo) {
        if (!sceneIds.has(targetId)) {
          issues.push(`Scene "${scene.id}" references non-existent scene "${targetId}" in leadsTo`);
        }
      }
    }

    // Check reachability from starting scene
    if (blueprint.startingSceneId && sceneIds.has(blueprint.startingSceneId)) {
      const reachable = new Set<string>();
      const queue = [blueprint.startingSceneId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);
        const scene = blueprint.scenes.find(s => s.id === current);
        if (scene) {
          for (const next of scene.leadsTo) {
            if (!reachable.has(next)) queue.push(next);
          }
        }
      }
      const unreachable = blueprint.scenes.filter(s => !reachable.has(s.id));
      if (unreachable.length > 0) {
        issues.push(`${unreachable.length} scene(s) unreachable from starting scene: ${unreachable.map(s => s.id).join(', ')}`);
      }
    }

    // Branching factor: scenes with many outgoing edges may be poorly designed
    for (const scene of blueprint.scenes) {
      if (scene.leadsTo.length > 4) {
        issues.push(`Scene "${scene.id}" has ${scene.leadsTo.length} outgoing paths (max recommended: 4)`);
      }
    }

    if (this.sceneGraphBranching.required && !this.sceneGraphBranching.allowLinearBottleneckEpisodes) {
      const branchPointCount = blueprint.scenes.filter(scene =>
        scene.choicePoint?.branches &&
        scene.choicePoint.type !== 'expression' &&
        new Set(scene.leadsTo || []).size >= 2
      ).length;
      const requiredBranches = Math.min(
        this.effectiveMinBranchesPerEpisode(blueprint.scenes.length),
        this.feasibleBranchSlotCount(blueprint.scenes),
      );
      if (branchPointCount < requiredBranches) {
        issues.push(
          `Only ${branchPointCount} scene-graph branch choicePoint(s); need at least ${requiredBranches}. ` +
          `Add a non-expression choicePoint with branches=true and 2 distinct leadsTo targets that later reconverge.`
        );
      }
    }

    // Choice density pre-check (non-throwing)
    const effectiveTargetSceneCount = this.effectiveTargetSceneCount(blueprint, input);
    if (blueprint.scenes.length > effectiveTargetSceneCount) {
      issues.push(`Blueprint has ${blueprint.scenes.length} scenes; maximum is ${effectiveTargetSceneCount}`);
    }

    const scenesWithChoices = blueprint.scenes.filter(s => s.choicePoint);
    const density = scenesWithChoices.length / blueprint.scenes.length;
    if (density < 0.4) {
      issues.push(`Choice density ${Math.round(density * 100)}% is below 40% minimum (${scenesWithChoices.length}/${blueprint.scenes.length} scenes have choices)`);
    }

    if (this.isFirstSeasonEpisode(input)) {
      const startingScene = blueprint.scenes.find(s => s.id === blueprint.startingSceneId);
      // Encounter scenes carry their player choices internally (approach/skill
      // decisions inside the encounter structure), so an encounter opener
      // satisfies season-opening agency without a standalone choicePoint —
      // the elaborate-mode materializer intentionally never gives encounters
      // one, and rejecting that here made any encounter-first plan unbuildable
      // (bite-me 2026-07-02T18-19-29).
      if (startingScene && !startingScene.choicePoint && !startingScene.isEncounter) {
        issues.push(
          `First scene "${startingScene.id}" of episode 1 has no choicePoint. ` +
          `The first scene of the first episode of each season must include a player choice.`
        );
      }
    }

    // Encounter coverage pre-check
    const encounterScenes = blueprint.scenes.filter(s => s.isEncounter);
    const minEncounters = this.getMinEncountersForBlueprint(blueprint.scenes.length, input);
    if (encounterScenes.length < minEncounters) {
      issues.push(`Only ${encounterScenes.length} encounter scene(s), need at least ${minEncounters}`);
    }

    issues.push(...this.collectTreatmentFidelityIssues(blueprint, input));
    issues.push(...this.collectDramaticStructureIssues(blueprint, input, false));
    issues.push(...this.collectThemePressureIssues(blueprint, false));
    issues.push(...this.collectSceneTurnContractIssues(blueprint, false));
    issues.push(...this.collectEpisodePressureIssues(blueprint, input, false));
    issues.push(...this.collectBlueprintDuplicateEventIssues(blueprint));
    issues.push(...this.collectTreatmentDensityIssues(blueprint, input));

    return issues;
  }

  private collectBlueprintDuplicateEventIssues(blueprint: EpisodeBlueprint): string[] {
    const staged = blueprint.scenes
      .map((scene, index) => {
        const signature = buildEncounterEventSignature(this.sceneBlueprintEventTexts(scene));
        return { scene, index, signature };
      })
      .filter((entry) =>
        entry.signature.pressureActions.size > 0
        && !entry.signature.isSetupOnly
        && !entry.signature.isReferenceOnly
      );

    const issues: string[] = [];
    for (let i = 0; i < staged.length; i += 1) {
      for (let j = i + 1; j < staged.length; j += 1) {
        const first = staged[i];
        const second = staged[j];
        const match = compareEncounterEventSignatures(first.signature, second.signature);
        if (!match.matched) continue;
        if (this.isEncounterSetupPair(first.scene, second.scene) || this.isEncounterSetupPair(second.scene, first.scene)) continue;
        issues.push(
          `Scene "${second.scene.id}" appears to restage the same high-pressure event as "${first.scene.id}" ` +
          `(${match.matchedSignals.join(', ') || 'shared event signature'}). ` +
          `Merge the event into one encounter/scene, or rewrite "${second.scene.id}" as consequence, recap, warning, or a distinct escalation.`,
        );
      }
    }
    return issues;
  }

  private isEncounterSetupPair(setupScene: SceneBlueprint, encounterScene: SceneBlueprint): boolean {
    if (setupScene.isEncounter || !encounterScene.isEncounter) return false;
    const linkedToEncounter = (setupScene.leadsTo ?? []).includes(encounterScene.id);
    const setupText = [
      setupScene.id,
      setupScene.name,
      setupScene.description,
      setupScene.dramaticPurpose,
      setupScene.encounterBuildup,
      ...(setupScene.keyBeats ?? []),
    ].filter(Boolean).join(' ');
    return linkedToEncounter
      && /\b(?:setup|buildup|builds?|rooftop|threshold|prelude|before|locks into place)\b/i.test(setupText);
  }

  private sceneBlueprintEventTexts(scene: SceneBlueprint): string[] {
    return [
      scene.name,
      scene.description,
      scene.location,
      scene.dramaticPurpose,
      scene.signatureMoment,
      scene.turnContract?.centralTurn,
      scene.turnContract?.turnEvent,
      scene.turnContract?.handoff,
      ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
      ...(scene.authoredTreatmentFields ?? [])
        .filter((field) => scene.isEncounter || !field.contractKind.startsWith('encounter_'))
        .map((field) => field.sourceText),
      ...(scene.keyBeats ?? []),
    ].filter((part): part is string => Boolean(part?.trim()));
  }

  private collectTreatmentDensityIssues(blueprint: EpisodeBlueprint, input: StoryArchitectInput): string[] {
    const reports = analyzeEpisodeTreatmentDensity(blueprint.scenes, input.episodeNumber);
    return reports
      .filter((report) => {
        if (!report.overloaded) return false;
        const scene = blueprint.scenes.find((candidate) => candidate.id === report.sceneId);
        if (scene && this.sceneDensityCanExpandWithBeatBudget(report, scene)) return false;
        return isUnsafeTreatmentDensityReport(report);
      })
      .map((report) =>
        `Treatment density overload in scene "${report.sceneId}": ${describeTreatmentDensityReport(report)}. ` +
        `Fix wrong-scene bindings first: encounter anchors belong on encounter scenes, later/time-coded beats belong on chronological neighboring scenes, and abstract future payoffs should stay plan-level instead of opening-scene prose.`,
      );
  }

  private applySceneConstructionProfiles(blueprint: EpisodeBlueprint, input: StoryArchitectInput): string[] {
    finalizeEpisodeSceneOwnership(blueprint.scenes as never, {
      episodeNumber: input.episodeNumber,
      storyCircleRole: input.episodeStoryCircleRole ?? blueprint.storyCircleRole,
    });
    normalizeRelationshipPacingStages(blueprint.scenes);
    const construction = applySceneConstructionProfilesToScenes(blueprint.scenes, { episodeNumber: input.episodeNumber });
    const issues = construction.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.message);
    for (const scene of blueprint.scenes ?? []) {
      const budget = scene.sceneConstructionProfile?.capacity.beatBudget;
      if (budget?.recommended) {
        scene.recommendedBeatCount = Math.max(scene.recommendedBeatCount ?? 0, budget.recommended);
      }
    }
    const canonicalPlan = input.seasonPlanDirectives?.episodeEventPlan;
    const canonicalIssues = canonicalPlan
      ? validateCanonicalEpisodeBlueprintProjection(canonicalPlan, blueprint.scenes, input.episodeNumber)
        .map((issue) => issue.message)
      : [];
    const legacyDiagnostics = canonicalPlan
      ? []
      : attachSceneEventOwnershipProfiles(blueprint.scenes, { episodeNumber: input.episodeNumber });
    const ownershipIssues = legacyDiagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.message);
    const causalRepairErrors = canonicalPlan
      ? []
      : repairCausalCueOwnershipOrder(blueprint.scenes, { episodeNumber: input.episodeNumber })
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.message);
    const preflight = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: input.episodeNumber,
      storyCircleRole: input.episodeStoryCircleRole,
      scenes: blueprint.scenes,
      episodeEventPlan: input.seasonPlanDirectives?.episodeEventPlan,
    });
    const preflightIssues = preflight.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message);
    const allIssues = [...issues, ...ownershipIssues, ...causalRepairErrors, ...canonicalIssues, ...preflightIssues];
    blueprint.sceneOwnershipStamp = {
      version: EPISODE_BLUEPRINT_SCENE_OWNERSHIP_VERSION,
      finalizedAt: new Date().toISOString(),
      source: 'story_architect',
      issues: allIssues,
      drainedRequiredBeatIds: construction.applications.flatMap((application) => application.drainedRequiredBeatIds),
    };
    return allIssues;
  }

  private buildTreatmentDensityDiagnostics(blueprint: EpisodeBlueprint, input: StoryArchitectInput): Record<string, unknown> {
    const reports = analyzeEpisodeTreatmentDensity(blueprint.scenes, input.episodeNumber);
    const unsafeReports = reports.filter((report) => {
      if (!report.overloaded) return false;
      const scene = blueprint.scenes.find((candidate) => candidate.id === report.sceneId);
      if (scene && this.sceneDensityCanExpandWithBeatBudget(report, scene)) return false;
      return isUnsafeTreatmentDensityReport(report);
    });
    return {
      gate: 'TreatmentDensityGate',
      episodeNumber: input.episodeNumber,
      reports,
      unsafeReports,
      treatmentBindingReport: blueprint.treatmentBindingReport,
      sceneSummaries: blueprint.scenes.map((scene) => {
        const looseScene = scene as SceneBlueprint & { kind?: string; order?: number };
        return {
          id: scene.id,
          name: scene.name,
          kind: looseScene.kind,
          order: looseScene.order,
          location: scene.location,
          narrativeRole: scene.narrativeRole,
          recommendedBeatCount: scene.recommendedBeatCount,
          coldOpenProfile: scene.coldOpenProfile,
          sceneConstructionProfile: scene.sceneConstructionProfile,
          requiredBeatIds: (scene.requiredBeats ?? []).map((beat) => beat.id),
          authoredTreatmentFieldIds: (scene.authoredTreatmentFields ?? []).map((field) => field.id),
          hasChoice: Boolean(scene.choicePoint),
        };
      }),
    };
  }

  private sceneDensityCanExpandWithBeatBudget(report: TreatmentDensityReport, scene: SceneBlueprint): boolean {
    const hardOverage = Math.max(0, report.hardUnits - report.threshold.hardUnits);
    if (hardOverage > 0) return false;
    if (report.threshold.profile === 'encounter') return false;
    if (report.explicitTimeJumpCount >= 2) return false;
    const recommendedBeatCount = scene.recommendedBeatCount ?? 0;
    if (recommendedBeatCount <= 0) return false;
    return recommendedBeatCount >= Math.ceil(report.totalUnits) + 1;
  }

  private binderSplitCapExtension(blueprint: EpisodeBlueprint): number {
    const eligibleSplitScenes = (blueprint.scenes || []).filter((scene) =>
      scene.planningOrigin?.kind === 'binder_split' &&
      !scene.isEncounter
    );
    return Math.min(eligibleSplitScenes.length, MAX_BINDER_SPLIT_SCENE_CAP_EXTENSION);
  }

  private effectiveTargetSceneCount(blueprint: EpisodeBlueprint, input: StoryArchitectInput): number {
    return input.targetSceneCount + this.binderSplitCapExtension(blueprint);
  }

  private validateBlueprint(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    // Story Circle VERIFICATION (tier 2). Every episode completes a local loop
    // and carries at least one macro season beat through scene-bound contracts.
    this.bindEpisodeCircleContracts(blueprint, input);
    this.applySceneContractsToPlannedBlueprint(blueprint, input);
    // Planned-scene binding may materialize a chronology helper scene (for
    // example late-night writing before a public aftermath). Re-run the
    // bounded repair after that mutation so the gate evaluates the final graph.
    this.repairChoiceDensity(blueprint, input);
    const coldOpenIssues = collectColdOpenProfileIssues(blueprint.scenes ?? [], {
      episodeNumber: input.episodeNumber,
      storyCircleRole: blueprint.storyCircleRole,
      episodeCircle: blueprint.episodeCircle,
    });
    if (coldOpenIssues.length > 0) {
      throw new Error(
        `[ColdOpenStoryCircleGate] Episode ${input.episodeNumber} cold open validation failed: ${coldOpenIssues.join('; ')} ` +
        `The opening scene must fulfill its Story Circle role on-page through one immediate dramatic collision.`,
      );
    }
    const episodeStoryCircle = new EpisodeStoryCircleValidator().validate({
      episodeNumber: input.episodeNumber,
      episodeCircle: blueprint.episodeCircle,
      storyCircleRole: blueprint.storyCircleRole,
      scenes: (blueprint.scenes ?? []).map((scene, index) => this.episodeCircleContractScene(scene, index)),
    });
    const storyCircleErrors = episodeStoryCircle.issues.filter((issue) => issue.severity === 'error');
    if (storyCircleErrors.length > 0) {
      const msg = [
        `[StoryCircleGate] Episode ${input.episodeNumber} Story Circle validation failed: ${storyCircleErrors.map((issue) => issue.message).join('; ')}`,
        ...storyCircleErrors.map((issue) => `- ${issue.message}`),
      ].join('\n');
      if (this.storyCircleBlocking) {
        throw new Error(`${msg} Set STORY_CIRCLE_BLOCKING=0 to downgrade to advisory.`);
      }
      console.warn(msg);
    }
    const storyCircleWarnings = episodeStoryCircle.issues.filter((issue) => issue.severity === 'warning');
    if (storyCircleWarnings.length > 0) {
      console.warn([
        `[StoryCircleGate] Episode ${input.episodeNumber} Story Circle advisory finding(s):`,
        ...storyCircleWarnings.map((issue) => `- ${issue.message}`),
      ].join('\n'));
    }

    // Check scene count
    if (blueprint.scenes.length < 3) {
      throw new Error('Blueprint must have at least 3 scenes');
    }
    const effectiveTargetSceneCount = this.effectiveTargetSceneCount(blueprint, input);
    if (blueprint.scenes.length > effectiveTargetSceneCount) {
      const binderSplitExtension = effectiveTargetSceneCount - input.targetSceneCount;
      const capDetail = binderSplitExtension > 0
        ? ` (${input.targetSceneCount} base + ${binderSplitExtension} binder-split helper scene${binderSplitExtension === 1 ? '' : 's'})`
        : '';
      throw new Error(`Blueprint must have no more than ${effectiveTargetSceneCount} scenes${capDetail}`);
    }

    // Check starting scene exists
    const startingScene = blueprint.scenes.find(s => s.id === blueprint.startingSceneId);
    if (!startingScene) {
      throw new Error(`Starting scene ${blueprint.startingSceneId} not found in scenes`);
    }

    // Check all leadsTo references are valid
    const sceneIds = new Set(blueprint.scenes.map(s => s.id));
    for (const scene of blueprint.scenes) {
      for (const targetId of scene.leadsTo) {
        if (!sceneIds.has(targetId)) {
          throw new Error(`Scene ${scene.id} references non-existent scene ${targetId}`);
        }
      }
    }

    // Check bottleneck scenes exist
    for (const bottleneckId of blueprint.bottleneckScenes) {
      if (!sceneIds.has(bottleneckId)) {
        throw new Error(`Bottleneck scene ${bottleneckId} not found in scenes`);
      }
    }

    // Check major choices have stakes
    const majorChoices = blueprint.scenes.filter(
      s => s.choicePoint && (s.choicePoint.branches || s.choicePoint.type === 'dilemma')
    );

    // Major choices must carry stakes, a consequenceDomain, and a reminderPlan.
    // The LLM intermittently omits one of these, so REPAIR the missing field in
    // place rather than aborting the whole episode (F6/F7 — same ship-with-
    // recorded-defaults pattern as the rest of the audit work). The architect
    // already defaults these in other paths; this is the validation-time
    // backstop. See docs/PROJECT_AUDIT_2026-05-28.md.
    for (const scene of majorChoices) {
      const cp = scene.choicePoint!;

      // (1) Incomplete stakes — fill the missing want/cost/identity sub-field.
      const stakes = (cp.stakes ||= { want: '', cost: '', identity: '' });
      if (!stakes.want || !stakes.cost || !stakes.identity) {
        const missing: string[] = [];
        if (!stakes.want) { stakes.want = 'Pursue what the protagonist most wants from this moment.'; missing.push('want'); }
        if (!stakes.cost) { stakes.cost = 'Risk something the protagonist would rather not lose.'; missing.push('cost'); }
        if (!stakes.identity) { stakes.identity = 'Reveal who the protagonist chooses to be under pressure.'; missing.push('identity'); }
        console.warn(`[StoryArchitect] Scene ${scene.id} major choice had incomplete stakes; filled defaults for: ${missing.join(', ')}.`);
      }

      // (2) Missing consequenceDomain — infer from the choice's own stakes.
      if (!cp.consequenceDomain) {
        const pressure = [cp.stakes?.want, cp.stakes?.cost, cp.stakes?.identity, cp.description]
          .filter(Boolean)
          .join(' ');
        cp.consequenceDomain = this.inferChoiceConsequenceDomain(
          pressure,
          input.seasonPlanDirectives?.treatmentGuidance,
        );
        console.warn(`[StoryArchitect] Scene ${scene.id} major choice missing consequenceDomain; inferred '${cp.consequenceDomain}'.`);
      }

      // (3) Missing/partial reminderPlan — fill the established defaults.
      if (!cp.reminderPlan?.immediate || !cp.reminderPlan?.shortTerm) {
        cp.reminderPlan = {
          immediate: cp.reminderPlan?.immediate || 'A silence opens where the answer used to be.',
          shortTerm: cp.reminderPlan?.shortTerm || 'The next room has to move around what just changed.',
        };
        console.warn(`[StoryArchitect] Scene ${scene.id} major choice missing reminderPlan; filled defaults.`);
      }
    }

    if (this.sceneGraphBranching.required && !this.sceneGraphBranching.allowLinearBottleneckEpisodes) {
      const validBranchPointCount = blueprint.scenes.filter(scene =>
        scene.choicePoint?.branches &&
        scene.choicePoint.type !== 'expression' &&
        new Set(scene.leadsTo || []).size >= 2
      ).length;
      // Cap by feasibility so a raised default floor never throws on a graph too
      // small to carry it (repairSceneGraphBranchCoverage is bounded the same way).
      const requiredBranches = Math.min(
        this.effectiveMinBranchesPerEpisode(blueprint.scenes.length),
        this.feasibleBranchSlotCount(blueprint.scenes),
      );
      if (validBranchPointCount < requiredBranches) {
        throw new Error(
          `Insufficient scene-graph branching: ${validBranchPointCount}/${requiredBranches} valid branch point(s). ` +
          `At least one non-expression choicePoint must set branches=true and lead to 2+ distinct future scenes.`
        );
      }
    }

    this.repairPlannedEncounterCoverage(blueprint, input);
    this.hydrateIncompleteEncounterContracts(blueprint, input);

    const encounterScenes = blueprint.scenes.filter(scene => scene.isEncounter);
    const minEncounters = this.getMinEncountersForBlueprint(blueprint.scenes.length, input);
    if (encounterScenes.length < minEncounters) {
      throw new Error(
        `Blueprint only defines ${encounterScenes.length} encounter scene(s); expected at least ${minEncounters}`
      );
    }
    for (const scene of encounterScenes) {
      if (!scene.encounterDescription?.trim()) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterDescription`);
      }
      if (!scene.encounterDifficulty) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterDifficulty`);
      }
      if (!scene.encounterBuildup?.trim()) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterBuildup`);
      }
      if (!scene.encounterStakes?.trim()) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterStakes`);
      }
      if (!scene.encounterRelevantSkills || scene.encounterRelevantSkills.length === 0) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterRelevantSkills`);
      }
      if (!scene.encounterBeatPlan || scene.encounterBeatPlan.length < 3) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterBeatPlan with at least 3 beats`);
      }
      if (!scene.encounterType) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterType (must be one of: combat, chase, stealth, social, romantic, dramatic, puzzle, exploration, investigation, negotiation, survival, heist, mixed)`);
      }
      if (!isEncounterStoryCircleTarget(scene.encounterStoryCircleTarget)) {
        scene.encounterStoryCircleTarget = normalizeEncounterStoryCircleTarget(
          scene.encounterStoryCircleTarget,
          blueprint.storyCircleRole,
          [
            scene.encounterDescription,
            scene.encounterStakes,
            scene.encounterCentralConflict,
            scene.description,
          ].filter(Boolean).join(' '),
        );
        scene.encounterStoryCircleTargetRationale = scene.encounterStoryCircleTargetRationale
          || buildEncounterStoryCircleTargetRationale(
            scene.encounterStoryCircleTarget,
            blueprint.storyCircleRole,
            scene.encounterDescription || scene.description,
          );
      }
    }
    this.validatePlannedEncounterCoverage(blueprint, input);
    const treatmentIssues = this.collectTreatmentFidelityIssues(blueprint, input);
    if (treatmentIssues.length > 0) {
      throw new Error(treatmentIssues.join('\n'));
    }
    const dramaticStructureIssues = this.collectDramaticStructureIssues(blueprint, input, true);
    if (dramaticStructureIssues.length > 0) {
      throw new Error(dramaticStructureIssues.join('\n'));
    }
    const themePressureIssues = this.collectThemePressureIssues(blueprint, true);
    if (themePressureIssues.length > 0) {
      throw new Error(themePressureIssues.join('\n'));
    }
    const sceneTurnContractIssues = this.collectSceneTurnContractIssues(blueprint, true);
    if (sceneTurnContractIssues.length > 0) {
      throw new Error(sceneTurnContractIssues.join('\n'));
    }
    const episodePressureIssues = this.collectEpisodePressureIssues(blueprint, input, true);
    if (episodePressureIssues.length > 0) {
      throw new Error(episodePressureIssues.join('\n'));
    }

    // === CHOICE DENSITY VALIDATION ===
    // This is critical for interactive fiction - stories without choices aren't interactive
    // But we also respect branch-and-bottleneck architecture where bottlenecks may be passive

    const scenesWithChoices = blueprint.scenes.filter(s => s.choicePoint);
    const choiceDensity = scenesWithChoices.length / blueprint.scenes.length;

    // Rule 1: At least 40% of scenes must have choice points (allows for bottleneck pattern)
    if (choiceDensity < 0.4) {
      console.warn(`[StoryArchitect] Low choice density: ${Math.round(choiceDensity * 100)}% of scenes have choices`);
      throw new Error(
        `Insufficient choice density: only ${scenesWithChoices.length}/${blueprint.scenes.length} scenes have choice points. ` +
        `Interactive fiction requires at least 40% of scenes to have player choices.`
      );
    }

    // Rule 2: Season-opening player agency. Episode 1 establishes the
    // season's playable contract, so the starting scene itself must include
    // a choice. Later episodes keep the existing "brief opening into
    // second-scene choice" flexibility.
    // Encounter scenes carry their player choices internally, so they satisfy
    // early-agency rules without a standalone choicePoint (the elaborate-mode
    // materializer never gives encounters one by design).
    const firstScene = blueprint.scenes.find(s => s.id === blueprint.startingSceneId);
    const firstSceneHasAgency = Boolean(firstScene?.choicePoint || firstScene?.isEncounter);
    if (firstScene && this.isFirstSeasonEpisode(input) && !firstSceneHasAgency) {
      console.warn(`[StoryArchitect] First scene of episode 1 has no choice point`);
      throw new Error(
        `First scene "${firstScene.name}" has no choicePoint. ` +
        `The first scene of the first episode of each season must include a player choice.`
      );
    }

    if (firstScene && !this.isFirstSeasonEpisode(input) && !firstSceneHasAgency) {
      // First scene doesn't have a choice - check if second scene does
      const secondSceneIds = firstScene.leadsTo;
      const secondScenes = secondSceneIds.map(id => blueprint.scenes.find(s => s.id === id)).filter(Boolean);
      const secondSceneHasChoice = secondScenes.some(s => s?.choicePoint || s?.isEncounter);

      if (!secondSceneHasChoice) {
        console.warn(`[StoryArchitect] Neither first nor second scene has a choice point`);
        throw new Error(
          `First scene "${firstScene.name}" has no choicePoint and neither do its follow-up scenes. ` +
          `Players need agency early - add a choice to the first or second scene.`
        );
      } else {
        console.log(`[StoryArchitect] First scene is a bottleneck, but second scene has choice - OK`);
      }
    }

    // Rule 3: No more than 2 consecutive scenes without choices
    // Build the scene graph and check paths
    const sceneMap = new Map(blueprint.scenes.map(s => [s.id, s]));
    const visited = new Set<string>();

    const checkConsecutiveNonChoice = (sceneId: string, nonChoiceStreak: number): void => {
      if (visited.has(sceneId)) return;
      visited.add(sceneId);

      const scene = sceneMap.get(sceneId);
      if (!scene) return;

      // Encounter scenes carry their player choice inside the encounter beats,
      // so they break a passive-scene run even without a standalone choicePoint.
      const currentStreak = scene.choicePoint || scene.isEncounter ? 0 : nonChoiceStreak + 1;

      if (currentStreak > 2) {
        console.warn(`[StoryArchitect] Scene "${scene.id}" is part of a ${currentStreak}-scene stretch without choices`);
        throw new Error(
          `Too many consecutive scenes without choices. Scene "${scene.name}" is part of a ${currentStreak}-scene stretch ` +
          `without player agency. Maximum allowed is 2 scenes between choices.`
        );
      }

      for (const nextId of scene.leadsTo) {
        checkConsecutiveNonChoice(nextId, currentStreak);
      }
    };

    // Start from the first scene
    if (firstScene) {
      checkConsecutiveNonChoice(firstScene.id, 0);
    }

    console.log(`[StoryArchitect] Choice density validation passed: ${scenesWithChoices.length}/${blueprint.scenes.length} scenes have choices (${Math.round(choiceDensity * 100)}%)`);
  }

  private repairSceneTransitions(blueprint: EpisodeBlueprint): void {
    const scenes = blueprint.scenes || [];
    const sceneMap = new Map(scenes.map((scene, index) => [scene.id, { scene, index }]));

    for (const [index, scene] of scenes.entries()) {
      const leadsTo = Array.isArray(scene.leadsTo) ? scene.leadsTo : [];
      const existingTransitions = Array.isArray(scene.transitionOut)
        ? scene.transitionOut
        : scene.transitionOut
          ? [scene.transitionOut as unknown as SceneTransitionOut]
          : [];
      const transitionByTarget = new Map(
        existingTransitions
          .filter((transition) => transition?.toSceneId)
          .map((transition) => [transition.toSceneId, transition])
      );

      scene.transitionOut = leadsTo.map((toSceneId, leadIndex) => {
        const existing = transitionByTarget.get(toSceneId);
        const target = sceneMap.get(toSceneId);
        const connector = existing?.connector === 'therefore' || existing?.connector === 'but'
          ? existing.connector
          : this.inferTransitionConnector(scene, target?.index ?? index + leadIndex + 1, index, leadIndex);

        return {
          toSceneId,
          connector,
          causalLink: this.pickBlueprintText(
            existing?.causalLink,
            this.buildTransitionCausalLink(scene, target?.scene, connector),
          ),
          pressureChange: this.pickBlueprintText(
            existing?.pressureChange,
            this.buildTransitionPressureChange(scene, target?.scene, connector),
          ),
        };
      });
    }
  }

  private inferTransitionConnector(
    scene: SceneBlueprint,
    targetIndex: number,
    sceneIndex: number,
    leadIndex: number
  ): 'therefore' | 'but' {
    if (leadIndex > 0 || scene.choicePoint?.branches) return 'but';
    if (targetIndex > sceneIndex + 1) return 'but';
    return 'therefore';
  }

  private buildTransitionCausalLink(
    scene: SceneBlueprint,
    target: SceneBlueprint | undefined,
    connector: 'therefore' | 'but'
  ): string {
    const sceneChange = this.pickBlueprintText(
      scene.dramaticStructure?.changedState,
      scene.residue?.[0]?.description,
      scene.choicePoint?.description,
      scene.keyBeats?.[scene.keyBeats.length - 1],
      scene.narrativeFunction,
      scene.description,
    );
    const targetPressure = this.pickBlueprintText(
      target?.dramaticQuestion,
      target?.conflictEngine,
      target?.description,
      target?.name,
      'the next scene',
    );
    const connectorText = connector === 'but'
      ? 'that result creates a complication'
      : 'that result makes the next pressure necessary';
    return `${scene.name} changes the situation: ${sceneChange}. ${connectorText}, driving ${target?.name || 'the next scene'}: ${targetPressure}`;
  }

  private buildTransitionPressureChange(
    scene: SceneBlueprint,
    target: SceneBlueprint | undefined,
    connector: 'therefore' | 'but'
  ): string {
    const pressureBeat = scene.keyBeats?.find((beat) =>
      /\b(peak|cost|choice|pressure|risk|danger|reveal|turn)\b/i.test(beat)
    );
    // Skip the choice-point cost when it is still StoryArchitect's placeholder sentinel
    // ("Each option forfeits a different advantage.") — otherwise the placeholder leaks
    // into real pressureChange prose ("…escalates into…"). See constants/placeholderStakes.ts.
    const choiceCost = scene.choicePoint?.stakes?.cost;
    const fromPressure = this.pickBlueprintText(
      scene.dramaticStructure?.pressurePeak,
      isPlaceholderStake(choiceCost) ? undefined : choiceCost,
      scene.personalStake,
      scene.conflictEngine,
      pressureBeat,
      scene.name,
    );
    const toPressure = this.pickBlueprintText(
      target?.conflictEngine,
      target?.dramaticQuestion,
      target?.personalStake,
      target?.narrativeFunction,
      target?.name,
      'a sharper problem',
    );
    const verb = connector === 'but' ? 'reverses into' : 'escalates into';
    return `${fromPressure} ${verb} ${toPressure}.`;
  }

  /**
   * Deterministic craft-gate repairs (repair-first). Observed live: the
   * architecture craft gate aborted the episode on (a) residue typed with a
   * non-enum alias ("flags") and (b) a missing pressurePeak — both fixable in
   * place without burning an LLM retry.
   */
  private repairDramaticStructureCraft(blueprint: EpisodeBlueprint): void {
    const residueAliases: Record<string, ResidueType> = {
      flag: 'information',
      flags: 'information',
      state: 'information',
      state_change: 'information',
      knowledge: 'information',
      info: 'information',
      secret: 'information',
      trust: 'relationship',
      bond: 'relationship',
      injury: 'wound',
      threat: 'danger',
      item: 'resource',
      object: 'resource',
      obligation: 'promise',
      debt: 'promise',
      standing: 'reputation',
      status: 'reputation',
      entry: 'access',
      key: 'access',
    };
    for (const scene of blueprint.scenes || []) {
      for (const item of scene.residue || []) {
        const alias = residueAliases[String(item?.type ?? '').toLowerCase().trim()];
        if (alias) {
          console.log(`[StoryArchitect] Normalized residue type "${item.type}" -> "${alias}" on ${scene.id}`);
          item.type = alias;
        }
      }
      // Mirror DramaticStructureValidator.hasText: a whole-value placeholder
      // ("TBD", "none") is as good as missing.
      const craftText = (value?: string): string => {
        const text = (value || '').trim();
        return /^(?:tbd|none|n\/a|unknown|placeholder|not specified)[.!?…-]*$/i.test(text) ? '' : text;
      };
      const firstOf = (...values: Array<string | undefined>): string | undefined =>
        values.map(craftText).find(Boolean);
      const ds = scene.dramaticStructure;
      if (ds) {
        const residueDescription = (scene.residue || [])
          .map((item) => (item?.description || '').trim())
          .find(Boolean);
        const fills: Array<[keyof typeof ds, string | undefined]> = [
          ['question', firstOf(scene.dramaticQuestion, ds.turn)],
          ['turn', firstOf(ds.pressurePeak, ds.changedState)],
          ['pressurePeak', firstOf(ds.turn, ds.changedState, ds.question)],
          ['changedState', firstOf(residueDescription, ds.turn, ds.pressurePeak)],
        ];
        for (const [field, fallback] of fills) {
          if (!craftText(ds[field]) && fallback) {
            ds[field] = fallback;
            console.log(`[StoryArchitect] Defaulted missing dramaticStructure.${String(field)} on ${scene.id}`);
          }
        }
      }
      // Residue entries with a type but no description are another observed
      // micro-omission: fill from the scene's changed state, then drop any
      // entry that still says nothing (backstopping the list if that empties it).
      if (Array.isArray(scene.residue) && scene.residue.length > 0) {
        const residueFallback = firstOf(ds?.changedState, ds?.turn, scene.dramaticQuestion);
        for (const item of scene.residue) {
          if (item && !craftText(item.description) && residueFallback) {
            item.description = residueFallback;
            console.log(`[StoryArchitect] Filled empty residue description on ${scene.id} from the scene's changed state`);
          }
        }
        const kept = scene.residue.filter((item) => craftText(item?.description));
        if (kept.length !== scene.residue.length) {
          console.log(`[StoryArchitect] Dropped ${scene.residue.length - kept.length} empty residue entr(ies) on ${scene.id}`);
          scene.residue = kept.length > 0 || !residueFallback
            ? kept
            : [{ type: 'information', description: residueFallback }];
        }
      }
    }
  }

  private repairSceneTurnContracts(blueprint: EpisodeBlueprint): void {
    for (const scene of blueprint.scenes || []) {
      scene.keyBeats = Array.isArray(scene.keyBeats) ? scene.keyBeats : [];

      if (!scene.choicePoint && !this.sceneHasForcedDecision(scene)) {
        const forcedReaction = this.buildForcedReactionText(scene);
        if (!scene.keyBeats.some((beat) => beat.includes(forcedReaction))) {
          scene.keyBeats.push(`PEAK: ${forcedReaction}`);
        }

        scene.dramaticStructure = {
          question: scene.dramaticStructure?.question || scene.dramaticQuestion || `What changes in ${scene.name}?`,
          turn: scene.dramaticStructure?.turn || scene.conflictEngine || scene.keyBeats[0] || forcedReaction,
          pressurePeak: this.pickBlueprintText(scene.dramaticStructure?.pressurePeak, forcedReaction),
          changedState: this.pickBlueprintText(
            scene.dramaticStructure?.changedState,
            `${scene.name} leaves the protagonist committed to a changed course because ${forcedReaction}`,
          ),
        };

        scene.residue = Array.isArray(scene.residue) ? scene.residue : [];
        if (!scene.residue.some((residue) => residue.description?.includes(forcedReaction))) {
          scene.residue.push({
            type: 'danger',
            description: forcedReaction,
          });
        }
      }

      if ((scene.npcsPresent?.length || scene.encounterRequiredNpcIds?.length) && !this.sceneHasPowerShift(scene)) {
        const powerShift = this.buildPowerShiftText(scene);
        if (!scene.keyBeats.some((beat) => beat.includes(powerShift))) {
          scene.keyBeats.push(`PEAK: ${powerShift}`);
        }
        scene.dramaticStructure = {
          question: scene.dramaticStructure?.question || scene.dramaticQuestion || `What changes in ${scene.name}?`,
          turn: this.pickBlueprintText(scene.dramaticStructure?.turn, powerShift),
          pressurePeak: this.pickBlueprintText(scene.dramaticStructure?.pressurePeak, powerShift),
          changedState: this.pickBlueprintText(scene.dramaticStructure?.changedState, powerShift),
        };
        scene.residue = Array.isArray(scene.residue) ? scene.residue : [];
        if (!scene.residue.some((residue) => residue.description?.includes(powerShift))) {
          scene.residue.push({
            type: 'relationship',
            description: powerShift,
          });
        }
      }
    }
  }

  private sceneHasForcedDecision(scene: SceneBlueprint): boolean {
    const text = [
      scene.dramaticStructure?.pressurePeak,
      scene.dramaticStructure?.changedState,
      scene.sequenceIntent?.turningPoint,
      ...(scene.keyBeats || []),
      ...(scene.transitionOut || []).flatMap((transition) => [transition.causalLink, transition.pressureChange]),
      ...(scene.residue || []).map((residue) => residue.description),
    ].filter(Boolean).join(' ');
    return /\b(decide|decides|decision|choose|chooses|choice|chose|commit|commits|commitment|refuse|refuses|refusal|accept|accepts|reject|rejects|reveal|reveals|hide|hides|sacrifice|sacrifices|tradeoff|trade-off|risk|risks|betray|betrays|trust|trusts|confront|confronts|promise|promises|confess|confesses|answer|answers|must|cannot|can no longer|turns toward|turns away|irreversible)\b/i.test(text);
  }

  private sceneHasPowerShift(scene: SceneBlueprint): boolean {
    const text = [
      scene.dramaticStructure?.turn,
      scene.dramaticStructure?.pressurePeak,
      scene.dramaticStructure?.changedState,
      scene.sequenceIntent?.turningPoint,
      scene.sequenceIntent?.endState,
      scene.choicePoint?.description,
      scene.choicePoint?.stakes?.cost,
      scene.choicePoint?.stakes?.identity,
      scene.encounterDescription,
      scene.encounterStakes,
      ...(scene.keyBeats || []),
      ...(scene.residue || []).map((residue) => residue.description),
    ].filter(Boolean).join(' ');
    return /\b(power|upper hand|advantage|leverage|status|control|pressure|dominance|vulnerab\w*|expos\w*|corner\w*|accus\w*|challenge\w*|confront\w*|threat\w*|blackmail|humiliat\w*|trust|mistrust|betray\w*|alliance|distance|closer|withdraw\w*|submit\w*|yield\w*|defy|defies|refus\w*|authority|permission|debt|favor|owes?|credibility|reputation|silence|voice|public|private)\b/i.test(text);
  }

  private buildForcedReactionText(scene: SceneBlueprint): string {
    const pressure = this.pickBlueprintText(
      scene.dramaticStructure?.pressurePeak,
      scene.conflictEngine,
      scene.personalStake,
      scene.keyBeats?.[scene.keyBeats.length - 1],
      scene.description,
      scene.name,
    );
    const target = this.pickBlueprintText(
      scene.dramaticQuestion,
      scene.wantVsNeed,
      scene.narrativeFunction,
      'what the pressure means now',
    );
    return `The pressure forces an irreversible reaction: the protagonist must commit, refuse, reveal, or accept a cost around ${target}; ${pressure}`;
  }

  private buildPowerShiftText(scene: SceneBlueprint): string {
    const pressure = this.pickBlueprintText(
      scene.conflictEngine,
      scene.dramaticStructure?.pressurePeak,
      scene.personalStake,
      scene.description,
      scene.name,
    );
    const relationship = this.pickBlueprintText(
      scene.wantVsNeed,
      scene.dramaticQuestion,
      scene.narrativeFunction,
      'the relationship pressure in the scene',
    );
    return `The power dynamic shifts: trust, leverage, or vulnerability changes hands around ${relationship}; ${pressure}`;
  }

  private collectTreatmentFidelityIssues(blueprint: EpisodeBlueprint, input: StoryArchitectInput): string[] {
    const result = new TreatmentFidelityValidator().validate({
      blueprint,
      treatmentGuidance: input.seasonPlanDirectives?.treatmentGuidance,
      cliffhangerPlan: input.cliffhangerPlan,
      plannedEncounters: input.seasonPlanDirectives?.plannedEncounters,
    });
    return result.issues;
  }

  private collectBlueprintHygieneIssues(blueprint: EpisodeBlueprint): string[] {
    const result = new BlueprintContractHygieneValidator().validate(blueprint);
    return result.blockingIssues.map((issue) =>
      `[BlueprintContractHygiene] ${issue.message} (${issue.path}${issue.sceneId ? ` scene=${issue.sceneId}` : ''}) "${issue.excerpt}"`
    );
  }

  private collectDramaticStructureIssues(
    blueprint: EpisodeBlueprint,
    _input: StoryArchitectInput,
    logWarnings: boolean
  ): string[] {
    const result = new DramaticStructureValidator().validate(blueprint, {
      requireSceneLevelMetadata: true,
    });

    if (logWarnings) {
      for (const issue of result.issues) {
        if (issue.severity === 'warning') {
          console.warn(`[StoryArchitect][P1-P8] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
        }
      }
    }

    return result.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `[DramaticStructure] ${issue.message}${issue.location ? ` (${issue.location})` : ''}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
  }

  private collectThemePressureIssues(
    blueprint: EpisodeBlueprint,
    logWarnings: boolean
  ): string[] {
    const result = new ThemePressureValidator().validate(blueprint);

    if (logWarnings) {
      for (const issue of result.issues) {
        if (issue.severity === 'warning') {
          console.warn(`[StoryArchitect][Theme] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
        }
      }
    }

    return result.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `[ThemePressure] ${issue.message}${issue.location ? ` (${issue.location})` : ''}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
  }

  private collectSceneTurnContractIssues(
    blueprint: EpisodeBlueprint,
    logWarnings: boolean
  ): string[] {
    const result = new SceneTurnContractValidator().validate(blueprint);

    if (logWarnings) {
      for (const issue of result.issues) {
        if (issue.severity === 'warning') {
          console.warn(`[StoryArchitect][SceneTurn] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
        }
      }
    }

    return result.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `[SceneTurnContract] ${issue.message}${issue.location ? ` (${issue.location})` : ''}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
  }

  private collectEpisodePressureIssues(
    blueprint: EpisodeBlueprint,
    input: StoryArchitectInput,
    logWarnings: boolean
  ): string[] {
    const roleBeats = storyCircleRoleBeats(input.episodeStoryCircleRole);
    const isFinale = Boolean(
      roleBeats.includes('change') ||
      input.cliffhangerPlan?.storyCircleLaunchBeat === 'change'
    );
    const result = new EpisodePressureArchitectureValidator().validate(blueprint, {
      isFinale,
      targetSceneCount: input.targetSceneCount,
    });

    if (logWarnings) {
      for (const issue of result.issues) {
        if (issue.severity === 'warning') {
          console.warn(`[StoryArchitect][EpisodePressure] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
        }
      }
    }

    return result.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `[EpisodePressure] ${issue.message}${issue.location ? ` (${issue.location})` : ''}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
  }
}
