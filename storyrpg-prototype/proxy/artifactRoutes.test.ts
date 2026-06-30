import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { scanArtifactRun } = require('./artifactRoutes.js');

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function artifactRef(kind: string, revision: number, episodeNumber?: number) {
  const episodeDir = typeof episodeNumber === 'number'
    ? `artifacts/episodes/${String(episodeNumber).padStart(3, '0')}`
    : 'artifacts';
  return {
    kind,
    artifactId: `story:run:${episodeNumber ?? 'global'}:${kind}:rev-${revision}`,
    payloadHash: `hash-${kind}-${revision}`,
    revision,
    path: `${episodeDir}/${kind}.rev${revision}.json`,
    episodeNumber,
  };
}

function writeArtifact(runDir: string, ref: ReturnType<typeof artifactRef>, upstream = []) {
  writeJson(path.join(runDir, ref.path), {
    kind: ref.kind,
    artifactId: ref.artifactId,
    payloadHash: ref.payloadHash,
    revision: ref.revision,
    status: 'valid',
    validation: { passed: true, issues: [] },
    upstream,
    payload: {},
  });
}

function writeCurrent(runDir: string, episodeNumber: number, refs: Array<ReturnType<typeof artifactRef>>) {
  writeJson(path.join(runDir, 'artifacts', 'episodes', String(episodeNumber).padStart(3, '0'), 'current.json'), {
    version: 1,
    updatedAt: new Date().toISOString(),
    artifacts: Object.fromEntries(refs.map((ref) => [ref.kind, ref])),
  });
}

