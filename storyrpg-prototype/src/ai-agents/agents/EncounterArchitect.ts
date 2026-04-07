/**
 * Encounter Architect Agent
 *
 * The encounter design specialist responsible for:
 * - Structuring complex encounters with escalation beats
 * - Designing skill challenges and their difficulty curves
 * - Creating storylets for tactical branching (victory/defeat/escape paths)
 * - Generating environmental elements (hazards & opportunities)
 * - NPC reaction systems with dispositions and tells
 * - Escalation triggers at threat thresholds
 * - Visual direction per phase and outcome
 * - Implementing Pixar's "Stack the Odds Against" principle
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentMessage, AgentResponse } from './BaseAgent';
import { 
  CinematicImageDescription, 
  EncounterCost,
  EncounterApproach, 
  EncounterNarrativeStyle,
  EncounterOutcome,
  EncounterVisualContract,
  EncounterType,
  NPCDisposition,
  Relationship,
} from '../../types';

import { GeneratedStoryletDraft as GeneratedStorylet, StoryletBeatDraft as StoryletBeat } from '../types/encounterDraft';
import { StateChange } from '../types/llm-output';
import {
  analyzeRelationshipDynamics,
  RelationshipDynamicsBrief,
  RelationshipSnapshot,
  NPCInfo,
} from '../utils/relationshipDynamics';

// Re-export for consumers that import from this file
export type { EncounterApproach, NPCDisposition } from '../../types';
export type { StateChange } from '../types/llm-output';
export type { GeneratedStoryletDraft as GeneratedStorylet, StoryletBeatDraft as StoryletBeat } from '../types/encounterDraft';

// ========================================
// ESCALATION & APPROACH TYPES
// ========================================

export type EscalationPhase = 'setup' | 'rising' | 'peak' | 'resolution';

// ========================================
// INPUT TYPES
// ========================================

export interface EncounterArchitectInput {
  // Scene context
  sceneId: string;
  sceneName: string;
  sceneDescription: string;
  sceneMood: string;
  plannedEncounterId?: string;

  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    userPrompt?: string;
  };

  // Encounter details
  encounterType: EncounterType;
  encounterStyle?: EncounterNarrativeStyle;
  encounterDescription: string;
  encounterStakes?: string;
  encounterRequiredNpcIds?: string[];
  encounterRelevantSkills?: string[];
  encounterBeatPlan?: string[];
  difficulty: 'easy' | 'moderate' | 'hard' | 'extreme';
  partialVictoryCost?: Partial<EncounterCost>;

  // Protagonist info
  protagonistInfo: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    physicalDescription?: string;
    relevantSkills?: Array<{ name: string; level: number }>;
  };

  // NPCs involved
  npcsInvolved: Array<{
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    role: 'ally' | 'enemy' | 'neutral' | 'obstacle';
    description: string;
    physicalDescription?: string;
  }>;

  // Available skills for challenges
  availableSkills: Array<{
    name: string;
    attribute: string;
    description: string;
  }>;

  // Target structure
  targetBeatCount: number; // Usually 3-5 beats per encounter

  // Scene connections for storylets
  victoryNextSceneId?: string;
  defeatNextSceneId?: string;

  // Pre-encounter state context: flags and relationship thresholds from earlier scenes
  // that are designed to echo inside this encounter as narrative shading, unlocked choices,
  // or difficulty bonuses. Sourced from SceneBlueprint.encounterSetupContext.
  priorStateContext?: {
    // Flags that prior choices may have set, with a description of their intended echo
    relevantFlags: Array<{
      name: string;        // Flag name, e.g. "defended_heathcliff"
      description: string; // What it means and how it should echo
      alreadySet?: boolean; // True if a prior scene already sets this flag; false/undefined = set by a later scene
    }>;
    // Relationships with NPCs in this encounter, and the threshold that matters
    relevantRelationships: Array<{
      npcId: string;
      npcName: string;
      dimension: 'trust' | 'affection' | 'respect' | 'fear';
      operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
      threshold: number;   // The threshold value (e.g. -20 or 30)
      description: string; // How crossing/missing this threshold should manifest
      authored?: boolean;
      currentMaxValue?: number; // Max achievable value given initial + prior scene changes
    }>;
    // Human-readable summary of notable choices the player may have made
    significantChoices: string[];
  };

  // Growth context from scene blueprint (when competenceArc is available)
  competenceArc?: {
    testsNow?: string;
    shortfall?: string;
    growthPath?: string;
  };

  // Pipeline memory / optimization hints from prior runs (optional)
  memoryContext?: string;
}

// ========================================
// PHASED GENERATION TYPES
// ========================================

/** Phase 1 output: opening beat with choice-specific outcome narratives */
export interface Phase1Result {
  sceneId: string;
  encounterType: string;
  goalClock: { name: string; segments: number; description: string };
  threatClock: { name: string; segments: number; description: string };
  stakes: { victory: string; defeat: string };
  openingBeat: {
    setupText: string;
    choices: Array<{
      id: string;
      text: string;
      approach: string;
      primarySkill: string;
      impliedApproach?: string;
      outcomes: {
        success: { narrativeText: string; goalTicks: number; threatTicks: number };
        complicated: { narrativeText: string; goalTicks: number; threatTicks: number };
        failure: { narrativeText: string; goalTicks: number; threatTicks: number };
      };
    }>;
  };
}

/** Phase 2 output: branch situations for one choice */
export interface Phase2Result {
  choiceId: string;
  afterSuccess: Phase2Situation;
  afterComplicated: Phase2Situation;
  afterFailure: Phase2Situation;
}

export interface Phase2Situation {
  setupText: string;
  choices: Array<{
    id: string;
    text: string;
    approach: string;
    primarySkill: string;
    outcomes: {
      success: Phase2Outcome;
      complicated: Phase2Outcome;
      failure: Phase2Outcome;
    };
  }>;
}

export interface Phase2Outcome {
  narrativeText: string;
  goalTicks: number;
  threatTicks: number;
  isTerminal: boolean;
  encounterOutcome?: string;
  relationshipConsequences?: Array<{
    npcId: string;
    dimension: string;
    change: number;
    reason: string;
  }>;
}

/** Phase 3 output: enrichment patch */
export interface Phase3Result {
  setupTextVariants?: Array<{
    condition: Record<string, unknown>;
    text: string;
  }>;
  statBonuses?: Array<{
    choiceRef: string;
    condition: Record<string, unknown>;
    difficultyReduction: number;
    flavorText?: string;
  }>;
  conditionalChoices?: Array<{
    id: string;
    text: string;
    approach: string;
    primarySkill: string;
    conditions: Record<string, unknown>;
    showWhenLocked?: boolean;
    lockedText?: string;
    outcomes: {
      success: { narrativeText: string; goalTicks: number; threatTicks: number };
      complicated: { narrativeText: string; goalTicks: number; threatTicks: number };
      failure: { narrativeText: string; goalTicks: number; threatTicks: number };
    };
  }>;
}

/** Phase 4 output: storylets */
export interface Phase4Result {
  victory: GeneratedStorylet;
  defeat: GeneratedStorylet;
  escape?: GeneratedStorylet;
  partialVictory?: GeneratedStorylet;
}

// ========================================
// CHOICE & OUTCOME TYPES
// ========================================

// Embedded choice for branching trees (avoids circular type reference)
export interface EmbeddedEncounterChoice {
  id: string;
  text: string;           // Short action-oriented choice text ("Swing at his head")
  approach: string;       // "careful", "bold", "clever", etc.
  primarySkill?: string;  // Skill that influences outcome
  outcomes: {
    success: EncounterChoiceOutcome;
    complicated: EncounterChoiceOutcome;
    failure: EncounterChoiceOutcome;
  };
}

export interface EncounterChoiceOutcome {
  tier: 'success' | 'complicated' | 'failure';
  narrativeText: string;  // THE ACTION RESULT - what happens when you swing the sword, make the plea, etc.
  goalTicks: number;
  threatTicks: number;
  outcomeImage?: string; // Generated image URL showing THE ACTION RESULT (filled by pipeline)
  consequences?: StateChange[]; // Converted to Consequence[] in FullStoryPipeline
  
  // === BRANCHING TREE: Embedded next situation ===
  // Each outcome contains its own next situation with new choices.
  // SUCCESS leads to a different future than FAILURE.
  nextSituation?: {
    setupText: string;          // The new situation arising from this outcome
    situationImage?: string;    // Visual of new situation (filled by pipeline)
    choices: EmbeddedEncounterChoice[];  // New choices in this branch
    cinematicSetup?: CinematicImageDescription;
    visualContract?: EncounterVisualContract;
  };
  
  // Terminal outcome - this branch ends the encounter
  isTerminal?: boolean;
  encounterOutcome?: EncounterOutcome;
  cost?: EncounterCost;
  
  // Legacy: nextBeatId for backward compatibility
  nextBeatId?: string;
  
  // Cinematic visual description for the OUTCOME image (THE ACTION RESULT)
  cinematicDescription?: CinematicImageDescription;
  visualContract?: EncounterVisualContract;
  
  // Visual state changes to carry forward
  visualStateChanges?: Array<{
    type: 'character_position' | 'character_condition' | 'environment' | 'prop' | 'lighting';
    target: string;
    before: string;
    after: string;
    description: string;
  }>;
  
  // Legacy visual direction
  visualDirection?: {
    cameraAngle: 'low_heroic' | 'high_diminished' | 'dutch_unstable' | 'eye_level';
    shotType: 'dramatic_closeup' | 'action_wide' | 'reaction_medium' | 'impact_freeze';
    mood: 'triumphant' | 'tense' | 'desperate' | 'bittersweet';
  };
}

export interface SkillAdvantage {
  skill: string;
  advantageLevel: 'slight' | 'significant' | 'mastery';
  flavorText: string;
}

export interface EncounterChoice {
  id: string;
  text: string;
  approach: string;
  primarySkill?: string;
  
  // Pre-generated outcomes for each tier
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
  
  // Legacy fields
  consequences?: StateChange[];
  nextBeatId?: string;

  // Pre-encounter state payoff: conditional availability
  conditions?: object;        // ConditionExpression — flag/relationship/attribute/score check
  showWhenLocked?: boolean;
  lockedText?: string;

  // Pre-encounter state payoff: difficulty reduction when condition is met
  statBonus?: {
    condition: object;          // ConditionExpression
    difficultyReduction: number;
    flavorText?: string;
  };
}

// ========================================
// BEAT TYPES
// ========================================

export interface EncounterBeat {
  id: string;
  phase: EscalationPhase;
  name: string;
  description: string;
  setupText: string;

  // Pre-encounter state payoff: conditional situation text variants.
  // First matching condition's text replaces setupText at runtime.
  setupTextVariants?: Array<{ condition: object; text: string }>;
  
  // Player choices (minimum 3 per beat)
  choices?: EncounterChoice[];
  
  // Skill challenge (legacy)
  challenge?: SkillChallenge;
  
  // Image sequence
  imageSequence?: ImageSequenceSpec;
  
  // Cinematic visual system - describes the beat's visual presentation (matches types/index.ts)
  cinematicSetup?: CinematicImageDescription;
  situationImage?: string; // Generated image URL (filled by pipeline)
  visualContract?: EncounterVisualContract;
  
  // Visual direction for this phase (legacy)
  visualDirection?: {
    cameraStyle: 'wide_establishing' | 'medium_action' | 'dramatic_closeups' | 'reaction_shots';
    lighting: 'neutral' | 'increasing_contrast' | 'high_contrast_colored' | 'appropriate_to_outcome';
    mood: 'anticipation' | 'tension_building' | 'maximum_intensity' | 'release';
  };
  
  // State implications
  stateChangesOnSuccess?: StateChange[];
  stateChangesOnFailure?: StateChange[];

  // Flow control
  nextBeatOnSuccess?: string;
  nextBeatOnFailure?: string;
  isTerminal?: boolean;
  
  // Escalation text when threat is high (>=50%)
  escalationText?: string;
  escalationImage?: string;
}

export interface SkillChallenge {
  primarySkill: string;
  alternateSkills?: string[];
  baseDifficulty: number;
  difficultyModifiers?: Array<{
    condition: string;
    modifier: number;
    description: string;
  }>;
  narrativeFraming: string;
}

export interface ImageSequenceSpec {
  frameCount: number;
  keyframes: Array<{
    index: number;
    description: string;
    mood: string;
    focusElement: string;
    cameraAngle: 'wide' | 'medium' | 'close-up' | 'low-angle' | 'high-angle' | 'dutch-angle' | 'over-the-shoulder';
    composition: string;
  }>;
  transitionStyle: 'cut' | 'fade' | 'pan' | 'zoom';
  durationSeconds: number;
}

// StateChange is imported from ../types/llm-output
// See that file for documentation on the type mapping

// ========================================
// ENVIRONMENTAL ELEMENTS
// ========================================

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
  visualDescription: string;
}

// ========================================
// NPC REACTION SYSTEM
// ========================================

export interface NPCEncounterState {
  npcId: string;
  name: string;
  initialDisposition: NPCDisposition;
  reactionToAggressive: string;
  reactionToCautious: string;
  reactionToClever: string;
  tells: Array<{
    revealCondition: 'encounter_50_percent' | 'high_threat' | 'player_success' | 'player_failure';
    tellDescription: string;
  }>;
  dispositionShifts: Array<{
    trigger: 'player_success' | 'player_failure' | 'threat_high' | 'goal_high';
    newDisposition: NPCDisposition;
    narrativeHint: string;
  }>;
}

// ========================================
// ESCALATION TRIGGERS
// ========================================

export interface EscalationTrigger {
  id: string;
  condition: {
    type: 'threat_threshold' | 'beat_number' | 'consecutive_failures';
    value: number;
  };
  effect: {
    narrativeText: string;
    newComplication?: string;
    threatBonus?: number;
    unlockEscapeOption?: boolean;
    pointOfNoReturn?: boolean;
  };
}

// ========================================
// INFORMATION VISIBILITY (Fog of War)
// ========================================

export interface InformationVisibility {
  threatClockVisible: boolean;
  threatClockApproximate?: 'manageable' | 'growing' | 'dangerous' | 'critical';
  npcTellsRevealAt: 'encounter_50_percent' | 'immediate' | 'never';
  environmentElementsHidden: string[];
  choiceOutcomesUnknown: boolean;
}

// ========================================
// PIXAR STAKES (Rule #16)
// ========================================

export interface PixarStakes {
  initialOddsAgainst: number; // Target: 60-70%
  whatPlayerLoses: string;
  oddsAgainstNarrative: string;
  stackedObstacles: string[];
}

// ========================================
// MAIN OUTPUT STRUCTURE
// ========================================

export interface EncounterStructure {
  id?: string; // Optional: auto-generated as `${sceneId}-encounter` if not provided
  sceneId: string;
  encounterType: EncounterType;
  encounterStyle?: EncounterNarrativeStyle;
  beats: EncounterBeat[];
  startingBeatId: string;
  
  // Clocks
  goalClock: {
    name: string;
    segments: number;
    description: string;
  };
  threatClock: {
    name: string;
    segments: number;
    description: string;
  };
  
  // Stakes
  stakes: {
    victory: string;
    defeat: string;
  };

  // Escalation curve
  tensionCurve: TensionPoint[];
  
  // NEW: Storylets for tactical branching
  storylets: {
    victory: GeneratedStorylet;
    partialVictory?: GeneratedStorylet;
    defeat: GeneratedStorylet;
    escape?: GeneratedStorylet;
  };
  partialVictoryCost?: EncounterCost;
  
  // NEW: Environmental elements
  environmentalElements: EnvironmentalElement[];
  
  // NEW: NPC states
  npcStates: NPCEncounterState[];
  
  // NEW: Escalation triggers
  escalationTriggers: EscalationTrigger[];
  
  // NEW: Information visibility settings
  informationVisibility: InformationVisibility;
  
  // NEW: Pixar stakes
  pixarStakes?: PixarStakes;

  // Pixar principles integration
  pixarSurprise?: {
    setup: string;      // What audience expects
    twist: string;      // What actually happens
    satisfaction: string; // Why it works (inevitable in hindsight)
  };
  pixarCausality?: {
    because: string[];  // Each beat happens BECAUSE of the previous
    therefore: string[];// Each beat leads THEREFORE to the next
  };

  // Metadata
  estimatedDuration: string;
  replayability: string;
  designNotes: string;
}

export interface TensionPoint {
  beatId: string;
  tensionLevel: number;
  description: string;
}

// ========================================
// ENCOUNTER ARCHITECT CLASS
// ========================================

export class EncounterArchitect extends BaseAgent {
  private getMinimumRequiredBeatCount(input: EncounterArchitectInput): number {
    return 2;
  }

