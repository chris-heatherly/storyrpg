import { describe, it, expect } from 'vitest';
import {
  episodeCompleteArtifact,
  episodeAssembledArtifact,
  writeEpisodeCompletion,
  loadCompletedEpisode,
  detectCompletedEpisodes,
  partitionResumableEpisodes,
  type ArtifactLoader,
} from './episodeCheckpoints';
import type { Episode } from '../../types';

function makeEpisode(number: number, sceneCount = 2): Episode {
  return {
    number,
    title: `Episode ${number}`,
    scenes: Array.from({ length: sceneCount }, (_, i) => ({ id: `s${number}-${i + 1}` })),
  } as unknown as Episode;
}

function makeStore(): { artifacts: Map<string, unknown>; save: (name: string, data: unknown) => Promise<void>; load: ArtifactLoader } {
  const artifacts = new Map<string, unknown>();
  return {
    artifacts,
    save: async (name, data) => {
      artifacts.set(name, JSON.parse(JSON.stringify(data)));
    },
    load: <T,>(name: string): T | null => (artifacts.has(name) ? (artifacts.get(name) as T) : null),
  };
}

describe('episodeCheckpoints', () => {
  it('writes assembled artifact before watermark and round-trips through load', async () => {
    const store = makeStore();
    const writeOrder: string[] = [];
    const trackingSave = async (name: string, data: unknown) => {
      writeOrder.push(name);
      await store.save(name, data);
    };

    const episode = makeEpisode(2, 3);
    const watermark = await writeEpisodeCompletion({ episode, episodeNumber: 2, title: 'Ep Two', save: trackingSave });

    expect(writeOrder).toEqual([episodeAssembledArtifact(2), episodeCompleteArtifact(2)]);
    expect(watermark.sceneCount).toBe(3);

    const resumed = loadCompletedEpisode(2, store.load);
    expect(resumed).not.toBeNull();
    expect(resumed!.episode.number).toBe(2);
    expect(resumed!.watermark.title).toBe('Ep Two');
  });

  it('treats a watermark without a loadable assembled episode as not complete', async () => {
    const store = makeStore();
    await store.save(episodeCompleteArtifact(1), {
      version: 1,
      episodeNumber: 1,
      title: 'Torn',
      completedAt: new Date().toISOString(),
      sceneCount: 2,
      assembledArtifact: episodeAssembledArtifact(1),
    });
    expect(loadCompletedEpisode(1, store.load)).toBeNull();
  });

  it('rejects mismatched episode numbers and empty scene lists', async () => {
    const store = makeStore();
    await writeEpisodeCompletion({ episode: makeEpisode(3), episodeNumber: 3, title: 'Ep', save: store.save });
    // Corrupt the assembled artifact: wrong number
    await store.save(episodeAssembledArtifact(3), makeEpisode(4));
    expect(loadCompletedEpisode(3, store.load)).toBeNull();
    // Corrupt the assembled artifact: no scenes
    await store.save(episodeAssembledArtifact(3), { number: 3, title: 'Ep', scenes: [] });
    expect(loadCompletedEpisode(3, store.load)).toBeNull();
  });

  it('partitionResumableEpisodes splits specs and preserves order within each side', async () => {
    const store = makeStore();
    await writeEpisodeCompletion({ episode: makeEpisode(2), episodeNumber: 2, title: 'Two', save: store.save });
    const specs = [{ episodeNumber: 1 }, { episodeNumber: 2 }, { episodeNumber: 3 }];
    const { pending, resumed } = partitionResumableEpisodes(specs, store.load);
    expect(pending.map((s) => s.episodeNumber)).toEqual([1, 3]);
    expect(resumed).toHaveLength(1);
    expect(resumed[0].spec.episodeNumber).toBe(2);
    expect(resumed[0].episode.number).toBe(2);
    expect(resumed[0].watermark.title).toBe('Two');
  });

  it('detectCompletedEpisodes reports only valid completions among requested numbers', async () => {
    const store = makeStore();
    await writeEpisodeCompletion({ episode: makeEpisode(1), episodeNumber: 1, title: 'One', save: store.save });
    await writeEpisodeCompletion({ episode: makeEpisode(3), episodeNumber: 3, title: 'Three', save: store.save });
    expect(detectCompletedEpisodes([1, 2, 3, 4], store.load)).toEqual([1, 3]);
  });
});
