import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { atomicWriteJsonSync } = require('./atomicIo.js');
const storyManifest = require('./storyManifest.js');
const { createStoryCatalog } = require('./storyCatalog.js');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeRun(root: string, runDir: string, disposition: Record<string, unknown>, mtimeMs: number): void {
  const dir = path.join(root, runDir);
  fs.mkdirSync(dir, { recursive: true });
  const storyFile = path.join(dir, 'story.json');
  const pkg = {
    schemaVersion: 3,
    storyId: 'bite-me',
    createdAt: new Date(mtimeMs).toISOString(),
    generator: { pipeline: 'test' },
    assets: {},
    story: {
      id: 'bite-me', title: runDir, genre: 'romance', synopsis: runDir,
      metadata: {}, initialState: {}, npcs: [],
      episodes: [{ id: 'ep-1', number: 1, title: 'Episode 1', synopsis: '', startingSceneId: 's1', scenes: [{ id: 's1', name: 'One', startingBeatId: 'b1', beats: [{ id: 'b1', text: 'You arrive.' }] }] }],
    },
  };
  const written = atomicWriteJsonSync(storyFile, pkg, { pretty: true });
  storyManifest.writeManifest(dir, storyManifest.buildManifest({
    storyId: 'bite-me', storySchemaVersion: 3, primaryStoryFile: 'story.json',
    primaryStoryHash: written.sha256, primaryStoryBytes: written.bytes,
  }));
  atomicWriteJsonSync(path.join(dir, 'quality-disposition.json'), disposition, { pretty: true });
  fs.utimesSync(storyFile, mtimeMs / 1000, mtimeMs / 1000);
}

describe('story catalog quality promotion', () => {
  it('keeps a newer held candidate out of the reader while preserving generator inspection', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-catalog-quality-'));
    roots.push(root);
    writeRun(root, 'bite-me-r115', {
      version: 1, status: 'promoted', band: 'ship', eligibleForReader: true,
      reasonCodes: [], score: 79, capIds: [], blockingCapCount: 0, qaEvidenceStale: false, createdAt: '2026-07-18T00:00:00Z',
    }, 1_000);
    writeRun(root, 'bite-me-r127', {
      version: 1, status: 'held', band: 'warn', eligibleForReader: false,
      reasonCodes: ['best_known_regression'], score: 74, capIds: ['semantic'], blockingCapCount: 1, qaEvidenceStale: false, createdAt: '2026-07-19T00:00:00Z',
    }, 2_000);
    const catalog = createStoryCatalog(root, 3001);

    const reader = await catalog.listLatestStoryRecords();
    const generator = await catalog.listLatestStoryRecords({ includeHeld: true });

    expect(reader).toHaveLength(1);
    expect(reader[0].dirName).toBe('bite-me-r115');
    expect(generator).toHaveLength(1);
    expect(generator[0].dirName).toBe('bite-me-r127');
    expect(generator[0].qualityDisposition.status).toBe('held');
  });

  it('keeps the best promoted package when a newer equally complete run scores lower', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-catalog-baseline-'));
    roots.push(root);
    writeRun(root, 'bite-me-r115', {
      version: 1, status: 'promoted', band: 'ship', eligibleForReader: true,
      reasonCodes: [], score: 79, capIds: [], blockingCapCount: 0, qaEvidenceStale: false, createdAt: '2026-07-18T00:00:00Z',
    }, 1_000);
    writeRun(root, 'bite-me-r128', {
      version: 1, status: 'promoted', band: 'ship', eligibleForReader: true,
      reasonCodes: [], score: 75, capIds: [], blockingCapCount: 0, qaEvidenceStale: false, createdAt: '2026-07-20T00:00:00Z',
    }, 2_000);
    const catalog = createStoryCatalog(root, 3001);

    const records = await catalog.listLatestStoryRecords();

    expect(records).toHaveLength(1);
    expect(records[0].dirName).toBe('bite-me-r115');
  });
});