  constructor(config: AgentConfig) {
    super('Encounter Architect', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Encounter Architect

You design BRANCHING TREE encounters where every choice outcome leads to a genuinely DIFFERENT future. This is NOT a linear sequence - it's an action movie where success and failure create completely different situations.

## CRITICAL: ACTION → REACTION FLOW

**The player experiences encounters as:**
1. **SEE THE SITUATION** - "The guard swings at your head"
2. **MAKE A CHOICE** - "Duck and sweep his legs" / "Block with your blade" / "Leap backward"
3. **SEE THE RESULT** - The image shows your leg sweep connecting (or missing)
4. **NEW SITUATION + NEW CHOICES** - "He crashes to the ground, but shouts for help. You hear boots in the corridor."

**CRITICAL**: The outcome of each choice creates a DIFFERENT next situation:
- SUCCESS at the leg sweep → He's down, you have a moment → different choices
- FAILURE at the leg sweep → He dodges, you're off-balance → different choices
- COMPLICATED → He falls but grabs your ankle → different choices

**This is NOT**: choice → result → same next beat for everyone

## BRANCHING TREE STRUCTURE (Not Linear Beats)

Instead of beats pointing to the same next beat, EACH OUTCOME contains its own embedded \`nextSituation\`:

\`\`\`
BEAT 1 (Setup)
├── Choice: "Swing at his head"
│   ├── SUCCESS → nextSituation: "He reels back, sword clattering away" → new choices
│   ├── COMPLICATED → nextSituation: "Blades lock, you're face to face" → new choices  
│   └── FAILURE → nextSituation: "He parries and counter-attacks" → new choices
└── Choice: "Feint low, strike high"
    ├── SUCCESS → nextSituation: "Your blade finds his shoulder" → new choices
    ├── COMPLICATED → nextSituation: "He saw through it partially" → new choices
    └── FAILURE → nextSituation: "He reads you completely" → new choices
\`\`\`

## Core Design Philosophy

### Fiction-First Challenges
- Skills expressed through narrative, not numbers
- "The gap looks dangerously wide" not "DC 15 Athletics check"
- Outcomes described narratively with mechanical effects hidden

### Three-Tier Resolution - GENUINELY DIFFERENT OUTCOMES
Every choice has three possible outcomes that lead to DIFFERENT situations:
1. **SUCCESS**: Achieve your intent - leads to advantageous new situation
2. **COMPLICATED**: Partial success with cost - leads to challenging new situation
3. **FAILURE**: Setback - leads to disadvantageous new situation

**Each outcome's nextSituation has DIFFERENT choices reflecting the new reality.**

### Dual Clock System (Blades in the Dark inspired)
- **Goal Clock**: Player's objective progress (typically 6 segments)
- **Threat Clock**: Escalating danger (typically 4-6 segments)
- Victory when goal fills first; defeat when threat fills first

## OUTCOME IMAGES: Show THE ACTION RESULT

**CRITICAL**: The outcome image shows the RESULT of the player's action:
- Player chose "Swing at his head" → SUCCESS image shows the sword CONNECTING
- Player chose "Swing at his head" → FAILURE image shows the opponent BLOCKING/DODGING
- Player chose "Plead for mercy" → SUCCESS shows the NPC's expression SOFTENING
- Player chose "Plead for mercy" → FAILURE shows the NPC's expression HARDENING

**This is NOT** a generic "setup for next beat" image. It's the PAYOFF of their choice.

## CINEMATIC VISUAL SYSTEM

Every setup beat, outcome, embedded nextSituation, and storylet beat should also include a \`visualContract\` object that locks:
- \`visualMoment\`
- \`primaryAction\`
- \`emotionalRead\`
- \`relationshipDynamic\`
- \`mustShowDetail\`
- \`keyExpression\`
- \`keyGesture\`
- \`keyBodyLanguage\`
- \`shotDescription\`
- \`emotionalCore\`
- \`visualNarrative\`

### Outcome cinematicDescription - THE ACTION RESULT
The \`cinematicDescription\` in each outcome shows the MOMENT OF IMPACT:

**SUCCESS Image**: The action SUCCEEDS
\`\`\`json
{
  "cinematicDescription": {
    "sceneDescription": "The protagonist's blade connects with the guard's shoulder, blood spraying",
    "focusSubject": "impact moment - blade meeting flesh",
    "cameraAngle": "low_heroic",
    "shotType": "impact",
    "mood": "triumphant",
    "characterStates": [
      { "characterId": "protagonist", "pose": "follow-through of strike", "expression": "fierce triumph" },
      { "characterId": "guard", "pose": "recoiling from wound", "expression": "shock and pain" }
    ]
  },
  "visualContract": {
    "visualMoment": "The strike lands and the balance of power visibly flips.",
    "primaryAction": "protagonist drives the blade through the guard's defense",
    "emotionalRead": "triumph mixed with lethal commitment",
    "relationshipDynamic": "the guard finally loses physical control of the confrontation",
    "mustShowDetail": "the point of contact where the blade connects",
    "keyExpression": "fierce triumph on the protagonist, shock on the guard",
    "keyGesture": "follow-through of the strike with the guard clutching the wound",
    "keyBodyLanguage": "momentum forward from the protagonist, recoil backward from the guard",
    "shotDescription": "tight impact frame with readable faces and weapon contact",
    "emotionalCore": "decisive reversal",
    "visualNarrative": "The image must prove that the protagonist's action succeeded."
  }
}
\`\`\`

**FAILURE Image**: The action FAILS
\`\`\`json
{
  "cinematicDescription": {
    "sceneDescription": "The guard deflects the blow, protagonist's blade sliding harmlessly past",
    "focusSubject": "the parry - guard's blade redirecting the strike",
    "cameraAngle": "high_vulnerability",
    "shotType": "impact",
    "mood": "desperate",
    "characterStates": [
      { "characterId": "protagonist", "pose": "overextended, off-balance", "expression": "alarm" },
      { "characterId": "guard", "pose": "controlled parry, setting up counter", "expression": "confident menace" }
    ]
  }
}
\`\`\`

### nextSituation.cinematicSetup - The NEW Situation
The embedded nextSituation has its own visual setup for the new moment:

\`\`\`json
{
  "nextSituation": {
    "setupText": "The guard staggers back clutching his shoulder. Behind him, you see the cell door - and the keys on his belt.",
    "choices": [...],
    "visualContract": {
      "visualMoment": "A brief opening appears as the wounded guard leaves the keys exposed.",
      "primaryAction": "protagonist spots the keys while the guard struggles to recover",
      "emotionalRead": "pain, urgency, and sudden possibility share the frame",
      "relationshipDynamic": "the guard is still dangerous but no longer fully in control",
      "mustShowDetail": "the keys glinting on the guard's belt",
      "shotDescription": "medium tension frame that keeps the obstacle and opportunity readable",
      "visualNarrative": "The new situation should be understandable at a glance."
    },
    "cinematicSetup": {
      "sceneDescription": "Wounded guard between protagonist and cell door, keys glinting",
      "focusSubject": "protagonist, eyes on the keys",
      "cameraAngle": "medium_action",
      "shotType": "tension_hold",
      "mood": "anticipation"
    }
  }
}
\`\`\`

## TERMINAL OUTCOMES

Some outcomes END the encounter:
- Success that fills the goal clock → \`isTerminal: true, encounterOutcome: "victory"\`
- Failure that fills threat clock → \`isTerminal: true, encounterOutcome: "defeat"\`
- Finding an escape route → \`isTerminal: true, encounterOutcome: "escape"\`

Terminal outcomes don't have nextSituation - they end the encounter.

## DEPTH LIMITS

To prevent infinite trees:
- Maximum 3-4 "layers" of choices
- After 2-3 layers, outcomes should become terminal
- OR outcomes can share nextSituations (some convergence is OK)

## STORYLETS (Encounter Aftermath — Growth Arcs)

Each encounter outcome (victory/defeat/escape) leads to a storylet that serves as an emotional and mechanical bridge. Storylets are where the player SEES their character grow. Every storylet must include consequence objects that produce visible character development.

### Victory Storylets (2 beats)
- **Beat 1 — Triumph**: Celebrate the achievement in-scene. Show the world reacting to success. (2-3 sentences)
- **Beat 2 — Forward Momentum**: What this victory means going forward. The character recognizes their growth. (1-2 sentences, terminal)
- **Consequences**: Include attribute or skill increases reflecting the skill that drove success (e.g. +3 to the primary skill used, +2 courage if it was a brave act). Also include the confidence score bump and victory flag.

### Defeat Storylets (3 beats — Learning Arc)
- **Beat 1 — Impact**: The immediate aftermath. Show the cost of failure viscerally — what was lost, what went wrong. Somber but NOT hopeless. (2-3 sentences)
- **Beat 2 — Reflection/Learning**: The character processes what happened. A mentor, ally, or inner monologue reveals what could be done differently. Reference the primary skill that was tested and frame growth narratively ("You realize brute force won't work — you need to think smarter."). (2-3 sentences)
- **Beat 3 — Resolve**: The character commits to moving forward, changed by the experience. A moment of determination that sets up future encounters. (1-2 sentences, terminal)
- **Consequences**: Include a positive attribute/skill increase reflecting growth from adversity (e.g. +3 resolve, +2 to a skill the character is developing). Also include the setback score and defeat flag. If an NPC witnessed the failure, include a relationship shift.

### Escape Storylets (2 beats)
- **Beat 1 — Close Call**: The tension of barely getting away. What was left behind. (2-3 sentences)
- **Beat 2 — Assessment**: Taking stock. What was gained and lost. The character is wiser but the challenge remains. (1-2 sentences, terminal)
- **Consequences**: Include +2 resourcefulness or a relevant survival skill. Set the escape flag.

### Storylet Design Rules
- Unique tone per outcome (triumphant/somber/relieved/bittersweet)
- Sets flags for later narrative callbacks
- Reconverges to main story path
- ALWAYS include at least one attribute or skill consequence that represents growth
- Defeat storylets MUST feel like the beginning of a recovery arc, not a dead end

## PRIOR STATE PAYOFF

Encounters are more powerful when they remember what the player did before them. If the input includes a \`priorStateContext\`, use it to author conditional content that makes earlier choices echo inside the encounter.

**Three payoff mechanisms — use all three where appropriate:**

### 1. setupTextVariants (Narrative shading)
On any encounter beat, add \`setupTextVariants\` alongside \`setupText\`. Each variant has a \`condition\` and a \`text\` that replaces the base text when the condition is true at runtime. Use this for NPC dialogue that changes tone, environmental details referencing a prior choice, or a character noticing something the player did.

Condition format (runtime-evaluated against player state):
\`{ "type": "flag", "flag": "defended_protagonist", "value": true }\`
\`{ "type": "relationship", "npcId": "hindley", "dimension": "trust", "operator": "<", "value": -20 }\`
\`{ "type": "score", "score": "heathcliff_bond", "operator": ">=", "value": 10 }\`

### 2. Conditional Choices (Unlocked options)
Add \`conditions\` to a choice to make it only available to players who built the right state. Use \`showWhenLocked: true\` and \`lockedText\` to hint at what would unlock it. This creates "my choices mattered" moments.

\`\`\`
"conditions": { "type": "flag", "flag": "defended_heathcliff", "value": true },
"showWhenLocked": true,
"lockedText": "You'd need to have stood up for Heathcliff earlier"
\`\`\`

### 3. statBonus (Difficulty reduction)
Add \`statBonus\` when a prior state should make a check easier. The choice is still available without it — just harder.

\`\`\`
"statBonus": {
  "condition": { "type": "relationship", "npcId": "hindley", "dimension": "trust", "operator": ">=", "value": 10 },
  "difficultyReduction": 20,
  "flavorText": "Your earlier honesty with him softens his stance"
}
\`\`\`

**Guidelines:**
- Add at least 1 \`setupTextVariants\` entry per beat when \`priorStateContext\` is provided
- Add 1–2 conditional choices across the whole encounter (not per beat) where a prior flag/relationship genuinely opens a new path
- Add a \`statBonus\` to 1–2 choices that have clear emotional logic (trust = easier persuasion)
- Keep shading subtle — a textVariant should feel like the world remembering, not a pop-up reward
- Conditional choices are one path among others, not a bypass to victory

---

## SKILL-DRIVEN BRANCHING AND GROWTH

Encounters should drive character growth through meaningful skill checks. Follow these principles:

### Every Situation Must Exercise a Skill
Each situation in the encounter tree should have at least one choice whose \`primarySkill\` matches a core attribute or skill the story is developing. Players should feel that the encounter is testing and building specific competencies.

### Failure Branches Create Recovery and Growth Opportunities
When a choice leads to failure, the resulting \`nextSituation\` should NOT simply repeat the same check. Instead, reframe the challenge AND create a growth opportunity:
- Offer a different angle on the same problem (failed persuasion → try empathy; failed force → try cunning)
- Introduce a new element that changes the situation (an ally appears, an opportunity emerges)
- Scale the stakes — the player can still recover, but the path is narrower
- Include a skill consequence in the failure recovery path: the character LEARNS from failure (+3 to +5 to a relevant skill)
- If the scene blueprint has a competenceArc, reference the tested skills and offer growth in the recovery choices
- Failure is a detour through growth, not a dead end

### Complicated Outcomes Create the Richest Branching
The "complicated" tier should produce the most interesting narrative branching. These outcomes should:
- Grant partial progress (1 goal tick) but also add danger (1 threat tick)
- Present genuinely different choices than the success/failure branches
- Create "the price of partial success" moments that force identity-defining decisions

### Consequences Should Be Skill-Relevant
Outcomes should include consequences that match the skill being tested:
- A successful athletics check: \`{ "type": "score", "name": "athletic_confidence", "change": 2 }\` or similar
- A failed social check: show the relationship shifting, not just a generic setback

---

## PIXAR'S RULE #16: Stack the Odds Against

- Initial odds should favor failure (60-70%)
- Consequences must be PERSONAL, not abstract
- Success must feel EARNED
`;
  }

  private static readonly PER_CALL_TIMEOUT_MS = 120_000; // 2 minutes per LLM call

  async execute(
    input: EncounterArchitectInput,
    playerRelationships?: Record<string, Relationship>,
    allNpcs?: NPCInfo[],
  ): Promise<AgentResponse<EncounterStructure>> {
    console.log(`[EncounterArchitect] Designing encounter for scene: ${input.sceneId}`);

    try {
      return await this.executePhased(input, playerRelationships, allNpcs);
    } catch (phasedError) {
      const msg = phasedError instanceof Error ? phasedError.message : String(phasedError);
      console.warn(`[EncounterArchitect] Phased generation failed for ${input.sceneId}, falling back to legacy flow: ${msg}`);
    }

    // Legacy fallback: lean prompt → retry → deterministic
    const minimumBeatCount = this.getMinimumRequiredBeatCount(input);
    let lastError: string | undefined;
    let lastRawResponse: string | undefined;
    const attemptSummaries: Array<{
      attempt: number;
      mode: string;
      promptChars: number;
      elapsedMs: number;
      responseChars?: number;
      status: 'success' | 'retrying' | 'failed' | 'fallback';
      error?: string;
    }> = [];

    const leanResult = await this.tryLLMAttempt(input, 1, 'lean', minimumBeatCount, attemptSummaries, lastError, lastRawResponse);
    if (leanResult.success && leanResult.data) return leanResult;
    lastError = leanResult.error;
    lastRawResponse = leanResult.rawResponse;

    const retryResult = await this.tryLLMAttempt(input, 2, 'lean_retry', minimumBeatCount, attemptSummaries, lastError, lastRawResponse);
    if (retryResult.success && retryResult.data) return retryResult;

    console.warn(`[EncounterArchitect] All LLM attempts failed for ${input.sceneId}. Building deterministic fallback.`);
    try {
      let structure = this.buildDeterministicFallback(input);
      structure = this.normalizeStructure(structure, input);
      this.validateStructure(structure, input);
      return { success: true, data: structure };
    } catch (fallbackError) {
      const fbMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return { success: false, error: `All attempts exhausted including fallback: ${fbMsg}` };
    }
  }

  private async tryLLMAttempt(
    input: EncounterArchitectInput,
    attempt: number,
    mode: string,
    minimumBeatCount: number,
    attemptSummaries: Array<any>,
    lastError?: string,
    lastRawResponse?: string,
  ): Promise<AgentResponse<EncounterStructure> & { rawResponse?: string }> {
    const attemptStartedAt = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), EncounterArchitect.PER_CALL_TIMEOUT_MS);

