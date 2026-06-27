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

import { QAPhase, QAPhaseDeps, QAPhaseInput } from './QAPhase';
import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';

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
  return {
    overallPassed: true,
    overallScore: 88,
    blockingIssues: [],
    warnings: [],
    suggestions: [],
  };
}

function makeDeps(overrides: Partial<QAPhaseDeps> = {}): QAPhaseDeps {
  const deps: QAPhaseDeps = {
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
    sceneWriter: { execute: vi.fn(async () => ({ success: false })) } as any,
    choiceAuthor: { execute: vi.fn(async () => ({ success: false })) } as any,
    incrementalValidator: null,
    sceneValidationResults: [],
    cachedPipelineMemory: null,
    requirePhases: vi.fn(),
    markPhaseComplete: vi.fn(),
    measurePhase: (_phase, fn) => fn(),
    emitPhaseProgress: vi.fn(),
    prepareValidationInput: vi.fn(() => ({ scenes: [], choiceSets: [] }) as any),
    buildContinuityCharacterKnowledge: vi.fn(() => []),
    buildContinuityTimeline: vi.fn(() => []),
    buildCompactWorldContext: vi.fn(() => 'world context'),
    getTargetBeatCountForScene: vi.fn(() => 6),
    buildChoiceAuthorNpcs: vi.fn(() => []),
    deriveStoryVerbsForBrief: vi.fn(() => undefined),
    ...overrides,
  };
  return deps;
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
      scenes: [
        {
          id: 'scene-1',
          name: 'Scene One',
          location: 'loc-1',
          npcsPresent: [],
          leadsTo: ['scene-2'],
          choicePoint: { optionHints: ['a', 'b'] },
        },
      ],
      suggestedFlags: [],
      suggestedScores: [],
      suggestedTags: [],
    } as any,
    sceneContents: [
      {
        sceneId: 'scene-1',
        sceneName: 'Scene One',
        locationId: 'loc-1',
        beats: [{ id: 'beat-1', text: 'Something happens.' }],
      },
    ] as any,
    choiceSets: [
      { beatId: 'beat-1', choiceType: 'expression', choices: [{ id: 'c1', nextSceneId: 'scene-2' }] },
    ] as any,
    encounters: new Map(),
    ...overrides,
  };
}

function makeContext(events: PipelineEvent[], overrides: Record<string, unknown> = {}): PipelineContext {
  return {
    config: { validation: { enabled: true }, generation: {} } as any,
    emit: (event) => events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
    ...overrides,
  } as PipelineContext;
}

