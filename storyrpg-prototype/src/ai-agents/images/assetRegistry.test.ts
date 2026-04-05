import { describe, expect, it } from 'vitest';

import { AssetRegistry } from './assetRegistry';
import type { ImageSlot } from './slotTypes';

const beatSlot: ImageSlot = {
  slotId: 'story-beat:scene-1::beat-1',
  family: 'story-beat',
  imageType: 'beat',
  sceneId: 'scene-1',
  scopedSceneId: 'episode-1::scene-1',
  beatId: 'beat-1',
  storyFieldPath: 'episodes[].scenes[id=scene-1].beats[id=beat-1].image',
  baseIdentifier: 'beat-episode-1scene-1-beat-1',
  required: true,
  qualityTier: 'standard',
  coverageKey: 'beat:scene-1::beat-1',
};

describe('AssetRegistry', () => {
  it('tracks planned slots and successful renders', () => {
    const registry = new AssetRegistry('story-1');
    registry.planSlot(beatSlot);
    registry.markRendering(beatSlot.slotId, {
      attemptNumber: 1,
      startedAt: new Date().toISOString(),
      retryStage: 'primary',
    });
    registry.markSuccess(beatSlot.slotId, {
      prompt: { prompt: 'hello world' },
      imageUrl: 'http://image',
      imagePath: '/tmp/image.jpg',
      metadata: { provider: 'nano-banana', model: 'test-model' },
    });

    const record = registry.getResolvedAsset(beatSlot.slotId);
    expect(record?.latestUrl).toBe('http://image');
    expect(record?.status).toBe('succeeded');
    expect(record?.attempts).toHaveLength(1);
    expect(record?.attempts[0].status).toBe('succeeded');
  });

  it('reports unresolved required slots', () => {
    const registry = new AssetRegistry();
    registry.planSlot(beatSlot);
    registry.markRendering(beatSlot.slotId, {
      attemptNumber: 1,
      startedAt: new Date().toISOString(),
      retryStage: 'primary',
    });
    registry.markFailure(beatSlot.slotId, 'failed_transient', 'timeout', { errorClass: 'transient' });

    const missing = registry.getMissingRequiredSlots();
    expect(missing).toHaveLength(1);
    expect(missing[0].slot.slotId).toBe(beatSlot.slotId);
  });
});
