// ========================================
// SCENE & EPISODE TYPES
// ========================================

import type { ConditionExpression } from './conditions';
import type { Consequence } from './consequences';
import type {
  PlayerAttributes,
  PlayerSkills,
  PlayerState,
  InventoryItem,
  Relationship,
} from './player';
import type { Beat, MediaRef } from './content';
import type { Encounter, EncounterType } from './encounter';
import type { ResolutionTier } from './choice';

export interface Scene {
  id: string;
  name: string;

  backgroundImage?: MediaRef;
  ambientSound?: string;

  beats: Beat[];
  startingBeatId: string;

  encounter?: Encounter;

  conditions?: ConditionExpression;

  fallbackSceneId?: string;

  leadsTo?: string[];

  isBottleneck?: boolean;
  isConvergencePoint?: boolean;
  branchType?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  synopsis: string;
  coverImage: MediaRef;

  scenes: Scene[];
  startingSceneId: string;

  unlockConditions?: ConditionExpression;

  onComplete?: Consequence[];
}

export interface Story {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  coverImage: string;

  author?: string;
  tags?: string[];

  initialState: {
    attributes: PlayerAttributes;
    skills: PlayerSkills;
    tags: string[];
    inventory: InventoryItem[];
  };

  npcs: {
    id: string;
    name: string;
    description: string;
    role?: string;
    portrait?: string;
    pronouns?: string;
    initialRelationship?: Partial<Relationship>;
    /**
     * First-class NPC tier (Phase 1.3). Authored by CharacterDesigner and
     * persisted here so the runtime, validators, and UI can read it without
     * re-inferring from `role`.
     */
    tier?: NPCTier;
    /**
     * Richer NPC fields persisted from CharacterBible (Phase 1.6). Optional
     * so existing stories remain valid; present for newly generated stories.
     */
    want?: string;
    fear?: string;
    flaw?: string;
    voiceProfile?: {
      writingGuidance?: string;
      speechPatterns?: string[];
      vocabularyLevel?: string;
      whenNervous?: string;
      whenAngry?: string;
      whenConfident?: string;
    };
    secrets?: string[];
    arc?: {
      startState?: string;
      endState?: string;
      keyBeats?: string[];
    };
  }[];

  episodes: Episode[];

  outputDir?: string;

  /**
   * Structured art-style profile the generation pipeline used. Persisted so
   * single-image regenerations, resumes, and downstream playback can read
   * back the same style contract without re-running StyleArchitect.
   *
   * Typed loosely as `unknown` here to avoid a circular dependency on the
   * `ai-agents/images` module; the pipeline stores an `ArtStyleProfile`
   * and the reader casts back at consumption time.
   */
  artStyleProfile?: unknown;

  /**
   * Paths to the three style-bible anchor images the user approved in
   * the Style Setup UI (or the pipeline generated in-flight). Any slot
   * may be absent; playback only cares about `character` for
   * `setGeminiStyleReference` hand-off on resume.
   */
  styleAnchors?: {
    character?: { imagePath: string };
    arcStrip?: { imagePath: string };
    environment?: { imagePath: string };
  };
}

export interface StoryCatalogEpisode {
  id: string;
  number: number;
  title: string;
  synopsis: string;
  coverImage: string;
}

export interface StoryCatalogEntry {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  coverImage: string;
  author?: string;
  tags?: string[];
  outputDir?: string;
  isBuiltIn?: boolean;
  updatedAt?: string;
  fullStoryUrl?: string;
  episodeCount: number;
  episodes: StoryCatalogEpisode[];
}

// ========================================
// GAME STATE TYPES
// ========================================

export interface GameSession {
  id: string;
  storyId: string;
  playerState: PlayerState;
  startedAt: Date;
  lastPlayedAt: Date;

  sceneHistory: string[];

  encounterState?: {
    encounterId: string;
    currentPhaseId: string;
    phaseScore: number;
    totalScore: number;
  };
}

// ========================================
// RESOLUTION TYPES (Fiction-First)
// ========================================

export interface ResolutionResult {
  tier: ResolutionTier;
  roll: number;
  target: number;
  margin: number;
  narrativeText: string;
  weakestContributor?: { skill: string; effective: number; ceiling: number };
}

// ========================================
// CONSEQUENCE BUDGET TYPES
// ========================================

