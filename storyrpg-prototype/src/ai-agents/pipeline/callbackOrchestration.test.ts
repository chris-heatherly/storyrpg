import { describe, it, expect } from 'vitest';
import { CallbackLedger } from './callbackLedger';
import {
  getUnresolvedCallbacksForPrompt,
  harvestEpisodeCallbacks,
  type HarvestEpisodeCallbacksParams,
} from './callbackOrchestration';

// Characterization tests for the callback orchestration extracted out of
// FullStoryPipeline. They lock in current behavior so the refactor is provably
// behavior-preserving. (PR B / 1.1 will deliberately change the seeding rule —
// these tests get updated then.)

describe('harvestEpisodeCallbacks', () => {
  it('seeds a hook from a choiceSet choice carrying a memorableMoment', () => {
    const ledger = new CallbackLedger();
    const params: HarvestEpisodeCallbacksParams = {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        {
          sceneId: 'scene-1',
          choices: [
            { id: 'c1', memorableMoment: { id: 'spared-herald', summary: 'You spared the herald.' } },
            { id: 'c2' }, // no memorableMoment -> not seeded
          ],
        },
      ],
    };
    const { newHooks, payoffs } = harvestEpisodeCallbacks(ledger, params);
    expect(newHooks).toBe(1);
    expect(payoffs).toBe(0);
    expect(ledger.size()).toBe(1);
  });

  it('records a payoff and tags the beat when a textVariant references a known hook', () => {
    const ledger = new CallbackLedger();
    // Seed a hook in episode 1...
    harvestEpisodeCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        { sceneId: 'scene-1', choices: [{ id: 'c1', memorableMoment: { id: 'hook-A', summary: 'A choice that matters.' } }] },
      ],
    });
    // ...then pay it off in episode 2 via a textVariant.
    const beat = {
      id: 'beat-2',
      textVariants: [{ condition: { type: 'flag', flag: 'x' } as any, text: 'callback prose', callbackHookId: 'hook-A' }],
    };
    const { payoffs } = harvestEpisodeCallbacks(ledger, {
      episodeNumber: 2,
      sceneContents: [{ sceneId: 'scene-2', beats: [beat] }],
      choiceSets: [],
    });
    expect(payoffs).toBe(1);
    expect(beat).toHaveProperty('callbackHookIds');
    expect((beat as { callbackHookIds?: string[] }).callbackHookIds).toContain('hook-A');
  });

  it('seeds a hook for a trackable set-flag consequence, skipping tint/route flags (1.1)', () => {
    const ledger = new CallbackLedger();
    const { newHooks } = harvestEpisodeCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        {
          sceneId: 'scene-1',
          choices: [
            { id: 'c1', consequences: [{ type: 'setFlag', flag: 'door_open', value: true }] },
            { id: 'c2', consequences: [{ type: 'setFlag', flag: 'tint:bold', value: true }] }, // cosmetic -> skipped
            { id: 'c3', consequences: [{ type: 'setFlag', flag: 'route_left', value: true }] }, // structural -> skipped
          ],
        },
      ],
    });
    expect(newHooks).toBe(1);
    expect(ledger.size()).toBe(1);
  });
});

describe('getUnresolvedCallbacksForPrompt', () => {
  it('returns undefined when the episode is undefined or < 1', () => {
    const ledger = new CallbackLedger();
    expect(getUnresolvedCallbacksForPrompt(ledger, undefined)).toBeUndefined();
    expect(getUnresolvedCallbacksForPrompt(ledger, 0)).toBeUndefined();
  });

  it('injects episode-1 flag hooks within episode 1 (EP1 skip removed, 1.1)', () => {
    const ledger = new CallbackLedger();
    harvestEpisodeCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        { sceneId: 'scene-1', choices: [{ id: 'c1', consequences: [{ type: 'setFlag', flag: 'spared_herald', value: true }] }] },
      ],
    });
    // A flag hook seeded in ep 1 is eligible from ep 1 (minEpisode = episode),
    // and ep 1 is no longer skipped, so it can be injected within the episode.
    const shaped = getUnresolvedCallbacksForPrompt(ledger, 1);
    expect(shaped).toBeDefined();
    expect(shaped!.some((h) => h.flags.includes('spared_herald'))).toBe(true);
  });

  it('returns undefined when there are no eligible unresolved hooks', () => {
    const ledger = new CallbackLedger();
    expect(getUnresolvedCallbacksForPrompt(ledger, 3)).toBeUndefined();
  });

  it('shapes unresolved hooks for the prompt in a later episode', () => {
    const ledger = new CallbackLedger();
    // Hook sourced in ep 1 is eligible for payoff in eps 2..(1+windowSpan).
    harvestEpisodeCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        { sceneId: 'scene-1', choices: [{ id: 'c1', memorableMoment: { id: 'hook-A', summary: 'A choice that matters.', flags: ['flag-a'] } }] },
      ],
    });
    const shaped = getUnresolvedCallbacksForPrompt(ledger, 2);
    expect(shaped).toBeDefined();
    expect(shaped).toHaveLength(1);
    expect(shaped![0]).toMatchObject({ id: 'hook-A', sourceEpisode: 1, summary: 'A choice that matters.' });
    expect(shaped![0].flags).toContain('flag-a');
  });
});
