/**
 * Source Material Analysis Types
 *
 * Types for analyzing novels/source material and breaking them
 * into episode-sized chunks for interactive fiction generation.
 */

// ========================================
// 7-POINT STORY STRUCTURE
// ========================================

/**
 * The four narrative anchors that define every story at the season / top level.
 *
 * - {@link StoryAnchors.stakes}     - the person, people, place, thing, or concept
 *                                     the Protagonist cares about most
 * - {@link StoryAnchors.goal}       - what the Protagonist feels compelled to achieve
 * - {@link StoryAnchors.incitingIncident} - the event that sets the story in motion
 * - {@link StoryAnchors.climax}     - the turning-point confrontation where the
 *                                     Protagonist faces their greatest challenge
 *
 * These are the shared reference points every narrative-quality agent aligns to.
 * When source material does not already supply them, SourceMaterialAnalyzer
 * infers them. Path B's StorySchema authoring tool writes them directly.
 */
export interface StoryAnchors {
  stakes: string;
  goal: string;
  incitingIncident: string;
  climax: string;
}

/**
 * The season-level 3-act / 7-point structural contract.
 *
 * Each string names the beat at the season level. Individual episodes carry
 * one or more of these beats as their structural role (see
 * {@link EpisodeOutline.structuralRole}). The `climax` field here SHOULD
 * match the {@link StoryAnchors.climax} anchor either exactly or as a
 * recognizable rephrasing; `SevenPointCoverageValidator` enforces this.
 */
export interface SevenPointStructure {
  hook: string;
  plotTurn1: string;
  pinch1: string;
  midpoint: string;
  pinch2: string;
  climax: string;
  resolution: string;
}

/**
 * Optional reusable-story abstraction metadata inferred from a known story or
 * source prompt. This is analysis/planning data only: it helps agents learn
 * transferable structure without introducing a second runtime story format.
 */
export interface StorySchemaVariable {
  name: string;
  description: string;
  examples?: string[];
}

export interface StorySchemaAbstraction {
  archetype: string;
  adaptationMode: 'source_faithful' | 'inspired_by' | 'original';
  schemaVariables: StorySchemaVariable[];
  generalizationGuidance: string[];
  reusablePatternSummary: string;
}

export interface WritingStyleGuide {
  source: 'explicit_prompt' | 'inferred_from_material';
  summary: string;
  narrativeVoice: string;
  sentenceRhythm: string;
  diction: string;
  dialogueStyle: string;
  povAndDistance: string;
  imageryAndSensoryFocus: string;
  pacing: string;
  doList: string[];
  avoidList: string[];
  evidence?: string[];
}

export interface DirectLanguageFragment {
  text: string;
  context: string;
  speaker?: string;
  episode?: number;
}

export interface DirectLanguageFragmentGroups {
  dialogue: string[];
  prose: string[];
  terminology: string[];
}

/**
 * Which beat of the 7-point structure a given episode carries.
 *
 * `rising` and `falling` are non-beat buffer slots used when an episode sits
 * BETWEEN two named beats and purely escalates / de-escalates tension.
 */
export type StructuralRole =
  | 'hook'
  | 'plotTurn1'
  | 'pinch1'
  | 'midpoint'
  | 'pinch2'
  | 'climax'
  | 'resolution'
  | 'rising'
  | 'falling';

/**
 * The seven "real" beats (excluding rising / falling buffers). Exported so
 * validators can iterate the required set.
 */
export const SEVEN_POINT_BEATS: ReadonlyArray<Exclude<StructuralRole, 'rising' | 'falling'>> = [
  'hook',
  'plotTurn1',
  'pinch1',
  'midpoint',
  'pinch2',
  'climax',
  'resolution',
] as const;

// ========================================
// STORY STRUCTURE TYPES
// ========================================

export interface StoryArc {
  id: string;
  name: string;
  description: string;
  startChapter?: string;
  endChapter?: string;
  // Estimated episode range this arc spans
  estimatedEpisodeRange: {
    start: number;
    end: number;
  };
}

