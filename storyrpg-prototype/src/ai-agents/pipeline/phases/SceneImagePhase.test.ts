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

import { SceneImagePhase, SceneImagePhaseDeps, SceneImagePhaseInput } from './SceneImagePhase';
import type { PipelineEvent } from '../events';

function makeDeps(overrides: Partial<SceneImagePhaseDeps> = {}): SceneImagePhaseDeps {
  return {
    imageAgentTeam: {
      runFullVisualQA: vi.fn(async () => ({ passed: true, issues: [] })),
      validatePoseDiversity: vi.fn(async () => ({ acceptable: true, warnings: [] })),
    } as any,
    imageService: {
      clearGeminiPreviousScene: vi.fn(),
      editImage: vi.fn(),
      endChatSession: vi.fn(),
      generateImage: vi.fn(async () => ({ imageUrl: 'img://beat' })),
      generateImageInChat: vi.fn(async () => ({ imageUrl: 'img://chat-beat' })),
      getGeminiSettings: vi.fn(() => ({})),
      getMaxRetries: vi.fn(() => 1),
      hasChatSession: vi.fn(() => false),
      setGeminiPreviousScene: vi.fn(),
      setSeasonStyleReference: vi.fn(),
      startChatSession: vi.fn(),
    } as any,
    assetRegistry: {
      get: vi.fn(() => undefined),
      getResolvedAsset: vi.fn(() => undefined),
      markFailure: vi.fn(),
      markRendering: vi.fn(),
      markSuccess: vi.fn(),
      planSlot: vi.fn(),
    } as any,
    collectedVisualPlanning: { visualPlans: [] },
    checkCancellation: vi.fn(async () => undefined),
    _generatedStyleReferencesAllowed: true,
    _preWarmedColorScriptPromise: null,
    _openingBeatPrefetch: new Map(),
    _uploadedStyleReferenceImages: [],
    analyzeBeatCharacters: vi.fn(() => ({ foreground: [], background: [], foregroundNames: [], backgroundNames: [] })),
    applyThirdPersonRenderContract: vi.fn((prompt) => prompt),
    buildBeatSceneStoryboardPlan: vi.fn(() => ({ sheets: [], panels: [] } as any)),
    buildCharacterDescriptions: vi.fn(() => []),
    createSlotReferencePack: vi.fn(() => undefined),
    ensureCharacterReferencesForVisibleCharacters: vi.fn(async () => []),
    extractSceneContext: vi.fn(() => ({
      isClimactic: false,
      isResolution: false,
      isFlashback: false,
      isNightmare: false,
      isSafeHubScene: false,
      branchType: 'neutral' as const,
    })),
    findExistingImageArtifact: vi.fn(async () => undefined),
    gatherCharacterBodyVocabularies: vi.fn(() => []),
    gatherCharacterReferenceImages: vi.fn(() => []),
    generateEpisodeColorScript: vi.fn(async () => undefined),
    generateEpisodeStyleBible: vi.fn(async () => false),
    generateImageWithDefectRetries: vi.fn(async () => ({ imageUrl: 'img://beat' } as any)),
    getCharacterIdsInScene: vi.fn(() => []),
    getEffectiveImagePlanningMode: vi.fn(() => 'text' as const),
    getEffectiveImagePromptMode: vi.fn(() => 'deterministic' as const),
    getEffectiveImageQaMode: vi.fn(() => 'off' as const),
    getEpisodeScopedBeatKey: vi.fn((brief, sceneId, beatId) => `episode-${brief.episode?.number ?? 0}-${sceneId}::${beatId}`),
    getEpisodeScopedSceneId: vi.fn((brief, sceneId) => `episode-${brief.episode?.number ?? 0}-${sceneId}`),
    getStoryboardMaxPanelsPerSheet: vi.fn(() => 6),
    inferIntensity: vi.fn(() => 'low' as const),
    inferValence: vi.fn(() => 'ambiguous' as const),
    isEstablishingBeat: vi.fn(() => false),
    isLlmQuotaFailure: vi.fn(() => false),
    mapChoicePositions: vi.fn(() => []),
    mapSpeakerMoodToEmotion: vi.fn(() => 'neutral' as const),
    prefetchSceneOpeningBeats: vi.fn(async () => undefined),
    promptMentionsDisallowedCharacters: vi.fn(() => []),
    promptMissingRequiredCharacters: vi.fn(() => []),
    reconcileOrphanedBeatImages: vi.fn(() => 0),
    runLoraTrainingIfEligible: vi.fn(async () => undefined),
    sanitizeImagePrompt: vi.fn((prompt) => prompt),
    sanitizePromptText: vi.fn((raw) => (typeof raw === 'string' ? raw : '')),
    saveBeatVisualQADiagnostic: vi.fn(async () => undefined),
    saveSceneVisualPlanningDiagnostic: vi.fn(async () => undefined),
    saveSceneVisualQADiagnostic: vi.fn(async () => undefined),
    serializeVisualQAReport: vi.fn(() => ({})),
    shouldRunHeroVisualQA: vi.fn(() => false),
    throwIfFailFast: vi.fn(),
    withSettingAwarePrompt: vi.fn((prompt) => prompt),
    wrapLlmImagePromptWithContracts: vi.fn((prompt) => prompt),
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

function makeScene(beats: Array<{ id: string; text: string }>): any {
  return {
    sceneId: 'scene-1',
    sceneName: 'Opening',
    beats,
    charactersInvolved: [],
    keyMoments: [],
    moodProgression: ['calm'],
    continuityNotes: [],
  };
}

function makeContext() {
  const events: Array<Omit<PipelineEvent, 'timestamp'>> = [];
  return {
    events,
    context: {
      config: { imageGen: { qa: { qaMode: 'off' } } } as any,
      emit: (event: Omit<PipelineEvent, 'timestamp'>) => { events.push(event); },
      addCheckpoint: vi.fn(),
    },
  };
}

describe('SceneImagePhase', () => {
  it('skips color script + style bible on missing-slot resume and still reconciles orphans', async () => {
    const deps = makeDeps({ _preWarmedColorScriptPromise: Promise.resolve({ arc: [] } as any) });
    const phase = new SceneImagePhase(deps);
    const { context, events } = makeContext();

    const input: SceneImagePhaseInput = {
      sceneContents: [],
      choiceSets: [],
      brief: makeBrief(),
      worldBible: { locations: [] } as any,
      characterBible: { characters: [] } as any,
      options: { skipColorScriptAndStyleBible: true, missingSlotIds: [] },
    };
    const result = await phase.run(input, context);

    expect(result.beatImages.size).toBe(0);
    expect(result.sceneImages.size).toBe(0);
    expect(deps._preWarmedColorScriptPromise).toBeNull();
    expect(deps.generateEpisodeColorScript).not.toHaveBeenCalled();
    expect(deps.generateEpisodeStyleBible).not.toHaveBeenCalled();
    expect(deps.reconcileOrphanedBeatImages).toHaveBeenCalledTimes(1);
    expect(events.some(e => (e as any).message?.includes('missing-slot resume'))).toBe(true);
  });

  it('consumes the pre-warmed color script and stores it on collectedVisualPlanning', async () => {
    const colorScript = { arc: ['warm'] } as any;
    const deps = makeDeps({ _preWarmedColorScriptPromise: Promise.resolve(colorScript) });
    const phase = new SceneImagePhase(deps);
    const { context } = makeContext();

    await phase.run({
      sceneContents: [],
      choiceSets: [],
      brief: makeBrief(),
      worldBible: { locations: [] } as any,
      characterBible: { characters: [] } as any,
    }, context);

    expect(deps.generateEpisodeColorScript).not.toHaveBeenCalled();
    expect(deps.collectedVisualPlanning.colorScript).toBe(colorScript);
    expect(deps.generateEpisodeStyleBible).toHaveBeenCalledWith(expect.anything(), colorScript, expect.anything(), undefined);
    expect(deps._preWarmedColorScriptPromise).toBeNull();
  });

  it('falls back to a fresh color script call when no pre-warmed promise exists', async () => {
    const deps = makeDeps();
    const phase = new SceneImagePhase(deps);
    const { context } = makeContext();

    await phase.run({
      sceneContents: [],
      choiceSets: [],
      brief: makeBrief(),
      worldBible: { locations: [] } as any,
      characterBible: { characters: [] } as any,
    }, context);

    expect(deps.generateEpisodeColorScript).toHaveBeenCalledTimes(1);
    // No color script returned -> style bible never runs
    expect(deps.generateEpisodeStyleBible).not.toHaveBeenCalled();
  });

  it('treats a LoRA training failure as non-fatal', async () => {
    const deps = makeDeps({
      runLoraTrainingIfEligible: vi.fn(async () => { throw new Error('lora exploded'); }),
    });
    const phase = new SceneImagePhase(deps);
    const { context, events } = makeContext();

    const result = await phase.run({
      sceneContents: [],
      choiceSets: [],
      brief: makeBrief(),
      worldBible: { locations: [] } as any,
      characterBible: { characters: [] } as any,
    }, context);

    expect(result.beatImages.size).toBe(0);
    expect(events.some(e => e.type === 'warning' && (e as any).message?.includes('LoRA training pass threw'))).toBe(true);
  });

  it('reuses registry-resolved beat images without calling the image service', async () => {
    const deps = makeDeps({
      assetRegistry: {
        get: vi.fn(() => undefined),
        getResolvedAsset: vi.fn(() => ({ latestUrl: 'img://resumed' })),
        markFailure: vi.fn(),
        markRendering: vi.fn(),
        markSuccess: vi.fn(),
        planSlot: vi.fn(),
      } as any,
    });
    const phase = new SceneImagePhase(deps);
    const { context } = makeContext();

    const result = await phase.run({
      sceneContents: [makeScene([{ id: 'beat-1', text: 'You enter the hall.' }])],
      choiceSets: [],
      brief: makeBrief(),
      worldBible: { locations: [] } as any,
      characterBible: { characters: [] } as any,
    }, context);

    expect(result.beatImages.get('episode-1-scene-1::beat-1')).toBe('img://resumed');
    expect(result.sceneImages.get('episode-1-scene-1')).toBe('img://resumed');
    expect(deps.imageService.generateImage).not.toHaveBeenCalled();
    expect(deps.generateImageWithDefectRetries).not.toHaveBeenCalled();
  });
});