describe('QAPhase', () => {
  it('runs QA and best practices in parallel and returns both reports', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const context = makeContext(events);

    const result = await new QAPhase(deps).run(makeInput(), context);

    expect(result.qaReport?.passesQA).toBe(true);
    expect(result.bestPracticesReport?.overallPassed).toBe(true);
    expect(deps.requirePhases).toHaveBeenCalledWith('qa', ['content_generation']);
    expect(deps.markPhaseComplete).toHaveBeenCalledWith('qa');
    expect((deps.integratedValidator.runFullValidation as any)).toHaveBeenCalledTimes(1);
    expect((context.addCheckpoint as any)).toHaveBeenCalledWith('QA Report', expect.anything(), false);
    expect((context.addCheckpoint as any)).toHaveBeenCalledWith('Best Practices Report', expect.anything(), false);
    expect(events.some(e => e.type === 'phase_start' && (e as any).phase === 'qa')).toBe(true);
    expect(events.some(e => e.type === 'checkpoint' && (e as any).phase === 'choice_distribution')).toBe(true);
    // QA passed cleanly: no repair pass, no threshold warning
    expect(events.some(e => (e as any).phase === 'qa_repair')).toBe(false);
    expect(events.some(e => e.type === 'warning' && (e as any).phase === 'qa')).toBe(false);
  });

  it('skips entirely when brief.options.runQA is false', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const input = makeInput();
    (input.brief.options as any).runQA = false;

    const result = await new QAPhase(deps).run(input, makeContext(events));

    expect(result.qaReport).toBeUndefined();
    expect(result.bestPracticesReport).toBeUndefined();
    expect(events).toHaveLength(0);
    expect((deps.qaRunner.runFullQA as any)).not.toHaveBeenCalled();
  });

  it('skips best practices when config.validation.enabled is false', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const context = makeContext(events, {
      config: { validation: { enabled: false }, generation: {} } as any,
    });

    const result = await new QAPhase(deps).run(makeInput(), context);

    expect(result.qaReport).toBeDefined();
    expect(result.bestPracticesReport).toBeUndefined();
    expect((deps.integratedValidator.runFullValidation as any)).not.toHaveBeenCalled();
    expect((context.addCheckpoint as any)).not.toHaveBeenCalledWith('Best Practices Report', expect.anything(), expect.anything());
  });

  it('repairs continuity-error scenes in place and re-runs QA', async () => {
    const failing = makeQAReport({
      overallScore: 50,
      passesQA: false,
      criticalIssues: ['continuity'],
      continuity: {
        issues: [
          {
            severity: 'error',
            description: 'Hero teleports',
            suggestedFix: 'Add travel beat',
            location: { sceneId: 'scene-1' },
          },
        ],
      },
    });
    const runFullQA = vi.fn(async () => makeQAReport({ overallScore: 85 }));
    runFullQA.mockResolvedValueOnce(failing);
    const repairedScene = {
      sceneId: 'scene-1',
      sceneName: 'Scene One (repaired)',
      beats: [{ id: 'beat-1', text: 'Something coherent happens.' }],
    };
    const deps = makeDeps({
      qaRunner: { runFullQA } as any,
      sceneWriter: { execute: vi.fn(async () => ({ success: true, data: { ...repairedScene } })) } as any,
    });
    const events: PipelineEvent[] = [];
    const input = makeInput();

    const result = await new QAPhase(deps).run(input, makeContext(events));

    expect((deps.sceneWriter.execute as any)).toHaveBeenCalledTimes(1);
    expect(runFullQA).toHaveBeenCalledTimes(2);
    // Repaired scene replaced in place, with identity fields restored
    expect(input.sceneContents[0].sceneId).toBe('scene-1');
    expect(input.sceneContents[0].beats[0].text).toBe('Something coherent happens.');
    expect((input.sceneContents[0] as any).locationId).toBe('loc-1');
    expect(result.qaReport?.overallScore).toBe(85);
    expect(events.some(e => e.type === 'regeneration_triggered' && (e as any).phase === 'qa_repair')).toBe(true);
    expect(events.some(e => e.type === 'phase_complete' && (e as any).phase === 'qa_repair')).toBe(true);
  });

  it('rejects QA repair candidates that make the QA outcome worse', async () => {
    const failing = makeQAReport({
      overallScore: 72,
      passesQA: false,
      criticalIssues: ['continuity'],
      continuity: {
        issues: [
          {
            severity: 'error',
            description: 'Hero teleports',
            suggestedFix: 'Add travel beat',
            location: { sceneId: 'scene-1' },
          },
        ],
      },
    });
    const worse = makeQAReport({
      overallScore: 60,
      passesQA: false,
      criticalIssues: ['continuity'],
      continuity: { issues: [] },
    });
    const runFullQA = vi.fn(async () => worse);
    runFullQA.mockResolvedValueOnce(failing);
    const deps = makeDeps({
      qaRunner: { runFullQA } as any,
      sceneWriter: {
        execute: vi.fn(async () => ({
          success: true,
          data: {
            sceneId: 'scene-1',
            sceneName: 'Scene One',
            beats: [{ id: 'beat-1', text: 'A worse repair happens.' }],
          },
        })),
      } as any,
    });
    const events: PipelineEvent[] = [];
    const input = makeInput();

    const result = await new QAPhase(deps).run(input, makeContext(events));

    expect(runFullQA).toHaveBeenCalledTimes(2);
    expect(result.qaReport?.overallScore).toBe(72);
    expect(input.sceneContents[0].beats[0].text).toBe('Something happens.');
    expect(events.some(e => e.type === 'warning' && (e as any).phase === 'qa_repair'
      && (e as any).message.includes('rejected candidate score 60/100'))).toBe(true);
  });

  it('stops the repair loop when nothing is repairable and warns below threshold', async () => {
    const failing = makeQAReport({ overallScore: 40, passesQA: false, criticalIssues: ['vibes'] });
    const deps = makeDeps({
      qaRunner: { runFullQA: vi.fn(async () => failing) } as any,
    });
    const events: PipelineEvent[] = [];

    const result = await new QAPhase(deps).run(makeInput(), makeContext(events));

    // No continuity errors / weak stakes to repair: one pass, then break
    expect((deps.qaRunner.runFullQA as any)).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.type === 'phase_start' && (e as any).phase === 'qa_repair')).toHaveLength(1);
    expect(events.some(e => e.type === 'phase_complete' && (e as any).phase === 'qa_repair'
      && (e as any).message.includes('no repairable issues'))).toBe(true);
    expect(events.some(e => e.type === 'warning' && (e as any).phase === 'qa'
      && (e as any).message.includes('below threshold'))).toBe(true);
    expect(result.qaReport?.overallScore).toBe(40);
  });

  describe('runQualityAssurance', () => {
    it('passes incremental skip stubs to the QARunner when redundant checks are skipped', async () => {
      const runFullQA = vi.fn(async () => makeQAReport());
      const deps = makeDeps({
        qaRunner: { runFullQA } as any,
        incrementalValidator: {} as any,
        sceneValidationResults: [
          {
            sceneId: 'scene-1',
            overallPassed: true,
            validationTimeMs: 10,
            voice: {
              score: 82,
              issues: [
                {
                  beatId: 'beat-1',
                  characterId: 'npc-1',
                  characterName: 'Mara',
                  severity: 'warning',
                  issue: 'too formal',
                  suggestion: 'loosen up',
                },
              ],
            },
            stakes: {
              score: 76,
              hasFalseChoices: true,
              issues: [
                { choiceId: 'cs-1', severity: 'warning', issue: 'flat stakes', suggestion: 'raise them' },
              ],
            },
          },
        ] as any,
      });
      const events: PipelineEvent[] = [];
      const input = makeInput();

      const report = await new QAPhase(deps).runQualityAssurance(
        input.brief,
        input.sceneContents,
        input.choiceSets,
        input.characterBible,
        input.episodeBlueprint,
        makeContext(events),
      );

      expect(report.passesQA).toBe(true);
      const [, qaOptions] = runFullQA.mock.calls[0] as any[];
      expect(qaOptions.skipVoiceValidation).toBe(true);
      expect(qaOptions.skipStakesAnalysis).toBe(true);
      expect(qaOptions.continuityFocusCrossScene).toBe(true);
      expect(qaOptions.incrementalResults.voiceIssueCount).toBe(1);
      expect(qaOptions.incrementalResults.stakesIssueCount).toBe(1);
      expect(qaOptions.incrementalResults.voiceScores).toEqual([82]);
      expect(qaOptions.incrementalResults.stakesScores).toEqual([76]);
      expect(qaOptions.incrementalResults.voiceEvidenceCount).toBe(1);
      expect(qaOptions.incrementalResults.stakesEvidenceCount).toBe(1);
      expect(qaOptions.incrementalResults.voiceWarningCount).toBe(1);
      expect(qaOptions.incrementalResults.stakesWarningCount).toBe(1);
      expect(qaOptions.incrementalResults.falseChoiceCount).toBe(1);
      expect(qaOptions.incrementalResults.voiceIssues[0]).toMatchObject({
        sceneId: 'scene-1',
        beatId: 'beat-1',
        characterName: 'Mara',
      });
      expect(qaOptions.incrementalResults.stakesIssues[0]).toMatchObject({
        sceneId: 'scene-1',
        choiceSetId: 'cs-1',
      });
      expect(events.some(e => e.type === 'debug' && (e as any).agent === 'QARunner')).toBe(true);
    });

    it('runs all checks when there is no incremental validator', async () => {
      const runFullQA = vi.fn(async () => makeQAReport({ skippedChecks: undefined }));
      const deps = makeDeps({ qaRunner: { runFullQA } as any });
      const events: PipelineEvent[] = [];
      const input = makeInput();

      await new QAPhase(deps).runQualityAssurance(
        input.brief,
        input.sceneContents,
        input.choiceSets,
        input.characterBible,
        input.episodeBlueprint,
        makeContext(events),
      );

      const [, qaOptions] = runFullQA.mock.calls[0] as any[];
      expect(qaOptions).toEqual({});
      expect(deps.emitPhaseProgress).toHaveBeenCalledWith('qa', 3, 3, 'qa:steps', 'QA report finalized');
      expect(events.some(e => e.type === 'agent_complete' && (e as any).agent === 'QARunner'
        && (e as any).message.includes('QA Score: 90/100 - PASSED'))).toBe(true);
    });
  });
});
