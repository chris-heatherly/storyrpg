import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { resolveStoryFolderPath } = require('./storyMutationRoutes.js');

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
