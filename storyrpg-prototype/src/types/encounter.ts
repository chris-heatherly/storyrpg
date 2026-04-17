// ========================================
// ENCOUNTER TYPES (Complex Multi-Beat Sequences)
// ========================================

import type { ConditionExpression } from './conditions';
import type { Consequence } from './consequences';
import type {
  ConsequenceDomain,
  ReminderPlan,
  ChoiceFeedbackCue,
} from './choice';
import type { Beat } from './content';

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
  name: string;
  description: string;
  segments: number;
  filled: number;
  type: 'goal' | 'threat' | 'complication';
}

// Choice outcome determines how clocks are affected
export interface EncounterChoiceOutcome {
  tier: 'success' | 'complicated' | 'failure';
  goalTicks: number;
  threatTicks: number;
  narrativeText: string;
  outcomeImage?: string;
  consequences?: Consequence[];

  nextSituation?: {
    setupText: string;
    situationImage?: string;
    choices: EmbeddedEncounterChoice[];
    cinematicSetup?: CinematicImageDescription;
    visualContract?: EncounterVisualContract;
  };

  isTerminal?: boolean;
  encounterOutcome?: EncounterOutcome;
  cost?: EncounterCost;

  nextBeatId?: string;

  cinematicDescription?: CinematicImageDescription;
  visualContract?: EncounterVisualContract;

  visualStateChanges?: VisualStateChange[];

  visualDirection?: OutcomeVisualDirection;
}

// Embedded choice for branching tree (avoids circular reference)
export interface EmbeddedEncounterChoice {
  id: string;
  text: string;
  approach: string;
  primarySkill?: string;
  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;

  outcomes: {
    success: EncounterChoiceOutcome;
    complicated: EncounterChoiceOutcome;
    failure: EncounterChoiceOutcome;
  };

  skillAdvantage?: SkillAdvantage;

  conditions?: ConditionExpression;
  showWhenLocked?: boolean;
  lockedText?: string;
  statBonus?: {
    condition: ConditionExpression;
    difficultyReduction: number;
    flavorText?: string;
  };
}

export type EncounterApproach =
  | 'aggressive'
  | 'cautious'
  | 'clever'
  | 'desperate'
  | 'adaptive';

export type NPCDisposition = 'confident' | 'wary' | 'desperate' | 'enraged' | 'calculating';

export interface SkillAdvantage {
  skill: string;
  advantageLevel: 'slight' | 'significant' | 'mastery';
  flavorText: string;
}

export interface OutcomeVisualDirection {
  cameraAngle: 'low_heroic' | 'high_diminished' | 'dutch_unstable' | 'eye_level';
  shotType: 'dramatic_closeup' | 'action_wide' | 'reaction_medium' | 'impact_freeze';
  mood: 'triumphant' | 'tense' | 'desperate' | 'bittersweet';
}

export interface EncounterChoice {
  id: string;
  text: string;
  approach: string;
  primarySkill?: string;
  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;

  outcomes: {
    success: EncounterChoiceOutcome;
    complicated: EncounterChoiceOutcome;
    failure: EncounterChoiceOutcome;
  };

  impliedApproach?: EncounterApproach;

  skillAdvantage?: SkillAdvantage;

  specialChoiceType?: 'press_your_luck' | 'desperate_gambit' | 'environmental' | 'signature_move';

  conditions?: ConditionExpression;
  showWhenLocked?: boolean;
  lockedText?: string;

  statBonus?: {
    condition: ConditionExpression;
    difficultyReduction: number;
    flavorText?: string;
  };
}

export interface EncounterBeat {
  id: string;
  phase: 'setup' | 'rising' | 'peak' | 'resolution';
  name: string;

  setupText: string;
  situationImage?: string;

  setupTextVariants?: Array<{ condition: ConditionExpression; text: string }>;

  choices: EncounterChoice[];

  escalationText?: string;
  escalationImage?: string;

  cinematicSetup?: CinematicImageDescription;
  visualContract?: EncounterVisualContract;
  visualDirection?: OutcomeVisualDirection;

