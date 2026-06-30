import { describe, it, expect } from 'vitest';
import { ArtifactRevisionStore, evaluateArtifactStatus } from './artifacts';
import {
  episodeCompleteArtifact,
  episodeAssembledArtifact,
  writeEpisodeCompletion,
  loadCompletedEpisode,
  detectCompletedEpisodes,
  findResumedEpisodeInvalidationReasons,
  loadResumedEpisodeDiagnostics,
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

  it('rejects completion watermarks paired with failed incremental contracts', async () => {
    const store = makeStore();
    await writeEpisodeCompletion({ episode: makeEpisode(1), episodeNumber: 1, title: 'One', save: store.save });
    await store.save('episode-1-incremental-contract.json', {
      passed: false,
      blockingCount: 1,
      blockingIssues: [{ type: 'qa_blocker_present' }],
    });

    expect(loadCompletedEpisode(1, store.load)).toBeNull();
    expect(detectCompletedEpisodes([1], store.load)).toEqual([]);
  });

  it('rejects new completion watermarks with failed lock evidence', async () => {
    const runtimeFailed = makeStore();
    await writeEpisodeCompletion({
      episode: makeEpisode(1),
      episodeNumber: 1,
      title: 'One',
      save: runtimeFailed.save,
      lock: {
        runtimeContractPassed: false,
      },
    });
    expect(loadCompletedEpisode(1, runtimeFailed.load)).toBeNull();

    const canonUnsealed = makeStore();
    await writeEpisodeCompletion({
      episode: makeEpisode(2),
      episodeNumber: 2,
      title: 'Two',
      save: canonUnsealed.save,
      lock: {
        runtimeContractPassed: true,
        canonSealed: false,
        seasonCanonArtifact: 'season-canon.json',
      },
    });
    expect(loadCompletedEpisode(2, canonUnsealed.load)).toBeNull();
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

  it('loads saved QA and validation diagnostics for resumed episodes', async () => {
    const store = makeStore();
    await store.save('episode-2-qa-report.json', { overallScore: 70, stale: true });
    await store.save('episode-2-qa-report.post-repair.json', { overallScore: 91, stale: false });
    await store.save('episode-2-best-practices-report.json', { overallScore: 94, overallPassed: true });
    await store.save('episode-2-incremental-contract.json', { passed: true, warnings: [{ validator: 'RequiredBeatRealizationValidator' }] });

    const diagnostics = loadResumedEpisodeDiagnostics<any, any>(2, store.load);

    expect(diagnostics.qaReport).toEqual({ overallScore: 91, stale: false });
    expect(diagnostics.bestPracticesReport).toEqual({ overallScore: 94, overallPassed: true });
    expect(diagnostics.incrementalContract).toEqual({ passed: true, warnings: [{ validator: 'RequiredBeatRealizationValidator' }] });
  });

  it('invalidates resumed episodes with failed quality evidence or planning-register prose', () => {
    const episode = makeEpisode(3);
    episode.scenes[0].beats = [{
      id: 'b1',
      text: 'Escalate the episode pressure through a concrete turn: rising pressure.',
    }] as any;

    const reasons = findResumedEpisodeInvalidationReasons({
      episode,
      requireQaReport: true,
      requireBestPracticesReport: true,
      qaReport: {
        overallScore: 64,
        passesQA: false,
        criticalIssues: [],
        voice: {
          overallScore: 0,
          recommendations: ['Voice check failed - manual review required'],
        },
      },
      bestPracticesReport: {
        overallPassed: false,
        blockingIssues: [{ category: 'npc_depth' }],
      },
      incrementalContract: {
        passed: true,
        warnings: [{
          type: 'treatment_fidelity_violation',
          validator: 'RequiredBeatRealizationValidator',
          message: 'Authored required beat is missing from the final prose of episode 3 scene "s3-3": "...".',
        }],
      },
    });

    expect(reasons).toEqual(expect.arrayContaining([
      'qa_failed',
      'voice_validation_failed_closed',
      'best_practices_failed',
      'best_practices_blocking_issues',
      'treatment_realization_warning',
      'planning_register_prose',
    ]));
  });

  it('invalidates resumed episodes whose QA score is below the quality floor', () => {
    expect(findResumedEpisodeInvalidationReasons({
      episode: makeEpisode(1),
      qaReport: {
        overallScore: 86,
        passesQA: true,
        criticalIssues: [],
      },
    })).toContain('qa_below_quality_floor');
  });

  it('invalidates resumed episodes when required quality sidecars are missing', () => {
    expect(findResumedEpisodeInvalidationReasons({
      episode: makeEpisode(1),
      requireQaReport: true,
      requireBestPracticesReport: true,
    })).toEqual(['missing_qa_report', 'missing_best_practices_report']);
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

    const watermark = await writeEpisodeCompletion({
      episode,
      episodeNumber: 2,
      title: 'Two',
      save: store.save,
      validation: {
        passed: true,
        gate: 'incremental_contract_ep_2',
        issues: [{ validator: 'FinalStoryContractValidator', severity: 'warning', message: 'advisory', code: 'scene_turn' }],
      },
      lock: {
        runtimeContractPassed: true,
        canonSealed: true,
        incrementalContractArtifact: 'episode-2-incremental-contract.json',
        seasonCanonArtifact: 'season-canon.json',
        seasonLedgerArtifact: 'season-ledger.json',
        episodeStateSnapshotArtifact: 'episode-state-snapshot.json',
      },
      shadowArtifacts: {
        storyId: 'story',
        runId: 'run',
        load: store.load,
      },
    });

    expect(watermark.lock).toMatchObject({
      runtimeContractPassed: true,
      canonSealed: true,
      incrementalContractArtifact: 'episode-2-incremental-contract.json',
      seasonCanonArtifact: 'season-canon.json',
    });
    expect(watermark.artifacts?.runtimeEpisode?.path).toBe('artifacts/episodes/002/runtime-episode.rev1.json');
    expect(watermark.artifacts?.validationReport?.path).toBe('artifacts/episodes/002/validation-report.rev1.json');
    expect(watermark.artifacts?.contextOut?.path).toBe('artifacts/episodes/002/context-out.rev1.json');
    expect(loadCompletedEpisode(2, store.load)?.episode.number).toBe(2);
    const artifactStore = new ArtifactRevisionStore({ save: store.save, load: store.load });
    const runtimeEpisode = artifactStore.loadCurrent('runtime-episode', 2);
    const validationReport = artifactStore.loadCurrent('validation-report', 2);
    expect(runtimeEpisode?.validation.gate).toBe('incremental_contract_ep_2');
    expect(runtimeEpisode?.validation.issues[0]?.code).toBe('scene_turn');
    expect(validationReport?.payload).toMatchObject({
      validation: {
        gate: 'incremental_contract_ep_2',
        issues: [{ code: 'scene_turn' }],
      },
    });
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
    expect(loadCompletedEpisode(2, store.load)?.watermark.artifacts?.upstream).toContainEqual(previousContextOutRef);
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
