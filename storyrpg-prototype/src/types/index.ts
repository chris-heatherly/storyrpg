// ========================================
// PLAYER STATE TYPES
// ========================================

// Core attributes (hidden from player)
export interface PlayerAttributes {
  charm: number;      // Social magnetism, persuasion
  wit: number;        // Cleverness, quick thinking
  courage: number;    // Bravery, willingness to take risks
  empathy: number;    // Understanding others' emotions
  resolve: number;    // Mental fortitude, determination
  resourcefulness: number; // Problem-solving, adaptability
}

// Skills are genre-specific (e.g., "hacking", "sword_fighting", "diplomacy")
export type PlayerSkills = Record<string, number>;

// Relationship with an NPC
export interface Relationship {
  npcId: string;
  trust: number;      // -100 to 100
  affection: number;  // -100 to 100
  respect: number;    // -100 to 100
  fear: number;       // 0 to 100
}

// Identity tags (binary traits about the character)
export type PlayerTags = Set<string>;

// ========================================
// PLAYER IDENTITY PROFILE
// ========================================

/**
 * Identity dimensions emerge from accumulated player choices.
 * Each dimension is a spectrum from -100 to +100.
 * Values near 0 mean the player hasn't strongly established that trait.
 */
export interface IdentityProfile {
  // Moral compass
  mercy_justice: number;          // -100 (mercy) to +100 (justice)
  idealism_pragmatism: number;    // -100 (idealism) to +100 (pragmatism)

  // Social style
  cautious_bold: number;          // -100 (cautious) to +100 (bold)
  loner_leader: number;           // -100 (loner) to +100 (leader)

  // Approach
  heart_head: number;             // -100 (heart/emotion) to +100 (head/logic)
  honest_deceptive: number;       // -100 (honest) to +100 (deceptive)
}

export const DEFAULT_IDENTITY_PROFILE: IdentityProfile = {
  mercy_justice: 0,
  idealism_pragmatism: 0,
  cautious_bold: 0,
  loner_leader: 0,
  heart_head: 0,
  honest_deceptive: 0,
};

// Flags are story-specific booleans
export type PlayerFlags = Record<string, boolean>;

// Scores are story-specific integers
export type PlayerScores = Record<string, number>;

// Item in inventory
export interface InventoryItem {
  itemId: string;
  name: string;
  description: string;
  quantity: number;
  equipped?: boolean;
  statModifiers?: Partial<PlayerAttributes>;
}

// Complete player state
export interface PlayerState {
  // Character identity
  characterName: string;
  characterPronouns: 'he/him' | 'she/her' | 'they/them';

  // Core stats (hidden)
  attributes: PlayerAttributes;
  skills: PlayerSkills;

  // Relationships
  relationships: Record<string, Relationship>;

  // Three-layer state architecture
  flags: PlayerFlags;   // Boolean flags
  scores: PlayerScores; // Integer scores
  tags: PlayerTags;     // Identity markers

  // Identity profile (accumulated from choices)
  identityProfile: IdentityProfile;

  // Delayed consequences queue (butterfly effect)
  pendingConsequences: DelayedConsequence[];

  // Inventory
  inventory: InventoryItem[];

  // Story progress
  currentStoryId: string | null;
  currentEpisodeId: string | null;
  currentSceneId: string | null;
  completedEpisodes: string[];
}

// ========================================
// CONDITION TYPES
// ========================================

export type ComparisonOperator = '==' | '!=' | '>' | '<' | '>=' | '<=';

export interface AttributeCondition {
  type: 'attribute';
  attribute: keyof PlayerAttributes;
  operator: ComparisonOperator;
  value: number;
}

export interface SkillCondition {
  type: 'skill';
  skill: string;
  operator: ComparisonOperator;
  value: number;
}

export interface RelationshipCondition {
  type: 'relationship';
  npcId: string;
  dimension: 'trust' | 'affection' | 'respect' | 'fear';
  operator: ComparisonOperator;
  value: number;
}

export interface FlagCondition {
  type: 'flag';
  flag: string;
  value: boolean;
}

export interface ScoreCondition {
  type: 'score';
  score: string;
  operator: ComparisonOperator;
  value: number;
}

export interface TagCondition {
  type: 'tag';
  tag: string;
  hasTag: boolean;
}

export interface ItemCondition {
  type: 'item';
  itemId: string;
  hasItem?: boolean;
  has?: boolean; // Alias for hasItem (backwards compatibility)
  minQuantity?: number;
}

// Identity condition — gates choices based on accumulated player identity
export interface IdentityCondition {
  type: 'identity';
  dimension: keyof IdentityProfile;
  operator: ComparisonOperator;
  value: number; // -100 to 100
}

