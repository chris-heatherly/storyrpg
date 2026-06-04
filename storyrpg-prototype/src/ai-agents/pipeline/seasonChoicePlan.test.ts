import { describe, expect, it } from 'vitest';
import {
  assignSeasonChoiceTypes,
  buildSeasonChoicePlan,
  episodeTypeCounts,
  momentsForEpisode,
  seasonChoicePlanFromMoments,
  seasonChoicePlanFromSeasonPlan,
  spineEntriesFromChoicePlan,
  type SeasonChoiceMoment,
} from './seasonChoicePlan';

const moment = (id: string, episode: number, payoff: SeasonChoiceMoment['payoff'], flag?: string): SeasonChoiceMoment => ({
  id, episode, anchor: `decision ${id}`, payoff, flag,
});

describe('assignSeasonChoiceTypes', () => {
  it('allocates the budget across the WHOLE season, not per-episode', () => {
    // 8 moments across 4 episodes; 35/30/20/15 over 8 → expr 3, rel 2, strat 2, dilemma 1.
    const moments = [
      moment('m1', 1, 'immediate'), moment('m2', 1, 'immediate'),
      moment('m3', 2, 'immediate'), moment('m4', 2, 'immediate'),
      moment('m5', 3, 'immediate'), moment('m6', 3, 'immediate'),
      moment('m7', 4, 'immediate'), moment('m8', 4, 'immediate'),
    ];
    const plan = assignSeasonChoiceTypes(moments);
    const counts = plan.moments.reduce((a, m) => { a[m.choiceType!] = (a[m.choiceType!] ?? 0) + 1; return a; }, {} as Record<string, number>);
    expect(plan.moments.every((m) => !!m.choiceType)).toBe(true);
    // all four types represented across the season
    expect(Object.keys(counts).sort()).toEqual(['dilemma', 'expression', 'relationship', 'strategic']);
    // a single episode (m1/m2) can legitimately be lopsided — that's the point
    expect(plan.counts).toEqual(counts);
  });

  it('gives later-payoff (consequential) moments the non-expression slots first', () => {
    const moments = [
      moment('a', 1, 'immediate'),
      moment('b', 1, { payoffEpisode: 3 }, 'b_flag'), // consequential
    ];
    const plan = assignSeasonChoiceTypes(moments);
    const b = plan.moments.find((m) => m.id === 'b')!;
    expect(b.choiceType).not.toBe('expression');
  });

  it('handles an empty moment list', () => {
    expect(assignSeasonChoiceTypes([]).moments).toEqual([]);
  });

  it('spreads types ACROSS episodes — no episode is single-type when the season is mixed (regression guard)', () => {
    // 10 episodes, 4 moments each (the season-plan shape that block-allocated before).
    const moments = [];
    for (let ep = 1; ep <= 10; ep++) {
      for (let k = 0; k < 4; k++) moments.push(moment(`e${ep}-${k}`, ep, 'immediate'));
    }
    const plan = assignSeasonChoiceTypes(moments);
    // Each episode's 4 moments must NOT all be the same type (the old block-monotonic bug).
    for (let ep = 1; ep <= 10; ep++) {
      const types = new Set(momentsForEpisode(plan, ep).map((m) => m.choiceType));
      expect(types.size).toBeGreaterThan(1);
    }
    // And every episode should include the dominant 'expression' type at least once.
    for (let ep = 1; ep <= 10; ep++) {
      expect(momentsForEpisode(plan, ep).some((m) => m.choiceType === 'expression')).toBe(true);
    }
    // Season totals still hit the budget.
    expect(plan.counts).toEqual({ expression: 14, relationship: 12, strategic: 8, dilemma: 6 });
  });
});

describe('momentsForEpisode', () => {
  it('filters to one episode', () => {
    const plan = assignSeasonChoiceTypes([moment('a', 1, 'immediate'), moment('b', 2, 'immediate')]);
    expect(momentsForEpisode(plan, 2).map((m) => m.id)).toEqual(['b']);
  });
});

