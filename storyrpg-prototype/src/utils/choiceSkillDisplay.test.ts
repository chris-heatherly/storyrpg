import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../types';
import {
  getSkillIconName,
  getSkillKeyFromChoice,
  getSkillKeyFromStatCheck,
  resolveChoiceSkillDisplay,
  shouldShowChoiceSkillReadout,
} from './choiceSkillDisplay';

function createPlayer(): PlayerState {
  return {
    characterName: 'Player',
    characterPronouns: 'they/them',
    attributes: {
      charm: 50,
      wit: 50,
      courage: 80,
      empathy: 50,
      resolve: 60,
      resourcefulness: 40,
    },
    skills: {
      athletics: 75,
      shadowcraft: 15,
    },
    relationships: {},
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
  };
}

describe('choiceSkillDisplay', () => {
  it('resolves Bite Me Redux skill icons from raw skill keys', () => {
    expect(getSkillIconName('charm')).toBe('heart');
    expect(getSkillIconName('insight')).toBe('scan-eye');
    expect(getSkillIconName('investigation')).toBe('search');
  });

  it('computes the effective stat value used by encounter resolution', () => {
    const display = resolveChoiceSkillDisplay({
      skillKey: 'athletics',
      player: createPlayer(),
    });

    expect(display).toMatchObject({
      skillKey: 'athletics',
      skillLabel: 'Athletics',
      iconName: 'footprints',
      effectiveSkillValue: 66,
    });
    expect(display.skillBonusValue).toBeUndefined();
  });

  it('keeps conditional bonuses separate from the base effective stat', () => {
    const display = resolveChoiceSkillDisplay({
      skillKey: 'athletics',
      player: createPlayer(),
      bonus: 6,
    });

    expect(display.effectiveSkillValue).toBe(66);
    expect(display.skillBonusValue).toBe(6);
  });

  it('falls back to a neutral icon while still showing unknown skill values', () => {
    const display = resolveChoiceSkillDisplay({
      skillKey: 'shadowcraft',
      player: createPlayer(),
    });

    expect(display.iconName).toBe('activity');
    expect(display.skillLabel).toBe('Shadowcraft');
    expect(display.effectiveSkillValue).toBe(65);
  });

  it('infers regular choice display skills from authored consequences and copy', () => {
    expect(getSkillKeyFromChoice({
      text: 'Make this space yours and claim your future',
      consequences: [{ type: 'setFlag', flag: 'apartment_approach', value: 'claim_future' }],
    })).toBe('resolve');

    expect(getSkillKeyFromChoice({
      text: 'Accept the quartz with gratitude',
      consequences: [{ type: 'addTag', tag: 'accepts_mystical_help' }],
    })).toBe('intuition');

    expect(getSkillKeyFromChoice({
      text: 'Take the key card with genuine gratitude',
      consequences: [{ type: 'relationship', dimension: 'trust' }],
    })).toBe('empathy');
  });

  it('finds the display skill from weighted and legacy stat checks', () => {
    expect(getSkillKeyFromStatCheck({ skillWeights: { persuasion: 0.4, investigation: 0.6 } })).toBe('investigation');
    expect(getSkillKeyFromStatCheck({ skill: 'self control' })).toBe('self_control');
    expect(getSkillKeyFromStatCheck({ attribute: 'charm' })).toBe('persuasion');
  });

  it('hides the stat readout for locked choices', () => {
    expect(shouldShowChoiceSkillReadout({
      isLocked: true,
      primarySkillKey: 'charm',
      effectiveSkillValue: 50,
    })).toBe(false);

    expect(shouldShowChoiceSkillReadout({
      primarySkillKey: 'charm',
      effectiveSkillValue: 50,
    })).toBe(true);
  });
});
