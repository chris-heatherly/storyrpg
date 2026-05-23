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

describe('ImageGenerationService local image persistence', () => {
  it('materializes data URL image results into the configured output directory', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-local-persist-'));
    try {
      const service = new ImageGenerationService({
        enabled: true,
        provider: 'placeholder',
        outputDirectory,
      } as any);
      const imageData = Buffer.from('fake-png-bytes').toString('base64');

      const result = await (service as any).ensureGeneratedImageStoredLocally(
        {
          prompt: { prompt: 'Render the scene.' },
          imageUrl: `data:image/png;base64,${imageData}`,
          mimeType: 'image/png',
        },
        'scene-beat-one',
      );

      expect(result.imagePath).toBe(path.join(outputDirectory, 'scene-beat-one.png'));
      expect(fs.existsSync(result.imagePath)).toBe(true);
      expect(fs.readFileSync(result.imagePath).toString('base64')).toBe(imageData);
      expect(result.imageData).toBe(imageData);
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('rejects image results that point at missing local files', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-missing-local-'));
    try {
      const service = new ImageGenerationService({
        enabled: true,
        provider: 'placeholder',
        outputDirectory,
      } as any);

      await expect((service as any).ensureGeneratedImageStoredLocally(
        {
          prompt: { prompt: 'Render the scene.' },
          imagePath: path.join(outputDirectory, 'missing.png'),
        },
        'missing',
      )).rejects.toThrow(/missing local file/);
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
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

  it('snaps custom OpenAI storyboard sheet ratios to supported Image API sizes', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-dalle-custom-size-'));
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
        openaiImageModel: 'gpt-image-2',
        outputDirectory,
      } as any);

      await (service as any).generateWithDallE(
        { prompt: 'Storyboard sheet', aspectRatio: '9:8' },
        'sheet-custom-ratio',
        'job-1',
        undefined,
        'storyboard-sheet',
      );

      const [, requestInit] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
      const body = JSON.parse(String(requestInit?.body || '{}'));
      expect(['1024x1024', '1536x1024', '1024x1536']).toContain(body.size);
      expect(body.size).not.toMatch(/^3840x/);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('does not treat non-safety OpenAI image user errors as moderation blocks', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    expect((service as any).isOpenAiModerationBlock(400, JSON.stringify({
      error: {
        message: "Invalid size '3840x3408'. Requested resolution exceeds the current pixel budget.",
        type: 'image_generation_user_error',
        param: 'size',
        code: 'invalid_value',
      },
    }))).toBe(false);

    expect((service as any).isOpenAiModerationBlock(400, JSON.stringify({
      error: {
        message: 'Your request was rejected by the safety system.',
        type: 'image_generation_user_error',
        code: 'moderation_blocked',
      },
    }))).toBe(true);
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
      service.setSeasonStyleReference(Buffer.from('season-style').toString('base64'), 'image/png');

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

      const promptAudit = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'prompts', 'beat-openai-envelope.json'), 'utf8'));
      expect(promptAudit.metadata.referenceAudit.referenceRoute).not.toBe('text-only');
      expect(promptAudit.metadata.inputReferences.length).toBeGreaterThan(0);
      expect(promptAudit.metadata.effectiveReferences.length).toBeGreaterThan(0);
      expect(promptAudit.metadata.hasSeasonStyleReference).toBe(true);
      expect(promptAudit.metadata.inputReferences.some((ref: any) => ref.role === 'style-reference')).toBe(true);
      expect(promptAudit.metadata.effectiveReferences.some((ref: any) => ref.role === 'style-reference')).toBe(true);
      expect(promptAudit.metadata.referenceDropReasons).toEqual(expect.any(Array));
      expect(body.prompt).not.toContain('style tags:');
      expect(body.prompt).not.toContain('materials:');
      expect(body.prompt).not.toContain('palette:');
      expect(body.prompt).toContain('full-body lineup');
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

  it('keeps OpenAI refs when visible cast uses slash aliases', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const refs = (service as any).filterOpenAiRefsToVisibleCast(
      { prompt: 'Eros/Alex Kiriakis faces Daphne.', characterIdentity: ['Eros/Alex Kiriakis'] },
      { type: 'storylet-aftermath', characterNames: ['Eros/Alex Kiriakis'] },
      'storylet-aftermath',
      [
        { role: 'character-reference', characterName: 'Alex Kiriakis', viewType: 'front', data: 'a', mimeType: 'image/png' },
        { role: 'style-reference', data: 'b', mimeType: 'image/png' },
      ],
    );

    expect(refs.map((ref: any) => ref.characterName || ref.role)).toEqual(['Alex Kiriakis', 'style-reference']);

    const audit = (service as any).buildCharacterReferenceAudit(
      'dall-e',
      { characterNames: ['Eros/Alex Kiriakis'], type: 'storylet-aftermath' },
      { prompt: 'Eros/Alex Kiriakis faces Daphne.' },
      refs,
      refs,
    );
    expect(audit.effectiveCharacterRefs['Eros/Alex Kiriakis']).toBe(1);
    expect(audit.missingReferenceCharacters).toEqual([]);
  });

  it('routes OpenAI character refs by canonical character id before display names', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const refs = (service as any).filterOpenAiRefsToVisibleCast(
      { prompt: 'Alex faces Daphne.', characterIdentity: ['Alex'] },
      {
        type: 'storylet-aftermath',
        visibleCharacterIds: ['char-erosalex-kiriakis'],
        characterNames: ['Alex'],
      },
      'storylet-aftermath',
      [
        { role: 'character-reference', characterId: 'char-erosalex-kiriakis', characterName: 'Completely Different Nickname', viewType: 'front', data: 'a', mimeType: 'image/png' },
        { role: 'character-reference', characterId: 'char-daphne-papadopoulos', characterName: 'Alex', viewType: 'front', data: 'b', mimeType: 'image/png' },
        { role: 'style-reference', data: 'c', mimeType: 'image/png' },
      ],
    );

    expect(refs.map((ref: any) => ref.characterId || ref.role)).toEqual(['char-erosalex-kiriakis', 'style-reference']);

    const audit = (service as any).buildCharacterReferenceAudit(
      'dall-e',
      {
        type: 'storylet-aftermath',
        visibleCharacterIds: ['char-erosalex-kiriakis'],
        characterNames: ['Alex'],
      },
      { prompt: 'Alex faces Daphne.' },
      refs,
      refs,
    );
    expect(audit.visibleCharacterIds).toEqual(['char-erosalex-kiriakis']);
    expect(audit.effectiveCharacterRefs.Alex).toBe(1);
    expect(audit.missingReferenceCharacters).toEqual([]);
  });

  it('keeps storyboard panel crops as OpenAI composition refs after visible-cast filtering', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);

    const refs = (service as any).filterOpenAiRefsToVisibleCast(
      { prompt: 'Daphne turns away alone.', characterIdentity: ['Daphne Papadopoulos'] },
      {
        type: 'encounter-outcome',
        visibleCharacterIds: ['char-daphne-papadopoulos'],
        characterNames: ['Daphne Papadopoulos'],
      },
      'encounter-outcome',
      [
        { role: 'storyboard-panel-crop', viewType: 'draft-crop', data: 'crop', mimeType: 'image/png' },
        { role: 'character-reference', characterId: 'char-daphne-papadopoulos', characterName: 'Daphne Papadopoulos', data: 'daphne', mimeType: 'image/png' },
        { role: 'character-reference', characterId: 'char-erosalex-kiriakis', characterName: 'Alex', data: 'alex', mimeType: 'image/png' },
        { role: 'episode-style-lock', data: 'style', mimeType: 'image/png' },
      ],
    );

    expect(refs.map((ref: any) => ref.role)).toEqual([
      'storyboard-panel-crop',
      'character-reference',
      'episode-style-lock',
    ]);
    expect(refs.map((ref: any) => ref.characterId).filter(Boolean)).toEqual(['char-daphne-papadopoulos']);
  });

  it('sends storyboard crop-refine refs to OpenAI and labels them as composition refs', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-gen-dalle-crop-refine-'));
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
        openaiImageModel: 'gpt-image-2',
        outputDirectory,
      } as any);

      await service.generateImage(
        {
          prompt: 'ART STYLE: Cartoon modern art style\nDaphne challenges Eros across the cafe counter.',
          style: 'Cartoon modern art style, bold simplified shapes, crisp confident linework',
          aspectRatio: '9:16',
          characterIdentity: ['Daphne', 'Eros'],
        } as any,
        'storyboard-crop-refine-openai',
        {
          type: 'encounter-outcome',
          renderRoute: 'storyboard-sheet-crop-refine',
          characterNames: ['Daphne', 'Eros'],
          visibleCharacterIds: ['char-daphne', 'char-eros'],
        } as any,
        [
          { role: 'storyboard-panel-crop', viewType: 'draft-crop', data: Buffer.from('crop').toString('base64'), mimeType: 'image/png' },
          { role: 'character-reference', characterId: 'char-daphne', characterName: 'Daphne', viewType: 'front', data: Buffer.from('daphne').toString('base64'), mimeType: 'image/png' },
          { role: 'character-reference', characterId: 'char-eros', characterName: 'Eros', viewType: 'front', data: Buffer.from('eros').toString('base64'), mimeType: 'image/png' },
          { role: 'episode-style-lock', viewType: 'style', data: Buffer.from('style').toString('base64'), mimeType: 'image/png' },
        ] as any,
      );

      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      const body = JSON.parse(String(calls[0]?.[1]?.body || '{}'));
      expect(calls[0]?.[0]).toContain('/images/edits');
      expect(body.images).toHaveLength(4);
      expect(body.prompt).toContain('Use the storyboard crop/composition reference only for staging');
      expect(body.prompt).toContain('FINAL STYLE GUARD:');

      const promptAudit = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'prompts', 'storyboard-crop-refine-openai.json'), 'utf8'));
      expect(promptAudit.metadata.openAiReferenceUsage).toBe('composition-identity-style');
      expect(promptAudit.metadata.openAiEffectiveReferences.map((ref: any) => ref.role)).toEqual([
        'storyboard-panel-crop',
        'character-reference',
        'character-reference',
        'episode-style-lock',
      ]);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});

