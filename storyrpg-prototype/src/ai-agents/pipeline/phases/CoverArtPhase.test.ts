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

import { CoverArtPhase, CoverArtPhaseDeps } from './CoverArtPhase';
import type { PipelineContext } from './index';

function makeBrief() {
  return {
    story: {
      title: 'Test Story',
      genre: 'thriller',
      tone: 'dark',
      themes: ['trust'],
      synopsis: 'A test synopsis.',
    },
    protagonist: { id: 'char-1', name: 'Alex', description: 'Alex: a tester' },
  } as any;
}

function makeCharacterBible() {
  return {
    characters: [
      { id: 'char-1', name: 'Alex', role: 'protagonist', importance: 'major', physicalDescription: 'tall' },
      { id: 'char-2', name: 'Mara', role: 'antagonist', importance: 'major', physicalDescription: 'sharp' },
    ],
  } as any;
}

function makeWorldBible() {
  return {
    locations: [{ id: 'loc-1', name: 'The Club', type: 'venue', fullDescription: 'A loud club.' }],
  } as any;
}

function makeDeps(overrides: Partial<CoverArtPhaseDeps> = {}): CoverArtPhaseDeps {
  return {
    imageService: {
      getGeminiSettings: vi.fn(() => ({ canonicalArtStyle: 'noir comic', maxRefImagesPerCharacter: 2 })),
    } as any,
    imageAgentTeam: {
      getCharacterReferenceImages: vi.fn(() => [
        { name: 'Alex-front', data: 'AAA', mimeType: 'image/png' },
      ]),
      getCompositeReferenceImage: vi.fn(() => null),
    } as any,
    uploadedStyleReferenceImages: () => [],
    resolveProtagonistCharacterId: vi.fn(() => 'char-1'),
    resolveCharacterIdWithBrief: vi.fn(() => 'char-1'),
    shouldAttachCompositeCharacterRefs: vi.fn(() => false),
    generateImageWithDefectRetries: vi.fn(async () => ({ imageUrl: 'image://cover' } as any)),
    buildCharacterDescriptions: vi.fn(() => []),
    ...overrides,
  };
}

function makeContext(events: any[], imageGenEnabled = true): PipelineContext {
  return {
    config: {
      imageGen: imageGenEnabled ? { enabled: true } : { enabled: false },
      artStyle: 'noir comic',
      agents: { storyArchitect: { provider: 'test', model: 'test' } },
    } as any,
    emit: (event) => events.push(event),
    addCheckpoint: vi.fn(),
  };
}

describe('CoverArtPhase', () => {
  it('skips entirely when image generation is disabled', async () => {
    const events: any[] = [];
    const deps = makeDeps();
    const phase = new CoverArtPhase(deps);
    const url = await phase.run(
      { brief: makeBrief(), characterBible: makeCharacterBible(), worldBible: makeWorldBible() },
      makeContext(events, false),
    );
    expect(url).toBeUndefined();
    expect(deps.generateImageWithDefectRetries).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('generates the cover and returns its url on the happy path', async () => {
    const events: any[] = [];
    const deps = makeDeps();
    // Make the distiller LLM call fail fast so the fallback concept block is used —
    // the phase must treat distillation failure as non-blocking.
    const phase = new CoverArtPhase(deps);
    const url = await phase.run(
      { brief: makeBrief(), characterBible: makeCharacterBible(), worldBible: makeWorldBible(), outputDirectory: '/tmp/out/' },
      makeContext(events),
    );
    expect(url).toBe('image://cover');
    expect(deps.generateImageWithDefectRetries).toHaveBeenCalledTimes(1);
    const [prompt, identifier, metadata, refs, label, outDir] =
      (deps.generateImageWithDefectRetries as any).mock.calls[0];
    expect(identifier).toBe('story-cover');
    expect(label).toBe('StoryCoverArt');
    expect(outDir).toBe('/tmp/out/');
    expect(metadata.characters).toEqual(['char-1']);
    expect(prompt.aspectRatio).toBe('2:3');
    // Protagonist + antagonist reference images are attached.
    expect(refs.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'agent_start')).toBe(true);
    expect(events.some((e) => e.type === 'agent_complete')).toBe(true);
  });

  it('returns undefined and emits a warning when rendering fails (non-blocking)', async () => {
    const events: any[] = [];
    const deps = makeDeps({
      generateImageWithDefectRetries: vi.fn(async () => {
        throw new Error('render exploded');
      }),
    });
    const phase = new CoverArtPhase(deps);
    const url = await phase.run(
      { brief: makeBrief(), characterBible: makeCharacterBible(), worldBible: makeWorldBible() },
      makeContext(events),
    );
    expect(url).toBeUndefined();
    expect(events.some((e) => e.type === 'warning' && /Cover art generation failed/.test(e.message))).toBe(true);
  });
});
