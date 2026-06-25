import { describe, expect, it } from 'vitest';

import { PlanningRegisterLeakValidator } from './PlanningRegisterLeakValidator';

describe('PlanningRegisterLeakValidator information-ledger leakage', () => {
  it('flags raw INFO tokens and information-ledger labels in reader-facing prose', () => {
    const result = new PlanningRegisterLeakValidator().validate({
      story: {
        id: 'story',
        title: 'Story',
        episodes: [
          {
            id: 'ep1',
            number: 1,
            title: 'Ep 1',
            synopsis: '',
            startingSceneId: 's1',
            scenes: [
              {
                id: 's1',
                name: 'Scene',
                startingBeatId: 'b1',
                beats: [
                  { id: 'b1', text: 'Plant INFO-C here instead of writing player-facing prose.' },
                  { id: 'b2', text: 'The Information Ledger says this reveal belongs later.' },
                ],
              },
            ],
          },
        ],
      } as any,
    });

    expect(result.findings.map((finding) => finding.pattern)).toEqual(
      expect.arrayContaining(['Raw INFO token', 'Information ledger label']),
    );
  });

  it('does not flag ordinary information prose as a raw INFO token', () => {
    const result = new PlanningRegisterLeakValidator().validate({
      story: {
        id: 'story',
        title: 'Story',
        episodes: [
          {
            id: 'ep1',
            number: 1,
            title: 'Ep 1',
            synopsis: '',
            startingSceneId: 's1',
            scenes: [
              {
                id: 's1',
                name: 'Scene',
                startingBeatId: 'b1',
                beats: [],
                encounter: {
                  phases: [
                    {
                      beats: [
                        {
                          choices: [
                            {
                              consequenceDomain: 'information',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                  storyboard: {
                    spine: [
                      {
                        tacticalFunction:
                          'Player choice can change position, leverage, information, exposure, relationship pressure, resource state, clocks, cost, or storylet outcome.',
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      } as any,
    });

    expect(result.findings).toHaveLength(0);
  });
});
