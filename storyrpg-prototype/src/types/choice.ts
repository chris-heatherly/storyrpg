// ========================================
// CHOICE TYPES
// ========================================

import type { PlayerAttributes } from './player';
import type { ConditionExpression } from './conditions';
import type { Consequence } from './consequences';

// Choice types describe the PLAYER EXPERIENCE, not the structural effect.
// Branching (routing to different scenes via nextSceneId) is a property of
// any choice, not a type. Expression choices must not branch; all others may.
export type ChoiceType =
  | 'expression'
  | 'relationship'
  | 'strategic'
  | 'dilemma';

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

// A single choice option
export interface Choice {
  id: string;
  text: string;

  choiceType?: ChoiceType;

  conditions?: ConditionExpression;

  showWhenLocked?: boolean;
  lockedText?: string;

  statCheck?: {
    skillWeights?: Record<string, number>;
    difficulty: number;

    // Legacy fields — converted to skillWeights at resolution time
    attribute?: keyof PlayerAttributes;
    skill?: string;
    retryableAfterChange?: boolean;
  };

  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;
  moralContract?: MoralContract;
  residueHints?: ChoiceResidueHint[];
  visualResidueHint?: string;

  consequences?: Consequence[];

  delayedConsequences?: Array<{
    consequence: Consequence;
    description: string;
    delay?: { type: 'scenes' | 'episodes'; count: number };
    triggerCondition?: ConditionExpression;
  }>;

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
