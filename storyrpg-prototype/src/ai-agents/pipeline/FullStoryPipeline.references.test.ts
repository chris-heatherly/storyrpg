// @ts-nocheck
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

async function makePipeline(provider: string) {
  const { FullStoryPipeline } = await import('./FullStoryPipeline');
  const getCompositeReferenceImage = vi.fn(() => ({
    data: 'composite-bytes',
    mimeType: 'image/png',
    name: 'Aoi-composite',
  }));
  const pipeline = Object.create(FullStoryPipeline.prototype);
  pipeline.config = { imageGen: { provider } };
  pipeline._styleAnchorPaths = {};
  pipeline._uploadedStyleReferenceImages = [];
  pipeline.imageService = {
    getGeminiSettings: () => ({ maxRefImagesPerCharacter: 2 }),
    getMidjourneySettings: () => ({ maxRefImagesPerCharacter: 2 }),
  };
  pipeline.imageAgentTeam = {
    getCharacterReferenceImages: vi.fn(() => [
      { data: 'front-bytes', mimeType: 'image/png', name: 'Aoi-front' },
    ]),
    getCharacterConsistencyInfo: vi.fn(() => undefined),
    getCompositeReferenceImage,
  };
  return { pipeline, getCompositeReferenceImage };
}

const characterBible = {
  characters: [
    { id: 'char-aoi', name: 'Aoi' },
  ],
};

describe('FullStoryPipeline character reference gathering', () => {
  it('does not request cached composite sheets for GPT Image 2 jobs', async () => {
    const { pipeline, getCompositeReferenceImage } = await makePipeline('dall-e');

    const refs = pipeline.gatherCharacterReferenceImages(['char-aoi'], characterBible);

    expect(getCompositeReferenceImage).not.toHaveBeenCalled();
    expect(refs.map((ref) => ref.role)).toEqual(['character-reference']);
    expect(refs.some((ref) => ref.role === 'composite-sheet')).toBe(false);
  });

  it('keeps composite sheets for Midjourney reference jobs', async () => {
    const { pipeline, getCompositeReferenceImage } = await makePipeline('midapi');

    const refs = pipeline.gatherCharacterReferenceImages(['char-aoi'], characterBible);

    expect(getCompositeReferenceImage).toHaveBeenCalledWith('char-aoi');
    expect(refs.map((ref) => ref.role)).toEqual(['character-reference', 'composite-sheet']);
  });
});
