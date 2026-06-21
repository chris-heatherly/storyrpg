import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { ConsequenceTierPlanConformanceValidator } from './ConsequenceTierPlanConformanceValidator';

function story(scenes: Array<{ id: string; tiers: string[] }>): Story {
  return {
    id: 's',
    title: 't',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'E1',
      synopsis: '',
      coverImage: '',
      startingSceneId: scenes[0]?.id ?? '',
      scenes: scenes.map((scene) => ({
        id: scene.id,
        name: scene.id,
        startingBeatId: 'b1',
        beats: [{
          id: 'b1',
          text: 'x',
          choices: scene.tiers.map((tier, index) => ({
            id: `${scene.id}-c${index}`,
            text: 'choose',
            choiceType: 'strategic',
            consequenceTier: tier,
            consequences: [{ type: 'setFlag', flag: `${scene.id}_${index}`, value: true }],
          })),
        }],
      })),
    }],
  } as unknown as Story;
}

describe('ConsequenceTierPlanConformanceValidator', () => {
  it('flags a generated scene that undershoots its season-assigned consequence tier', () => {
    const result = new ConsequenceTierPlanConformanceValidator().validate({
      story: story([{ id: 's1-1', tiers: ['callback', 'sceneTint'] }]),
      plannedTiersByScene: { 's1-1': 'branchlet' },
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain('assigned consequence tier "branchlet"');
    expect(result.issues[0].message).toContain('generated only "tint"');
  });

  it('passes when the generated scene realizes at least its assigned tier', () => {
    const result = new ConsequenceTierPlanConformanceValidator().validate({
      story: story([{ id: 's1-1', tiers: ['branchlet'] }]),
      plannedTiersByScene: { 's1-1': 'tint' },
    });

    expect(result.issues).toHaveLength(0);
  });

  it('does not score a generated episode against the whole-season budget mix', () => {
    const result = new ConsequenceTierPlanConformanceValidator().validate({
      story: story([{ id: 's1-1', tiers: ['callback', 'callback', 'callback'] }]),
      plannedTiersByScene: { 's1-1': 'callback' },
    });

    expect(result.issues).toHaveLength(0);
  });
});
