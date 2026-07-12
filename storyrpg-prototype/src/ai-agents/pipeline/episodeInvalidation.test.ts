import { describe, expect, it } from 'vitest';
import { invalidateDependencyAwareEpisodes, invalidateEpisodes, planDependencyAwareForwardRepair, planEpisodeInvalidation } from './episodeInvalidation';
import {
  type ArtifactLoader,
  type ArtifactSaver,
  episodeCompleteArtifact,
  loadCompletedEpisode,
  partitionResumableEpisodes,
  writeEpisodeCompletion,
} from './episodeCheckpoints';
import { CheckpointArtifactStore, episodeArtifactId } from './checkpointArtifactStore';
import type { Episode } from '../../types';

function makeRunDir(): { files: Map<string, unknown>; save: ArtifactSaver; load: ArtifactLoader } {
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

const episode = (n: number): Episode =>
  ({ id: `ep-${n}`, number: n, title: `Episode ${n}`, scenes: [{ id: `s${n}-1`, beats: [] }] }) as unknown as Episode;

async function completeEpisodes(io: ReturnType<typeof makeRunDir>, numbers: number[]) {
  for (const n of numbers) {
    await writeEpisodeCompletion({ episode: episode(n), episodeNumber: n, title: `Episode ${n}`, save: io.save });
  }
}

describe('planEpisodeInvalidation', () => {
  it('revalidates all later episodes but regenerates only explicit dependency targets', () => {
    const repair = planDependencyAwareForwardRepair({
      changedEpisode: 1,
      totalEpisodes: 4,
      graph: {
        version: 1, compilerVersion: 'test', storyId: 'story', sourceHash: 'hash', validation: { passed: true, issues: [] },
        events: [
          { id: 'ep1-rescue', episodeNumber: 1, sourceOrder: 0, sourceText: 'rescue', sourceContractIds: [], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['s1'], targetSpineUnitIds: [], ownerSceneId: 's1', provenance: { source: 'season_plan', confidence: 'deterministic' } },
          { id: 'ep3-reveal', episodeNumber: 3, sourceOrder: 0, sourceText: 'reveal', sourceContractIds: [], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['s3'], targetSpineUnitIds: [], ownerSceneId: 's3', provenance: { source: 'season_plan', confidence: 'deterministic' } },
        ],
        dependencies: [{ id: 'rescue-reveal', fromEventId: 'ep1-rescue', toEventId: 'ep3-reveal', relation: 'pays_off', sourceEpisodeNumber: 1, targetEpisodeNumbers: [3], targetSceneIds: ['s3'], branchConditionKeys: [], requiredSurfaces: ['scene_turn'], priority: 'major', sourceContractIds: [] }],
        characterPresenceContracts: [],
      },
    });
    expect(repair.revalidate).toEqual([2, 3, 4]);
    expect(repair.regenerate).toEqual([3]);
  });

  it('covers the target and all later completed episodes by default', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [1, 2, 3]);
    const plan = planEpisodeInvalidation({ target: 2, episodeNumbers: [1, 2, 3, 4], load: io.load });
    expect(plan).toEqual({ target: 2, invalidated: [2, 3], kept: [1] });
  });

  it('covers only the target with downstream: false', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [1, 2, 3]);
    const plan = planEpisodeInvalidation({
      target: 2,
      episodeNumbers: [1, 2, 3],
      load: io.load,
      downstream: false,
    });
    expect(plan).toEqual({ target: 2, invalidated: [2], kept: [1, 3] });
  });

  it('skips episodes that never completed', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [1, 3]); // 2 never finished
    const plan = planEpisodeInvalidation({ target: 2, episodeNumbers: [1, 2, 3], load: io.load });
    expect(plan).toEqual({ target: 2, invalidated: [3], kept: [1] });
  });
});

