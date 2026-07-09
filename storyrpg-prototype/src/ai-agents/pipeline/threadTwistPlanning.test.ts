/**
 * Thread/Twist planning wiring tests (threadTwistPlanning.ts).
 *
 * Covers the default-off contract (flag off → agents never invoked, mappers
 * return undefined), the per-episode invocation flow (ThreadPlanner then
 * TwistArchitect, which receives the fresh ledger), fail-open behavior
 * (warning emitted, generation continues), cross-episode ledger accumulation,
 * and the per-scene mapping onto SceneWriter's activeThreads/twistDirectives
 * shapes. All agents are mocked — no LLM/network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isThreadTwistPlanningEnabled,
  planEpisodeThreadsAndTwist,
  mergeIntoSeasonLedger,
  materializeTwistPlan,
  openPriorThreads,
  sceneActiveThreads,
  sceneTwistDirectives,
  THREAD_TWIST_PLANNING_ENV,
  type ThreadPlannerLike,
  type TwistArchitectLike,
} from './threadTwistPlanning';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { TwistPlan } from '../agents/TwistArchitect';
import type { NarrativeThread, ThreadLedger } from '../../types';

function makeBlueprint(episodeId = 'episode-1'): EpisodeBlueprint {
  return {
    episodeId,
    title: 'Test Episode',
    synopsis: 'A test.',
    scenes: [
      { id: 's1-1', purpose: 'setup', description: 'Opening' },
      { id: 's1-2', purpose: 'development', description: 'Middle' },
    ],
  } as unknown as EpisodeBlueprint;
}

function makeThread(overrides: Partial<NarrativeThread> = {}): NarrativeThread {
  return {
    id: 'locked-drawer',
    kind: 'seed',
    priority: 'minor',
    label: 'Locked drawer',
    description: 'A locked drawer in the mentor desk.',
    plants: [{ sceneId: 's1-1', beatId: 'b1' }],
    payoffs: [{ sceneId: 's1-2', beatId: 'b9' }],
    status: 'planned',
    ...overrides,
  };
}

function makeTwistPlan(overrides: Partial<TwistPlan> = {}): TwistPlan {
  return {
    episodeId: 'episode-1',
    headline: 'The mentor is the informant',
    kind: 'revelation',
    twistSceneId: 's1-2',
    twistBeatId: 'b9',
    foreshadowSceneId: 's1-1',
    foreshadowBeatId: 'b1',
    rationale: 'Planted early.',
    directives: [
      { sceneId: 's1-1', beatId: 'b1', beatRole: 'foreshadow', twistKind: 'revelation', hint: 'Odd flinch.' },
      { sceneId: 's1-2', beatId: 'b9', beatRole: 'reveal', twistKind: 'revelation', hint: 'The letter names him.' },
    ],
    ...overrides,
  };
}

function mockPlanner(ledger: ThreadLedger | undefined, error?: string): ThreadPlannerLike {
  return { execute: vi.fn().mockResolvedValue({ success: true, data: ledger ?? { threads: [] }, error }) };
}

function mockArchitect(plan: TwistPlan | undefined, error?: string): TwistArchitectLike {
  return { execute: vi.fn().mockResolvedValue({ success: true, data: plan, error }) };
}

describe('isThreadTwistPlanningEnabled', () => {
  const savedEnv = process.env[THREAD_TWIST_PLANNING_ENV];
  beforeEach(() => { delete process.env[THREAD_TWIST_PLANNING_ENV]; });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[THREAD_TWIST_PLANNING_ENV];
    else process.env[THREAD_TWIST_PLANNING_ENV] = savedEnv;
  });

  it('is OFF by default (no env, no config)', () => {
    expect(isThreadTwistPlanningEnabled(undefined)).toBe(false);
    expect(isThreadTwistPlanningEnabled({})).toBe(false);
  });

  it('turns on via config field', () => {
    expect(isThreadTwistPlanningEnabled({ enableThreadAndTwistPlanning: true })).toBe(true);
  });

  it('env=1 forces on; env=0 is a kill-switch over a config-on', () => {
    process.env[THREAD_TWIST_PLANNING_ENV] = '1';
    expect(isThreadTwistPlanningEnabled({})).toBe(true);
    process.env[THREAD_TWIST_PLANNING_ENV] = '0';
    expect(isThreadTwistPlanningEnabled({ enableThreadAndTwistPlanning: true })).toBe(false);
  });
});

describe('planEpisodeThreadsAndTwist', () => {
  const emitWarning = vi.fn();
  beforeEach(() => emitWarning.mockClear());

  it('flag off → agents are never invoked and nothing is returned', async () => {
    const threadPlanner = mockPlanner({ threads: [makeThread()] });
    const twistArchitect = mockArchitect(makeTwistPlan());
    const result = await planEpisodeThreadsAndTwist({
      enabled: false,
      threadPlanner,
      twistArchitect,
      episodeBlueprint: makeBlueprint(),
      episodeNumber: 1,
      emitWarning,
    });
    expect(result).toEqual({});
    expect(threadPlanner.execute).not.toHaveBeenCalled();
    expect(twistArchitect.execute).not.toHaveBeenCalled();
    expect(emitWarning).not.toHaveBeenCalled();
  });

  it('flag on → invokes ThreadPlanner then TwistArchitect once each, handing the fresh ledger to the architect', async () => {
    const threadPlanner = mockPlanner({ threads: [makeThread()] });
    const twistArchitect = mockArchitect(makeTwistPlan());
    const result = await planEpisodeThreadsAndTwist({
      enabled: true,
      threadPlanner,
      twistArchitect,
      episodeBlueprint: makeBlueprint(),
      episodeNumber: 1,
      priorThreads: [],
      emitWarning,
    });

    expect(threadPlanner.execute).toHaveBeenCalledTimes(1);
    expect(twistArchitect.execute).toHaveBeenCalledTimes(1);
    // TwistArchitect input carries the ledger ThreadPlanner just produced.
    const twistInput = (twistArchitect.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(twistInput.threadLedger?.threads.map((t: NarrativeThread) => t.id)).toEqual(['locked-drawer']);

    expect(result.twistPlan?.headline).toBe('The mentor is the informant');
    // Threads are stamped with the episode they were authored in.
    expect(result.threadLedger?.threads[0].introducedInEpisode).toBe(1);
    expect(emitWarning).not.toHaveBeenCalled();
  });

  it('passes prior open threads through to ThreadPlanner', async () => {
    const prior = [makeThread({ id: 'prior-promise', introducedInEpisode: 1, payoffs: [] })];
    const threadPlanner = mockPlanner({ threads: [] });
    const twistArchitect = mockArchitect(undefined);
    await planEpisodeThreadsAndTwist({
      enabled: true,
      threadPlanner,
      twistArchitect,
      episodeBlueprint: makeBlueprint('episode-2'),
      episodeNumber: 2,
      priorThreads: prior,
      emitWarning,
    });
    const plannerInput = (threadPlanner.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(plannerInput.priorThreads).toEqual(prior);
  });

  it('ThreadPlanner throw is fail-open: warning emitted, TwistArchitect still runs, generation continues', async () => {
    const threadPlanner: ThreadPlannerLike = { execute: vi.fn().mockRejectedValue(new Error('LLM exploded')) };
    const twistArchitect = mockArchitect(makeTwistPlan());
    const result = await planEpisodeThreadsAndTwist({
      enabled: true,
      threadPlanner,
      twistArchitect,
      episodeBlueprint: makeBlueprint(),
      episodeNumber: 1,
      emitWarning,
    });
    expect(emitWarning).toHaveBeenCalledTimes(1);
    expect(emitWarning.mock.calls[0][0]).toContain('ThreadPlanner failed');
    expect(result.threadLedger).toBeUndefined();
    // Twist half still ran (without a ledger).
    expect(twistArchitect.execute).toHaveBeenCalledTimes(1);
    expect(result.twistPlan).toBeDefined();
  });

  it('agent-internal fail-open (empty output + error) yields a warning and no plan/ledger', async () => {
    // Mirrors the agents' own fail-open contract: success:true, empty data, error set.
    const threadPlanner = mockPlanner({ threads: [] }, 'parse failed');
    const emptyPlan = makeTwistPlan({ twistSceneId: '', directives: [] });
    const twistArchitect = mockArchitect(emptyPlan, 'timeout');
    const result = await planEpisodeThreadsAndTwist({
      enabled: true,
      threadPlanner,
      twistArchitect,
      episodeBlueprint: makeBlueprint(),
      episodeNumber: 1,
      emitWarning,
    });
    expect(result.threadLedger).toBeUndefined();
    expect(result.twistPlan).toBeUndefined();
    expect(emitWarning).toHaveBeenCalledTimes(2);
  });

  it('TwistArchitect rejection is fail-open: the thread ledger is still returned', async () => {
    const threadPlanner = mockPlanner({ threads: [makeThread()] });
    const twistArchitect: TwistArchitectLike = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
    const result = await planEpisodeThreadsAndTwist({
      enabled: true,
      threadPlanner,
      twistArchitect,
      episodeBlueprint: makeBlueprint(),
      episodeNumber: 1,
      emitWarning,
    });
    expect(result.threadLedger?.threads).toHaveLength(1);
    expect(result.twistPlan).toBeUndefined();
    expect(emitWarning).toHaveBeenCalledTimes(1);
    expect(emitWarning.mock.calls[0][0]).toContain('TwistArchitect failed');
  });
});

describe('season ledger accumulation across episodes', () => {
  it('accumulates episode ledgers and exposes unpaid prior threads to the next episode', () => {
    const season: ThreadLedger = { threads: [] };

    // Episode 1 plants two threads; one pays off in-episode, one stays open.
    mergeIntoSeasonLedger(season, {
      threads: [
        makeThread({ id: 'paid-in-ep1' }),
        makeThread({ id: 'open-promise', kind: 'promise', priority: 'major', payoffs: [], expectedPaidOffByEpisode: 3 }),
      ],
    }, 1);
    expect(season.threads).toHaveLength(2);
    expect(season.threads.every((t) => t.introducedInEpisode === 1)).toBe(true);

    // Episode 2's planner sees only the unpaid thread as prior context.
    const prior = openPriorThreads(season, 2);
    expect(prior.map((t) => t.id)).toEqual(['open-promise']);

    // Episode 2 extends the open thread with a payoff (re-emitted by id) and adds a new one.
    const { added, updated } = mergeIntoSeasonLedger(season, {
      threads: [
        makeThread({
          id: 'open-promise', kind: 'promise', priority: 'major',
          plants: [{ sceneId: 's1-1', beatId: 'b1' }],
          payoffs: [{ sceneId: 's2-4', beatId: 'b7' }],
        }),
        makeThread({ id: 'ep2-clue', kind: 'clue', plants: [{ sceneId: 's2-1', beatId: 'b2' }], payoffs: [] }),
      ],
    }, 2);
    expect(added).toBe(1);
    expect(updated).toBe(1);
    expect(season.threads).toHaveLength(3);

    const extended = season.threads.find((t) => t.id === 'open-promise')!;
    // Original introduction episode preserved; plants deduped; payoff appended.
    expect(extended.introducedInEpisode).toBe(1);
    expect(extended.plants).toHaveLength(1);
    expect(extended.payoffs).toEqual([{ sceneId: 's2-4', beatId: 'b7' }]);

    // Now paid off → no longer offered as a prior open thread.
    expect(openPriorThreads(season, 3).map((t) => t.id)).toEqual(['ep2-clue']);
  });
});

describe('sceneActiveThreads (SceneWriter input mapping)', () => {
  it('returns undefined for an empty/absent ledger (flag-off behavior unchanged)', () => {
    expect(sceneActiveThreads(undefined, 's1-1', 1)).toBeUndefined();
    expect(sceneActiveThreads({ threads: [] }, 's1-1', 1)).toBeUndefined();
  });

  it('maps plants and payoffs targeting the scene, including the reveal→foreshadow kind mapping', () => {
    const ledger: ThreadLedger = {
      threads: [
        makeThread({
          id: 'mentor-secret', kind: 'reveal', introducedInEpisode: 1,
          plants: [{ sceneId: 's1-1', beatId: 'b1', note: 'Flinch at the name' }],
          payoffs: [{ sceneId: 's1-2', beatId: 'b9', note: 'Letter', reframe: 'The rescue was a setup' }],
        }),
        makeThread({ id: 'elsewhere', introducedInEpisode: 1, plants: [{ sceneId: 's1-9', beatId: 'bx' }], payoffs: [] }),
      ],
    };

    const plantScene = sceneActiveThreads(ledger, 's1-1', 1);
    expect(plantScene).toEqual([
      { id: 'mentor-secret', kind: 'foreshadow', label: 'Locked drawer', action: 'plant', hint: 'Flinch at the name' },
    ]);

    const payoffScene = sceneActiveThreads(ledger, 's1-2', 1);
    expect(payoffScene).toEqual([
      { id: 'mentor-secret', kind: 'foreshadow', label: 'Locked drawer', action: 'payoff', hint: 'The rescue was a setup' },
    ]);
  });

  it('never re-plants a prior-episode thread on a scene-id collision, but does surface its payoff and keep-alives', () => {
    const ledger: ThreadLedger = {
      threads: [
        // Prior-episode thread whose old plant scene id collides with a current scene id.
        makeThread({ id: 'old-plant', introducedInEpisode: 1, plants: [{ sceneId: 's1-1', beatId: 'b1' }], payoffs: [] }),
        // Prior-episode MAJOR open thread → keep-alive reference on other scenes.
        makeThread({ id: 'big-promise', kind: 'promise', priority: 'major', introducedInEpisode: 1, plants: [], payoffs: [] }),
        // Prior thread paying off in THIS episode's scene.
        makeThread({ id: 'pays-now', introducedInEpisode: 1, plants: [], payoffs: [{ sceneId: 's2-3', beatId: 'b5' }] }),
      ],
    };

    // Episode 2, scene id 's1-1' (collision): old-plant must NOT come back as a plant.
    const collision = sceneActiveThreads(ledger, 's1-1', 2) ?? [];
    expect(collision.filter((t) => t.action === 'plant')).toHaveLength(0);
    expect(collision.filter((t) => t.action === 'reference').map((t) => t.id)).toContain('big-promise');

    const payoff = sceneActiveThreads(ledger, 's2-3', 2) ?? [];
    expect(payoff.find((t) => t.id === 'pays-now')?.action).toBe('payoff');
  });

  it('caps keep-alive references per scene', () => {
    const ledger: ThreadLedger = {
      threads: ['a', 'b', 'c', 'd'].map((id) =>
        makeThread({ id, kind: 'promise', priority: 'major', introducedInEpisode: 1, plants: [], payoffs: [] })),
    };
    const refs = sceneActiveThreads(ledger, 's2-1', 2) ?? [];
    expect(refs.every((t) => t.action === 'reference')).toBe(true);
    expect(refs.length).toBe(2);
  });
});

describe('sceneTwistDirectives (SceneWriter input mapping)', () => {
  it('returns undefined without a plan or without directives for the scene', () => {
    expect(sceneTwistDirectives(undefined, 's1-1')).toBeUndefined();
    expect(sceneTwistDirectives(makeTwistPlan(), 's9-9')).toBeUndefined();
  });

  it('maps TwistArchitect beat roles onto SceneWriter roles per scene', () => {
    const plan = makeTwistPlan({
      directives: [
        { sceneId: 's1-1', beatId: 'b1', beatRole: 'foreshadow', twistKind: 'revelation', hint: 'Odd flinch.' },
        { sceneId: 's1-1', beatId: 'b2', beatRole: 'misdirect', twistKind: 'revelation', hint: 'Blame the guard.' },
        { sceneId: 's1-2', beatId: 'b9', beatRole: 'reveal', twistKind: 'revelation', hint: 'The letter.' },
        { sceneId: 's1-2', beatId: 'b10', beatRole: 'aftermath', twistKind: 'revelation', hint: 'Sit with it.' },
      ],
    });

    expect(sceneTwistDirectives(plan, 's1-1')).toEqual([
      { twistKind: 'revelation', beatRole: 'setup', hint: 'Odd flinch.' },
      { twistKind: 'revelation', beatRole: 'setup', hint: 'Blame the guard.' },
    ]);
    expect(sceneTwistDirectives(plan, 's1-2')).toEqual([
      { twistKind: 'revelation', beatRole: 'twist', hint: 'The letter.' },
      { twistKind: 'revelation', beatRole: 'satisfaction', hint: 'Sit with it.' },
    ]);
  });
});

describe('materializeTwistPlan', () => {
  it('binds placeholder plan ids to concrete generated beats and marks setup/reveal', () => {
    const plan = makeTwistPlan({
      foreshadowBeatId: 'planned-foreshadow',
      twistBeatId: 'planned-reveal',
    });
    const sceneContents: SceneContent[] = [
      {
        sceneId: 's1-1',
        sceneName: 'Opening',
        startingBeatId: 'actual-setup',
        beats: [{ id: 'actual-setup', text: 'The mentor flinches at the name.' }],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneId: 's1-2',
        sceneName: 'Reveal',
        startingBeatId: 'actual-reveal',
        beats: [{ id: 'actual-reveal', text: 'The letter names the mentor.' }],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
    ];

    const result = materializeTwistPlan(plan, sceneContents);

    expect(result).toMatchObject({
      status: 'materialized',
      foreshadowBeatId: 'actual-setup',
      twistBeatId: 'actual-reveal',
    });
    expect(sceneContents[0].beats[0].plotPointType).toBe('setup');
    expect(sceneContents[1].beats[0].plotPointType).toBe('revelation');
    expect(plan.realization?.status).toBe('materialized');
    expect(plan.directives.map((directive) => directive.beatId)).toEqual(['actual-setup', 'actual-reveal']);
  });

  it('only defers a missing target through a future partial-season contract', () => {
    const plan = makeTwistPlan({ twistSceneId: 'episode-3-reveal' });

    const invalid = materializeTwistPlan(plan, []);
    expect(invalid.status).toBe('invalid');
    expect(plan.realization).toBeUndefined();

    const deferred = materializeTwistPlan(plan, [], {
      generatedThroughEpisode: 1,
      deferredUntilEpisode: 3,
      reason: 'The current run intentionally generates only episode 1.',
    });
    expect(deferred.status).toBe('deferred');
    expect(plan.realization).toMatchObject({
      status: 'deferred',
      deferredUntilEpisode: 3,
    });
  });

  it('rejects a same-scene or late foreshadow instead of silently marking it', () => {
    const plan = makeTwistPlan({
      foreshadowSceneId: 's1-2',
      twistSceneId: 's1-1',
    });
    const result = materializeTwistPlan(plan, [
      {
        sceneId: 's1-1',
        sceneName: 'Reveal',
        startingBeatId: 'b1',
        beats: [{ id: 'b1', text: 'Reveal.' }],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneId: 's1-2',
        sceneName: 'Late setup',
        startingBeatId: 'b2',
        beats: [{ id: 'b2', text: 'Too late.' }],
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
    ]);

    expect(result.status).toBe('invalid');
  });
});
