import { describe, expect, it, vi } from 'vitest';
import type { ArtifactKind, ArtifactRef, PipelineArtifact } from './artifacts';
import { persistEpisodePlanningArtifacts, persistPlanningArtifacts } from './planningArtifactPersistence';

function runtime(globalRefs: ArtifactRef[] = []) {
  const saved: PipelineArtifact<unknown>[] = [];
  const commitCurrentSet = vi.fn(async () => undefined);
  const saveArtifact = vi.fn(async (input: any) => {
    const artifact = {
      ...input,
      schemaVersion: 2,
      artifactId: `${input.kind}-${saved.length + 1}`,
      storyId: 'story',
      runId: 'run',
      revision: 1,
      validation: input.validation ?? { passed: true, gate: input.kind, issues: [] },
      payloadHash: `hash-${saved.length + 1}`,
      createdAt: '2026-07-11T00:00:00.000Z',
      upstream: input.upstream ?? [],
    } as PipelineArtifact<unknown>;
    saved.push(artifact);
    return artifact;
  });
  const refFor = <T,>(artifact: PipelineArtifact<T>): ArtifactRef => ({
    kind: artifact.kind,
    artifactId: artifact.artifactId,
    payloadHash: artifact.payloadHash,
    revision: artifact.revision,
    path: `${artifact.kind}.json`,
    episodeNumber: artifact.episodeNumber,
  });
  return {
    saved,
    commitCurrentSet,
    value: {
      saveArtifact,
      refFor,
      commitCurrentSet,
      getGlobalUpstreamRefs: () => [...globalRefs],
    } as any,
  };
}

describe('planningArtifactPersistence', () => {
  it('commits the complete planning set only after every revision is saved', async () => {
    const mock = runtime();
    const emit = vi.fn();
    const refs = await persistPlanningArtifacts({
      artifactRuntime: mock.value,
      sourceAnalysis: { sourceCanon: { version: 1 } } as any,
      seasonPlan: {
        scenePlan: {
          narrativeContractGraph: {
            storyId: 'story',
            sourceHash: 'source-hash',
            validation: { passed: true, issues: [] },
          },
        },
      } as any,
      emit,
    });

    expect(mock.saved.map((artifact) => artifact.kind)).toEqual([
      'source-analysis',
      'source-canon',
      'season-plan',
      'narrative-contract-graph',
      'narrative-realization-ledger',
    ] satisfies ArtifactKind[]);
    expect(mock.commitCurrentSet).toHaveBeenCalledOnce();
    expect(mock.commitCurrentSet).toHaveBeenCalledWith(refs);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ phase: 'artifacts' }));
  });

  it('preserves episode artifact dependency order and commits the group together', async () => {
    const globalRef: ArtifactRef = {
      kind: 'season-plan', artifactId: 'season', payloadHash: 'season-hash', revision: 1, path: 'season.json',
    };
    const mock = runtime([globalRef]);
    const refs = await persistEpisodePlanningArtifacts({
      artifactRuntime: mock.value,
      episodeNumber: 2,
      blueprint: { episodeId: 'episode-2', scenes: [] } as any,
      branchAnalysis: { episodeId: 'episode-2' } as any,
      sceneContents: [],
      choiceSets: [],
      encounters: new Map(),
      emit: vi.fn(),
    });

    expect(mock.saved.map((artifact) => artifact.kind)).toEqual([
      'episode-blueprint', 'branch-plan', 'scene-plan', 'choice-consequence-plan', 'encounter-plan',
    ] satisfies ArtifactKind[]);
    expect(mock.saved[1].upstream[0].kind).toBe('episode-blueprint');
    expect(mock.saved[2].upstream.map((ref) => ref.kind)).toEqual(['episode-blueprint', 'branch-plan']);
    expect(mock.commitCurrentSet).toHaveBeenCalledWith(refs);
  });
});
