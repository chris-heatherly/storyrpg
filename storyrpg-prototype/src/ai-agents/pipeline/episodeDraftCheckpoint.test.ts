import { describe, expect, it } from 'vitest';
import {
  buildEpisodeDraftCheckpoint,
  readEpisodeDraftCheckpoint,
} from './episodeDraftCheckpoint';
import { buildSceneCommitReceipt } from './sceneCommit';

describe('episodeDraftCheckpoint', () => {
  it('round-trips normalized content for the matching episode and blueprint', () => {
    const scene = { sceneId: 's1' } as any;
    const choiceSet = { sceneId: 's1', choices: [] } as any;
    const encounter = { sceneId: 's1' } as any;
    const receipt = buildSceneCommitReceipt({
      episodeNumber: 2,
      scene,
      choiceSet,
      encounter,
      critic: { disposition: 'not_eligible', scene, rewrittenBeatIds: [] },
    });
    const checkpoint = buildEpisodeDraftCheckpoint({
      episodeNumber: 2,
      blueprintId: 'ep-2',
      sceneContents: [scene],
      choiceSets: [choiceSet],
      encounters: new Map([['s1', encounter]]),
      sceneCommitReceipts: [receipt],
    });

    expect(readEpisodeDraftCheckpoint(checkpoint, {
      episodeNumber: 2,
      blueprintId: 'ep-2',
    })).toEqual({
      sceneContents: [{ sceneId: 's1' }],
      choiceSets: [{ sceneId: 's1', choices: [] }],
      encounters: [['s1', { sceneId: 's1' }]],
      deferredRealizationRecords: [],
      sceneCommitReceipts: [receipt],
    });
  });

  it('rejects stale contract, episode, and blueprint fingerprints', () => {
    const checkpoint = buildEpisodeDraftCheckpoint({
      episodeNumber: 1,
      blueprintId: 'ep-1',
      sceneContents: [],
      choiceSets: [],
      encounters: new Map(),
      sceneCommitReceipts: [],
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
