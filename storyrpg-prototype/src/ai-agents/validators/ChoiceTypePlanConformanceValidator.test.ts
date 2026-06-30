import { describe, it, expect } from 'vitest';
import { ChoiceTypePlanConformanceValidator } from './ChoiceTypePlanConformanceValidator';
import type { SeasonChoicePlan } from '../pipeline/seasonChoicePlan';
import type { Story } from '../../types';

function plan(moments: Array<{ episode: number; choiceType: string }>): SeasonChoicePlan {
  return {
    counts: { expression: 0, relationship: 0, strategic: 0, dilemma: 0 },
    moments: moments.map((m, i) => ({
      id: `m${i}`, episode: m.episode, anchor: 'x', payoff: 'immediate', choiceType: m.choiceType as never,
    })),
  };
}

function story(episodes: Array<{ number: number; scenes: Array<{ id: string; choiceTypes: string[] }> }>): Story {
  return {
    id: 's', title: 't', genre: 'fantasy', synopsis: '', coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: episodes.map((e) => ({
      id: `ep-${e.number}`, number: e.number, title: `E${e.number}`, synopsis: '', coverImage: '',
      startingSceneId: e.scenes[0]?.id ?? '',
      scenes: e.scenes.map((sc) => ({
        id: sc.id, name: sc.id, startingBeatId: 'b1',
        beats: [{ id: 'b1', text: 'x', choices: sc.choiceTypes.map((t, i) => ({ id: `${sc.id}-c${i}`, text: 'c', choiceType: t })) }],
      })),
    })),
  } as unknown as Story;
}

const run = (p: SeasonChoicePlan, s: Story, plannedTypesByScene?: Record<string, string>) =>
  new ChoiceTypePlanConformanceValidator().validate({ seasonPlan: p, story: s, plannedTypesByScene });

describe('ChoiceTypePlanConformanceValidator', () => {
  it('Check B: flags a type the season plan budgeted for the episode but the episode lacks', () => {
    // ep1 plan budgets a strategic; generated ep1 has none → flagged.
    const p = plan([
      { episode: 1, choiceType: 'relationship' },
      { episode: 1, choiceType: 'expression' },
      { episode: 1, choiceType: 'strategic' },
    ]);
    const s = story([{ number: 1, scenes: [
      { id: 's1-1', choiceTypes: ['relationship'] },
      { id: 's1-2', choiceTypes: ['expression'] },
    ] }]);
    const res = run(p, s);
    expect(res.issues.some((i) => /budgeted at least one "strategic"/.test(i.message))).toBe(true);
  });

  it('Check B: passes when every budgeted type is realized', () => {
    const p = plan([
      { episode: 1, choiceType: 'relationship' },
      { episode: 1, choiceType: 'strategic' },
    ]);
    const s = story([{ number: 1, scenes: [
      { id: 's1-1', choiceTypes: ['relationship'] },
      { id: 's1-2', choiceTypes: ['strategic'] },
    ] }]);
    expect(run(p, s).issues).toHaveLength(0);
  });

  it('does NOT false-fail a partial-season generation (strategic parked in later, ungenerated episodes)', () => {
    // 10-ep plan with strategic mostly in eps 4-10; only eps 1-3 generated and none of
    // them budget a strategic → must be clean (this is the Endsong case).
    const p = plan([
      { episode: 1, choiceType: 'relationship' }, { episode: 1, choiceType: 'expression' }, { episode: 1, choiceType: 'dilemma' },
      { episode: 2, choiceType: 'expression' }, { episode: 2, choiceType: 'relationship' },
      { episode: 3, choiceType: 'relationship' }, { episode: 3, choiceType: 'dilemma' },
      { episode: 4, choiceType: 'strategic' }, { episode: 5, choiceType: 'strategic' }, { episode: 7, choiceType: 'strategic' },
    ]);
    const s = story([
      { number: 1, scenes: [{ id: 's1-1', choiceTypes: ['relationship'] }, { id: 's1-2', choiceTypes: ['expression'] }, { id: 's1-3', choiceTypes: ['dilemma'] }] },
      { number: 2, scenes: [{ id: 's2-1', choiceTypes: ['expression'] }, { id: 's2-2', choiceTypes: ['relationship'] }] },
      { number: 3, scenes: [{ id: 's3-1', choiceTypes: ['relationship'] }, { id: 's3-2', choiceTypes: ['dilemma'] }] },
    ]);
    expect(run(p, s).issues).toHaveLength(0);
  });

  it('Check A: flags binding drift when a scene ships a different type than planned', () => {
    const p = plan([{ episode: 1, choiceType: 'strategic' }, { episode: 1, choiceType: 'relationship' }]);
    const s = story([{ number: 1, scenes: [
      { id: 's1-1', choiceTypes: ['strategic'] },
      { id: 's1-2', choiceTypes: ['expression'] }, // planned relationship, shipped expression
    ] }]);
    const res = run(p, s, { 's1-1': 'strategic', 's1-2': 'relationship' });
    expect(res.issues.some((i) => /binding drifted/.test(i.message))).toBe(true);
  });
});
