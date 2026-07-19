/**
 * Source Material Analysis Types
 *
 * Types for analyzing novels/source material and breaking them
 * into episode-sized chunks for interactive fiction generation.
 */

import type {
  ArcPressureTreatmentContract,
  BranchConsequenceRealizationContract,
  CharacterTreatmentRealizationContract,
  EndingRealizationContract,
  FailureModeAuditCode,
  FailureModeAuditContract,
  StoryCircleBeatRealizationContract,
  StakesArchitectureContract,
  WorldTreatmentRealizationContract,
} from './scenePlan';
import type { CliffhangerType } from './story';
import type { CanonLockManifest, LockedStoryCanon } from './storyCanon';
import type { ThemeImageSystemMotif } from './relationshipValue';

// ========================================
// STORY CIRCLE STORY STRUCTURE
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
 * The season-level / episode-level Story Circle structural contract.
 */
export interface StoryCircleStructure {
  you: string;
  need: string;
  go: string;
  search: string;
  find: string;
  take: string;
  return: string;
  change: string;
}

export type StoryCircleBeat = keyof StoryCircleStructure;

export const STORY_CIRCLE_BEATS: ReadonlyArray<StoryCircleBeat> = [
  'you',
  'need',
  'go',
  'search',
  'find',
  'take',
  'return',
  'change',
] as const;

export interface StoryCircleRoleAssignment {
  beat: StoryCircleBeat;
  /**
   * `primary` lands the beat itself. `expansion` is an additional contiguous
   * unit that deepens the named beat when there are more than eight episodes
   * or scenes.
   */
  roleKind: 'primary' | 'expansion';
  /** Episode/scene index carrying the primary beat this expands, if applicable. */
  expansionOfUnit?: number;
  /** Why this assignment exists. */
  source?: 'distribution' | 'treatment' | 'llm';
}

export type EncounterStoryCircleTarget = Extract<StoryCircleBeat, 'go' | 'search' | 'find' | 'take'>;

