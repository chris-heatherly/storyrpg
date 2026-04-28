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
} from './sourceAnalysis';

// ========================================
// SEASON PLAN CORE TYPES
// ========================================

export type EpisodeStatus = 'planned' | 'selected' | 'in_progress' | 'completed' | 'skipped';

export interface SeasonEpisode extends EpisodeOutline {
  // Generation status
  status: EpisodeStatus;
  
  // Generated episode ID (once created)
  generatedEpisodeId?: string;
  generatedStoryId?: string;
  
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
  // Status based on episode completion
  status: 'not_started' | 'in_progress' | 'completed';
  completionPercentage: number;
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