export type Condition =
  | AttributeCondition
  | SkillCondition
  | RelationshipCondition
  | FlagCondition
  | ScoreCondition
  | TagCondition
  | ItemCondition
  | IdentityCondition;

// Compound conditions
export interface AndCondition {
  type: 'and';
  conditions: ConditionExpression[];
}

export interface OrCondition {
  type: 'or';
  conditions: ConditionExpression[];
}

export interface NotCondition {
  type: 'not';
  condition: ConditionExpression;
}

export type ConditionExpression = Condition | AndCondition | OrCondition | NotCondition;

// ========================================
// CONSEQUENCE TYPES
// ========================================

export interface AttributeChange {
  type: 'attribute';
  attribute: keyof PlayerAttributes;
  change: number; // Can be positive or negative
}

export interface SkillChange {
  type: 'skill';
  skill: string;
  change: number;
}

export interface RelationshipChange {
  type: 'relationship';
  npcId: string;
  dimension: 'trust' | 'affection' | 'respect' | 'fear';
  change: number;
}

export interface SetFlag {
  type: 'setFlag';
  flag: string;
  value: boolean;
}

export interface ChangeScore {
  type: 'changeScore';
  score: string;
  change: number;
}

export interface SetScore {
  type: 'setScore';
  score: string;
  value: number;
}

export interface AddTag {
  type: 'addTag';
  tag: string;
}

export interface RemoveTag {
  type: 'removeTag';
  tag: string;
}

/**
 * Add item consequence - must have either item OR (itemId + name + description)
 */
export type AddItem = {
  type: 'addItem';
  quantity?: number;
} & (
  | { item: Omit<InventoryItem, 'quantity'>; itemId?: never; name?: never; description?: never; }
  | { item?: never; itemId: string; name: string; description: string; }
);

export interface RemoveItem {
  type: 'removeItem';
  itemId: string;
  quantity: number;
}

export type Consequence =
  | AttributeChange
  | SkillChange
  | RelationshipChange
  | SetFlag
  | ChangeScore
  | SetScore
  | AddTag
  | RemoveTag
  | AddItem
  | RemoveItem;

// ========================================
// APPLIED CONSEQUENCE FEEDBACK
// ========================================

export interface AppliedConsequence {
  type: 'attribute' | 'skill' | 'relationship' | 'identity' | 'item' | 'flag' | 'score';
  label: string;
  direction: 'up' | 'down' | 'neutral';
  magnitude: 'minor' | 'moderate' | 'major';
  narrativeHint?: string;
  scope?: 'self' | 'other' | 'future' | 'world';
  linger?: boolean;
}

// ========================================
// DELAYED CONSEQUENCES (Butterfly Effect)
// ========================================

/**
 * A consequence that doesn't fire immediately but waits for a trigger.
 * This creates "butterfly effect" moments where an earlier choice
 * unexpectedly impacts a later scene.
 *
 * - delay: "scenes" means N scenes later; "episodes" means N episodes later
 * - triggerCondition: Optional — if set, the consequence only fires when this condition is true
 * - description: Human-readable note about what this callback represents
 */
export interface DelayedConsequence {
  id: string;
  consequence: Consequence;
  description: string; // e.g., "The bartender remembers your insult"

  // When should this fire?
  delay?: {
    type: 'scenes' | 'episodes';
    count: number; // Fire after this many scenes/episodes
  };

  // Alternative: fire when a condition is met
  triggerCondition?: ConditionExpression;

  // Tracking
  sourceSceneId: string;    // Which scene created this
  sourceChoiceId: string;   // Which choice created this
  scenesElapsed: number;    // How many scenes since this was queued
  episodesElapsed: number;  // How many episodes since this was queued
  fired: boolean;           // Has this already been applied?
}

// ========================================
// CHOICE TYPES
// ========================================

// Choice types describe the PLAYER EXPERIENCE, not the structural effect.
// Branching (routing to different scenes via nextSceneId) is a property of
// any choice, not a type. Expression choices must not branch; all others may.
export type ChoiceType =
  | 'expression'   // Personality/voice choices, cosmetic, no plot impact. Must NOT branch.
  | 'relationship' // NPC relationship shifts (trust, affection, respect, fear). May branch.
  | 'strategic'    // Skill/stat-based choices, investigation and discovery. May branch.
  | 'dilemma';     // Value-testing, no clearly right answer, high stakes. May branch.

// Resolution result for skill/stat checks
export type ResolutionTier = 'success' | 'complicated' | 'failure';

