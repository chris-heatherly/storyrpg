import { describe, it, expect } from 'vitest';
import { CallbackLedger } from './callbackLedger';
import {
  getUnresolvedCallbacksForPrompt,
  harvestEpisodeCallbacks,
  injectFallbackCallbacks,
  parsePromisedEpisode,
  recordScenePayoffs,
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

  it('seeds a narrative flag hook AND a lower-priority tone hook for a tint flag, skipping route flags', () => {
    // Behavior intentionally changed: cosmetic `tint:` flags are no longer dropped —
    // they now seed a de-prioritized `tone:` callback so the season's personality
    // flags stop being write-only. Structural `route_` flags remain excluded.
    const ledger = new CallbackLedger();
    const { newHooks } = harvestEpisodeCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        {
          sceneId: 'scene-1',
          choices: [
            { id: 'c1', consequences: [{ type: 'setFlag', flag: 'door_open', value: true }] },
            { id: 'c2', consequences: [{ type: 'setFlag', flag: 'tint:bold', value: true }] }, // cosmetic -> tone hook
            { id: 'c3', consequences: [{ type: 'setFlag', flag: 'route_left', value: true }] }, // structural -> skipped
          ],
        },
      ],
    });
    // door_open (flag:) + tint:bold (tone:) = 2 hooks; route_left excluded.
    expect(newHooks).toBe(2);
    expect(ledger.size()).toBe(2);
    expect(ledger.all().map((h) => h.id)).toEqual(expect.arrayContaining(['flag:door_open', 'tone:boldness']));
    expect(ledger.all().some((h) => h.id.startsWith('route'))).toBe(false);
  });

  it('still excludes structural route_/treatment_branch_/encounter_ flags from any hook seeding', () => {
    const ledger = new CallbackLedger();
    const { newHooks } = harvestEpisodeCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        {
          sceneId: 'scene-1',
          choices: [
            { id: 'c1', consequences: [{ type: 'setFlag', flag: 'route_left', value: true }] },
            { id: 'c2', consequences: [{ type: 'setFlag', flag: 'treatment_branch_2a', value: true }] },
            { id: 'c3', consequences: [{ type: 'setFlag', flag: 'encounter_x_partialVictory', value: true }] },
          ],
        },
      ],
    });
    expect(newHooks).toBe(0);
    expect(ledger.size()).toBe(0);
  });
});