describe('artifactRoutes', () => {
  it('marks downstream episode artifacts stale when an upstream current pointer changes', () => {
    const storiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-artifacts-'));
    const runDir = path.join(storiesDir, 'run-a');
    const ep1ContextRev1 = artifactRef('context-out', 1, 1);
    const ep1ContextRev2 = artifactRef('context-out', 2, 1);
    const ep2ContextIn = artifactRef('context-in', 1, 2);

    writeArtifact(runDir, ep1ContextRev1);
    writeArtifact(runDir, ep1ContextRev2);
    writeArtifact(runDir, ep2ContextIn, [ep1ContextRev1]);
    writeCurrent(runDir, 1, [ep1ContextRev2]);
    writeCurrent(runDir, 2, [ep2ContextIn]);

    const scan = scanArtifactRun(storiesDir, 'run-a');

    expect(scan.status).toBe('stale');
    expect(scan.episodes.find((episode: { episodeNumber: number }) => episode.episodeNumber === 2).status).toBe('stale');
  });

  it('reports canon, lock, and unresolved obligation health for a run', () => {
    const storiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-artifacts-'));
    const runDir = path.join(storiesDir, 'run-health');
    const contextOut = artifactRef('context-out', 1, 1);
    const runtime = artifactRef('runtime-episode', 1, 1);

    writeArtifact(runDir, contextOut);
    writeJson(path.join(runDir, contextOut.path), {
      kind: contextOut.kind,
      artifactId: contextOut.artifactId,
      payloadHash: contextOut.payloadHash,
      revision: contextOut.revision,
      status: 'valid',
      validation: { passed: true, issues: [] },
      upstream: [],
      payload: {
        unresolvedObligations: [
          { id: 'cb-1', kind: 'callback', description: 'Pay this later.' },
          { id: 'arc-1', kind: 'character_arc', description: 'Move the lie.' },
        ],
      },
    });
    writeArtifact(runDir, runtime, [contextOut]);
    writeCurrent(runDir, 1, [contextOut, runtime]);
    writeJson(path.join(runDir, 'checkpoints', 'episode-1-complete.json'), {
      version: 1,
      episodeNumber: 1,
      title: 'One',
      completedAt: new Date().toISOString(),
      sceneCount: 1,
      assembledArtifact: 'checkpoints/episode-1-assembled.json',
      lock: {
        runtimeContractPassed: true,
        sceneLocksPassed: true,
        sceneLockArtifact: 'episode-1-scene-locks.json',
        canonSealed: true,
        incrementalContractArtifact: 'episode-1-incremental-contract.json',
        seasonCanonArtifact: 'season-canon.json',
      },
    });
    writeJson(path.join(runDir, 'episode-1-scene-locks.json'), {
      version: 1,
      episodeNumber: 1,
      expectedSceneIds: ['s1'],
      lockedSceneCount: 1,
      passed: true,
      locks: [{ sceneId: 's1', sceneName: 'Opening', passed: true }],
      validation: { passed: true, issues: [] },
    });
    writeJson(path.join(runDir, 'season-canon.json'), {
      version: 1,
      storyId: 'story',
      sealedEpisodes: [1],
      worldFacts: [{ id: 'fact', statement: 'Fact.', establishedEpisode: 1 }],
      knowledge: [{ characterId: 'protagonist', factId: 'fact', summary: 'Knows fact.', asOfEpisode: 1 }],
      relationships: [],
      numericViolations: [],
    });

    const scan = scanArtifactRun(storiesDir, 'run-health');

    expect(scan.canon).toMatchObject({
      present: true,
      sealedEpisodeCount: 1,
      worldFactCount: 1,
      knowledgeCount: 1,
    });
    expect(scan.episodes[0].lock).toMatchObject({
      locked: true,
      runtimeContractPassed: true,
      sceneLocksPassed: true,
      sceneLockArtifact: 'episode-1-scene-locks.json',
      canonSealed: true,
    });
    expect(scan.episodes[0].sceneLocks).toMatchObject({
      present: true,
      artifact: 'episode-1-scene-locks.json',
      passed: true,
      expectedSceneCount: 1,
      lockedSceneCount: 1,
      issueCount: 0,
    });
    expect(scan.episodes[0].obligations).toEqual({
      unresolvedCount: 2,
      byKind: { callback: 1, character_arc: 1 },
    });
  });

  it('reports failed scene locks as an unlocked episode health reason', () => {
    const storiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-artifacts-'));
    const runDir = path.join(storiesDir, 'run-scene-lock-failed');
    const runtime = artifactRef('runtime-episode', 1, 1);

    writeArtifact(runDir, runtime);
    writeCurrent(runDir, 1, [runtime]);
    writeJson(path.join(runDir, 'checkpoints', 'episode-1-complete.json'), {
      version: 1,
      episodeNumber: 1,
      title: 'One',
      completedAt: new Date().toISOString(),
      sceneCount: 2,
      assembledArtifact: 'checkpoints/episode-1-assembled.json',
      lock: {
        runtimeContractPassed: true,
        sceneLocksPassed: true,
        sceneLockArtifact: 'episode-1-scene-locks.json',
      },
    });
    writeJson(path.join(runDir, 'episode-1-scene-locks.json'), {
      version: 1,
      episodeNumber: 1,
      expectedSceneIds: ['s1', 's2'],
      lockedSceneCount: 1,
      passed: false,
      locks: [{ sceneId: 's1', sceneName: 'Opening', passed: true }],
      validation: {
        passed: false,
        issues: [{
          validator: 'SceneLockGate',
          severity: 'error',
          code: 'missing_scene_validation_lock',
          path: 'episodes[1].scenes[s2]',
        }],
      },
    });

    const scan = scanArtifactRun(storiesDir, 'run-scene-lock-failed');

    expect(scan.episodes[0].lock.locked).toBe(false);
    expect(scan.episodes[0].lock.reasons).toContain('scene locks failed');
    expect(scan.episodes[0].sceneLocks).toMatchObject({
      present: true,
      passed: false,
      expectedSceneCount: 2,
      lockedSceneCount: 1,
      missingSceneIds: ['s2'],
      issueCount: 1,
    });
  });
});
