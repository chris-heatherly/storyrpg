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

import { EpisodeArchitecturePhase, EpisodeArchitecturePhaseDeps } from './EpisodeArchitecturePhase';
import { PipelineError } from '../errors';
import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';

function makeBlueprint(): any {
  return {
    episodeId: 'ep-1',
    title: 'Pilot',
    startingSceneId: 'scene-1',
    scenes: [
      { id: 'scene-1', name: 'Opening', npcsPresent: [], leadsTo: ['scene-2'] },
      { id: 'scene-2', name: 'Closing', npcsPresent: [], leadsTo: [] },
    ],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
  };
}

function makeDeps(overrides: Partial<EpisodeArchitecturePhaseDeps> = {}): EpisodeArchitecturePhaseDeps {
  return {
    storyArchitect: { execute: vi.fn(async () => ({ success: true, data: makeBlueprint() })) } as any,
    cachedPipelineMemory: null,
    generationPlan: null,
    architectAdvisoryWarnings: [],
    seasonChoicePlan: undefined,
    emitPlanUpdate: vi.fn(),
    getTargetBeatCountForScene: vi.fn(() => 6),
    ...overrides,
  };
}

function makeBrief(): any {
  return {
    story: { title: 'Test Story', genre: 'fantasy', synopsis: 'a tale', tone: 'hopeful' },
    episode: { number: 1, title: 'Pilot', synopsis: 'it begins', startingLocation: 'loc-1' },
    protagonist: { id: 'hero', name: 'Hero', pronouns: 'they/them', description: 'a hero' },
    world: { premise: 'a world' },
    options: {},
  };
}

function makeContext(events: PipelineEvent[]): PipelineContext {
  return {
    config: { validation: { enabled: true }, generation: {} } as any,
    emit: (event) => events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  } as PipelineContext;
}

describe('EpisodeArchitecturePhase', () => {
  it('returns the blueprint, builds the season choice plan, and emits agent events', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const worldBible: any = { worldRules: ['rule one'], tensions: ['tension one'], locations: [] };
    const characterBible: any = { characters: [] };

    const blueprint = await new EpisodeArchitecturePhase(deps).run(
      makeBrief(), worldBible, characterBible, makeContext(events),
    );

    expect(blueprint.scenes).toHaveLength(2);
    // Season choice plan was written through the accessor-backed dep
    expect(deps.seasonChoicePlan).toBeDefined();
    expect(events.some(e => e.type === 'agent_start' && (e as any).agent === 'StoryArchitect')).toBe(true);
    expect(events.some(e => e.type === 'agent_complete'
      && (e as any).message === 'Created blueprint with 2 scenes')).toBe(true);
  });

  it('retries on scene-graph-branch failures with an escalated prompt, then throws', async () => {
    const execute = vi.fn(async () => ({ success: false, error: 'no valid branch point found' }));
    const deps = makeDeps({ storyArchitect: { execute } as any });
    const events: PipelineEvent[] = [];

    await expect(
      new EpisodeArchitecturePhase(deps).run(makeBrief(), { worldRules: [], tensions: [] } as any, { characters: [] } as any, makeContext(events)),
    ).rejects.toBeInstanceOf(PipelineError);

    expect(execute).toHaveBeenCalledTimes(3);
    const lastInput = (execute.mock.calls[2] as unknown[])[0] as any;
    expect(lastInput.userPrompt).toContain('CRITICAL BLUEPRINT BRANCH REPAIR');
    expect(events.filter(e => e.type === 'regeneration_triggered')).toHaveLength(2);
  });

  it('does not retry non-branch failures', async () => {
    const execute = vi.fn(async () => ({ success: false, error: 'provider exploded' }));
    const deps = makeDeps({ storyArchitect: { execute } as any });

    await expect(
      new EpisodeArchitecturePhase(deps).run(makeBrief(), { worldRules: [], tensions: [] } as any, { characters: [] } as any, makeContext([])),
    ).rejects.toBeInstanceOf(PipelineError);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('records advisory warnings through the accessor-backed sink', async () => {
    const deps = makeDeps({
      storyArchitect: {
        execute: vi.fn(async () => ({
          success: true,
          data: makeBlueprint(),
          warnings: ['stakes too vague in scene-2'],
        })),
      } as any,
    });
    const events: PipelineEvent[] = [];

    await new EpisodeArchitecturePhase(deps).run(
      makeBrief(), { worldRules: [], tensions: [] } as any, { characters: [] } as any, makeContext(events),
    );

    expect(deps.architectAdvisoryWarnings).toContain('stakes too vague in scene-2');
    expect(events.some(e => e.type === 'warning'
      && (e as any).message.includes('1 unresolved advisory issue(s)'))).toBe(true);
  });
});
