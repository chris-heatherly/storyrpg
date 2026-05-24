import { describe, expect, it } from 'vitest';
import { assertValidWorkerPayload } from './workerPayload';

describe('assertValidWorkerPayload', () => {
  it('accepts a valid generation payload', () => {
    const payload = {
      mode: 'generation',
      config: {},
      resultPath: '/tmp/result.json',
      generationInput: {
        brief: {
          story: { title: 'Test' },
        },
      },
    };

    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
  });

  it('accepts a valid image-generation payload', () => {
    const payload = {
      mode: 'image-generation',
      config: {},
      resultPath: '/tmp/result.json',
      imageGenerationInput: {
        outputDirectory: '/tmp/generated-story/',
        targetEpisodeNumber: 2,
      },
    };

    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
  });

  it('accepts spot image-generation target slots', () => {
    const payload = {
      mode: 'image-generation',
      config: {},
      resultPath: '/tmp/result.json',
      imageGenerationInput: {
        outputDirectory: 'generated-stories/story-1',
        mode: 'spot',
        targetSlots: [{ episodeNumber: 1, sceneId: 'scene-3', beatId: 'beat-1' }],
        skipEncounterImages: true,
        skipCover: true,
        skipCharacterRefs: true,
        skipVisualContractValidation: true,
      },
    };

    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
  });

  it('rejects malformed spot image-generation target slots', () => {
    const payload = {
      mode: 'image-generation',
      config: {},
      resultPath: '/tmp/result.json',
      imageGenerationInput: {
        outputDirectory: 'generated-stories/story-1',
        mode: 'spot',
        targetSlots: [{ episodeNumber: 0, sceneId: '', beatId: 'beat-1' }],
      },
    };

    expect(() => assertValidWorkerPayload(payload)).toThrow(/targetSlots entries/i);
  });

  it('rejects a malformed analysis payload', () => {
    const payload = {
      mode: 'analysis',
      config: {},
      resultPath: '/tmp/result.json',
      analysisInput: {
        title: 'Missing source text',
      },
    };

    expect(() => assertValidWorkerPayload(payload)).toThrow(/sourceText and title/i);
  });

  it('rejects image-generation without an output directory', () => {
    const payload = {
      mode: 'image-generation',
      config: {},
      resultPath: '/tmp/result.json',
      imageGenerationInput: {},
    };

    expect(() => assertValidWorkerPayload(payload)).toThrow(/outputDirectory/i);
  });
});