    try {
      const messages = mode === 'lean_retry' && lastError
        ? this.buildLeanRetryMessages(input, lastError, lastRawResponse)
        : this.buildLeanMessages(input);

      const promptChars = messages.reduce((total, m) => {
        if (typeof m.content === 'string') return total + m.content.length;
        if (Array.isArray(m.content)) return total + m.content.reduce((pt, p) => pt + ((p as any).text?.length || 0), 0);
        return total;
      }, 0);

      console.log(
        `[EncounterArchitect] Attempt ${attempt} starting for ${input.sceneId} `
        + `mode=${mode} promptChars=${promptChars} timeout=${EncounterArchitect.PER_CALL_TIMEOUT_MS}ms`
      );

      const response = await this.callLLM(messages, 1, { signal: ac.signal });
      const elapsedMs = Date.now() - attemptStartedAt;

      console.log(
        `[EncounterArchitect] Attempt ${attempt}: received response (${response.length} chars) after ${elapsedMs}ms`
      );

        let structure: EncounterStructure;
        try {
          structure = this.parseJSON<EncounterStructure>(response);
        } catch (parseError) {
          const parseMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`[EncounterArchitect] Attempt ${attempt}: JSON parse failed (first 500 chars):`, response.substring(0, 500));
        attemptSummaries.push({ attempt, mode, promptChars, elapsedMs, responseChars: response.length, status: 'retrying', error: `JSON parse error: ${parseMsg}` });
        return { success: false, error: `JSON parse error: ${parseMsg}`, rawResponse: response };
      }

        const beatCount = Array.isArray(structure.beats) ? structure.beats.length : 0;
      console.log(`[EncounterArchitect] Attempt ${attempt}: Parsed ${beatCount} beats, keys: ${Object.keys(structure).join(', ')}`);

      if (beatCount < minimumBeatCount) {
        const err = `Only ${beatCount} beat(s), need at least ${minimumBeatCount}`;
        console.warn(`[EncounterArchitect] Attempt ${attempt}: ${err}`);
        attemptSummaries.push({ attempt, mode, promptChars, elapsedMs, responseChars: response.length, status: 'retrying', error: err });
        return { success: false, error: err, rawResponse: response };
      }

        structure = this.normalizeStructure(structure, input);
        this.validateStructure(structure, input);

      attemptSummaries.push({ attempt, mode, promptChars, elapsedMs, responseChars: response.length, status: 'success' });
      console.log(`[EncounterArchitect] Attempt ${attempt} succeeded: ${structure.beats.length} beats, ${Object.keys(structure.storylets || {}).length} storylets`);

      return { success: true, data: structure, rawResponse: response };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const elapsedMs = Date.now() - attemptStartedAt;
      console.error(`[EncounterArchitect] Attempt ${attempt} ${isAbort ? 'timed out' : 'failed'} after ${elapsedMs}ms: ${errorMsg}`);
      attemptSummaries.push({ attempt, mode, promptChars: 0, elapsedMs, status: 'retrying', error: isAbort ? `Timed out after ${EncounterArchitect.PER_CALL_TIMEOUT_MS}ms` : errorMsg });
      return { success: false, error: errorMsg };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Build lean prompt messages — focused on creative content only.
   * normalizeStructure fills everything else (visual contracts, tension curves, NPC states, etc).
   */
  private buildLeanMessages(input: EncounterArchitectInput): AgentMessage[] {
    return [{ role: 'user', content: this.buildReliablePrompt(input) }];
  }

  /**
   * Build lean prompt with error feedback from a prior failed attempt.
   */
  private buildLeanRetryMessages(input: EncounterArchitectInput, lastError: string, lastRawResponse?: string): AgentMessage[] {
    const minimumBeatCount = this.getMinimumRequiredBeatCount(input);
    const feedback = `Your previous response had a problem: ${lastError}

Please try again. Key rules:
- "beats" array MUST have at least ${minimumBeatCount} beat objects
- Each beat MUST have at least 3 choices (aggressive, cautious, clever)
- Each choice MUST have success/complicated/failure outcomes
- Return ONLY valid JSON — no markdown, no prose
- Beat 2 choices must have isTerminal: true and encounterOutcome on their outcomes`;

      return [
      { role: 'user', content: this.buildReliablePrompt(input) },
        { role: 'assistant', content: lastRawResponse?.substring(0, 200) || '(previous attempt failed)' },
      { role: 'user', content: feedback },
    ];
  }

  /**
   * Lean, reliable prompt that asks the LLM only for creative content.
   * Everything structural (visual contracts, tension curves, NPC states, env elements,
   * escalation triggers, information visibility, pixar fields, metadata) is filled by
   * normalizeStructure, so we don't burden the prompt with it.
   *
   * Uses flat nextBeatId linking (converted to tree by normalizeStructure).
   * Expected output: ~2-3K tokens vs ~10-15K for the full prompt.
   */
  private buildReliablePrompt(input: EncounterArchitectInput): string {
    const protagonist = input.protagonistInfo.name || 'the protagonist';
    const npcsList = input.npcsInvolved
      .map(npc => `- ${npc.name} (${npc.id}, ${npc.pronouns}): ${npc.role} — ${npc.description}`)
      .join('\n');

    const skill1 = input.availableSkills[0]?.name || 'athletics';
    const skill2 = input.availableSkills[1]?.name || 'perception';
    const skill3 = input.availableSkills[2]?.name || 'persuasion';
    const skillsList = input.availableSkills.slice(0, 6)
      .map(s => `${s.name} (${s.attribute})`)
      .join(', ');

    const beatPlan = (input.encounterBeatPlan && input.encounterBeatPlan.length > 0)
      ? input.encounterBeatPlan.map((b, i) => `  ${i + 1}. ${b}`).join('\n')
      : '  1. Opening pressure\n  2. Crisis and resolution';

    const priorCtx = input.priorStateContext ? `
## Prior Story Context (reference these in your narrative)
${(() => {
  const already = input.priorStateContext!.relevantFlags.filter(f => f.alreadySet);
  const future = input.priorStateContext!.relevantFlags.filter(f => !f.alreadySet);
  let out = '';
  if (already.length > 0) out += `Flags already set (ok for conditions): ${already.map(f => f.name).join(', ')}`;
  if (future.length > 0) out += `${out ? '\n' : ''}Flags set later (DO NOT use in conditions): ${future.map(f => f.name).join(', ')}`;
  return out;
})()}
${input.priorStateContext.relevantRelationships.length > 0 ? `Relationships (max achievable shown — do NOT condition on values above max): ${input.priorStateContext.relevantRelationships.map(r => `${r.npcName} ${r.dimension} ${r.operator} ${r.threshold} [max:${r.currentMaxValue ?? '?'}]`).join(', ')}` : ''}
${input.priorStateContext.significantChoices.length > 0 ? `Prior choices: ${input.priorStateContext.significantChoices.join('; ')}` : ''}` : '';

    return `Generate a ${input.encounterType} encounter for this scene. Return ONLY valid JSON — no markdown, no prose.

## Scene
- ID: ${input.sceneId}
- Name: ${input.sceneName}
- Description: ${input.sceneDescription}
- Mood: ${input.sceneMood}
- Type: ${input.encounterType} | Style: ${input.encounterStyle || 'auto'}
- Difficulty: ${input.difficulty}
- Stakes: ${input.encounterStakes || 'Keep stakes personal to the protagonist'}
- Skills: ${skillsList}
- Beat Plan:
${beatPlan}

## Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})
${input.storyContext.userPrompt ? `User instructions: ${input.storyContext.userPrompt}` : ''}

## Protagonist: ${protagonist} (${input.protagonistInfo.pronouns})

## NPCs
${npcsList || 'None'}

## Connections
- Victory → ${input.victoryNextSceneId || 'next scene'}
- Defeat → ${input.defeatNextSceneId || 'next scene'}
${priorCtx}
## TEXT RULES
- Use {{player.name}} for protagonist name, {{player.they}}/{{player.them}}/{{player.their}} for pronouns
- NPCs use their actual names
- setupText: 30-50 words setting the situation
- narrativeText: 30-60 words showing THE RESULT of the action (not the action itself)
- Each beat's choices must cover aggressive, cautious, and clever approaches

## JSON STRUCTURE (flat with nextBeatId — system converts to tree)

{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "encounterStyle": "${input.encounterStyle || 'auto'}",
  "goalClock": { "name": "string", "segments": 6, "description": "string" },
  "threatClock": { "name": "string", "segments": 4, "description": "string" },
  "stakes": { "victory": "string", "defeat": "string" },
  "beats": [
    {
      "id": "beat-1",
      "phase": "setup",
      "name": "string",
      "description": "string",
      "setupText": "30-50 words: the situation the player faces",
      "choices": [
        {
          "id": "b1-c1",
          "text": "Bold action (5-10 words)",
          "approach": "aggressive",
          "impliedApproach": "aggressive",
          "primarySkill": "${skill1}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        },
        {
          "id": "b1-c2",
          "text": "Careful approach (5-10 words)",
          "approach": "cautious",
          "impliedApproach": "cautious",
          "primarySkill": "${skill2}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        },
        {
          "id": "b1-c3",
          "text": "Clever trick (5-10 words)",
          "approach": "clever",
          "impliedApproach": "clever",
          "primarySkill": "${skill3}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        }
      ]
    },
    {
      "id": "beat-2",
      "phase": "resolution",
      "name": "string",
      "description": "string",
      "setupText": "30-50 words: the climactic moment",
      "isTerminal": true,
      "choices": [
        {
          "id": "b2-c1",
          "text": "Go for victory (5-10 words)",
          "approach": "bold",
          "primarySkill": "${skill1}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 3, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 2, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "partialVictory" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 3, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        },
        {
          "id": "b2-c2",
          "text": "Hold your ground (5-10 words)",
          "approach": "cautious",
          "primarySkill": "${skill2}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "escape" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        },
        {
          "id": "b2-c3",
          "text": "Find another way (5-10 words)",
          "approach": "clever",
          "primarySkill": "${skill3}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "escape" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        }
      ]
    }
  ],
  "startingBeatId": "beat-1",
  "storylets": {
    "victory": {
      "id": "${input.sceneId}-sv",
      "name": "Victory",
      "triggerOutcome": "victory",
      "tone": "triumphant",
      "narrativeFunction": "string",
      "beats": [{ "id": "${input.sceneId}-sv-1", "text": "1-2 sentences of victory aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-sv-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    },
    "defeat": {
      "id": "${input.sceneId}-sd",
      "name": "Defeat",
      "triggerOutcome": "defeat",
      "tone": "somber",
      "narrativeFunction": "string",
      "beats": [{ "id": "${input.sceneId}-sd-1", "text": "1-2 sentences of defeat aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-sd-1",
      "consequences": [],
      "nextSceneId": "${input.defeatNextSceneId || 'next-scene'}"
    },
    "escape": {
      "id": "${input.sceneId}-se",
      "name": "Escape",
      "triggerOutcome": "escape",
      "tone": "relieved",
      "narrativeFunction": "string",
      "beats": [{ "id": "${input.sceneId}-se-1", "text": "1-2 sentences of escape aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-se-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    }
  }
}

RULES:
1. Replace ALL "string" placeholders with actual narrative content specific to this scene and these characters
2. narrativeText = THE RESULT of the action ("Your blade finds his shoulder" not "You attack")
3. setupText = the situation BEFORE the choice (vivid, 30-50 words)
4. Return ONLY the JSON object — no markdown, no backticks, no explanation
5. "beats" array MUST have at least ${this.getMinimumRequiredBeatCount(input)} beats
6. Each outcome on beat-2 MUST have "isTerminal": true and an "encounterOutcome"`;
  }

