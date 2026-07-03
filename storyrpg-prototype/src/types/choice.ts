// ========================================
// CHOICE TYPES
// ========================================

import type { PlayerAttributes } from './player';
import type { ConditionExpression } from './conditions';
import type { Consequence } from './consequences';
import type { MechanicPressureContract } from './scenePlan';
import type { RelationshipValueEvidence } from './relationshipValue';

// Choice types describe the PLAYER EXPERIENCE, not the structural effect.
// Branching (routing to different scenes via nextSceneId) is a property of
// any choice, not a type. Expression choices must not branch; all others may.
export type ChoiceType =
  | 'expression'
  | 'relationship'
  | 'strategic'
  | 'dilemma';

export type ChoiceIntent =
  | 'flavor'
  | 'branching'
  | 'blind'
  | 'dilemma';

export type ChoiceImpactFactor =
  | 'outcome'
  | 'process'
  | 'information'
  | 'relationship'
  | 'identity';

export type ChoiceConsequenceTier =
  | 'callback'
  | 'sceneTint'
  | 'branchlet'
  | 'structuralBranch';

export interface StakesLayers {
  material?: string;
  relational?: string;
  identity?: string;
  existential?: string;
}

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

export interface MoralContract {
  valueA: string;
  valueB: string;
  unavoidableCost: string;
  benefits: string[];
  harms: string[];
  uncertainty: string;
}

export interface ChoiceResidueHint {
  kind:
    | 'immediate_prose_echo'
    | 'later_text_variant'
    | 'relationship_behavior'
    | 'encounter_advantage'
    | 'encounter_complication'
    | 'visual_staging'
    | 'recap_summary';
  description: string;
  targetEpisode?: number;
  targetNpcId?: string;
  callbackHookId?: string;
}

export type ChoiceAffordanceSource =
  | 'identity'
  | 'relationship'
  | 'tag'
  | 'item'
  | 'skill'
  | 'flag'
  | 'callback';

export type WitnessReactionStance =
  | 'approves'
  | 'disapproves'
  | 'fears'
  | 'admires'
  | 'questions'
  | 'remembers';

export interface WitnessReaction {
  npcId: string;
  stance: WitnessReactionStance;
  reactionText: string;
  residueHint?: string;
}

export type FailureResidueKind =
  | 'debt'
  | 'suspicion'
  | 'injury'
  | 'lost_leverage'
  | 'exposure'
  | 'obligation'
  | 'damaged_trust'
  | 'position_shift';

export interface FailureResidue {
  kind: FailureResidueKind;
  description: string;
}

export interface ChoiceRouteContext {
  sourceSceneId: string;
  sourceBeatId: string;
  sourceChoiceId: string;
  choiceSummary: string;
  originalTargetSceneId?: string;
  originalTargetBeatId?: string;
  transitionIntent?: string;
  bridgePurpose?: string;
}

export interface StatCheckModifier {
  id: string;
  condition: ConditionExpression;
  delta: number;
  reason: string;
  hint?: string;
}

/**
 * Fields shared by EVERY choice shape — scene choices and encounter choices
 * alike (encounter unification W2). The gate/display/feedback core: identity,
 * player-facing text, condition gating, locked display, and feedback cues.
 * The runtime's shared skeleton (getChoiceAvailability / processChoiceList in
 * storyEngine) operates on exactly this surface. Pure type-level dedup: the
 * serialized JSON shape of both choice families is unchanged.
 */
export interface ChoiceCore {
  id: string;
  text: string;

  conditions?: ConditionExpression;
  showWhenLocked?: boolean;
  lockedText?: string;

  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;
}

// A single choice option
export interface Choice extends ChoiceCore {
  choiceType?: ChoiceType;
  choiceIntent?: ChoiceIntent;
  impactFactors?: ChoiceImpactFactor[];
  consequenceTier?: ChoiceConsequenceTier;
  stakes?: {
    want: string;
    cost: string;
    identity: string;
  };
  stakesLayers?: StakesLayers;

  statCheck?: {
    skillWeights?: Record<string, number>;
    difficulty: number;
    modifiers?: StatCheckModifier[];

    // Legacy fields — converted to skillWeights at resolution time
    attribute?: keyof PlayerAttributes;
    skill?: string;
    retryableAfterChange?: boolean;
  };

  storyVerb?: string;
  affordanceSource?: ChoiceAffordanceSource;
  moralContract?: MoralContract;
  residueHints?: ChoiceResidueHint[];
  witnessReactions?: WitnessReaction[];
  failureResidue?: FailureResidue;
  visualResidueHint?: string;
  relationshipValueEvidence?: RelationshipValueEvidence[];
  mechanicPressure?: MechanicPressureContract[];
  /** Planned season residue obligations this choice creates or pays. */
  residueObligationIds?: string[];

  consequences?: Consequence[];

  delayedConsequences?: Array<{
    consequence: Consequence;
    description: string;
    delay?: { type: 'scenes' | 'episodes'; count: number };
    triggerCondition?: ConditionExpression;
  }>;

  routeContext?: ChoiceRouteContext;

  nextSceneId?: string;

  nextBeatId?: string;

  outcomeTexts?: {
    success: string;
    partial: string;
    failure: string;
  };

  reactionText?: string;

  tintFlag?: string;

  // Optional authored "memorable moment" — a hint to the callback ledger
  // that this choice is worth remembering across episodes. When present,
  // FullStoryPipeline seeds a CallbackHook in the ledger after the episode
  // is generated, so later episodes can author TextVariants that pay it off.
  memorableMoment?: {
    id: string;       // slug-style id, e.g. "spared-the-herald"
    summary: string;  // one-line prose recap, e.g. "You spared the royal herald."
    flags?: string[]; // optional flag names this hook keys on
  };
}
