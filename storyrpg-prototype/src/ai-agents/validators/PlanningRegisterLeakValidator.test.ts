import { describe, expect, it } from 'vitest';

import { PlanningRegisterLeakValidator } from './PlanningRegisterLeakValidator';

describe('PlanningRegisterLeakValidator information-ledger leakage', () => {
  it('flags treatment-card thesis prose and SceneWriter fallback scaffolding', () => {
    const treatmentCard =
      "A FaceTime gag that quietly seeds everything — Sadie asks *are there vampires in Romania?* and Kylie answers *only the boys I'm going to date, baby.* First strong image: the gold chain catching the last sun through a Belle Époque window; promise of reinvention and glamour; the joke is the season's thesis in disguise.";
    const treatmentShard =
      "Kylie's ordinary world is reinvention-as-performance. Her grandmother's address. Protects herself the way she always has — by observing.";
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
                name: 'Decide how to handle setup scene 1',
                description: treatmentCard,
                dramaticQuestion: treatmentCard,
                turnContract: {
                  centralTurn: 'Decide how to handle setup scene 1.',
                  turnEvent: 'Decide how to handle setup scene 1.',
                  pressurePeak: 'Decide how to handle setup scene 1.',
                },
                startingBeatId: 'b1',
                beats: [
                  {
                    id: 'b1',
                    text: `${treatmentCard} ${treatmentShard} Development scene 5.`,
                    visualMoment: treatmentCard,
                    primaryAction: 'the scene pressure sharpens into a visible turning point',
                  },
                  {
                    id: 'b2',
                    text: 'Kylie lowers the phone and looks at the gold chain.',
                    primaryAction: "Kylie changes the room's leverage through a visible body-language cue",
                    emotionalRead: 'Her hands, gaze, and distance reveal the beat beneath the words.',
                    relationshipDynamic: 'the protagonist carries the consequence forward before the next scene begins',
                    sequenceIntent: {
                      objective: 'Hand the changed state into the next scene.',
                      obstacle: 'the story must earn the next scene before it begins',
                    },
                    routeContext: {
                      choiceSummary: 'The selected route changes the next scene.',
                    },
                    choices: [
                      {
                        id: 'c1',
                        text: 'Take the side entrance.',
                        feedbackCue: { echoSummary: 'The selected route changes the next scene.' },
                        residueHints: [{
                          description: 'Kylie will begin the next scene already out in the city, changing the context of the encounter.',
                        }],
                        designNotes: 'Resolve the encounter into a clear consequence, aftermath beat, or next-scene pressure.',
                        reminderPlan: {
                          immediate: 'The selected route changes the next scene.',
                          shortTerm: 'PEAK: Later narration remembers which path the player chose.',
                          later: 'Let the public attention pressure the next scene without restaging the writing moment.',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      } as any,
    });

    expect(result.findings.map((finding) => finding.pattern)).toEqual(
      expect.arrayContaining([
        'Treatment gag thesis card',
        'Treatment first-strong-image label',
        'Treatment thesis disguise note',
        'Treatment ordinary-world card',
        'Treatment grandmother-address fragment',
        'Treatment protection-strategy card',
        'Treatment reinvention-as-performance shard',
        'Decide how to handle',
        'Development-scene planning stub',
        'Structural peak label',
        'Scene pressure fallback',
        'Room leverage fallback',
        'Beat beneath words fallback',
        'Selected route scene-change fallback',
        'Path player chose fallback',
        'Next-scene consequence directive',
        'Next-scene pressure fallback',
        'Attention pressures next scene fallback',
        'Changed state into next scene fallback',
        'Protagonist next-scene bridge',
        'Story earn next scene bridge',
      ]),
    );
  });

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
