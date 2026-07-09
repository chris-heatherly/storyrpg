import { describe, expect, it } from 'vitest';
import {
  buildEpisodeDraftCheckpoint,
  readEpisodeDraftCheckpoint,
} from './episodeDraftCheckpoint';

describe('episodeDraftCheckpoint', () => {
  it('round-trips normalized content for the matching episode and blueprint', () => {
    const checkpoint = buildEpisodeDraftCheckpoint({
      episodeNumber: 2,
      blueprintId: 'ep-2',
      sceneContents: [{ sceneId: 's1' }] as any,
      choiceSets: [{ sceneId: 's1', choices: [] }] as any,
      encounters: new Map([['s1', { sceneId: 's1' } as any]]),
    });

    expect(readEpisodeDraftCheckpoint(checkpoint, {
      episodeNumber: 2,
      blueprintId: 'ep-2',
    })).toEqual({
      sceneContents: [{ sceneId: 's1' }],
      choiceSets: [{ sceneId: 's1', choices: [] }],
      encounters: [['s1', { sceneId: 's1' }]],
    });
  });

  it('rejects stale contract, episode, and blueprint fingerprints', () => {
    const checkpoint = buildEpisodeDraftCheckpoint({
      episodeNumber: 1,
      blueprintId: 'ep-1',
      sceneContents: [],
      choiceSets: [],
      encounters: new Map(),
    });

    expect(readEpisodeDraftCheckpoint({ ...checkpoint, version: 99 }, {
      episodeNumber: 1,
      blueprintId: 'ep-1',
    })).toBeUndefined();
    expect(readEpisodeDraftCheckpoint(checkpoint, {
      episodeNumber: 2,
      blueprintId: 'ep-1',
    })).toBeUndefined();
    expect(readEpisodeDraftCheckpoint(checkpoint, {
      episodeNumber: 1,
      blueprintId: 'changed',
    })).toBeUndefined();
  });
});
