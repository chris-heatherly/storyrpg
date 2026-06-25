/**
 * Season Plan Types
 *
 * Types for persistent season plans that track episode generation
 * and allow resuming generation later.
 */

import {
  EpisodeOutline,
  SourceMaterialAnalysis,
  StoryArc,
  PlotPoint,
  CrossEpisodeBranch,
  ConsequenceChain,
  PlannedEncounter,
  EndingMode,
  StoryEndingTarget,
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
  CharacterArchitecture,
} from './sourceAnalysis';
import type { CliffhangerType } from './story';
import type { EpisodeRouteMeta, EpisodeStructureMode } from './story';
import type { ConditionExpression } from './conditions';
import type {
  ArcPressureTreatmentContract,
  BranchConsequenceRealizationContract,
  CharacterTreatmentRealizationContract,
  EndingRealizationContract,
  FailureModeAuditContract,
  PlannedScene,
  SeasonPromiseRealizationContract,
  SeasonScenePlan,
  SevenPointBeatRealizationContract,
  StakesArchitectureContract,
  WorldTreatmentRealizationContract,
} from './scenePlan';

// ========================================
// SEASON PLAN CORE TYPES
// ========================================

export type EpisodeStatus = 'planned' | 'selected' | 'in_progress' | 'completed' | 'skipped';

export type CliffhangerIntensity = 'low' | 'medium' | 'high';

export interface CliffhangerPlan {
  type: CliffhangerType;
  intensity: CliffhangerIntensity;
  hook: string;
  setup: string;
  resolvedEpisodeTension: string;
  newOpenQuestion: string;
  emotionalCharge: string;
  nextEpisodePressure: string;
  mappedStructuralRole: StructuralRole;
  style: 'serialized_tv';
}

export interface SeasonEpisode extends EpisodeOutline {
  episodeStructureMode?: EpisodeStructureMode;
  routeMeta?: EpisodeRouteMeta;
  unlockConditions?: ConditionExpression;

  // Generation status
  status: EpisodeStatus;
  
  // Generated episode ID (once created)
  generatedEpisodeId?: string;
  generatedStoryId?: string;
  generatedJobId?: string;
  outputDir?: string;
  
  // Generation metadata
  generatedAt?: Date;
  generationDurationMs?: number;
  
  // Dependencies (episodes that should be generated first)
  dependsOn: number[];  // Episode numbers this depends on
  
  // Story continuity
  setupsForEpisodes: number[];  // Episodes this sets up
  resolvesPlotsFrom: number[]; // Episodes whose plots this resolves
  
  // Character introductions in this episode
  introducesCharacters: string[];
  
  // Selection metadata
  selectedAt?: Date;
  selectedBy?: 'user' | 'recommendation';
  endingRoutes?: Array<{
    endingId: string;
    role: 'opens' | 'reinforces' | 'threatens' | 'locks';
    description: string;
  }>;

  /**
   * Episode-ending contract. Non-finale episodes should resolve the immediate
   * episode tension enough to satisfy, then open sharper next-episode pressure.
   */
  cliffhangerPlan?: CliffhangerPlan;

  /**
   * Scene-first plan: the scenes that make up this episode, enumerated at the
   * SEASON level (not invented per-episode in StoryArchitect). This is this
   * episode's slice of {@link SeasonPlan.scenePlan}. Encounters appear here as
   * scenes with `kind: 'encounter'` — they are not a separate list. Optional so
   * legacy plans that predate scene-first planning still deserialize; when
   * absent, downstream falls back to per-episode scene invention.
   */
  plannedScenes?: PlannedScene[];

  /** Planned residue obligations this episode is responsible for paying off. */
  incomingResidueIds?: string[];
  /** Planned residue obligations this episode is responsible for creating. */
  outgoingResidueIds?: string[];
}

export type ArcEpisodeTurnoutType =
  | 'setup'
  | 'escalation'
  | 'reversal'
  | 'revelation'
  | 'cost'
  | 'choice'
  | 'recontextualization'
  | 'crisis'
  | 'finale'
  | 'handoff';