  /**
   * Deterministic fallback: builds a minimal but playable encounter from the
   * input data alone, with no LLM call. normalizeStructure fills all
   * structural fields (visual contracts, storylets, NPC states, etc).
   */
  private buildDeterministicFallback(input: EncounterArchitectInput): EncounterStructure {
    const protagonist = input.protagonistInfo.name || '{{player.name}}';
    const npc = input.npcsInvolved[0];
    const npcName = npc?.name || 'the opponent';
    const skill1 = input.availableSkills[0]?.name || 'athletics';
    const skill2 = input.availableSkills[1]?.name || 'perception';
    const skill3 = input.availableSkills[2]?.name || 'persuasion';
    const stakeText = input.encounterStakes || input.sceneDescription || 'The situation demands a response.';

    const beats: EncounterBeat[] = [
      {
        id: 'beat-1',
        phase: 'setup' as EscalationPhase,
        name: 'The Confrontation',
        description: `${npcName} forces a decision.`,
        setupText: `The moment arrives. ${npcName} stands before {{player.name}}, and there is no avoiding what comes next. ${stakeText.substring(0, 80)}`,
        choices: [
          {
            id: 'b1-c1',
            text: `Confront ${npcName} directly`,
            approach: 'aggressive' as EncounterApproach,
            impliedApproach: 'aggressive' as EncounterApproach,
            primarySkill: skill1,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `{{player.name}} presses forward with conviction. ${npcName} gives ground.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `The confrontation is messy — {{player.name}} holds firm but ${npcName} doesn't back down easily.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `${npcName} turns {{player.name}}'s aggression against {{player.them}}. The situation worsens.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
          {
            id: 'b1-c2',
            text: `Assess the situation carefully`,
            approach: 'cautious' as EncounterApproach,
            impliedApproach: 'cautious' as EncounterApproach,
            primarySkill: skill2,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `{{player.name}}'s patience pays off — a weakness reveals itself.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `{{player.name}} learns something useful, but the delay has a cost.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `Hesitation proves costly. ${npcName} seizes the initiative.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
          {
            id: 'b1-c3',
            text: `Try an unexpected approach`,
            approach: 'clever' as EncounterApproach,
            impliedApproach: 'clever' as EncounterApproach,
            primarySkill: skill3,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `The gambit works — ${npcName} is caught completely off guard.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `It half-works. ${npcName} is thrown off balance, but recovers quickly.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `${npcName} sees through it immediately. {{player.name}} is exposed.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
        ],
      } as EncounterBeat,
      {
        id: 'beat-2',
        phase: 'resolution' as EscalationPhase,
        name: 'The Decisive Moment',
        description: 'Everything comes to a head.',
        setupText: `This is the moment that decides everything. ${npcName} and {{player.name}} face the final test.`,
        isTerminal: true,
        choices: [
          {
            id: 'b2-c1',
            text: `Push for a decisive outcome`,
            approach: 'bold' as EncounterApproach,
            primarySkill: skill1,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `{{player.name}} seizes the moment. The outcome is decisive and clear.`, goalTicks: 3, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' as EncounterOutcome },
              complicated: { tier: 'complicated' as const, narrativeText: `Victory, but not clean. The cost will linger.`, goalTicks: 2, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' as EncounterOutcome },
              failure: { tier: 'failure' as const, narrativeText: `The gamble doesn't pay off. {{player.name}} comes up short.`, goalTicks: 0, threatTicks: 3, isTerminal: true, encounterOutcome: 'defeat' as EncounterOutcome },
            },
          },
          {
            id: 'b2-c2',
            text: `Stand firm and endure`,
            approach: 'cautious' as EncounterApproach,
            primarySkill: skill2,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `{{player.name}}'s resolve outlasts the challenge.`, goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' as EncounterOutcome },
              complicated: { tier: 'complicated' as const, narrativeText: `{{player.name}} survives, barely. Retreat is the wise option.`, goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' as EncounterOutcome },
              failure: { tier: 'failure' as const, narrativeText: `The pressure is too much. {{player.name}} is overwhelmed.`, goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' as EncounterOutcome },
            },
          },
          {
            id: 'b2-c3',
            text: `Find a way out on your terms`,
            approach: 'clever' as EncounterApproach,
            primarySkill: skill3,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `An unexpected solution presents itself. {{player.name}} takes it.`, goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' as EncounterOutcome },
              complicated: { tier: 'complicated' as const, narrativeText: `It works, mostly. {{player.name}} escapes, but not cleanly.`, goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' as EncounterOutcome },
              failure: { tier: 'failure' as const, narrativeText: `There is no clever way out. {{player.name}} faces the consequences.`, goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' as EncounterOutcome },
            },
          },
        ],
      } as EncounterBeat,
    ];

    return {
      sceneId: input.sceneId,
      encounterType: input.encounterType,
      encounterStyle: input.encounterStyle,
      goalClock: {
        name: 'Objective',
        segments: 6,
        description: input.encounterStakes || 'Achieve the encounter objective',
      },
      threatClock: {
        name: 'Danger',
        segments: 4,
        description: 'Escalating threat',
      },
      stakes: {
        victory: input.encounterStakes || 'Overcome the challenge',
        defeat: 'Suffer the consequences',
      },
      beats,
      startingBeatId: 'beat-1',
    } as EncounterStructure;
  }

  private normalizeStructure(structure: EncounterStructure, input: EncounterArchitectInput): EncounterStructure {
    // Ensure sceneId
    if (!structure.sceneId) {
      structure.sceneId = input.sceneId;
    }

    // Ensure encounterType
    if (!structure.encounterType) {
      structure.encounterType = input.encounterType;
    }
    if (!structure.encounterStyle) {
      structure.encounterStyle = input.encounterStyle;
    }

    // Ensure clocks exist
    if (!structure.goalClock) {
      structure.goalClock = {
        name: 'Objective',
        segments: 6,
        description: 'Progress toward completing the encounter'
      };
    }
    if (!structure.threatClock) {
      structure.threatClock = {
        name: 'Danger',
        segments: 4,
        description: 'Escalating threat level'
      };
    }

    // Ensure stakes
    if (!structure.stakes) {
      structure.stakes = {
        victory: 'Complete the objective',
        defeat: 'Face the consequences'
      };
    }

    // Ensure beats is an array (normalize type, don't fabricate content)
    if (!structure.beats) {
      structure.beats = [];
    } else if (!Array.isArray(structure.beats)) {
      structure.beats = [structure.beats as unknown as EncounterBeat];
    }

    // Log insufficient beats but DON'T create fallbacks — let the retry loop handle it
    if (structure.beats.length < 2) {
      console.warn(`[EncounterArchitect] Only ${structure.beats.length} beats returned by LLM (minimum 2 required)`);
    }

    // Normalize each beat
    for (let i = 0; i < structure.beats.length; i++) {
      const beat = structure.beats[i];
      if (!beat.id) {
        beat.id = `beat-${i + 1}`;
      }
      if (!beat.phase) {
        if (i === 0) beat.phase = 'setup';
        else if (i === structure.beats.length - 1) beat.phase = 'resolution';
        else if (i === Math.floor(structure.beats.length / 2)) beat.phase = 'peak';
        else beat.phase = 'rising';
      }
      if (!beat.name) {
        beat.name = `Beat ${i + 1}`;
      }
      if (!beat.description) {
        beat.description = '';
      }
      if (!beat.setupText) {
        beat.setupText = '';
      }
      
      // Add visual direction if missing
      if (!beat.visualDirection) {
        beat.visualDirection = this.getDefaultVisualDirection(beat.phase);
      }
      if (!beat.visualContract) {
        beat.visualContract = this.buildDefaultVisualContract(beat.setupText || beat.description, beat.phase);
      }

      const ensureChoiceOutcomes = (choices?: EmbeddedEncounterChoice[] | EncounterChoice[], phase: EscalationPhase = beat.phase) => {
        for (const choice of choices || []) {
          if (!choice.outcomes) {
            (choice as EmbeddedEncounterChoice).outcomes = {} as EmbeddedEncounterChoice['outcomes'];
          }

          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const existing = choice.outcomes[tier];
            if (existing) continue;

            const defaults = this.buildDefaultOutcome(choice.text, tier, phase);
            choice.outcomes[tier] = defaults as typeof choice.outcomes[typeof tier];
            console.warn(
              `[EncounterArchitect] Synthesized missing ${tier} outcome for choice "${choice.id}" in ${structure.sceneId}/${beat.id}`
            );
          }

          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const outcome = choice.outcomes[tier];
            if (outcome?.nextSituation) {
              ensureChoiceOutcomes(outcome.nextSituation.choices, 'rising');
            }
          }
        }
      };

      ensureChoiceOutcomes(beat.choices, beat.phase);

      const ensureChoiceVisualContracts = (choices?: EmbeddedEncounterChoice[] | EncounterChoice[], phase: EscalationPhase = beat.phase) => {
        for (const choice of choices || []) {
          if (!choice.outcomes) continue;
          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const outcome = choice.outcomes[tier];
            if (!outcome) continue;
            if (outcome.isTerminal && outcome.encounterOutcome === 'partialVictory' && !outcome.cost) {
              outcome.cost = this.buildDefaultEncounterCost(
                outcome.narrativeText,
                outcome.consequences,
                input.partialVictoryCost
              );
            }
            if (!outcome.visualContract) {
              outcome.visualContract = this.buildDefaultVisualContract(
                outcome.narrativeText,
                tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : phase
              );
            }
            if (outcome.encounterOutcome === 'partialVictory' && outcome.cost && !outcome.visualContract.visibleCost) {
              outcome.visualContract.visibleCost = outcome.cost.visibleComplication;
            }
            if (outcome.nextSituation) {
              if (!outcome.nextSituation.visualContract) {
                outcome.nextSituation.visualContract = this.buildDefaultVisualContract(outcome.nextSituation.setupText, 'setup');
              }
              ensureChoiceVisualContracts(outcome.nextSituation.choices, 'rising');
            }
          }
        }
      };

      ensureChoiceVisualContracts(beat.choices, beat.phase);
    }

    // Ensure startingBeatId
    if (!structure.startingBeatId && structure.beats.length > 0) {
      structure.startingBeatId = structure.beats[0].id;
    }

    // Ensure tensionCurve is an array
    if (!structure.tensionCurve) {
      structure.tensionCurve = structure.beats.map((beat, i) => ({
        beatId: beat.id,
        tensionLevel: Math.min(i * 2 + 3, 10),
        description: `${beat.phase} tension`
      }));
    }

    // Ensure storylets exist with defaults
    if (!structure.storylets) {
      structure.storylets = {
        victory: this.createDefaultStorylet('victory', input),
        partialVictory: this.createDefaultStorylet('partialVictory', input),
        defeat: this.createDefaultStorylet('defeat', input)
      };
    } else {
      if (!structure.storylets.victory) {
        structure.storylets.victory = this.createDefaultStorylet('victory', input);
      }
      if (!structure.storylets.partialVictory) {
        structure.storylets.partialVictory = this.createDefaultStorylet('partialVictory', input);
      }
      if (!structure.storylets.defeat) {
        structure.storylets.defeat = this.createDefaultStorylet('defeat', input);
      }
    }

    if (!structure.partialVictoryCost) {
      structure.partialVictoryCost = structure.storylets.partialVictory?.cost
        || this.buildDefaultEncounterCost(
          structure.storylets.partialVictory?.narrativeFunction
            || 'The objective is achieved, but the price is visible in the aftermath.',
          structure.storylets.partialVictory?.consequences,
          input.partialVictoryCost
        );
    }

    // Ensure environmental elements
    if (!structure.environmentalElements) {
      structure.environmentalElements = [];
    }

    // Ensure NPC states
    if (!structure.npcStates) {
      structure.npcStates = input.npcsInvolved.map(npc => ({
        npcId: npc.id,
        name: npc.name,
        initialDisposition: npc.role === 'enemy' ? 'confident' : 'wary',
        reactionToAggressive: `${npc.name} responds to aggression`,
        reactionToCautious: `${npc.name} observes carefully`,
        reactionToClever: `${npc.name} is caught off guard`,
        tells: [],
        dispositionShifts: []
      }));
    } else {
      // Validate each NPC state entry — LLM may omit fields
      structure.npcStates = structure.npcStates.map(npc => ({
        ...npc,
        npcId: npc.npcId ?? `npc-${Math.random().toString(36).slice(2, 8)}`,
        name: npc.name ?? 'Unknown',
        initialDisposition: npc.initialDisposition ?? 'wary',
        reactionToAggressive: npc.reactionToAggressive ?? `${npc.name ?? 'NPC'} responds to aggression`,
        reactionToCautious: npc.reactionToCautious ?? `${npc.name ?? 'NPC'} observes carefully`,
        reactionToClever: npc.reactionToClever ?? `${npc.name ?? 'NPC'} is caught off guard`,
        tells: npc.tells ?? [],
        dispositionShifts: npc.dispositionShifts ?? [],
      }));
    }

    // Ensure escalation triggers
    if (!structure.escalationTriggers) {
      structure.escalationTriggers = [
        {
          id: 'threat-75',
          condition: { type: 'threat_threshold', value: 75 },
          effect: {
            narrativeText: 'The situation becomes critical!',
            threatBonus: 1
          }
        }
      ];
    }

    // Ensure information visibility
    if (!structure.informationVisibility) {
      structure.informationVisibility = {
        threatClockVisible: true,
        npcTellsRevealAt: 'encounter_50_percent',
        environmentElementsHidden: [],
        choiceOutcomesUnknown: false
      };
    }

    // Ensure metadata
    if (!structure.estimatedDuration) {
      structure.estimatedDuration = 'medium';
    }
    if (!structure.replayability) {
      structure.replayability = 'medium';
    }
    if (!structure.designNotes) {
      structure.designNotes = '';
    }

    // Convert flat nextBeatId encounters to tree-based nextSituation format.
    // This ensures both the main prompt and simplified fallback produce
    // encounters that use the tree rendering path in the UI.
    this.convertFlatToTree(structure);

    for (const storylet of Object.values(structure.storylets || {})) {
      if (!storylet) continue;
      if (storylet.triggerOutcome === 'partialVictory' && !storylet.cost) {
        storylet.cost = structure.partialVictoryCost
          || this.buildDefaultEncounterCost(storylet.narrativeFunction, storylet.consequences, input.partialVictoryCost);
      }
      if (!storylet?.beats) continue;
      for (const beat of storylet.beats) {
        if (storylet.triggerOutcome === 'partialVictory' && !beat.cost) {
          beat.cost = storylet.cost;
        }
        if (!beat.visualContract) {
          beat.visualContract = this.buildDefaultVisualContract(beat.text, 'resolution');
        }
        if (storylet.triggerOutcome === 'partialVictory' && beat.cost && !beat.visualContract.visibleCost) {
          beat.visualContract.visibleCost = beat.cost.visibleComplication;
          beat.visualContract.emotionalCore = beat.visualContract.emotionalCore || 'costly success';
        }
      }
    }

    return structure;
  }

  /**
   * Convert flat encounters (nextBeatId linking) to tree format (embedded nextSituation).
   * For each non-terminal outcome that references a nextBeatId, lift the target beat's
   * content into the outcome as a nextSituation with embedded choices.
   */
  private convertFlatToTree(structure: EncounterStructure): void {
    const beatMap = new Map<string, EncounterBeat>();
    for (const beat of structure.beats) {
      beatMap.set(beat.id, beat);
    }

    let converted = false;

    for (const beat of structure.beats) {
      if (!beat.choices) continue;
      for (const choice of beat.choices) {
        if (!choice.outcomes) continue;
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (!outcome) continue;

          // Already tree-based or terminal — skip
          if (outcome.nextSituation || outcome.isTerminal) continue;

          const targetId = outcome.nextBeatId || (choice as any).nextBeatId;
          if (!targetId) continue;

          const targetBeat = beatMap.get(targetId);
          if (!targetBeat) continue;

          // Embed the target beat's content as nextSituation
          outcome.nextSituation = {
            setupText: targetBeat.setupText || '',
            situationImage: targetBeat.situationImage,
            choices: (targetBeat.choices || []).map(tc => ({
              ...tc,
            })),
            visualContract: targetBeat.visualContract || this.buildDefaultVisualContract(targetBeat.setupText || targetBeat.description, 'setup'),
          };

          // Clear the flat reference
          delete outcome.nextBeatId;
          converted = true;
        }
      }
    }

    if (converted) {
      // Prune beats that are now fully embedded (only keep the starting beat)
      const startId = structure.startingBeatId || structure.beats[0]?.id;
      structure.beats = structure.beats.filter(b => b.id === startId);
      console.log(`[EncounterArchitect] Converted flat encounter to tree format (kept beat: ${startId})`);
    }
  }

  private getEncounterProgressionDepth(structure: EncounterStructure): number {
    const startingBeat =
      structure.beats.find((beat) => beat.id === structure.startingBeatId)
      || structure.beats[0];

    if (!startingBeat) return 0;

    const getDepthFromChoices = (
      choices: Array<EncounterChoice | EmbeddedEncounterChoice> | undefined,
      seen: Set<string>
    ): number => {
      let maxDepth = 0;

      for (const choice of choices || []) {
        if (!choice?.outcomes) continue;
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (!outcome) continue;

          if (outcome.nextSituation?.choices?.length) {
            const situationKey = `${choice.id}:${tier}:${outcome.nextSituation.setupText || ''}`;
            if (seen.has(situationKey)) {
              maxDepth = Math.max(maxDepth, 1);
              continue;
            }
            const nextSeen = new Set(seen);
            nextSeen.add(situationKey);
            maxDepth = Math.max(maxDepth, 1 + getDepthFromChoices(outcome.nextSituation.choices, nextSeen));
          } else if (outcome.isTerminal || outcome.encounterOutcome || outcome.nextBeatId) {
            maxDepth = Math.max(maxDepth, 1);
          }
        }
      }

      return maxDepth;
    };