describe('ImageGenerationService OpenAI prompt budget', () => {
  it('clamps composed OpenAI image prompts below provider limit before dispatch', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-openai-budget-'));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from('png').toString('base64') }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
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
          prompt: [
            'A storyboard sheet sequence where Mara carries a folded letter through a crowded street.',
            'STORY MOMENT DETAIL '.repeat(1800),
            'CHARACTER VISUAL IDENTITY',
            'Mara: silver hair, storm-gray cloak, scar through left eyebrow. '.repeat(600),
          ].join('\n'),
          style: 'messy risograph pulp fantasy with crisp silhouettes',
          aspectRatio: '9:16',
          composition: 'Keep the folded letter as the visual thread. '.repeat(500),
          negativePrompt: 'text, watermark, duplicate character, static lineup, '.repeat(300),
          characterIdentity: ['Mara'],
        } as any,
        'openai-long-prompt',
        { type: 'beat', characterNames: ['Mara'] } as any,
        [
          { role: 'character-reference', characterName: 'Mara', viewType: 'front', data: Buffer.from('mara').toString('base64'), mimeType: 'image/png' },
        ] as any,
      );

      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      const body = JSON.parse(String(calls[0]?.[1]?.body || '{}'));
      expect(body.prompt.length).toBeLessThanOrEqual(32000);
      expect(body.prompt).toContain('STYLE LOCK:');
      expect(body.prompt).toContain('STORY MOMENT:');
      expect(body.prompt).toContain('Shortened');

      const promptAudit = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'prompts', 'openai-long-prompt.json'), 'utf8'));
      expect(promptAudit.metadata.openAiComposedPromptTruncated).toBe(true);
      expect(promptAudit.metadata.openAiComposedPromptOriginalChars).toBeGreaterThan(32000);
      expect(promptAudit.metadata.openAiComposedPromptChars).toBeLessThanOrEqual(32000);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
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

  it('includes dramatic intent fields in narrative prompts', () => {
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
      prompt: 'Ari slides the folder into the light while Mara goes still.',
      style: 'ink wash story art',
      aspectRatio: '9:19.5',
      visualNarrative: 'Ari reveals the proof and Mara loses control of the room.',
      visibleTurn: 'The folder changes possession and Ari gains leverage.',
      visualSubtextCue: 'Mara releases her coffee cup before answering.',
      statusShift: 'Mara controls the conversation -> Ari controls the evidence.',
    }, false);

    expect(prompt).toContain('VISIBLE TURN: The folder changes possession and Ari gains leverage.');
    expect(prompt).toContain('VISUAL SUBTEXT CUE: Mara releases her coffee cup before answering.');
    expect(prompt).toContain('STATUS SHIFT: Mara controls the conversation -> Ari controls the evidence.');
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
    service.setSeasonStyleReference('style-bytes', 'image/png');

    const refs = (service as any).withSeasonStyleReferenceForProvider(
      'dall-e',
      'scene',
      'beat-episode-1-scene-1-beat-1',
      [{ data: 'char-bytes', mimeType: 'image/png', role: 'character-reference', characterName: 'Mika Kuroda', viewType: 'front' }],
    );

    expect(refs).toHaveLength(2);
    expect(refs[0].role).toBe('style-reference');
    expect(refs[1].characterName).toBe('Mika Kuroda');
  });

  it('adds the persisted season style reference to Nano and Atlas scene refs', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'nano-banana',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    service.setSeasonStyleReference('style-bytes', 'image/png');

    for (const provider of ['nano-banana', 'atlas-cloud'] as const) {
      const refs = (service as any).withSeasonStyleReferenceForProvider(
        provider,
        'beat',
        `beat-${provider}`,
        [{ data: 'char-bytes', mimeType: 'image/png', role: 'character-reference', characterName: 'Mika Kuroda', viewType: 'front' }],
      );

      expect(refs[0].role).toBe('style-reference');
      expect(refs[1].characterName).toBe('Mika Kuroda');
    }
  });

  it('adds the reference-sheet style anchor to DALL-E character reference generation', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: 'test-key',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    service.setSeasonStyleReference('style-bytes', 'image/png');
    service.setReferenceSheetStyleAnchor('anchor-bytes', 'image/png');

    const refs = (service as any).withSeasonStyleReferenceForProvider(
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
    service.setSeasonStyleReference('style-bytes', 'image/png');

    const refs = (service as any).withSeasonStyleReferenceForProvider(
      'dall-e',
      'master',
      'style-bible-as-if-tokyo-character-anchor',
      undefined,
    );

    expect(refs).toBeUndefined();
  });

  it('derives photoreal contradictions only for stylized profiles', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    service.setArtStyleProfile({
      name: 'ink wash',
      family: 'ink',
      renderingTechnique: 'brush ink with paper texture',
      colorPhilosophy: 'monochrome',
      lightingApproach: 'graphic',
      lineWeight: 'expressive',
      compositionStyle: 'spare',
      moodRange: 'quiet',
      acceptableDeviations: [],
      genreNegatives: [],
      positiveVocabulary: [],
      inappropriateVocabulary: [],
    });

    expect((service as any).getProfileStyleContradictionNegatives()).toEqual(
      expect.arrayContaining(['photorealism', 'DSLR photo', 'realistic 3D render']),
    );
  });

  it('does not invent opposite-style negatives for unknown verbatim profiles', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    service.setArtStyleProfile({
      name: 'weird luminous scrapbook diorama',
      family: 'unknown',
      renderingTechnique: 'weird luminous scrapbook diorama',
      colorPhilosophy: 'author-provided',
      lightingApproach: 'author-provided',
      lineWeight: 'author-provided',
      compositionStyle: 'author-provided',
      moodRange: 'author-provided',
      acceptableDeviations: [],
      genreNegatives: [],
      positiveVocabulary: ['weird luminous scrapbook diorama'],
      inappropriateVocabulary: [],
    });

    expect((service as any).getProfileStyleContradictionNegatives()).toEqual([]);
  });

  it('derives stylized contradictions only for explicit photographic cinematic profiles', () => {
    const service = new ImageGenerationService({
      enabled: true,
      provider: 'dall-e',
      outputDirectory: '/tmp/generated-images-test',
    } as any);
    service.setArtStyleProfile({
      name: 'photographic cinematic still',
      family: 'cinematic',
      renderingTechnique: 'photoreal DSLR photo lighting',
      colorPhilosophy: 'natural',
      lightingApproach: 'photographic',
      lineWeight: 'none',
      compositionStyle: 'cinematic',
      moodRange: 'grounded',
      acceptableDeviations: [],
      genreNegatives: [],
      positiveVocabulary: [],
      inappropriateVocabulary: [],
    });

    expect((service as any).getProfileStyleContradictionNegatives()).toEqual(
      expect.arrayContaining(['cartoon style', 'anime style', 'flat cel shading']),
    );
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
