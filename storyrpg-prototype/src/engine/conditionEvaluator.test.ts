import { describe, it, expect } from 'vitest';
import { evaluateCondition } from './conditionEvaluator';
import type { PlayerState, ConditionExpression } from '../types';

function createPlayer(overrides?: Partial<PlayerState>): PlayerState {
  return {
    characterName: 'Test',
    characterPronouns: 'they/them',
    attributes: {
      charm: 50,
      wit: 60,
      courage: 40,
      empathy: 70,
      resolve: 30,
      resourcefulness: 55,
    },
    skills: { persuasion: 20, athletics: 45 },
    relationships: {
      mara: { npcId: 'mara', trust: 30, affection: 10, respect: 50, fear: 5 },
    },
    flags: { quest_started: true, secret_found: false },
    scores: { honor: 75, chaos: 20 },
    tags: new Set(['noble', 'marked']),
    identityProfile: {
      mercy_justice: 15,
      idealism_pragmatism: -20,
      cautious_bold: 0,
      loner_leader: 10,
      heart_head: -5,
      honest_deceptive: 30,
    },
    pendingConsequences: [],
    inventory: [
      { itemId: 'sword', name: 'Sword', description: 'A blade.', quantity: 1 },
      { itemId: 'potion', name: 'Potion', description: 'A vial.', quantity: 3 },
    ],
    currentStoryId: null,
    currentEpisodeId: null,
    currentSceneId: null,
    completedEpisodes: [],
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// null / undefined / empty
// -----------------------------------------------------------------------

describe('evaluateCondition — null and undefined', () => {
  it('returns true for null condition', () => {
    expect(evaluateCondition(null as any, createPlayer())).toBe(true);
  });

  it('returns true for undefined condition', () => {
    expect(evaluateCondition(undefined as any, createPlayer())).toBe(true);
  });
});

// -----------------------------------------------------------------------
// string conditions (bare flag name)
// -----------------------------------------------------------------------

describe('evaluateCondition — string condition', () => {
  it('returns true when flag is set', () => {
    expect(evaluateCondition('quest_started' as any, createPlayer())).toBe(true);
  });

  it('returns false when flag is not set', () => {
    expect(evaluateCondition('nonexistent_flag' as any, createPlayer())).toBe(false);
  });

  it('returns false when flag is explicitly false', () => {
    expect(evaluateCondition('secret_found' as any, createPlayer())).toBe(false);
  });
});

// -----------------------------------------------------------------------
// flag conditions
// -----------------------------------------------------------------------

describe('evaluateCondition — flag type', () => {
  it('matches explicit flag with value=true', () => {
    const cond: ConditionExpression = { type: 'flag', flag: 'quest_started', value: true };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('matches explicit flag with value=false', () => {
    const cond: ConditionExpression = { type: 'flag', flag: 'secret_found', value: false };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('returns false when flag state does not match expected value', () => {
    const cond: ConditionExpression = { type: 'flag', flag: 'quest_started', value: false };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });

  it('infers flag type from lazy { flag_name: true } format', () => {
    const cond = { quest_started: true } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('infers flag type from { flag, value } without explicit type', () => {
    const cond = { flag: 'quest_started', value: true } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });
});

// -----------------------------------------------------------------------
// attribute conditions (all 6 operators)
// -----------------------------------------------------------------------

describe('evaluateCondition — attribute type', () => {
  const player = createPlayer(); // charm=50, wit=60, courage=40

  it('== operator', () => {
    expect(evaluateCondition({ type: 'attribute', attribute: 'charm', operator: '==', value: 50 }, player)).toBe(true);
    expect(evaluateCondition({ type: 'attribute', attribute: 'charm', operator: '==', value: 51 }, player)).toBe(false);
  });

  it('!= operator', () => {
    expect(evaluateCondition({ type: 'attribute', attribute: 'charm', operator: '!=', value: 40 }, player)).toBe(true);
    expect(evaluateCondition({ type: 'attribute', attribute: 'charm', operator: '!=', value: 50 }, player)).toBe(false);
  });

  it('> operator', () => {
    expect(evaluateCondition({ type: 'attribute', attribute: 'wit', operator: '>', value: 50 }, player)).toBe(true);
    expect(evaluateCondition({ type: 'attribute', attribute: 'wit', operator: '>', value: 60 }, player)).toBe(false);
  });

  it('< operator', () => {
    expect(evaluateCondition({ type: 'attribute', attribute: 'courage', operator: '<', value: 50 }, player)).toBe(true);
    expect(evaluateCondition({ type: 'attribute', attribute: 'courage', operator: '<', value: 40 }, player)).toBe(false);
  });

  it('>= operator', () => {
    expect(evaluateCondition({ type: 'attribute', attribute: 'charm', operator: '>=', value: 50 }, player)).toBe(true);
    expect(evaluateCondition({ type: 'attribute', attribute: 'charm', operator: '>=', value: 51 }, player)).toBe(false);
  });

  it('<= operator', () => {
    expect(evaluateCondition({ type: 'attribute', attribute: 'charm', operator: '<=', value: 50 }, player)).toBe(true);
    expect(evaluateCondition({ type: 'attribute', attribute: 'charm', operator: '<=', value: 49 }, player)).toBe(false);
  });

  it('infers attribute type from { attribute, operator } without explicit type', () => {
    const cond = { attribute: 'wit', operator: '>=', value: 55 } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });
});

// -----------------------------------------------------------------------
// skill conditions
// -----------------------------------------------------------------------

describe('evaluateCondition — skill type', () => {
  it('evaluates trained skill', () => {
    const cond: ConditionExpression = { type: 'skill', skill: 'persuasion', operator: '>=', value: 20 };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('missing skill defaults to 0', () => {
    const cond: ConditionExpression = { type: 'skill', skill: 'hacking', operator: '>', value: 0 };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });

  it('infers skill type from { skill, operator } without explicit type', () => {
    const cond = { skill: 'athletics', operator: '>=', value: 40 } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });
});

// -----------------------------------------------------------------------
// relationship conditions
// -----------------------------------------------------------------------

describe('evaluateCondition — relationship type', () => {
  it('evaluates present NPC relationship dimension', () => {
    const cond: ConditionExpression = {
      type: 'relationship', npcId: 'mara', dimension: 'trust', operator: '>=', value: 25,
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('returns false for missing NPC', () => {
    const cond: ConditionExpression = {
      type: 'relationship', npcId: 'unknown_npc', dimension: 'trust', operator: '>=', value: 0,
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });

  it('infers relationship type from { npcId, dimension } without explicit type', () => {
    const cond = { npcId: 'mara', dimension: 'respect', operator: '>=', value: 50 } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });
});

// -----------------------------------------------------------------------
// score conditions
// -----------------------------------------------------------------------

describe('evaluateCondition — score type', () => {
  it('evaluates present score', () => {
    const cond: ConditionExpression = { type: 'score', score: 'honor', operator: '>', value: 50 };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('missing score defaults to 0', () => {
    const cond: ConditionExpression = { type: 'score', score: 'stealth_score', operator: '>', value: 0 };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });

  it('infers score type from { score, operator } without explicit type', () => {
    const cond = { score: 'chaos', operator: '<=', value: 30 } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });
});

// -----------------------------------------------------------------------
// tag conditions
// -----------------------------------------------------------------------

describe('evaluateCondition — tag type', () => {
  it('hasTag true for present tag', () => {
    const cond: ConditionExpression = { type: 'tag', tag: 'noble', hasTag: true };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('hasTag false for absent tag', () => {
    const cond: ConditionExpression = { type: 'tag', tag: 'cursed', hasTag: false };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('returns false when tag presence mismatches', () => {
    const cond: ConditionExpression = { type: 'tag', tag: 'noble', hasTag: false };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });
});

// -----------------------------------------------------------------------
// item conditions
// -----------------------------------------------------------------------

describe('evaluateCondition — item type', () => {
  it('hasItem true when item exists', () => {
    const cond: ConditionExpression = { type: 'item', itemId: 'sword', hasItem: true };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('hasItem false when item is absent', () => {
    const cond: ConditionExpression = { type: 'item', itemId: 'shield', hasItem: false };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('minQuantity check passes when enough', () => {
    const cond: ConditionExpression = { type: 'item', itemId: 'potion', hasItem: true, minQuantity: 2 };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('minQuantity check fails when not enough', () => {
    const cond: ConditionExpression = { type: 'item', itemId: 'potion', hasItem: true, minQuantity: 5 };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });
});

// -----------------------------------------------------------------------
// identity conditions
// -----------------------------------------------------------------------

describe('evaluateCondition — identity type', () => {
  it('evaluates identity dimension', () => {
    const cond: ConditionExpression = {
      type: 'identity', dimension: 'mercy_justice', operator: '>=', value: 10,
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('returns false when identity dimension does not meet threshold', () => {
    const cond: ConditionExpression = {
      type: 'identity', dimension: 'mercy_justice', operator: '>=', value: 50,
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });

  it('handles missing identity profile gracefully', () => {
    const player = createPlayer({ identityProfile: undefined as any });
    const cond: ConditionExpression = {
      type: 'identity', dimension: 'cautious_bold', operator: '==', value: 0,
    };
    expect(evaluateCondition(cond, player)).toBe(true);
  });
});

// -----------------------------------------------------------------------
// compound conditions
// -----------------------------------------------------------------------

describe('evaluateCondition — compound conditions', () => {
  it('AND: all must pass', () => {
    const cond: ConditionExpression = {
      type: 'and',
      conditions: [
        { type: 'flag', flag: 'quest_started', value: true },
        { type: 'attribute', attribute: 'charm', operator: '>=', value: 40 },
      ],
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('AND: fails if any sub-condition fails', () => {
    const cond: ConditionExpression = {
      type: 'and',
      conditions: [
        { type: 'flag', flag: 'quest_started', value: true },
        { type: 'attribute', attribute: 'charm', operator: '>=', value: 99 },
      ],
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });

  it('OR: passes if any sub-condition passes', () => {
    const cond: ConditionExpression = {
      type: 'or',
      conditions: [
        { type: 'flag', flag: 'nonexistent', value: true },
        { type: 'attribute', attribute: 'wit', operator: '>=', value: 60 },
      ],
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('OR: fails if all sub-conditions fail', () => {
    const cond: ConditionExpression = {
      type: 'or',
      conditions: [
        { type: 'flag', flag: 'nonexistent', value: true },
        { type: 'attribute', attribute: 'charm', operator: '>=', value: 99 },
      ],
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });

  it('NOT: inverts inner condition', () => {
    const cond: ConditionExpression = {
      type: 'not',
      condition: { type: 'flag', flag: 'secret_found', value: true },
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('nested compound: AND containing OR', () => {
    const cond: ConditionExpression = {
      type: 'and',
      conditions: [
        {
          type: 'or',
          conditions: [
            { type: 'attribute', attribute: 'charm', operator: '>=', value: 80 },
            { type: 'attribute', attribute: 'wit', operator: '>=', value: 55 },
          ],
        },
        { type: 'flag', flag: 'quest_started', value: true },
      ],
    };
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });
});

// -----------------------------------------------------------------------
// type inference
// -----------------------------------------------------------------------

describe('evaluateCondition — type inference', () => {
  it('infers "and" from { conditions: [...] }', () => {
    const cond = {
      conditions: [
        { type: 'flag', flag: 'quest_started', value: true },
        { type: 'flag', flag: 'quest_started', value: true },
      ],
    } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('infers "not" from { condition: ... }', () => {
    const cond = {
      condition: { type: 'flag', flag: 'secret_found', value: true },
    } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('infers "item" from { itemId: ... }', () => {
    const cond = { itemId: 'sword' } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });

  it('infers "identity" from { dimension, operator } without npcId', () => {
    const cond = { dimension: 'honest_deceptive', operator: '>=', value: 20 } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });
});

// -----------------------------------------------------------------------
// unknown / unrecognized
// -----------------------------------------------------------------------

describe('evaluateCondition — unknown type', () => {
  it('returns false for unrecognized condition type', () => {
    const cond = { type: 'magic_check', power: 50 } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(false);
  });

  it('returns true for un-inferable typeless object', () => {
    const cond = { foo: 'bar', baz: 42 } as any;
    expect(evaluateCondition(cond, createPlayer())).toBe(true);
  });
});
