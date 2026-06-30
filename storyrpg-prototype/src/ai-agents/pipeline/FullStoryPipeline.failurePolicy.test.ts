import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FullCreativeBrief } from './FullStoryPipeline';

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(async () => {
    throw new Error('not found');
  }),
  deleteAsync: vi.fn(),
}));

async function makePipeline(failurePolicy: 'fail_fast' | 'recover') {
  (globalThis as any).__DEV__ = false;
  const { FullStoryPipeline } = await import('./FullStoryPipeline');
  const { loadConfig } = await import('../config');
  const config = loadConfig();
  config.imageGen = { ...(config.imageGen ?? {}), enabled: false };
  config.videoGen = { ...(config.videoGen ?? {}), enabled: false };
  config.narration = { ...(config.narration ?? {}), enabled: false, preGenerateAudio: false };
  config.memory = {
    ...(config.memory ?? {}),
    enabled: false,
    pipelineOptimization: false,
    characterKnowledge: false,
  };
  config.validation = { ...(config.validation ?? {}), enabled: false, mode: 'advisory' };
  config.generation = {
    ...(config.generation ?? {}),
    failurePolicy,
    assetGenerationMode: 'story-only',
  };
  const pipeline = new FullStoryPipeline(config) as any;
  pipeline.runEpisodeArchitecture = vi.fn(async () => ({
    episodeId: 'episode-1',
    title: 'Episode 1',
    synopsis: 'Test episode.',
    scenes: [],
    startingSceneId: 's1',
  }));
  pipeline.runBranchAnalysis = vi.fn(async () => null);
  pipeline.runContentGeneration = vi.fn(async () => {
    throw new Error('scene writer failed after retry');
  });
  return pipeline;
}

function makeBrief(): FullCreativeBrief {
  return {
    story: {
      title: 'Failure Policy Fixture',
      genre: 'test',
      synopsis: 'A test.',
      tone: 'plain',
      themes: [],
    },
    world: {
      premise: 'A room.',
      timePeriod: 'now',
      technologyLevel: '',
      keyLocations: [],
    },
    protagonist: {
      id: 'hero',
      name: 'Hero',
      pronouns: 'they/them',
      description: '',
      role: 'protagonist',
    },
    npcs: [],
    episode: {
      number: 1,
      title: 'Episode 1',
      synopsis: 'A test episode.',
      startingLocation: 'loc-1',
    },
  };
}

function makeParams(outputDirectory: string, brief = makeBrief()) {
  return {
    episodeNumber: 1,
    episodeIndex: 0,
    episodeOutline: {
      episodeNumber: 1,
      title: 'Episode 1',
      synopsis: 'A test episode.',
      locations: [],
    },
    baseBrief: brief,
    worldBrief: brief,
    characterBrief: brief,
    worldBible: {
      locations: [{ id: 'loc-1', name: 'Room' }],
    },
    characterBible: {
      characters: [{ id: 'hero', name: 'Hero', role: 'protagonist' }],
    },
    outputDirectory,
  };
}

describe('FullStoryPipeline episode failure policy', () => {
  it('rethrows episode generation failures when generation.failurePolicy is fail_fast', async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'storyrpg-fail-fast-'));
    try {
      const pipeline = await makePipeline('fail_fast');
      await expect(
        pipeline.generateEpisodeFromOutline(makeParams(outputDirectory)),
      ).rejects.toThrow('scene writer failed after retry');
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('returns a failed episode result when generation.failurePolicy is recover', async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'storyrpg-recover-'));
    try {
      const pipeline = await makePipeline('recover');
      const result = await pipeline.generateEpisodeFromOutline(makeParams(outputDirectory));
      expect(result.result).toMatchObject({
        episodeNumber: 1,
        title: 'Episode 1',
        success: false,
        error: 'scene writer failed after retry',
      });
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
