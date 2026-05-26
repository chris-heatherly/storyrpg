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
   * Planning-only ledger for major secrets, threats, mysteries, reveals, and
   * payoff questions. Runtime remains fiction-first; this prevents accidental
   * early reveals, unsupported surprises, and unresolved question sprawl.
   */
  informationLedger?: InformationLedgerEntry[];

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
  
  // === ENCOUNTER MASTER PLAN ===
  // All encounters across the season, planned at the season level
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
