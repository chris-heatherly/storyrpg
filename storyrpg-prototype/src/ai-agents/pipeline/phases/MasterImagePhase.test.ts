import { describe, expect, it, vi, beforeEach } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

import { MasterImagePhase, MasterImagePhaseDeps, MasterImageBrief } from './MasterImagePhase';
import type { PipelineEvent } from '../events';

function makeGeneratedSheet(views: Array<[string, { imageData?: string; mimeType?: string }]> = [
  ['front', { imageData: 'front-bytes', mimeType: 'image/png' }],
]) {
  return {
    generatedImages: new Map(views),
    visualAnchors: ['anchor'],
    colorPalette: ['#111'],
  };
}

function makeDeps(overrides: Partial<MasterImagePhaseDeps> = {}): MasterImagePhaseDeps {
  return {
    imageAgentTeam: {
      auditIdentityDrift: vi.fn(() => []),
      invalidateStaleReferenceSheets: vi.fn(() => []),
      hasReferenceSheet: vi.fn(() => false),
      getReferenceSheet: vi.fn(() => undefined),
      setReferenceSheetIdentityFingerprint: vi.fn(),
      generateLocationMasterPrompt: vi.fn(async () => ({ success: true, data: { prompt: 'loc prompt' } })),
      generateFullCharacterReferenceWithSilhouette: vi.fn(async () => ({
        errors: [],
        poseSheet: { views: [{ viewType: 'front' }] },
      })),
      generateFullCharacterReferences: vi.fn(async () => makeGeneratedSheet()),
      generateExpressionSheetImages: vi.fn(async () => undefined),
      generateCharacterReferenceSheet: vi.fn(async () => ({
        success: true,
        data: { views: [{ viewType: 'front' }] },
      })),
      generateCharacterMasterPrompt: vi.fn(async () => ({ success: true, data: { prompt: 'portrait' } })),
    } as any,
    imageService: {
      generateImage: vi.fn(async () => ({ imageUrl: 'img://portrait' })),
      generateImageBatch: vi.fn(async (items: any[]) =>
        items.map(() => ({ imageData: 'loc-bytes', mimeType: 'image/png' }))),
      getMidjourneySettings: vi.fn(() => ({ fullAppearanceOmniWeight: 750 })),
      setReferenceSheetStyleAnchor: vi.fn(),
    } as any,
    checkCancellation: vi.fn(async () => undefined),
    emitPhaseProgress: vi.fn(),
    hydrateReferenceSheetFromDisk: vi.fn(async () => false),
    readCharacterMemory: vi.fn(async () => null),
    writeCharacterMemory: vi.fn(async () => undefined),
    shouldAttachCompositeCharacterRefs: vi.fn(() => false),
    locationMasterShots: new Map(),
    characterReferences: new Map(),
    ...overrides,
  };
}

function makeContext(events: PipelineEvent[]) {
  return {
    config: {
      imageGen: { provider: 'gemini', qa: { qaMode: 'off' } },
      artStyle: 'noir',
      agents: { storyArchitect: { provider: 'anthropic', model: 'test' } },
    } as any,
    emit: (event: Omit<PipelineEvent, 'timestamp'>) =>
      events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  };
}

const brief: MasterImageBrief = {
  story: { genre: 'gothic', tone: 'tense' },
  protagonist: { id: 'char-hero' },
  world: {
    keyLocations: [
      { id: 'loc-manor', importance: 'major' },
      { id: 'loc-alley', importance: 'minor' },
    ],
  },
};

const characterBible = {
  characters: [
    { id: 'char-side', name: 'Sidekick', role: 'ally', importance: 'supporting', overview: 'loyal friend' },
    { id: 'char-hero', name: 'Hero', role: 'lead', importance: 'core', overview: 'brooding detective' },
    { id: 'char-extra', name: 'Extra', role: 'bystander', importance: 'minor', overview: 'one-off' },
  ],
} as any;