    return 1 + getDepthFromChoices(startingBeat.choices, new Set());
  }

  private buildDefaultOutcome(
    choiceText: string | undefined,
    tier: 'success' | 'complicated' | 'failure',
    phase: EscalationPhase,
  ) {
    const normalizedChoiceText = (choiceText || 'the attempt').trim();
    const encounterOutcomeByTier: Record<typeof tier, EncounterOutcome> = {
      success: 'victory',
      complicated: 'partialVictory',
      failure: 'defeat',
    };
    const clockDefaults = {
      success: { goalTicks: 2, threatTicks: 0 },
      complicated: { goalTicks: 1, threatTicks: 1 },
      failure: { goalTicks: 0, threatTicks: 2 },
    };
    const narrativeByTier: Record<typeof tier, string> = {
      success: `${normalizedChoiceText} succeeds and decisively shifts the situation.`,
      complicated: `${normalizedChoiceText} partly works, but the cost is immediately visible.`,
      failure: `${normalizedChoiceText} fails and the situation worsens.`,
    };

    const visualContract = this.buildDefaultVisualContract(
      narrativeByTier[tier],
      tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : phase,
    );

    const outcome: {
      tier: 'success' | 'complicated' | 'failure';
      goalTicks: number;
      threatTicks: number;
      narrativeText: string;
      isTerminal: boolean;
      encounterOutcome: EncounterOutcome;
      visualContract: EncounterVisualContract;
      cost?: EncounterCost;
    } = {
      tier,
      goalTicks: clockDefaults[tier].goalTicks,
      threatTicks: clockDefaults[tier].threatTicks,
      narrativeText: narrativeByTier[tier],
      isTerminal: true,
      encounterOutcome: encounterOutcomeByTier[tier],
      visualContract,
    };

    if (tier === 'complicated') {
      outcome.cost = this.buildDefaultEncounterCost(narrativeByTier[tier], undefined, undefined);
      outcome.visualContract.visibleCost = outcome.cost.visibleComplication;
    }

    return outcome;
  }

  private getDefaultVisualDirection(phase: EscalationPhase): EncounterBeat['visualDirection'] {
    switch (phase) {
      case 'setup':
        return { cameraStyle: 'wide_establishing', lighting: 'neutral', mood: 'anticipation' };
      case 'rising':
        return { cameraStyle: 'medium_action', lighting: 'increasing_contrast', mood: 'tension_building' };
      case 'peak':
        return { cameraStyle: 'dramatic_closeups', lighting: 'high_contrast_colored', mood: 'maximum_intensity' };
      case 'resolution':
        return { cameraStyle: 'reaction_shots', lighting: 'appropriate_to_outcome', mood: 'release' };
    }
  }

  private buildDefaultVisualContract(
    text: string,
    phase: EscalationPhase | 'resolution'
  ): EncounterVisualContract {
    const cleaned = (text || '').trim();
    const action = cleaned.match(/\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|lowers?|clenches?|releases?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?|pleads?|reveals?|hides?)\b/i)?.[0];
    const detail = cleaned.match(/\b(key|blade|blood|door|map|weapon|wound|fist|hands?|letter|ring|gun|knife|tear|glance)\b/i)?.[0];
    return {
      visualMoment: cleaned || 'A decisive encounter moment.',
      primaryAction: action ? `the protagonist ${action}` : 'the protagonist reacts under pressure',
      emotionalRead: phase === 'resolution'
        ? 'the emotional aftermath is readable in the face and shoulders'
        : 'emotion should read clearly in the eyes, jaw, and posture',
      relationshipDynamic: phase === 'setup'
        ? 'the power balance is visible in how characters claim space'
        : 'the relationship pressure is visible in body language and distance',
      mustShowDetail: detail ? `the ${detail} as the concrete clue that sells the moment` : 'one prop or body cue that makes the moment legible',
      keyExpression: phase === 'resolution' ? 'aftermath and cost visible at a glance' : 'immediate emotional intent visible at a glance',
      keyGesture: action ? `a readable gesture built around ${action}` : 'a decisive hand or body gesture',
      keyBodyLanguage: phase === 'setup' ? 'stance and spacing define the tension' : 'body language shows who is pressing and who is yielding',
      shotDescription: phase === 'setup' ? 'establishing frame with readable relational spacing' : 'dramatic story frame with readable faces, hands, and posture',
      emotionalCore: phase === 'resolution' ? 'aftermath' : 'decision under pressure',
      visualNarrative: cleaned || 'The image should tell the encounter turn clearly without captions.',
      includeExpressionRefs: phase !== 'setup',
    };
  }

  private buildDefaultEncounterCost(
    text: string,
    consequences: StateChange[] | undefined,
    seed?: Partial<EncounterCost>
  ): EncounterCost {
    const lowered = `${text} ${(seed?.visibleComplication || '')}`.toLowerCase();
    const derivedDomain = seed?.domain
      || (consequences?.some(c => c.type === 'relationship') ? 'relationship' : undefined)
      || (consequences?.some(c => c.type === 'score' && /reputation|trust|respect|fame/i.test(c.name)) ? 'reputation' : undefined)
      || (consequences?.some(c => c.type === 'score' && /time|delay|clock/i.test(c.name)) ? 'time' : undefined)
      || (/(wound|injur|bleed|hurt|scar|pain)/.test(lowered) ? 'injury' : undefined)
      || (/(exposed|seen|noticed|discover|reveal)/.test(lowered) ? 'exposure' : undefined)
      || (/(reputation|shame|humiliat|public)/.test(lowered) ? 'reputation' : undefined)
      || (/(lose|spent|broken|consumed|depleted|resource)/.test(lowered) ? 'resource' : undefined)
      || 'mixed';
    const severity = seed?.severity
      || (consequences && consequences.length >= 3 ? 'major' : consequences && consequences.length >= 2 ? 'moderate' : 'minor');
    const whoPays = seed?.whoPays
      || (derivedDomain === 'relationship' ? 'relationship' : derivedDomain === 'world' ? 'world' : 'protagonist');

    return {
      domain: derivedDomain,
      severity,
      whoPays,
      immediateEffect: seed?.immediateEffect || text || 'The objective is achieved, but the price is immediate.',
      visibleComplication: seed?.visibleComplication || text || 'The cost of success is visible in the aftermath.',
      lingeringEffect: seed?.lingeringEffect,
      consequences: seed?.consequences,
    };
  }

  private createDefaultStorylet(
    outcome: 'victory' | 'partialVictory' | 'defeat' | 'escape',
    input: EncounterArchitectInput
  ): GeneratedStorylet {
    const tones: Record<string, GeneratedStorylet['tone']> = {
      victory: 'triumphant',
      partialVictory: 'bittersweet',
      defeat: 'somber',
      escape: 'relieved'
    };

    if (outcome === 'defeat') {
      return {
        id: `${input.sceneId}-storylet-defeat`,
        name: 'Defeat Aftermath',
        triggerOutcome: 'defeat',
        tone: 'somber',
        narrativeFunction: 'Show cost of failure, create learning arc, build resolve for recovery',
        beats: [
          {
            id: `${input.sceneId}-storylet-defeat-beat-1`,
            text: `{{player.name}} has failed. The weight of it settles in — there will be consequences for this.`,
            nextBeatId: `${input.sceneId}-storylet-defeat-beat-2`,
          },
          {
            id: `${input.sceneId}-storylet-defeat-beat-2`,
            text: `But even in defeat, something has shifted. {{player.name}} sees more clearly now — what went wrong, and what must be done differently next time.`,
            nextBeatId: `${input.sceneId}-storylet-defeat-beat-3`,
          },
          {
            id: `${input.sceneId}-storylet-defeat-beat-3`,
            text: `Resolve hardens. This isn't the end. It's a turning point.`,
            isTerminal: true,
          },
        ],
        startingBeatId: `${input.sceneId}-storylet-defeat-beat-1`,
        consequences: [
          { type: 'score', name: 'setbacks', change: 1 },
          { type: 'score', name: 'resolve', change: 3 },
        ],
        setsFlags: [{ flag: `encounter_${input.sceneId}_defeat`, value: true }],
        nextSceneId: input.defeatNextSceneId,
      };
    }

    if (outcome === 'victory') {
      return {
        id: `${input.sceneId}-storylet-victory`,
        name: 'Victory Aftermath',
        triggerOutcome: 'victory',
        tone: 'triumphant',
        narrativeFunction: 'Celebrate success, show growth from triumph',
        beats: [
          {
            id: `${input.sceneId}-storylet-victory-beat-1`,
            text: `{{player.name}} has succeeded. The immediate danger has passed, and the world shifts in response.`,
            nextBeatId: `${input.sceneId}-storylet-victory-beat-2`,
          },
          {
            id: `${input.sceneId}-storylet-victory-beat-2`,
            text: `There's a quiet sense of earned confidence — not arrogance, but the knowledge that {{player.name}} rose to the challenge.`,
            isTerminal: true,
          },
        ],
        startingBeatId: `${input.sceneId}-storylet-victory-beat-1`,
        consequences: [
          { type: 'score', name: 'confidence', change: 5 },
          { type: 'score', name: 'courage', change: 2 },
        ],
        setsFlags: [{ flag: `encounter_${input.sceneId}_victory`, value: true }],
        nextSceneId: input.victoryNextSceneId,
      };
    }

    if (outcome === 'partialVictory') {
      const cost = this.buildDefaultEncounterCost(
        'The objective is achieved, but the price lands immediately and keeps shaping what comes next.',
        [
          { type: 'score', name: 'confidence', change: 2 },
          { type: 'score', name: 'setbacks', change: 1 },
        ],
        input.partialVictoryCost
      );
      return {
        id: `${input.sceneId}-storylet-partial-victory`,
        name: 'Costly Victory',
        triggerOutcome: 'partialVictory',
        tone: tones.partialVictory,
        narrativeFunction: 'Show that the objective was achieved, but the price changes what comes next.',
        cost,
        beats: [
          {
            id: `${input.sceneId}-storylet-partial-victory-beat-1`,
            text: `{{player.name}} gets what they fought for, but the cost lands immediately. Relief and damage arrive together.`,
            nextBeatId: `${input.sceneId}-storylet-partial-victory-beat-2`,
            cost,
          },
          {
            id: `${input.sceneId}-storylet-partial-victory-beat-2`,
            text: `The victory is real, but so is the complication it leaves behind. What comes next will be shaped by both.`,
            isTerminal: true,
            cost,
          },
        ],
        startingBeatId: `${input.sceneId}-storylet-partial-victory-beat-1`,
        consequences: [
          { type: 'score', name: 'confidence', change: 2 },
          { type: 'score', name: 'setbacks', change: 1 },
        ],
        setsFlags: [{ flag: `encounter_${input.sceneId}_partial_victory`, value: true }],
        nextSceneId: input.victoryNextSceneId,
      };
    }

    // Escape
    return {
      id: `${input.sceneId}-storylet-escape`,
      name: 'Narrow Escape',
      triggerOutcome: 'escape',
      tone: 'relieved',
      narrativeFunction: 'Tension release, assess what was gained and lost',
      beats: [
        {
          id: `${input.sceneId}-storylet-escape-beat-1`,
          text: `{{player.name}} has escaped, but barely. The adrenaline is still coursing.`,
          nextBeatId: `${input.sceneId}-storylet-escape-beat-2`,
        },
        {
          id: `${input.sceneId}-storylet-escape-beat-2`,
          text: `Taking stock, {{player.name}} realizes the situation remains unresolved — but at least there's time to prepare.`,
          isTerminal: true,
        },
      ],
      startingBeatId: `${input.sceneId}-storylet-escape-beat-1`,
      consequences: [
        { type: 'score', name: 'resourcefulness', change: 2 },
      ],
      setsFlags: [{ flag: `encounter_${input.sceneId}_escaped`, value: true }],
      nextSceneId: input.victoryNextSceneId,
    };
  }

  private buildPrompt(input: EncounterArchitectInput): string {
    const npcsList = input.npcsInvolved
      .map(npc => {
        let line = `- ${npc.name} (${npc.id}, ${npc.pronouns}): ${npc.role} - ${npc.description}`;
        if (npc.physicalDescription) line += `\n  Physical Appearance (CANONICAL): ${npc.physicalDescription}`;
        return line;
      })
      .join('\n');

    const skillsList = input.availableSkills
      .map(s => `- ${s.name} (${s.attribute}): ${s.description}`)
      .join('\n');

    const protagonistSkills = input.protagonistInfo.relevantSkills
      ?.map(s => `- ${s.name}: level ${s.level}`)
      .join('\n') || 'Not specified';

    const difficultyOdds: Record<string, number> = {
      easy: 55,
      moderate: 65,
      hard: 75,
      extreme: 85
    };

    return `
Design a COMPLETE encounter structure for the following scene:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
${input.storyContext.userPrompt ? `- **User Instructions**: ${input.storyContext.userPrompt}\n` : ''}${input.memoryContext ? `\n## Pipeline Memory (Insights from Prior Generations)\n${input.memoryContext}\n` : ''}
## Scene Context
- **Scene ID**: ${input.sceneId}
- **Scene Name**: ${input.sceneName}
- **Description**: ${input.sceneDescription}
- **Mood**: ${input.sceneMood}
- **Planned Encounter ID**: ${input.plannedEncounterId || 'none'}

## Encounter Details
- **Type**: ${input.encounterType}
- **Style**: ${input.encounterStyle || 'auto'}
- **Description**: ${input.encounterDescription}
- **Personal Stakes**: ${input.encounterStakes || 'Use the scene description and prior buildup to infer the stakes'}
- **Required NPC IDs**: ${(input.encounterRequiredNpcIds || []).join(', ') || 'Use the NPC list below'}
- **Relevant Skills**: ${(input.encounterRelevantSkills || []).join(', ') || 'Use available skills below'}
- **Difficulty**: ${input.difficulty} (target ${difficultyOdds[input.difficulty]}% initial odds against player)
- **Target Beat Count**: ${input.targetBeatCount}
- **Minimum Required Beats**: ${this.getMinimumRequiredBeatCount(input)}
- **Encounter Beat Plan**:
${(input.encounterBeatPlan && input.encounterBeatPlan.length > 0)
  ? input.encounterBeatPlan.map((beat, index) => `  ${index + 1}. ${beat}`).join('\n')
  : '  1. Opening pressure\n  2. Escalation\n  3. Crisis / resolution'}

## Protagonist
- **Name**: ${input.protagonistInfo.name}
- **Pronouns**: ${input.protagonistInfo.pronouns}${input.protagonistInfo.physicalDescription ? `\n- **Physical Appearance** (CANONICAL — use these exact details in any descriptive text): ${input.protagonistInfo.physicalDescription}` : ''}
- **Relevant Skills**:
${protagonistSkills}

## NPCs Involved
${npcsList || 'None'}

## Available Skills
${skillsList}

## Scene Connections
- **Victory leads to**: ${input.victoryNextSceneId || 'next scene'}
- **Defeat leads to**: ${input.defeatNextSceneId || 'next scene'}

${input.priorStateContext ? (() => {
  const ctx = input.priorStateContext!;
  const alreadySetFlags = ctx.relevantFlags.filter(f => f.alreadySet);
  const futureFlags = ctx.relevantFlags.filter(f => !f.alreadySet);

  let flagSection = '';
  if (alreadySetFlags.length > 0) {
    flagSection += `### Flags ALREADY SET by Prior Scenes (safe for \`conditions\`, \`setupTextVariants\`, \`statBonus\`)
${alreadySetFlags.map(f => `- \`${f.name}\`: ${f.description}`).join('\n')}`;
  }
  if (futureFlags.length > 0) {
    if (flagSection) flagSection += '\n\n';
    flagSection += `### Flags Set by LATER Scenes (use ONLY in \`setupTextVariants\` or \`statBonus\` — do NOT use in choice \`conditions\`)
${futureFlags.map(f => `- \`${f.name}\`: ${f.description}`).join('\n')}
**IMPORTANT**: These flags are set by scenes the player has not reached yet. Using them in choice \`conditions\` would create a permanently-locked choice. Only reference them in \`setupTextVariants\` (narrative shading for future replays) or \`statBonus\`.`;
  }
  if (!flagSection) flagSection = '(No flags provided.)';

  const relSection = ctx.relevantRelationships.length > 0
    ? `### Relevant Relationships
${ctx.relevantRelationships.map(r => {
  const maxNote = r.currentMaxValue !== undefined ? ` [current max achievable: ${r.currentMaxValue}]` : '';
  const authoredNote = r.authored === false ? ' [default heuristic]' : '';
  return `- ${r.npcName} (${r.npcId}) — ${r.dimension} ${r.operator} ${r.threshold}${authoredNote}${maxNote}: ${r.description}`;
}).join('\n')}
**IMPORTANT**: Do NOT use a relationship condition on a choice if the "current max achievable" value is below the threshold — that would create a permanently-locked choice. Only use relationship conditions when the max achievable value can meet or exceed the threshold.`
    : '';

  const choiceSection = ctx.significantChoices.length > 0
    ? `### Notable Choices the Player May Have Made
${ctx.significantChoices.map(c => `- ${c}`).join('\n')}`
    : '';

  return `## Prior State Context (PAYOFF THESE IN THE ENCOUNTER)

The following flags and relationship thresholds are DESIGNED to echo inside this encounter. For each one, author at least one of: a \`setupTextVariants\` entry on a beat, a conditional choice (\`conditions\`), or a \`statBonus\`. See the PRIOR STATE PAYOFF section in your instructions.

${flagSection}

${relSection}

${choiceSection}
`;
})() : ''}
## REQUIRED JSON STRUCTURE - BRANCHING TREE

