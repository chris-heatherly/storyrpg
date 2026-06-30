import { describe, expect, it } from 'vitest';
import { CallbackLedger } from '../pipeline/callbackLedger';
import {
  validatePromisesDue,
  validateNoDanglingPayoffs,
  validatePlantValidity,
  validatePromiseLedger,
  validateSeasonCompletion,
} from './promiseLedgerValidators';

/** Build a ledger with one you planted in `sourceEpisode`, optionally targeted. */
function ledgerWithHook(opts: {
  id?: string;
  sourceEpisode: number;
  payoffEpisode?: number;
  maxEpisode?: number;
  payoffCount?: number;
}): CallbackLedger {
  const ledger = new CallbackLedger();
  ledger.add({
    id: opts.id ?? 'h1',
    sourceEpisode: opts.sourceEpisode,
    sourceSceneId: 'scene-1',
    sourceChoiceId: 'choice-1',
    flags: ['f1'],
    summary: 'A planted promise',
    payoffEpisode: opts.payoffEpisode,
    payoffWindow: { minEpisode: opts.sourceEpisode, maxEpisode: opts.maxEpisode ?? opts.sourceEpisode + 3 },
    payoffCount: opts.payoffCount ?? 0,
  });
  return ledger;
}

describe('CallbackLedger explicit payoffEpisode (P2)', () => {
  it('derives the window start from an explicit payoffEpisode', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 3, maxEpisode: 4 });
    const you = ledger.all()[0];
    expect(you.payoffEpisode).toBe(3);
    expect(you.payoffWindow).toEqual({ minEpisode: 3, maxEpisode: 4 });
  });

  it('setPayoffEpisode pins the target and re-derives the window', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1 });
    ledger.setPayoffEpisode('h1', 2);
    const you = ledger.all()[0];
    expect(you.payoffEpisode).toBe(2);
    expect(you.payoffWindow.minEpisode).toBe(2);
  });

  it('preserves payoffEpisode across a later merge that omits it', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 3, maxEpisode: 4 });
    ledger.add({
      id: 'h1',
      sourceEpisode: 1,
      sourceSceneId: 'scene-1',
      sourceChoiceId: 'choice-1',
      flags: ['f2'],
      summary: 'merged update',
      payoffWindow: { minEpisode: 1, maxEpisode: 4 },
    });
    expect(ledger.all()[0].payoffEpisode).toBe(3);
  });

  it('dueAt returns open hooks targeting that episode only', () => {
    const ledger = new CallbackLedger();
    ledger.add({ id: 'a', sourceEpisode: 1, sourceSceneId: 's', sourceChoiceId: 'c', flags: ['f'], summary: 's', payoffEpisode: 2, payoffWindow: { minEpisode: 2, maxEpisode: 2 } });
    ledger.add({ id: 'b', sourceEpisode: 1, sourceSceneId: 's', sourceChoiceId: 'c', flags: ['f'], summary: 's', payoffEpisode: 3, payoffWindow: { minEpisode: 3, maxEpisode: 3 } });
    expect(ledger.dueAt(2).map((h) => h.id)).toEqual(['a']);
  });
});

describe('validatePromisesDue', () => {
  it('flags a promise due this episode that was never paid', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 2 });
    expect(validatePromisesDue(ledger, 2)).toHaveLength(1);
  });

  it('passes when a due promise was referenced', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 2, payoffCount: 1 });
    expect(validatePromisesDue(ledger, 2)).toHaveLength(0);
  });

  it('does NOT flag a promise targeted at a LATER episode (pending, not violated)', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 3 });
    expect(validatePromisesDue(ledger, 1)).toHaveLength(0);
    expect(validatePromisesDue(ledger, 2)).toHaveLength(0);
  });
});