export type ConsequenceDomain =
  | 'relationship'
  | 'reputation'
  | 'danger'
  | 'information'
  | 'identity'
  | 'leverage'
  | 'resource';

export interface ReminderPlan {
  immediate: string;
  shortTerm: string;
  later?: string;
}

export interface ChoiceFeedbackCue {
  riskLabel?: string;
  leverageLabel?: string;
  echoSummary?: string;
  progressSummary?: string;
  checkClass?: 'dramatic' | 'retryable';
}

// A single choice option
export interface Choice {
  id: string;
  text: string;

  // Optional: choice type for analytics/design
  choiceType?: ChoiceType;

  // Conditions to show this choice
  conditions?: ConditionExpression;

  // If true, choice is visible but greyed out when conditions not met
  showWhenLocked?: boolean;
  lockedText?: string; // Text to show when locked

  // Stat check for this choice (fiction-first resolution)
  statCheck?: {
    attribute?: keyof PlayerAttributes;
    skill?: string;
    difficulty: number; // 1-100
    retryableAfterChange?: boolean;
  };

  // Fiction-first guidance that helps the UI explain the moment
  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;

  // Consequences of making this choice (fire immediately)
  consequences?: Consequence[];

  // Delayed consequences (butterfly effect) — fire later based on delay or condition
  delayedConsequences?: Array<{
    consequence: Consequence;
    description: string;
    delay?: { type: 'scenes' | 'episodes'; count: number };
    triggerCondition?: ConditionExpression;
  }>;

  // Optional scene routing — any non-expression choice may include this
  // to create player-driven plot divergence. Should reference a scene ID
  // that exists in the parent scene's leadsTo array.
  // Branching frequency is capped per episode (default: max 2).
  nextSceneId?: string;

  // For routing within the same scene (intra-scene navigation)
  nextBeatId?: string;

  // Fiction-first outcome texts shown in the payoff beat after this choice.
  // Three variants are selected by the skill check tier at play time.
  // Each is 1–3 sentences vividly depicting the choice in action.
  outcomeTexts?: {
    success: string;  // Full success — the action lands cleanly
    partial: string;  // Partial success or complication — things get messy
    failure: string;  // The action goes wrong or backfires
  };

  // Reaction beat text: the world's immediate response after the payoff.
  // 1–2 sentences. Shown as a brief beat before resuming the main narrative.
  // Omit for branching choices where the destination scene IS the reaction.
  reactionText?: string;

  // Tint flag to apply on the reaction beat for minor-impact choices.
  // e.g. 'tint:mercy', 'tint:reckless', 'tint:honest'
  // Leave unset for branching (major-impact) choices.
  tintFlag?: string;
}

// ========================================
// VIDEO ANIMATION TYPES
// ========================================

export interface VideoAnimationInstruction {
  beatId: string;
  sceneId: string;
  motionDescription: string;
  cameraMotion: string;
  characterAnimation: string;
  environmentAnimation: string;
  pacing: 'slow' | 'medium' | 'fast';
  audioHint?: string;
  composedPrompt: string;
}

// ========================================
// CONTENT TYPES
// ========================================

// Conditional text variation
export interface TextVariant {
  condition: ConditionExpression;
  text: string;
  sourceChoiceId?: string;
  reminderTag?: string;
}

// A beat is a unit of content within a scene
export interface Beat {
  id: string;

  // Main narrative text (can include template variables)
  text: string;

  // Alternative text based on conditions
  textVariants?: TextVariant[];

  // Condition for this beat to be shown (if not met, beat is skipped)
  conditions?: ConditionExpression;

  // Optional speaker for dialogue
  speaker?: string;
  speakerMood?: string;

  // Optional image to display
  image?: string;
  // Multi-panel images when panel mode is active (array of URLs)
  panelImages?: string[];
  // Optional pre-generated narration audio URL
  audio?: string;
  // Optional animated video clip URL/path (generated from still image via Veo)
  video?: string;

  // Choices available at this beat (if any)
  choices?: Choice[];

  // Auto-advance to next beat after a delay (if no choices)
  nextBeatId?: string;

  // Auto-advance to a different scene (if no choices and no nextBeatId)
  nextSceneId?: string;

  // Consequences that trigger when this beat is shown
  onShow?: Consequence[];

  // Outcome image sequences for encounter beats (success/complicated/failure)
  outcomeSequences?: {
    success?: string[];
    complicated?: string[];
    failure?: string[];
  };

  // Reference to encounter sequence (if this beat is part of an encounter)
  encounterSequence?: {
    encounterId: string;
    position: 'setup' | 'action' | 'resolution';
    beatIndex: number;
  };

