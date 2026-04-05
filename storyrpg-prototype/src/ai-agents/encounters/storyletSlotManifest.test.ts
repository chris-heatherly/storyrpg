import { describe, expect, it } from 'vitest';

import {
  buildStoryletSlotManifest,
  collectMissingStoryletSlotsFromManifest,
  storyletAggressiveRetryIdentifier,
  storyletBaseIdentifier,
  storyletCoverageKey,
  storyletRetryIdentifier,
} from './storyletSlotManifest';

describe('storyletSlotManifest', () => {
  it('builds stable storylet identifiers', () => {
    expect(storyletBaseIdentifier('episode-1-scene-3', 'victory', 'beat-1'))
      .toBe('storylet-episode-1-scene-3-victory-beat-1');
    expect(storyletRetryIdentifier('episode-1-scene-3', 'victory', 'beat-1'))
      .toBe('storylet-episode-1-scene-3-victory-beat-1-retry');
    expect(storyletAggressiveRetryIdentifier('episode-1-scene-3', 'victory', 'beat-1', 1))
      .toBe('storylet-episode-1-scene-3-victory-beat-1-retry2-1');
    expect(storyletCoverageKey('scene-3', 'victory', 'beat-1'))
      .toBe('storylet:scene-3::victory::beat-1');
  });

  it('emits all storylet beats as slots with generation context', () => {
    const manifest = buildStoryletSlotManifest({
      victory: { beats: [{ id: 'v1', text: 'win text' }, { id: 'v2', text: 'win text 2' }], tone: 'triumphant' },
      defeat: { beats: [{ id: 'd1', text: 'loss text' }], tone: 'desperate', cost: { visibleComplication: 'wound' } },
    }, 'scene-3', 'episode-1-scene-3');

    expect(manifest.slots.map(slot => `${slot.outcomeName}:${slot.beatId}`)).toEqual([
      'victory:v1',
      'victory:v2',
      'defeat:d1',
    ]);
    expect(manifest.slots[0].storyletTone).toBe('triumphant');
    expect(manifest.slots[0].beat.text).toBe('win text');
    expect(manifest.slots[2].storyletTone).toBe('desperate');
    expect(manifest.slots[2].storyletCost).toEqual({ visibleComplication: 'wound' });
  });

  it('collects missing coverage keys from scene storylet images', () => {
    const manifest = buildStoryletSlotManifest({
      victory: { beats: [{ id: 'v1' }, { id: 'v2' }], tone: 'triumphant' },
      partialVictory: { beats: [{ id: 'p1' }], tone: 'bittersweet' },
    }, 'scene-3', 'episode-1-scene-3');

    const sceneStoryletImages = new Map<string, Map<string, string>>([
      ['victory', new Map([['v1', 'ok']])],
    ]);

    expect(collectMissingStoryletSlotsFromManifest(manifest, sceneStoryletImages)).toEqual([
      'storylet:scene-3::victory::v2',
      'storylet:scene-3::partialVictory::p1',
    ]);
  });
});
