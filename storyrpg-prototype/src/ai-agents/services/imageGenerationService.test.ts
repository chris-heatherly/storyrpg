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

  it('treats OpenAI moderation blocks as permanent per-slot failures', () => {
    const err = new Error('OpenAI image API error 400: {"error":{"message":"Your request was rejected by the safety system.","type":"image_generation_user_error","code":"moderation_blocked"}}');
    expect(ImageGenerationService.classifyError(err)).toBe('permanent');
  });

  it('keeps text-instead-of-image distinct from other transient failures', () => {
    expect(ImageGenerationService.classifyError(new Error('Gemini returned text instead of image: hello')))
      .toBe('text_instead_of_image');
  });
});

describe('ImageGenerationService OpenAI safety rewrite', () => {
  it('rewrites commonly blocked graphic terms while preserving the scene request', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const rewritten = (service as any).buildOpenAiSafetyRetryPrompt(
      'Detective Riley Kane finds a dead body with bloody evidence after a murder. Style: noir.'
    );

    expect(rewritten).toContain('safe, PG-13 visual adaptation');
    expect(rewritten).toContain('Detective Riley Kane');
    expect(rewritten).not.toMatch(/\bdead body\b/i);
    expect(rewritten).not.toMatch(/\bbloody\b/i);
    expect(rewritten).not.toMatch(/\bmurder\b/i);
  });
});

describe('ImageGenerationService stable-diffusion wiring', () => {
  it('returns a preflight failure when SD is selected without a baseUrl', async () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'stable-diffusion',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    const result = await service.preflightImageProvider(false);
    expect(result.provider).toBe('stable-diffusion');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/baseUrl/i);
  });

  it('applyDeterministicSeed pins a stable seed when prompt omits one', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'stable-diffusion',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    const prompt: any = { prompt: 'hero' };
    const a = service.applyDeterministicSeed(prompt, 'scene-1-beat-1', {
      sceneId: 'scene-1',
      characterName: 'hero',
    });
    const b = service.applyDeterministicSeed(prompt, 'scene-1-beat-1', {
      sceneId: 'scene-1',
      characterName: 'hero',
    });
    expect(typeof a.seed).toBe('number');
    expect(a.seed).toBe(b.seed);
    // Explicit seed on prompt should win
    const forced = service.applyDeterministicSeed({ ...prompt, seed: 42 }, 'x', {});
    expect(forced.seed).toBe(42);
  });

  it('applyDeterministicSeed honors seedScope override for pure per-character seeds (D6)', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'stable-diffusion',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    const prompt: any = { prompt: 'hero' };
    // Without override, sceneId + characterName -> characterInScene scope (scene-salted).
    const s1 = service.applyDeterministicSeed(prompt, 'x', {
      sceneId: 'scene-1',
      characterName: 'hero',
    });
    const s2 = service.applyDeterministicSeed(prompt, 'x', {
      sceneId: 'scene-2',
      characterName: 'hero',
    });
    expect(s1.seed).not.toBe(s2.seed);
    // With seedScope override, the seed is stable across scenes for the same character.
    const c1 = service.applyDeterministicSeed(prompt, 'x', {
      sceneId: 'scene-1',
      characterName: 'hero',
      seedScope: 'character',
    });
    const c2 = service.applyDeterministicSeed(prompt, 'x', {
      sceneId: 'scene-2',
      characterName: 'hero',
      seedScope: 'character',
    });
    expect(c1.seed).toBe(c2.seed);
  });

  it('applyDeterministicSeed derives stable seeds for multi-character scenes (D6)', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'stable-diffusion',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    const prompt: any = { prompt: 'group' };
    // Same cast in different order should yield the same seed (sorted join).
    const a = service.applyDeterministicSeed(prompt, 'x', {
      sceneId: 'scene-1',
      characterIds: ['alice', 'bob'],
    });
    const b = service.applyDeterministicSeed(prompt, 'x', {
      sceneId: 'scene-1',
      characterIds: ['bob', 'alice'],
    });
    expect(a.seed).toBe(b.seed);
    // Different cast yields a different seed.
    const c = service.applyDeterministicSeed(prompt, 'x', {
      sceneId: 'scene-1',
      characterIds: ['alice', 'cara'],
    });
    expect(a.seed).not.toBe(c.seed);
  });
});

describe('ImageGenerationService character reference audit', () => {
  it('marks DALL-E character-visible shots as edit-with-refs when usable refs survive filtering', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const audit = (service as any).buildCharacterReferenceAudit(
      'dall-e',
      { characterNames: ['Mr. Boddy'], type: 'encounter-outcome' },
      [{ data: 'abc', mimeType: 'image/png', role: 'character-reference', characterName: 'Mr. Boddy', viewType: 'front' }],
      [{ data: 'abc', mimeType: 'image/png', role: 'character-reference', characterName: 'Mr. Boddy', viewType: 'front' }],
    );

    expect(audit.referenceRoute).toBe('edit-with-refs');
    expect(audit.effectiveCharacterRefs['Mr. Boddy']).toBe(1);
    expect(audit.missingReferenceCharacters).toEqual([]);
  });

  it('reports missing visible characters when provider filtering drops refs', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const audit = (service as any).buildCharacterReferenceAudit(
      'dall-e',
      { characterNames: ['Detective Riley Kane', 'Mr. Boddy'], type: 'encounter-outcome' },
      [{ data: 'abc', mimeType: 'image/png', role: 'character-reference', characterName: 'Detective Riley Kane', viewType: 'front' }],
      [],
    );

    expect(audit.referenceRoute).toBe('text-only');
    expect(audit.missingReferenceCharacters).toEqual(['Detective Riley Kane', 'Mr. Boddy']);
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
