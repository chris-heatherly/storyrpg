// ========================================
// CONSEQUENCE TYPES
// ========================================

import type { PlayerAttributes, InventoryItem } from './player';
import type { ConditionExpression } from './conditions';

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
 */
export interface DelayedConsequence {
  id: string;
  consequence: Consequence;
  description: string;

  delay?: {
    type: 'scenes' | 'episodes';
    count: number;
  };

  triggerCondition?: ConditionExpression;

  sourceSceneId: string;
  sourceChoiceId: string;
  scenesElapsed: number;
  episodesElapsed: number;
  fired: boolean;
}
