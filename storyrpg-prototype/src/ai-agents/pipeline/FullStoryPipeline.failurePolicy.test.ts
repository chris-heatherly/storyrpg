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
  it('surfaces terminal failure fingerprints as worker checkpoints', async () => {
    const pipeline = await makePipeline('fail_fast');

    expect((pipeline as any).mapCheckpointPhaseToStepId('failure_fingerprint'))
      .toBe('failure_fingerprint');
  });

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

  it('normalizes stale resumed blueprints before content generation gates run', async () => {
    const pipeline = await makePipeline('fail_fast');
    const blueprint: any = {
      episodeId: 'episode-1',
      title: 'Episode 1',
      synopsis: 'Test episode.',
      arc: {},
      themes: [],
      startingSceneId: 's1-cold-open',
      bottleneckScenes: [],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
      narrativePromises: [],
      scenes: [
        {
          id: 's1-cold-open',
          episodeNumber: 1,
          order: 0,
          name: 'Cold open',
          description: 'A traveler reaches the city threshold.',
          location: 'Station',
          mood: 'charged',
          purpose: 'transition',
          dramaticQuestion: 'Will the traveler cross?',
          wantVsNeed: 'The traveler wants anonymity but needs action.',
          conflictEngine: 'The threshold demands action.',
          npcsPresent: [],
          narrativeFunction: 'A traveler reaches the city threshold.',
          keyBeats: [],
          leadsTo: ['s1-guide'],
          coldOpenProfile: {
            id: 'cold-open:1:s1-cold-open',
            episodeNumber: 1,
            sceneId: 's1-cold-open',
            mode: 'new_normal',
            archetype: 'status_quo_shift',
            storyCircleBeats: ['you', 'need'],
            storyCircleFulfillment: {
              beats: ['you', 'need'],
              baseline: 'A traveler arrives wounded.',
              need: 'The traveler needs to act.',
              collision: 'Arrival forces action.',
              sourceContractIds: ['you', 'need'],
            },
            centralTurn: 'A traveler reaches the city threshold.',
            microConflict: 'The traveler wants anonymity, but the threshold demands action.',
            openQuestion: 'Will the traveler cross?',
            activeCastLimit: 1,
            beatBudget: { min: 6, recommended: 8, max: 10 },
            exitHook: 'End on the threshold.',
            sourceContractIds: ['you', 'need'],
            selectedConcepts: [],
          },
          requiredBeats: [{
            id: 'opening-arrival',
            tier: 'coldopen',
            sourceTurn: 'A traveler reaches the city threshold.',
            mustDepict: 'A traveler reaches the city threshold.',
          }],
        },
        {
          id: 's1-guide',
          episodeNumber: 1,
          order: 1,
          name: 'Guide',
          description: 'A guide opens the next door.',
          location: 'Station',
          mood: 'charged',
          purpose: 'transition',
          dramaticQuestion: 'Will the traveler accept help?',
          wantVsNeed: 'The traveler wants control but needs help.',
          conflictEngine: 'The guide has terms.',
          npcsPresent: [],
          narrativeFunction: 'A guide opens the next door.',
          keyBeats: [],
          leadsTo: [],
          turnContract: {
            turnId: 'guide-turn',
            source: 'planner',
            centralTurn: 'A guide opens the next door.',
            beforeState: 'The traveler is alone.',
            turnEvent: 'A guide opens the next door.',
            afterState: 'The traveler has a way forward.',
            handoff: 'Enter the next threshold.',
          },
          requiredBeats: [
            {
              id: 'duplicate-cold-open',
              tier: 'coldopen',
              sourceTurn: 'A traveler reaches the city threshold.',
              mustDepict: 'A traveler reaches the city threshold.',
            },
            {
              id: 'project-logline',
              tier: 'authored',
              sourceTurn: 'She starts Dating After Dusk.',
              mustDepict: 'She starts Dating After Dusk.',
            },
          ],
        },
      ],
    };

    const result = pipeline.finalizeEpisodeBlueprintSceneOwnershipForPipeline({
      blueprint,
      episodeNumber: 1,
      source: 'pipeline_resume',
    });

    expect(result.wasStale).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.drainedRequiredBeatIds).toEqual(expect.arrayContaining(['project-logline']));
    expect(blueprint.sceneOwnershipStamp.version).toBe('episode-scene-ownership-v2');
    expect(blueprint.scenes[1].requiredBeats).toEqual([]);
  });
});