export interface ArcEpisodeTurnout {
  episodeNumber: number;
  turnType: ArcEpisodeTurnoutType;
  description: string;
  leavesProtagonistWith: string;
  whyThisCannotMoveLater: string;
}

export interface SeasonArc {
  id: string;
  name: string;
  description: string;
  episodeRange: {
    start: number;
    end: number;
  };
  // Key moments in this arc
  keyMoments: Array<{
    episodeNumber: number;
    description: string;
    importance: 'critical' | 'major' | 'minor';
  }>;
  /**
   * Which 7-point structural beats this arc is responsible for landing.
   * Optional so legacy plans that predate Path A still deserialize cleanly.
   * Populated by SeasonPlannerAgent from the season's sevenPoint map + the
   * per-episode structuralRole assignments that fall inside episodeRange.
   */
  beats?: StructuralRole[];
  /**
   * Arc pressure architecture.
   *
   * An arc is a 3-8 episode pressure movement inside the season, not a
   * competing act schema. The season 7-point spine remains authoritative;
   * these fields explain how the episodes inside this arc turn, reframe,
   * collapse, resolve, and hand off pressure without resetting.
   */
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
  episodeTurnouts?: ArcEpisodeTurnout[];
  // Status based on episode completion
  status: 'not_started' | 'in_progress' | 'completed';
  completionPercentage: number;
}

export type SeasonCentralPressureType =
  | 'person'
  | 'institution'
  | 'mystery'
  | 'environment'
  | 'relationship'
  | 'internal'
  | 'situation';

export interface SeasonPromiseArchitecture {
  /**
   * One season-level dramatic question that fuses the protagonist pressure
   * with the season goal/stakes. This complements theme and arc questions;
   * it does not replace the seven-point spine.
   */
  seasonDramaticQuestion: string;
  centralPressure: {
    type: SeasonCentralPressureType;
    description: string;
    pressuresLieBy: string;
  };
  seasonPromise: {
    premisePromise: string;
    playerExperiencePromise: string;
    emotionalPromise: string;
    variationPlan: string[];
  };
  seasonCompleteness: {
    resolvedQuestion: string;
    resolvedStakes: string;
    characterStateChange: string;
    openFuturePressure?: string;
  };
}

export type AudienceKnowledgeState = 'shared' | 'withheld' | 'selective';

export type InformationTensionMode =
  | 'suspense'
  | 'mystery'
  | 'dramatic_irony'
  | 'surprise'
  | 'revelation'
  | 'foreshadowing';

export type InformationKnowledgeHolder =
  | 'player'
  | 'protagonist'
  | 'ally'
  | 'antagonist'
  | 'world';

export type InformationLedgerPhase = 'setup' | 'reveal' | 'payoff';

export interface InformationFactualAtom {
  id: string;
  text: string;
  phase: InformationLedgerPhase;
  blockingLevel?: 'treatment' | 'structural' | 'warning';
}

export interface InformationNamedKnowledge {
  knownByNames: string[];
  withheldFromNames?: string[];
  suspectByEpisode?: Array<{
    characterName: string;
    episodeNumber: number;
    evidence?: string;
  }>;
}

export interface InformationKnowledgePhase {
  episodeNumber: number;
  audienceKnowledgeState: AudienceKnowledgeState;
  tensionMode: InformationTensionMode;
  allowedSurface: 'hint' | 'misread' | 'dramatic_irony' | 'confirmation' | 'revelation' | 'payoff';
}

export interface InformationSetupTouchDetail {
  episodeNumber: number;
  requiredSurface: string;
  atomIds?: string[];
}