const worldBible = {
  locations: [
    { id: 'loc-manor', name: 'The Manor', fullDescription: 'old manor', type: 'interior' },
    { id: 'loc-alley', name: 'The Alley', fullDescription: 'wet alley', type: 'exterior' },
  ],
} as any;

beforeEach(() => vi.clearAllMocks());

describe('MasterImagePhase.run', () => {
  it('generates references for major/core/supporting characters, anchor (protagonist) first; skips minor', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const order: string[] = [];
    (deps.imageAgentTeam.generateFullCharacterReferenceWithSilhouette as any).mockImplementation(
      async (req: any) => {
        order.push(req.characterId);
        return { errors: [], poseSheet: { views: [{ viewType: 'front' }] } };
      });
    // Supporting (non-core) characters take the simpler planning path.
    (deps.imageAgentTeam.generateCharacterReferenceSheet as any).mockImplementation(
      async (req: any) => {
        order.push(req.characterId);
        return { success: true, data: { views: [{ viewType: 'front' }] } };
      });

    await new MasterImagePhase(deps).run({ characterBible, worldBible, brief }, makeContext(events));

    // Protagonist runs first (style anchor), supporting char follows, minor char never runs.
    expect(order[0]).toBe('char-hero');
    expect(order).toContain('char-side');
    expect(order).not.toContain('char-extra');
    // D5 fingerprints stamped for every generated sheet
    expect(deps.imageAgentTeam.setReferenceSheetIdentityFingerprint).toHaveBeenCalledTimes(2);
    expect(deps.imageService.setReferenceSheetStyleAnchor).toHaveBeenCalled();
  });

  it('skips characters whose reference sheet already exists or hydrates from disk', async () => {
    const deps = makeDeps({
      imageAgentTeam: {
        ...makeDeps().imageAgentTeam,
        hasReferenceSheet: vi.fn((id: string) => id === 'char-hero'),
      } as any,
      hydrateReferenceSheetFromDisk: vi.fn(async (char: any) => char.id === 'char-side'),
    });
    const events: PipelineEvent[] = [];

    await new MasterImagePhase(deps).run({ characterBible, worldBible, brief }, makeContext(events));

    expect(deps.imageAgentTeam.generateFullCharacterReferenceWithSilhouette).not.toHaveBeenCalled();
    expect(deps.imageAgentTeam.generateCharacterReferenceSheet).not.toHaveBeenCalled();
    // Progress is still emitted for skipped characters
    expect(deps.emitPhaseProgress).toHaveBeenCalledWith(
      'master_images', expect.any(Number), expect.any(Number), 'master-assets', expect.stringContaining('Hero'));
  });

  it('batches master shots for major locations only and stores them in locationMasterShots', async () => {
    const deps = makeDeps({
      imageAgentTeam: {
        ...makeDeps().imageAgentTeam,
        hasReferenceSheet: vi.fn(() => true), // skip character work
      } as any,
    });
    const events: PipelineEvent[] = [];

    await new MasterImagePhase(deps).run({ characterBible, worldBible, brief }, makeContext(events));

    expect(deps.imageAgentTeam.generateLocationMasterPrompt).toHaveBeenCalledTimes(1);
    expect(deps.imageService.generateImageBatch).toHaveBeenCalledWith([
      expect.objectContaining({ identifier: 'master_loc_loc-manor' }),
    ]);
    expect(deps.locationMasterShots.get('loc-manor')).toEqual({ data: 'loc-bytes', mimeType: 'image/png' });
    expect(deps.locationMasterShots.has('loc-alley')).toBe(false);
  });

  it('promotes a minor character when the user supplied reference images for them', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const briefWithRefs: MasterImageBrief = {
      ...brief,
      characterReferenceImages: { Extra: [{ data: 'ref-bytes', mimeType: 'image/png' }] },
    };

    await new MasterImagePhase(deps).run(
      { characterBible, worldBible, brief: briefWithRefs }, makeContext(events));

    // Extra is non-major → simpler generation path, with the user refs passed through
    expect(deps.imageAgentTeam.generateCharacterReferenceSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-extra',
        userReferenceImages: [{ data: 'ref-bytes', mimeType: 'image/png' }],
      }));
  });

  it('turns a character generation failure into a warning and keeps the run alive', async () => {
    const deps = makeDeps({
      imageAgentTeam: {
        ...makeDeps().imageAgentTeam,
        generateFullCharacterReferenceWithSilhouette: vi.fn(async () => { throw new Error('provider down'); }),
        generateCharacterMasterPrompt: vi.fn(async () => ({ success: false, error: 'nope' })),
      } as any,
    });
    const events: PipelineEvent[] = [];

    await expect(
      new MasterImagePhase(deps).run({ characterBible, worldBible, brief }, makeContext(events))
    ).resolves.toBeUndefined();

    // Fallback portrait path was attempted for each failing character
    expect(deps.imageAgentTeam.generateCharacterMasterPrompt).toHaveBeenCalled();
  });
});

