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
    choiceAuthor: {
      execute: vi.fn(async () => ({ success: false })),
      reauthorOutcomeTexts: vi.fn(async () => ({})),
    } as any,
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
      { sceneId: 'scene-1', beatId: 'beat-1', choiceType: 'expression', choices: [{ id: 'c1', nextSceneId: 'scene-2' }] },
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

  it('repairs low prose-craft scenes even when legacy QA passes', async () => {
    const lowCraft = makeQAReport({
      overallScore: 94,
      passesQA: true,
      proseCraft: {
        overallScore: 61,
        issues: [{
          severity: 'error',
          conceptId: 'sentence_craft',
          location: { sceneId: 'scene-1' },
          description: 'The prose repeats abstract phrasing.',
          suggestion: 'Use concrete action.',
        }],
        sampledSceneIds: ['scene-1'],
      },
    });
    const improved = makeQAReport({
      overallScore: 94,
      proseCraft: { overallScore: 78, issues: [], sampledSceneIds: ['scene-1'] },
    });
    const runFullQA = vi.fn(async () => improved);
    runFullQA.mockResolvedValueOnce(lowCraft);
    const deps = makeDeps({
      qaRunner: { runFullQA } as any,
      sceneWriter: {
        execute: vi.fn(async () => ({
          success: true,
          data: { sceneId: 'scene-1', sceneName: 'Scene One', beats: [{ id: 'beat-1', text: 'Concrete action replaces abstraction.' }] },
        })),
      } as any,
    });
    const input = makeInput();

    const result = await new QAPhase(deps).run(input, makeContext([]));

    expect((deps.sceneWriter.execute as any)).toHaveBeenCalledTimes(1);
    expect((deps.sceneWriter.execute as any).mock.calls[0][0].storyContext.userPrompt)
      .toContain('TARGETED PUBLISHABILITY REPAIR');
    expect(runFullQA).toHaveBeenCalledTimes(2);
    expect(result.qaReport?.proseCraft?.overallScore).toBe(78);
  });

  it('routes cosmetic responsiveness probes to paired downstream scene repair', async () => {
    const lowResponsiveness = makeQAReport({
      overallScore: 92,
      passesQA: true,
      responsiveness: {
        overallScore: 58,
        issues: [],
        probeVerdicts: [{
          probeId: 'scene-1:beat-1',
          verdict: 'cosmetic',
          npcReaction: 'static',
          notes: 'same downstream opening',
        }],
      },
    });
    const improved = makeQAReport({
      overallScore: 92,
      responsiveness: { overallScore: 78, issues: [], probeVerdicts: [] },
    });
    const runFullQA = vi.fn(async () => improved);
    runFullQA.mockResolvedValueOnce(lowResponsiveness);
    const deps = makeDeps({
      qaRunner: { runFullQA } as any,
      sceneWriter: {
        execute: vi.fn(async (request: any) => ({
          success: true,
          data: {
            sceneId: request.sceneBlueprint.id,
            sceneName: request.sceneBlueprint.name,
            beats: [{ id: `${request.sceneBlueprint.id}-beat`, text: 'The route remembers the choice.' }],
          },
        })),
      } as any,
    });
    const input = makeInput({
      episodeBlueprint: {
        scenes: [
          {
            id: 'scene-1', name: 'Choice', location: 'loc-1', npcsPresent: [],
            leadsTo: ['scene-2', 'scene-3'], choicePoint: { optionHints: ['a', 'b'] },
          },
          { id: 'scene-2', name: 'Route A', location: 'loc-1', npcsPresent: [], leadsTo: [] },
          { id: 'scene-3', name: 'Route B', location: 'loc-1', npcsPresent: [], leadsTo: [] },
        ],
        suggestedFlags: [],
        suggestedScores: [],
        suggestedTags: [],
      } as any,
      sceneContents: [
        { sceneId: 'scene-1', sceneName: 'Choice', beats: [{ id: 'beat-1', text: 'Choose.' }] },
        { sceneId: 'scene-2', sceneName: 'Route A', beats: [{ id: 'a1', text: 'Same opening.' }] },
        { sceneId: 'scene-3', sceneName: 'Route B', beats: [{ id: 'b1', text: 'Same opening.' }] },
      ] as any,
      choiceSets: [{
        sceneId: 'scene-1',
        beatId: 'beat-1',
        choiceType: 'expression',
        choices: [
          { id: 'c1', nextSceneId: 'scene-2' },
          { id: 'c2', nextSceneId: 'scene-3' },
        ],
      }] as any,
    });

    const result = await new QAPhase(deps).run(input, makeContext([]));

    expect((deps.sceneWriter.execute as any)).toHaveBeenCalledTimes(2);
    expect((deps.sceneWriter.execute as any).mock.calls.map((call: any[]) => call[0].sceneBlueprint.id))
      .toEqual(['scene-2', 'scene-3']);
    expect(result.qaReport?.responsiveness?.overallScore).toBe(78);
  });

  it('repairs immediate outcomes and downstream callbacks for a cosmetic choice probe', async () => {
    const lowResponsiveness = makeQAReport({
      responsiveness: {
        overallScore: 58,
        issues: [],
        probeVerdicts: [{
          probeId: 'scene-1:beat-1',
          verdict: 'cosmetic',
          npcReaction: 'static',
          notes: 'all options receive the same immediate response',
        }],
      },
    });
    const runFullQA = vi.fn()
      .mockResolvedValueOnce(lowResponsiveness)
      .mockResolvedValue(makeQAReport({
        responsiveness: { overallScore: 80, issues: [], probeVerdicts: [] },
      }));
    const reauthorOutcomeTexts = vi.fn(async ({ choiceText }: { choiceText: string }) => ({
      success: `${choiceText} earns a distinct immediate answer from Mika.`,
      partial: `${choiceText} lands, but Mika names its cost.`,
      failure: `${choiceText} fails and Mika reacts to that exact attempt.`,
    }));
    const deps = makeDeps({
      qaRunner: { runFullQA } as any,
      choiceAuthor: { execute: vi.fn(), reauthorOutcomeTexts } as any,
      sceneWriter: {
        execute: vi.fn(async (request: any) => ({
          success: true,
          data: {
            sceneId: request.sceneBlueprint.id,
            sceneName: request.sceneBlueprint.name,
            beats: [{ id: 'opening', text: 'Mika remembers how you answered.' }],
          },
        })),
      } as any,
    });
    const input = makeInput({
      episodeBlueprint: {
        scenes: [
          {
            id: 'scene-1', name: 'Choice', location: 'loc-1', npcsPresent: ['mika'],
            leadsTo: ['scene-2'], choicePoint: { optionHints: ['bold', 'gentle'] },
          },
          { id: 'scene-2', name: 'Aftermath', location: 'loc-1', npcsPresent: ['mika'], leadsTo: [] },
        ],
        suggestedFlags: [], suggestedScores: [], suggestedTags: [],
      } as any,
      sceneContents: [
        { sceneId: 'scene-1', sceneName: 'Choice', beats: [{ id: 'beat-1', text: 'Choose.' }] },
        { sceneId: 'scene-2', sceneName: 'Aftermath', beats: [{ id: 'opening', text: 'Same response.' }] },
      ] as any,
      choiceSets: [{
        sceneId: 'scene-1', beatId: 'beat-1', choiceType: 'relationship',
        choices: [
          {
            id: 'c1', text: 'Answer boldly.', nextSceneId: 'scene-2',
            outcomeTexts: { success: 'Same.', partial: 'Same.', failure: 'Same.' },
          },
          {
            id: 'c2', text: 'Answer gently.', nextSceneId: 'scene-2',
            outcomeTexts: { success: 'Same.', partial: 'Same.', failure: 'Same.' },
          },
        ],
      }] as any,
    });

    const result = await new QAPhase(deps).run(input, makeContext([]));

    expect(reauthorOutcomeTexts).toHaveBeenCalledTimes(2);
    expect((reauthorOutcomeTexts.mock.calls[0]?.[0] as any).repairDirective).toContain('same immediate response');
    expect(input.choiceSets[0].choices[0].outcomeTexts?.success).toContain('Answer boldly');
    expect(input.choiceSets[0].choices[1].outcomeTexts?.success).toContain('Answer gently');
    expect((deps.sceneWriter.execute as any)).toHaveBeenCalledTimes(1);
    expect(result.qaReport?.responsiveness?.overallScore).toBe(80);
  });

  it('repairs same-target cosmetic choices with condition-gated opening callback residue', async () => {
    const lowResponsiveness = makeQAReport({
      overallScore: 90,
      passesQA: true,
      responsiveness: {
        overallScore: 58,
        issues: [],
        probeVerdicts: [{
          probeId: 'scene-1:beat-1',
          verdict: 'cosmetic',
          npcReaction: 'static',
          notes: 'identical next-scene opening',
        }],
      },
    });
    const improved = makeQAReport({
      responsiveness: { overallScore: 80, issues: [], probeVerdicts: [] },
    });
    const runFullQA = vi.fn()
      .mockResolvedValueOnce(lowResponsiveness)
      .mockResolvedValue(improved);
    const deps = makeDeps({
      qaRunner: { runFullQA } as any,
      sceneWriter: {
        execute: vi.fn(async (request: any) => ({
          success: true,
          data: {
            sceneId: request.sceneBlueprint.id,
            sceneName: request.sceneBlueprint.name,
            startingBeatId: 'opening',
            beats: [{
              id: 'opening',
              text: 'The room waits.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'answered_boldly', value: true },
                  text: 'Mika meets your boldness with a startled grin.',
                },
                {
                  condition: { type: 'flag', flag: 'answered_gently', value: true },
                  text: 'Mika lowers her voice in answer to your gentleness.',
                },
              ],
            }],
          },
        })),
      } as any,
    });
    const input = makeInput({
      episodeBlueprint: {
        scenes: [
          {
            id: 'scene-1', name: 'Choice', location: 'loc-1', npcsPresent: ['mika'],
            leadsTo: ['scene-2'], choicePoint: { optionHints: ['bold', 'gentle'] },
          },
          { id: 'scene-2', name: 'Reconvergence', location: 'loc-1', npcsPresent: ['mika'], leadsTo: [] },
        ],
        suggestedFlags: ['answered_boldly', 'answered_gently'],
        suggestedScores: [],
        suggestedTags: [],
      } as any,
      sceneContents: [
        { sceneId: 'scene-1', sceneName: 'Choice', beats: [{ id: 'beat-1', text: 'Choose.' }] },
        { sceneId: 'scene-2', sceneName: 'Reconvergence', beats: [{ id: 'opening', text: 'Same opening.' }] },
      ] as any,
      choiceSets: [{
        sceneId: 'scene-1',
        beatId: 'beat-1',
        choiceType: 'relationship',
        choices: [
          {
            id: 'c1',
            nextSceneId: 'scene-2',
            consequences: [{ type: 'setFlag', flag: 'answered_boldly', value: true }],
          },
          {
            id: 'c2',
            nextSceneId: 'scene-2',
            consequences: [{ type: 'setFlag', flag: 'answered_gently', value: true }],
          },
        ],
      }] as any,
    });

    await new QAPhase(deps).run(input, makeContext([]));

    const prompt = (deps.sceneWriter.execute as any).mock.calls[0][0].storyContext.userPrompt;
    expect(prompt).toContain('condition-gated textVariants');
    expect(prompt).toContain('answered_boldly');
    const opening = input.sceneContents[1].beats[0];
    expect(opening.textVariants?.map((variant) => variant.callbackHookId)).toEqual([
      'flag:answered_boldly',
      'flag:answered_gently',
    ]);
    expect(opening.callbackHookIds).toEqual([
      'flag:answered_boldly',
      'flag:answered_gently',
    ]);
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

  it('repairs weak choices using the scene-scoped choice set when local beat ids repeat', async () => {
    const failing = makeQAReport({
      overallScore: 50,
      passesQA: false,
      criticalIssues: ['stakes'],
      stakes: {
        metrics: { falseChoiceCount: 1 },
        choiceSetAnalysis: [{
          sceneId: 'scene-b',
          beatId: 'beat-6',
          stakesScore: 30,
          analysis: 'flat stakes',
          improvements: ['make the second scene decision costlier'],
        }],
      },
    });
    const runFullQA = vi.fn(async () => makeQAReport({ overallScore: 88 }));
    runFullQA.mockResolvedValueOnce(failing);
    const deps = makeDeps({
      qaRunner: { runFullQA } as any,
      choiceAuthor: {
        execute: vi.fn(async () => ({
          success: true,
          data: { beatId: 'beat-6', choiceType: 'dilemma', choices: [{ id: 'scene-b-choice-repaired' }] },
        })),
      } as any,
    });
    const events: PipelineEvent[] = [];
    const input = makeInput({
      episodeBlueprint: {
        scenes: [
          {
            id: 'scene-a',
            name: 'Scene A',
            location: 'loc-1',
            npcsPresent: [],
            leadsTo: ['scene-b'],
            choicePoint: { optionHints: ['a', 'b'] },
          },
          {
            id: 'scene-b',
            name: 'Scene B',
            location: 'loc-1',
            npcsPresent: [],
            leadsTo: ['scene-c'],
            choicePoint: { optionHints: ['c', 'd'] },
          },
        ],
        suggestedFlags: [],
        suggestedScores: [],
        suggestedTags: [],
      } as any,
      sceneContents: [
        {
          sceneId: 'scene-a',
          sceneName: 'Scene A',
          locationId: 'loc-1',
          beats: [{ id: 'beat-6', text: 'The first local decision.' }],
        },
        {
          sceneId: 'scene-b',
          sceneName: 'Scene B',
          locationId: 'loc-1',
          beats: [{ id: 'beat-6', text: 'The second local decision.' }],
        },
      ] as any,
      choiceSets: [
        { sceneId: 'scene-a', beatId: 'beat-6', choiceType: 'expression', choices: [{ id: 'scene-a-choice' }] },
        { sceneId: 'scene-b', beatId: 'beat-6', choiceType: 'expression', choices: [{ id: 'scene-b-choice' }] },
      ] as any,
    });

    const result = await new QAPhase(deps).run(input, makeContext(events));

    expect((deps.choiceAuthor.execute as any)).toHaveBeenCalledTimes(1);
    expect((deps.choiceAuthor.execute as any).mock.calls[0][0].sceneBlueprint.id).toBe('scene-b');
    expect(input.choiceSets[0].choices[0].id).toBe('scene-a-choice');
    expect(input.choiceSets[1]).toMatchObject({
      sceneId: 'scene-b',
      beatId: 'beat-6',
      choices: [{ id: 'scene-b-choice-repaired' }],
    });
    expect(result.qaReport?.overallScore).toBe(88);
  });

  it('skips ambiguous weak-choice repair when duplicate beat ids lack scene evidence', async () => {
    const failing = makeQAReport({
      overallScore: 50,
      passesQA: false,
      criticalIssues: ['stakes'],
      stakes: {
        metrics: { falseChoiceCount: 1 },
        choiceSetAnalysis: [{
          beatId: 'beat-6',
          stakesScore: 30,
          analysis: 'flat stakes',
          improvements: ['make the decision costlier'],
        }],
      },
    });
    const deps = makeDeps({ qaRunner: { runFullQA: vi.fn(async () => failing) } as any });
    const events: PipelineEvent[] = [];
    const input = makeInput({
      sceneContents: [
        { sceneId: 'scene-a', sceneName: 'Scene A', beats: [{ id: 'beat-6', text: 'First.' }] },
        { sceneId: 'scene-b', sceneName: 'Scene B', beats: [{ id: 'beat-6', text: 'Second.' }] },
      ] as any,
      choiceSets: [
        { sceneId: 'scene-a', beatId: 'beat-6', choiceType: 'expression', choices: [{ id: 'scene-a-choice' }] },
        { sceneId: 'scene-b', beatId: 'beat-6', choiceType: 'expression', choices: [{ id: 'scene-b-choice' }] },
      ] as any,
    });

    await new QAPhase(deps).run(input, makeContext(events));

    expect((deps.choiceAuthor.execute as any)).not.toHaveBeenCalled();
    expect(events.some(e => e.type === 'warning'
      && (e as any).phase === 'qa_repair'
      && (e as any).message.includes('not scene-unique'))).toBe(true);
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
