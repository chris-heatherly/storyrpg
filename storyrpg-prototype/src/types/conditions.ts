// ========================================
// CONDITION TYPES
// ========================================

import type { PlayerAttributes, IdentityProfile } from './player';

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
