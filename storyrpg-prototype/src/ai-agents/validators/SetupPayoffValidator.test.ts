import { describe, expect, it } from 'vitest';

import { SetupPayoffValidator } from './SetupPayoffValidator';
import type { NarrativeThread, ThreadLedger } from '../../types';
import type { SceneContent, GeneratedBeat } from '../agents/SceneWriter';

function thread(overrides: Partial<NarrativeThread>): NarrativeThread {
  return {
    id: 'thread-marta-limp',
    kind: 'seed',
    priority: 'major',
    label: "Marta's limp",
    description: 'A subtle wound that later explains her absence.',
    plants: [],
    payoffs: [],
    status: 'planned',
    ...overrides,
  };
}

function beat(overrides: Partial<GeneratedBeat>): GeneratedBeat {
  return {
    id: 'beat-1',
    text: 'Marta winces as she crosses the courtyard.',
    ...overrides,
  };
}

function scene(overrides: Partial<SceneContent>): SceneContent {
  return {
    sceneId: 'scene-1',
    sceneName: 'Test Scene',
    beats: [beat({})],
    startingBeatId: 'beat-1',
    moodProgression: ['tense'],
    charactersInvolved: ['marta'],
    keyMoments: ['The limp is noticed'],
    continuityNotes: [],
    ...overrides,
  };
}

describe('SetupPayoffValidator', () => {
  const validator = new SetupPayoffValidator();

  it('passes a thread that is both planted and paid off via beat metadata', () => {
    const ledger: ThreadLedger = {
      threads: [thread({ id: 'thread-marta-limp' })],
    };
    const sceneContents: SceneContent[] = [
      scene({
        sceneId: 'scene-1',
        beats: [beat({ id: 'plant-beat', plantsThreadId: 'thread-marta-limp' })],
      }),
      scene({
        sceneId: 'scene-2',
        startingBeatId: 'payoff-beat',
        beats: [beat({ id: 'payoff-beat', paysOffThreadId: 'thread-marta-limp' })],
      }),
    ];

    const result = validator.validate({ ledger, sceneContents });

    expect(result.valid).toBe(true);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
    expect(result.metrics).toMatchObject({
      totalThreads: 1,
      paidOff: 1,
      dangling: 0,
      unplanted: 0,
    });
    expect(result.threads[0].status).toBe('paid_off');
  });

  it('flags a major thread that is paid off but never planted as a deus ex machina error', () => {
    const ledger: ThreadLedger = {
      threads: [thread({ id: 'thread-secret-heir', priority: 'major', label: 'Secret heir' })],
    };
    const sceneContents: SceneContent[] = [
      scene({
        sceneId: 'scene-1',
        beats: [beat({ id: 'reveal-beat', paysOffThreadId: 'thread-secret-heir' })],
      }),
    ];

    const result = validator.validate({ ledger, sceneContents });

    expect(result.valid).toBe(false);
    expect(result.metrics.unplanted).toBe(1);
    expect(result.threads[0].status).toBe('unplanted');
    const errors = result.issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('never planted');
    expect(result.score).toBe(80); // 100 - 1 error * 20
  });

  it('flags a major thread planted but not paid off by its scheduled episode as dangling', () => {
    const ledger: ThreadLedger = {
      threads: [
        thread({
          id: 'thread-cursed-blade',
          priority: 'major',
          label: 'Cursed blade',
          expectedPaidOffByEpisode: 2,
        }),
      ],
    };
    const sceneContents: SceneContent[] = [
      scene({
        sceneId: 'scene-1',
        beats: [beat({ id: 'plant-beat', plantsThreadId: 'thread-cursed-blade' })],
      }),
    ];

    const result = validator.validate({ ledger, sceneContents, currentEpisode: 2 });

    expect(result.valid).toBe(false);
    expect(result.metrics.dangling).toBe(1);
    expect(result.threads[0].status).toBe('dangling');
    expect(result.issues.some(i => i.severity === 'error' && i.message.includes('never paid off'))).toBe(true);
  });

  it('treats a minor unplanted thread as a warning rather than an error', () => {
    const ledger: ThreadLedger = {
      threads: [thread({ id: 'thread-old-photo', priority: 'minor', label: 'Old photo' })],
    };
    const sceneContents: SceneContent[] = [
      scene({
        sceneId: 'scene-1',
        beats: [beat({ id: 'payoff-beat', paysOffThreadId: 'thread-old-photo' })],
      }),
    ];

    const result = validator.validate({ ledger, sceneContents });

    expect(result.valid).toBe(true); // warnings do not invalidate
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('warning');
    expect(result.score).toBe(92); // 100 - 1 warning * 8
  });
});
