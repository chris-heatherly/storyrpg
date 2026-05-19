import { describe, expect, it } from 'vitest';

import { AssetRegistry } from './assetRegistry';
import { assembleStoryAssetsFromRegistry } from './storyAssetAssembler';
import type { Story } from '../../types';

describe('assembleStoryAssetsFromRegistry', () => {
  it('normalizes encounter-only scenes so reader entry has a beat id', () => {
    const story = {
      id: 'story-1',
      title: 'Story',
      genre: 'test',
      synopsis: '',
      episodes: [{
        id: 'ep-1',
        number: 1,
        title: 'Episode',
        synopsis: '',
        startingSceneId: 'scene-encounter',
        scenes: [{
          id: 'scene-encounter',
          name: 'Encounter',
          startingBeatId: '',
          beats: [],
          encounter: {
            id: 'enc-1',
            phases: [{
              id: 'phase-1',
              beats: [{ id: 'enc-beat-1', setupText: 'Pressure rises.', choices: [] }],
            }],
          },
        }],
      }],
      initialState: {},
    } as unknown as Story;

    const assembled = assembleStoryAssetsFromRegistry(story, new AssetRegistry('story-1'));

    expect(assembled.episodes[0].scenes[0].startingBeatId).toBe('enc-beat-1');
    expect(story.episodes[0].scenes[0].startingBeatId).toBe('');
  });
});
