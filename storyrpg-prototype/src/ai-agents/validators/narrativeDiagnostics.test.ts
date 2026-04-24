import { describe, expect, it } from 'vitest';
import { runNarrativeDiagnostics } from './narrativeDiagnostics';
import type { ThreadLedger } from '../../types/narrativeThread';
import type { Episode } from '../../types/story';
import type { SceneContent } from '../agents/SceneWriter';
import type { SerializedCallbackLedger } from '../pipeline/callbackLedger';

describe('runNarrativeDiagnostics', () => {
  it('invokes docs-listed narrative validators and reports skipped checks', () => {
    const sceneContents: SceneContent[] = [
      {
        sceneId: 'scene-1',
        sceneName: 'Opening',
        beats: [
          {
            id: 'beat-1',
            text: 'A key glints under the table.',
            plantsThreadId: 'key-under-table',
            plotPointType: 'setup',
          },
          {
            id: 'beat-2',
            text: 'The same key opens the locked drawer.',
            paysOffThreadId: 'key-under-table',
            plotPointType: 'revelation',
          },
        ],
        startingBeatId: 'beat-1',
        moodProgression: ['tense'],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
    ];
    const episode: Episode = {
      id: 'episode-1',
      number: 1,
      title: 'Pilot',
      synopsis: 'A test episode.',
      coverImage: '',
      scenes: [
        {
          id: 'scene-1',
          name: 'Opening',
          beats: [{ id: 'beat-1', text: 'A key glints.' }],
          startingBeatId: 'beat-1',
        },
      ],
      startingSceneId: 'scene-1',
    };

    const report = runNarrativeDiagnostics({
      episodeNumber: 1,
      totalEpisodes: 2,
      sceneContents,
      episode,
      callbackLedger: emptyCallbackLedger(),
    });

    expect(report.checks.map((check) => check.name)).toEqual([
      'setup_payoff',
      'twist_quality',
      'arc_delta',
      'divergence',
      'callback_coverage',
    ]);
    expect(report.checks.find((check) => check.name === 'setup_payoff')?.status).toBe('passed');
    expect(report.checks.find((check) => check.name === 'arc_delta')?.status).toBe('skipped');
  });

  it('warns when callback hooks from earlier episodes receive no payoff', () => {
    const report = runNarrativeDiagnostics({
      episodeNumber: 2,
      totalEpisodes: 3,
      sceneContents: [],
      callbackLedger: {
        ...emptyCallbackLedger(),
        hooks: [
          {
            id: 'spared-herald',
            sourceEpisode: 1,
            sourceSceneId: 'scene-1',
            sourceChoiceId: 'choice-1',
            flags: ['spared_herald'],
            summary: 'You spared the herald.',
            payoffWindow: { minEpisode: 2, maxEpisode: 3 },
            payoffCount: 0,
            resolved: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    const callback = report.checks.find((check) => check.name === 'callback_coverage');
    expect(callback?.status).toBe('warning');
    expect(callback?.issues[0]?.message).toContain('unresolved callback hook');
  });

  it('uses supplied thread ledgers for setup/payoff checks', () => {
    const ledger: ThreadLedger = {
      threads: [
        {
          id: 'unpaid-promise',
          kind: 'promise',
          priority: 'major',
          label: 'Unpaid promise',
          description: 'A promise that should pay off by episode one.',
          introducedInEpisode: 1,
          expectedPaidOffByEpisode: 1,
          plants: [{ sceneId: 'scene-1', beatId: 'beat-1' }],
          payoffs: [],
          status: 'planted',
        },
      ],
    };

    const report = runNarrativeDiagnostics({
      episodeNumber: 1,
      sceneContents: [
        {
          sceneId: 'scene-1',
          sceneName: 'Opening',
          beats: [{ id: 'beat-1', text: 'The promise is made.' }],
          startingBeatId: 'beat-1',
          moodProgression: [],
          charactersInvolved: [],
          keyMoments: [],
          continuityNotes: [],
        },
      ],
      threadLedger: ledger,
    });

    expect(report.checks.find((check) => check.name === 'setup_payoff')?.status).toBe('failed');
  });
});

function emptyCallbackLedger(): SerializedCallbackLedger {
  return {
    version: 1,
    hooks: [],
    config: {
      payoffThreshold: 2,
      defaultWindowSpan: 3,
      maxActiveHooks: 10,
    },
  };
}
