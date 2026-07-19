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

import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';
import { QAPhase, type QAPhaseDeps, type QAPhaseInput } from './QAPhase';

function makeQAReport(overrides: Record<string, unknown> = {}): any {
  return {
    overallScore: 90,
    passesQA: true,
    criticalIssues: [],
    continuity: { issues: [] },
    stakes: { metrics: { falseChoiceCount: 0 }, choiceSetAnalysis: [] },
    skippedChecks: [],
    ...overrides,
  };
}

function makeBPReport(): any {
  return { overallPassed: true, overallScore: 88, blockingIssues: [], warnings: [], suggestions: [] };
}

function makeDeps(overrides: Partial<QAPhaseDeps> = {}): QAPhaseDeps {
  return {
    qaRunner: { runFullQA: vi.fn(async () => makeQAReport()) } as any,
    integratedValidator: { runFullValidation: vi.fn(async () => makeBPReport()) } as any,
    distributionValidator: {
      validate: vi.fn(() => ({ score: 80 })),
      computeMetrics: vi.fn(() => ({
        actualPercentages: { expression: 50, relationship: 50 },
        branchingCount: 1,
        branchingCap: 3,
      })),
    } as any,
    incrementalValidator: null,
    sceneValidationResults: [],
    requirePhases: vi.fn(),
    markPhaseComplete: vi.fn(),
    measurePhase: (_phase, fn) => fn(),
    emitPhaseProgress: vi.fn(),
    prepareValidationInput: vi.fn(() => ({ scenes: [], choiceSets: [] }) as any),
    buildContinuityCharacterKnowledge: vi.fn(() => []),
    buildContinuityTimeline: vi.fn(() => []),
    ...overrides,
  };
}

function makeInput(overrides: Partial<QAPhaseInput> = {}): QAPhaseInput {
  return {
    brief: {
      story: { title: 'Test Story', genre: 'fantasy', tone: 'hopeful', themes: ['trust'] },
      episode: { number: 1, title: 'Pilot' },
      protagonist: { id: 'hero', name: 'Hero', pronouns: 'they/them', description: 'a hero' },
      world: { premise: 'a world' },
      options: {},
    } as any,
    worldBible: { locations: [], worldRules: [], tensions: [] } as any,
    characterBible: { characters: [] } as any,
    episodeBlueprint: {
      scenes: [{ id: 'scene-1', name: 'Scene One', location: 'loc-1', npcsPresent: [], leadsTo: [] }],
      suggestedFlags: [], suggestedScores: [], suggestedTags: [],
    } as any,
    sceneContents: [{
      sceneId: 'scene-1', sceneName: 'Scene One', locationId: 'loc-1',
      beats: [{ id: 'beat-1', text: 'Sealed prose.' }],
    }] as any,
    choiceSets: [{
      sceneId: 'scene-1', beatId: 'beat-1', choiceType: 'expression',
      choices: [{ id: 'c1', nextSceneId: 'scene-2' }],
    }] as any,
    encounters: new Map(),
    ...overrides,
  };
}

function makeContext(events: PipelineEvent[], validationEnabled = true): PipelineContext {
  return {
    config: { validation: { enabled: validationEnabled }, generation: {} } as any,
    emit: (event) => events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  } as PipelineContext;
}

describe('QAPhase', () => {
  it('runs QA and best-practices validation without changing committed artifacts', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const input = makeInput();
    const before = JSON.stringify({ scenes: input.sceneContents, choices: input.choiceSets });
    const context = makeContext(events);

    const result = await new QAPhase(deps).run(input, context);

    expect(result.qaReport?.passesQA).toBe(true);
    expect(result.bestPracticesReport?.overallPassed).toBe(true);
    expect(JSON.stringify({ scenes: input.sceneContents, choices: input.choiceSets })).toBe(before);
    expect(deps.requirePhases).toHaveBeenCalledWith('qa', ['content_generation']);
    expect(deps.markPhaseComplete).toHaveBeenCalledWith('qa');
    expect(context.addCheckpoint).toHaveBeenCalledWith('QA Report', expect.anything(), false);
  });

  it('reports legacy repair configuration as suppressed and preserves the sealed draft', async () => {
    const finding = makeQAReport({
      overallScore: 55,
      passesQA: false,
      criticalIssues: ['continuity'],
      proseCraft: {
        overallScore: 60,
        sampledSceneIds: ['scene-1'],
        issues: [{ severity: 'error', description: 'abstract prose', conceptId: 'sentence_craft', location: { sceneId: 'scene-1' } }],
      },
    });
    const deps = makeDeps({ qaRunner: { runFullQA: vi.fn(async () => finding) } as any });
    const events: PipelineEvent[] = [];
    const input = makeInput();
    (input.brief.options as any).maxQARepairPasses = 3;
    const before = JSON.stringify({ scenes: input.sceneContents, choices: input.choiceSets });

    const result = await new QAPhase(deps).run(input, makeContext(events));

    expect(result.qaReport).toBe(finding);
    expect(deps.qaRunner.runFullQA).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ scenes: input.sceneContents, choices: input.choiceSets })).toBe(before);
    expect(events.some((event) => event.type === 'warning'
      && (event as any).message.includes('3 configured late repair pass(es) were suppressed'))).toBe(true);
    expect(events.some((event) => (event as any).phase === 'qa_repair')).toBe(false);
  });

  it('skips entirely when runQA is false', async () => {
    const deps = makeDeps();
    const input = makeInput();
    (input.brief.options as any).runQA = false;

    expect(await new QAPhase(deps).run(input, makeContext([]))).toEqual({
      qaReport: undefined,
      bestPracticesReport: undefined,
    });
    expect(deps.qaRunner.runFullQA).not.toHaveBeenCalled();
  });

  it('passes incremental evidence to the QARunner when redundant checks are skipped', async () => {
    const runFullQA = vi.fn(async () => makeQAReport());
    const deps = makeDeps({
      qaRunner: { runFullQA } as any,
      incrementalValidator: {} as any,
      sceneValidationResults: [{
        sceneId: 'scene-1', overallPassed: true, validationTimeMs: 10,
        voice: {
          score: 82,
          issues: [{ beatId: 'beat-1', characterId: 'npc-1', characterName: 'Mara', severity: 'warning', issue: 'formal' }],
        },
        stakes: {
          score: 76, hasFalseChoices: true,
          issues: [{ choiceId: 'cs-1', severity: 'warning', issue: 'flat stakes' }],
        },
      }] as any,
    });
    const input = makeInput();

    await new QAPhase(deps).runQualityAssurance(
      input.brief,
      input.sceneContents,
      input.choiceSets,
      input.characterBible,
      input.episodeBlueprint,
      makeContext([]),
    );

    const [, options] = runFullQA.mock.calls[0] as any[];
    expect(options.skipVoiceValidation).toBe(true);
    expect(options.skipStakesAnalysis).toBe(true);
    expect(options.incrementalResults.voiceScores).toEqual([82]);
    expect(options.incrementalResults.stakesScores).toEqual([76]);
    expect(options.incrementalResults.falseChoiceCount).toBe(1);
  });
});