export interface PlotPoint {
  id: string;
  description: string;
  type: 'inciting_incident' | 'rising_action' | 'midpoint' | 'climax' | 'resolution' | 'twist' | 'revelation';
  importance: 'critical' | 'major' | 'minor';
  // Which episode this should appear in
  targetEpisode: number;
  // Characters involved
  charactersInvolved: string[];
  // Source reference (chapter, page, etc.)
  sourceReference?: string;
}

export interface CharacterArc {
  characterId: string;
  characterName: string;
  arcDescription: string;
  // Episode milestones for this character
  milestones: Array<{
    episode: number;
    development: string;
  }>;
}

export type EndingMode = 'single' | 'multiple';

export type EndingSourceConfidence = 'explicit' | 'inferred' | 'generated';

export type EndingStateDriverType =
  | 'relationship'
  | 'identity'
  | 'flag'
  | 'encounter_outcome'
  | 'faction'
  | 'theme'
  | 'choice_pattern'
  | 'resource';

export interface EndingStateDriver {
  type: EndingStateDriverType;
  label: string;
  details?: string;
}

export interface StoryEndingTarget {
  id: string;
  name: string;
  summary: string;
  emotionalRegister: string;
  themePayoff: string;
  stateDrivers: EndingStateDriver[];
  targetConditions: string[];
  sourceConfidence: EndingSourceConfidence;
}

// ========================================
// EPISODE BREAKDOWN TYPES
// ========================================

// ========================================
// ENCOUNTER PLANNING TYPES
// ========================================

export type EncounterCategory =
  | 'combat'
  | 'social'
  | 'romantic'
  | 'dramatic'
  | 'exploration'
  | 'puzzle'
  | 'chase'
  | 'stealth'
  | 'investigation'
  | 'negotiation'
  | 'survival'
  | 'heist'
  | 'mixed';

export interface PlannedEncounter {
  // Unique ID within the season plan
  id: string;
  // What kind of encounter
  type: EncounterCategory;
  // Optional narrative style layer for non-combat parity
  style?: 'action' | 'social' | 'romantic' | 'dramatic' | 'mystery' | 'stealth' | 'adventure' | 'mixed';
  // Short description of the encounter
  description: string;
  // Difficulty relative to story progression
  difficulty: 'easy' | 'moderate' | 'hard' | 'extreme';
  // Which characters are involved
  npcsInvolved: string[];
  // What's at stake narratively
  stakes: string;
  // Skills/approaches that should be relevant
  relevantSkills: string[];
  // What earlier scenes must establish so the encounter lands
  encounterBuildup?: string;
  // Explicit payoff hooks the encounter should spend from earlier scenes.
  // Format mirrors the episode blueprint contract:
  // "flag:<name> — <effect>" or "relationship:<npcId>.<dim> <op> <n> — <effect>"
  encounterSetupContext?: string[];
  // Does this encounter's outcome branch the story?
  isBranchPoint: boolean;
  // If branching, what are the major outcomes?
  branchOutcomes?: {
    victory: string;   // What happens on success
    partialVictory?: string; // What happens on costly success
    defeat: string;    // What happens on failure
    escape?: string;   // What happens if they flee
  };
}

// ========================================
// CROSS-EPISODE BRANCHING TYPES
// ========================================

export interface CrossEpisodeBranch {
  // Unique ID
  id: string;
  // Human-readable name for this branch
  name: string;
  // Which episode this branch originates in
  originEpisode: number;
  // What triggers this branch (encounter outcome, choice, etc.)
  trigger: {
    type: 'encounter_outcome' | 'story_choice' | 'relationship_state' | 'flag_condition';
    description: string;
    // Reference to the encounter or choice that triggers it
    sourceId?: string;
  };
  // The different paths this branch creates
  paths: Array<{
    id: string;
    name: string;          // e.g., "Betrayal Path", "Alliance Path"
    condition: string;     // What causes this path
    targetEndingIds?: string[];
    // Episodes affected and how
    affectedEpisodes: Array<{
      episodeNumber: number;
      impact: 'major' | 'moderate' | 'minor';
      description: string; // How this episode changes on this path
    }>;
  }>;
  // When/if the branches reconverge
  reconvergence?: {
    episodeNumber: number;
    description: string; // How the paths come back together
  };
}

