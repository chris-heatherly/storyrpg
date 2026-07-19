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

import { ValidationError } from '../../../types/validation';
import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';
import { QuickValidationPhase, type QuickValidationPhaseDeps, type QuickValidationPhaseInput } from './QuickValidationPhase';

function makeDeps(overrides: Partial<QuickValidationPhaseDeps> = {}): QuickValidationPhaseDeps {
  return {
    integratedValidator: {
      runQuickValidation: vi.fn(async () => ({ canProceed: true, blockingIssues: [], warningCount: 2 })),
    } as any,
    sceneValidationResults: [],
    prepareValidationInput: vi.fn(() => ({ scenes: [], choiceSets: [] }) as any),
    ...overrides,
  };
}

function makeInput(): QuickValidationPhaseInput {
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
      scenes: [{ id: 'scene-1', name: 'Scene One', location: 'loc-1', npcsPresent: [], leadsTo: [] }],
      suggestedFlags: [], suggestedScores: [], suggestedTags: [],
    } as any,
    sceneContents: [{ sceneId: 'scene-1', sceneName: 'Scene One', beats: [{ id: 'beat-1', text: 'Sealed prose.' }] }] as any,
    choiceSets: [{ sceneId: 'scene-1', beatId: 'beat-1', choiceType: 'expression', choices: [{ id: 'choice-1' }] }] as any,
    encounters: new Map(),
  };
}

function makeContext(events: PipelineEvent[], enabled = true): PipelineContext {
  return {
    config: { validation: { enabled }, generation: {} } as any,
    emit: (event) => events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  } as PipelineContext;
}

describe('QuickValidationPhase', () => {
  it('returns undefined and emits nothing when validation is disabled', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];

    expect(await new QuickValidationPhase(deps).run(makeInput(), makeContext(events, false))).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(deps.integratedValidator.runQuickValidation).not.toHaveBeenCalled();
  });

  it('passes committed artifacts without changing them', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const input = makeInput();
    const before = JSON.stringify(input);

    const result = await new QuickValidationPhase(deps).run(input, makeContext(events));

    expect(result?.canProceed).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    expect(events.some((event) => event.type === 'phase_complete'
      && (event as any).message === 'Quick validation passed (2 warnings)')).toBe(true);
  });

  it('escalates incremental voice failures without invoking an author or mutating the scene', async () => {
    const deps = makeDeps({
      sceneValidationResults: [{
        sceneId: 'scene-1',
        voice: { score: 30, issues: [{ characterName: 'Mara', issue: 'too stiff', suggestion: 'loosen up' }] },
      }] as any,
    });
    const input = makeInput();
    const before = JSON.stringify(input);

    await expect(new QuickValidationPhase(deps).run(input, makeContext([])))
      .rejects.toBeInstanceOf(ValidationError);

    expect(JSON.stringify(input)).toBe(before);
    expect(deps.integratedValidator.runQuickValidation).toHaveBeenCalledTimes(1);
  });

  it('rejects a blocking quick-validation finding and requests suffix regeneration', async () => {
    const deps = makeDeps({
      integratedValidator: {
        runQuickValidation: vi.fn(async () => ({
          canProceed: false,
          warningCount: 0,
          blockingIssues: [{ category: 'structural_integrity', level: 'error', message: 'broken graph' }],
        })),
      } as any,
    });
    const events: PipelineEvent[] = [];
    const input = makeInput();
    const before = JSON.stringify(input);

    await expect(new QuickValidationPhase(deps).run(input, makeContext(events)))
      .rejects.toBeInstanceOf(ValidationError);

    expect(JSON.stringify(input)).toBe(before);
    expect(events.some((event) => event.type === 'error'
      && (event as any).message.includes('regenerate the earliest owning scene and dependent suffix'))).toBe(true);
  });
});