describe('invalidateDependencyAwareEpisodes', () => {
  it('tombstones the changed episode and dependency-affected payoffs while leaving unrelated later episodes resumable', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [1, 2, 3, 4]);
    const result = await invalidateDependencyAwareEpisodes({
      changedEpisode: 1,
      totalEpisodes: 4,
      episodeNumbers: [1, 2, 3, 4],
      graph: {
        version: 1, compilerVersion: 'test', storyId: 'story', sourceHash: 'hash', validation: { passed: true, issues: [] },
        events: [
          { id: 'e1', episodeNumber: 1, sourceOrder: 0, sourceText: 'setup', sourceContractIds: [], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['s1'], targetSpineUnitIds: [], ownerSceneId: 's1', provenance: { source: 'season_plan', confidence: 'deterministic' } },
          { id: 'e3', episodeNumber: 3, sourceOrder: 0, sourceText: 'payoff', sourceContractIds: [], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['s3'], targetSpineUnitIds: [], ownerSceneId: 's3', provenance: { source: 'season_plan', confidence: 'deterministic' } },
        ],
        dependencies: [{ id: 'd1', fromEventId: 'e1', toEventId: 'e3', relation: 'pays_off', sourceEpisodeNumber: 1, targetEpisodeNumbers: [3], targetSceneIds: ['s3'], branchConditionKeys: [], requiredSurfaces: ['final_prose'], priority: 'major', sourceContractIds: [] }],
        characterPresenceContracts: [],
      } as any,
      load: io.load,
      save: io.save,
      reason: 'canonical event changed',
    });
    expect(result.revalidate).toEqual([2, 3, 4]);
    expect(result.regenerated).toEqual([1, 3]);
    expect(partitionResumableEpisodes([1, 2, 3, 4].map((episodeNumber) => ({ episodeNumber })), io.load).pending.map((item) => item.episodeNumber)).toEqual([1, 3]);
  });
});

describe('invalidateEpisodes', () => {
  it('tombstones the covered watermarks so resume re-runs exactly those episodes', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [1, 2, 3]);

    const plan = await invalidateEpisodes({
      target: 2,
      episodeNumbers: [1, 2, 3],
      load: io.load,
      save: io.save,
      reason: 'ep2 shipped a canon break',
    });
    expect(plan.invalidated).toEqual([2, 3]);

    // The legacy resume path now sees 2 and 3 as pending, 1 as resumed.
    const specs = [1, 2, 3].map((episodeNumber) => ({ episodeNumber }));
    const { pending, resumed } = partitionResumableEpisodes(specs, io.load);
    expect(pending.map((s) => s.episodeNumber)).toEqual([2, 3]);
    expect(resumed.map((r) => r.spec.episodeNumber)).toEqual([1]);

    // The graph store agrees (same probe).
    const store = new CheckpointArtifactStore(io);
    expect(await store.has(episodeArtifactId(1))).toBe(true);
    expect(await store.has(episodeArtifactId(2))).toBe(false);
    expect(await store.has(episodeArtifactId(3))).toBe(false);
  });

  it('tombstone records the reason, downstream provenance, and the replaced watermark', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [2, 3]);
    await invalidateEpisodes({
      target: 2,
      episodeNumbers: [2, 3],
      load: io.load,
      save: io.save,
      reason: 'misgendered encounter',
    });

    const direct = io.load<Record<string, unknown>>(episodeCompleteArtifact(2));
    const fallout = io.load<Record<string, unknown>>(episodeCompleteArtifact(3));
    expect(direct).toMatchObject({ version: 0, reason: 'misgendered encounter' });
    expect(direct).not.toHaveProperty('downstreamOf');
    expect((direct as { replaced: { episodeNumber: number } }).replaced.episodeNumber).toBe(2);
    expect(fallout).toMatchObject({ version: 0, downstreamOf: 2 });
  });

  it('keeps the assembled artifact on disk for forensics', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [1]);
    await invalidateEpisodes({
      target: 1,
      episodeNumbers: [1],
      load: io.load,
      save: io.save,
      reason: 'x',
    });
    expect(io.files.has('checkpoints/episode-1-assembled.json')).toBe(true);
    expect(loadCompletedEpisode(1, io.load)).toBeNull();
  });

  it('re-completing an invalidated episode makes it resumable again', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [1]);
    await invalidateEpisodes({ target: 1, episodeNumbers: [1], load: io.load, save: io.save, reason: 'x' });
    expect(loadCompletedEpisode(1, io.load)).toBeNull();
    await completeEpisodes(io, [1]); // the re-run finishes and re-watermarks
    expect(loadCompletedEpisode(1, io.load)).not.toBeNull();
  });

  it('throws when the tombstone write is swallowed', async () => {
    const io = makeRunDir();
    await completeEpisodes(io, [1]);
    const swallowing: ArtifactSaver = async () => {}; // saveEarlyDiagnostic-style silent failure
    await expect(
      invalidateEpisodes({
        target: 1,
        episodeNumbers: [1],
        load: io.load,
        save: swallowing,
        reason: 'x',
      }),
    ).rejects.toThrow(/did not stick/);
  });
});