describe('recordScenePayoffs (within-episode crediting)', () => {
  const seedHook = (ledger: CallbackLedger): void => {
    harvestEpisodeCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [],
      choiceSets: [
        { sceneId: 'scene-1', choices: [{ id: 'c1', memorableMoment: { id: 'hook-A', summary: 'A choice that matters.' } }] },
      ],
    });
  };
  const beatFor = (id: string) => ({
    id,
    textVariants: [{ condition: { type: 'flag', flag: 'x' } as any, text: 'callback prose', callbackHookId: 'hook-A' }],
  });

  it('credits a scene payoff immediately and the end-of-episode harvest does NOT double count it', () => {
    const ledger = new CallbackLedger();
    seedHook(ledger);
    const beat = beatFor('beat-2-1');
    const scene = { sceneId: 'scene-2', beats: [beat] };

    const { payoffs } = recordScenePayoffs(ledger, 2, scene);
    expect(payoffs).toBe(1);
    expect((beat as { callbackHookIds?: string[] }).callbackHookIds).toContain('hook-A');
    const afterScene = ledger.all().find((h) => h.id === 'hook-A')!.payoffCount;

    // The harvest re-scans the SAME beats; the dedupe key must make it a no-op.
    const harvest = harvestEpisodeCallbacks(ledger, {
      episodeNumber: 2,
      sceneContents: [scene],
      choiceSets: [],
    });
    expect(harvest.payoffs).toBe(0);
    expect(ledger.all().find((h) => h.id === 'hook-A')!.payoffCount).toBe(afterScene);
  });

  it('still counts the same hook honored by DIFFERENT beats as distinct payoffs', () => {
    const ledger = new CallbackLedger();
    seedHook(ledger);
    recordScenePayoffs(ledger, 2, { sceneId: 'scene-2', beats: [beatFor('beat-2-1')] });
    recordScenePayoffs(ledger, 2, { sceneId: 'scene-3', beats: [beatFor('beat-3-1')] });
    expect(ledger.all().find((h) => h.id === 'hook-A')!.payoffCount).toBe(2);
  });

  it('updates unresolvedFor mid-episode so later scenes stop being offered a resolved hook', () => {
    const ledger = new CallbackLedger({ config: { payoffThreshold: 1 } as any });
    seedHook(ledger);
    expect(getUnresolvedCallbacksForPrompt(ledger, 2)?.some((h) => h.id === 'hook-A')).toBe(true);
    recordScenePayoffs(ledger, 2, { sceneId: 'scene-2', beats: [beatFor('beat-2-1')] });
    expect(getUnresolvedCallbacksForPrompt(ledger, 2)?.some((h) => h.id === 'hook-A') ?? false).toBe(false);
  });

  it('round-trips credited beat keys through serialize/deserialize (resume safety)', () => {
    const ledger = new CallbackLedger();
    seedHook(ledger);
    const beat = beatFor('beat-2-1');
    recordScenePayoffs(ledger, 2, { sceneId: 'scene-2', beats: [beat] });
    const revived = CallbackLedger.deserialize(JSON.stringify(ledger.serialize()));
    const harvest = harvestEpisodeCallbacks(revived, {
      episodeNumber: 2,
      sceneContents: [{ sceneId: 'scene-2', beats: [beatFor('beat-2-1')] }],
      choiceSets: [],
    });
    expect(harvest.payoffs).toBe(0);
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

  it('realizes a cross-episode forward promise from hook prose without leaking the directive', () => {
    // Bite-Me G13: the magnolia forward promise (planted ep1, due ep3) could not be
    // realized in ep3 because its source choice was out of scope and its summary is
    // a planning directive. The hook now carries the choice's reader-safe prose, and
    // the directive ("In Episode 3, …") is rejected as injectable prose.
    const ledger = new CallbackLedger();
    ledger.recordForwardPromise({
      choice: {
        id: 'choice-write-magnolia-column',
        text: 'Write the Magnolia column instead.',
        feedbackCue: { echoSummary: 'You wrote the safe piece. The other story stayed inside.' },
        reminderPlan: {
          immediate: 'The Magnolia column fills the screen cleanly.',
          shortTerm: 'No blog post exists for Victor to quote back.',
        },
        consequences: [{ type: 'setFlag', flag: 'magnolia_column_filed', value: true } as any],
      } as any,
      episode: 1,
      sceneId: 's1-5',
      payoffEpisode: 3,
      summary: "In Episode 3, Mika will mention a food writer whose Bucharest column got a thousand reads — 'not bad for a start' — and Kylie will recognize the ceiling she chose.",
    });

    const sceneContents = [
      { sceneId: 's3-1', beats: [{ id: 's3-1-beat-1', text: 'Morning.', textVariants: [] as any[] }] },
      { sceneId: 's3-2', beats: [{ id: 's3-2-beat-1', text: 'The newsroom is quiet.', textVariants: [] as any[] }] },
    ];
    // No choiceSets in scope name choice-write-magnolia-column (it's an ep1 choice).
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 3,
      sceneContents: sceneContents as any,
      choiceSets: [] as any,
    });

    expect(injected).toBe(1);
    // A cross-episode hook may land in any beat; find the realized variant.
    const variant = sceneContents.flatMap((s) => s.beats).flatMap((b) => b.textVariants)[0];
    expect(variant.callbackHookId).toBe('later:choice-write-magnolia-column');
    expect(variant.condition).toMatchObject({ type: 'flag', flag: 'magnolia_column_filed', value: true });
    // Realized from the choice's reader-safe echo, NOT the "In Episode 3, …" directive.
    expect(variant.text).toContain('You wrote the safe piece.');
    expect(variant.text).not.toContain('In Episode 3');
    // The promise-due gate credits any payoffCount > 0 — now satisfied.
    expect(ledger.all().find((h) => h.id === 'later:choice-write-magnolia-column')!.payoffCount).toBeGreaterThan(0);
  });

  it('G12: composes the injected variant with the beat base text instead of replacing it', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Stop pretending.',
            consequences: [{ type: 'setFlag', flag: 'kylie_stops_pretending', value: true } as any],
            reminderPlan: {
              immediate: 'You asked the real question. Stela answered it.',
              shortTerm: 'You asked the real question. Stela answered it.',
            },
          } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    const laterBeat = {
      id: 'scene-2-beat-1',
      text: 'Walking home alone in Bucharest — inexplicably, good. The streetlights hum over Lipscani and the night feels briefly, suspiciously kind.',
      textVariants: [] as any[],
    };
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
    const variant = laterBeat.textVariants[0];
    // The base prose survives; the callback is appended, not substituted.
    expect(variant.text).toContain('Walking home alone in Bucharest');
    expect(variant.text).toContain('You asked the real question.');
  });

  it('does not inject fallback callback variants onto choice-point beats', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'accept-card',
            text: "Accept Victor's card.",
            consequences: [{ type: 'setFlag', flag: 'accepted_club_card', value: true } as any],
            reminderPlan: {
              immediate: "Victor's card sits heavy in your pocket.",
              shortTerm: "Victor's card sits heavy in your pocket.",
            },
          } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    const choiceBeat = {
      id: 'scene-2-choice',
      text: 'Stela presses a small protection bag into your palm.',
      isChoicePoint: true,
      choices: [{ id: 'take-bag', text: 'Accept the herb bag gracefully.' }],
      textVariants: [] as any[],
    };
    const laterBeat = {
      id: 'scene-2-after',
      text: 'The brunch table goes quiet.',
      textVariants: [] as any[],
    };
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [
        { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
        { sceneId: 'scene-2', beats: [choiceBeat, laterBeat] },
      ] as any,
      choiceSets: choiceSets as any,
    });

    expect(injected).toBe(1);
    expect(choiceBeat.textVariants).toHaveLength(0);
    expect(laterBeat.textVariants).toHaveLength(1);
    expect(laterBeat.textVariants[0].text).toContain("Victor's card sits heavy");
  });

  it('G12: never sources injected prose from the ChoiceAuthor reminder stubs', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Ask Stela directly.',
            consequences: [{ type: 'setFlag', flag: 'asked_stela_directly', value: true } as any],
            reminderPlan: {
              immediate: 'The moment lands immediately.',
              shortTerm: 'The next scene should remember this choice.',
            },
          } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });
    const laterBeat = { id: 'scene-2-beat-1', text: 'Base prose.', textVariants: [] as any[] };
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [
        { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
        { sceneId: 'scene-2', beats: [laterBeat] },
      ] as any,
      choiceSets: choiceSets as any,
    });
    // If no authored in-fiction prose exists, skip the injection rather than
    // synthesize a generic callback line.
    expect(injected).toBe(0);
    expect(laterBeat.textVariants).toHaveLength(0);
    expect(laterBeat.text).toBe('Base prose.');
  });

  it('does not derive fallback callback prose from bare choice text', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Accepting the quartz Stela presses into my hand',
            consequences: [{ type: 'setFlag', flag: 'accepted_quartz', value: true } as any],
          } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });
    const laterBeat = { id: 'scene-2-beat-1', text: 'Base prose.', textVariants: [] as any[] };
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [
        { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
        { sceneId: 'scene-2', beats: [laterBeat] },
      ] as any,
      choiceSets: choiceSets as any,
    });

    expect(injected).toBe(0);
    expect(laterBeat.textVariants).toHaveLength(0);
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

  it('never injects an agent-facing meta reminder, even when realizing via the derived fallback (no leak)', () => {
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

    // Meta scene-references are rejected, and without authored in-fiction prose
    // the hook is dropped rather than replaced with generic scaffolding.
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

  it('rejects treatment-residue planning directives as callback prose', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Follow Mika to the rooftop.',
            consequences: [{ type: 'setFlag', flag: 'mika_rooftop_route', value: true } as any],
            reminderPlan: {
              immediate: 'Show immediate residue from the authored path: Mika invents a reason she warned you off.',
              shortTerm: 'Keep this authored residue visible after reconvergence: Mika keeps watching the exits.',
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

    expect(injected).toBe(0);
    expect(laterBeat.textVariants).toHaveLength(0);
  });
});

