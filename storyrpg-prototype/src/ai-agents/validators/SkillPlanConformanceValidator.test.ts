import { describe, it, expect } from 'vitest';
import { SkillPlanConformanceValidator } from './SkillPlanConformanceValidator';
import type { SeasonSkillPlan } from '../pipeline/seasonSkillPlan';
import type { Story } from '../../types';

function story(episodes: Array<{ number: number; checks: Array<Record<string, number>> }>): Story {
  return {
    id: 's', title: 't', genre: 'fantasy', synopsis: '', coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: episodes.map((e) => ({
      id: `ep-${e.number}`, number: e.number, title: `E${e.number}`, synopsis: '', coverImage: '',
      startingSceneId: 's1',
      scenes: [{
        id: `s${e.number}-1`, name: 'S', startingBeatId: 'b1',
        beats: [{
          id: 'b1', text: 'x',
          choices: e.checks.map((sw, i) => ({ id: `c${i}`, text: 'c', choiceType: 'strategic', statCheck: { skillWeights: sw, difficulty: 50 } })),
        }],
      }],
    })),
  } as unknown as Story;
}

const plan: SeasonSkillPlan = {
  episodeSkills: {
    // ep1 favours intimidation/athletics/...; perception is NOT in its lead.
    1: ['intimidation', 'athletics', 'survival', 'deception', 'perception', 'persuasion', 'investigation', 'insight'],
    2: ['perception', 'investigation', 'insight', 'persuasion', 'intimidation', 'athletics', 'survival', 'deception'],
  },
};

const run = (s: Story) => new SkillPlanConformanceValidator().validate({ story: s, seasonSkillPlan: plan });

describe('SkillPlanConformanceValidator', () => {
  it('flags an episode that leans on a skill off its planned lead', () => {
    // ep1 plan leads with intimidation/athletics/survival/deception; episode piles onto
    // perception (off-plan) → flagged.
    const res = run(story([{ number: 1, checks: [{ perception: 1 }, { perception: 1 }, { athletics: 0.2 }] }]));
    expect(res.issues.some((i) => /leans on "perception"/.test(i.message))).toBe(true);
  });

  it('passes when the dominant skill is within the episode plan lead', () => {
    // ep2 plan leads with perception → perception dominance is on-plan, no flag.
    const res = run(story([{ number: 2, checks: [{ perception: 1 }, { perception: 1 }] }]));
    expect(res.issues).toHaveLength(0);
  });

  it('passes a balanced episode with no single dominant skill', () => {
    const res = run(story([{ number: 1, checks: [{ intimidation: 1 }, { athletics: 1 }, { survival: 1 }] }]));
    expect(res.issues).toHaveLength(0);
  });

  it('skips episodes with no stat checks and episodes absent from the plan', () => {
    expect(run(story([{ number: 1, checks: [] }])).issues).toHaveLength(0);
    expect(run(story([{ number: 9, checks: [{ perception: 1 }, { perception: 1 }] }])).issues).toHaveLength(0);
  });

  it('counts ENCOUNTER choice primarySkills (bite-me-g16 perception meta lived in encounters)', () => {
    // ep1 plan does NOT lead with perception; the dominance lives entirely in the encounter
    // choice tree (primarySkill), which the beats-only walk used to miss.
    const s = {
      id: 's', title: 't', genre: 'fantasy', synopsis: '', coverImage: '',
      initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
      npcs: [],
      episodes: [{
        id: 'ep-1', number: 1, title: 'E1', synopsis: '', coverImage: '', startingSceneId: 's1-1',
        scenes: [{
          id: 's1-enc', name: 'Enc', startingBeatId: 'b1', beats: [],
          encounter: {
            phases: [{ id: 'p1', beats: [{ id: 'eb1', choices: [
              { id: 'c1', primarySkill: 'perception' },
              { id: 'c2', primarySkill: 'perception' },
              { id: 'c3', primarySkill: 'perception' },
              { id: 'c4', primarySkill: 'athletics' },
            ] }] }],
            storylets: {},
          },
        }],
      }],
    } as unknown as Story;
    const res = run(s);
    expect(res.issues.some((i) => /leans on "perception"/.test(i.message))).toBe(true);
  });
});
