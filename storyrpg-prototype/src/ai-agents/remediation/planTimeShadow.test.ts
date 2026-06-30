import { describe, it, expect } from 'vitest';
import { computePlanTimeShadow } from './planTimeShadow';

const GATES = [
  'GATE_CHOICE_DENSITY',
  'GATE_CONSEQUENCE_BUDGET',
  'GATE_PROP_INTRODUCTION',
  'GATE_CALLBACK_COVERAGE',
  'GATE_SETUP_PAYOFF',
];

describe('computePlanTimeShadow', () => {
  it('returns one result per plan-time gate', async () => {
    const out = await computePlanTimeShadow({ story: { episodes: [] }, totalEpisodes: 0 });
    expect(out.map((r) => r.gate).sort()).toEqual([...GATES].sort());
    for (const r of out) expect(typeof r.blockingCount).toBe('number');
  });

  it('does not throw on an empty / malformed story (degrades to 0s)', async () => {
    const out = await computePlanTimeShadow({ story: {}, totalEpisodes: 0 });
    expect(out.every((r) => r.blockingCount === 0)).toBe(true);
  });

  it('flags choice-density when an episode has no choice points at all', async () => {
    const story = {
      episodes: [
        { scenes: [{ id: 's1', name: 'S1', charactersInvolved: [], beats: [{ id: 'b1', text: 'A beat with no choices.' }] }] },
      ],
      npcs: [],
    };
    const out = await computePlanTimeShadow({ story, totalEpisodes: 1 });
    const density = out.find((r) => r.gate === 'GATE_CHOICE_DENSITY')!;
    expect(density.blockingCount).toBeGreaterThan(0);
  });

  it('flags prop-introduction for a reference to an entity not in the cast', async () => {
    const story = {
      episodes: [
        { scenes: [{ id: 's1', name: 'S1', charactersInvolved: ['char-ghost-nobody'], beats: [{ id: 'b1', text: 'x', choices: [{ id: 'c1', choiceType: 'expression', consequences: [] }] }] }] },
      ],
      npcs: [{ id: 'char-real', name: 'Real Person' }],
    };
    const out = await computePlanTimeShadow({ story, totalEpisodes: 1 });
    const prop = out.find((r) => r.gate === 'GATE_PROP_INTRODUCTION')!;
    expect(prop.blockingCount).toBeGreaterThan(0);
  });

  it('does not flag prop-introduction when references resolve to the cast', async () => {
    const story = {
      episodes: [
        { scenes: [{ id: 's1', name: 'S1', charactersInvolved: ['char-real'], beats: [{ id: 'b1', text: 'x', choices: [{ id: 'c1', choiceType: 'expression', consequences: [] }] }] }] },
      ],
      npcs: [{ id: 'char-real', name: 'Real Person' }],
    };
    const out = await computePlanTimeShadow({ story, totalEpisodes: 1 });
    expect(out.find((r) => r.gate === 'GATE_PROP_INTRODUCTION')!.blockingCount).toBe(0);
  });
});