export interface InformationLedgerEntry {
  id: string;
  label: string;
  description: string;
  audienceKnowledgeState: AudienceKnowledgeState;
  tensionMode: InformationTensionMode;
  knownBy: InformationKnowledgeHolder[];
  withheldFrom?: InformationKnowledgeHolder[];
  introducedEpisode: number;
  plannedRevealEpisode?: number;
  plannedPayoffEpisode?: number;
  setupTouchEpisodes: number[];
  payoffPlan: string;
  isBoxQuestion: boolean;
  closesQuestionIds?: string[];
  opensQuestionIds?: string[];
  /**
   * Generator-only authored-treatment metadata. These fields preserve the source
   * Section-6 obligation behind the compact information ledger entry so validators
   * can enforce setup/reveal/payoff realization without changing reader playback.
   */
  sourceText?: string;
  authoredId?: string;
  factualAtoms?: InformationFactualAtom[];
  namedKnowledge?: InformationNamedKnowledge;
  knowledgePhases?: InformationKnowledgePhase[];
  setupTouchDetails?: InformationSetupTouchDetail[];
}

/**
 * A season-level choice moment seed (E1 slice 4) — the planner's creative identification
 * of a decision point in the master narrative. Deterministic type-allocation + payoff
 * wiring happen downstream (seasonChoicePlan); this is just the LLM-authored seed.
 */
export interface SeasonChoiceMomentSeed {
  /** Stable id (slug-like). */
  id: string;
  /** Episode the decision is made in. */
  episode: number;
  /** What the decision is, tied to an arc / seven-point beat. */
  anchor: string;
  /** Episode the choice pays off. Omitted or === episode means it pays off immediately. */
  paysOffEpisode?: number;
  /** Optional flag the choice sets (seeds the promise / SpinePlantMap for later payoffs). */
  flag?: string;
}

export type ResidueObligationKind =
  | 'callback_line'
  | 'relationship_behavior'
  | 'information_recall'
  | 'item_or_prop'
  | 'reputation'
  | 'danger'
  | 'identity'
  | 'branch_reconvergence'
  | 'failure_residue'
  | 'ending_eligibility';

export type ResiduePayoffPolicy =
  | 'same_scene'
  | 'later_scene_same_episode'
  | 'specific_episode'
  | 'episode_window'
  | 'terminal_slice_ok';

export interface SeasonResidueObligation {
  id: string;
  source:
    | 'season_planner'
    | 'choice_moment'
    | 'branch_contract'
    | 'consequence_chain'
    | 'treatment_guidance'
    | 'deterministic_fallback';
  sourceEpisodeNumber: number;
  sourceSceneId?: string;
  sourceChoiceMomentId?: string;
  choiceAnchor: string;
  flag: string;
  conditionKey?: string;
  kind: ResidueObligationKind;
  consequenceDomain?: 'relationship' | 'reputation' | 'danger' | 'information' | 'identity' | 'leverage' | 'resource';
  payoffPolicy: ResiduePayoffPolicy;
  targetEpisodeNumbers: number[];
  targetSceneIds?: string[];
  targetNpcIds?: string[];
  targetTopics?: string[];
  treatmentContractIds?: string[];
  sourceMaterial: {
    choiceText?: string;
    reminderImmediate?: string;
    reminderShortTerm?: string;
    reminderLater?: string;
    feedbackEcho?: string;
    feedbackProgress?: string;
    residueHints?: string[];
    witnessReactions?: string[];
  };
  authoringGuidance: string;
  requiredSurface: Array<'beat_text' | 'text_variant' | 'choice_text' | 'dialogue' | 'encounter_outcome'>;
  priority: 'minor' | 'moderate' | 'major';
}

export interface SeasonPlan {
  // Unique identifier
  id: string;
  
  // Source material info
  sourceTitle: string;
  sourceAuthor?: string;
  
  // Creation metadata
  createdAt: Date;
  updatedAt: Date;
  analysisVersion: string;  // To detect if source analysis changed
  
  // Season overview
  seasonTitle: string;
  seasonSynopsis: string;
  totalEpisodes: number;
  estimatedTotalDuration: string;
  
  // Genre and tone (for consistency)
  genre: string;
  tone: string;
  themes: string[];
  
  // Story arcs spanning the season
  arcs: SeasonArc[];

  /**
   * Season-wide narrative anchors (stakes / goal / inciting incident / climax).
   * Mirrors SourceMaterialAnalysis.anchors so every agent downstream of
   * SeasonPlanner can access them without re-reading the analysis blob.
   */
  anchors: StoryAnchors;