describe('buildSeasonChoicePlan', () => {
  it('fills per-episode immediate moments + cross-episode later-payoff moments, typed season-wide', () => {
    const plan = buildSeasonChoicePlan({
      episodes: [1, 2, 3, 4],
      choicesPerEpisode: 2,
      crossEpisode: [{ flag: 'spared_envoy', setupEpisode: 1, payoffEpisode: 4 }],
    });
    // ep1 has the cross-episode moment + 1 filler = 2; eps 2-4 have 2 each → 8 total.
    expect(plan.moments).toHaveLength(8);
    expect(momentsForEpisode(plan, 1)).toHaveLength(2);
    expect(plan.moments.every((m) => !!m.choiceType)).toBe(true);
    // The cross-episode moment is a promise and never expression.
    const cross = plan.moments.find((m) => m.flag === 'spared_envoy')!;
    expect(cross.choiceType).not.toBe('expression');
    // It seeds a SpinePlantMap entry.
    expect(spineEntriesFromChoicePlan(plan)).toEqual([
      { flag: 'spared_envoy', payoffEpisode: 4, payoffEpisodeLatest: undefined },
    ]);
  });

  it('a single-episode season just allocates that episode (Endsong case)', () => {
    const plan = buildSeasonChoicePlan({ episodes: [1], choicesPerEpisode: 5 });
    expect(momentsForEpisode(plan, 1)).toHaveLength(5);
    const counts = episodeTypeCounts(plan, 1);
    expect(counts.expression + counts.relationship + counts.strategic + counts.dilemma).toBe(5);
  });
});

describe('episodeTypeCounts', () => {
  it('reports the per-type counts the plan assigned to an episode', () => {
    const plan = buildSeasonChoicePlan({ episodes: [1, 2], choicesPerEpisode: 4 });
    const c1 = episodeTypeCounts(plan, 1);
    const total = c1.expression + c1.relationship + c1.strategic + c1.dilemma;
    expect(total).toBe(4);
  });

  it('returns all-zero for an episode with no moments', () => {
    const plan = buildSeasonChoicePlan({ episodes: [1], choicesPerEpisode: 2 });
    expect(episodeTypeCounts(plan, 99)).toEqual({ expression: 0, relationship: 0, strategic: 0, dilemma: 0 });
  });
});

describe('seasonChoicePlanFromMoments (E1 slice 4)', () => {
  it('maps a later-payoff seed to a promise moment and types it season-wide', () => {
    const plan = seasonChoicePlanFromMoments([
      { id: 'a', episode: 1, anchor: 'Confront or hold', paysOffEpisode: 1 }, // same ep → immediate
      { id: 'b', episode: 1, anchor: 'Spare the envoy', paysOffEpisode: 4, flag: 'spared_envoy' },
      { id: 'c', episode: 2, anchor: 'Trust the plan' },
    ]);
    expect(plan.moments).toHaveLength(3);
    expect(plan.moments.every((m) => !!m.choiceType)).toBe(true);
    const b = plan.moments.find((m) => m.id === 'b')!;
    expect(b.payoff).toEqual({ payoffEpisode: 4 });
    expect(b.choiceType).not.toBe('expression');
    // It seeds a SpinePlantMap entry.
    expect(spineEntriesFromChoicePlan(plan)).toEqual([{ flag: 'spared_envoy', payoffEpisode: 4, payoffEpisodeLatest: undefined }]);
  });
});

describe('seasonChoicePlanFromSeasonPlan — prefers LLM moments (E1 slice 4)', () => {
  it('uses choiceMoments when present, not the deterministic derivation', () => {
    const plan = seasonChoicePlanFromSeasonPlan(
      {
        episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }],
        preferences: { targetChoicesPerEpisode: 5 },
        choiceMoments: [
          { id: 'm1', episode: 1, anchor: 'A' },
          { id: 'm2', episode: 2, anchor: 'B', paysOffEpisode: 2 },
        ],
      },
      { episode: 1, choicesPerEpisode: 2 },
    );
    // Exactly the 2 LLM moments — not 10 (5/ep × 2) from the deterministic path.
    expect(plan.moments.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('falls back to the deterministic derivation when no choiceMoments', () => {
    const plan = seasonChoicePlanFromSeasonPlan(
      { episodes: [{ episodeNumber: 1 }], preferences: { targetChoicesPerEpisode: 4 } },
      { episode: 1, choicesPerEpisode: 2 },
    );
    expect(momentsForEpisode(plan, 1)).toHaveLength(4);
  });
});

describe('spineEntriesFromChoicePlan', () => {
  it('emits SpinePlantMap entries only for later-payoff moments with a flag', () => {
    const plan = assignSeasonChoiceTypes([
      moment('a', 1, 'immediate', 'a_flag'),                 // immediate → skipped
      moment('b', 1, { payoffEpisode: 3 }, 'b_flag'),        // later + flag → entry
      moment('c', 1, { payoffEpisode: 4 }),                  // later, no flag → skipped
    ]);
    expect(spineEntriesFromChoicePlan(plan)).toEqual([{ flag: 'b_flag', payoffEpisode: 3, payoffEpisodeLatest: undefined }]);
  });
});