  /** True only for true narrative climaxes. Allows longer prose (up to climax cap). Use sparingly, max 1-2 per scene. */
  isClimaxBeat?: boolean;

  /** True for key narrative turning points. Allows slightly longer prose (up to key story beat cap). Max 2 per scene. */
  isKeyStoryBeat?: boolean;

  // Beat-level visual contract (authored with prose to reduce downstream visual drift)
  visualMoment?: string;
  primaryAction?: string;
  emotionalRead?: string;
  relationshipDynamic?: string;
  mustShowDetail?: string;

  // When true, text in the image is permitted (e.g., a letter, sign, or book in the scene).
  // Default false: the image QA gate will reject images containing any visible text.
  allowDiegeticText?: boolean;
}

// ========================================
// ENCOUNTER TYPES (Complex Multi-Beat Sequences)
// ========================================

export type EncounterType =
  | 'combat'
  | 'chase'
  | 'heist'
  | 'negotiation'
  | 'investigation'
  | 'survival'
  | 'social'
  | 'romantic'
  | 'dramatic'
  | 'puzzle'
  | 'exploration'
  | 'stealth'
  | 'mixed';

export type EncounterNarrativeStyle =
  | 'action'
  | 'social'
  | 'romantic'
  | 'dramatic'
  | 'mystery'
  | 'stealth'
  | 'adventure'
  | 'mixed';

export type EncounterOutcome = 'victory' | 'partialVictory' | 'defeat' | 'escape';

export type EncounterCostDomain =
  | 'relationship'
  | 'injury'
  | 'resource'
  | 'time'
  | 'exposure'
  | 'reputation'
  | 'information'
  | 'position'
  | 'world'
  | 'mixed';

export type EncounterCostSeverity = 'minor' | 'moderate' | 'major' | 'severe';

export type EncounterCostBearer =
  | 'protagonist'
  | 'ally'
  | 'npc'
  | 'relationship'
  | 'party'
  | 'world'
  | 'mixed';

export interface EncounterCost {
  domain: EncounterCostDomain;
  severity: EncounterCostSeverity;
  whoPays: EncounterCostBearer;
  immediateEffect: string;
  visibleComplication: string;
  lingeringEffect?: string;
  consequences?: Consequence[];
}

export interface EncounterVisualContract {
  visualMoment?: string;
  primaryAction?: string;
  emotionalRead?: string;
  relationshipDynamic?: string;
  visibleCost?: string;
  mustShowDetail?: string;
  keyExpression?: string;
  keyGesture?: string;
  keyBodyLanguage?: string;
  shotDescription?: string;
  emotionalCore?: string;
  visualNarrative?: string;
  includeExpressionRefs?: boolean;
}

// Clock system inspired by Blades in the Dark
export interface EncounterClock {
  id: string;
  name: string;           // e.g., "Escape the Manor", "Guards Close In"
  description: string;    // Fiction-first description of what this clock represents
  segments: number;       // Total segments (4, 6, or 8 typically)
  filled: number;         // Current progress (runtime state)
  type: 'goal' | 'threat' | 'complication';
}

// Choice outcome determines how clocks are affected
export interface EncounterChoiceOutcome {
  tier: 'success' | 'complicated' | 'failure';
  goalTicks: number;      // How many ticks to add to goal clock
  threatTicks: number;    // How many ticks to add to threat clock
  narrativeText: string;  // What happens in the fiction - shown as reaction/result (THE ACTION RESULT)
  outcomeImage?: string;  // Generated image URL showing the ACTION RESULT (filled by pipeline)
  consequences?: Consequence[];
  
  // === BRANCHING TREE: Embedded next situation ===
  // Instead of nextBeatId pointing to a shared beat, each outcome contains its own next situation.
  // This creates genuine branching where success/complicated/failure lead to DIFFERENT futures.
  nextSituation?: {
    setupText: string;          // The new situation arising from this outcome (2-3 sentences)
    situationImage?: string;    // Visual of the new situation (filled by pipeline)
    choices: EmbeddedEncounterChoice[];  // New choices available in this branch
    
    // Cinematic description for the situation image
    cinematicSetup?: CinematicImageDescription;
    visualContract?: EncounterVisualContract;
  };
  
  // Terminal outcome - this branch ends the encounter
  isTerminal?: boolean;
  encounterOutcome?: EncounterOutcome;
  cost?: EncounterCost;
  
  // Legacy: nextBeatId for backward compatibility with linear encounters
  nextBeatId?: string;
  
  // Cinematic visual description for the OUTCOME image (showing the action result)
  cinematicDescription?: CinematicImageDescription;
  visualContract?: EncounterVisualContract;
  
