import { describe, it, expect } from 'vitest';
import { buildEpisodeGraph } from './episodeGraphBuilder';
import type { Story, VisitRecord } from '../types';

function makeStory(): Story {
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
                text: 'Beat 1',
                choices: [
                  { id: 'choice-1', text: 'Go left' } as any,
                  { id: 'choice-2', text: 'Go right' } as any,
                ],
              } as any,
              { id: 'beat-2', text: 'Beat 2' } as any,
            ],
          } as any,
          {
            id: 'scene-b',
            title: 'Scene B',
            startingBeatId: 'beat-b1',
            beats: [{ id: 'beat-b1', text: 'Unvisited beat' } as any],
          } as any,
        ],
      } as any,
    ],
  } as any;
}

describe('episodeGraphBuilder', () => {
  it('marks visited beats as taken and unvisited scenes as skipped', () => {
    const story = makeStory();
    const log: VisitRecord[] = [
      { episodeId: 'ep-1', sceneId: 'scene-a', beatId: 'beat-1', visitedAt: 1 },
      { episodeId: 'ep-1', sceneId: 'scene-a', beatId: 'beat-2', visitedAt: 2 },
    ];

    const graph = buildEpisodeGraph(story, 'ep-1', log);

    expect(graph.episodeId).toBe('ep-1');
    expect(graph.metrics.uniqueScenesVisited).toBe(1);

    const sceneBSkipped = graph.nodes.some(
      (n) => n.sceneId === 'scene-b' && n.visitState === 'skipped',
    );
    expect(sceneBSkipped).toBe(true);
  });

  it('counts committed choices', () => {
    const story = makeStory();
    const log: VisitRecord[] = [
      {
        episodeId: 'ep-1',
        sceneId: 'scene-a',
        beatId: 'beat-1',
        choiceId: 'choice-1',
        visitedAt: 1,
      },
    ];
    const graph = buildEpisodeGraph(story, 'ep-1', log);
    expect(graph.metrics.committedChoices).toBe(1);
  });

  it('filters to the requested episode only', () => {
    const story = makeStory();
    // Add a second episode
    story.episodes.push({
      id: 'ep-2',
      number: 2,
      title: 'Episode 2',
      synopsis: '',
      scenes: [
        {
          id: 'scene-x',
          title: 'X',
          startingBeatId: 'beat-x1',
          beats: [{ id: 'beat-x1', text: 'x' } as any],
        } as any,
      ],
    } as any);

    const graph = buildEpisodeGraph(story, 'ep-1', []);
    const ep2Nodes = graph.nodes.filter((n) => n.episodeId === 'ep-2');
    expect(ep2Nodes.length).toBe(0);
  });
});
