import { describe, it, expect } from 'vitest';
import { replayToBeat, rewindToBeat } from './rewindEngine';
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
                onShow: [{ type: 'setFlag', flag: 'visited-1', value: true } as any],
                choices: [
                  {
                    id: 'choice-pick',
                    text: 'Take the coin',
                    consequences: [{ type: 'addTag', tag: 'greedy' } as any],
                  } as any,
                ],
              } as any,
              { id: 'beat-2', text: 'Beat 2' } as any,
            ],
          } as any,
        ],
      } as any,
    ],
  } as any;
}

describe('rewindEngine', () => {
  it('replays onShow consequences from visits', () => {
    const story = makeStory();
    const log: VisitRecord[] = [
      { episodeId: 'ep-1', sceneId: 'scene-a', beatId: 'beat-1', visitedAt: 1 },
      { episodeId: 'ep-1', sceneId: 'scene-a', beatId: 'beat-2', visitedAt: 2 },
    ];
    const result = replayToBeat(story, log, 2);
    expect(result.applied).toBe(2);
    expect(result.player.flags['visited-1']).toBe(true);
    expect(result.truncatedLog.length).toBe(2);
  });

  it('replays committed choice consequences', () => {
    const story = makeStory();
    const log: VisitRecord[] = [
      {
        episodeId: 'ep-1',
        sceneId: 'scene-a',
        beatId: 'beat-1',
        choiceId: 'choice-pick',
        visitedAt: 1,
      },
    ];
    const result = replayToBeat(story, log, 1);
    expect(result.player.tags.has('greedy')).toBe(true);
  });

  it('rewindToBeat returns null when target not in log', () => {
    const story = makeStory();
    const log: VisitRecord[] = [];
    const result = rewindToBeat(story, log, {
      episodeId: 'ep-1',
      sceneId: 'scene-a',
      beatId: 'beat-1',
    });
    expect(result).toBeNull();
  });

  it('rewindToBeat stops before target so user can re-pick', () => {
    const story = makeStory();
    const log: VisitRecord[] = [
      {
        episodeId: 'ep-1',
        sceneId: 'scene-a',
        beatId: 'beat-1',
        choiceId: 'choice-pick',
        visitedAt: 1,
      },
      { episodeId: 'ep-1', sceneId: 'scene-a', beatId: 'beat-2', visitedAt: 2 },
    ];
    const result = rewindToBeat(story, log, {
      episodeId: 'ep-1',
      sceneId: 'scene-a',
      beatId: 'beat-1',
    });
    expect(result).not.toBeNull();
    expect(result!.applied).toBe(0);
    expect(result!.player.tags.has('greedy')).toBe(false);
  });

  it('is idempotent — replaying the same log twice gives equivalent state', () => {
    const story = makeStory();
    const log: VisitRecord[] = [
      {
        episodeId: 'ep-1',
        sceneId: 'scene-a',
        beatId: 'beat-1',
        choiceId: 'choice-pick',
        visitedAt: 1,
      },
    ];
    const a = replayToBeat(story, log, 1);
    const b = replayToBeat(story, log, 1);
    expect(a.player.tags.has('greedy')).toBe(b.player.tags.has('greedy'));
    expect(a.player.flags['visited-1']).toBe(b.player.flags['visited-1']);
  });
});