describe('MasterImagePhase.generateCharacterReferenceSheet', () => {
  const hero = characterBible.characters[1];

  it('short-circuits to the existing sheet when one is available', async () => {
    const existing = makeGeneratedSheet();
    const deps = makeDeps({
      imageAgentTeam: {
        ...makeDeps().imageAgentTeam,
        hasReferenceSheet: vi.fn(() => true),
        getReferenceSheet: vi.fn(() => existing),
      } as any,
    });
    const events: PipelineEvent[] = [];

    const sheet = await new MasterImagePhase(deps).generateCharacterReferenceSheet(
      hero, brief, undefined, makeContext(events));

    expect(sheet).toBe(existing);
    expect(deps.imageAgentTeam.generateFullCharacterReferenceWithSilhouette).not.toHaveBeenCalled();
  });

  it('collects the visual reference and writes character memory on the full path', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];

    const sheet = await new MasterImagePhase(deps).generateCharacterReferenceSheet(
      hero, brief, undefined, makeContext(events));

    expect(sheet).not.toBeNull();
    expect(deps.characterReferences.get('char-hero')).toEqual(
      expect.objectContaining({ characterId: 'char-hero', characterName: 'Hero' }));
    expect(deps.writeCharacterMemory).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-hero', generationSucceeded: true }));
    expect(deps.imageService.setReferenceSheetStyleAnchor).toHaveBeenCalledWith('front-bytes', 'image/png');
  });

  it('falls back to a single portrait when full reference planning fails outright', async () => {
    const deps = makeDeps({
      imageAgentTeam: {
        ...makeDeps().imageAgentTeam,
        generateFullCharacterReferenceWithSilhouette: vi.fn(async () => ({
          errors: ['planning failed'],
          poseSheet: undefined,
        })),
      } as any,
    });
    const events: PipelineEvent[] = [];

    const sheet = await new MasterImagePhase(deps).generateCharacterReferenceSheet(
      hero, brief, undefined, makeContext(events));

    expect(sheet).toBeNull();
    expect(deps.imageAgentTeam.generateCharacterMasterPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-hero' }));
    expect(deps.imageService.generateImage).toHaveBeenCalledWith(
      expect.anything(), 'master_char_char-hero', { type: 'master' });
    expect(events.some((e) => e.type === 'warning')).toBe(true);
  });

  it('uses the simpler generation path for non-major characters', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const side = characterBible.characters[0]; // supporting, not core/major/protagonist

    const sheet = await new MasterImagePhase(deps).generateCharacterReferenceSheet(
      side, brief, undefined, makeContext(events));

    expect(sheet).not.toBeNull();
    expect(deps.imageAgentTeam.generateFullCharacterReferenceWithSilhouette).not.toHaveBeenCalled();
    expect(deps.imageAgentTeam.generateCharacterReferenceSheet).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-side' }));
  });
});
