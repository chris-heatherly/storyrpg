import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Story } from '../../types';
import { writeFinalStoryPackage } from './pipelineOutputWriter';

vi.mock('expo-file-system', () => ({
  default: {},
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

const tempDirs: string[] = [];

function makeStory(): Story {
  return {
    id: 'story-writer-test',
    title: 'Story Writer Test',
    genre: 'Mystery',
    synopsis: 'A tiny story package fixture.',
    coverImage: '',
    author: 'Test',
    tags: [],
    initialState: {
      attributes: {
        charm: 0,
        wit: 0,
        courage: 0,
        empathy: 0,
        resolve: 0,
        resourcefulness: 0,
      },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes: [
      {
        id: 'episode-1',
        number: 1,
        title: 'Episode 1',
        synopsis: 'Test episode.',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene 1',
            startingBeatId: 'beat-1',
            beats: [{ id: 'beat-1', text: 'The package writes.', choices: [] }],
          },
        ],
      },
    ],
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('pipelineOutputWriter', () => {
  it('writes final story packages through Node built-in modules when require is unavailable', async () => {
    const originalGetBuiltinModule = process.getBuiltinModule;
    const requestedModules: string[] = [];
    vi.spyOn(process, 'getBuiltinModule').mockImplementation(((name: string) => {
      requestedModules.push(name);
      return originalGetBuiltinModule(name);
    }) as typeof process.getBuiltinModule);

    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    const result = await writeFinalStoryPackage(outputDir, makeStory(), {
      generator: { version: 'test', pipeline: 'vitest' },
    });

    await expect(readFile(result.storyJsonPath, 'utf8')).resolves.toContain('story-writer-test');
    await expect(readFile(result.manifestPath, 'utf8')).resolves.toContain('story.json');
    await expect(readFile(`${outputDir}08-final-story.json`, 'utf8')).resolves.toContain('Story Writer Test');
    expect(requestedModules).toEqual(expect.arrayContaining(['fs', 'path', 'crypto']));
  });
});
