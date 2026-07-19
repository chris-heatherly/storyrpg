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
  it('migrates schema-v1 indexes and envelopes without rewriting their files', async () => {
    const io = makeIO();
    io.files.set('artifacts/current.json', {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      artifacts: { 'season-plan': { kind: 'season-plan', artifactId: 'legacy', payloadHash: 'hash', revision: 1, path: 'artifacts/season-plan.rev1.json' } },
    });
    io.files.set('artifacts/season-plan.rev1.json', {
      kind: 'season-plan', schemaVersion: 1, artifactId: 'legacy', storyId: 'story', runId: 'run', revision: 1,
      status: 'valid', upstream: [], provenance: { phase: 'season_plan' }, validation: { passed: true, gate: 'season-plan', issues: [] },
      payloadHash: 'hash', createdAt: '2026-01-01T00:00:00.000Z', payload: { episodes: [] },
    });
    const store = new ArtifactRevisionStore(io);
    expect(store.loadCurrentIndex().version).toBe(2);
    expect(store.loadCurrent('season-plan')?.schemaVersion).toBe(2);
    expect((io.files.get('artifacts/current.json') as { version: number }).version).toBe(1);
    expect((io.files.get('artifacts/season-plan.rev1.json') as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  it('materializes legacy current revisions transactionally when explicitly requested', async () => {
    const io = makeIO();
    io.files.set('artifacts/current.json', {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      artifacts: { 'narrative-contract-graph': { kind: 'narrative-contract-graph', artifactId: 'legacy-graph', payloadHash: 'hash', revision: 1, path: 'artifacts/narrative-contract-graph.rev1.json' } },
    });
    io.files.set('artifacts/narrative-contract-graph.rev1.json', {
      kind: 'narrative-contract-graph', schemaVersion: 1, artifactId: 'legacy-graph', storyId: 'story', runId: 'run', revision: 1,
      status: 'valid', upstream: [], provenance: { phase: 'season_plan' }, validation: { passed: true, gate: 'graph', issues: [] },
      payloadHash: 'hash', createdAt: '2026-01-01T00:00:00.000Z', payload: { realizationTasks: [{ ...({ id: 'task', contractId: 'event', episodeNumber: 1, ownerStage: 'scene_writer', repairHandler: 'scene_prose', evidenceAtoms: [], sourceContractIds: [], blocking: true, outcomeTier: 'victory', requiredSurface: ['beat_text'], routePolicy: 'path_required' } as any) }] },
    });
    const store = new ArtifactRevisionStore(io);
    const migrated = await store.migrateCurrentRevisionSet();
    expect(migrated.version).toBe(2);
    expect(migrated.artifacts['narrative-contract-graph']?.revision).toBe(2);
    expect(store.loadCurrent<any>('narrative-contract-graph')?.payload.realizationTasks[0].target.scope).toBe('route_path');
    expect((io.files.get('artifacts/narrative-contract-graph.rev1.json') as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  it('commits a valid artifact set atomically and rejects invalid members', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    const valid = await store.saveRevision({ kind: 'season-plan', storyId: 'story', runId: 'run', payload: {}, status: 'valid', makeCurrent: false, provenance: { phase: 'test' } });
    const invalid = await store.saveRevision({ kind: 'narrative-contract-graph', storyId: 'story', runId: 'run', payload: {}, status: 'invalid', makeCurrent: false, provenance: { phase: 'test' }, validation: { passed: false, gate: 'test', issues: [] } });
    await expect(store.commitCurrentSet([store.refFor(valid), store.refFor(invalid)])).rejects.toThrow(/non-valid/);
    expect(store.loadCurrentRef('season-plan')).toBeNull();
    await store.commitCurrentSet([store.refFor(valid)]);
    expect(store.loadCurrentRef('season-plan')?.artifactId).toBe(valid.artifactId);
  });

  it('records supersession without mutating an immutable artifact revision', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    const artifact = await store.saveRevision({ kind: 'season-plan', storyId: 'story', runId: 'run', payload: { stable: true }, status: 'valid', provenance: { phase: 'test' } });
    const before = JSON.stringify(io.files.get(artifactPath('season-plan', 1)));
    await store.markSuperseded(store.refFor(artifact));
    expect(JSON.stringify(io.files.get(artifactPath('season-plan', 1)))).toBe(before);
    expect(store.loadCurrentIndex().supersededArtifactIds).toContain(artifact.artifactId);
  });

  it('does not freeze the producer-owned upstream array while committing an artifact', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    const source = await store.saveRevision({
      kind: 'source-analysis',
      storyId: 'story',
      runId: 'run',
      payload: { source: true },
      status: 'valid',
      provenance: { phase: 'source_analysis' },
    });
    const upstream = [store.refFor(source)];

    await store.saveRevision({
      kind: 'source-canon',
      storyId: 'story',
      runId: 'run',
      payload: { canon: true },
      status: 'valid',
      upstream,
      provenance: { phase: 'source_analysis' },
    });

    expect(Object.isFrozen(upstream)).toBe(false);
    expect(() => upstream.push(store.refFor(source))).not.toThrow();
  });

  it('does not freeze or alias the producer-owned payload while committing an artifact', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    const payload = { scenes: [{ beats: [{ id: 'b1', text: 'Draft prose.' }] }] };

    const artifact = await store.saveRevision({
      kind: 'scene-plan',
      storyId: 'story',
      runId: 'run',
      episodeNumber: 1,
      payload,
      status: 'valid',
      provenance: { phase: 'episode_content' },
    });

    expect(Object.isFrozen(payload)).toBe(false);
    expect(Object.isFrozen(payload.scenes[0].beats[0])).toBe(false);
    expect(() => { payload.scenes[0].beats[0].text = 'Assembly rewrite.'; }).not.toThrow();
    expect(artifact.payload.scenes[0].beats[0].text).toBe('Draft prose.');
  });

  it('opens a mutable payload session without mutating the committed revision', async () => {
    const io = makeIO();
    const store = new ArtifactRevisionStore(io);
    const committed = await store.saveRevision({
      kind: 'season-plan',
      storyId: 'story',
      runId: 'run',
      payload: { scenes: [{ id: 's1', order: 0 }] },
      status: 'valid',
      provenance: { phase: 'test' },
    });
    const session = store.openMutableSession<typeof committed.payload>(store.refFor(committed));
    expect(session).toBeTruthy();
    session!.value.scenes[0].order = 1;
    expect(store.loadRef<typeof committed.payload>(store.refFor(committed))!.payload.scenes[0].order).toBe(0);
    const next = await session!.commit({
      kind: 'season-plan', storyId: 'story', runId: 'run', status: 'valid',
      provenance: { phase: 'test' },
    });
    expect(next.payload.scenes[0].order).toBe(1);
    expect(next.upstream.some((ref) => ref.artifactId === committed.artifactId)).toBe(true);
  });

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
