import { describe, expect, it } from 'vitest';
import { RelationshipValueLadderValidator } from './RelationshipValueLadderValidator';
import type { RelationshipValueState } from '../../types';

const poisonedLove: RelationshipValueState = {
  npcId: 'mara',
  axis: 'love',
  rung: 'negationOfNegation',
  meaning: 'protective control',
  confidence: 'medium',
  evidenceTags: ['overrode_player_choice'],
  allowedSurfaces: ['aid_with_cost', 'protective_control'],
};

describe('RelationshipValueLadderValidator', () => {
  it('accepts a deterministic poisoned-love state', () => {
    const result = new RelationshipValueLadderValidator().validate({
      relationships: {
        mara: { npcId: 'mara', trust: 30, affection: 80, respect: 25, fear: 70 },
      },
      states: [poisonedLove],
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.rungMismatches).toBe(0);
  });

  it('warns when authored rung disagrees with deterministic classification', () => {
    const result = new RelationshipValueLadderValidator().validate({
      relationships: {
        mara: { npcId: 'mara', trust: 30, affection: 80, respect: 25, fear: 70 },
      },
      states: [{ ...poisonedLove, rung: 'positive' }],
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.rungMismatches).toBe(1);
  });

  it('errors on unknown intended relationship surfaces', () => {
    const result = new RelationshipValueLadderValidator().validate({
      relationships: {
        mara: { npcId: 'mara', trust: 30, affection: 80, respect: 25, fear: 70 },
      },
      choices: [{
        id: 'c1',
        text: 'Let Mara decide.',
        relationshipValueEvidence: [{
          npcId: 'mara',
          axis: 'love',
          evidenceTags: ['overrode_player_choice'],
          intendedSurface: 'not_a_surface' as any,
          reason: 'Invalid test surface.',
        }],
      }],
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.invalidSurfaces).toBe(1);
  });
});
