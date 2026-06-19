import { describe, expect, it } from 'vitest';
import type { Episode, Story } from '../../../types';
import { ArtifactRevisionStore, type ArtifactStoreIO } from '../artifacts';
import { compileEpisode } from './compiler';

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

async function seedEpisodeArtifacts(store: ArtifactRevisionStore, episodeNumber: number): Promise<void> {
  const contextIn = await store.saveRevision({
    kind: 'context-in',
    storyId: 'story',
    runId: 'run',
    episodeNumber,
    payload: { episodeNumber },
    status: 'valid',
    provenance: { phase: 'context' },
  });
  const runtime = await store.saveRevision({
    kind: 'runtime-episode',
    storyId: 'story',
    runId: 'run',
    episodeNumber,
    payload: episode(episodeNumber),
    status: 'valid',
    upstream: [store.refFor(contextIn)],
    provenance: { phase: `episode_${episodeNumber}` },
  });
  const validation = await store.saveRevision({
    kind: 'validation-report',
    storyId: 'story',
    runId: 'run',
    episodeNumber,
    payload: { ok: true },
    status: 'valid',
    upstream: [store.refFor(runtime)],
    provenance: { phase: 'validation' },
  });
  await store.saveRevision({
    kind: 'context-out',
    storyId: 'story',
    runId: 'run',
    episodeNumber,
    payload: { episodeNumber },
    status: 'valid',
    upstream: [store.refFor(runtime), store.refFor(validation)],
    provenance: { phase: 'context' },
  });
}

describe('compileEpisode', () => {
  it('revalidates a clean episode artifact set and marks later episodes for forward revalidation', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    await seedEpisodeArtifacts(store, 3);

    const result = await compileEpisode({
      storyRunId: 'run',
      episodeNumber: 3,
      mode: 'revalidate',
      contextSource: 'latest',
      totalEpisodes: 5,
    }, { io });

    expect(result.status).toBe('completed');
    expect(result.validationPassed).toBe(true);
    expect(result.forwardRevalidationRequired).toEqual([4, 5]);
    expect(result.packageStatus).toBe('stale');
  });

  it('fails revalidation when required episode artifacts are missing', async () => {
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

    const result = await compileEpisode({
      storyRunId: 'run',
      episodeNumber: 2,
      mode: 'revalidate',
      contextSource: 'latest',
      totalEpisodes: 3,
    }, { io });

    expect(result.status).toBe('failed');
    expect(result.validationPassed).toBe(false);
    expect(result.forwardRevalidationRequired).toEqual([]);
  });

  it('repackages current runtime episode artifacts into a story-package artifact', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    await seedEpisodeArtifacts(store, 1);
    await seedEpisodeArtifacts(store, 2);

    const result = await compileEpisode({
      storyRunId: 'run',
      episodeNumber: 2,
      mode: 'repackage',
      contextSource: 'latest',
      totalEpisodes: 2,
      baseStory: baseStory(),
    }, { io });

    expect(result.status).toBe('completed');
    expect(result.packageStatus).toBe('rebuilt');
    expect(result.artifactsWritten.map((ref) => ref.kind)).toEqual(['story-package']);
    expect(store.loadCurrentRef('story-package')?.revision).toBe(1);
  });

  it('reports regeneration modes as unsupported until pipeline runner integration exists', async () => {
    const result = await compileEpisode({
      storyRunId: 'run',
      episodeNumber: 3,
      mode: 'regenerate-episode',
      contextSource: 'previous-valid',
      totalEpisodes: 5,
    }, { io: makeIO() });

    expect(result.status).toBe('unsupported');
    expect(result.validationPassed).toBe(false);
  });
});
