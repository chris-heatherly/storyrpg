/**
 * State Change Converter
 * 
 * Converts simplified LLM output types to full types/index.ts types.
 * This is the boundary layer between LLM-generated content and the type system.
 */

import {
  Consequence,
} from '../../types';

import {
  StateChange,
  isStateChange,
} from '../types/llm-output';

// ========================================
// CORE CONVERTER: StateChange -> Consequence
// ========================================

/**
 * Convert a single StateChange to a Consequence.
 * Returns null if the StateChange is invalid or cannot be converted.
 */
export function convertStateChangeToConsequence(sc: StateChange): Consequence | null {
  // Try to normalize non-conforming LLM output before validation.
  // The LLM sometimes produces { type: 'attribute', attribute: X, change: N }
  // or { type: 'skill', skill: X, change: N } instead of the canonical format.
  const raw = sc as unknown as Record<string, unknown>;
  if (!isStateChange(sc)) {
    const normalized = tryNormalizeStateChange(raw);
    if (normalized) {
      return convertStateChangeToConsequence(normalized);
    }
    console.warn('[Converter] Invalid StateChange object:', sc);
    return null;
  }

  switch (sc.type) {
    case 'flag':
      return { 
        type: 'setFlag', 
        flag: sc.name, 
        value: Boolean(sc.change) 
      };

    case 'score':
      if (typeof sc.change === 'number') {
        return { 
          type: 'changeScore', 
          score: sc.name, 
          change: sc.change 
        };
      }
      // If change is a string or boolean, treat as setScore
      return { 
        type: 'setScore', 
        score: sc.name, 
        value: Number(sc.change) || 0 
      };

    case 'tag':
      return sc.change 
        ? { type: 'addTag', tag: sc.name } 
        : { type: 'removeTag', tag: sc.name };

    case 'relationship':
      // Relationship changes need npcId and dimension
      // Expected format: "npcId:dimension" e.g., "mayor:trust"
      const [npcId, dimension] = sc.name.includes(':') 
        ? sc.name.split(':') 
        : [sc.name, 'trust'];
      
      const validDimensions = ['trust', 'affection', 'respect', 'fear'] as const;
      const safeDimension = validDimensions.includes(dimension as typeof validDimensions[number])
        ? (dimension as 'trust' | 'affection' | 'respect' | 'fear')
        : 'trust';

      return {
        type: 'relationship',
        npcId,
        dimension: safeDimension,
        change: typeof sc.change === 'number' ? sc.change : Number(sc.change) || 0
      };

    default:
      console.warn(`[Converter] Unknown StateChange type: ${(sc as StateChange).type}`);
      return null;
  }
}

/**
 * Attempt to normalize non-conforming LLM output into a valid StateChange.
 * Handles common deviations:
 *   { type: 'attribute', attribute: 'courage', change: 2 }  -> { type: 'score', name: 'courage', change: 2 }
 *   { type: 'skill', skill: 'athletics', change: 3 }        -> { type: 'score', name: 'athletics', change: 3 }
 *   { type: 'relationship', npcId: 'X', dimension: 'trust', change: 5 } -> { type: 'relationship', name: 'X:trust', change: 5 }
 */
function tryNormalizeStateChange(raw: Record<string, unknown>): StateChange | null {
  if (!raw || typeof raw !== 'object' || !raw.type) return null;

  if (raw.type === 'attribute' && typeof raw.attribute === 'string') {
    return { type: 'score', name: raw.attribute, change: (raw.change as string | number | boolean) ?? 0 };
  }

  if (raw.type === 'skill' && typeof raw.skill === 'string') {
    return { type: 'score', name: raw.skill, change: (raw.change as string | number | boolean) ?? 0 };
  }

  if (raw.type === 'relationship' && typeof raw.npcId === 'string' && typeof raw.dimension === 'string') {
    return { type: 'relationship', name: `${raw.npcId}:${raw.dimension}`, change: (raw.change as string | number | boolean) ?? 0 };
  }

  // { type: 'score', score: 'X', ... } — missing `name` field but has `score`
  if (raw.type === 'score' && typeof raw.score === 'string' && !raw.name) {
    return { type: 'score', name: raw.score, change: (raw.change as string | number | boolean) ?? 0 };
  }

  // { type: 'flag', flag: 'X', value: true } — missing `name` field but has `flag`
  if (raw.type === 'flag' && typeof raw.flag === 'string' && !raw.name) {
    return { type: 'flag', name: raw.flag, change: raw.value != null ? raw.value as boolean : true };
  }

  return null;
}

/**
 * Convert an array of StateChanges to Consequences.
 * Filters out any invalid conversions.
 */
export function convertStateChangesToConsequences(
  stateChanges: StateChange[] | undefined
): Consequence[] {
  if (!stateChanges || !Array.isArray(stateChanges)) {
    return [];
  }
  
  return stateChanges
    .map(convertStateChangeToConsequence)
    .filter((c): c is Consequence => c !== null);
}

// Note: Storylet and EncounterChoiceOutcome converters are in encounterConverter.ts
// because they need the full EncounterArchitect types for proper conversion.

// ========================================
// UNSAFE CONVERTERS (for legacy code migration)
// ========================================

/**
 * Unsafe converter for arrays that might be StateChange[] or already Consequence[].
 * Uses runtime type checking to determine which conversion to apply.
 * 
 * USE SPARINGLY - prefer typed converters above.
 */
export function convertUnknownToConsequences(
  input: unknown[] | undefined
): Consequence[] {
  if (!input || !Array.isArray(input)) {
    return [];
  }

  // Check if first item looks like a StateChange
  if (input.length > 0 && isStateChange(input[0])) {
    return convertStateChangesToConsequences(input as StateChange[]);
  }

  // Assume already Consequence[] (might need validation in strict mode)
  return input as Consequence[];
}
