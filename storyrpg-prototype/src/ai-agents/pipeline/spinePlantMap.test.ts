import { describe, expect, it } from 'vitest';
import { CallbackLedger } from './callbackLedger';
import { applySpinePlantMap } from './spinePlantMap';

function ledgerWith(...ids: string[]): CallbackLedger {
  const ledger = new CallbackLedger();
  for (const id of ids) {
    ledger.add({ id, sourceEpisode: 1, sourceSceneId: 's', sourceChoiceId: 'c', flags: ['f'], summary: id, payoffWindow: { minEpisode: 1, maxEpisode: 4 } });
  }
  return ledger;
}

describe('applySpinePlantMap', () => {
  it('pins payoffEpisode by explicit hookId', () => {
    const ledger = ledgerWith('h1');
    const result = applySpinePlantMap(ledger, { entries: [{ hookId: 'h1', payoffEpisode: 3 }] });
    expect(result.applied).toBe(1);
    expect(ledger.all()[0].payoffEpisode).toBe(3);
  });

  it('resolves a flag entry to the flag:<flag> hook id', () => {
    const ledger = ledgerWith('flag:lysandra_trusted');
    const result = applySpinePlantMap(ledger, { entries: [{ flag: 'lysandra_trusted', payoffEpisode: 2, payoffEpisodeLatest: 4 }] });
    expect(result.applied).toBe(1);
    const hook = ledger.all()[0];
    expect(hook.payoffEpisode).toBe(2);
    expect(hook.payoffWindow).toEqual({ minEpisode: 2, maxEpisode: 4 });
  });

  it('reports unmatched entries without throwing', () => {
    const ledger = ledgerWith('h1');
    const result = applySpinePlantMap(ledger, { entries: [{ hookId: 'ghost', payoffEpisode: 2 }] });
    expect(result.applied).toBe(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('handles an undefined map', () => {
    const ledger = ledgerWith('h1');
    expect(applySpinePlantMap(ledger, undefined)).toEqual({ applied: 0, unmatched: [] });
  });
});