  // Visual state changes to carry forward
  visualStateChanges?: VisualStateChange[];
  
  // Legacy visual direction
  visualDirection?: OutcomeVisualDirection;
}

// Embedded choice for branching tree (avoids circular reference)
export interface EmbeddedEncounterChoice {
  id: string;
  text: string;           // Short action-oriented choice text ("Swing at his head")
  approach: string;       // "careful", "bold", "clever", etc.
  primarySkill?: string;  // Skill that influences outcome
  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;
  
  // Pre-generated outcomes for each tier - these recursively contain nextSituation
  outcomes: {
    success: EncounterChoiceOutcome;
    complicated: EncounterChoiceOutcome;
    failure: EncounterChoiceOutcome;
  };
  
  // Skill integration
  skillAdvantage?: SkillAdvantage;

  // Pre-encounter state payoff (same semantics as EncounterChoice)
  conditions?: ConditionExpression;
  showWhenLocked?: boolean;
  lockedText?: string;
  statBonus?: {
    condition: ConditionExpression;
    difficultyReduction: number;
    flavorText?: string;
  };
}

// Approach system (GDD 6.8.1)
export type EncounterApproach = 
  | 'aggressive'   // Bold, direct - higher highs, lower lows
  | 'cautious'     // Careful, methodical - steady progress
  | 'clever'       // Tricky, unconventional - wild variance
  | 'desperate'    // All-or-nothing - extreme outcomes
  | 'adaptive';    // Balanced (default)

// NPC disposition in encounters (GDD 6.8.5)
export type NPCDisposition = 'confident' | 'wary' | 'desperate' | 'enraged' | 'calculating';

// Skill advantage badges (GDD 6.8.3)
export interface SkillAdvantage {
  skill: string;
  advantageLevel: 'slight' | 'significant' | 'mastery';
  flavorText: string;
}

// Visual direction for outcomes (GDD 6.8.9)
export interface OutcomeVisualDirection {
  cameraAngle: 'low_heroic' | 'high_diminished' | 'dutch_unstable' | 'eye_level';
  shotType: 'dramatic_closeup' | 'action_wide' | 'reaction_medium' | 'impact_freeze';
  mood: 'triumphant' | 'tense' | 'desperate' | 'bittersweet';
}

export interface EncounterChoice {
  id: string;
  text: string;           // Short action-oriented choice text
  approach: string;       // "careful", "bold", "clever", etc.
  primarySkill?: string;  // Skill that influences outcome
  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;
  
  // Pre-generated outcomes for each tier (fiction-first, player doesn't see the roll)
  outcomes: {
    success: EncounterChoiceOutcome;
    complicated: EncounterChoiceOutcome;
    failure: EncounterChoiceOutcome;
  };
  
  // Approach system - first beat choices set the encounter approach
  impliedApproach?: EncounterApproach;
  
  // Skill integration
  skillAdvantage?: SkillAdvantage;
  
  // Special choice types (unlocked by momentum/resources)
  specialChoiceType?: 'press_your_luck' | 'desperate_gambit' | 'environmental' | 'signature_move';

  // Pre-encounter state payoff: conditional availability
  // When conditions are not met the choice is locked (or hidden if showWhenLocked is false).
  conditions?: ConditionExpression;
  showWhenLocked?: boolean;
  lockedText?: string;    // Greyed-out hint shown when locked, e.g. "Requires Hindley's trust"

  // Pre-encounter state payoff: difficulty reduction
  // If statBonus.condition is met at the moment the player selects this choice,
  // difficultyReduction is subtracted from the stat-check difficulty before resolving.
  statBonus?: {
    condition: ConditionExpression;
    difficultyReduction: number;
    flavorText?: string;  // Optional fiction-first hint shown when the bonus applies
  };
}

export interface EncounterBeat {
  id: string;
  phase: 'setup' | 'rising' | 'peak' | 'resolution';
  name: string;
  
  // Narrative content
  setupText: string;      // Situation description (2-3 sentences)
  situationImage?: string;

  // Pre-encounter state payoff: conditional situation text.
  // At runtime, the first matching variant replaces setupText.
  // Use for NPC dialogue tone, environmental details, or references
  // to prior choices (e.g. different text if player built trust with this NPC).
  setupTextVariants?: Array<{ condition: ConditionExpression; text: string }>;
  
  // Player choices (minimum 3 per beat)
  choices: EncounterChoice[];
  
  // Escalation - what changes if threat clock is high
  escalationText?: string;        // Alternative text when threat >= 50%
  escalationImage?: string;
  
