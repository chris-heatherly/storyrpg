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
}
