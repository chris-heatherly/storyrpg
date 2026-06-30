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

import { BranchAnalysisPhase, BranchAnalysisPhaseDeps } from './BranchAnalysisPhase';
import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';

function makeBlueprint(): any {
  return {
    episodeId: 'ep-1',
    title: 'Pilot',
    startingSceneId: 'scene-1',
    endingSceneId: 'scene-2',
    scenes: [
      { id: 'scene-1', name: 'Opening', leadsTo: ['scene-2'] },
      { id: 'scene-2', name: 'Closing', leadsTo: [] },
    ],
    bottleneckScenes: [],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
  };
}

function makeAnalysis(): any {
  return {
    branchPaths: [{ id: 'path-1', sceneSequence: ['scene-1', 'scene-2'] }],
    reconvergencePoints: [],
    validationIssues: [],
    recommendations: [],
  };
}

function makeDeps(overrides: Partial<BranchAnalysisPhaseDeps> = {}): BranchAnalysisPhaseDeps {
  return {
    branchManager: { execute: vi.fn(async () => ({ success: true, data: makeAnalysis() })) } as any,
    branchShadowDiffs: [],
    ...overrides,
  };
}

function makeBrief(): any {
  return {
    story: { title: 'Test Story', genre: 'fantasy', tone: 'hopeful' },
    episode: { number: 1 },
  };
}

function makeContext(events: PipelineEvent[], generation: Record<string, unknown> = {}): PipelineContext {
  return {
    config: { validation: { enabled: true }, generation } as any,
    emit: (event) => events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  } as PipelineContext;
}

describe('BranchAnalysisPhase', () => {
  it('returns the analysis and emits agent events', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];

    const result = await new BranchAnalysisPhase(deps).run(makeBrief(), makeBlueprint(), makeContext(events));

    expect(result?.branchPaths).toHaveLength(1);
    expect(events.some(e => e.type === 'agent_complete'
      && (e as any).message.includes('Found 1 paths'))).toBe(true);
  });

  it('returns null (advisory) when the agent fails', async () => {
    const deps = makeDeps({
      branchManager: { execute: vi.fn(async () => ({ success: false, error: 'parse failure' })) } as any,
    });
    const events: PipelineEvent[] = [];

    const result = await new BranchAnalysisPhase(deps).run(makeBrief(), makeBlueprint(), makeContext(events));

    expect(result).toBeNull();
    expect(events.some(e => e.type === 'agent_complete'
      && (e as any).message.includes('failed (non-critical)'))).toBe(true);
  });

  it('returns null when the agent throws', async () => {
    const deps = makeDeps({
      branchManager: { execute: vi.fn(async () => { throw new Error('boom'); }) } as any,
    });
    const events: PipelineEvent[] = [];

    const result = await new BranchAnalysisPhase(deps).run(makeBrief(), makeBlueprint(), makeContext(events));

    expect(result).toBeNull();
    expect(events.some(e => e.type === 'warning'
      && (e as any).message === 'Branch analysis skipped due to error')).toBe(true);
  });

  it('captures a shadow diff into the accessor-backed sink when shadow mode is on', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];

    await new BranchAnalysisPhase(deps).run(
      makeBrief(), makeBlueprint(), makeContext(events, { branchShadowModeEnabled: true }),
    );

    expect(deps.branchShadowDiffs).toHaveLength(1);
    expect(deps.branchShadowDiffs[0].episodeId).toBe('ep-1');
  });

  it('emits advisory warnings for validation issues and deterministic dead ends', async () => {
    const analysis = makeAnalysis();
    analysis.validationIssues = [{ type: 'orphan', description: 'scene-3 unreachable' }];
    const blueprint = makeBlueprint();
    blueprint.scenes.push({ id: 'scene-3', name: 'Orphan', leadsTo: [] });
    const deps = makeDeps({
      branchManager: { execute: vi.fn(async () => ({ success: true, data: analysis })) } as any,
    });
    const events: PipelineEvent[] = [];

    await new BranchAnalysisPhase(deps).run(makeBrief(), blueprint, makeContext(events));

    expect(events.some(e => e.type === 'warning'
      && (e as any).message === '[orphan] scene-3 unreachable')).toBe(true);
    expect(events.some(e => e.type === 'warning'
      && (e as any).message.includes('[deterministic] Scene scene-3'))).toBe(true);
  });
});
