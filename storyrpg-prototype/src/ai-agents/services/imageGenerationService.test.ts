import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

  it('falls back to prompt characterIdentity when metadata characterNames are absent', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
      requireCharacterRefsForVisibleCharacters: true,
    } as any);

    const audit = (service as any).buildCharacterReferenceAudit(
      'dall-e',
      { type: 'beat' },
      { prompt: 'Visible shot cast: Mika Kuroda only.', characterIdentity: ['Mika Kuroda'] },
      [],
      [],
    );

    expect(audit.visibleCharacters).toEqual(['Mika Kuroda']);
    expect(audit.missingReferenceCharacters).toEqual(['Mika Kuroda']);
    expect((service as any).shouldEnforceCharacterReferenceContinuity({ type: 'beat' }, audit)).toBe(true);
  });

  it('uses resolved style for DALL-E requests even when prompt.style is missing', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-dalle-style-'));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }),
    }));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    try {
      const service = new ImageGenerationService({
        enabled: true,
        provider: 'dall-e',
        openaiApiKey: 'test-key',
        openaiImageModel: 'gpt-image-1',
        outputDirectory,
        geminiSettings: {
          canonicalArtStyle: 'raw user style, crisp cel shading, consistent soft lighting',
        },
      } as any);

      await (service as any).generateWithDallE(
        { prompt: 'Mika Kuroda front reference', aspectRatio: '9:16' },
        'ref_mika_front',
        'job-1',
        undefined,
        'master',
      );

      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      const requestInit = calls[0]?.[1];
      expect(requestInit).toBeDefined();
      const body = JSON.parse(String(requestInit?.body || '{}'));
      expect(body.prompt).toMatch(/^STYLE LOCK:/);
      expect(body.prompt).toContain('raw user style, crisp cel shading, consistent soft lighting');
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('composes OpenAI scene prompts with visible cast, reference usage, compact continuity, and provider audit text', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-dalle-envelope-'));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }),
    }));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    try {
      const service = new ImageGenerationService({
        enabled: true,
        provider: 'dall-e',
        openaiApiKey: 'test-key',
        openaiImageModel: 'gpt-image-1',
        outputDirectory,
      } as any);

      await service.generateImage(
        {
          prompt: 'Sofia reaches for Roxy as Alex notices the club door opening.',
          style: 'Cartoon modern art style, bold simplified shapes, crisp confident linework',
          aspectRatio: '9:16',
          composition: 'tight two-shot with Alex partially visible in the background',
          characterIdentity: ['Sofia Valea', 'Roxy Marin', 'Alex Dragos'],
        } as any,
        'beat-openai-envelope',
        {
          type: 'beat',
          characterNames: ['Sofia Valea', 'Roxy Marin', 'Alex Dragos'],
          characterDescriptions: [{
            name: 'Sofia Valea',
            appearance: '',
            canonicalAppearance: {
              hair: 'dark hair',
              eyes: 'expressive eyes',
              skinTone: 'warm olive skin',
              distinguishingMarks: ['Perfectly applied red lipstick', 'Confident posture that masks vulnerability'],
              defaultAttire: 'Sharp black blazer over a silk red dress; style tags: professional, sexy, confident, modern; signature garments: short dresses, blazers, heels; materials: silk, cotton blends, leather; palette: black, red, jewel tones; accessories: designer handbag, statement jewelry',
            },
          }],
        } as any,
        [
          { role: 'character-reference-face', characterName: 'Sofia Valea', data: Buffer.from('face').toString('base64'), mimeType: 'image/png' },
          { role: 'character-reference', characterName: 'Sofia Valea', viewType: 'front', data: Buffer.from('front').toString('base64'), mimeType: 'image/png' },
          { role: 'character-reference-face', characterName: 'Roxy Marin', data: Buffer.from('roxy').toString('base64'), mimeType: 'image/png' },
          { role: 'character-reference-face', characterName: 'Alex Dragos', data: Buffer.from('alex').toString('base64'), mimeType: 'image/png' },
        ] as any,
      );

      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      const body = JSON.parse(String(calls[0]?.[1]?.body || '{}'));
      expect(body.prompt).toMatch(/^STYLE LOCK:/);
      expect(body.prompt).toContain('VISIBLE CAST:');
      expect(body.prompt).toContain('Sofia Valea, Roxy Marin, Alex Dragos.');
      expect(body.prompt).toContain('REFERENCE USAGE:');
      expect(body.prompt).toContain('Do not copy reference-sheet pose');
      expect(body.prompt).toContain('CHARACTER CONTINUITY:');
      expect(body.prompt).toContain('Current wardrobe essentials: Sharp black blazer over a silk red dress');
      expect(body.prompt).not.toContain('style tags:');
      expect(body.prompt).not.toContain('materials:');
      expect(body.prompt).not.toContain('palette:');
      expect(body.prompt).toContain('full-body lineup');

      const promptAudit = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'prompts', 'beat-openai-envelope.json'), 'utf8'));
      expect(promptAudit.metadata.providerPrompt).toBe(body.prompt);
      expect(promptAudit.metadata.openAiComposedPrompt).toBe(body.prompt);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('filters OpenAI scene refs to visible characters while keeping style refs', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const refs = (service as any).filterOpenAiRefsToVisibleCast(
      { prompt: 'Visible shot cast: Sofia Valea only.', characterIdentity: ['Sofia Valea'] },
      { type: 'beat', characterNames: ['Sofia Valea'] },
      'beat',
      [
        { role: 'character-reference-face', characterName: 'Sofia Valea', data: 'a', mimeType: 'image/png' },
        { role: 'character-reference-face', characterName: 'Roxy Marin', data: 'b', mimeType: 'image/png' },
        { role: 'style-reference', data: 'c', mimeType: 'image/png' },
      ],
    );

    expect(refs.map((ref: any) => ref.characterName || ref.role)).toEqual(['Sofia Valea', 'style-reference']);
  });
});