export interface EncounterStoryCircleTargetEvidence {
  /** Episode-level Story Circle role(s) used to choose the encounter target. */
  episodeStoryCircleRole?: StoryCircleBeat[];
  /** The episode question or pressure this encounter is meant to test. */
  episodeQuestion?: string;
  /** How this encounter leaves the protagonist different by the episode end. */
  protagonistChange?: string;
  /** Whether this encounter/cliffhanger hands pressure to the next cycle. */
  cliffhangerHandoff?: 'next_need' | 'next_go' | 'none';
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

export interface ThemeArgumentContract {
  themeQuestion: string;
  controllingIdea: {
    value: string;
    cause: string;
    sentence: string;
  };
  counterIdea: {
    value: string;
    cause: string;
    sentence: string;
  };
  valueLadder: {
    positive: string;
    contrary: string;
    contradiction: string;
    negationOfNegation: string;
  };
  archetypalCore: string;
  uniqueSurface: string;
  climaxResonantEvent: string;
  retroactiveReframe: string;
  aestheticEmotionTarget: string;
  imageSystem?: ThemeImageSystemMotif[];
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

export interface CharacterFashionStyle {
  styleSummary: string;
  styleTags: string[];
  signatureGarments: string[];
  materials: string[];
  colorPalette: string[];
  accessories: string[];
  sourceEvidence?: string[];
}

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

export type CharacterArcMode = 'positive' | 'tragic' | 'ambiguous';

export interface ProtagonistCharacterArchitecture {
  /**
   * Agent-facing false/protective belief. This should never be shown to the
   * player as a label; scenes express it through behavior and choices.
   */
  lie: string;
  /**
   * The formative pressure that made the Lie useful. May be trauma, success,
   * social conditioning, deprivation, betrayal, vow, humiliation, fear, or
   * survival adaptation; it does not have to be a trauma-wound template.
   */
  originPressure: string;
  /** What the protagonist must recognize, or refuse in a tragic arc. */
  truth: string;
  /** Conscious goal. */
  want: string;
  /** Dramatic necessity underneath the conscious goal. */
  need: string;
  arcMode: CharacterArcMode;
  climaxChoice: {
    choiceQuestion: string;
    integrateTruthOption: string;
    recommitLieOption: string;
    activeChoiceMechanism: string;
  };
}

export interface SupportingCharacterMicroArc {
  characterId: string;
  characterName: string;
  microLie: string;
  originPressure?: string;
  truthOrCounterPressure: string;
  screenTimeTier: 'major' | 'supporting' | 'minor';
  pressureRole: 'mirror' | 'foil' | 'temptation' | 'warning' | 'ally' | 'antagonist';
  protagonistVisibleSignals: string[];
  plannedResolution?: string;
}

export interface CharacterArchitecture {
  protagonist: ProtagonistCharacterArchitecture;
  supportingCharacters: SupportingCharacterMicroArc[];
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
  repeatedChoicePattern?: string;
  finalVoiceoverLine?: string;
  sourceText?: string;
  sourceConfidence: EndingSourceConfidence;
}

export interface TreatmentEpisodeGuidance {
  sourceKind?: 'authored' | 'authored_lite' | 'derived_from_lite';
  authoredTitle?: string;
  rawStoryCircleRole?: string;
  structuralNote?: string;
  dramaticQuestion?: string;
  episodePromise?: string;
  coldOpenFunction?: string;
  openingImage?: string;
  episodeTurns?: string[];
  synopsis?: string;
  openingSituation?: string;
  toneRegister?: string;
  encounterAnchors?: string[];
  encounterCentralConflict?: string;
  encounterStoryCircleTarget?: EncounterStoryCircleTarget;
  encounterStoryCircleTargetRationale?: string;
  encounterBuildup?: string;
  encounterAftermath?: string;
  stakesLayers?: string[];
  themePressure?: string;
  liePressure?: string;
  aPressure?: string;
  bPressure?: string;
  cSeed?: string;
  scenePlanningTargets?: string[];
  entryGoal?: string;
  obstacle?: string;
  forcedChoice?: string;
  exitShift?: string;
  powerShift?: string;
  subtextGap?: string;
  connectsBy?: string;
  informationMovement?: string;
  majorChoicePressures?: string[];
  alternativePaths?: string[];
  consequenceSeeds?: string[];
  consequenceResidue?: string;
  visualAnchor?: string;
  endingTurnout?: string;
  endingPressure?: string;
  authoredCliffhanger?: string;
  resolvedEpisodeTension?: string;
  cliffhangerHook?: string;
  cliffhangerQuestion?: string;
  nextEpisodePressure?: string;
  cliffhangerSetup?: string;
  cliffhangerType?: CliffhangerType;
  emotionalCharge?: string;
  nextEpisodeCausality?: string;
  endStateChange?: string;
  resolutionAftermath?: string;
  capabilityGrowthGuidance?: string[];
}

export interface TreatmentSeasonGuidance {
  treatmentMode?: 'full' | 'lite';
  sourceKind?: 'authored' | 'authored_lite' | 'derived_from_lite';
  seasonPromiseAndDramaticEngine?: string;
  genre?: string;
  tone?: string;
  highConceptPitch?: string;
  logline?: string;
  coreFantasy?: string;
  audiencePromise?: string;
  premisePromise?: string;
  themeQuestion?: string;
  inactionPressure?: string;
  seasonDramaticQuestion?: string;
  centralPressure?: string;
  playerPromise?: string;
  emotionalPromise?: string;
  freshVariationPlan?: string;
  typicalEpisodeDeliverables?: string;
  seasonMustResolve?: string;
  futureOpenThreads?: string;
  protagonistGuidance?: ProtagonistTreatmentGuidance;
  /** Major NPC briefs with per-NPC visual_identity contracts. */
  npcGuidance?: NpcTreatmentGuidance[];
  worldLocationGuidance?: WorldLocationTreatmentGuidance;
  characterArchitecture?: string;
  stakesArchitecture?: string;
  stakesArchitectureGuidance?: {
    rawSection: string;
    primaryMaterialStakes?: string[];
    primaryRelationalStakes?: string[];
    primaryIdentityStakes?: string[];
    primaryExistentialStakes?: string[];
    escalationLadder?: string[];
    personalBeforeLarger?: string;
    emotionalLegibilityAnchors?: string[];
  };
  informationLedger?: string;
  informationLedgerGuidance?: {
    rawSection: string;
    entries: Array<{
      id: string;
      label: string;
      sourceText: string;
      description?: string;
      audienceKnowledgeState?: string;
      tensionMode?: string;
      knownByNames?: string[];
      withheldFromNames?: string[];
      introducedEpisode?: number;
      setupTouchEpisodes?: number[];
      plannedRevealEpisode?: number;
      plannedPayoffEpisode?: number;
      opensQuestionIds?: string[];
      closesQuestionIds?: string[];
      payoffPlan?: string;
    }>;
  };
  seasonSpine?: string;
  /** Story Circle beat→episode anchors parsed from authored season-spine text. */
  storyCircleBeatEpisodeAnchors?: Partial<Record<StoryCircleBeat, number>>;
  arcPlan?: string;
  arcGuidance?: {
    rawSection: string;
    arcs: Array<{
      arcIndex: number;
      title: string;
      sourceText: string;
      episodeRange?: { start: number; end: number };
      storyCircleSpanText?: string;
      arcDramaticQuestion?: string;
      relationToSeasonQuestion?: string;
      lieFacet?: string;
      midpointRecontextualization?: string;
      lateArcCrisis?: string;
      finaleAnswer?: string;
      handoffPressure?: string;
      pressureMovement?: string;
      protagonistPolarity?: string;
      keyNpcLocationPressure?: string;
      sourceKind?: 'authored' | 'authored_lite' | 'derived_from_lite';
      episodeTurnouts?: Array<{
        episodeNumber: number;
        sourceText: string;
        description: string;
        turnType?: string;
      }>;
    }>;
  };
  scenePlanningNotes?: string;
  scenePlanningGuidance?: {
    rawSection: string;
    scenes: Array<{
      sceneTitle: string;
      episodeNumber?: number;
      sourceText: string;
      entryGoal?: string;
      obstacle?: string;
      forcedChoice?: string;
      exitShift?: string;
      powerShift?: string;
      subtextGap?: string;
      stakesLayers?: string[];
      connectsBy?: string;
    }>;
  };
  branchAndConsequenceChains?: string;
  failForward?: string;
  endings?: string;
  failureModeAudit?: string;
  failureModeAuditGuidance?: {
    rawSection: string;
    rows: Array<{
      label: string;
      code: FailureModeAuditCode;
      status: 'avoided' | 'watch_item' | 'unknown';
      sourceText: string;
      episodeMentions: number[];
      mitigationText?: string;
    }>;
  };
  rawSectionSummary?: string[];
}

export interface ProtagonistTreatmentGuidance {
  rawSection?: string;
  nameAndPronouns?: string;
  roleInWorld?: string;
  want?: string;
  need?: string;
  lie?: string;
  wound?: string;
  truth?: string;
  arcMode?: string;
  startingIdentity?: string;
  possibleEndStates?: string[];
  climaxChoice?: string;
  pressurePoints?: string[];
  visualIdentity?: string;
}

/** Per-NPC visual / role brief parsed from treatment `### NPC:` sections. */
export interface NpcTreatmentGuidance {
  name: string;
  role?: string;
  want?: string;
  leverage?: string;
  secretOrContradiction?: string;
  relationshipToProtagonist?: string;
  howChoicesCanChangeThem?: string;
  /** Immutable visual tokens from treatment (Voice / visual notes or Visual identity). */
  visualIdentity?: string;
  rawSection?: string;
}

export interface WorldLocationTreatmentGuidance {
  rawSection?: string;
  worldPremise?: string;
  timePeriod?: string;
  supernaturalRules?: string[];
  powerStructures?: string[];
  dramaticRules?: string[];
  costsAndTaboos?: string[];
  keyLocations?: WorldLocationTreatmentLocationGuidance[];
}

export interface WorldLocationTreatmentLocationGuidance {
  name: string;
  sourceText: string;
  purpose?: string;
  mood?: string;
  history?: string;
  choicePressure?: string;
}

export interface TreatmentBranchGuidance {
  id: string;
  name: string;
  summary: string;
  sourceText?: string;
  originEpisode?: number;
  createdBy?: string;
  laterEpisodeChange?: string;
  reconvergenceEpisode?: number;
  reconvergenceResidue?: string;
  stateChanges?: string[];
  pathVariants?: Array<{
    id: string;
    label: string;
    conditionText: string;
    resultText: string;
    stateChanges: string[];
    targetEndingIds?: string[];
  }>;
  canonicalPathId?: string;
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
  // LLM-authored playable description. This may ship after encounter authoring.
  description: string;
  /** Author-only source synopsis used to brief downstream encounter authoring. */
  sourceSynopsis?: string;
  /** Author-only treatment anchor; never copy this field into the runtime package. */
  authoredAnchor?: string;
  // Difficulty relative to story progression
  difficulty: 'easy' | 'moderate' | 'hard' | 'extreme';
  // Which characters are involved
  npcsInvolved: string[];
  // What's at stake narratively
  stakes: string;
  // Authored treatment pressure this encounter should manifest through play
  centralConflict?: string;
  /**
   * Which Story Circle pressure point this playable encounter is targeting.
   * Encounters do not target `you`, `need`, `return`, or `change` directly;
   * those beats frame the episode while the encounter itself realizes a
   * pressure event in `go`, `search`, `find`, or `take`.
   */
  storyCircleTarget?: EncounterStoryCircleTarget;
  /** Why this encounter belongs to that Story Circle target. */
  storyCircleTargetRationale?: string;
  /** Season-planning evidence used to select the target. */
  storyCircleTargetEvidence?: EncounterStoryCircleTargetEvidence;
  // What the episode should show after this encounter resolves
  aftermathConsequence?: string;
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

