import { describe, expect, it } from 'vitest';
import type { Episode, Story } from '../../../types';
import { ArtifactRevisionStore, assembleRuntimeStoryFromArtifacts, saveStoryPackageArtifact, type ArtifactStoreIO } from './index';

function makeIO(): ArtifactStoreIO & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>();
  return {
    files,
    async save(name, data) {
      files.set(name, JSON.parse(JSON.stringify(data)));
    },
    load<T>(name: string): T | null {
      return files.has(name) ? (files.get(name) as T) : null;
    },
  };
}

const baseStory = (): Story => ({
  id: 'story',
  title: 'Story',
  genre: 'Drama',
  synopsis: 'Test',
  coverImage: '',
  initialState: {
    attributes: { charm: 50, wit: 50, courage: 50, empathy: 50, resolve: 50, resourcefulness: 50 },
    skills: {},
    tags: [],
    inventory: [],
  },
  npcs: [],
  episodes: [],
});

const episode = (n: number): Episode => ({
  id: `ep-${n}`,
  number: n,
  title: `Episode ${n}`,
  synopsis: 'Test',
  coverImage: '',
  scenes: [{ id: `s-${n}`, name: `Scene ${n}`, beats: [], startingBeatId: 'b1' }],
  startingSceneId: `s-${n}`,
});

describe('story package assembly from artifacts', () => {
  it('assembles a story from current runtime episode artifacts in episode order', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    await store.saveRevision({
      kind: 'runtime-episode',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 2,
      payload: episode(2),
      status: 'valid',
      provenance: { phase: 'episode_2' },
    });
    await store.saveRevision({
      kind: 'runtime-episode',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 1,
      payload: episode(1),
      status: 'valid',
      provenance: { phase: 'episode_1' },
    });

    const assembled = assembleRuntimeStoryFromArtifacts({ store, baseStory: baseStory(), episodeNumbers: [1, 2] });

    expect(assembled.missingEpisodes).toEqual([]);
    expect(assembled.story?.episodes.map((ep) => ep.number)).toEqual([1, 2]);
    expect(assembled.episodeRefs).toHaveLength(2);
  });

  it('refuses to assemble when any requested runtime episode artifact is missing', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    await store.saveRevision({
      kind: 'runtime-episode',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 1,
      payload: episode(1),
      status: 'valid',
      provenance: { phase: 'episode_1' },
    });

    const assembled = assembleRuntimeStoryFromArtifacts({ store, baseStory: baseStory(), episodeNumbers: [1, 2] });

    expect(assembled.story).toBeNull();
    expect(assembled.missingEpisodes).toEqual([2]);
  });

  it('writes a story-package artifact with runtime episodes as upstream refs', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    await store.saveRevision({
      kind: 'runtime-episode',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 1,
      payload: episode(1),
      status: 'valid',
      provenance: { phase: 'episode_1' },
    });

    const artifact = await saveStoryPackageArtifact({
      store,
      storyId: 'story',
      runId: 'run',
      baseStory: baseStory(),
      episodeNumbers: [1],
    });

    expect(artifact.kind).toBe('story-package');
    expect(artifact.upstream.map((ref) => ref.kind)).toEqual(['runtime-episode']);
    expect(store.loadCurrentRef('story-package')?.revision).toBe(1);
  });
});