describe('ImageGenerationService reference composition guardrails', () => {
  it('keeps style references from becoming composition references', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'nano-banana',
      geminiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const guidance = (service as any).getStyleReferenceGuidance();

    expect(guidance).not.toContain('composition feel');
    expect(guidance).toContain('Do NOT copy');
    expect(guidance).toContain('camera angle');
    expect(guidance).toContain('character placement');
    expect(guidance).toContain('composition');
  });

  it('adds a fresh composition rule when scene refs are present', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'nano-banana',
      geminiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
      geminiSettings: {
        canonicalArtStyle: 'ink wash story art',
      },
    } as any);

    const prompt = (service as any).buildNarrativePrompt({
      prompt: 'Ari reaches across the train table as Mara pulls back from the evidence.',
      style: 'ink wash story art',
      aspectRatio: '9:19.5',
      visualNarrative: 'Ari and Mara realize the evidence connects them both.',
      composition: 'medium shot with focal point on the folder between them',
    }, true);

    expect(prompt).toContain('FRESH COMPOSITION RULE');
    expect(prompt).toContain('Do NOT copy their pose, camera angle, character placement, blocking, focal point, or composition');
  });
});

describe('ImageGenerationService stable-diffusion wiring', () => {
  it('hydrates file-cache hits with inline image data for downstream references', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-cache-'));
    fs.writeFileSync(path.join(outputDirectory, 'ref_mika_front.png'), Buffer.from('cached-reference-image'));
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory,
    } as any);

    const result = await service.generateImage(
      { prompt: 'Mika Kuroda front reference' } as any,
      'ref_mika_front',
      { type: 'master', characterId: 'mika', viewType: 'front' } as any,
    );

    expect(result.imageData).toBe(Buffer.from('cached-reference-image').toString('base64'));
    expect(result.mimeType).toBe('image/png');
  });

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
      { prompt: 'Mr. Boddy in frame' },
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
      { prompt: 'Detective Riley Kane and Mr. Boddy in frame' },
      [{ data: 'abc', mimeType: 'image/png', role: 'character-reference', characterName: 'Detective Riley Kane', viewType: 'front' }],
      [],
    );

    expect(audit.referenceRoute).toBe('text-only');
    expect(audit.missingReferenceCharacters).toEqual(['Detective Riley Kane', 'Mr. Boddy']);
  });

  it('does not enforce continuity for master style-bible anchors that seed later refs', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'nano-banana',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const audit = (service as any).buildCharacterReferenceAudit(
      'nano-banana',
      { characterNames: ['Hero'], type: 'master' },
      { prompt: 'Hero style anchor' },
      undefined,
      undefined,
    );

    expect(audit.referenceRoute).toBe('text-only');
    expect(audit.missingReferenceCharacters).toEqual([]);
    expect((service as any).shouldEnforceCharacterReferenceContinuity(
      { characterNames: ['Hero'], type: 'master' },
      audit,
    )).toBe(false);
  });

  it('enforces continuity for character-visible cover images without usable refs', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const audit = (service as any).buildCharacterReferenceAudit(
      'dall-e',
      { characterNames: ['Hikari Hoshino'], type: 'cover' },
      { prompt: 'Hikari Hoshino as the cover focal subject' },
      undefined,
      undefined,
    );

    expect(audit.missingReferenceCharacters).toEqual(['Hikari Hoshino']);
    expect((service as any).shouldEnforceCharacterReferenceContinuity(
      { characterNames: ['Hikari Hoshino'], type: 'cover' },
      audit,
    )).toBe(true);
  });

  it('ignores long prompt paragraphs in characterIdentity when metadata names are absent', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const audit = (service as any).buildCharacterReferenceAudit(
      'dall-e',
      { type: 'master' },
      {
        prompt: 'Single character reference image',
        characterIdentity: ['Single character reference image: Hikari Hoshino, one person only, front view, facing camera directly.'],
      },
      undefined,
      undefined,
    );

    expect(audit.visibleCharacters).toEqual([]);
  });

  it('still enforces continuity for character-visible scene images without usable refs', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'nano-banana',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const audit = (service as any).buildCharacterReferenceAudit(
      'nano-banana',
      { characterNames: ['Hero'], type: 'scene' },
      { prompt: 'Hero in frame' },
      undefined,
      undefined,
    );

    expect((service as any).shouldEnforceCharacterReferenceContinuity(
      { characterNames: ['Hero'], type: 'scene' },
      audit,
    )).toBe(true);
  });

  it('adds the persisted style reference to DALL-E scene refs without replacing character refs', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    service.setGeminiStyleReference('style-bytes', 'image/png');

    const refs = (service as any).withGlobalStyleReferenceForProvider(
      'dall-e',
      'scene',
      'beat-episode-1-scene-1-beat-1',
      [{ data: 'char-bytes', mimeType: 'image/png', role: 'character-reference', characterName: 'Mika Kuroda', viewType: 'front' }],
    );

    expect(refs).toHaveLength(2);
    expect(refs[0].role).toBe('style-reference');
    expect(refs[1].characterName).toBe('Mika Kuroda');
  });

  it('adds the reference-sheet style anchor to DALL-E character reference generation', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    service.setGeminiStyleReference('style-bytes', 'image/png');
    service.setReferenceSheetStyleAnchor('anchor-bytes', 'image/png');

    const refs = (service as any).withGlobalStyleReferenceForProvider(
      'dall-e',
      'master',
      'ref_mika-kuroda_front',
      undefined,
    );

    expect(refs).toHaveLength(1);
    expect(refs[0].role).toBe('style-reference');
    expect(refs[0].data).toBe('anchor-bytes');
  });

  it('does not add the scene style reference to non-character DALL-E master generation', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    service.setGeminiStyleReference('style-bytes', 'image/png');

    const refs = (service as any).withGlobalStyleReferenceForProvider(
      'dall-e',
      'master',
      'style-bible-as-if-tokyo-character-anchor',
      undefined,
    );

    expect(refs).toBeUndefined();
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
