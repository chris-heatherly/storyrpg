import { describe, expect, it, vi } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

vi.mock('../../validators/storyAssetWalker', () => ({
  walkStoryAssets: vi.fn(async () => ({ missing: 0, broken: 0, unreachable: 0, verified: 3 })),
  formatAssetWalkReport: vi.fn(() => 'asset walk: all good'),
}));

import { AssemblyPhase, AssemblyPhaseDeps, AssemblyPhaseInput } from './AssemblyPhase';
import { walkStoryAssets } from '../../validators/storyAssetWalker';
import { PipelineError } from '../errors';
import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';

function makeStory(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'story-1',
    title: 'Test Story',
    coverImage: 'img://cover',
    episodes: [
      {
        id: 'ep-1',
        coverImage: 'img://ep-cover',
        scenes: [
          {
            id: 'scene-1',
            backgroundImage: 'img://bg',
            beats: [{ id: 'beat-1', text: 'Something happens.', image: 'img://beat' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AssemblyPhaseDeps> = {}): AssemblyPhaseDeps {
  return {
    assetRegistry: { toSnapshot: vi.fn(() => ({})) } as any,
    assembleStory: vi.fn(() => makeStory()),
    recordRemediationSafe: vi.fn(async () => undefined),
    runFlagChronologyScan: vi.fn(() => []),
    saveDraftImageManifest: vi.fn(async () => undefined),
    buildImageManifestFromStory: vi.fn(() => ({ imagesStatus: 'complete' as any })),
    ...overrides,
  };
}

function makeInput(overrides: Partial<AssemblyPhaseInput> = {}): AssemblyPhaseInput {
  return {
    brief: {
      story: { title: 'Test Story', genre: 'fantasy', tone: 'hopeful' },
      episode: { number: 1, title: 'Pilot' },
      protagonist: { id: 'hero', name: 'Hero', pronouns: 'they/them', description: 'a hero' },
      world: { premise: 'a world' },
      options: {},
    } as any,
    worldBible: { locations: [] } as any,
    characterBible: { characters: [] } as any,
    episodeBlueprint: { scenes: [] } as any,
    sceneContents: [] as any,
    choiceSets: [] as any,
    encounters: new Map(),
    outputDirectory: '/tmp/out/',
    ...overrides,
  };
}

function makeContext(events: PipelineEvent[], config: Record<string, unknown> = {}): PipelineContext {
  return {
    config: {
      validation: { enabled: true },
      generation: {},
      imageGen: { enabled: false },
      ...config,
    } as any,
    emit: (event) => events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  } as PipelineContext;
}

// The registry coverage validator reads required slots from the registry; an
// empty mock registry yields no required keys, so the gate passes unless the
// story walk itself finds missing images.
vi.mock('../../images/coverageValidator', () => ({
  validateRegistryCoverage: vi.fn(() => ({ missingRequiredCoverageKeys: [] })),
}));
vi.mock('../../images/storyAssetAssembler', () => ({
  assembleStoryAssetsFromRegistry: vi.fn((story) => story),
}));

describe('AssemblyPhase', () => {
  it('assembles the story without template mutation and stamps imagesStatus', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const context = makeContext(events, { imageGen: { enabled: true } });

    const story = await new AssemblyPhase(deps).run(makeInput(), context);

    expect(deps.assembleStory).toHaveBeenCalledTimes(1);
    expect(story.imagesStatus).toBe('complete');
    expect(events.some(e => e.type === 'phase_start' && (e as any).phase === 'assembly')).toBe(true);
    // Full coverage in the fixture: no completeness-gate throw, asset walk ran
    expect(walkStoryAssets).toHaveBeenCalledTimes(1);
  });

  it('throws PipelineError when images are missing outside story-only mode', async () => {
    const incomplete = makeStory();
    incomplete.episodes[0].scenes[0].beats[0].image = undefined;
    const deps = makeDeps({ assembleStory: vi.fn(() => incomplete) });
    const events: PipelineEvent[] = [];
    const context = makeContext(events, { imageGen: { enabled: true } });

    await expect(new AssemblyPhase(deps).run(makeInput(), context))
      .rejects.toBeInstanceOf(PipelineError);
  });

  it('skips the completeness gate in story-only mode and marks images pending', async () => {
    const incomplete = makeStory({ coverImage: undefined });
    const deps = makeDeps({ assembleStory: vi.fn(() => incomplete) });
    const events: PipelineEvent[] = [];
    const context = makeContext(events, { generation: { assetGenerationMode: 'story-only' } });

    const story = await new AssemblyPhase(deps).run(makeInput(), context);

    expect(story.imagesStatus).toBe('pending');
    expect(deps.saveDraftImageManifest).toHaveBeenCalledWith('/tmp/out/', story);
  });

  it('escalates flag-chronology and quote-recall findings onto the QA report in place', async () => {
    const deps = makeDeps({
      runFlagChronologyScan: vi.fn(() => ['scene-2 references flag set in scene-3']),
    });
    const qaReport: any = { passesQA: true, criticalIssues: [], overallScore: 90 };
    const events: PipelineEvent[] = [];
    const context = makeContext(events, { generation: { assetGenerationMode: 'story-only' } });

    await new AssemblyPhase(deps).run(makeInput({ qaReport }), context);

    expect(qaReport.criticalIssues).toContain('scene-2 references flag set in scene-3');
    expect(qaReport.passesQA).toBe(false);
    expect(events.some(e => e.type === 'warning'
      && (e as any).message.includes('flag chronology scan found 1'))).toBe(true);
  });
});
