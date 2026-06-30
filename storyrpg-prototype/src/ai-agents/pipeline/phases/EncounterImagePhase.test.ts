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

import { EncounterImagePhase, EncounterImagePhaseDeps, EncounterImagePhaseInput } from './EncounterImagePhase';
import type { PipelineEvent } from '../events';

function makeDeps(overrides: Partial<EncounterImagePhaseDeps> = {}): EncounterImagePhaseDeps {
  return {
    imageService: {
      generateImage: vi.fn(async (_prompt: any, identifier: string) => ({ imageUrl: `img://${identifier}` })),
      checkImageForTextArtifacts: vi.fn(async () => ({ hasText: false })),
      findExistingGeneratedImage: vi.fn(() => undefined),
      setGeminiPreviousScene: vi.fn(),
      getEncounterDiagnostics: vi.fn(() => []),
      hasAtlasCloudConfigured: vi.fn(() => false),
    } as any,
    encounterImageAgent: {
      cinematicDescriptionToPrompt: vi.fn(() => ({ prompt: 'an encounter shot', negativePrompt: '' })),
    } as any,
    imageAgentTeam: {
      validateBodyLanguage: vi.fn(async () => ({ passed: true, issues: [] })),
      validateExpressions: vi.fn(async () => ({ passed: true, issues: [] })),
      validateVisualStorytelling: vi.fn(async () => ({ passed: true, issues: [] })),
    } as any,
    collectedVisualPlanning: { visualPlans: [] },
    checkCancellation: vi.fn(async () => undefined),
    buildCharacterDescriptions: vi.fn(() => []),
    ensureCharacterReferencesForVisibleCharacters: vi.fn(async (ids) => (ids || []).filter(Boolean) as string[]),
    gatherCharacterReferenceImages: vi.fn(() => []),
    getEffectiveImagePlanningMode: vi.fn(() => 'text' as const),
    getEffectiveImagePromptMode: vi.fn(() => 'deterministic' as const),
    getEffectiveImageQaMode: vi.fn(() => 'off' as const),
    getEpisodeScopedSceneId: vi.fn((brief, sceneId) => `episode-${brief.episode?.number ?? 0}-${sceneId}`),
    getStoryboardMaxPanelsPerSheet: vi.fn(() => 6),
    isLlmQuotaFailure: vi.fn(() => false),
    normalizeNarrativeText: vi.fn((raw, fallback = '') => (typeof raw === 'string' && raw.trim() ? raw.trim() : fallback)),
    resolvePlayerTemplates: vi.fn((text) => text),
    sanitizeImagePrompt: vi.fn((prompt) => prompt),
    saveSceneVisualPlanningDiagnostic: vi.fn(async () => undefined),
    scrubPromptArtifacts: vi.fn((text) => text),
    ...overrides,
  };
}

function makeBrief(): any {
  return {
    story: { title: 'Test Story', genre: 'fantasy', tone: 'hopeful', themes: ['trust'] },
    episode: { number: 1, title: 'Pilot' },
    protagonist: { id: 'hero', name: 'Hero', pronouns: 'they/them' },
    world: { keyLocations: [] },
  };
}

function makeEncounter(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'enc-1',
    encounterType: 'social',
    npcStates: [{ npcId: 'npc-1', name: 'Rival', initialDisposition: 'hostile' }],
    beats: [
      {
        id: 'beat-1',
        name: 'Standoff',
        setupText: 'You face the rival across the table.',
        choices: [],
      },
    ],
    ...overrides,
  };
}

function makeContext() {
  const events: Array<Omit<PipelineEvent, 'timestamp'>> = [];
  return {
    events,
    context: {
      config: { imageGen: { enabled: true }, artStyle: 'cinematic illustration' } as any,
      emit: (event: Omit<PipelineEvent, 'timestamp'>) => { events.push(event); },
      addCheckpoint: vi.fn(),
    },
  };
}

