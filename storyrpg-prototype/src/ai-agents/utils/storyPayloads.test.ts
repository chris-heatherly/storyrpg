import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import {
  sanitizePipelineResultForTransfer,
  sanitizeStoryForPersistence,
} from './storyPayloads';

function createStory(): Story {
  return {
    id: 'story-1',
    title: 'Test Story',
    genre: 'mystery',
    synopsis: 'A test story.',
    coverImage: 'data:image/png;base64,cover',
    initialState: {
      attributes: {
        charm: 1,
        wit: 2,
        courage: 3,
        empathy: 4,
        resolve: 5,
        resourcefulness: 6,
      },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [
      {
        id: 'npc-1',
        name: 'Guide',
        role: 'ally',
        description: 'Helpful',
        portrait: 'data:image/png;base64,npc',
      } as any,
    ],
    episodes: [
      {
        id: 'episode-1',
        number: 1,
        title: 'Episode 1',
        synopsis: 'Start',
        coverImage: 'data:image/png;base64,episode',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene 1',
            backgroundImage: 'data:image/png;base64,scene',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'Hello',
                image: {
                  imageUrl: 'generated-stories/story-1/beat-1.png',
                  imageData: 'inline-data',
                },
                encounterSequence: [
                  {
                    imageData: 'inline-sequence',
                    imageUrl: 'generated-stories/story-1/encounter-1.png',
                  },
                ],
                choices: [],
              } as any,
            ],
          },
        ],
      },
    ],
  };
}

describe('storyPayloads', () => {
  it('sanitizes stories for persistence without mutating the original', () => {
    const story = {
      ...createStory(),
      checkpoints: [{ phase: 'qa' }],
      agentWorkingFiles: [{ agent: 'StoryArchitect' }],
    } as Story & Record<string, unknown>;

    const sanitized = sanitizeStoryForPersistence(story);

    expect(story.coverImage).toBe('data:image/png;base64,cover');
    expect(sanitized.coverImage).toBe('');
    expect((sanitized as any).checkpoints).toBeUndefined();
    expect((sanitized as any).agentWorkingFiles).toBeUndefined();
    expect((sanitized.episodes[0].scenes[0].beats[0].image as any).imageData).toBeUndefined();
    expect(sanitized.npcs?.[0]?.portrait).toBe('');
  });

  it('trims transfer payloads and strips inline media from the story', () => {
    const result = {
      success: true,
      story: createStory(),
      events: Array.from({ length: 5 }, (_, index) => ({ id: index })),
      checkpoints: Array.from({ length: 4 }, (_, index) => ({ id: index })),
    };

    const sanitized = sanitizePipelineResultForTransfer(result, {
      maxEvents: 2,
      maxCheckpoints: 1,
    });

    expect(sanitized.events).toEqual([{ id: 3 }, { id: 4 }]);
    expect(sanitized.checkpoints).toEqual([{ id: 3 }]);
    expect(sanitized.story?.coverImage).toBe('');
    expect((sanitized.story?.episodes[0].scenes[0].beats[0].image as any).imageData).toBeUndefined();
    expect(((sanitized.story?.episodes[0].scenes[0].beats[0].encounterSequence as any)?.[0] as any).imageData).toBeUndefined();
  });
});
