import { describe, expect, it } from 'vitest';
import {
  assignSeasonChoiceTypes,
  buildSeasonChoicePlan,
  episodeTypeCounts,
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
