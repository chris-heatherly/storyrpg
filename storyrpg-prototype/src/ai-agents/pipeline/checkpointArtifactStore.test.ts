import { describe, expect, it } from 'vitest';
import {
  CheckpointArtifactStore,
  artifactFilePath,
  episodeArtifactId,
  type ArtifactStoreIO,
} from './checkpointArtifactStore';
import { episodeAssembledArtifact, episodeCompleteArtifact } from './episodeCheckpoints';
import type { Episode } from '../../types';

/** In-memory IO matching the saveEarlyDiagnostic/loadEarlyDiagnosticSync contract. */
function makeIO(opts?: { swallowWrites?: boolean }): ArtifactStoreIO & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>();
  return {
    files,
    async save(name, data) {
      if (opts?.swallowWrites) return; // saveEarlyDiagnostic swallows failures silently
      files.set(name, JSON.parse(JSON.stringify(data)));
    },
    load<T>(name: string): T | null {
      return (files.has(name) ? (files.get(name) as T) : null);
    },
  };
}

const episode = (n: number): Episode =>
  ({ id: `ep-${n}`, number: n, title: `Episode ${n}`, scenes: [{ id: `s${n}-1`, beats: [] }] }) as unknown as Episode;

describe('CheckpointArtifactStore — generic artifacts', () => {
  it('round-trips a value through the enveloped checkpoints/artifacts/ path', async () => {
    const io = makeIO();
    const store = new CheckpointArtifactStore(io);
    expect(await store.has('season_plan')).toBe(false);

    await store.save('season_plan', { episodes: 3 });
    expect(await store.has('season_plan')).toBe(true);
    expect(await store.load('season_plan')).toEqual({ episodes: 3 });
    expect(io.files.has(artifactFilePath('season_plan'))).toBe(true);
  });

  it('treats a foreign/torn envelope as absent (id pinned)', async () => {
    const io = makeIO();
    // A file exists at the path but the envelope names a DIFFERENT artifact.
    io.files.set(artifactFilePath('scene:s1'), { version: 1, artifactId: 'scene:s2', savedAt: 'x', value: 1 });
    const store = new CheckpointArtifactStore(io);
    expect(await store.has('scene:s1')).toBe(false);
    expect(await store.load('scene:s1')).toBeUndefined();
  });

  it('sanitizes artifact ids into stable file paths', () => {
    expect(artifactFilePath('scene_content:episode-2:s2-1')).toBe(
      'checkpoints/artifacts/scene_content__episode-2__s2-1.json',
    );
  });

  it('save() throws when the write was swallowed (no phantom success)', async () => {
    const store = new CheckpointArtifactStore(makeIO({ swallowWrites: true }));
    await expect(store.save('season_plan', {})).rejects.toThrow(/failed to persist/);
  });
});

describe('CheckpointArtifactStore — episode artifacts (WS1a watermark compatibility)', () => {
  it('save() writes the legacy watermark + assembled layout', async () => {
    const io = makeIO();
    const store = new CheckpointArtifactStore(io);
    await store.save(episodeArtifactId(2), episode(2));

    // Persisted in the EXISTING layout the legacy resume path reads.
    expect(io.files.has(episodeCompleteArtifact(2))).toBe(true);
    expect(io.files.has(episodeAssembledArtifact(2))).toBe(true);
    expect(await store.has(episodeArtifactId(2))).toBe(true);
    expect(((await store.load(episodeArtifactId(2))) as Episode).number).toBe(2);
  });

  it('has() honors a legacy run directory written by the OLD episode loop', async () => {
    const io = makeIO();
    // Simulate the legacy writeEpisodeCompletion output directly.
    io.files.set(episodeAssembledArtifact(1), episode(1));
    io.files.set(episodeCompleteArtifact(1), {
      version: 1,
      episodeNumber: 1,
      title: 'Episode 1',
      completedAt: 'x',
      sceneCount: 1,
      assembledArtifact: episodeAssembledArtifact(1),
    });
    const store = new CheckpointArtifactStore(io);
    expect(await store.has(episodeArtifactId(1))).toBe(true);
    expect(((await store.load(episodeArtifactId(1))) as Episode).id).toBe('ep-1');
  });

  it('a watermark pointing at a missing assembled artifact degrades to absent', async () => {
    const io = makeIO();
    io.files.set(episodeCompleteArtifact(3), {
      version: 1,
      episodeNumber: 3,
      title: 'Episode 3',
      completedAt: 'x',
      sceneCount: 1,
      assembledArtifact: episodeAssembledArtifact(3),
    });
    const store = new CheckpointArtifactStore(io);
    expect(await store.has(episodeArtifactId(3))).toBe(false);
  });
});