  /** Story Circle beat assignment for this episode. */
  storyCircleRole?: StoryCircleRoleAssignment[];

  /** Episode-level setup/conflict/resolution summary. */
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

  /**
   * Authored treatment details extracted from StoryRPG treatment documents.
   * This is planning metadata only; downstream agents use it as high-signal
   * guidance while preserving the canonical Story/Episode/Scene/Choice schema.
   */
  treatmentGuidance?: TreatmentEpisodeGuidance;
}

export interface SourceMaterialAnalysis {
  // Metadata
  sourceTitle: string;
  sourceAuthor?: string;
  sourceFormat?: 'source_material' | 'story_treatment' | 'prompt';
  treatmentMetadata?: {
    detected: boolean;
    confidence: 'low' | 'medium' | 'high';
    formatVersion: 'legacy' | 'storyrpg-treatment-v2' | 'story-treatment-mvp' | 'story-treatment-lite';
    warnings: string[];
  };
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
   * Primary season-level Story Circle beat map. Each episode carries one or
   * more of these beats via {@link EpisodeOutline.storyCircleRole}. Validators
   * enforce coverage, order, contiguity, and realization.
   */
  storyCircle?: StoryCircleStructure;

  /**
   * Optional reusable-story abstraction. Downstream agents may consult this
   * for archetype and transferable structure, but runtime output remains the
   * StoryRPG Story/Episode/Scene/Beat/Choice schema.
   */
  schemaAbstraction?: StorySchemaAbstraction;

