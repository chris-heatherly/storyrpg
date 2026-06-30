import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { atomicWriteJsonSync } = require('./atomicIo.js');
const manifestModule = require('./storyManifest.js');
const { resolveStoryFolderPath, rewriteStoryFileEpisodes } = require('./storyMutationRoutes.js');

describe('storyMutationRoutes resolveStoryFolderPath', () => {
  it('resolves generated-stories output dirs to the local story folder', () => {
    const storiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-open-folder-'));
    const storyDir = path.join(storiesDir, 'demo-run');
    fs.mkdirSync(storyDir);

    expect(resolveStoryFolderPath(storiesDir, 'generated-stories/demo-run/')).toBe(storyDir);
    expect(resolveStoryFolderPath(storiesDir, 'generated-stories/demo-run/images/cover.png')).toBe(storyDir);
  });

  it('rejects traversal and remote output dirs', () => {
    const storiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-open-folder-'));

    expect(() => resolveStoryFolderPath(storiesDir, 'generated-stories/../secrets')).toThrow(
      /within generated-stories/,
    );
    expect(() => resolveStoryFolderPath(storiesDir, 'https://example.com/generated-stories/demo-run/')).toThrow(
      /local generated story folder/,
    );
  });
});

describe('storyMutationRoutes rewriteStoryFileEpisodes', () => {
  it('removes only the requested episode and updates the primary manifest hash', () => {
    const storyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-delete-episode-'));
    const storyFileAbs = path.join(storyDir, 'story.json');
    const storyPackage = {
      schemaVersion: 3,
      storyId: 'story-1',
      createdAt: '2026-06-28T00:00:00.000Z',
      generator: { pipeline: 'test' },
      assets: {},
      story: {
        id: 'story-1',
        title: 'Harbor Light',
        genre: 'mystery',
        synopsis: 'A lighthouse mystery.',
        metadata: {},
        initialState: {},
        episodes: [
          { id: 'ep-1', number: 1, title: 'One', scenes: [] },
          { id: 'ep-2', number: 2, title: 'Two', scenes: [] },
          { id: 'ep-3', number: 3, title: 'Three', scenes: [] },
        ],
      },
    };
    const { sha256, bytes } = atomicWriteJsonSync(storyFileAbs, storyPackage, { pretty: true });
    manifestModule.writeManifest(storyDir, manifestModule.buildManifest({
      storyId: 'story-1',
      storySchemaVersion: 3,
      primaryStoryFile: 'story.json',
      primaryStoryHash: sha256,
      primaryStoryBytes: bytes,
      generator: { pipeline: 'test' },
    }));

    const removed = rewriteStoryFileEpisodes(storyDir, storyFileAbs, 'story-1', 2, true);
    const rewritten = JSON.parse(fs.readFileSync(storyFileAbs, 'utf8'));
    const manifest = manifestModule.readManifest(storyDir);
    const diskHash = manifestModule.sha256OfFileSync(storyFileAbs);

    expect(removed).toBe(1);
    expect(rewritten.story.episodes.map((episode) => episode.number)).toEqual([1, 3]);
    expect(manifest.files['story.json'].sha256).toBe(diskHash.sha256);
    expect(manifest.files['story.json'].bytes).toBe(diskHash.bytes);
  });
});