export interface ConsequenceChain {
  // Unique ID
  id: string;
  // What choice/event starts the chain
  origin: {
    episodeNumber: number;
    description: string;
    sourceId?: string; // encounter or choice ID
  };
  // Consequences that play out over subsequent episodes
  consequences: Array<{
    episodeNumber: number;
    description: string;
    severity: 'subtle' | 'noticeable' | 'dramatic';
  }>;
}

// ========================================
// EPISODE BREAKDOWN TYPES (Enhanced)
// ========================================

export interface EpisodeOutline {
  episodeNumber: number;
  title: string;
  synopsis: string;
  // Source material this episode covers
  sourceChapters: string[];
  sourceSummary: string;
  // Key plot points to hit
  plotPoints: PlotPoint[];
  // Characters featured
  mainCharacters: string[];
  supportingCharacters: string[];
  // Key locations
  locations: string[];
  // Estimated scope
  estimatedSceneCount: number;
  estimatedChoiceCount: number;

  /**
   * Which beat(s) of the season's {@link SevenPointStructure} this episode
   * carries. A single episode may fuse multiple beats (e.g. `['hook','plotTurn1']`
   * in a short 3-episode season) or sit BETWEEN beats as a `rising` / `falling`
   * buffer in a long season.
   *
   * Populated by SeasonPlannerAgent; validated by SevenPointCoverageValidator
   * (every beat in the season's sevenPoint must be carried by >=1 episode).
   * Drives arc tone, difficultyTier, branch placement, twist landing, and
   * character-arc milestones.
   */
  structuralRole?: StructuralRole[];

  /**
   * @deprecated in favor of {@link structuralRole} + season-level sevenPoint.
   * Retained so existing SourceMaterialAnalyzer output still typechecks; new
   * code should read `structuralRole` and consult the season's `sevenPoint`
   * for the beat text.
   */
  narrativeFunction: {
    setup: string;
    conflict: string;
    resolution: string;
  };
  
  // === ENCOUNTER PLANNING (Season-level) ===
  // Encounters planned for this episode by the season planner (populated by SeasonPlannerAgent)
  plannedEncounters?: PlannedEncounter[];
  // Target difficulty level for this episode overall (populated by SeasonPlannerAgent)
  difficultyTier?: 'introduction' | 'rising' | 'peak' | 'falling' | 'finale';
  
  // === CROSS-EPISODE BRANCHING ===
  // Branches that originate in this episode
  outgoingBranches?: string[]; // CrossEpisodeBranch IDs
  // Branches from previous episodes that affect this one
  incomingBranches?: string[]; // CrossEpisodeBranch IDs
  // Flags/state this episode sets that later episodes reference
  setsFlags?: Array<{ flag: string; description: string }>;
  // Flags/state from previous episodes that this episode checks
  checksFlags?: Array<{ flag: string; ifTrue: string; ifFalse: string }>;
}

export interface SourceMaterialAnalysis {
  // Metadata
  sourceTitle: string;
  sourceAuthor?: string;
  totalWordCount?: number;
  totalChapters?: number;

  // Story structure
  genre: string;
  tone: string;
  themes: string[];
  setting: {
    timePeriod: string;
    location: string;
    worldDetails: string;
  };

  // Overall story arcs
  storyArcs: StoryArc[];

  /**
   * Four narrative anchors that ground every downstream agent
   * (protagonist Stakes, Goal, Inciting Incident, Climax).
   * Inferred by SourceMaterialAnalyzer when the caller does not supply them.
   */
  anchors: StoryAnchors;

