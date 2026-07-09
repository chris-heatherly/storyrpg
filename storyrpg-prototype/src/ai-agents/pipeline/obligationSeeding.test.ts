import { describe, expect, it } from 'vitest';
import type { ThreadLedger } from '../../types/narrativeThread';
import { CallbackLedger } from './callbackLedger';
import {
  collectEpisodeSetFlags,
  isObligationPaid,
  registerSeedObligations,
  registerThreadObligations,
} from './obligationSeeding';

function threadLedger(): ThreadLedger {
  return {
    threads: [
      {
        id: 'locked-drawer',
        kind: 'clue',
        priority: 'major',
        label: "Marta's locked drawer",
        description: 'The drawer nobody opens.',
        introducedInEpisode: 1,
        expectedPaidOffByEpisode: 2,
        plants: [{ sceneId: 's1-1', beatId: 'b1', note: 'drawer noticed' }],
        payoffs: [{ sceneId: 's1-4', beatId: 'b2', note: 'drawer opened' }],
        status: 'paid_off',
      },
      {
        id: 'mentor-loyalty',
        kind: 'promise',
        priority: 'major',
        label: 'Mentor loyalty question',
        description: 'Will the mentor stay loyal?',
        plants: [{ sceneId: 's1-2', beatId: 'b1', note: 'doubt planted' }],
        payoffs: [],
        status: 'planted',
      },
      {
        id: 'unplanted-reveal',
        kind: 'reveal',
        priority: 'minor',
        label: 'Never planted',
        description: 'No plants — promises nothing yet.',
        plants: [],
        payoffs: [{ sceneId: 's1-5', beatId: 'b1' }],
        status: 'unplanted',
      },
    ],
  };
}

describe('registerThreadObligations (P2.3)', () => {
  it('registers planted threads as thread-kind obligations with authored windows and credits payoffs', () => {
    const ledger = new CallbackLedger({ storyId: 's' });

    const result = registerThreadObligations(ledger, threadLedger(), 1);

    expect(result).toEqual({ threadsRegistered: 2, threadPayoffsCredited: 1 });
    const hooks = ledger.serialize().hooks;
    const paid = hooks.find((h) => h.id === 'thread:locked-drawer');
    const open = hooks.find((h) => h.id === 'thread:mentor-loyalty');
    expect(paid?.kind).toBe('thread');
    expect(paid?.payoffWindow).toEqual({ minEpisode: 1, maxEpisode: 2 });
    expect(paid && isObligationPaid(paid)).toBe(true);
    expect(open && isObligationPaid(open)).toBe(false);
    expect(hooks.find((h) => h.id === 'thread:unplanted-reveal')).toBeUndefined();
  });

  it('is idempotent across re-registration (payoff state preserved by add-merge)', () => {
    const ledger = new CallbackLedger({ storyId: 's' });
    registerThreadObligations(ledger, threadLedger(), 1);
    registerThreadObligations(ledger, threadLedger(), 1);

    const paid = ledger.serialize().hooks.find((h) => h.id === 'thread:locked-drawer');
    // Second pass re-credits (payoffCount 2) but never duplicates the entry.
    expect(ledger.serialize().hooks.filter((h) => h.id === 'thread:locked-drawer')).toHaveLength(1);
    expect(paid && isObligationPaid(paid)).toBe(true);
  });

  it('auto-credits ESC plant-staging threads that lack an explicit payoff entry', () => {
    const ledger = new CallbackLedger({ storyId: 's' });
    const result = registerThreadObligations(ledger, {
      threads: [
        {
          id: 'consequence_seed-1-kylie-arrives-in-bucharest-with-two-suit',
          kind: 'seed',
          priority: 'minor',
          label: 'Kylie arrives in Bucharest',
          description: 'Kylie arrives in Bucharest with two suitcases.',
          introducedInEpisode: 1,
          plants: [{ sceneId: 's1-1', beatId: 's1-1-plant' }],
          payoffs: [],
          status: 'planted',
          tags: ['esc-compiled', 'esc-plant-staging', 'consequence_seed'],
        },
        {
          id: 'real-chekhov-gun',
          kind: 'promise',
          priority: 'major',
          label: 'Real unpaid promise',
          description: 'Must still block when unpaid.',
          introducedInEpisode: 1,
          expectedPaidOffByEpisode: 1,
          plants: [{ sceneId: 's1-2', beatId: 'b1' }],
          payoffs: [],
          status: 'planted',
        },
      ],
    }, 1);

    expect(result.threadsRegistered).toBe(2);
    expect(result.threadPayoffsCredited).toBe(1);
    const staging = ledger.serialize().hooks.find(
      (h) => h.id === 'thread:consequence_seed-1-kylie-arrives-in-bucharest-with-two-suit',
    );
    const real = ledger.serialize().hooks.find((h) => h.id === 'thread:real-chekhov-gun');
    expect(staging && isObligationPaid(staging)).toBe(true);
    expect(real && isObligationPaid(real)).toBe(false);
  });
});

describe('registerSeedObligations (P2.3)', () => {
  it('registers declared seeds and credits ones a choice sets', () => {
    const ledger = new CallbackLedger({ storyId: 's' });
    const scenes = [
      { id: 's1-3', choicePoint: { setsTreatmentSeeds: ['treatment_seed_ep1_1', 'treatment_seed_ep1_2'] } },
    ];
    const setFlags = collectEpisodeSetFlags([
      { choices: [{ consequences: [{ type: 'setFlag', flag: 'treatment_seed_ep1_1' }] }] },
    ]);

    const result = registerSeedObligations(ledger, scenes, setFlags, 1);

    expect(result).toEqual({ seedsRegistered: 2, seedPayoffsCredited: 1 });
    const hooks = ledger.serialize().hooks;
    const set = hooks.find((h) => h.id === 'seed:treatment_seed_ep1_1');
    const missed = hooks.find((h) => h.id === 'seed:treatment_seed_ep1_2');
    expect(set?.kind).toBe('seed');
    expect(set && isObligationPaid(set)).toBe(true);
    expect(missed && isObligationPaid(missed)).toBe(false);
    expect(missed?.payoffWindow).toEqual({ minEpisode: 1, maxEpisode: 1 });
  });
});