{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "encounterStyle": "${input.encounterStyle || 'auto'}",
  
  "goalClock": {
    "name": "Objective name (e.g., 'Escape the Manor')",
    "segments": 6,
    "description": "What filling this clock represents"
  },
  "threatClock": {
    "name": "Threat name (e.g., 'Guards Close In')",
    "segments": 4,
    "description": "What filling this clock represents"
  },
  
  "stakes": {
    "victory": "What player gains/achieves on victory",
    "defeat": "What player loses/suffers on defeat"
  },
  
  "pixarStakes": {
    "initialOddsAgainst": ${difficultyOdds[input.difficulty]},
    "whatPlayerLoses": "PERSONAL stakes - what ${input.protagonistInfo.name} specifically loses",
    "oddsAgainstNarrative": "Narrative text describing why odds are against them",
    "stackedObstacles": ["obstacle 1", "obstacle 2", "obstacle 3"]
  },
  
  "initialVisualState": {
    "characterPositions": {
      "protagonist": "center frame, defensive posture",
      "npc-id": "foreground right, aggressive stance"
    },
    "characterConditions": {},
    "environmentChanges": [],
    "propsInPlay": ["relevant props for the scene"],
    "currentLighting": "torch-lit corridor, warm tones",
    "tensionLevel": 3
  },

  "beats": [
    {
      "id": "beat-1",
      "phase": "setup",
      "name": "Opening Moment",
      "description": "The initial situation",
      "setupText": "2-3 sentences (~30-50 words). Establish the situation the player must react to.",
      "setupTextVariants": [
        {
          "condition": { "type": "relationship", "npcId": "npc-id", "dimension": "trust", "operator": "<", "value": -20 },
          "text": "Alternate setupText shown when NPC trust is very low — tone is colder, more hostile"
        },
        {
          "condition": { "type": "flag", "flag": "defended_protagonist", "value": true },
          "text": "Alternate setupText shown when player defended the protagonist earlier — NPC acknowledges it"
        }
      ],
      "cinematicSetup": {
        "sceneDescription": "The visual moment BEFORE the player chooses",
        "focusSubject": "protagonist",
        "cameraAngle": "wide_establishing",
        "shotType": "tension_hold",
        "mood": "anticipation",
        "characterStates": [
          { "characterId": "protagonist", "pose": "ready stance", "expression": "determined", "position": "center frame" },
          { "characterId": "opponent", "pose": "threatening", "expression": "menacing", "position": "foreground right" }
        ]
      },
      "choices": [
        {
          "id": "b1-c1",
          "text": "Bold action (5-10 words, imperative)",
          "approach": "aggressive",
          "impliedApproach": "aggressive",
          "primarySkill": "athletics",
          "statBonus": {
            "condition": { "type": "score", "score": "courage_shown", "operator": ">=", "value": 5 },
            "difficultyReduction": 15,
            "flavorText": "Your earlier show of courage steadies you now"
          },
          "outcomes": {
            "success": {
              "tier": "success",
              "narrativeText": "THE ACTION RESULT: 2-3 sentences showing the strike landing, the opponent reeling",
              "goalTicks": 2,
              "threatTicks": 0,
              "cinematicDescription": {
                "sceneDescription": "The IMPACT - protagonist's attack SUCCEEDS",
                "focusSubject": "the moment of impact",
                "cameraAngle": "low_heroic",
                "shotType": "impact",
                "mood": "triumphant",
                "characterStates": [
                  { "characterId": "protagonist", "pose": "follow-through", "expression": "fierce triumph" },
                  { "characterId": "opponent", "pose": "recoiling", "expression": "shock" }
                ]
              },
              "nextSituation": {
                "setupText": "The opponent staggers back. The path to the door is clear, but you hear shouts from the corridor.",
                "cinematicSetup": {
                  "sceneDescription": "New situation after success - protagonist has advantage",
                  "focusSubject": "protagonist surveying options",
                  "cameraAngle": "medium_action",
                  "shotType": "tension_hold",
                  "mood": "anticipation"
                },
                "choices": [
                  {
                    "id": "b1-c1-s-c1",
                    "text": "Rush for the door",
                    "approach": "aggressive",
                    "primarySkill": "athletics",
                    "outcomes": {
                      "success": {
                        "tier": "success",
                        "narrativeText": "You burst through the door just as guards round the corner",
                        "goalTicks": 2,
                        "threatTicks": 0,
                        "isTerminal": true,
                        "encounterOutcome": "victory"
                      },
                      "complicated": {
                        "tier": "complicated",
                        "narrativeText": "You reach the door but a guard blocks your path",
                        "goalTicks": 1,
                        "threatTicks": 1,
                        "nextSituation": {
                          "setupText": "A fresh guard stands between you and freedom.",
                          "choices": [/* 3+ choices continuing the tree */]
                        }
                      },
                      "failure": {
                        "tier": "failure",
                        "narrativeText": "The door is locked! You waste precious seconds.",
                        "goalTicks": 0,
                        "threatTicks": 2,
                        "nextSituation": {
                          "setupText": "Trapped. The first guard is recovering, and you hear more coming.",
                          "choices": [/* 3+ choices continuing the tree */]
                        }
                      }
                    }
                  },
                  {
                    "id": "b1-c1-s-c2",
                    "text": "Barricade the corridor",
                    "approach": "cautious",
                    "primarySkill": "perception",
                    "outcomes": { /* ... similar structure with 3 tiers */ }
                  },
                  {
                    "id": "b1-c1-s-c3",
                    "text": "Search him for keys",
                    "approach": "clever",
                    "primarySkill": "investigation",
                    "outcomes": { /* ... similar structure with 3 tiers */ }
                  }
                ]
              }
            },
            "complicated": {
              "tier": "complicated",
              "narrativeText": "THE ACTION RESULT: Your strike is deflected but you hold your ground",
              "goalTicks": 1,
              "threatTicks": 1,
              "cinematicDescription": {
                "sceneDescription": "The clash - blades locked, neither has advantage",
                "focusSubject": "locked weapons, faces close",
                "cameraAngle": "dutch_chaos",
                "shotType": "action_moment",
                "mood": "tense_uncertainty"
              },
              "nextSituation": {
                "setupText": "You're locked blade-to-blade, straining against each other. His breath is hot on your face.",
                "choices": [
                  {
                    "id": "b1-c1-p-c1",
                    "text": "Headbutt him",
                    "approach": "aggressive",
                    "outcomes": { /* ... DIFFERENT from success branch */ }
                  },
                  {
                    "id": "b1-c1-p-c2",
                    "text": "Push and disengage",
                    "approach": "cautious",
                    "outcomes": { /* ... DIFFERENT from success branch */ }
                  },
                  {
                    "id": "b1-c1-p-c3",
                    "text": "Twist his blade aside",
                    "approach": "clever",
                    "outcomes": { /* ... DIFFERENT from both above */ }
                  }
                ]
              }
            },
            "failure": {
              "tier": "failure",
              "narrativeText": "THE ACTION RESULT: He parries easily and drives you back against the wall",
              "goalTicks": 0,
              "threatTicks": 2,
              "cinematicDescription": {
                "sceneDescription": "The MISS - opponent deflects and protagonist is vulnerable",
                "focusSubject": "protagonist pressed against wall",
                "cameraAngle": "high_vulnerability",
                "shotType": "impact",
                "mood": "desperate"
              },
              "nextSituation": {
                "setupText": "Your back hits the cold stone. He advances, sword raised for the killing blow.",
                "choices": [
                  {
                    "id": "b1-c1-f-c1",
                    "text": "Grab a torch from the wall",
                    "approach": "desperate",
                    "outcomes": { /* ... DIFFERENT from success/complicated branches */ }
                  },
                  {
                    "id": "b1-c1-f-c2",
                    "text": "Shield yourself and brace",
                    "approach": "cautious",
                    "outcomes": { /* ... DIFFERENT */ }
                  },
                  {
                    "id": "b1-c1-f-c3",
                    "text": "Beg for mercy",
                    "approach": "social",
                    "outcomes": { /* ... DIFFERENT from both above */ }
                  }
                ]
              }
            }
          }
        },
        {
          "id": "b1-c2",
          "text": "Careful approach choice",
          "approach": "cautious",
          "impliedApproach": "cautious",
          "primarySkill": "perception",
          "outcomes": { /* ... similar branching structure */ }
        },
        {
          "id": "b1-c3",
          "text": "Choice unlocked by prior state (e.g., call on an ally, use leverage, invoke prior promise)",
          "approach": "clever",
          "primarySkill": "persuasion",
          "conditions": { "type": "flag", "flag": "prior_flag_name", "value": true },
          "showWhenLocked": true,
          "lockedText": "You'd need to have [done the prior action] to use this",
          "outcomes": { /* ... outcomes reflecting the earned advantage */ }
        }
      ]
    }
  ],
  
  "startingBeatId": "beat-1",
  
  "storylets": {
    "victory": {
      "id": "${input.sceneId}-storylet-victory",
      "name": "Victory Aftermath",
      "triggerOutcome": "victory",
      "tone": "triumphant",
      "narrativeFunction": "Celebrate success, show growth from triumph",
      "beats": [
        {
          "id": "${input.sceneId}-storylet-victory-beat-1",
          "text": "2-3 sentences: the world reacts to your success. Show the tangible result of victory."
        },
        {
          "id": "${input.sceneId}-storylet-victory-beat-2",
          "text": "1-2 sentences: forward momentum. The character recognizes how they've grown. A sense of earned confidence.",
          "isTerminal": true
        }
      ],
      "startingBeatId": "${input.sceneId}-storylet-victory-beat-1",
      "consequences": [
        { "type": "score", "name": "confidence", "change": 5 },
        { "type": "score", "name": "USE_PRIMARY_SKILL_NAME_HERE", "change": 3 }
      ],
      "setsFlags": [{ "flag": "encounter_${input.sceneId}_victory", "value": true }],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    },
    "defeat": {
      "id": "${input.sceneId}-storylet-defeat",
      "name": "Defeat Aftermath",
      "triggerOutcome": "defeat",
      "tone": "somber",
      "narrativeFunction": "Show cost of failure, create learning arc, build resolve for recovery",
      "beats": [
        {
          "id": "${input.sceneId}-storylet-defeat-beat-1",
          "text": "2-3 sentences: the immediate aftermath. Show what was lost. Somber but NOT hopeless."
        },
        {
          "id": "${input.sceneId}-storylet-defeat-beat-2",
          "text": "2-3 sentences: reflection and learning. A mentor, ally, or inner voice reveals insight. Reference the skill that was tested. Frame growth narratively."
        },
        {
          "id": "${input.sceneId}-storylet-defeat-beat-3",
          "text": "1-2 sentences: resolve. The character commits to moving forward, changed. A moment of determination.",
          "isTerminal": true
        }
      ],
      "startingBeatId": "${input.sceneId}-storylet-defeat-beat-1",
      "consequences": [
        { "type": "score", "name": "setbacks", "change": 1 },
        { "type": "score", "name": "resolve", "change": 3 },
        { "type": "score", "name": "USE_RELEVANT_SKILL_HERE", "change": 2 }
      ],
      "setsFlags": [{ "flag": "encounter_${input.sceneId}_defeat", "value": true }],
      "nextSceneId": "${input.defeatNextSceneId || 'next-scene'}"
    },
    "escape": {
      "id": "${input.sceneId}-storylet-escape",
      "name": "Narrow Escape",
      "triggerOutcome": "escape",
      "tone": "relieved",
      "narrativeFunction": "Tension release, assess what was gained and lost, build resourcefulness",
      "beats": [
        {
          "id": "${input.sceneId}-storylet-escape-beat-1",
          "text": "2-3 sentences: the tension of barely getting away. What was left behind."
        },
        {
          "id": "${input.sceneId}-storylet-escape-beat-2",
          "text": "1-2 sentences: taking stock. The character is wiser but the challenge remains.",
          "isTerminal": true
        }
      ],
      "startingBeatId": "${input.sceneId}-storylet-escape-beat-1",
      "consequences": [
        { "type": "score", "name": "resourcefulness", "change": 2 }
      ],
      "setsFlags": [{ "flag": "encounter_${input.sceneId}_escaped", "value": true }],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    }
  },
  
  "environmentalElements": [],
  "npcStates": [],
  "escalationTriggers": [],
  
  "informationVisibility": {
    "threatClockVisible": true,
    "npcTellsRevealAt": "encounter_50_percent",
    "environmentElementsHidden": [],
    "choiceOutcomesUnknown": true
  },
  
  "estimatedDuration": "medium",
  "replayability": "high",
  "designNotes": "Explain your branching design"
}

## CRITICAL REQUIREMENTS FOR BRANCHING TREES