  // Cinematic visual system - describes the beat's visual presentation
  cinematicSetup?: CinematicImageDescription;   // Visual for beat setup
  visualContract?: EncounterVisualContract;
  visualDirection?: OutcomeVisualDirection;      // Legacy visual direction
  
  // Visual state at start of beat (accumulated from previous outcomes)
  inheritedVisualState?: EncounterVisualState;
}

export interface EncounterPhase {
  id: string;
  name: string;
  description: string;
  situationImage: string;
  beats: (Beat | EncounterBeat)[];  // Support both legacy Beat and new EncounterBeat

  // Legacy thresholds (deprecated, use clocks instead)
  successThreshold?: number;
  failureThreshold?: number;

  // Phase transitions based on accumulated score
  onSuccess?: {
    nextPhaseId?: string;
    consequences?: Consequence[];
    outcomeImages?: string[];
    outcomeText: string;
  };
  onFailure?: {
    nextPhaseId?: string;
    consequences?: Consequence[];
    outcomeImages?: string[];
    outcomeText: string;
  };
}

// Environmental Elements (GDD 6.8.4)
export interface EnvironmentalElement {
  id: string;
  name: string;
  description: string;
  type: 'hazard' | 'opportunity' | 'neutral';
  activationCondition: {
    type: 'threat_threshold' | 'goal_threshold' | 'beat_number' | 'approach';
    value: number | string;
  };
  effect: {
    narrativeDescription: string;
    goalModifier?: number;
    threatModifier?: number;
    unlockChoiceId?: string;
  };
  isActive: boolean;
  wasUsed: boolean;
  visualDescription?: string;
}

// NPC Encounter State (GDD 6.8.5)
export interface NPCEncounterState {
  npcId: string;
  name: string;
  currentDisposition: NPCDisposition;
  reactionToAggressive: string;
  reactionToCautious: string;
  reactionToClever: string;
  currentTell?: string;
  tells?: Array<{
    revealCondition: 'encounter_50_percent' | 'high_threat' | 'player_success' | 'player_failure';
    tellDescription: string;
  }>;
  dispositionShifts?: Array<{
    trigger: 'player_success' | 'player_failure' | 'threat_high' | 'goal_high';
    newDisposition: NPCDisposition;
    narrativeHint: string;
  }>;
}

// Escalation Triggers (GDD 6.8.6)
export interface EscalationTrigger {
  id: string;
  condition: {
    type: 'threat_threshold' | 'beat_number' | 'time_elapsed' | 'consecutive_failures';
    value: number;
  };
  effect: {
    narrativeText: string;
    newComplication?: string;
    threatBonus?: number;
    unlockEscapeOption?: boolean;
    pointOfNoReturn?: boolean;
  };
  hasTriggered: boolean;
}

// Information Visibility / Fog of War (GDD 6.8.8)
export interface InformationVisibility {
  threatClockVisible: boolean;
  threatClockApproximate?: 'manageable' | 'growing' | 'dangerous' | 'critical';
  npcTellsRevealAt: 'encounter_50_percent' | 'immediate' | 'never';
  environmentElementsHidden: string[];
  choiceOutcomesUnknown: boolean;
}

// Pixar Stakes - Rule #16 (GDD 4.6)
export interface PixarStakes {
  initialOddsAgainst: number; // Target: 60-70%
  whatPlayerLoses: string;
  oddsAgainstNarrative: string;
  stackedObstacles: string[];
}

// ========================================
// ENCOUNTER CINEMATIC SYSTEM
// ========================================

// Camera angles for action sequences
export type CinematicCameraAngle = 
  | 'wide_establishing'     // Full scene context
  | 'medium_action'         // Characters in action
  | 'close_dramatic'        // Face/hands detail
  | 'low_heroic'            // Looking up at protagonist
  | 'high_vulnerability'    // Looking down, diminished
  | 'dutch_chaos'           // Tilted for instability
  | 'over_shoulder'         // POV feel
  | 'reaction_shot';        // Focus on response

// Shot types for encounter beats
export type CinematicShotType = 
  | 'establishing'          // Set the scene
  | 'action_moment'         // The strike, the leap, the gambit
  | 'impact'                // The hit lands (or misses)
  | 'reaction'              // Character responds
  | 'consequence'           // See the result
  | 'tension_hold';         // Pause before outcome

// Visual mood
export type CinematicMood = 
  | 'anticipation'          // Building to action
  | 'dynamic_action'        // In the midst
  | 'triumphant'            // Success moment
  | 'desperate'             // Failure/setback
  | 'tense_uncertainty'     // Could go either way
  | 'relief'                // Danger passed
  | 'dread';                // Threat looming

