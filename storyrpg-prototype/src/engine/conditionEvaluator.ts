import {
  ConditionExpression,
  Condition,
  PlayerState,
} from '../types';
import { deriveRelationshipValueState } from './relationshipValueLadder';

/**
 * Infer condition type from fields present (for LLM-generated conditions without explicit type)
 */
function inferConditionType(condition: Record<string, unknown>): string | null {
  if ('conditions' in condition && Array.isArray(condition.conditions)) {
    // Could be 'and' or 'or' - default to 'and' if not specified
    return 'and';
  }
  if ('condition' in condition) {
    return 'not';
  }
  if ('flag' in condition && 'value' in condition) {
    return 'flag';
  }
  if ('score' in condition && ('operator' in condition || 'value' in condition)) {
    return 'score';
  }
  if ('tag' in condition && 'hasTag' in condition) {
    return 'tag';
  }
  if ('attribute' in condition && 'operator' in condition) {
    return 'attribute';
  }
  if ('skill' in condition && 'operator' in condition) {
    return 'skill';
  }
  if ('npcId' in condition && 'dimension' in condition) {
    return 'relationship';
  }
  if ('npcId' in condition && 'axis' in condition && 'rung' in condition) {
    return 'relationshipRung';
  }
  if ('itemId' in condition) {
    return 'item';
  }
  if ('dimension' in condition && !('npcId' in condition) && 'operator' in condition) {
    return 'identity';
  }
  
  // Handle "lazy" flag check: { "flag_name": true/false }
  const keys = Object.keys(condition);
  if (keys.length === 1 && typeof condition[keys[0]] === 'boolean') {
    return 'flag';
  }

  // Check if it's just a flag name as a string (e.g., condition is "some_flag")
  if (typeof condition === 'string') {
    return 'flag';
  }
  return null;
}

/**
 * Evaluates a condition expression against the current player state.
 * Returns true if the condition is met.
 */
export function evaluateCondition(
  condition: ConditionExpression,
  player: PlayerState
): boolean {
  // Handle null/undefined conditions - treat as "always true" (no condition)
  if (!condition) {
    return true;
  }

  // Handle string conditions (just a flag name)
  if (typeof condition === 'string') {
    return player.flags[condition] === true;
  }

  // Handle conditions without a type - try to infer from fields
  let conditionType = condition.type;
  if (!conditionType) {
    const inferredType = inferConditionType(condition as unknown as Record<string, unknown>);
    if (inferredType) {
      console.log(`[ConditionEvaluator] Inferred type '${inferredType}' for condition:`, condition);
      conditionType = inferredType as ConditionExpression['type'];
      // Add the type to the condition object for the switch statement
      (condition as any).type = conditionType;
    } else {
      console.warn('Condition missing type and could not infer, treating as always true:', condition);
      return true;
    }
  }

  switch (condition.type) {
    // and/or tolerate a missing conditions array (generator has shipped bare
    // {type:'and'}): vacuous truth for and, vacuous false for or.
    case 'and':
      return (condition.conditions ?? []).every((c) => evaluateCondition(c, player));

    case 'or':
      return (condition.conditions ?? []).some((c) => evaluateCondition(c, player));

    case 'not':
      return !evaluateCondition(condition.condition, player);

    case 'attribute':
      // ?? 0 like skill/score: a save predating an attribute rename must not
      // compare undefined (undefined > 40 is false, undefined != x is true).
      return compareValues(
        player.attributes[condition.attribute] ?? 0,
        condition.operator,
        condition.value
      );

    case 'skill':
      return compareValues(
        player.skills[condition.skill] ?? 0,
        condition.operator,
        condition.value
      );

    case 'relationship':
      const rel = player.relationships[condition.npcId];
      if (!rel) return false;
      return compareValues(
        rel[condition.dimension],
        condition.operator,
        condition.value
      );

    case 'relationshipRung': {
      const state = deriveRelationshipValueState(player, condition.npcId, condition.axis);
      return state.rung === condition.rung;
    }

    case 'flag': {
      // Tolerant shape: the generator ships flag conditions with `value`
      // omitted (and sometimes the flag name as a bare key).
      const flagCondition = condition as unknown as { flag?: string; value?: boolean } & Record<string, unknown>;
      const flagName = flagCondition.flag || Object.keys(flagCondition).find(k => k !== 'type');
      // {type:'flag', flag:'x'} with value omitted means "x is set": the old
      // fallback read condition['x'] (undefined), making the comparison
      // `boolean === undefined` — permanently false, so choices gated this way
      // could never unlock (and not-wrapped ones were permanently true).
      const expectedValue = flagCondition.value !== undefined
        ? flagCondition.value
        : (flagCondition.flag !== undefined ? true : (flagCondition[flagName!] as boolean | undefined) ?? true);
      return (player.flags[flagName!] ?? false) === expectedValue;
    }

    case 'score':
      return compareValues(
        player.scores[condition.score] ?? 0,
        condition.operator,
        condition.value
      );

    case 'tag':
      return player.tags.has(condition.tag) === condition.hasTag;

    case 'item':
      const item = player.inventory.find((i) => i.itemId === condition.itemId);
      // Support both hasItem and has (backwards compatibility alias)
      const wantsItem = condition.hasItem ?? condition.has ?? true;
      if (wantsItem) {
        if (!item) return false;
        if (condition.minQuantity !== undefined) {
          return item.quantity >= condition.minQuantity;
        }
        return true;
      } else {
        return !item || item.quantity === 0;
      }

    case 'identity':
      const identityValue = (player.identityProfile ?? {})[condition.dimension] ?? 0;
      return compareValues(identityValue, condition.operator, condition.value);

    default:
      console.warn('Unknown condition type:', (condition as any).type);
      return false;
  }
}

function compareValues(
  actual: number,
  operator: string,
  expected: number
): boolean {
  switch (operator) {
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    default:
      console.warn('Unknown operator:', operator);
      return false;
  }
}
