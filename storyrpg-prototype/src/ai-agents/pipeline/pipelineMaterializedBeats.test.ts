import { describe, expect, it } from 'vitest';
import { isPipelineMaterializedBeat, preservePipelineMaterializedBeats } from './pipelineMaterializedBeats';

describe('preservePipelineMaterializedBeats', () => {
  const payoff1 = { id: 's1-1-b6-payoff-1', isChoicePayoff: true, text: 'You unpack the framed photo first.' };
  const payoff2 = { id: 's1-1-b6-payoff-2', text: 'You pour the wine before the boxes.' }; // id-pattern only
  const bridge = { id: 's1-5-b4-bridge', isChoiceBridge: true, text: 'The night thins; you angle toward the park gate.' };

  it('re-attaches payoff and bridge beats a rewrite dropped (run 2026-07-16T03-12-37)', () => {
    const previous = [
      { id: 's1-1-b1', text: 'old opening' },
      { id: 's1-1-b6', text: 'old choice point', isChoicePoint: true },
      payoff1, payoff2, bridge,
    ];
    const revised = [
      { id: 's1-1-b1', text: 'new opening with anchored POV' },
      { id: 's1-1-b6', text: 'new choice point', isChoicePoint: true },
    ];
    const merged = preservePipelineMaterializedBeats(previous, revised as never);
    expect(merged.map((beat) => beat.id)).toEqual([
      's1-1-b1', 's1-1-b6', 's1-1-b6-payoff-1', 's1-1-b6-payoff-2', 's1-5-b4-bridge',
    ]);
    // Regenerated prose wins for SceneWriter-owned beats.
    expect(merged[0].text).toContain('anchored POV');
  });

  it('never duplicates a materialized beat the revision kept', () => {
    const previous = [{ id: 'b1', text: 'x' }, payoff1];
    const revised = [{ id: 'b1', text: 'y' }, { ...payoff1, text: 'kept by the rewrite' }];
    const merged = preservePipelineMaterializedBeats(previous, revised as never);
    expect(merged).toHaveLength(2);
    expect(merged[1].text).toBe('kept by the rewrite');
  });

  it('does not resurrect SceneWriter-owned beats the rewrite intentionally replaced', () => {
    const previous = [{ id: 'b1', text: 'x' }, { id: 'b2', text: 'deleted filler' }];
    const merged = preservePipelineMaterializedBeats(previous, [{ id: 'b1', text: 'y' }] as never);
    expect(merged.map((beat) => beat.id)).toEqual(['b1']);
  });

  it('classifies by flags and by payoff id pattern', () => {
    expect(isPipelineMaterializedBeat(payoff1)).toBe(true);
    expect(isPipelineMaterializedBeat(payoff2)).toBe(true);
    expect(isPipelineMaterializedBeat(bridge)).toBe(true);
    expect(isPipelineMaterializedBeat({ id: 's1-1-b2' })).toBe(false);
    expect(isPipelineMaterializedBeat(undefined)).toBe(false);
  });
});
