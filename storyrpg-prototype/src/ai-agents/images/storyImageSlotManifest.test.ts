import { describe, expect, it } from 'vitest';

import {
  buildStoryImageSlotManifest,
  collectMissingStoryImageSlotsFromManifest,
  storyBeatBaseIdentifier,
  storySceneBaseIdentifier,
} from './storyImageSlotManifest';

describe('storyImageSlotManifest', () => {
  it('builds stable scene and beat identifiers', () => {
    expect(storySceneBaseIdentifier('episode-1::scene-2')).toBe('scene-episode-1scene-2-bg');
    expect(storyBeatBaseIdentifier('episode-1::scene-2', 'beat-7')).toBe('beat-episode-1scene-2-beat-7');
  });

  it('creates one scene slot plus one slot per beat', () => {
    const manifest = buildStoryImageSlotManifest(
      {
        sceneId: 'scene-1',
        startingBeatId: 'beat-1',
        beats: [
          { id: 'beat-1', text: 'A' } as any,
          { id: 'beat-2', text: 'B' } as any,
        ],
      },
      'episode-1::scene-1',
    );

    expect(manifest.slots.map((slot) => slot.slotId)).toEqual([
      'story-scene:episode-1::scene-1',
      'story-beat:episode-1::scene-1::beat-1',
      'story-beat:episode-1::scene-1::beat-2',
    ]);
  });

  it('scopes slot IDs by episode so scene IDs reused across episodes do not collide', () => {
    const ep1 = buildStoryImageSlotManifest(
      {
        sceneId: 'scene-1',
        startingBeatId: 'beat-1',
        beats: [{ id: 'beat-1', text: 'A' } as any],
      },
      'episode-1-scene-1',
    );
    const ep2 = buildStoryImageSlotManifest(
      {
        sceneId: 'scene-1',
        startingBeatId: 'beat-1',
        beats: [{ id: 'beat-1', text: 'A' } as any],
      },
      'episode-2-scene-1',
    );

    const ep1Ids = new Set(ep1.slots.map((s) => s.slotId));
    const ep2Ids = new Set(ep2.slots.map((s) => s.slotId));
    for (const id of ep2Ids) {
      expect(ep1Ids.has(id)).toBe(false);
    }
  });

  it('reports missing beat and scene coverage from the pipeline maps', () => {
    const manifest = buildStoryImageSlotManifest(
      {
        sceneId: 'scene-1',
        startingBeatId: 'beat-1',
        beats: [{ id: 'beat-1', text: 'A' } as any],
      },
      'episode-1::scene-1',
    );

    expect(
      collectMissingStoryImageSlotsFromManifest(
        manifest,
        new Map([['episode-1::scene-1::beat-1', 'http://beat-1']]),
        new Map(),
      ),
    ).toEqual([]);

    const missing = collectMissingStoryImageSlotsFromManifest(
      manifest,
      new Map(),
      new Map(),
    );
    expect(missing).toEqual(['scene:scene-1', 'beat:scene-1::beat-1']);
  });
});
