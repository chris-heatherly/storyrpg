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
  it('delegates eligible first-attempt architecture to the Story Council tournament', async () => {
    const execute = vi.fn(async () => ({ success: true, data: makeBlueprint() }));
    const selected = { ...makeBlueprint(), title: 'Council selection' };
    const runEpisodeBlueprintTournament = vi.fn(async () => ({
      response: { success: true, data: selected },
      decision: {
        version: 1,
        stage: 'episode-blueprint',
        mode: 'select',
        synthesisUsed: false,
        candidates: [],
        infrastructureErrors: [],
      },
    }));
    const deps = makeDeps({
      storyArchitect: { execute } as any,
      storyCouncil: { runEpisodeBlueprintTournament } as any,
    });

    const blueprint = await new EpisodeArchitecturePhase(deps).run(
      makeBrief(), { worldRules: [], tensions: [] } as any, { characters: [] } as any, makeContext([]),
    );

    expect(blueprint.title).toBe('Council selection');
    expect(runEpisodeBlueprintTournament).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'episode-blueprint',
      scope: { episodeNumber: 1 },
    }));
    expect(execute).not.toHaveBeenCalled();
  });

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

  it('retries on over-cap scene counts with cap-specific repair guidance', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'Blueprint must have no more than 6 scenes' })
      .mockResolvedValueOnce({ success: false, error: 'Blueprint has 7 scenes; maximum is 6' })
      .mockResolvedValueOnce({ success: true, data: makeBlueprint() });
    const deps = makeDeps({ storyArchitect: { execute } as any });
    const events: PipelineEvent[] = [];
    const brief = {
      ...makeBrief(),
      multiEpisode: {
        preferences: {
          targetScenesPerEpisode: 6,
        },
      },
    };

    await new EpisodeArchitecturePhase(deps).run(
      brief, { worldRules: [], tensions: [] } as any, { characters: [] } as any, makeContext(events),
    );

    expect(execute).toHaveBeenCalledTimes(3);
    const lastInput = (execute.mock.calls[2] as unknown[])[0] as any;
    expect(lastInput.userPrompt).toContain('CRITICAL BLUEPRINT SCENE CAP REPAIR');
    expect(lastInput.userPrompt).toContain('3-6 scenes total');
    expect(events.filter(e => e.type === 'regeneration_triggered')).toHaveLength(2);
    expect(events.filter(e => e.type === 'regeneration_triggered').map(e => (e as any).message)).toEqual([
      'Retrying StoryArchitect for scene-count cap repair (1/3)',
      'Retrying StoryArchitect for scene-count cap repair (2/3)',
    ]);
  });

  it('retries when a successful blueprint contains contradictory relationship architecture', async () => {
    const invalidBlueprint = makeBlueprint();
    invalidBlueprint.scenes[0] = {
      ...invalidBlueprint.scenes[0],
      name: 'Stela and Kylie become friends',
      relationshipPacing: [{
        id: 'rel-stela',
        source: 'treatment',
        npcId: 'stela',
        startStage: 'unmet',
        targetStage: 'spark',
        allowedLabels: ['spark'],
        blockedLabels: ['friend'],
        requiredEvidence: [],
        minScenesSinceIntroduction: 0,
        maxDeltaThisScene: 8,
        mechanicDimensions: ['trust'],
      }],
    };
    const execute = vi.fn()
      .mockResolvedValueOnce({ success: true, data: invalidBlueprint })
      .mockResolvedValueOnce({ success: true, data: makeBlueprint() });
    const deps = makeDeps({ storyArchitect: { execute } as any });
    const events: PipelineEvent[] = [];

    await new EpisodeArchitecturePhase(deps).run(
      makeBrief(), { worldRules: [], tensions: [] } as any, { characters: [] } as any, makeContext(events),
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect((execute.mock.calls[1] as unknown[])[0]).toMatchObject({
      userPrompt: expect.stringContaining('CRITICAL ARCHITECTURE CONTRACT REPAIR'),
    });
    expect(events.some((event) => event.type === 'regeneration_triggered'
      && String((event as any).message).includes('architecture contract conflict'))).toBe(true);
  });

  it('does not retry deterministic planned-scene density failures with prompt mutation', async () => {
    const execute = vi.fn(async () => ({
      success: false,
      error: '[TreatmentDensityGate] Episode 1 planned scene plan overload: Treatment density overload in scene "scene-2"',
    }));
    const deps = makeDeps({ storyArchitect: { execute } as any });
    const events: PipelineEvent[] = [];
    const brief = {
      ...makeBrief(),
      seasonPlan: {
        episodes: [{
          episodeNumber: 1,
          plannedScenes: [
            { id: 'scene-1', episodeNumber: 1, order: 1, kind: 'standard', title: 'Opening' },
            { id: 'scene-2', episodeNumber: 1, order: 2, kind: 'encounter', title: 'Encounter' },
          ],
          plannedEncounters: [],
        }],
        crossEpisodeBranches: [],
        consequenceChains: [],
        arcs: [],
        informationLedger: [],
      },
    };

    await expect(
      new EpisodeArchitecturePhase(deps).run(
        brief as any,
        { worldRules: [], tensions: [] } as any,
        { characters: [] } as any,
        makeContext(events),
      ),
    ).rejects.toBeInstanceOf(PipelineError);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.type === 'regeneration_triggered')).toHaveLength(0);
    expect(events.some(e => e.type === 'debug'
      && (e as any).message.includes('deterministic architecture mode'))).toBe(true);
  });

  it('raises the scene cap to match an authored season-scene slice', async () => {
    const execute = vi.fn(async () => ({ success: true, data: makeBlueprint() }));
    const deps = makeDeps({ storyArchitect: { execute } as any });
    const plannedScenes = Array.from({ length: 8 }, (_, index) => ({
      id: `planned-${index + 1}`,
      kind: index === 5 ? 'encounter' : 'scene',
      title: `Planned ${index + 1}`,
    }));
    const brief = {
      ...makeBrief(),
      seasonPlan: {
        episodes: [{
          episodeNumber: 1,
          plannedScenes,
          plannedEncounters: [],
        }],
        crossEpisodeBranches: [],
        consequenceChains: [],
        arcs: [],
        informationLedger: [],
      },
      multiEpisode: {
        preferences: {
          targetScenesPerEpisode: 6,
          targetChoicesPerEpisode: 4,
        },
      },
    };

    await new EpisodeArchitecturePhase(deps).run(
      brief, { worldRules: [], tensions: [] } as any, { characters: [] } as any, makeContext([]),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect((execute.mock.calls as any)[0][0].targetSceneCount).toBe(8);
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
