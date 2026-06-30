import { describe, expect, it } from 'vitest';

import { PlanningRegisterLeakValidator } from './PlanningRegisterLeakValidator';

describe('PlanningRegisterLeakValidator information-ledger leakage', () => {
  it('flags treatment-card thesis prose and SceneWriter fallback scaffolding', () => {
    const treatmentCard =
      "First strong image: the brass key catching the last sun through a station window; promise of reinvention and glamour; the joke is the season's thesis in disguise.";
    const treatmentShard =
      "Jordan's ordinary world is control-as-performance. Opening promise: the city rewards people who hide the truth.";
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
                    text: 'Jordan lowers the phone and looks at the brass key.',
                    primaryAction: "Jordan changes the room's leverage through a visible body-language cue",
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
                          description: 'Jordan will begin the next scene already out in the city, changing the context of the encounter.',
                        }],
                        designNotes: 'Resolve the encounter into a clear consequence, aftermath beat, or next-scene pressure.',
                        reminderPlan: {
                          immediate: 'The selected route changes the next scene.',
                          shortTerm: 'PEAK: Later narration remembers which path the player chose.',
                          later: 'Let the public attention pressure the next scene without restaging the writing moment.',
                        },
                      },
                      {
                        id: 'c2',
                        text: 'Stay in the apartment.',
                        feedbackCue: {
                          echoSummary: "The aftermath changes what characters say, hide, risk, or trust: By sunset, the apartment has stopped feeling like a room.",
                          progressSummary: 'The consequence stays visible through changed access, posture, information, or danger: the room stops being neutral.',
                        },
                        reminderPlan: {
                          later: 'Later pressure can return through trust, knowledge, access, or risk: the address stays on the table.',
                        },
                      },
                      {
                        id: 'c3',
                        text: 'Hold the secret.',
                        feedbackCue: {
                          echoSummary: 'The answer changes what can be safely said next, and what has to stay hidden a little longer.',
                          progressSummary: 'The aftermath stays visible in what characters offer, hide, risk, or refuse.',
                        },
                        reminderPlan: {
                          shortTerm: 'Later scenes should remember how this changed access, posture, information, risk, or trust.',
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
        'Treatment first-strong-image label',
        'Treatment thesis disguise note',
        'Treatment ordinary-world card',
        'Treatment opening-promise label',
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
        'Consequence mechanics summary',
        'Consequence visibility scaffold',
        'Later pressure mechanics scaffold',
        'Choice information mechanics scaffold',
        'Future scene residue instruction',
        'Generic aftermath visibility scaffold',
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

  it('flags generic Story Circle synopsis cards copied into reader prose', () => {
    const result = new PlanningRegisterLeakValidator().validate({
      story: {
        id: 'synthetic',
        title: 'Synthetic',
        episodes: [
          {
            id: 'ep1',
            number: 1,
            title: 'Episode',
            synopsis: '',
            startingSceneId: 's1',
            scenes: [
              {
                id: 's1-arrival-cold-open',
                name: 'Jordan arrives in the capital',
                startingBeatId: 'b1',
                beats: [
                  {
                    id: 'b1',
                    text: 'Jordan, a guarded engineer, arrives in the capital to start over, establishing their desire to be trusted and their fear of being known.',
                  },
                  {
                    id: 'b2',
                    text: 'The protagonist arrives in the capital as a charming observer with two suitcases and the intent to rebuild after a public failure.',
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
        'Story Circle desire/fear synopsis card',
        'Intent-to-rebuild synopsis card',
        'Third-person protagonist synopsis card',
        'Trait-appositive synopsis card',
      ]),
    );
  });

  it('flags generic fallback beat scaffolding copied into reader prose', () => {
    const result = new PlanningRegisterLeakValidator().validate({
      story: {
        id: 'synthetic',
        title: 'Synthetic',
        episodes: [
          {
            id: 'ep1',
            number: 1,
            title: 'Episode',
            synopsis: '',
            startingSceneId: 's1',
            scenes: [
              {
                id: 's1-1',
                name: 'Scene',
                startingBeatId: 'b1',
                beats: [
                  {
                    id: 'b1',
                    text: 'Choose how the protagonist responds to the room as the scene tint changes.',
                  },
                  {
                    id: 'b2',
                    text: 'The scene opens with pressure already mounting around Jordan Vale.',
                  },
                  {
                    id: 'b3',
                    text: 'Jordan Vale catches the first sign that this moment will demand a choice.',
                  },
                  {
                    id: 'b4',
                    text: 'A concrete detail changes the room, narrowing what Jordan Vale can safely ignore.',
                  },
                  {
                    id: 'b5',
                    text: 'The people nearby reveal new stakes without saying them plainly.',
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
        'Generic response choice scaffold',
        'Fallback pressure-opening scaffold',
        'Fallback choice-demand scaffold',
        'Fallback concrete-detail scaffold',
        'Fallback new-stakes scaffold',
      ]),
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