describe('EncounterImagePhase', () => {
  it('skips when imageGen is not enabled', async () => {
    const deps = makeDeps();
    const phase = new EncounterImagePhase(deps);
    const { context, events } = makeContext();
    context.config = { imageGen: { enabled: false } } as any;

    const input: EncounterImagePhaseInput = {
      encounters: new Map([['scene-1', makeEncounter()]]),
      characterBible: { characters: [] } as any,
      brief: makeBrief(),
    };
    const result = await phase.run(input, context);

    expect(result.encounterImages.size).toBe(0);
    expect(result.storyletImages.size).toBe(0);
    expect(result.storyletFailures).toEqual([]);
    expect((deps.imageService as any).generateImage).not.toHaveBeenCalled();
    expect(events.some(e => e.type === 'debug' && (e as any).message?.includes('imageGen not enabled'))).toBe(true);
    expect(events.some(e => e.type === 'phase_start')).toBe(false);
  });

  it('skips when there are no encounters', async () => {
    const deps = makeDeps();
    const phase = new EncounterImagePhase(deps);
    const { context, events } = makeContext();

    const result = await phase.run({
      encounters: new Map(),
      characterBible: { characters: [] } as any,
      brief: makeBrief(),
    }, context);

    expect(result.encounterImages.size).toBe(0);
    expect(events.some(e => e.type === 'debug' && (e as any).message?.includes('no encounters'))).toBe(true);
  });

  it('generates a setup image per beat and emits the event contract', async () => {
    const deps = makeDeps();
    const phase = new EncounterImagePhase(deps);
    const { context, events } = makeContext();

    const result = await phase.run({
      encounters: new Map([['scene-1', makeEncounter()]]),
      characterBible: { characters: [{ id: 'hero', name: 'Hero' }, { id: 'npc-1', name: 'Rival' }] } as any,
      brief: makeBrief(),
    }, context);

    const sceneImages = result.encounterImages.get('scene-1');
    expect(sceneImages).toBeDefined();
    expect(sceneImages!.setupImages.get('beat-1')).toBe('img://encounter-episode-1-scene-1-beat-1-setup');
    expect((deps.imageService as any).generateImage).toHaveBeenCalledTimes(1);
    expect(events.some(e => e.type === 'phase_start' && (e as any).phase === 'encounter_images')).toBe(true);
    expect(events.some(e => e.type === 'phase_complete' && (e as any).phase === 'encounter_images')).toBe(true);
    const manifest = events.find(e => e.type === 'checkpoint' && (e as any).phase === 'image_manifest');
    expect(manifest).toBeDefined();
    expect((manifest as any).data.manifestType).toBe('encounter');
  });

  it('generates outcome images for choice tiers via the encounter tree', async () => {
    const deps = makeDeps();
    const phase = new EncounterImagePhase(deps);
    const { context } = makeContext();

    const encounter = makeEncounter();
    encounter.beats[0].choices = [{
      id: 'choice-1',
      text: 'Press the advantage',
      outcomes: {
        success: { narrativeText: 'You win the exchange.' },
        failure: { narrativeText: 'You are rebuffed.' },
      },
    }];

    const result = await phase.run({
      encounters: new Map([['scene-1', encounter]]),
      characterBible: { characters: [{ id: 'hero', name: 'Hero' }, { id: 'npc-1', name: 'Rival' }] } as any,
      brief: makeBrief(),
    }, context);

    const sceneImages = result.encounterImages.get('scene-1');
    const outcomes = sceneImages!.outcomeImages.get('choice-1');
    expect(outcomes).toBeDefined();
    expect(outcomes!.success).toContain('img://');
    expect(outcomes!.failure).toContain('img://');
    expect(outcomes!.complicated).toBeUndefined();
    // setup + 2 outcomes
    expect((deps.imageService as any).generateImage).toHaveBeenCalledTimes(3);
  });

  it('records a failed setup slot without failing the whole phase', async () => {
    const deps = makeDeps();
    (deps.imageService as any).generateImage = vi.fn(async () => ({ imageUrl: undefined }));
    const phase = new EncounterImagePhase(deps);
    const { context, events } = makeContext();

    const result = await phase.run({
      encounters: new Map([['scene-1', makeEncounter()]]),
      characterBible: { characters: [] } as any,
      brief: makeBrief(),
    }, context);

    const sceneImages = result.encounterImages.get('scene-1');
    expect(sceneImages!.setupImages.size).toBe(0);
    expect(events.some(e => e.type === 'phase_complete')).toBe(true);
  });
});