  /**
   * Generator-only theme argument contract. Consolidates McKee-style resonance
   * under StoryRPG's existing theme/pressure/climax architecture. Runtime output
   * still flows through Story/Episode/Scene/Beat/Choice; these labels must never
   * be rendered to the player.
   */
  themeArgument?: ThemeArgumentContract;

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

  /**
   * Authored season-level branch chains extracted from a treatment document.
   */
  treatmentBranches?: TreatmentBranchGuidance[];

  /**
   * Authored season-level treatment sections extracted from StoryRPG
   * treatment documents. These are planning constraints for SourceMaterial,
   * SeasonPlanner, and StoryArchitect prompts; runtime story data still flows
   * through the canonical episode/scene/beat/choice schema.
   */
  treatmentSeasonGuidance?: TreatmentSeasonGuidance;

  // Character analysis
  protagonist: {
    id: string;
    name: string;
    /** Explicit source-canon pronouns. Optional only for schema-v1 analysis migration. */
    pronouns?: 'he/him' | 'she/her' | 'they/them';
    description: string;
    arc: string;
    fashionStyle?: CharacterFashionStyle;
  };
  majorCharacters: Array<{
    id: string;
    name: string;
    role: 'antagonist' | 'ally' | 'mentor' | 'love_interest' | 'rival' | 'neutral';
    description: string;
    importance: 'core' | 'supporting' | 'background';
    firstAppearance: number; // Episode number
    fashionStyle?: CharacterFashionStyle;
  }>;

  /**
   * Agent-facing character architecture for Lie / origin pressure / Truth /
   * Want vs Need. Planning metadata only; never rendered as player-facing
   * mechanics or labels.
   */
  characterArchitecture?: CharacterArchitecture;
  characterTreatmentContracts?: CharacterTreatmentRealizationContract[];
  stakesArchitectureContracts?: StakesArchitectureContract[];
  branchConsequenceContracts?: BranchConsequenceRealizationContract[];
  endingRealizationContracts?: EndingRealizationContract[];
  failureModeAuditContracts?: FailureModeAuditContract[];
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
  arcPressureContracts?: ArcPressureTreatmentContract[];
  worldTreatmentContracts?: WorldTreatmentRealizationContract[];

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

  /**
   * Source-stage locked story canon. New generation must establish this before
   * season planning. Optional only so older saved artifacts/checkpoints continue
   * to deserialize through compatibility paths.
   */
  sourceCanon?: LockedStoryCanon;
  canonLockManifest?: CanonLockManifest;

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