  /**
   * Season-level 7-point beat map. Mirrors SourceMaterialAnalysis.sevenPoint
   * so downstream agents don't need the source analysis to look up the
   * textual description of a beat carried by a given episode.
   */
  sevenPoint: SevenPointStructure;

  /**
   * Season promise / completeness contract. This captures the useful part of
   * season-level TV rules without adding fixed episode-position formulas.
   */
  seasonPromiseArchitecture?: SeasonPromiseArchitecture;

  /**
   * Generator-only obligations derived from explicit top-level treatment
   * promises or, when absent, from SeasonPromiseArchitecture. Playback ignores
   * this; planning/writing/validation use it to make the promised show visible.
   */
  seasonPromiseContracts?: SeasonPromiseRealizationContract[];
  /**
   * Generator-only authored stakes architecture contracts. These preserve
   * Section 5 stakes as staged obligations while playback ignores them.
   */
  stakesArchitectureContracts?: StakesArchitectureContract[];
  /**
   * Generator-only authored 7-point beat realization contracts. These preserve
   * Section 7 beat content as staged obligations while playback ignores them.
   */
  sevenPointBeatContracts?: SevenPointBeatRealizationContract[];
  /**
   * Generator-only authored arc-pressure contracts. These preserve Arc Plan
   * fields as staged obligations while playback ignores them.
   */
  arcPressureContracts?: ArcPressureTreatmentContract[];
  /**
   * Generator-only authored cross-episode branch / consequence-chain contracts.
   * These preserve Section 11 branch semantics as staged obligations while
   * playback ignores them.
   */
  branchConsequenceContracts?: BranchConsequenceRealizationContract[];
  /**
   * Generator-only authored alternate-ending realization contracts. These
   * preserve Section 14 ending drivers and target conditions as route/finale
   * obligations while playback ignores them.
   */
  endingRealizationContracts?: EndingRealizationContract[];
  /**
   * Generator-only authored failure-mode audit contracts. These preserve
   * Section 15's concrete mitigation claims as staged obligations while
   * playback ignores them.
   */
  failureModeAuditContracts?: FailureModeAuditContract[];

  /**
   * Planning-only ledger for major secrets, threats, mysteries, reveals, and
   * payoff questions. Runtime remains fiction-first; this prevents accidental
   * early reveals, unsupported surprises, and unresolved question sprawl.
   */
  informationLedger?: InformationLedgerEntry[];

  /**
   * E1 slice 4: the season's CHOICE MOMENTS, identified up front by the planner
   * across the master narrative — each is a decision tied to an arc/seven-point beat,
   * with when it pays off (now or a later episode). Consumed by `seasonChoicePlan` to
   * allocate the 35/30/20/15 choice-type budget across the whole season (and later
   * payoffs seed promises / the SpinePlantMap). Optional — the consumer falls back to
   * a deterministic derivation when absent.
   */
  choiceMoments?: SeasonChoiceMomentSeed[];

  /**
   * First-class planned residue obligations. These are generator-facing only:
   * SeasonPlanner owns the contract, episode architecture assigns it, episode
   * authoring fulfills it, and validators audit it. Reader playback ignores
   * the metadata; every field is optional at package boundaries for back-compat.
   */
  residuePlan?: SeasonResidueObligation[];

  // Ending targets the season is steering toward
  endingMode: EndingMode;
  resolvedEndings: StoryEndingTarget[];
  
  // All episodes in the season
  episodes: SeasonEpisode[];
  
  // Generation progress
  progress: {
    selectedCount: number;
    completedCount: number;
    inProgressCount: number;
    percentComplete: number;
    lastGeneratedEpisode?: number;
    nextRecommendedEpisode?: number;
  };
  
  // Protagonist info (for consistency across episodes)
  protagonist: {
    id: string;
    name: string;
    description: string;
  };

