import { describe, it, expect } from 'vitest';
import { CallbackLedger } from './callbackLedger';
import {
  getUnresolvedCallbacksForPrompt,
  harvestEpisodeCallbacks,
  injectFallbackCallbacks,
  AUTO_CALLBACK_REMINDER_TAG,
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

describe('injectFallbackCallbacks', () => {
  it('realizes an uncollected within-episode flag hook in a later scene', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Take the key card.',
            // setFlag consequence so the harvest seeds a flag hook
            consequences: [{ type: 'setFlag', flag: 'accepted_keycard', value: true } as any],
            reminderPlan: {
              immediate: 'The card is warm in your pocket.',
              shortTerm: 'The side door clicks open before you reach it — someone is expecting you.',
            },
          } as any,
        ],
      },
    ];
    // Seed the flag hook (within-episode, window includes ep1).
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    const laterBeat = { id: 'scene-2-beat-1', textVariants: [] as any[] };
    const sceneContents = [
      { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
      { sceneId: 'scene-2', beats: [laterBeat] },
    ];

    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: sceneContents as any,
      choiceSets: choiceSets as any,
    });

    expect(injected).toBe(1);
    expect(laterBeat.textVariants).toHaveLength(1);
    const variant = laterBeat.textVariants[0];
    expect(variant.callbackHookId).toBe('flag:accepted_keycard');
    expect(variant.condition).toMatchObject({ type: 'flag', flag: 'accepted_keycard', value: true });
    expect(variant.reminderTag).toBe(AUTO_CALLBACK_REMINDER_TAG);
    // sourced from reminderPlan.shortTerm
    expect(variant.text).toContain('side door clicks open');
  });

  it('does not double-realize a hook already referenced by an authored variant', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Investigate the roses.',
            consequences: [{ type: 'setFlag', flag: 'investigated_roses', value: true } as any],
            reminderPlan: { immediate: 'x', shortTerm: 'y' },
          } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    // A later beat already has an authored callback gated on the same flag.
    const sceneContents = [
      { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
      {
        sceneId: 'scene-2',
        beats: [
          {
            id: 'scene-2-beat-1',
            textVariants: [{ condition: { type: 'flag', flag: 'investigated_roses', value: true }, text: 'authored', callbackHookId: 'flag:investigated_roses' }],
          },
        ],
      },
    ];

    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: sceneContents as any,
      choiceSets: choiceSets as any,
    });

    expect(injected).toBe(0);
  });

  it('does not realize a hook whose window is a future episode', () => {
    const ledger = new CallbackLedger();
    // recordChoice with a memorableMoment seeds a hook with window [ep+1, ...]
    harvestEpisodeCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        { sceneId: 'scene-1', choices: [{ id: 'c1', memorableMoment: { id: 'hook-future', summary: 'A weighty moment.', flags: ['weighty'] } }] },
      ],
    });

    // Try to realize in episode 1 — the memorableMoment window starts at ep2.
    const laterBeat = { id: 'scene-2-beat-1', textVariants: [] as any[] };
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [{ sceneId: 'scene-1', beats: [{ id: 'b0' }] }, { sceneId: 'scene-2', beats: [laterBeat] }] as any,
      choiceSets: [],
    });

    expect(injected).toBe(0);
    expect(laterBeat.textVariants).toHaveLength(0);
  });

  it('skips injection when every prose candidate is agent-facing meta (no leak)', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Hold her gaze.',
            consequences: [{ type: 'setFlag', flag: 'aethavyr_held_distance', value: true } as any],
            // Both reminderPlan fields are planning-register scene references — the
            // exact shape that leaked "In the caravan scene, she stops pretending…".
            reminderPlan: {
              immediate: 'In the next scene, she addresses him only when necessary.',
              shortTerm: 'In the caravan scene, she stops pretending to look at the road.',
            },
          } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    const laterBeat = { id: 'scene-2-beat-1', textVariants: [] as any[] };
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [
        { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
        { sceneId: 'scene-2', beats: [laterBeat] },
      ] as any,
      choiceSets: choiceSets as any,
    });

    // No clean candidate -> no injection, no leaked design note.
    expect(injected).toBe(0);
    expect(laterBeat.textVariants).toHaveLength(0);
  });

  it('falls through a meta reminderPlan to a clean echoSummary', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Pour the cordial.',
            consequences: [{ type: 'setFlag', flag: 'shared_the_cordial', value: true } as any],
            reminderPlan: {
              immediate: 'In the next scene, this pays off.',
              shortTerm: 'In the wall-breach encounter, he remembers.',
            },
            feedbackCue: { echoSummary: 'The warmth of that shared cup stays with him.' },
          } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    const laterBeat = { id: 'scene-2-beat-1', textVariants: [] as any[] };
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [
        { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
        { sceneId: 'scene-2', beats: [laterBeat] },
      ] as any,
      choiceSets: choiceSets as any,
    });

    expect(injected).toBe(1);
    expect(laterBeat.textVariants[0].text).toContain('shared cup');
  });
});