export type ConsequenceBudgetCategory = 'callback' | 'tint' | 'branchlet' | 'branch';

export type BudgetedConsequence = Consequence & {
  budgetCategory: ConsequenceBudgetCategory;
};

// ========================================
// NPC TIER TYPES
// ========================================

export type NPCTier = 'core' | 'supporting' | 'background';

export type RelationshipDimension = 'trust' | 'affection' | 'respect' | 'fear';

export interface TieredNPC {
  id: string;
  name: string;
  tier: NPCTier;
  relationshipDimensions: RelationshipDimension[];
}

// ========================================
// FIVE-FACTOR IMPACT TYPES
// ========================================

export interface FiveFactorImpact {
  outcome: boolean;
  process: boolean;
  information: boolean;
  relationship: boolean;
  identity: boolean;
}

// ========================================
// TIMING METADATA TYPES
// ========================================

export interface TimingMetadata {
  estimatedReadingTimeSeconds: number;
  wordCount: number;
  isChoicePoint: boolean;
  cumulativeSeconds: number;
}

// ========================================
// SEASON PLANNING TYPES
// ========================================

export type CliffhangerType =
  | 'revelation'
  | 'danger'
  | 'mystery'
  | 'betrayal'
  | 'arrival'
  | 'departure'
  | 'decision'
  | 'transformation';

export type StorySpinePosition =
  | 'setup'
  | 'routine'
  | 'inciting'
  | 'consequence'
  | 'climax'
  | 'resolution';

export interface EpisodePlan {
  episodeNumber: number;
  title: string;
  logline: string;
  seasonAct: 1 | 2 | 3;
  isTentpole: boolean;
  isMidseasonPivot: boolean;
  isFinale: boolean;
  storySpinePosition: StorySpinePosition;
  mustAccomplish: string[];
  cliffhangerType: CliffhangerType;
  cliffhangerHook: string;
  cliffhangerSetup: string;
  primaryCharacterFocus: string[];
  arcProgressions: Array<{
    characterId: string;
    fromState: string;
    toState: string;
  }>;
  subplotsActive: string[];
  subplotBeats: Array<{
    subplotId: string;
    beatDescription: string;
  }>;
  promisesMade: string[];
  promisesFulfilled: string[];
  revelationsDelivered: string[];
  previousEpisodeThreads: string[];
  nextEpisodeSetup: string[];
  plannedEncounters: Array<{
    type: EncounterType;
    description: string;
    stakes: string;
    position: 'opening' | 'midpoint' | 'climax';
  }>;
  estimatedSceneCount: number;
  estimatedBeatCount: number;
}

export interface SeasonBible {
  seasonId: string;
  storyTitle: string;
  seasonNumber: number;
  totalEpisodes: number;
  suggestedEpisodeCount?: number;
  userSelectedEpisodeCount: number;
  episodeLengthTarget: 'short' | 'medium' | 'long';
  centralQuestion: string;
  thematicQuestion: string;
  centralQuestionAnswer: string;
  nextSeasonHook: {
    cliffhangerType: CliffhangerType;
    hook: string;
    newQuestion: string;
    setup: string;
  };
  seasonStructure: {
    act1Episodes: number[];
    act2Episodes: number[];
    act3Episodes: number[];
    midseasonPivotEpisode: number;
    tentpoleEpisodes: number[];
    finaleEpisode: number;
    pacingNotes: string;
  };
  episodePlans: EpisodePlan[];
  characterArcs: Array<{
    characterId: string;
    arcType: string;
    startState: string;
    endState: string;
    keyBeats: string[];
  }>;
  subplots: Array<{
    id: string;
    name: string;
    description: string;
    characters: string[];
    startEpisode: number;
    endEpisode: number;
  }>;
  promiseLedger: {
    questionsRaised: string[];
    characterTrajectories: string[];
    relationshipTensions: string[];
    themesIntroduced: string[];
  };
  revelationSchedule: Array<{
    episodeNumber: number;
    revelation: string;
    impact: string;
  }>;
  condensationRules: {
    subplotsToOmit: string[];
    charactersToMergeOrReduce: string[];
    beatsToCondense: string[];
    pacing: 'tight' | 'moderate' | 'expansive';
  };
  generatedEpisodes: Episode[];
  lastGeneratedEpisode: number;
  generationComplete: boolean;
  createdAt: string;
  lastModified: string;
}
