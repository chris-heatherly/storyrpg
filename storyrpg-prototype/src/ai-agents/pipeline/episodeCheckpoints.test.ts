import { describe, it, expect } from 'vitest';
import { ArtifactRevisionStore, evaluateArtifactStatus } from './artifacts';
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
    scenes: Array.from({ length: sceneCount }, (_, i) => ({ id: `s${number}-${i + 1}`, name: `Scene ${i + 1}` })),
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

  it('can shadow-write per-episode artifacts without changing the legacy resume layout', async () => {
    const store = makeStore();
    const episode = makeEpisode(2, 1);

    await writeEpisodeCompletion({
      episode,
      episodeNumber: 2,
      title: 'Two',
      save: store.save,
      shadowArtifacts: {
        storyId: 'story',
        runId: 'run',
        load: store.load,
      },
    });

    expect(loadCompletedEpisode(2, store.load)?.episode.number).toBe(2);
    const artifactStore = new ArtifactRevisionStore({ save: store.save, load: store.load });
    expect(artifactStore.loadCurrentRef('context-in', 2)?.path).toBe('artifacts/episodes/002/context-in.rev1.json');
    expect(artifactStore.loadCurrentRef('runtime-episode', 2)?.path).toBe('artifacts/episodes/002/runtime-episode.rev1.json');
    expect(artifactStore.loadCurrentRef('validation-report', 2)?.path).toBe('artifacts/episodes/002/validation-report.rev1.json');
    expect(artifactStore.loadCurrentRef('context-out', 2)?.path).toBe('artifacts/episodes/002/context-out.rev1.json');
  });

  it('links context-in to the previous episode context-out for forward revalidation', async () => {
    const store = makeStore();
    await writeEpisodeCompletion({
      episode: makeEpisode(1, 1),
      episodeNumber: 1,
      title: 'One',
      save: store.save,
      shadowArtifacts: {
        storyId: 'story',
        runId: 'run',
        load: store.load,
      },
    });
    await writeEpisodeCompletion({
      episode: makeEpisode(2, 1),
      episodeNumber: 2,
      title: 'Two',
      save: store.save,
      shadowArtifacts: {
        storyId: 'story',
        runId: 'run',
        load: store.load,
      },
    });

    const artifactStore = new ArtifactRevisionStore({ save: store.save, load: store.load });
    const contextIn = artifactStore.loadCurrent('context-in', 2);
    const previousContextOutRef = artifactStore.loadCurrentRef('context-out', 1);
    expect(contextIn?.upstream).toContainEqual(previousContextOutRef);
    expect((contextIn?.payload as { canonFacts?: string[] } | undefined)?.canonFacts).toContain('scene:s1-1:Scene 1');

    const previousContextOut = artifactStore.loadCurrent('context-out', 1);
    expect(previousContextOut).not.toBeNull();
    await artifactStore.saveRevision({
      kind: 'context-out',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 1,
      payload: {
        ...(previousContextOut!.payload as Record<string, unknown>),
        canonFactsIntroduced: ['scene:s1-1:Changed'],
      },
      status: 'valid',
      provenance: { phase: 'episode_1_repair', agent: 'test' },
    });

    const staleReport = evaluateArtifactStatus(artifactStore.loadCurrentRef('context-in', 2)!, artifactStore);
    expect(staleReport.status).toBe('stale');
    expect(staleReport.reasons.join(' ')).toContain('context-out:1');
  });
});