  /**
   * The season-level 3-act / 7-point beat map. Inferred by
   * SourceMaterialAnalyzer; each episode carries one or more of these beats
   * via {@link EpisodeOutline.structuralRole}. Validated for coverage and
   * anchor-consistency by SevenPointCoverageValidator.
   */
  sevenPoint: SevenPointStructure;

  /**
   * Optional reusable-story abstraction. Downstream agents may consult this
   * for archetype and transferable structure, but runtime output remains the
   * StoryRPG Story/Episode/Scene/Beat/Choice schema.
   */
  schemaAbstraction?: StorySchemaAbstraction;

  /**
   * Prose contract for generated beats. If the user explicitly requested a
   * writing style in the prompt, that instruction is authoritative; otherwise
   * SourceMaterialAnalyzer infers this guide from the supplied material.
   */
  writingStyleGuide?: WritingStyleGuide;

  // Ending analysis
  detectedEndingMode?: EndingMode;
  resolvedEndingMode?: EndingMode;
  endingModeReasoning?: string;
  extractedEndings?: StoryEndingTarget[];
  generatedEndings?: StoryEndingTarget[];
  resolvedEndings?: StoryEndingTarget[];

  // Complete episode breakdown
  episodeBreakdown: EpisodeOutline[];
  totalEstimatedEpisodes: number;

  // Character analysis
  protagonist: {
    id: string;
    name: string;
    description: string;
    arc: string;
  };
  majorCharacters: Array<{
    id: string;
    name: string;
    role: 'antagonist' | 'ally' | 'mentor' | 'love_interest' | 'rival' | 'neutral';
    description: string;
    importance: 'core' | 'supporting' | 'background';
    firstAppearance: number; // Episode number
  }>;

  // Key locations identified
  keyLocations: Array<{
    id: string;
    name: string;
    description: string;
    importance: 'major' | 'minor' | 'backdrop';
    firstAppearance: number; // Episode number
  }>;

  // Analysis metadata
  analysisTimestamp: Date;
  confidenceScore: number; // 0-100, how confident the analysis is
  warnings: string[]; // Any issues or ambiguities found

  // Direct language fragments from source (for authentic voice)
  directLanguageFragments?: DirectLanguageFragment[] | DirectLanguageFragmentGroups;

  // Adaptation guidance
  adaptationGuidance?: {
    toneNotes: string;
    dialogueStyle: string;
    narrativeVoice: string;
    elementsToPreserve: string[];
    elementsToAdapt: string[];
    /**
     * Legacy fields emitted by older SourceMaterialAnalyzer prompts. Kept so
     * old checkpoints and partially generated jobs remain readable.
     */
    keyThemesToPreserve?: string[];
    iconicMoments?: string[];
  };
}

// ========================================
// GENERATION SCOPE TYPES
// ========================================

export interface GenerationScope {
  // Total episodes the source material could produce
  totalEpisodes: number;

  // Which episodes to generate in this run
  episodesToGenerate: {
    start: number; // 1-indexed
    end: number;   // inclusive
  };

  // Whether to generate all or partial
  mode: 'full' | 'partial';

  // If partial, what's been generated before
  previouslyGenerated?: number[];
}

export interface MultiEpisodeResult {
  // Analysis of source material
  analysis: SourceMaterialAnalysis;

  // Generation scope used
  scope: GenerationScope;

  // Generated episodes
  episodes: Array<{
    episodeNumber: number;
    title: string;
    // Reference to full episode data
    episodeId: string;
  }>;

  // Progress tracking
  progress: {
    totalEpisodes: number;
    generatedEpisodes: number;
    remainingEpisodes: number;
    percentComplete: number;
  };
}

// ========================================
// USER CHOICE TYPES
// ========================================

export interface EpisodeGenerationChoice {
  // How many episodes the source material contains
  totalAvailable: number;

  // Suggested episode count options
  suggestedOptions: Array<{
    count: number;
    description: string;
    estimatedTime?: string;
  }>;

  // The range selected by user
  selectedRange?: {
    start: number;
    end: number;
  };
}