describe('validateNoDanglingPayoffs', () => {
  it('flags a payoff referencing a non-existent promise', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1 });
    expect(validateNoDanglingPayoffs(['h1', 'ghost'], ledger).map((i) => i.location)).toEqual(['payoff:ghost']);
  });

  it('excludes intra-episode plant refs (within-ep*)', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1 });
    expect(validateNoDanglingPayoffs(['within-ep1-f1'], ledger)).toHaveLength(0);
  });

  it('excludes structural-flag refs the ledger never registers (bite-me-g14 2026-06-11)', () => {
    // A textVariant tagged its branch-reconvergence residue with a callbackHookId
    // pointing at a `treatment_branch_` axis flag. The ledger never plants these
    // (recordFlagSet excludes them), so it can never resolve — but it's a mislabel,
    // NOT a dangling cross-episode promise, and must not abort the Season Canon seal.
    const ledger = ledgerWithHook({ sourceEpisode: 1 });
    expect(validateNoDanglingPayoffs(
      ['treatment_branch_mika_s_crossroad_read_gently_vs_read_cruelly'],
      ledger,
    )).toHaveLength(0);
    // route_/tint: refs, and the `flag:`-prefixed form, are all excluded too.
    expect(validateNoDanglingPayoffs(['route_loyal', 'tint:somber', 'flag:treatment_branch_x'], ledger)).toHaveLength(0);
    // Encounter-outcome state flags (bite-me-g13 2026-06-12T18-45): set by the
    // encounter's outcome, paid by reconvergence residue — never ledger promises.
    expect(validateNoDanglingPayoffs(
      ['encounter_treatment-enc-1-1_partialVictory', 'flag:encounter_x_victory'],
      ledger,
    )).toHaveLength(0);
    // A genuinely unplanted (non-structural) bare name still dangles.
    expect(validateNoDanglingPayoffs(['ghost'], ledger).map((i) => i.location)).toEqual(['payoff:ghost']);
  });

  it('resolves a bare flag-name payoff to its planted flag: you (G14 prefix mismatch)', () => {
    // The exact bite-me-g14 failure: the treatment plants `flag:treatment_seed_ep1_3`
    // but a textVariant tags the payoff with the bare `treatment_seed_ep1_3`.
    const ledger = new CallbackLedger();
    ledger.add({
      id: 'flag:treatment_seed_ep1_3', sourceEpisode: 1, sourceSceneId: 's1-1', sourceChoiceId: 'c1',
      flags: ['treatment_seed_ep1_3'], summary: 'seed', payoffWindow: { minEpisode: 1, maxEpisode: 4 }, payoffCount: 0,
    });
    expect(validateNoDanglingPayoffs(['treatment_seed_ep1_3'], ledger)).toHaveLength(0);
    // A genuinely unplanted bare name still dangles.
    expect(validateNoDanglingPayoffs(['treatment_seed_ep1_9'], ledger).map((i) => i.location))
      .toEqual(['payoff:treatment_seed_ep1_9']);
  });
});

describe('validatePlantValidity', () => {
  it('flags a BACKWARD target (payoff before the plant episode)', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 3, payoffEpisode: 2 });
    expect(validatePlantValidity(ledger, 5)).toHaveLength(1);
  });

  it('ALLOWS a same-episode target (within-episode forward promise; promise-due enforces it)', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 3, payoffEpisode: 3 });
    expect(validatePlantValidity(ledger, 5)).toHaveLength(0);
  });

  it('flags a target beyond the season', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 6, maxEpisode: 6 });
    expect(validatePlantValidity(ledger, 5)).toHaveLength(1);
  });

  it('passes a valid forward target', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 3, maxEpisode: 3 });
    expect(validatePlantValidity(ledger, 5)).toHaveLength(0);
  });

  it('ignores hooks with no explicit target', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1 });
    expect(validatePlantValidity(ledger, 5)).toHaveLength(0);
  });
});

describe('validatePromiseLedger (combined gate)', () => {
  it('is valid when nothing is due, dangling, or invalid', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 3, maxEpisode: 3 });
    const result = validatePromiseLedger({ ledger, episode: 1, seasonLength: 5, referencedHookIds: [] });
    expect(result.valid).toBe(true);
  });

  it('is invalid when a promise is due-and-unpaid', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 2 });
    const result = validatePromiseLedger({ ledger, episode: 2, seasonLength: 5 });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.location === 'promise:h1')).toBe(true);
  });
});

describe('validateSeasonCompletion', () => {
  it('flags a promise left open at season end', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 2 });
    expect(validateSeasonCompletion(ledger)).toHaveLength(1);
  });

  it('passes when the promise was paid (resolved)', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 2, payoffCount: 2 });
    ledger.recordPayoff('h1'); // pushes payoffCount past the threshold -> resolved
    expect(validateSeasonCompletion(ledger)).toHaveLength(0);
  });

  it('passes when the promise was explicitly abandoned', () => {
    const ledger = ledgerWithHook({ sourceEpisode: 1, payoffEpisode: 2 });
    ledger.abandon('h1', 'path never taken');
    expect(validateSeasonCompletion(ledger)).toHaveLength(0);
  });
});
