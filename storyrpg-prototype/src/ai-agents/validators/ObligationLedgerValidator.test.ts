import { describe, expect, it } from 'vitest';
import { CallbackLedger } from '../pipeline/callbackLedger';
import { validateObligationLedger } from './ObligationLedgerValidator';

function ledgerWith(hooks: Array<Parameters<CallbackLedger['add']>[0]>): CallbackLedger {
  const ledger = new CallbackLedger({ storyId: 's' });
  for (const hook of hooks) ledger.add(hook);
  return ledger;
}

function hook(id: string, overrides: Record<string, unknown> = {}): Parameters<CallbackLedger['add']>[0] {
  return {
    id,
    sourceEpisode: 1,
    sourceSceneId: 's1-1',
    sourceChoiceId: 'c1',
    flags: [],
    summary: `hook ${id}`,
    payoffWindow: { minEpisode: 1, maxEpisode: 1 },
    ...overrides,
  } as Parameters<CallbackLedger['add']>[0];
}

describe('validateObligationLedger (P2.4)', () => {
  it('maps kinds to the existing gate ids and flags due unpaid obligations', () => {
    const ledger = ledgerWith([
      hook('thread:locked-drawer', { kind: 'thread' }),
      hook('seed:treatment_seed_ep1_1', { kind: 'seed' }),
      hook('flag:accepted_quartz', { kind: 'residue' }),
      hook('later:choice-1', { kind: 'forward_promise' }),
    ]);

    const report = validateObligationLedger(ledger, { episodeNumber: 1, generatedThroughEpisode: 1 });

    expect(report.findings).toHaveLength(4);
    const byId = new Map(report.findings.map((f) => [f.hookId, f]));
    expect(byId.get('thread:locked-drawer')?.gateId).toBe('GATE_SETUP_PAYOFF');
    expect(byId.get('seed:treatment_seed_ep1_1')?.gateId).toBe('GATE_TREATMENT_SEED_ONPAGE');
    expect(byId.get('flag:accepted_quartz')?.gateId).toBe('GATE_RESIDUE_CONSUME');
    expect(byId.get('later:choice-1')?.gateId).toBe('GATE_CALLBACK_COVERAGE');
    expect(report.findings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('never flags paid, abandoned, tone, or not-yet-due obligations', () => {
    const ledger = ledgerWith([
      hook('thread:paid', { kind: 'thread' }),
      hook('tone:boldness', { kind: 'tone' }),
      hook('flag:later_promise', { kind: 'flag_promise', payoffWindow: { minEpisode: 1, maxEpisode: 3 } }),
      hook('flag:abandoned', { kind: 'flag_promise', abandoned: true }),
    ]);
    ledger.recordPayoff('thread:paid', { episode: 1, sceneId: 's1-2', source: 'authored_variant' });

    const report = validateObligationLedger(ledger, { episodeNumber: 1, generatedThroughEpisode: 3 });

    expect(report.findings).toHaveLength(0);
    expect(report.paid).toBeGreaterThanOrEqual(1);
    expect(report.abandoned).toBe(1);
  });

  it('downgrades to warning when later generated episodes could still pay', () => {
    // Due window closes at ep3; we are validating ep2 of a 2-episode slice —
    // the promise is due beyond the slice, so it is a warning, not an error.
    const ledger = ledgerWith([
      hook('flag:due_later', { kind: 'flag_promise', payoffWindow: { minEpisode: 1, maxEpisode: 3 }, payoffEpisode: 2 }),
    ]);

    const report = validateObligationLedger(ledger, { episodeNumber: 2, generatedThroughEpisode: 2 });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe('error');

    const partialSlice = validateObligationLedger(ledger, { episodeNumber: 2, generatedThroughEpisode: 1 });
    expect(partialSlice.findings[0]?.severity).toBe('warning');
  });
});
