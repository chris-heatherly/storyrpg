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
});
