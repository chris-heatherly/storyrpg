import { describe, expect, it } from 'vitest';
import type { Story } from '../types';
import { enrichStoryGraphWithChoiceSystems } from './choiceSystemAnalyzer';
import { layoutGraph } from './layoutEngine';
import { expandStoryGraphResidue } from './residueGraphExpander';
import { transformStoryToGraph } from './storyGraphTransformer';

function expand(story: Story) {
  return expandStoryGraphResidue(story, enrichStoryGraphWithChoiceSystems(story, transformStoryToGraph(story)));
}

function makeResidueStory(): Story {
  return {
    id: 'story-1',
    metadata: { id: 'story-1', title: 'Test', genre: 'fantasy' } as any,
    title: 'Test',
    genre: 'fantasy',
    synopsis: '',
    npcs: [],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        synopsis: '',
        scenes: [
          {
            id: 'scene-a',
            title: 'Scene A',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'Choose.',
                choices: [
                  {
                    id: 'choice-tint',
                    text: 'Show mercy',
                    nextBeatId: 'beat-2',
                    tintFlag: 'tint:mercy',
                    consequenceTier: 'branchlet',
                    memorableMoment: { id: 'spared-herald', summary: 'You spared the herald.' },
                  },
                  {
                    id: 'choice-flag-tint',
                    text: 'Name justice',
                    consequences: [{ type: 'setFlag', flag: 'tint:justice', value: true }],
                  },
                ],
              } as any,
              {
                id: 'beat-2',
                text: 'After.',
                callbackHookIds: ['spared-herald'],
                textVariants: [
                  {
                    condition: { type: 'flag', flag: 'tint:mercy', value: true },
                    text: 'The room softens.',
                    callbackHookId: 'spared-herald',
                  },
                ],
              } as any,
            ],
          } as any,
        ],
      } as any,
    ],
  } as any;
}

function makeStoryletStory(): Story {
  return {
    id: 'story-2',
    metadata: { id: 'story-2', title: 'Test', genre: 'fantasy' } as any,
    title: 'Test',
    genre: 'fantasy',
    synopsis: '',
    npcs: [],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        synopsis: '',
        scenes: [
          {
            id: 'encounter-scene',
            title: 'Encounter',
            startingBeatId: 'unused',
            beats: [],
            encounter: {
              id: 'enc-1',
              type: 'social',
              name: 'Trial',
              description: 'A trial.',
              goalClock: {} as any,
              threatClock: {} as any,
              stakes: { victory: 'Win', defeat: 'Lose' },
              startingPhaseId: 'phase-1',
              phases: [
                {
                  id: 'phase-1',
                  name: 'Face them',
                  description: 'Face them.',
                  beats: [],
                  successThreshold: 2,
                  failureThreshold: 0,
                },
              ],
              outcomes: {
                victory: { nextSceneId: 'scene-end', outcomeText: 'Won.' },
              },
              storylets: {
                victory: {
                  id: 'storylet-victory',
                  name: 'After Victory',
                  triggerOutcome: 'victory',
                  tone: 'relieved',
                  narrativeFunction: 'Show aftermath.',
                  startingBeatId: 'sbeat-1',
                  nextSceneId: 'scene-end',
                  consequences: [],
                  beats: [
                    { id: 'sbeat-1', text: 'Breath returns.' },
                    { id: 'sbeat-2', text: 'You move on.', isTerminal: true },
                  ],
                },
              },
            },
          } as any,
          {
            id: 'scene-end',
            title: 'End',
            startingBeatId: 'end-1',
            beats: [{ id: 'end-1', text: 'End.' } as any],
          } as any,
        ],
      } as any,
    ],
  } as any;
}

