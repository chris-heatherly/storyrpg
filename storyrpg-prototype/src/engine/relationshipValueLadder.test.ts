import { describe, expect, it } from 'vitest';
import {
  classifyRelationshipValueState,
  enforceRelationshipTransition,
  applyRelationshipEvidence,
} from './relationshipValueLadder';
import type { PlayerState } from '../types';

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    characterName: 'Player',
    characterPronouns: 'they/them',
    attributes: { charm: 50, wit: 50, courage: 50, empathy: 50, resolve: 50, resourcefulness: 50 },
    skills: {},
    relationships: {},
    relationshipValueStates: {},
    flags: {},
    scores: {},
    tags: new Set(),
    identityProfile: {
      mercy_justice: 0,
      idealism_pragmatism: 0,
      cautious_bold: 0,
      loner_leader: 0,
      heart_head: 0,
      honest_deceptive: 0,
    },
    pendingConsequences: [],
    inventory: [],
    currentStoryId: null,
    currentEpisodeId: null,
    currentSceneId: null,
    completedEpisodes: [],
    ...overrides,
  };
}

describe('relationshipValueLadder', () => {
  it('classifies healthy love from dimensions plus agency evidence', () => {
    const state = classifyRelationshipValueState({
      npcId: 'mara',
      axis: 'love',
      relationship: { trust: 72, affection: 80, respect: 65, fear: 10 },
      evidenceTags: ['respected_agency'],
    });

    expect(state.rung).toBe('positive');
    expect(state.meaning).toBe('care with agency');
    expect(state.allowedSurfaces).toContain('agency_respecting_protection');
  });

  it('classifies poisoned love only when control evidence is present', () => {
    const withoutEvidence = classifyRelationshipValueState({
      npcId: 'mara',
      axis: 'love',
      relationship: { trust: 30, affection: 80, respect: 28, fear: 70 },
    });
    const withEvidence = classifyRelationshipValueState({
      npcId: 'mara',
      axis: 'love',
      relationship: { trust: 30, affection: 80, respect: 28, fear: 70 },
      evidenceTags: ['overrode_player_choice'],
    });

    expect(withoutEvidence.rung).not.toBe('negationOfNegation');
    expect(withEvidence.rung).toBe('negationOfNegation');
    expect(withEvidence.allowedSurfaces).toContain('aid_with_cost');
  });

  it('blocks repairing poisoned love without repair evidence', () => {
    const previous = classifyRelationshipValueState({
      npcId: 'mara',
      axis: 'love',
      relationship: { trust: 25, affection: 78, respect: 22, fear: 65 },
      evidenceTags: ['protective_control'],
    });
    const proposed = classifyRelationshipValueState({
      npcId: 'mara',
      axis: 'love',
      relationship: { trust: 80, affection: 80, respect: 80, fear: 5 },
      previousState: previous,
      evidenceTags: ['respected_agency'],
    });

    const result = enforceRelationshipTransition(previous, proposed);
    expect(result.transitioned).toBe(false);
    expect(result.state.rung).toBe('negationOfNegation');
  });

  it('applies relationship evidence to player state', () => {
    const initial = player({
      relationships: {
        mara: { npcId: 'mara', trust: 30, affection: 80, respect: 28, fear: 70 },
      },
    });

    const next = applyRelationshipEvidence(initial, {
      type: 'relationshipEvidence',
      npcId: 'mara',
      axis: 'love',
      evidenceTags: ['aid_with_strings'],
      reason: 'Mara helps only if the player obeys.',
    });

    expect(next.relationshipValueStates?.['mara:love']?.rung).toBe('negationOfNegation');
  });
});
