import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { reconcileFlagVocabulary } from './flagVocabulary';

function story(scenes: unknown[]): Story {
  return { episodes: [{ id: 'ep1', number: 1, scenes }] } as unknown as Story;
}

describe('reconcileFlagVocabulary (WS1.1)', () => {
  it('rewrites a dead-condition flag to its nearest real setter (g17 accepted/received)', () => {
    const s = story([
      { id: 's1', beats: [{ id: 'b1', choices: [{ id: 'c1', consequences: [{ type: 'setFlag', flag: 'received_victor_invitation', value: true }] }] }] },
      { id: 's2', beats: [{ id: 'b2', text: 'base', textVariants: [{ condition: { type: 'flag', flag: 'accepted_victor_invitation', value: true }, text: 'v' }] }] },
    ]);
    const res = reconcileFlagVocabulary(s);
    expect(res.reconciled).toEqual([{ from: 'accepted_victor_invitation', to: 'received_victor_invitation' }]);
    const cond = (s.episodes[0].scenes[1] as { beats: Array<{ textVariants: Array<{ condition: { flag: string } }> }> }).beats[0].textVariants[0].condition;
    expect(cond.flag).toBe('received_victor_invitation');
  });

  it('leaves a condition whose flag IS set untouched (golden parity)', () => {
    const s = story([
      { id: 's1', beats: [{ id: 'b1', choices: [{ id: 'c1', consequences: [{ type: 'setFlag', flag: 'took_card', value: true }] }] }] },
      { id: 's2', beats: [{ id: 'b2', text: 'base', textVariants: [{ condition: { type: 'flag', flag: 'took_card', value: true }, text: 'v' }] }] },
    ]);
    const before = JSON.stringify(s);
    expect(reconcileFlagVocabulary(s).reconciled).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('reports a truly-dead condition (no near setter) as unresolved without rewriting', () => {
    const s = story([
      { id: 's1', beats: [{ id: 'b1', choices: [{ id: 'c1', consequences: [{ type: 'setFlag', flag: 'took_card', value: true }] }] }] },
      { id: 's2', beats: [{ id: 'b2', text: 'base', textVariants: [{ condition: { type: 'flag', flag: 'completely_unrelated_ghost', value: true }, text: 'v' }] }] },
    ]);
    const res = reconcileFlagVocabulary(s);
    expect(res.reconciled).toEqual([]);
    expect(res.unresolved).toEqual(['completely_unrelated_ghost']);
  });

  it('does not rewrite engine-namespace conditions (encounter./route_/_outcome_)', () => {
    const s = story([
      { id: 's1', beats: [{ id: 'b1', text: 'base', textVariants: [
        { condition: { type: 'flag', flag: 'encounter.e1.victory', value: true }, text: 'v' },
        { condition: { type: 'flag', flag: 'route_a', value: true }, text: 'v' },
      ] }] },
    ]);
    expect(reconcileFlagVocabulary(s).reconciled).toEqual([]);
  });

  it('reconciles a bare-string condition too', () => {
    const s = story([
      { id: 's1', beats: [{ id: 'b1', choices: [{ id: 'c1', consequences: [{ type: 'setFlag', flag: 'kylie_logs_for_now', value: true }] }] }] },
      { id: 's2', beats: [{ id: 'b2', text: 'base', textVariants: [{ condition: 'kylie_logs_for_noww', text: 'v' }] }] },
    ]);
    const res = reconcileFlagVocabulary(s);
    expect(res.reconciled).toEqual([{ from: 'kylie_logs_for_noww', to: 'kylie_logs_for_now' }]);
  });
});
