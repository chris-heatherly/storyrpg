import { describe, expect, it } from 'vitest';
import { CallbackLedger } from '../pipeline/callbackLedger';
import { buildObligationPayoffRepairHandler } from './obligationPayoffRepairHandler';
import type { Story } from '../../types';

const debtIssue = {
  type: 'obligation_ledger_debt',
  severity: 'error',
  message: 'flag_promise obligation "flag:spared_herald" (You spared the herald.) is unpaid: due by episode 1, currently at episode 1.',
  validator: 'ObligationLedgerValidator',
} as never;

function storyWithBeats(): Story {
  return {
    id: 's', title: 't',
    episodes: [{
      id: 'ep-1', number: 1, title: 'Ep 1', synopsis: '', coverImage: 'x',
      scenes: [
        {
          id: 's1-1', name: 'Opening', backgroundImage: 'x', startingBeatId: 'b1',
          beats: [
            { id: 'b1', text: 'The herald kneels. You lower the blade and let him run.' },
            { id: 'b2', text: 'The road out of the city is quiet.' },
          ],
        },
        {
          id: 's1-2', name: 'Aftermath', backgroundImage: 'x', startingBeatId: 'b3',
          beats: [{ id: 'b3', text: 'Word travels faster than you do.' }],
        },
      ],
      startingSceneId: 's1-1',
    }],
  } as never;
}

function ledgerWithDebt(): CallbackLedger {
  const ledger = new CallbackLedger({ storyId: 's' });
  ledger.add({
    id: 'flag:spared_herald',
    kind: 'flag_promise',
    sourceEpisode: 1,
    sourceSceneId: 's1-1',
    sourceChoiceId: 'c-spare',
    flags: ['spared_herald'],
    summary: 'You spared the herald.',
    proseSources: { reminderPlan: 'The herald you spared owes you a road out.' },
    payoffEpisode: 1,
    payoffWindow: { minEpisode: 1, maxEpisode: 1 },
  } as never);
  return ledger;
}

describe('buildObligationPayoffRepairHandler', () => {
  it('injects a deterministic payoff variant and credits the ledger', async () => {
    const ledger = ledgerWithDebt();
    const story = storyWithBeats();
    const emitted: string[] = [];
    const handler = buildObligationPayoffRepairHandler({ ledger, emit: (m) => emitted.push(m) });

    const result = await handler({ story, blockingIssues: [debtIssue] } as never);

    expect(result.changed).toBe(true);
    const hook = ledger.all().find((h) => h.id === 'flag:spared_herald');
    expect(hook?.payoffCount).toBeGreaterThan(0);
    const variants = (story.episodes[0].scenes as Array<{ beats?: Array<{ textVariants?: unknown[] }> }>)
      .flatMap((scene) => scene.beats ?? [])
      .flatMap((beat) => beat.textVariants ?? []);
    expect(variants.length).toBeGreaterThan(0);
    expect(emitted.some((m) => m.includes('injected'))).toBe(true);
  });

  it('is a no-op without debt blockers or without a ledger', async () => {
    const ledger = ledgerWithDebt();
    const handler = buildObligationPayoffRepairHandler({ ledger });
    const clean = await handler({ story: storyWithBeats(), blockingIssues: [] } as never);
    expect(clean.changed).toBe(false);

    const noLedger = buildObligationPayoffRepairHandler({ ledger: undefined });
    const skipped = await noLedger({ story: storyWithBeats(), blockingIssues: [debtIssue] } as never);
    expect(skipped.changed).toBe(false);
  });

  it('reports unrepairable when the realizer cannot place any payoff', async () => {
    const ledger = new CallbackLedger({ storyId: 's' });
    // Planning-register summary only — the meta-prose filter rejects it.
    ledger.add({
      id: 'flag:meta_only',
      kind: 'flag_promise',
      sourceEpisode: 1,
      sourceSceneId: 's1-1',
      sourceChoiceId: 'c1',
      flags: ['meta_only'],
      summary: 'In the caravan scene, remember this choice for episode 2.',
      payoffEpisode: 1,
      payoffWindow: { minEpisode: 1, maxEpisode: 1 },
    } as never);
    const emitted: string[] = [];
    const handler = buildObligationPayoffRepairHandler({ ledger, emit: (m) => emitted.push(m) });
    const result = await handler({ story: storyWithBeats(), blockingIssues: [debtIssue] } as never);
    expect(result.changed).toBe(false);
    expect(emitted.some((m) => m.includes('no injectable payoff'))).toBe(true);
  });

  it('credits ESC plant-staging thread debts without injecting reader prose', async () => {
    const ledger = new CallbackLedger({ storyId: 's' });
    ledger.add({
      id: 'thread:consequence_seed-1-kylie-arrives-in-bucharest-with-two-suit',
      kind: 'thread',
      sourceEpisode: 1,
      sourceSceneId: 's1-1',
      sourceChoiceId: '',
      flags: [],
      summary: 'Kylie arrives in Bucharest with two suitcases and her grandmother\'s address.',
      payoffWindow: { minEpisode: 1, maxEpisode: 1 },
    } as never);
    const stagingDebt = {
      type: 'obligation_ledger_debt',
      severity: 'error',
      message: 'thread obligation "thread:consequence_seed-1-kylie-arrives-in-bucharest-with-two-suit" (Kylie arrives in Bucharest with two suitcases and her grandmother\'s address.) is unpaid: due by episode 1, currently at episode 1.',
      validator: 'ObligationLedgerValidator',
    } as never;
    const story = storyWithBeats();
    const emitted: string[] = [];
    const handler = buildObligationPayoffRepairHandler({ ledger, emit: (m) => emitted.push(m) });

    const result = await handler({ story, blockingIssues: [stagingDebt] } as never);

    expect(result.changed).toBe(true);
    const hook = ledger.all().find(
      (h) => h.id === 'thread:consequence_seed-1-kylie-arrives-in-bucharest-with-two-suit',
    );
    expect(hook?.payoffCount).toBeGreaterThan(0);
    const variants = (story.episodes[0].scenes as Array<{ beats?: Array<{ textVariants?: unknown[] }> }>)
      .flatMap((scene) => scene.beats ?? [])
      .flatMap((beat) => beat.textVariants ?? []);
    expect(variants).toHaveLength(0);
    expect(emitted.some((m) => m.includes('ESC plant-staging'))).toBe(true);
  });
});
