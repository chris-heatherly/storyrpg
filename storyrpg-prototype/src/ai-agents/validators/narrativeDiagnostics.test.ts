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

    // setup_payoff + callback_coverage arms retired 2026-07-03: the unified
    // ObligationLedgerValidator feeds their plan gates directly.
    expect(report.checks.map((check) => check.name)).toEqual([
      'twist_quality',
      'arc_delta',
      'divergence',
      'failure_modes',
      'intensity_distribution',
      'prop_introduction',
      'choice_coverage',
    ]);
    expect(report.checks.find((check) => check.name === 'arc_delta')?.status).toBe('skipped');
  });



  it('uses supplied authored choice scene ids instead of requiring beat-attached choices', () => {
    const report = runNarrativeDiagnostics({
      episodeNumber: 1,
      sceneContents: [
        {
          sceneId: 'scene-1',
          sceneName: 'Opening',
          beats: [{ id: 'beat-1', text: 'A choice is about to land.' }],
          startingBeatId: 'beat-1',
          moodProgression: [],
          charactersInvolved: [],
          keyMoments: [],
          continuityNotes: [],
        },
      ],
      choicePlannedSceneIds: ['scene-1'],
      choiceAuthoredSceneIds: ['scene-1'],
    });

    const choiceCoverage = report.checks.find((check) => check.name === 'choice_coverage');
    expect(choiceCoverage?.status).toBe('passed');
    expect(choiceCoverage?.metrics).toMatchObject({ planned: 1, authored: 1, covered: 1 });
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