function makeEncounterChoiceStory(): Story {
  return {
    id: 'story-encounter-choice',
    metadata: { id: 'story-encounter-choice', title: 'Test', genre: 'fantasy' } as any,
    title: 'Test',
    genre: 'fantasy',
    synopsis: '',
    npcs: [],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        synopsis: '',
        scenes: [
          {
            id: 'encounter-scene',
            title: 'Encounter',
            startingBeatId: 'unused',
            beats: [],
            encounter: {
              id: 'enc-1',
              type: 'social',
              name: 'Trial',
              description: 'A trial.',
              goalClock: {} as any,
              threatClock: {} as any,
              stakes: { victory: 'Win', defeat: 'Lose' },
              startingPhaseId: 'phase-1',
              phases: [
                {
                  id: 'phase-1',
                  name: 'Face them',
                  description: 'Face them.',
                  situationImage: 'phase.png',
                  beats: [
                    {
                      id: 'enc-beat-1',
                      setupText: 'Stand in the center.',
                      situationImage: 'setup.png',
                      choices: [
                        {
                          id: 'choice-1',
                          text: 'Hold the line',
                          outcomes: {
                            success: { narrativeText: 'You win.', encounterOutcome: 'victory' },
                            failure: { narrativeText: 'You lose.', encounterOutcome: 'defeat' },
                          },
                        },
                        {
                          id: 'choice-2',
                          text: 'Read the room',
                          outcomes: {
                            success: { narrativeText: 'You also win.', encounterOutcome: 'victory' },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
              outcomes: {
                victory: { nextSceneId: 'scene-end', outcomeText: 'Won.' },
                defeat: { nextSceneId: 'scene-end', outcomeText: 'Lost.' },
              },
              storylets: {
                victory: {
                  id: 'storylet-victory',
                  startingBeatId: 'sbeat-victory',
                  nextSceneId: 'scene-end',
                  beats: [{ id: 'sbeat-victory', text: 'Victory aftermath.', isTerminal: true }],
                },
                defeat: {
                  id: 'storylet-defeat',
                  startingBeatId: 'sbeat-defeat',
                  nextSceneId: 'scene-end',
                  beats: [{ id: 'sbeat-defeat', text: 'Defeat aftermath.', isTerminal: true }],
                },
              },
            },
          } as any,
          {
            id: 'scene-end',
            title: 'End',
            startingBeatId: 'end-1',
            beats: [{ id: 'end-1', text: 'End.' } as any],
          } as any,
        ],
      } as any,
    ],
  } as any;
}

function makeCrossSceneMergeStory(): Story {
  return {
    id: 'story-cross-scene-merge',
    metadata: { id: 'story-cross-scene-merge', title: 'Test', genre: 'fantasy' } as any,
    title: 'Test',
    genre: 'fantasy',
    synopsis: '',
    npcs: [],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        synopsis: '',
        scenes: [
          {
            id: 'scene-1',
            title: 'Scene 1',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'Choose.',
                choices: [
                  { id: 'left', text: 'Left', nextBeatId: 'beat-7' },
                  { id: 'middle', text: 'Middle', nextBeatId: 'beat-8' },
                  { id: 'right', text: 'Right', nextBeatId: 'beat-9' },
                ],
              },
              { id: 'beat-7', text: 'Left path.', nextSceneId: 'scene-2' },
              { id: 'beat-8', text: 'Middle path.', nextSceneId: 'scene-2' },
              { id: 'beat-9', text: 'Right path.', nextSceneId: 'scene-2' },
            ],
          } as any,
          {
            id: 'scene-2',
            title: 'Scene 2',
            startingBeatId: 'beat-1',
            beats: [
              { id: 'beat-1', text: 'Merged.' },
              { id: 'beat-2', text: 'Continue.' },
            ],
          } as any,
        ],
      } as any,
    ],
  } as any;
}

function makeSinglePathIntoEncounterStory(): Story {
  const story = makeEncounterChoiceStory();
  story.id = 'story-single-path-encounter';
  (story as any).metadata.id = 'story-single-path-encounter';
  story.episodes[0].scenes.unshift({
    id: 'intro-scene',
    title: 'Intro',
    startingBeatId: 'intro-1',
    beats: [
      { id: 'intro-1', text: 'The trail leads onward.', nextSceneId: 'encounter-scene' },
    ],
  } as any);
  return story;
}

describe('residueGraphExpander', () => {
  it('creates tint source and tint payoff nodes and links matching flags', () => {
    const graph = expand(makeResidueStory());

    expect(graph.nodes.some((node) => node.type === 'tint' && node.synthetic?.flag === 'tint:mercy')).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'tint' && node.synthetic?.flag === 'tint:justice')).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'tint-payoff' && node.synthetic?.flag === 'tint:mercy')).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'tint-payoff' && edge.synthetic?.flag === 'tint:mercy')).toBe(true);
  });

  it('creates branchlet nodes from branchlet-tier choices and routes to nextBeatId', () => {
    const graph = expand(makeResidueStory());
    const branchlet = graph.nodes.find((node) => node.type === 'branchlet');

    expect(branchlet?.synthetic?.sourceChoiceId).toBe('choice-tint');
    expect(branchlet?.synthetic?.targetBeatId).toBe('beat-2');
    expect(graph.edges.some((edge) => edge.type === 'branchlet' && edge.source === branchlet?.id)).toBe(true);
  });

  it('ignores malformed legacy tint consequences without crashing', () => {
    const story = makeResidueStory();
    const firstChoice = story.episodes[0].scenes[0].beats[0].choices?.[0] as any;
    firstChoice.consequences = [
      { type: 'setFlag', value: true },
      { type: 'setFlag', flag: 'tint:mercy', value: true },
    ];

    const graph = expand(story);

    expect(graph.nodes.some((node) => node.type === 'tint' && node.synthetic?.flag === 'tint:mercy')).toBe(true);
  });

  it('creates callback source/payoff nodes and only links matching hook ids', () => {
    const graph = expand(makeResidueStory());

    const source = graph.nodes.find((node) => node.type === 'callback-source');
    const payoff = graph.nodes.find((node) => node.type === 'callback-payoff');

    expect(source?.synthetic?.hookId).toBe('spared-herald');
    expect(payoff?.synthetic?.hookId).toBe('spared-herald');
    expect(graph.edges.some((edge) => (
      edge.type === 'callback' &&
      edge.source === source?.id &&
      edge.target === payoff?.id &&
      edge.synthetic?.hookId === 'spared-herald'
    ))).toBe(true);
  });

  it('creates storylet beat nodes with terminal route to next scene', () => {
    const graph = expand(makeStoryletStory());

    const phase = graph.nodes.find((node) => node.type === 'phase');
    const storyletBeats = graph.nodes.filter((node) => node.type === 'storylet-beat');
    const endSceneNode = graph.nodes.find((node) => node.sceneId === 'scene-end' && node.type === 'beat');

    expect(storyletBeats).toHaveLength(2);
    expect(storyletBeats[0].synthetic?.outcome).toBeUndefined();
    expect(graph.edges.some((edge) => edge.source === phase?.id && edge.target === storyletBeats[0].id)).toBe(true);
    expect(graph.edges.some((edge) => edge.source === storyletBeats[1].id && edge.target === endSceneNode?.id)).toBe(true);
  });

  it('routes encounter choices through roll outcomes before storylet aftermath beats', () => {
    const graph = expand(makeEncounterChoiceStory());

    const phase = graph.nodes.find((node) => node.type === 'phase');
    const choice = graph.nodes.find((node) => node.type === 'encounter-choice');
    const victoryBeat = graph.nodes.find((node) => node.type === 'storylet-beat' && node.fullText === 'Victory aftermath.');
    const defeatBeat = graph.nodes.find((node) => node.type === 'storylet-beat' && node.fullText === 'Defeat aftermath.');
    const endSceneNode = graph.nodes.find((node) => node.sceneId === 'scene-end' && node.type === 'beat');

    expect(phase?.image).toBe('setup.png');
    expect(choice?.label).toBe('Hold the line');
    expect(graph.edges.some((edge) => edge.source === phase?.id && edge.target === choice?.id && edge.label === '')).toBe(true);
    expect(graph.nodes.some((node) => node.synthetic?.kind === 'encounter-outcome')).toBe(false);
    expect(graph.edges.some((edge) => edge.source === choice?.id && edge.target === endSceneNode?.id && edge.synthetic?.outcome === 'victory')).toBe(true);
    expect(graph.edges.some((edge) => edge.source === choice?.id && edge.target === endSceneNode?.id && edge.synthetic?.outcome === 'defeat')).toBe(true);
    expect(graph.edges.some((edge) => edge.source === choice?.id && edge.target === victoryBeat?.id && edge.synthetic?.outcome === 'victory')).toBe(true);
    expect(graph.edges.some((edge) => edge.source === choice?.id && edge.target === defeatBeat?.id && edge.synthetic?.outcome === 'defeat')).toBe(true);
  });

  it('renders terminal encounter outcomes as labeled edges instead of faux nodes', () => {
    const graph = expand(makeEncounterChoiceStory());

    const outcomeNodes = graph.nodes.filter((node) => node.synthetic?.kind === 'encounter-outcome');
    const victoryEdges = graph.edges.filter((edge) => edge.synthetic?.kind === 'encounter-outcome' && edge.synthetic.outcome === 'victory');

    expect(outcomeNodes).toHaveLength(0);
    expect(victoryEdges.length).toBeGreaterThanOrEqual(2);
    expect(victoryEdges.every((edge) => edge.label === 'VICTORY')).toBe(true);
  });

  it('renders follow-up encounter outcomes as labeled edges instead of faux nodes', () => {
    const story = makeEncounterChoiceStory();
    const firstChoice = (story.episodes[0].scenes[0].encounter as any).phases[0].beats[0].choices[0];
    firstChoice.outcomes.success = {
      narrativeText: 'You find a better angle.',
      nextSituation: {
        setupText: 'The room recalibrates around you.',
        situationImage: 'followup.png',
        choices: [
          {
            id: 'follow-through',
            text: 'Press the advantage',
            outcomes: {
              success: { narrativeText: 'The room yields.', encounterOutcome: 'victory' },
            },
          },
        ],
      },
    };
    const graph = expand(story);

    const choice = graph.nodes.find((node) => node.type === 'encounter-choice' && node.synthetic?.sourceChoiceId === 'choice-1');
    const followUp = graph.nodes.find((node) => node.type === 'encounter-situation' && node.fullText === 'The room recalibrates around you.');
    const outcomeEdge = graph.edges.find((edge) => edge.source === choice?.id && edge.target === followUp?.id);

    expect(graph.nodes.some((node) => node.synthetic?.kind === 'encounter-outcome')).toBe(false);
    expect(outcomeEdge?.label).toBe('Success');
    expect(outcomeEdge?.synthetic?.kind).toBe('encounter-outcome');
    expect(outcomeEdge?.synthetic?.tier).toBe('success');
  });

  it('routes storylet aftermath from labeled outcome edges without outcome nodes', () => {
    const graph = layoutGraph(expand(makeEncounterChoiceStory()));

    const victorySourceEdge = graph.edges.find((edge) => edge.synthetic?.outcome === 'victory' && graph.nodes.find((node) => node.id === edge.target)?.type === 'storylet-beat');
    const victoryBeat = graph.nodes.find((node) => node.type === 'storylet-beat' && node.fullText === 'Victory aftermath.');
    const defeatSourceEdge = graph.edges.find((edge) => edge.synthetic?.outcome === 'defeat' && graph.nodes.find((node) => node.id === edge.target)?.type === 'storylet-beat');
    const defeatBeat = graph.nodes.find((node) => node.type === 'storylet-beat' && node.fullText === 'Defeat aftermath.');

    expect(graph.nodes.some((node) => node.synthetic?.kind === 'encounter-outcome')).toBe(false);
    expect(victorySourceEdge?.target).toBe(victoryBeat?.id);
    expect(defeatSourceEdge?.target).toBe(defeatBeat?.id);
  });

  it('centers a new scene entry under the branch path that represents the merge center', () => {
    const graph = layoutGraph(expand(makeCrossSceneMergeStory()));
    const middleBranch = graph.nodes.find((node) => node.sceneId === 'scene-1' && node.fullText === 'Middle path.');
    const sceneEntry = graph.nodes.find((node) => node.sceneId === 'scene-2' && node.fullText === 'Merged.');

    const center = (node: NonNullable<typeof middleBranch>) => node.x + node.width / 2;

    expect(Math.abs(center(sceneEntry!) - center(middleBranch!))).toBeLessThan(1);
  });

  it('keeps a single-path encounter entry under the previous story beat', () => {
    const graph = layoutGraph(expand(makeSinglePathIntoEncounterStory()));
    const introBeat = graph.nodes.find((node) => node.sceneId === 'intro-scene' && node.fullText === 'The trail leads onward.');
    const phase = graph.nodes.find((node) => node.sceneId === 'encounter-scene' && node.type === 'phase');

    const center = (node: NonNullable<typeof introBeat>) => node.x + node.width / 2;

    expect(Math.abs(center(phase!) - center(introBeat!))).toBeLessThan(1);
  });

  it('clusters encounter choice chips under their source situation', () => {
    const graph = layoutGraph(expand(makeEncounterChoiceStory()));

    const phase = graph.nodes.find((node) => node.type === 'phase');
    const choices = graph.edges
      .filter((edge) => edge.source === phase?.id)
      .map((edge) => graph.nodes.find((node) => node.id === edge.target))
      .filter((node): node is NonNullable<typeof node> => node?.type === 'encounter-choice');

    const phaseCenter = phase ? phase.x + phase.width / 2 : 0;
    const averageChoiceCenter = choices.reduce((sum, choice) => sum + choice.x + choice.width / 2, 0) / choices.length;

    expect(choices.length).toBeGreaterThan(1);
    expect(Math.abs(averageChoiceCenter - phaseCenter)).toBeLessThan(1);
  });
});
