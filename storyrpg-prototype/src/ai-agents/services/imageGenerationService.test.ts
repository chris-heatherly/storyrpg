import { beforeAll, describe, expect, it, vi } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

let ImageGenerationService: typeof import('./imageGenerationService').ImageGenerationService;

beforeAll(async () => {
  ({ ImageGenerationService } = await import('./imageGenerationService'));
});

describe('ImageGenerationService.classifyError', () => {
  it('treats malformed Gemini schema responses as transient', () => {
    const err = Object.assign(new Error('Invalid API response structure'), {
      providerFailureKind: 'schema_invalid',
    });
    expect(ImageGenerationService.classifyError(err)).toBe('transient');
  });

  it('treats blocked Gemini responses as permanent', () => {
    const err = Object.assign(new Error('Gemini response blocked by safety or policy'), {
      providerFailureKind: 'safety_block',
    });
    expect(ImageGenerationService.classifyError(err)).toBe('permanent');
  });

  it('keeps text-instead-of-image distinct from other transient failures', () => {
    expect(ImageGenerationService.classifyError(new Error('Gemini returned text instead of image: hello')))
      .toBe('text_instead_of_image');
  });
});

describe('ImageGenerationService prompt cache hashing', () => {
  it('separates deep encounter branches by choice path and base slot identity', () => {
    const service = new ImageGenerationService({
      enabled: false,
      provider: 'nano-banana',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const prompt = {
      prompt: 'A tense magical standoff',
      style: 'painterly fantasy',
    } as any;

    const branchA = (service as any).computePromptHash(prompt, {
      sceneId: 'episode-2-scene-4',
      beatId: 'beat-1',
      choiceId: 'c1::success::c2',
      tier: 'failure',
      type: 'encounter-outcome',
      baseIdentifier: 'encounter-episode-2-scene-4-beat-1-c1-path-success-path-c2-failure',
    });
    const branchB = (service as any).computePromptHash(prompt, {
      sceneId: 'episode-2-scene-4',
      beatId: 'beat-1',
      choiceId: 'c1::complicated::c2',
      tier: 'failure',
      type: 'encounter-outcome',
      baseIdentifier: 'encounter-episode-2-scene-4-beat-1-c1-path-complicated-path-c2-failure',
    });

    expect(branchA).not.toBe(branchB);
  });
});