1. **BRANCHING IS MANDATORY**: Each outcome (success/complicated/failure) MUST lead to a DIFFERENT nextSituation with DIFFERENT choices
2. **ACTION RESULT VISUALS**: The narrativeText and cinematicDescription show THE RESULT of the player's action (sword hitting/missing, plea accepted/rejected)
3. **DEPTH LIMIT**: Generate 2-3 layers of choices. Every situation at every depth MUST have at least 3 choices.
4. **NO nextBeatId**: Do NOT use nextBeatId. Use nextSituation with embedded choices instead.
5. **TERMINAL OUTCOMES**: When goal/threat clocks would fill, mark outcome as terminal with appropriate encounterOutcome
6. **CONSEQUENCES DIFFER**: Success branches should trend toward victory, failure branches toward defeat - but not linearly
7. **THREE-APPROACH MANDATE**: Each set of 3+ choices should cover distinct approaches — one aggressive/direct, one cautious/methodical, one clever/unconventional. This ensures the player always has meaningfully different paths, not just variations on the same tactic.
7. First beat choices MUST include \`impliedApproach\` field
8. ALL THREE STORYLETS (victory, defeat, escape) MUST be defined
9. Text length: setupText ~30-50 words, narrativeText ~30-60 words
10. Return ONLY valid JSON, no markdown

## CHARACTER NAME TEMPLATES (CRITICAL)

All encounter text (setupText, narrativeText, storylet beat text) MUST use template variables for the protagonist — NEVER use the protagonist's literal name or the story title:
- **{{player.name}}** — the player character's name
- **{{player.they}}** — subject pronoun (he/she/they)
- **{{player.them}}** — object pronoun (him/her/them)
- **{{player.their}}** — possessive pronoun (his/her/their)

**Verb conjugation**: Prefer {{player.name}} as the sentence subject when an action verb follows ("{{player.name}} catches the blade" not "{{player.they}} catch the blade"). When you do use {{player.they}} with a verb, write the plural/base form ("{{player.they}} catch", "{{player.they}} dodge") — the engine auto-conjugates for singular pronouns. Use {{Player.they}} (capital P) at sentence starts.

Example: "{{player.name}} presses close to the wall, water dripping from {{player.their}} dark hair."
NPCs should be referred to by their actual names.

## TEXT QUALITY - ACTION/REACTION

- **narrativeText** = THE ACTION RESULT: "Your blade bites into his shoulder" not "You attack him"
- **nextSituation.setupText** = THE NEW SITUATION: "He drops his sword, clutching the wound. Behind him, the door stands open."
- The IMAGE shows the ACTION RESULT, the TEXT describes the ACTION RESULT
- The nextSituation shows what comes NEXT

## BRANCHING PHILOSOPHY

Think of this like a "choose your own adventure" TREE, not a linear path:
- If I succeed at intimidation → the guard backs down, new options
- If I fail at intimidation → the guard attacks, completely different options
- If it's complicated → standoff, third set of options

The DRAMA comes from seeing genuinely different outcomes based on skill checks, not just different flavor text leading to the same place.

## OUTCOME TRAJECTORY — How Branches Feel

The player should FEEL whether they're winning or losing as they progress through the encounter tree:

- **After SUCCESS**: The next situation should feel more hopeful. Choices open up — you're on the front foot. The narrative signals momentum ("The path clears", "You press the advantage"). Goal clock ticks should accumulate visibly.
- **After COMPLICATED**: The next situation should feel tense and precarious. You gained something but the threat is real. Choices should force hard tradeoffs ("Save the hostage or chase the villain"). Both clocks tick.
- **After FAILURE**: The next situation should feel desperate but not hopeless. Choices shift to survival and creative improvisation, the environment closes in, but there's always a path back. Threat clock pressure mounts.

The player should be able to intuit "I'm on a path toward victory" or "I'm struggling and need to turn this around." This is not about telling them — it's about the TONE and STAKES of each successive situation escalating in the right direction.

## TENSION THROUGH CHOICE DESIGN

- At EVERY depth level, present at least 3 choices that feel distinct in risk/reward
- As depth increases, the STAKES of each choice should rise — not the number decrease
- Deeper choices should feel more consequential: early choices are probing, late choices are all-in
- Terminal outcomes (isTerminal: true) should feel like natural climaxes, not arbitrary cutoffs
- When a branch trends toward defeat, choices should shift from "how do I win?" to "how do I survive?" — this IS the tension
`;
  }

  /**
   * Simplified prompt for final retry attempt.
   * Requests a flat 2-beat encounter with simpler structure — still LLM-generated
   * with story-specific content, but without deep branching trees.
   * This avoids token exhaustion and produces valid encounters reliably.
   */
  private buildSimplifiedPrompt(input: EncounterArchitectInput): string {
    const protagonist = input.protagonistInfo.name || 'the protagonist';
    const antagonist = input.npcsInvolved.find(n => n.role === 'enemy')?.name ||
                       input.npcsInvolved[0]?.name || 'the opponent';
    const skill1 = input.availableSkills[0]?.name || 'athletics';
    const skill2 = input.availableSkills[1]?.name || 'perception';
    const skill3 = input.availableSkills[2]?.name || 'persuasion';

    return `
Generate a SIMPLE 2-beat encounter for the following scene. This is a simplified request — focus on producing valid, complete JSON.

## Scene
- Scene ID: ${input.sceneId}
- Scene Name: ${input.sceneName}
- Description: ${input.sceneDescription}
- Planned Encounter ID: ${input.plannedEncounterId || 'none'}
- Type: ${input.encounterType}
- Difficulty: ${input.difficulty}
- Stakes: ${input.encounterStakes || 'Keep the stakes personal and specific to the protagonist'}
- Relevant Skills: ${(input.encounterRelevantSkills || []).join(', ') || `${skill1}, ${skill2}, ${skill3}`}
- Beat Plan:
${(input.encounterBeatPlan && input.encounterBeatPlan.length > 0)
  ? input.encounterBeatPlan.map((beat, index) => `  ${index + 1}. ${beat}`).join('\n')
  : '  1. Opening pressure\n  2. Crisis and resolution'}
- Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})
- Protagonist: ${protagonist} (${input.protagonistInfo.pronouns})
- Key NPC: ${antagonist}

## CHARACTER NAME TEMPLATES (CRITICAL)
All text fields (setupText, narrativeText, storylet text) MUST use {{player.name}} for the protagonist — NEVER the literal name or story title.
Use {{player.they}}/{{player.them}}/{{player.their}} for pronouns. NPCs use their actual names.

## REQUIRED: Return ONLY this JSON structure (no markdown, no prose)

The "beats" array MUST have exactly 2 beats. Each beat MUST have 3 choices (aggressive, cautious, clever). Each choice MUST have success/complicated/failure outcomes. Even in this simplified retry, the encounter must still honor the supplied stakes and beat plan.

Beat 1 = "setup" phase (the opening confrontation)
Beat 2 = "resolution" phase (the climax, all outcomes are terminal)

{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "goalClock": { "name": "string", "segments": 6, "description": "string" },
  "threatClock": { "name": "string", "segments": 4, "description": "string" },
  "stakes": { "victory": "string", "defeat": "string" },
  "beats": [
    {
      "id": "beat-1",
      "phase": "setup",
      "name": "Opening Moment",
      "description": "string",
      "setupText": "2-3 sentences about the initial situation (30-50 words)",
      "choices": [
        {
          "id": "b1-c1",
          "text": "Bold action (5-10 words)",
          "approach": "aggressive",
          "impliedApproach": "aggressive",
          "primarySkill": "${skill1}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "2-3 sentences of result", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "2-3 sentences", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "2-3 sentences", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        },
        {
          "id": "b1-c2",
          "text": "Careful approach (5-10 words)",
          "approach": "cautious",
          "impliedApproach": "cautious",
          "primarySkill": "${skill2}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        },
        {
          "id": "b1-c3",
          "text": "Clever trick (5-10 words)",
          "approach": "clever",
          "impliedApproach": "clever",
          "primarySkill": "${skill3}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        }
      ]
    },
    {
      "id": "beat-2",
      "phase": "resolution",
      "name": "Critical Moment",
      "description": "string",
      "setupText": "2-3 sentences about the climactic moment (30-50 words)",
      "isTerminal": true,
      "choices": [
        {
          "id": "b2-c1",
          "text": "Go for victory (5-10 words)",
          "approach": "bold",
          "primarySkill": "${skill1}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 3, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 2, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "partialVictory" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 3, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        },
        {
          "id": "b2-c2",
          "text": "Hold your ground (5-10 words)",
          "approach": "cautious",
          "primarySkill": "${skill2}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "escape" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        },
        {
          "id": "b2-c3",
          "text": "Find another way (5-10 words)",
          "approach": "clever",
          "primarySkill": "${skill3}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "escape" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        }
      ]
    }
  ],
  "startingBeatId": "beat-1",
  "tensionCurve": [
    { "beatId": "beat-1", "tensionLevel": 5, "description": "Setup tension" },
    { "beatId": "beat-2", "tensionLevel": 9, "description": "Climax tension" }
  ],
  "storylets": {
    "victory": {
      "id": "${input.sceneId}-storylet-victory",
      "name": "Victory Aftermath",
      "triggerOutcome": "victory",
      "tone": "triumphant",
      "narrativeFunction": "Celebrate success",
      "beats": [{ "id": "${input.sceneId}-sv-1", "text": "1-2 sentences of victory aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-sv-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    },
    "defeat": {
      "id": "${input.sceneId}-storylet-defeat",
      "name": "Defeat Aftermath",
      "triggerOutcome": "defeat",
      "tone": "somber",
      "narrativeFunction": "Show consequences",
      "beats": [{ "id": "${input.sceneId}-sd-1", "text": "1-2 sentences of defeat aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-sd-1",
      "consequences": [],
      "nextSceneId": "${input.defeatNextSceneId || 'next-scene'}"
    },
    "escape": {
      "id": "${input.sceneId}-storylet-escape",
      "name": "Narrow Escape",
      "triggerOutcome": "escape",
      "tone": "relieved",
      "narrativeFunction": "Tension release",
      "beats": [{ "id": "${input.sceneId}-se-1", "text": "1-2 sentences of escape aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-se-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    }
  },
  "environmentalElements": [],
  "npcStates": [],
  "escalationTriggers": [],
  "informationVisibility": { "threatClockVisible": true, "npcTellsRevealAt": "encounter_50_percent", "environmentElementsHidden": [], "choiceOutcomesUnknown": true },
  "estimatedDuration": "medium",
  "replayability": "medium",
  "designNotes": "Simplified encounter structure"
}

CRITICAL RULES:
1. Replace ALL "string" placeholders with actual narrative content specific to this scene
2. narrativeText should describe THE RESULT of the action (sword hitting/missing, plea accepted/rejected)
3. setupText should set the scene vividly in 30-50 words
4. Return ONLY the JSON object — no markdown, no backticks, no explanation text
5. The "beats" array MUST contain at least ${this.getMinimumRequiredBeatCount(input)} objects and must honor the encounterBeatPlan
`;
  }

  private validateStructure(structure: EncounterStructure, input: EncounterArchitectInput): void {
    const progressionDepth = this.getEncounterProgressionDepth(structure);
    // Accept either 2+ top-level beats or a tree with 2+ reachable stages.
    if (structure.beats.length < 2 && progressionDepth < 2) {
      throw new Error(
        `Encounter must have at least 2 stages of progression but got ${structure.beats.length} top-level beat(s) and progression depth ${progressionDepth}. The LLM did not generate sufficient encounter content.`
      );
    }

    // Enforce minimum 3 choices per top-level beat
    for (const beat of structure.beats) {
      const choiceCount = beat.choices?.length || 0;
      if (choiceCount < 3) {
        throw new Error(
          `Beat "${beat.id}" has ${choiceCount} choice(s) but needs at least 3. ` +
          `The LLM must provide aggressive, cautious, and clever approaches.`
        );
      }
    }

    // Warn (don't throw) for nested situations with fewer than 3 choices
    const warnNestedChoices = (choices: any[], path: string) => {
      for (const choice of choices) {
        if (!choice.outcomes) continue;
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (outcome?.nextSituation?.choices) {
            const nested = outcome.nextSituation.choices;
            if (nested.length < 3) {
              console.warn(`[EncounterArchitect] ${path} → ${choice.id} → ${tier} has ${nested.length} nested choice(s) (want 3+)`);
            }
            warnNestedChoices(nested, `${path} → ${choice.id} → ${tier}`);
          }
        }
      }
    };
    for (const beat of structure.beats) {
      if (beat.choices) warnNestedChoices(beat.choices, beat.id);
    }

    // Check starting beat exists
    const startingBeat = structure.beats.find(b => b.id === structure.startingBeatId);
    if (!startingBeat) {
      console.warn(`[EncounterArchitect] Starting beat ${structure.startingBeatId} not found - using first beat`);
      structure.startingBeatId = structure.beats[0].id;
    }

    // Validate storylets exist
    if (!structure.storylets?.victory) {
      console.warn('[EncounterArchitect] Missing victory storylet - using default');
      structure.storylets = structure.storylets || {} as typeof structure.storylets;
      structure.storylets.victory = this.createDefaultStorylet('victory', input);
    }
    if (!structure.storylets?.defeat) {
      console.warn('[EncounterArchitect] Missing defeat storylet - using default');
      structure.storylets.defeat = this.createDefaultStorylet('defeat', input);
    }
    if (!structure.storylets?.partialVictory) {
      console.warn('[EncounterArchitect] Missing partialVictory storylet - using default');
      structure.storylets.partialVictory = this.createDefaultStorylet('partialVictory', input);
    }

    // Check beat flow
    const beatIds = new Set(structure.beats.map(b => b.id));
    for (const beat of structure.beats) {
      if (!beat.isTerminal) {
        if (beat.nextBeatOnSuccess && !beatIds.has(beat.nextBeatOnSuccess)) {
          console.warn(`Beat ${beat.id} references non-existent success beat: ${beat.nextBeatOnSuccess}`);
        }
        if (beat.nextBeatOnFailure && !beatIds.has(beat.nextBeatOnFailure)) {
          console.warn(`Beat ${beat.id} references non-existent failure beat: ${beat.nextBeatOnFailure}`);
        }
      }
    }

    // Mark last beat as terminal if needed
    const terminalBeats = structure.beats.filter(b => b.isTerminal);
    if (terminalBeats.length === 0) {
      const lastBeat = structure.beats[structure.beats.length - 1];
      lastBeat.isTerminal = true;
    }

    // Validate text lengths
    const MAX_SETUP_WORDS = 60;
    for (const beat of structure.beats) {
      if (beat.setupText) {
        const wordCount = beat.setupText.split(/\s+/).length;
        if (wordCount > MAX_SETUP_WORDS) {
          console.warn(`[EncounterArchitect] Beat ${beat.id} has ${wordCount} words (max ${MAX_SETUP_WORDS}). Auto-trimming...`);
          const sentences = beat.setupText.match(/[^.!?]+[.!?]+/g) || [beat.setupText];
          if (sentences.length >= 2) {
            beat.setupText = sentences.slice(0, 2).join(' ').trim();
          } else {
            const words = beat.setupText.split(/\s+/).slice(0, 50);
            beat.setupText = words.join(' ') + '...';
          }
        }
      }
    }

    // Log validation summary
    console.log(`[EncounterArchitect] Validation passed:
  - ${structure.beats.length} top-level beats
  - progression depth ${progressionDepth}
  - ${structure.storylets.victory ? 'Victory' : 'NO'} / ${structure.storylets.defeat ? 'Defeat' : 'NO'} / ${structure.storylets.escape ? 'Escape' : 'NO'} storylets
  - ${structure.environmentalElements?.length || 0} environmental elements
  - ${structure.npcStates?.length || 0} NPC states
  - ${structure.escalationTriggers?.length || 0} escalation triggers`);
  }

  // ========================================================================
  // PHASED ENCOUNTER GENERATION
  // ========================================================================

  /**
   * Multi-phase encounter generation. Breaks the monolithic LLM call into
   * smaller, focused calls that each produce 1-2K tokens of flat JSON.
   *
   * Flow:
   *  0. Relationship Dynamics Analysis (deterministic, instant)
   *  1. Phase 1: Opening beat (1 call, ~1.5K tokens)
   *  2. Phase 2a/2b/2c: Branch situations (3 parallel calls, ~2K each)
   *     Phase 3: Enrichment (1 call, ~1K) — parallel with Phase 2
   *     Phase 4: Storylets (1 call, ~1.5K) — parallel with Phase 2
   *  3. Deterministic assembly → EncounterStructure
   */
  async executePhased(
    input: EncounterArchitectInput,
    playerRelationships?: Record<string, Relationship>,
    allNpcs?: NPCInfo[],
  ): Promise<AgentResponse<EncounterStructure>> {
    console.log(`[EncounterArchitect] Starting phased generation for scene: ${input.sceneId}`);
    const phasedStart = Date.now();

    // ---- Pre-phase: Relationship dynamics analysis (deterministic) ----
    const npcInfos: NPCInfo[] = input.npcsInvolved.map(n => ({
      id: n.id, name: n.name, role: n.role,
    }));
    const relSnapshot: RelationshipSnapshot = {
      current: playerRelationships || {},
    };
    const dynamicsBrief = analyzeRelationshipDynamics(npcInfos, relSnapshot, allNpcs);
    console.log(`[EncounterArchitect] Relationship analysis: ${dynamicsBrief.npcDynamics.length} NPCs, ${dynamicsBrief.knockOnEffects.length} knock-on effects`);

    // ---- Phase 1: Opening beat ----
    let phase1: Phase1Result;
    try {
      phase1 = await this.runPhase1(input, dynamicsBrief);
      console.log(`[EncounterArchitect] Phase 1 complete: ${phase1.openingBeat.choices.length} choices`);
    } catch (p1Error) {
      console.warn(`[EncounterArchitect] Phase 1 failed, using deterministic fallback: ${p1Error instanceof Error ? p1Error.message : p1Error}`);
      let structure = this.buildDeterministicFallback(input);
      structure = this.normalizeStructure(structure, input);
      this.validateStructure(structure, input);
      return { success: true, data: structure };
    }

    // ---- Phases 2, 3, 4 in parallel ----
    const phase2Promises = phase1.openingBeat.choices.map(choice =>
      this.runPhase2(input, dynamicsBrief, choice).catch(err => {
        console.warn(`[EncounterArchitect] Phase 2 failed for choice ${choice.id}: ${err instanceof Error ? err.message : err}`);
        return null;
      })
    );

    const phase3Promise = input.priorStateContext
      ? this.runPhase3(input, phase1).catch(err => {
          console.warn(`[EncounterArchitect] Phase 3 failed: ${err instanceof Error ? err.message : err}`);
          return null;
        })
      : Promise.resolve(null);

    const phase4Promise = this.runPhase4(input, dynamicsBrief).catch(err => {
      console.warn(`[EncounterArchitect] Phase 4 failed: ${err instanceof Error ? err.message : err}`);
      return null;
    });

    const [phase2Results, phase3Result, phase4Result] = await Promise.all([
      Promise.all(phase2Promises),
      phase3Promise,
      phase4Promise,
    ]);

    console.log(`[EncounterArchitect] Parallel phases complete: Phase2=[${phase2Results.map(r => r ? 'OK' : 'FAIL').join(',')}] Phase3=${phase3Result ? 'OK' : 'SKIP/FAIL'} Phase4=${phase4Result ? 'OK' : 'FAIL'}`);

    // ---- Deterministic Assembly ----
    let structure = this.assemblePhasedEncounter(input, phase1, phase2Results, phase3Result, phase4Result, dynamicsBrief);
    structure = this.normalizeStructure(structure, input);
    this.validateStructure(structure, input);

    const totalMs = Date.now() - phasedStart;
    console.log(`[EncounterArchitect] Phased generation complete in ${totalMs}ms for ${input.sceneId}`);

    return { success: true, data: structure };
  }

  // ---- Phase 1: Opening Beat ----

  private async runPhase1(input: EncounterArchitectInput, brief: RelationshipDynamicsBrief): Promise<Phase1Result> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), EncounterArchitect.PER_CALL_TIMEOUT_MS);
    try {
      const messages: AgentMessage[] = [{ role: 'user', content: this.buildPhase1Prompt(input, brief) }];
      const response = await this.callLLM(messages, 1, { signal: ac.signal });
      return this.parseJSON<Phase1Result>(response);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPhase1Prompt(input: EncounterArchitectInput, brief: RelationshipDynamicsBrief): string {
    const protagonist = input.protagonistInfo.name || '{{player.name}}';
    const npcsList = input.npcsInvolved
      .map(npc => `- ${npc.name} (${npc.id}, ${npc.pronouns}): ${npc.role} — ${npc.description}`)
      .join('\n');
    const skillsList = input.availableSkills.slice(0, 6)
      .map(s => `${s.name} (${s.attribute})`)
      .join(', ');

    const relationshipSection = brief.briefText
      ? `\n## Relationship Dynamics\n${brief.briefText}\n`
      : '';

    return `Generate the OPENING BEAT of a ${input.encounterType} encounter. Return ONLY valid JSON.

## Scene
- ID: ${input.sceneId}
- Name: ${input.sceneName}
- Description: ${input.sceneDescription}
- Mood: ${input.sceneMood}
- Type: ${input.encounterType} | Style: ${input.encounterStyle || 'auto'}
- Difficulty: ${input.difficulty}
- Stakes: ${input.encounterStakes || 'Keep stakes personal'}
- Skills: ${skillsList}

## Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})

## Protagonist: ${protagonist} (${input.protagonistInfo.pronouns})

## NPCs
${npcsList || 'None'}
${relationshipSection}
## TEXT RULES
- Use {{player.name}} for protagonist, {{player.they}}/{{player.them}}/{{player.their}} for pronouns
- setupText: 30-50 words setting the opening situation
- narrativeText: 30-60 words showing THE RESULT of the action (not the action itself)
- Each outcome narrative must be SPECIFIC to the choice taken

## TASK
Generate 3 distinct choices (bold/cautious/clever approaches, each using a different skill).
For EACH choice, write 3 outcome narratives (success/complicated/failure) that are SPECIFIC to that exact action.
"Your blade finds his shoulder" and "Your words give him pause" are both successes but from DIFFERENT choices.

## JSON FORMAT
{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "goalClock": { "name": "string", "segments": 6, "description": "string" },
  "threatClock": { "name": "string", "segments": 4, "description": "string" },
  "stakes": { "victory": "string", "defeat": "string" },
  "openingBeat": {
    "setupText": "30-50 words: the opening situation",
    "choices": [
      {
        "id": "c1", "text": "Bold action (5-10 words)", "approach": "aggressive",
        "primarySkill": "skill_name", "impliedApproach": "aggressive",
        "outcomes": {
          "success": { "narrativeText": "30-60 words", "goalTicks": 2, "threatTicks": 0 },
          "complicated": { "narrativeText": "30-60 words", "goalTicks": 1, "threatTicks": 1 },
          "failure": { "narrativeText": "30-60 words", "goalTicks": 0, "threatTicks": 2 }
        }
      },
      { "id": "c2", "text": "Cautious approach", "approach": "cautious", "primarySkill": "...", "outcomes": { ... } },
      { "id": "c3", "text": "Clever trick", "approach": "clever", "primarySkill": "...", "outcomes": { ... } }
    ]
  }
}

Replace ALL placeholders with actual narrative. Return ONLY the JSON object.`;
  }

  // ---- Phase 2: Choice-Specific Branch Situations ----

  private async runPhase2(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    choice: Phase1Result['openingBeat']['choices'][0],
  ): Promise<Phase2Result> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), EncounterArchitect.PER_CALL_TIMEOUT_MS);
    try {
      const messages: AgentMessage[] = [{ role: 'user', content: this.buildPhase2Prompt(input, brief, choice) }];
      const response = await this.callLLM(messages, 1, { signal: ac.signal });
      return this.parseJSON<Phase2Result>(response);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPhase2Prompt(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    choice: Phase1Result['openingBeat']['choices'][0],
  ): string {
    const npcsList = input.npcsInvolved
      .map(npc => `- ${npc.name} (${npc.id}): ${npc.role}`)
      .join('\n');

    const relationshipSection = brief.briefText
      ? `\n## Relationship Dynamics\n${brief.briefText}\n`
      : '';

    return `Generate the NEXT MOMENT after the player chose: "${choice.text}" (${choice.approach}).
Return ONLY valid JSON.

## Context
- Scene: ${input.sceneName} — ${input.sceneDescription}
- Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})
- NPCs: ${npcsList}
${relationshipSection}
## What the player tried
Choice: "${choice.text}" (skill: ${choice.primarySkill})
- SUCCESS result: ${choice.outcomes.success.narrativeText}
- COMPLICATED result: ${choice.outcomes.complicated.narrativeText}
- FAILURE result: ${choice.outcomes.failure.narrativeText}

## TASK
For EACH outcome tier (afterSuccess, afterComplicated, afterFailure), generate:
1. A setupText (30-50 words) describing the NEW situation after that outcome
2. Three new choices (bold/cautious/clever) specific to that new situation
3. Each choice has success/complicated/failure outcomes, ALL terminal (isTerminal: true)
4. Terminal outcomes must include encounterOutcome: "victory"|"partialVictory"|"defeat"|"escape"
5. Include relationshipConsequences on outcomes where choices affect NPC relationships

## TEXT RULES
- Use {{player.name}} for protagonist, {{player.they}}/{{player.them}}/{{player.their}} for pronouns
- narrativeText must be SPECIFIC to the choice and situation, 30-60 words
- Each of the 3 situations (afterSuccess/afterComplicated/afterFailure) must feel DIFFERENT

## JSON FORMAT
{
  "choiceId": "${choice.id}",
  "afterSuccess": {
    "setupText": "30-50 words: situation after success",
    "choices": [
      {
        "id": "${choice.id}-s-c1", "text": "5-10 words", "approach": "bold", "primarySkill": "skill",
        "outcomes": {
          "success": { "narrativeText": "...", "goalTicks": 3, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
          "complicated": { "narrativeText": "...", "goalTicks": 2, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "partialVictory" },
          "failure": { "narrativeText": "...", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
        }
      },
      { "id": "${choice.id}-s-c2", ... },
      { "id": "${choice.id}-s-c3", ... }
    ]
  },
  "afterComplicated": {
    "setupText": "30-50 words: situation after complication",
    "choices": [ { "id": "${choice.id}-p-c1", ... }, ... ]
  },
  "afterFailure": {
    "setupText": "30-50 words: situation after failure",
    "choices": [ { "id": "${choice.id}-f-c1", ... }, ... ]
  }
}

Replace ALL placeholders. Return ONLY the JSON object.`;
  }

  // ---- Phase 3: Prior State Enrichment ----

  private async runPhase3(input: EncounterArchitectInput, phase1: Phase1Result): Promise<Phase3Result> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const messages: AgentMessage[] = [{ role: 'user', content: this.buildPhase3Prompt(input, phase1) }];
      const response = await this.callLLM(messages, 1, { signal: ac.signal });
      return this.parseJSON<Phase3Result>(response);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPhase3Prompt(input: EncounterArchitectInput, phase1: Phase1Result): string {
    const ctx = input.priorStateContext!;
    const flagNames = ctx.relevantFlags.map(f => `"${f.name}" — ${f.description}`).join('\n  ');
    const relDescs = ctx.relevantRelationships.map(r =>
      `${r.npcName}.${r.dimension} ${r.operator} ${r.threshold} — ${r.description}`
    ).join('\n  ');
    const choiceDescs = ctx.significantChoices.join('; ');

    const choiceIds = phase1.openingBeat.choices.map(c => `"${c.id}" (${c.text})`).join(', ');

    return `Generate ENRICHMENT for an encounter's opening beat based on prior player state.
Return ONLY valid JSON.

## Scene: ${input.sceneName}
## Opening choices: ${choiceIds}
## Opening setupText: "${phase1.openingBeat.setupText}"

## Prior State
Flags:
  ${flagNames || 'None'}
Relationships:
  ${relDescs || 'None'}
Significant prior choices: ${choiceDescs || 'None'}

## TASK
Generate a JSON patch with up to 3 types of enrichment:

1. **setupTextVariants** (1-3): Alternative opening text when a condition is true.
   Use conditions like: { "type": "flag", "flag": "name", "value": true }
   or: { "type": "relationship", "npcId": "id", "dimension": "trust", "operator": "<", "value": -20 }

2. **statBonuses** (1-2): Difficulty reduction on a choice when a condition is true.
   Reference choices by id (${choiceIds}).

3. **conditionalChoices** (0-1): A bonus choice unlocked by prior state. Include lockedText hint.

## JSON FORMAT
{
  "setupTextVariants": [
    { "condition": { "type": "flag", "flag": "...", "value": true }, "text": "Alternative opening text 30-50 words" }
  ],
  "statBonuses": [
    { "choiceRef": "c1", "condition": { ... }, "difficultyReduction": 15, "flavorText": "Why this bonus exists" }
  ],
  "conditionalChoices": [
    {
      "id": "c4", "text": "5-10 words", "approach": "social", "primarySkill": "persuasion",
      "conditions": { "type": "flag", "flag": "...", "value": true },
      "showWhenLocked": true, "lockedText": "Hint about what unlocks this",
      "outcomes": {
        "success": { "narrativeText": "...", "goalTicks": 2, "threatTicks": 0 },
        "complicated": { "narrativeText": "...", "goalTicks": 1, "threatTicks": 1 },
        "failure": { "narrativeText": "...", "goalTicks": 0, "threatTicks": 2 }
      }
    }
  ]
}

Keep enrichment subtle — the world remembering, not a pop-up reward.
Return ONLY the JSON object.`;
  }

  // ---- Phase 4: Storylets ----

  private async runPhase4(input: EncounterArchitectInput, brief: RelationshipDynamicsBrief): Promise<Phase4Result> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const messages: AgentMessage[] = [{ role: 'user', content: this.buildPhase4Prompt(input, brief) }];
      const response = await this.callLLM(messages, 1, { signal: ac.signal });
      return this.parseJSON<Phase4Result>(response);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPhase4Prompt(input: EncounterArchitectInput, brief: RelationshipDynamicsBrief): string {
    const npcsList = input.npcsInvolved.map(n => n.name).join(', ');
    const relationshipSection = brief.briefText
      ? `\n## Relationship Dynamics\n${brief.briefText}\n`
      : '';

    return `Generate encounter STORYLETS (aftermath sequences). Return ONLY valid JSON.

## Scene: ${input.sceneName} — ${input.sceneDescription}
## Type: ${input.encounterType} | Difficulty: ${input.difficulty}
## Stakes: ${input.encounterStakes || 'personal to the protagonist'}
## NPCs: ${npcsList || 'None'}
## Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})
${relationshipSection}
## TASK
Generate 3 storylets for: victory, defeat, escape. Each is a short aftermath sequence.

### Victory (2 beats): Triumph → Forward momentum. Tone: triumphant.
### Defeat (3 beats): Impact → Reflection/Learning → Resolve. Tone: somber. Must feel like START of recovery, not dead end.
### Escape (2 beats): Close call → Assessment. Tone: relieved/tense.

## TEXT RULES
- Use {{player.name}} for protagonist, {{player.they}}/{{player.them}}/{{player.their}} for pronouns
- Beat text: 2-3 sentences max. Reference specific NPCs and the encounter's stakes.
- Last beat in each storylet must have "isTerminal": true

## JSON FORMAT
{
  "victory": {
    "id": "${input.sceneId}-sv",
    "name": "Victory",
    "triggerOutcome": "victory",
    "tone": "triumphant",
    "narrativeFunction": "Celebrate and show growth",
    "beats": [
      { "id": "${input.sceneId}-sv-1", "text": "2-3 sentences of triumph" },
      { "id": "${input.sceneId}-sv-2", "text": "1-2 sentences of forward momentum", "isTerminal": true }
    ],
    "startingBeatId": "${input.sceneId}-sv-1",
    "consequences": [],
    "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
  },
  "defeat": {
    "id": "${input.sceneId}-sd",
    "name": "Defeat",
    "triggerOutcome": "defeat",
    "tone": "somber",
    "narrativeFunction": "Process failure and find resolve",
    "beats": [
      { "id": "${input.sceneId}-sd-1", "text": "2-3 sentences of impact" },
      { "id": "${input.sceneId}-sd-2", "text": "2-3 sentences of reflection" },
      { "id": "${input.sceneId}-sd-3", "text": "1-2 sentences of resolve", "isTerminal": true }
    ],
    "startingBeatId": "${input.sceneId}-sd-1",
    "consequences": [],
    "nextSceneId": "${input.defeatNextSceneId || 'next-scene'}"
  },
  "escape": {
    "id": "${input.sceneId}-se",
    "name": "Escape",
    "triggerOutcome": "escape",
    "tone": "relieved",
    "narrativeFunction": "Narrow escape and taking stock",
    "beats": [
      { "id": "${input.sceneId}-se-1", "text": "2-3 sentences of close call" },
      { "id": "${input.sceneId}-se-2", "text": "1-2 sentences of assessment", "isTerminal": true }
    ],
    "startingBeatId": "${input.sceneId}-se-1",
    "consequences": [],
    "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
  }
}

Replace ALL placeholder text with specific, scene-appropriate narrative.
Return ONLY the JSON object.`;
  }

  // ========================================================================
  // DETERMINISTIC ASSEMBLY
  // ========================================================================

  /**
   * Assembles the final EncounterStructure from the outputs of all phases.
   * Pure deterministic code — cannot fail.
   */
  assemblePhasedEncounter(
    input: EncounterArchitectInput,
    phase1: Phase1Result,
    phase2Results: (Phase2Result | null)[],
    phase3Result: Phase3Result | null,
    phase4Result: Phase4Result | null,
    brief: RelationshipDynamicsBrief,
  ): EncounterStructure {
    // Build beat-1 from Phase 1
    const beat1Choices: EncounterChoice[] = phase1.openingBeat.choices.map(c => {
      const phase2 = phase2Results.find(r => r?.choiceId === c.id);
      return {
        id: c.id,
        text: c.text,
        approach: c.approach as EncounterApproach,
        impliedApproach: (c.impliedApproach || c.approach) as EncounterApproach,
        primarySkill: c.primarySkill,
        outcomes: {
          success: this.buildOutcomeWithBranch(c.outcomes.success, 'success', phase2?.afterSuccess, brief),
          complicated: this.buildOutcomeWithBranch(c.outcomes.complicated, 'complicated', phase2?.afterComplicated, brief),
          failure: this.buildOutcomeWithBranch(c.outcomes.failure, 'failure', phase2?.afterFailure, brief),
        },
      } as EncounterChoice;
    });

    // Apply Phase 3 enrichment
    if (phase3Result) {
      this.applyEnrichment(beat1Choices, phase1.openingBeat, phase3Result);
    }

    const beat1: EncounterBeat = {
      id: 'beat-1',
      phase: 'setup' as EscalationPhase,
      name: input.sceneName,
      description: input.sceneDescription,
      setupText: phase1.openingBeat.setupText,
      choices: beat1Choices,
      ...(phase3Result?.setupTextVariants ? { setupTextVariants: phase3Result.setupTextVariants as any } : {}),
    } as EncounterBeat;

    // Build storylets from Phase 4 or use minimal defaults
    const storylets = phase4Result || this.buildDefaultStorylets(input);

    return {
      sceneId: phase1.sceneId || input.sceneId,
      encounterType: (phase1.encounterType || input.encounterType) as EncounterType,
      encounterStyle: input.encounterStyle,
      goalClock: phase1.goalClock || { name: 'Objective', segments: 6, description: 'Achieve the goal' },
      threatClock: phase1.threatClock || { name: 'Danger', segments: 4, description: 'Escalating threat' },
      stakes: phase1.stakes || { victory: 'Overcome the challenge', defeat: 'Suffer the consequences' },
      beats: [beat1],
      startingBeatId: 'beat-1',
      storylets: storylets as any,
    } as EncounterStructure;
  }

  /**
   * Builds an EncounterChoiceOutcome, wiring in a Phase 2 branch situation
   * as nextSituation and attaching relationship consequences.
   */
  private buildOutcomeWithBranch(
    phase1Outcome: { narrativeText: string; goalTicks: number; threatTicks: number },
    tier: 'success' | 'complicated' | 'failure',
    phase2Situation: Phase2Situation | undefined,
    brief: RelationshipDynamicsBrief,
  ): EncounterChoiceOutcome {
    const outcome: EncounterChoiceOutcome = {
      tier,
      narrativeText: phase1Outcome.narrativeText,
      goalTicks: phase1Outcome.goalTicks,
      threatTicks: phase1Outcome.threatTicks,
    };

    if (phase2Situation) {
      outcome.nextSituation = {
        setupText: phase2Situation.setupText,
        choices: phase2Situation.choices.map(c => this.convertPhase2Choice(c, brief)),
      };
    }

    return outcome;
  }

  /**
   * Converts a Phase 2 choice into an EmbeddedEncounterChoice with typed
   * outcomes and relationship consequences.
   */
  private convertPhase2Choice(
    choice: Phase2Situation['choices'][0],
    brief: RelationshipDynamicsBrief,
  ): EmbeddedEncounterChoice {
    return {
      id: choice.id,
      text: choice.text,
      approach: choice.approach,
      primarySkill: choice.primarySkill,
      outcomes: {
        success: this.convertPhase2Outcome(choice.outcomes.success, 'success', brief),
        complicated: this.convertPhase2Outcome(choice.outcomes.complicated, 'complicated', brief),
        failure: this.convertPhase2Outcome(choice.outcomes.failure, 'failure', brief),
      },
    };
  }

  private convertPhase2Outcome(
    raw: Phase2Outcome,
    tier: 'success' | 'complicated' | 'failure',
    brief: RelationshipDynamicsBrief,
  ): EncounterChoiceOutcome {
    const consequences: any[] = [];

    if (raw.relationshipConsequences) {
      for (const rc of raw.relationshipConsequences) {
        const dim = rc.dimension as 'trust' | 'affection' | 'respect' | 'fear';
        if (['trust', 'affection', 'respect', 'fear'].includes(dim)) {
          consequences.push({ type: 'relationship', npcId: rc.npcId, dimension: dim, change: rc.change });
        }
      }
    }

    return {
      tier,
      narrativeText: raw.narrativeText,
      goalTicks: raw.goalTicks,
      threatTicks: raw.threatTicks,
      isTerminal: raw.isTerminal || false,
      encounterOutcome: raw.encounterOutcome as EncounterOutcome | undefined,
      ...(consequences.length > 0 ? { consequences } : {}),
    };
  }

  /**
   * Applies Phase 3 enrichment patches to the opening beat choices.
   */
  private applyEnrichment(
    choices: EncounterChoice[],
    openingBeat: Phase1Result['openingBeat'],
    enrichment: Phase3Result,
  ): void {
    if (enrichment.statBonuses) {
      for (const bonus of enrichment.statBonuses) {
        const choice = choices.find(c => c.id === bonus.choiceRef);
        if (choice) {
          choice.statBonus = {
            condition: bonus.condition as any,
            difficultyReduction: bonus.difficultyReduction,
            flavorText: bonus.flavorText,
          };
        }
      }
    }

    if (enrichment.conditionalChoices) {
      for (const cc of enrichment.conditionalChoices) {
        choices.push({
          id: cc.id,
          text: cc.text,
          approach: cc.approach as EncounterApproach,
          primarySkill: cc.primarySkill,
          conditions: cc.conditions as any,
          showWhenLocked: cc.showWhenLocked,
          lockedText: cc.lockedText,
          outcomes: {
            success: { tier: 'success', narrativeText: cc.outcomes.success.narrativeText, goalTicks: cc.outcomes.success.goalTicks, threatTicks: cc.outcomes.success.threatTicks },
            complicated: { tier: 'complicated', narrativeText: cc.outcomes.complicated.narrativeText, goalTicks: cc.outcomes.complicated.goalTicks, threatTicks: cc.outcomes.complicated.threatTicks },
            failure: { tier: 'failure', narrativeText: cc.outcomes.failure.narrativeText, goalTicks: cc.outcomes.failure.goalTicks, threatTicks: cc.outcomes.failure.threatTicks },
          },
        } as EncounterChoice);
      }
    }
  }

  private buildDefaultStorylets(input: EncounterArchitectInput): Phase4Result {
    return {
      victory: {
        id: `${input.sceneId}-sv`,
        name: 'Victory',
        triggerOutcome: 'victory',
        tone: 'triumphant',
        narrativeFunction: 'Celebrate the achievement',
        beats: [{ id: `${input.sceneId}-sv-1`, text: `{{player.name}} overcame the challenge. The victory is earned.`, isTerminal: true }],
        startingBeatId: `${input.sceneId}-sv-1`,
        consequences: [],
        nextSceneId: input.victoryNextSceneId,
      } as GeneratedStorylet,
      defeat: {
        id: `${input.sceneId}-sd`,
        name: 'Defeat',
        triggerOutcome: 'defeat',
        tone: 'somber',
        narrativeFunction: 'Process the failure',
        beats: [{ id: `${input.sceneId}-sd-1`, text: `It wasn't enough. {{player.name}} must find another way.`, isTerminal: true }],
        startingBeatId: `${input.sceneId}-sd-1`,
        consequences: [],
        nextSceneId: input.defeatNextSceneId,
      } as GeneratedStorylet,
      escape: {
        id: `${input.sceneId}-se`,
        name: 'Escape',
        triggerOutcome: 'escape',
        tone: 'relieved',
        narrativeFunction: 'Narrow escape and taking stock',
        beats: [{ id: `${input.sceneId}-se-1`, text: `{{player.name}} got away, but the challenge remains.`, isTerminal: true }],
        startingBeatId: `${input.sceneId}-se-1`,
        consequences: [],
        nextSceneId: input.victoryNextSceneId,
      } as GeneratedStorylet,
    };
  }
}
