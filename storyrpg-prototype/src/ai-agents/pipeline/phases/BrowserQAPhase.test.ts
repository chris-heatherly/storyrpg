import { describe, expect, it, vi, beforeEach } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

const runPlaywrightQAMultiPath = vi.fn();
const remediateImageIssues = vi.fn();
const assembleStoryAssetsFromRegistry = vi.fn();
const resaveFinalStory = vi.fn();

vi.mock('../../validators/playwrightQARunner', () => ({
  runPlaywrightQAMultiPath: (...args: unknown[]) => runPlaywrightQAMultiPath(...args),
}));
vi.mock('../../validators/qaRemediation', () => ({
  remediateImageIssues: (...args: unknown[]) => remediateImageIssues(...args),
  resaveFinalStory: (...args: unknown[]) => resaveFinalStory(...args),
}));
vi.mock('../../images/storyAssetAssembler', () => ({
  assembleStoryAssetsFromRegistry: (...args: unknown[]) => assembleStoryAssetsFromRegistry(...args),
}));

import { BrowserQAPhase } from './BrowserQAPhase';
import type { PipelineEvent } from '../events';

function makeContext(events: PipelineEvent[], maxRetries = 1) {
  return {
    config: { validation: { playwrightQAMaxRetries: maxRetries } } as any,
    emit: (event: Omit<PipelineEvent, 'timestamp'>) =>
      events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  };
}

const deps = { imageService: {} as any, assetRegistry: {} as any };
const story = { id: 'story-1' } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BrowserQAPhase', () => {
  it('completes on a clean first pass', async () => {
    runPlaywrightQAMultiPath.mockResolvedValueOnce({
      passed: true,
      skipped: false,
      imageIssues: [],
      networkFailures: [],
      totalBeats: 10,
      coverageReport: { completedPaths: 2, totalPaths: 2, totalChoicesMade: 4 },
    });

    const events: PipelineEvent[] = [];
    const result = await new BrowserQAPhase(deps).run(
      { story, storyTitle: 'T', outputDirectory: '/out/' },
      makeContext(events)
    );

    expect(result).toBe(story);
    expect(runPlaywrightQAMultiPath).toHaveBeenCalledTimes(1);
    expect(events.at(-1)?.type).toBe('phase_complete');
  });

  it('remediates, re-saves the replaced story, and re-tests', async () => {
    runPlaywrightQAMultiPath
      .mockResolvedValueOnce({
        passed: false,
        skipped: false,
        imageIssues: [{ id: 1 }],
        networkFailures: [],
        totalBeats: 10,
        coverageReport: null,
      })
      .mockResolvedValueOnce({
        passed: true,
        skipped: false,
        imageIssues: [],
        networkFailures: [],
        totalBeats: 10,
        coverageReport: null,
      });
    remediateImageIssues.mockResolvedValueOnce({
      hasChanges: true,
      fixes: [{ action: 'regenerated', identifier: 'img-1' }],
    });
    const reassembled = { id: 'story-1', reassembled: true } as any;
    assembleStoryAssetsFromRegistry.mockReturnValueOnce(reassembled);

    const events: PipelineEvent[] = [];
    const result = await new BrowserQAPhase(deps).run(
      { story, storyTitle: 'T', outputDirectory: '/out/' },
      makeContext(events)
    );

    expect(result).toBe(reassembled);
    expect(result.outputDir).toBe('/out/');
    expect(resaveFinalStory).toHaveBeenCalledWith(reassembled, '/out/');
    expect(runPlaywrightQAMultiPath).toHaveBeenCalledTimes(2);
  });

  it('stops after the skip signal without retrying', async () => {
    runPlaywrightQAMultiPath.mockResolvedValueOnce({
      passed: false,
      skipped: true,
      skipReason: 'no app running',
      imageIssues: [],
      networkFailures: [],
    });

    const events: PipelineEvent[] = [];
    await new BrowserQAPhase(deps).run(
      { story, storyTitle: 'T', outputDirectory: '/out/' },
      makeContext(events)
    );

    expect(runPlaywrightQAMultiPath).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.message.includes('Browser QA skipped'))).toBe(true);
  });

  it('treats QA runner errors as non-fatal warnings', async () => {
    runPlaywrightQAMultiPath.mockRejectedValueOnce(new Error('playwright exploded'));

    const events: PipelineEvent[] = [];
    const result = await new BrowserQAPhase(deps).run(
      { story, storyTitle: 'T', outputDirectory: '/out/' },
      makeContext(events)
    );

    expect(result).toBe(story);
    expect(events.some((e) => e.type === 'warning' && e.message.includes('Browser QA failed'))).toBe(true);
  });

  it('reports unresolved issues after exhausting retries', async () => {
    const failing = {
      passed: false,
      skipped: false,
      imageIssues: [{ id: 1 }],
      networkFailures: [{ id: 2 }],
      totalBeats: 5,
      coverageReport: null,
    };
    runPlaywrightQAMultiPath.mockResolvedValue(failing);
    remediateImageIssues.mockResolvedValue({ hasChanges: true, fixes: [] });
    assembleStoryAssetsFromRegistry.mockReturnValue(story);

    const events: PipelineEvent[] = [];
    await new BrowserQAPhase(deps).run(
      { story, storyTitle: 'T', outputDirectory: '/out/' },
      makeContext(events, 1)
    );

    expect(events.at(-1)?.message).toContain('unresolved issue(s)');
  });
});
