import { describe, expect, it } from 'vitest';
import {
  assignSeasonChoiceTypes,
  momentsForEpisode,
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
});

describe('momentsForEpisode', () => {
  it('filters to one episode', () => {
    const plan = assignSeasonChoiceTypes([moment('a', 1, 'immediate'), moment('b', 2, 'immediate')]);
    expect(momentsForEpisode(plan, 2).map((m) => m.id)).toEqual(['b']);
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