// Full cinematic description for image generation
export interface CinematicImageDescription {
  // Core description
  sceneDescription: string;       // What's happening in this moment
  focusSubject: string;           // Who/what is the focus
  secondaryElements: string[];    // Supporting visual elements
  
  // Camera work
  cameraAngle: CinematicCameraAngle;
  shotType: CinematicShotType;
  cameraMotionHint?: string;      // "tracking", "pushing in", "pulling back"
  
  // Mood and lighting
  mood: CinematicMood;
  lightingDirection: string;      // "harsh side lighting", "soft backlight", etc.
  colorPalette: string;           // "warm oranges and reds", "cold blues", etc.
  
  // Character states (for continuity)
  characterStates: Array<{
    characterId: string;
    pose: string;                 // "mid-swing", "recoiling", "advancing"
    expression: string;           // "determined", "shocked", "victorious"
    position: string;             // "center frame", "background left"
  }>;
  
  // Environmental state
  environmentChanges?: string[];  // "overturned table", "scattered papers"
  
  // Action lines (comic book style)
  actionLines?: string;           // "motion blur on sword", "impact lines"
}

// Outcome-specific visuals for each choice
export interface ChoiceOutcomeVisuals {
  // Setup image (shown before choice is made)
  setupImage: CinematicImageDescription;
  
  // Outcome-specific images (shown based on skill check result)
  successImage: CinematicImageDescription;
  complicatedImage: CinematicImageDescription;
  failureImage: CinematicImageDescription;
  
  // Visual state changes that carry forward to next beat
  successStateChanges: VisualStateChange[];
  complicatedStateChanges: VisualStateChange[];
  failureStateChanges: VisualStateChange[];
}

// Visual state change that persists across beats
export interface VisualStateChange {
  type: 'character_position' | 'character_condition' | 'environment' | 'prop' | 'lighting';
  target: string;                 // Character ID, "environment", or prop name
  before: string;                 // Previous state
  after: string;                  // New state
  description: string;            // Human-readable description
}

// Accumulated visual state for the encounter
export interface EncounterVisualState {
  characterPositions: Record<string, string>;     // characterId -> position
  characterConditions: Record<string, string>;    // characterId -> condition (wounded, etc)
  environmentChanges: string[];                   // List of changes
  propsInPlay: string[];                          // Active props/objects
  currentLighting: string;                        // Current lighting state
  tensionLevel: number;                           // 1-10, affects camera intensity
}

// Camera escalation curve for the encounter
export interface CameraEscalationCurve {
  phases: {
    setup: {
      preferredAngles: CinematicCameraAngle[];
      preferredShots: CinematicShotType[];
      lightingStyle: string;
    };
    rising: {
      preferredAngles: CinematicCameraAngle[];
      preferredShots: CinematicShotType[];
      lightingStyle: string;
    };
    peak: {
      preferredAngles: CinematicCameraAngle[];
      preferredShots: CinematicShotType[];
      lightingStyle: string;
    };
    resolution: {
      preferredAngles: CinematicCameraAngle[];
      preferredShots: CinematicShotType[];
      lightingStyle: string;
    };
  };
}

// Storylet Beat (GDD 6.7)
export interface StoryletBeat {
  id: string;
  text: string;
  speaker?: string;
  speakerMood?: string;
  image?: string;
  audio?: string;
  choices?: Array<{
    id: string;
    text: string;
    nextBeatId?: string;
    consequences?: Consequence[];
  }>;
  nextBeatId?: string;
  isTerminal?: boolean;
  visualContract?: EncounterVisualContract;
  cost?: EncounterCost;
}

// Generated Storylet - aftermath sequences (GDD 6.7)
export interface GeneratedStorylet {
  id: string;
  name: string;
  triggerOutcome: 'victory' | 'partialVictory' | 'defeat' | 'escape';
  tone: 'triumphant' | 'bittersweet' | 'tense' | 'desperate' | 'relieved' | 'somber';
  narrativeFunction: string;
  beats: StoryletBeat[];
  startingBeatId: string;
  consequences: Consequence[];
  setsFlags?: { flag: string; value: boolean }[];
  nextSceneId?: string;
  cost?: EncounterCost;
}

export interface Encounter {
  id: string;
  type: EncounterType;
  style?: EncounterNarrativeStyle;
  name: string;
  description: string;
  
  // Clock system - visual progress tracking
  goalClock: EncounterClock;      // Player's objective
  threatClock: EncounterClock;    // Escalating danger
  
  // Stakes - what's at risk
  stakes: {
    victory: string;    // "You escape with the artifact"
    defeat: string;     // "You're captured and must be rescued"
  };

