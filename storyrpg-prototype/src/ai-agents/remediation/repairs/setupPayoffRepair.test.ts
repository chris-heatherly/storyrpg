import { describe, it, expect } from 'vitest';
import { repairSetupPayoff } from './setupPayoffRepair';
import type { NarrativeThread } from '../../../types';

function thread(over: Partial<NarrativeThread>): NarrativeThread {
  return {
    id: 't1',
    kind: 'mystery',
    priority: 'major',
    label: 'A thread',
    plants: [{ sceneId: 's1', beatId: 'b1' }],
    payoffs: [],
    status: 'planted',
    ...over,
  } as NarrativeThread;
}

describe('repairSetupPayoff', () => {
  it('defers the payoff window of a dangling thread that still has runway', () => {
    const t = thread({ expectedPaidOffByEpisode: 2 });
    const { fixedCount, records } = repairSetupPayoff([t], { currentEpisode: 2, totalEpisodes: 5 });
    expect(fixedCount).toBe(1);
    expect(t.expectedPaidOffByEpisode).toBe(5);
    expect(records[0].rule).toBe('setup_payoff_window');
  });

  it('leaves a dangling thread with NO runway alone (genuine violation, needs a real payoff)', () => {
    const t = thread({ expectedPaidOffByEpisode: 5 });
    const { fixedCount } = repairSetupPayoff([t], { currentEpisode: 5, totalEpisodes: 5 });
    expect(fixedCount).toBe(0);
    expect(t.expectedPaidOffByEpisode).toBe(5);
  });

  it('does not touch a thread that is already paid off', () => {
    const t = thread({ expectedPaidOffByEpisode: 2, payoffs: [{ sceneId: 's3', beatId: 'b3' }], status: 'paid_off' });
    const { fixedCount } = repairSetupPayoff([t], { currentEpisode: 3, totalEpisodes: 5 });
    expect(fixedCount).toBe(0);
  });

  it('does not touch an unplanted thread (deus ex machina is not this repair’s job)', () => {
    const t = thread({ expectedPaidOffByEpisode: 2, plants: [], status: 'unplanted' });
    const { fixedCount } = repairSetupPayoff([t], { currentEpisode: 3, totalEpisodes: 5 });
    expect(fixedCount).toBe(0);
  });

  it('ignores season-wide threads (no expectedPaidOffByEpisode)', () => {
    const t = thread({ expectedPaidOffByEpisode: undefined });
    const { fixedCount } = repairSetupPayoff([t], { currentEpisode: 3, totalEpisodes: 5 });
    expect(fixedCount).toBe(0);
  });

  it('is not yet due: thread scheduled later than the current episode stays put', () => {
    const t = thread({ expectedPaidOffByEpisode: 4 });
    const { fixedCount } = repairSetupPayoff([t], { currentEpisode: 2, totalEpisodes: 5 });
    expect(fixedCount).toBe(0);
    expect(t.expectedPaidOffByEpisode).toBe(4);
  });
});
