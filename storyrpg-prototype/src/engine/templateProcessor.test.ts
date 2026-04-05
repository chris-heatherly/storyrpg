import { describe, expect, it } from 'vitest';
import { processTemplate } from './templateProcessor';
import type { PlayerState, Story } from '../types';

function createPlayer(trust: number): PlayerState {
  return {
    characterName: 'Player',
    characterPronouns: 'they/them',
    attributes: {
      charm: 50,
      wit: 50,
      courage: 50,
      empathy: 50,
      resolve: 50,
      resourcefulness: 50,
    },
    skills: {},
    relationships: {
      mara: {
        npcId: 'mara',
        trust,
        affection: 0,
        respect: 0,
        fear: 0,
      },
    },
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

const story: Story = {
  id: 'story-1',
  title: 'Story',
  synopsis: 'Test',
  genre: 'Drama',
  tone: 'Tense',
  protagonist: {
    id: 'pc',
    name: 'Player',
    description: 'Hero',
    pronouns: 'they/them',
  },
  npcs: [{ id: 'mara', name: 'Mara', role: 'ally', description: 'Ally', pronouns: 'she/her' as const }],
  episodes: [],
} as any;

describe('templateProcessor relationship cache invalidation', () => {
  it('recomputes npc relationship tokens when relationship values change', () => {
    const text = 'Mara trust: {{npc.mara.trust}}';

    expect(processTemplate(text, createPlayer(10), story)).toBe('Mara trust: 10');
    expect(processTemplate(text, createPlayer(45), story)).toBe('Mara trust: 45');
  });
});