describe('injectFallbackCallbacks — tone (tint) callbacks, per-scene cap, derived prose', () => {
  it('realizes a tint flag as a clean tone acknowledgment in a later scene', () => {
    const ledger = new CallbackLedger();
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          {
            id: 'c1',
            text: 'Let the herald go.',
            consequences: [{ type: 'setFlag', flag: 'tint:mercy', value: true } as any],
          } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });
    // The tone hook exists and is referenceable.
    expect(ledger.has('tone:mercy')).toBe(true);

    const laterBeat = { id: 'scene-2-beat-1', text: 'The road bends north.', textVariants: [] as any[] };
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [
        { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
        { sceneId: 'scene-2', beats: [laterBeat] },
      ] as any,
      choiceSets: choiceSets as any,
    });
    expect(injected).toBe(1);
    const variant = laterBeat.textVariants[0];
    // Tagged with the tone hook id; gated on the real tint flag.
    expect(variant.callbackHookId).toBe('tone:mercy');
    expect(variant.condition).toMatchObject({ type: 'flag', flag: 'tint:mercy', value: true });
    // Clean in-fiction prose; never leaks the raw tint flag.
    expect(variant.text).toContain('The road bends north.');
    expect(variant.text).not.toMatch(/tint:/i);
  });

  it('honors the per-scene injection cap so many hooks distribute instead of flooding one scene', () => {
    const ledger = new CallbackLedger();
    // Six trackable flag hooks set in scene-1, all eligible in ep1.
    const choices = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      text: `Decision ${i}.`,
      consequences: [{ type: 'setFlag', flag: `flag_${i}`, value: true } as any],
      reminderPlan: { immediate: `Echo ${i} carries forward.`, shortTerm: `Echo ${i} lingers.` },
    }));
    const choiceSets = [{ sceneId: 'scene-1', choices: choices as any }];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    // One downstream scene with 5 beats; per-scene cap = 2, per-beat cap = 1.
    const beats = Array.from({ length: 5 }, (_, i) => ({ id: `s2-b${i}`, text: 'base', textVariants: [] as any[] }));
    const sceneContents = [
      { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
      { sceneId: 'scene-2', beats },
    ];
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: sceneContents as any,
      choiceSets: choiceSets as any,
      maxPerScene: 2,
      maxPerBeat: 1,
    });
    // Capped at 2 in the single downstream scene even though 6 hooks were eligible.
    expect(injected).toBe(2);
    const totalVariants = beats.reduce((n, b) => n + b.textVariants.length, 0);
    expect(totalVariants).toBe(2);
  });

  it('spreads injections across MULTIPLE scenes (larger active pool + per-scene cap)', () => {
    const ledger = new CallbackLedger();
    const choices = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      text: `Decision ${i}.`,
      consequences: [{ type: 'setFlag', flag: `flag_${i}`, value: true } as any],
      reminderPlan: { immediate: `Echo ${i} carries forward.`, shortTerm: `Echo ${i} lingers.` },
    }));
    const choiceSets = [{ sceneId: 'scene-1', choices: choices as any }];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    const sceneContents = [
      { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
      { sceneId: 'scene-2', beats: [{ id: 's2-b0', text: 'a', textVariants: [] as any[] }, { id: 's2-b1', text: 'b', textVariants: [] as any[] }] },
      { sceneId: 'scene-3', beats: [{ id: 's3-b0', text: 'c', textVariants: [] as any[] }, { id: 's3-b1', text: 'd', textVariants: [] as any[] }] },
    ];
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: sceneContents as any,
      choiceSets: choiceSets as any,
      maxPerScene: 2,
      maxPerBeat: 1,
    });
    // 2 scenes × cap 2 = 4 placed (was previously bounded by maxActiveHooks=10; the
    // raised pool means availability isn't the bottleneck — distribution is).
    expect(injected).toBe(4);
  });

  it('drops a stub-only flag hook instead of synthesizing generic callback prose', () => {
    const ledger = new CallbackLedger();
    // A choice with NO authored reminderPlan/echo — its only prose source is the
    // synthesized `Earlier choice: "…" (sets …)` stub the filter rejects.
    const choiceSets = [
      {
        sceneId: 'scene-1',
        choices: [
          { id: 'c1', text: 'Take the back stairs.', consequences: [{ type: 'setFlag', flag: 'took_back_stairs', value: true } as any] } as any,
        ],
      },
    ];
    harvestEpisodeCallbacks(ledger, { episodeNumber: 1, sceneContents: [], choiceSets });

    const laterBeat = { id: 'scene-2-beat-1', text: 'Inside, the lobby is empty.', textVariants: [] as any[] };
    const { injected } = injectFallbackCallbacks(ledger, {
      episodeNumber: 1,
      sceneContents: [
        { sceneId: 'scene-1', beats: [{ id: 'scene-1-beat-1' }] },
        { sceneId: 'scene-2', beats: [laterBeat] },
      ] as any,
      choiceSets: choiceSets as any,
    });
    expect(injected).toBe(0);
    expect(laterBeat.textVariants).toHaveLength(0);
    expect(laterBeat.text).toBe('Inside, the lobby is empty.');
  });
});

describe('parsePromisedEpisode (gen-5 forward-promise harvesting)', () => {
  it('extracts a future episode number from a promise string', () => {
    expect(parsePromisedEpisode('In Episode 2 the photo appears in the blog sidebar.', 1)).toBe(2);
    expect(parsePromisedEpisode('Mika revisits this in episode three.', 1)).toBe(3);
  });

  it('uses the earliest FUTURE episode when a range is named', () => {
    expect(parsePromisedEpisode("Mika's confession in Episode 3/4 cataloguing the tells.", 1)).toBe(3);
  });

  it('returns undefined for a vague later-episode promise or a past/current episode', () => {
    expect(parsePromisedEpisode('She will remember this in a later episode.', 1)).toBeUndefined();
    expect(parsePromisedEpisode('Back in Episode 1 she hesitated.', 2)).toBeUndefined();
  });
});