  /**
   * Agent-facing character architecture that makes plot pressure personal.
   * Stored on the season plan so downstream agents can align arcs, episodes,
   * choices, and climax decisions without exposing mechanics to the player.
   */
  characterArchitecture?: CharacterArchitecture;
  /**
   * Generator-only authored protagonist/core-character contracts. Stored on the
   * season plan so planning, authoring, validation, and repair can trace
   * character fields beyond the compact Lie/Want/Need architecture.
   */
  characterTreatmentContracts?: CharacterTreatmentRealizationContract[];
  /**
   * Generator-only authored world/location contracts. These preserve setting
   * rules, factions, taboos, and per-location purpose/choice pressure as
   * traceable obligations while keeping reader playback unchanged.
   */
  worldTreatmentContracts?: WorldTreatmentRealizationContract[];
  
  // Character introduction order
  characterIntroductions: Array<{
    characterId: string;
    characterName: string;
    introducedInEpisode: number;
    role: string;
  }>;
  
  // Location introduction order
  locationIntroductions: Array<{
    locationId: string;
    locationName: string;
    introducedInEpisode: number;
  }>;
  
  /**
   * Scene-first season plan: every scene across the season, in order, with the
   * resolved setup/payoff graph. Episodes and their scenes are planned together
   * at the season level; each {@link SeasonEpisode.plannedScenes} is a slice of
   * this. Encounters live here as `kind: 'encounter'` scenes — the
   * {@link SeasonPlan.encounterPlan} below becomes a derived view over them and
   * is retired once the scene-first wiring lands. Optional so legacy plans
   * deserialize; absence signals the pre-scene-first (beat-first) path.
   */
  scenePlan?: SeasonScenePlan;

  // === ENCOUNTER MASTER PLAN ===
  // All encounters across the season, planned at the season level.
  // NOTE: superseded by scene-first planning — encounters are now `kind:
  // 'encounter'` scenes in `scenePlan`. Retained additively until the agent +
  // StoryArchitect wiring migrates onto the scene spine.
  encounterPlan: {
    // Total encounter count across the season
    totalEncounters: number;
    // Difficulty curve across episodes
    difficultyCurve: Array<{
      episodeNumber: number;
      difficulty: 'introduction' | 'rising' | 'peak' | 'falling' | 'finale';
      encounterCount: number;
    }>;
    // Types distribution across the season
    typeDistribution: Record<string, number>; // e.g., { combat: 5, social: 3, chase: 2 }
  };
  
  // === CROSS-EPISODE BRANCHING ===
  // Branches that span multiple episodes
  crossEpisodeBranches: CrossEpisodeBranch[];
  // Consequence chains that play out over multiple episodes
  consequenceChains: ConsequenceChain[];
  // Major story flags that carry between episodes
  seasonFlags: Array<{
    flag: string;
    description: string;
    setInEpisode: number;
    checkedInEpisodes: number[];
  }>;
  
  // User preferences for this season
  preferences: {
    targetScenesPerEpisode: number;
    targetChoicesPerEpisode: number;
    pacing: 'tight' | 'moderate' | 'expansive';
  };
  
  // Warnings or notes about the plan
  warnings: string[];
  notes: string[];
}

// ========================================
// SEASON PLAN STORE TYPES
// ========================================

export interface SavedSeasonPlan {
  plan: SeasonPlan;
  sourceAnalysis: SourceMaterialAnalysis;
}

export interface SeasonPlanSummary {
  id: string;
  sourceTitle: string;
  seasonTitle: string;
  totalEpisodes: number;
  completedEpisodes: number;
  lastUpdated: Date;
  status: 'new' | 'in_progress' | 'completed';
}

// ========================================
// EPISODE SELECTION TYPES
// ========================================

export interface EpisodeSelectionState {
  planId: string;
  selectedEpisodes: number[];  // Episode numbers selected for generation
  recommendedOrder: number[];  // Recommended generation order
  warnings: string[];  // Warnings about selection (e.g., "skipping episode 2 may cause continuity issues")
}

export interface EpisodeRecommendation {
  episodeNumber: number;
  reason: string;
  priority: 'must_generate' | 'recommended' | 'optional';
  dependencyChain: number[];  // Episodes that should be generated first
}