  // Phases of the encounter
  phases: EncounterPhase[];
  startingPhaseId: string;

  // Overall encounter results with story branching
  outcomes: {
    victory?: {
      nextSceneId: string;        // Main story continues
      consequences?: Consequence[];
      outcomeText: string;
    };
    partialVictory?: {
      nextSceneId: string;        // Main story but with complication
      consequences?: Consequence[];
      outcomeText: string;
      complication: string;       // What went wrong
      cost?: EncounterCost;
    };
    defeat?: {
      nextSceneId: string;        // Branch to recovery/side quest
      consequences?: Consequence[];
      outcomeText: string;
      recoveryPath?: string;      // Description of how to return
    };
    escape?: {
      nextSceneId: string;
      consequences?: Consequence[];
      outcomeText: string;
    };
  };
  
  // NEW: Storylets for tactical branching (GDD 6.7)
  storylets?: {
    victory?: GeneratedStorylet;
    partialVictory?: GeneratedStorylet;
    defeat?: GeneratedStorylet;
    escape?: GeneratedStorylet;
  };
  
  // NEW: Environmental elements (GDD 6.8.4)
  environmentalElements?: EnvironmentalElement[];
  
  // NEW: NPC states (GDD 6.8.5)
  npcStates?: NPCEncounterState[];
  
  // NEW: Escalation triggers (GDD 6.8.6)
  escalationTriggers?: EscalationTrigger[];
  
  // NEW: Information visibility (GDD 6.8.8)
  informationVisibility?: InformationVisibility;
  
  // NEW: Pixar stakes (GDD 4.6)
  pixarStakes?: PixarStakes;
  
  // Design metadata (preserved from generation)
  tensionCurve?: Array<{ beatId: string; tensionLevel: number; description: string }>;
  estimatedDuration?: string;
  replayability?: string;
  designNotes?: string;
  
  // Cinematic visual system
  cameraEscalation?: CameraEscalationCurve;       // How camera work escalates through phases
  initialVisualState?: EncounterVisualState;      // Starting visual state for first beat
}

// ========================================
// SCENE & EPISODE TYPES
// ========================================

export interface Scene {
  id: string;
  name: string;

  // Background/setting
  backgroundImage?: string;
  ambientSound?: string;

  // Content
  beats: Beat[];
  startingBeatId: string;

  // Or this scene is an encounter
  encounter?: Encounter;

  // Scene-level conditions (skip scene if not met)
  conditions?: ConditionExpression;

  // Fallback scene if conditions not met
  fallbackSceneId?: string;

  // Conditional auto-routing: ordered list of candidate next scenes.
  // The engine picks the FIRST scene whose conditions the player satisfies.
  // This is NOT player-driven branching — player-driven branching happens
  // via Choice.nextSceneId on any non-expression choice.
  // All Choice.nextSceneId values in this scene SHOULD target IDs in this list.
  leadsTo?: string[];
  
  // Branch metadata
  isBottleneck?: boolean;  // All paths must pass through this scene
  isConvergencePoint?: boolean;  // Multiple branches merge here
  branchType?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';  // Tone of this branch path
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  synopsis: string;
  coverImage: string;

  // Scenes in order
  scenes: Scene[];
  startingSceneId: string;

  // Requirements to unlock
  unlockConditions?: ConditionExpression;

  // What happens when episode completes
  onComplete?: Consequence[];
}

export interface Story {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  coverImage: string;

  // Author/metadata
  author?: string;
  tags?: string[];

  // Initial player state for this story
  initialState: {
    attributes: PlayerAttributes;
    skills: PlayerSkills;
    tags: string[];
    inventory: InventoryItem[];
  };

  // NPCs in this story (for relationship tracking)
  npcs: {
    id: string;
    name: string;
    description: string;
    role?: string;
    portrait?: string;
    pronouns?: string; // e.g., "she/her", "he/him", "they/them"
    initialRelationship?: Partial<Relationship>;
  }[];

  // Episodes
  episodes: Episode[];

  // Metadata (optional)
  outputDir?: string;
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

  // Scene history for back-tracking (if allowed)
  sceneHistory: string[];

  // Current encounter state (if in encounter)
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
}

// ========================================
// CONSEQUENCE BUDGET TYPES
// ========================================

export type ConsequenceBudgetCategory = 'callback' | 'tint' | 'branchlet' | 'branch';

// BudgetedConsequence adds budget category to any consequence type
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
  outcome: boolean;      // Changes what happens
  process: boolean;      // Changes how it happens
  information: boolean;  // Changes what is learned
  relationship: boolean; // Changes character bonds
  identity: boolean;     // Changes who protagonist is becoming
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