  inheritedVisualState?: EncounterVisualState;
}

export interface EncounterPhase {
  id: string;
  name: string;
  description: string;
  situationImage: string;
  beats: (Beat | EncounterBeat)[];

  successThreshold?: number;
  failureThreshold?: number;

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
  initialOddsAgainst: number;
  whatPlayerLoses: string;
  oddsAgainstNarrative: string;
  stackedObstacles: string[];
}

// ========================================
// ENCOUNTER CINEMATIC SYSTEM
// ========================================

export type CinematicCameraAngle =
  | 'wide_establishing'
  | 'medium_action'
  | 'close_dramatic'
  | 'low_heroic'
  | 'high_vulnerability'
  | 'dutch_chaos'
  | 'over_shoulder'
  | 'reaction_shot';

export type CinematicShotType =
  | 'establishing'
  | 'action_moment'
  | 'impact'
  | 'reaction'
  | 'consequence'
  | 'tension_hold';

export type CinematicMood =
  | 'anticipation'
  | 'dynamic_action'
  | 'triumphant'
  | 'desperate'
  | 'tense_uncertainty'
  | 'relief'
  | 'dread';

export interface CinematicImageDescription {
  sceneDescription: string;
  focusSubject: string;
  secondaryElements: string[];

  cameraAngle: CinematicCameraAngle;
  shotType: CinematicShotType;
  cameraMotionHint?: string;

  mood: CinematicMood;
  lightingDirection: string;
  colorPalette: string;

  characterStates: Array<{
    characterId: string;
    pose: string;
    expression: string;
    position: string;
  }>;

  environmentChanges?: string[];

  actionLines?: string;
}

export interface ChoiceOutcomeVisuals {
  setupImage: CinematicImageDescription;

  successImage: CinematicImageDescription;
  complicatedImage: CinematicImageDescription;
  failureImage: CinematicImageDescription;

  successStateChanges: VisualStateChange[];
  complicatedStateChanges: VisualStateChange[];
  failureStateChanges: VisualStateChange[];
}

export interface VisualStateChange {
  type: 'character_position' | 'character_condition' | 'environment' | 'prop' | 'lighting';
  target: string;
  before: string;
  after: string;
  description: string;
}

export interface EncounterVisualState {
  characterPositions: Record<string, string>;
  characterConditions: Record<string, string>;
  environmentChanges: string[];
  propsInPlay: string[];
  currentLighting: string;
  tensionLevel: number;
}

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

  goalClock: EncounterClock;
  threatClock: EncounterClock;

  stakes: {
    victory: string;
    defeat: string;
  };

  phases: EncounterPhase[];
  startingPhaseId: string;

  outcomes: {
    victory?: {
      nextSceneId: string;
      consequences?: Consequence[];
      outcomeText: string;
    };
    partialVictory?: {
      nextSceneId: string;
      consequences?: Consequence[];
      outcomeText: string;
      complication: string;
      cost?: EncounterCost;
    };
    defeat?: {
      nextSceneId: string;
      consequences?: Consequence[];
      outcomeText: string;
      recoveryPath?: string;
    };
    escape?: {
      nextSceneId: string;
      consequences?: Consequence[];
      outcomeText: string;
    };
  };

  storylets?: {
    victory?: GeneratedStorylet;
    partialVictory?: GeneratedStorylet;
    defeat?: GeneratedStorylet;
    escape?: GeneratedStorylet;
  };

  environmentalElements?: EnvironmentalElement[];

  npcStates?: NPCEncounterState[];

  escalationTriggers?: EscalationTrigger[];

  informationVisibility?: InformationVisibility;

  pixarStakes?: PixarStakes;

  tensionCurve?: Array<{ beatId: string; tensionLevel: number; description: string }>;
  estimatedDuration?: string;
  replayability?: string;
  designNotes?: string;

  cameraEscalation?: CameraEscalationCurve;
  initialVisualState?: EncounterVisualState;
}
