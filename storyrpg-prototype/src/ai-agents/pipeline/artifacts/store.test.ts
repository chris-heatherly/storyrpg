import { describe, expect, it } from 'vitest';
import {
  ArtifactRevisionStore,
  artifactPath,
  currentIndexPath,
  evaluateArtifactStatus,
  forwardRevalidationEpisodes,
  stableHash,
  type ArtifactStoreIO,
} from './index';

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

describe('ArtifactRevisionStore', () => {
  it('writes immutable revisions and advances current only for valid artifacts by default', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);

    const draft = await store.saveRevision({
      kind: 'season-plan',
      storyId: 'story',
      runId: 'run',
      payload: { episodes: 3 },
      status: 'draft',
      provenance: { phase: 'season_plan' },
    });
    expect(store.loadCurrentRef('season-plan')).toBeNull();

    const valid = await store.saveRevision({
      kind: 'season-plan',
      storyId: 'story',
      runId: 'run',
      payload: { episodes: 4 },
      status: 'valid',
      provenance: { phase: 'season_plan' },
    });

    expect(draft.revision).toBe(1);
    expect(valid.revision).toBe(2);
    expect(io.files.has(artifactPath('season-plan', 1))).toBe(true);
    expect(io.files.has(artifactPath('season-plan', 2))).toBe(true);
    expect(store.loadCurrentRef('season-plan')?.revision).toBe(2);
    expect(io.files.has(currentIndexPath())).toBe(true);
  });

  it('stores episode-scoped current pointers separately', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);

    await store.saveRevision({
      kind: 'runtime-episode',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 3,
      payload: { number: 3 },
      status: 'valid',
      provenance: { phase: 'episode_3' },
    });

    expect(store.loadCurrentRef('runtime-episode')).toBeNull();
    expect(store.loadCurrentRef('runtime-episode', 3)?.path).toBe('artifacts/episodes/003/runtime-episode.rev1.json');
    expect(io.files.has('artifacts/episodes/003/current.json')).toBe(true);
  });

  it('evaluates invalid and blocked graph states', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    const upstream = await store.saveRevision({
      kind: 'context-in',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 1,
      payload: { ok: true },
      status: 'valid',
      provenance: { phase: 'context' },
    });
    const runtime = await store.saveRevision({
      kind: 'runtime-episode',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 1,
      payload: { number: 1 },
      status: 'invalid',
      upstream: [store.refFor(upstream)],
      provenance: { phase: 'episode_1' },
      validation: { passed: false, gate: 'runtime-episode', issues: [{ validator: 'test', severity: 'error', message: 'bad' }] },
    });

    expect(evaluateArtifactStatus(store.refFor(runtime), store).status).toBe('invalid');
    expect(evaluateArtifactStatus({ ...store.refFor(runtime), path: 'missing.json' }, store).status).toBe('blocked');
  });

  it('marks downstream artifacts stale when an upstream has a newer current revision', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    const contextV1 = await store.saveRevision({
      kind: 'context-in',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 2,
      payload: { facts: ['old'] },
      status: 'valid',
      provenance: { phase: 'context' },
    });
    const runtime = await store.saveRevision({
      kind: 'runtime-episode',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 2,
      payload: { number: 2 },
      status: 'valid',
      upstream: [store.refFor(contextV1)],
      provenance: { phase: 'episode_2' },
    });
    await store.saveRevision({
      kind: 'context-in',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 2,
      payload: { facts: ['new'] },
      status: 'valid',
      provenance: { phase: 'context' },
    });

    expect(evaluateArtifactStatus(store.refFor(runtime), store).status).toBe('stale');
  });
});

describe('artifact utilities', () => {
  it('hashes object keys deterministically', () => {
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
  });

  it('marks only later episodes for forward revalidation', () => {
    expect(forwardRevalidationEpisodes(3, 6)).toEqual([4, 5, 6]);
  });
});
