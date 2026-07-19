import { describe, expect, it } from 'vitest';
import {
  assertValidWorkerPayload,
  assertWorkerJobConfigHash,
  computeWorkerJobConfigHash,
  type WorkerPayload,
} from './workerPayload';

describe('assertValidWorkerPayload', () => {
  it('freezes hydrated job settings with a deterministic hash', () => {
    const config = { imageGen: { enabled: false }, agents: { writer: { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'secret' } } };
    const hash = computeWorkerJobConfigHash('generation', config);
    const payload: WorkerPayload = { protocolVersion: 2, mode: 'generation', config, jobConfigHash: hash, resultPath: '/tmp/result.json', generationInput: { brief: {}, manifest: { version: 1, sourceKind: 'invent', requestedEpisodes: [1] } } };
    expect(() => assertWorkerJobConfigHash(payload)).not.toThrow();
    expect(() => assertWorkerJobConfigHash({ ...payload, config: { ...config, imageGen: { enabled: true } } })).toThrow(/hash mismatch/i);
  });

  it('accepts a valid generation payload', () => {
    const payload = {
      protocolVersion: 2,
      mode: 'generation',
      config: {},
      resultPath: '/tmp/result.json',
      generationInput: {
        brief: {
          story: { title: 'Test' },
        },
        manifest: { version: 1, sourceKind: 'invent', requestedEpisodes: [1] },
      },
    };

    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
  });

  it('accepts a bounded variant run context and rejects ordinals outside the batch', () => {
    const payload = {
      protocolVersion: 2,
      mode: 'generation',
      config: {},
      resultPath: '/tmp/result.json',
      generationInput: {
        brief: { story: { title: 'Test' } },
        manifest: { version: 1, sourceKind: 'invent', requestedEpisodes: [1] },
        runContext: { kind: 'variant', batchId: 'batch-1', variantId: 'variant-1', ordinal: 1, total: 4 },
      },
    };
    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
    expect(() => assertValidWorkerPayload({
      ...payload,
      generationInput: { ...payload.generationInput, runContext: { ...payload.generationInput.runContext, ordinal: 5 } },
    })).toThrow(/runContext is malformed/i);
  });

  it('accepts an immutable generation manifest and rejects malformed episode scope', () => {
    const payload = {
      protocolVersion: 2,
      mode: 'generation',
      config: {},
      resultPath: '/tmp/result.json',
      generationInput: {
        brief: { story: { title: 'Bite Me' } },
        manifest: { version: 1, sourceKind: 'authored_lite', requestedEpisodes: [1], seasonPlanId: 'bite-me-plan' },
      },
    };
    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
    expect(() => assertValidWorkerPayload({
      ...payload,
      generationInput: { ...payload.generationInput, manifest: { ...payload.generationInput.manifest, requestedEpisodes: [] } },
    })).toThrow(/manifest is malformed/i);
  });

  it('accepts optional worker display labels', () => {
    const payload = {
      protocolVersion: 2,
      mode: 'generation',
      config: {},
      resultPath: '/tmp/result.json',
      friendlyName: 'Bite Me · Story generation · Episodes 1-8',
      processTitle: 'storyrpg:generation:Bite-Me',
      generationInput: {
        brief: {
          story: { title: 'Bite Me' },
        },
        manifest: { version: 1, sourceKind: 'invent', requestedEpisodes: [1] },
      },
    };

    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
  });

  it('accepts a valid image-generation payload', () => {
    const payload = {
      protocolVersion: 2,
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
      protocolVersion: 2,
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

  it('accepts a valid compile-episode payload', () => {
    const payload = {
      protocolVersion: 2,
      mode: 'compile-episode',
      config: {},
      resultPath: '/tmp/result.json',
      compileEpisodeInput: {
        outputDirectory: '/tmp/generated-story/',
        request: {
          storyRunId: 'run',
          episodeNumber: 3,
          mode: 'revalidate',
          contextSource: 'latest',
          totalEpisodes: 5,
        },
      },
    };

    expect(() => assertValidWorkerPayload(payload)).not.toThrow();
  });

  it('rejects malformed spot image-generation target slots', () => {
    const payload = {
      protocolVersion: 2,
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
      protocolVersion: 2,
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
      protocolVersion: 2,
      mode: 'image-generation',
      config: {},
      resultPath: '/tmp/result.json',
      imageGenerationInput: {},
    };

    expect(() => assertValidWorkerPayload(payload)).toThrow(/outputDirectory/i);
  });

  it('rejects compile-episode without a request', () => {
    const payload = {
      protocolVersion: 2,
      mode: 'compile-episode',
      config: {},
      resultPath: '/tmp/result.json',
      compileEpisodeInput: {
        outputDirectory: '/tmp/generated-story/',
      },
    };

    expect(() => assertValidWorkerPayload(payload)).toThrow(/request/i);
  });
});
