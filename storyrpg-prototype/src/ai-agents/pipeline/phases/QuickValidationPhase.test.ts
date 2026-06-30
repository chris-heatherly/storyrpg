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

import { QuickValidationPhase, QuickValidationPhaseDeps, QuickValidationPhaseInput } from './QuickValidationPhase';
import { ValidationError } from '../../../types/validation';
import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';

function passResult(): any {
  return { canProceed: true, blockingIssues: [], warningCount: 2 };
}

function makeDeps(overrides: Partial<QuickValidationPhaseDeps> = {}): QuickValidationPhaseDeps {
  return {
    integratedValidator: { runQuickValidation: vi.fn(async () => passResult()) } as any,
    sceneWriter: { execute: vi.fn(async () => ({ success: false })) } as any,
    choiceAuthor: { execute: vi.fn(async () => ({ success: false })) } as any,
    sceneValidationResults: [],
    cachedPipelineMemory: null,
    prepareValidationInput: vi.fn(() => ({ scenes: [], choiceSets: [] }) as any),
    buildCompactWorldContext: vi.fn(() => 'world context'),
    getTargetBeatCountForScene: vi.fn(() => 6),
    buildChoiceAuthorNpcs: vi.fn(() => []),
    deriveStoryVerbsForBrief: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeInput(overrides: Partial<QuickValidationPhaseInput> = {}): QuickValidationPhaseInput {
  return {
    brief: {
      story: { title: 'Test Story', genre: 'fantasy', tone: 'hopeful' },
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
        beats: [{ id: 'beat-1', text: 'Something happens.' }],
      },
    ] as any,
    choiceSets: [
      { sceneId: 'scene-1', beatId: 'beat-1', choiceType: 'expression', choices: [{ id: 'choice-1' }] },
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

describe('QuickValidationPhase', () => {
  it('returns undefined and emits nothing when validation is disabled', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const context = makeContext(events, {
      config: { validation: { enabled: false } } as any,
    });

    const result = await new QuickValidationPhase(deps).run(makeInput(), context);

    expect(result).toBeUndefined();
    expect(events).toHaveLength(0);
    expect((deps.integratedValidator.runQuickValidation as any)).not.toHaveBeenCalled();
  });

  it('passes cleanly and emits phase_complete', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];

    const result = await new QuickValidationPhase(deps).run(makeInput(), makeContext(events));

    expect(result?.canProceed).toBe(true);
    expect(events.some(e => e.type === 'phase_start' && (e as any).phase === 'quick_validation')).toBe(true);
    expect(events.some(e => e.type === 'phase_complete'
      && (e as any).message === 'Quick validation passed (2 warnings)')).toBe(true);
  });

  it('escalates low incremental voice scores into blockers, repairs via SceneWriter, and revalidates', async () => {
    const runQuickValidation = vi.fn(async () => passResult());
    const deps = makeDeps({
      integratedValidator: { runQuickValidation } as any,
      sceneValidationResults: [
        {
          sceneId: 'scene-1',
          voice: {
            score: 30,
            issues: [{ characterName: 'Mara', issue: 'too stiff', suggestion: 'loosen up' }],
          },
        },
      ] as any,
      sceneWriter: {
        execute: vi.fn(async () => ({
          success: true,
          data: { sceneId: 'scene-1', sceneName: 'Scene One', beats: [{ id: 'beat-1', text: 'Repaired.' }] },
        })),
      } as any,
    });
    const events: PipelineEvent[] = [];
    const input = makeInput();

    const result = await new QuickValidationPhase(deps).run(input, makeContext(events));

    // Voice escalation forced canProceed=false, the scoped rewrite ran, and
    // the post-repair revalidation passed.
    expect((deps.sceneWriter.execute as any)).toHaveBeenCalledTimes(1);
    expect(runQuickValidation).toHaveBeenCalledTimes(2);
    expect(input.sceneContents[0].beats[0].text).toBe('Repaired.');
    expect(result?.canProceed).toBe(true);
    expect(events.some(e => e.type === 'regeneration_triggered'
      && (e as any).message.includes('voice_fidelity'))).toBe(true);
  });

  it('repairs flagged choices via ChoiceAuthor in place', async () => {
    const failing = {
      canProceed: false,
      warningCount: 0,
      blockingIssues: [
        {
          category: 'stakes_triangle',
          level: 'error',
          message: 'flat stakes',
          location: { choiceId: 'choice-1' },
        },
      ],
    };
    const runQuickValidation = vi.fn(async () => passResult());
    runQuickValidation.mockResolvedValueOnce(failing);
    const repairedChoiceSet = { beatId: 'beat-1', choiceType: 'dilemma', choices: [{ id: 'choice-1b' }] };
    const deps = makeDeps({
      integratedValidator: { runQuickValidation } as any,
      choiceAuthor: { execute: vi.fn(async () => ({ success: true, data: repairedChoiceSet })) } as any,
    });
    const events: PipelineEvent[] = [];
    const input = makeInput();

    const result = await new QuickValidationPhase(deps).run(input, makeContext(events));

    expect((deps.choiceAuthor.execute as any)).toHaveBeenCalledTimes(1);
    expect(input.choiceSets[0]).toMatchObject({ ...repairedChoiceSet, sceneId: 'scene-1' });
    expect(runQuickValidation).toHaveBeenCalledTimes(2);
    expect(result?.canProceed).toBe(true);
  });

  it('repairs the scene-scoped choice set when local beat ids repeat', async () => {
    const failing = {
      canProceed: false,
      warningCount: 0,
      blockingIssues: [
        {
          category: 'stakes_triangle',
          level: 'error',
          message: 'flat stakes',
          location: { choiceId: 'scene-b-choice' },
        },
      ],
    };
    const runQuickValidation = vi.fn(async () => passResult());
    runQuickValidation.mockResolvedValueOnce(failing);
    const repairedChoiceSet = { beatId: 'beat-6', choiceType: 'dilemma', choices: [{ id: 'scene-b-choice-repaired' }] };
    const deps = makeDeps({
      integratedValidator: { runQuickValidation } as any,
      choiceAuthor: { execute: vi.fn(async () => ({ success: true, data: repairedChoiceSet })) } as any,
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
          beats: [{ id: 'beat-6', text: 'The first local decision.' }],
        },
        {
          sceneId: 'scene-b',
          sceneName: 'Scene B',
          beats: [{ id: 'beat-6', text: 'The second local decision.' }],
        },
      ] as any,
      choiceSets: [
        { sceneId: 'scene-a', beatId: 'beat-6', choiceType: 'expression', choices: [{ id: 'scene-a-choice' }] },
        { sceneId: 'scene-b', beatId: 'beat-6', choiceType: 'expression', choices: [{ id: 'scene-b-choice' }] },
      ] as any,
    });

    const result = await new QuickValidationPhase(deps).run(input, makeContext(events));

    expect((deps.choiceAuthor.execute as any)).toHaveBeenCalledTimes(1);
    expect((deps.choiceAuthor.execute as any).mock.calls[0][0].sceneBlueprint.id).toBe('scene-b');
    expect(input.choiceSets[0].choices[0].id).toBe('scene-a-choice');
    expect(input.choiceSets[1]).toMatchObject({
      sceneId: 'scene-b',
      beatId: 'beat-6',
      choices: [{ id: 'scene-b-choice-repaired' }],
    });
    expect(result?.canProceed).toBe(true);
  });

  it('throws ValidationError when blocking issues are unrepairable', async () => {
    const failing = {
      canProceed: false,
      warningCount: 0,
      blockingIssues: [
        { category: 'structural_integrity', level: 'error', message: 'broken graph' },
      ],
    };
    const deps = makeDeps({
      integratedValidator: { runQuickValidation: vi.fn(async () => failing) } as any,
    });
    const events: PipelineEvent[] = [];

    await expect(new QuickValidationPhase(deps).run(makeInput(), makeContext(events)))
      .rejects.toBeInstanceOf(ValidationError);

    // No repairable categories: no repair attempted, single validation pass
    expect((deps.integratedValidator.runQuickValidation as any)).toHaveBeenCalledTimes(1);
    expect((deps.choiceAuthor.execute as any)).not.toHaveBeenCalled();
    expect((deps.sceneWriter.execute as any)).not.toHaveBeenCalled();
    expect(events.some(e => e.type === 'error'
      && (e as any).message === 'Quick validation failed: 1 blocking issues')).toBe(true);
  });

  it('throws ValidationError when issues persist after the repair attempt', async () => {
    const failing = {
      canProceed: false,
      warningCount: 0,
      blockingIssues: [
        {
          category: 'stakes_triangle',
          level: 'error',
          message: 'flat stakes',
          location: { choiceId: 'choice-1' },
        },
      ],
    };
    const deps = makeDeps({
      integratedValidator: { runQuickValidation: vi.fn(async () => failing) } as any,
      choiceAuthor: {
        execute: vi.fn(async () => ({
          success: true,
          data: { beatId: 'beat-1', choices: [{ id: 'choice-1' }] },
        })),
      } as any,
    });
    const events: PipelineEvent[] = [];

    await expect(new QuickValidationPhase(deps).run(makeInput(), makeContext(events)))
      .rejects.toBeInstanceOf(ValidationError);

    expect((deps.integratedValidator.runQuickValidation as any)).toHaveBeenCalledTimes(2);
    expect(events.some(e => e.type === 'error'
      && (e as any).message === 'Quick validation failed after repair attempt: 1 blocking issues')).toBe(true);
  });
});
