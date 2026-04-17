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

function buildServiceWithAtlasModel(model: string) {
  return new ImageGenerationService({
    enabled: true,
    provider: 'atlas-cloud',
    atlasCloudApiKey: 'test-key',
    atlasCloudModel: model,
    outputDirectory: '/tmp/generated-images-test',
  } as any);
}

function getCaps(service: any) {
  return service.modelCapabilities;
}

function resolve(service: any, hasRefs: boolean, isBatch: boolean = false) {
  return service.resolveAtlasCloudModel({ hasRefs, isBatch });
}

describe('Atlas Cloud modelCapabilities — family detection', () => {
  describe('Nano Banana family (unchanged baseline)', () => {
    it('google/nano-banana-2/text-to-image — 14 refs, char consistency 5', () => {
      const caps = getCaps(buildServiceWithAtlasModel('google/nano-banana-2/text-to-image'));
      expect(caps.isNanoBanana).toBe(true);
      expect(caps.supportsEditRefs).toBe(true);
      expect(caps.maxRefImages).toBe(14);
      expect(caps.maxConsistentChars).toBe(5);
      expect(caps.supportsRichPrompt).toBe(true);
    });
    it('google/nano-banana-pro/text-to-image — 10 refs, char consistency 5', () => {
      const caps = getCaps(buildServiceWithAtlasModel('google/nano-banana-pro/text-to-image'));
      expect(caps.isNanoBanana).toBe(true);
      expect(caps.maxRefImages).toBe(10);
      expect(caps.maxConsistentChars).toBe(5);
    });
    it('google/nano-banana/text-to-image — 10 refs', () => {
      const caps = getCaps(buildServiceWithAtlasModel('google/nano-banana/text-to-image'));
      expect(caps.isNanoBanana).toBe(true);
      expect(caps.maxRefImages).toBe(10);
    });
  });

  describe('Seedream family (unchanged baseline)', () => {
    it('bytedance/seedream-v5.0-lite — batch 15, refs 10', () => {
      const caps = getCaps(buildServiceWithAtlasModel('bytedance/seedream-v5.0-lite'));
      expect(caps.isSeedream).toBe(true);
      expect(caps.supportsEditRefs).toBe(true);
      expect(caps.maxRefImages).toBe(10);
      expect(caps.supportsBatch).toBe(true);
      expect(caps.maxBatchSize).toBe(15);
      expect(caps.supportsRichPrompt).toBe(true);
    });
    it('bytedance/seedream-v4.5 — batch 14, refs 10', () => {
      const caps = getCaps(buildServiceWithAtlasModel('bytedance/seedream-v4.5'));
      expect(caps.isSeedream).toBe(true);
      expect(caps.maxBatchSize).toBe(14);
    });
  });

  describe('Flux family (new)', () => {
    it('flux-dev — T2I only, no refs, no LoRA tags', () => {
      const caps = getCaps(buildServiceWithAtlasModel('black-forest-labs/flux-dev'));
      expect(caps.isFlux).toBe(true);
      expect(caps.isFluxKontext).toBe(false);
      expect(caps.isFluxLora).toBe(false);
      expect(caps.supportsEditRefs).toBe(false);
      expect(caps.maxRefImages).toBe(0);
      expect(caps.supportsLoraTags).toBe(false);
    });
    it('flux-schnell — T2I only, no refs', () => {
      const caps = getCaps(buildServiceWithAtlasModel('black-forest-labs/flux-schnell'));
      expect(caps.isFlux).toBe(true);
      expect(caps.supportsEditRefs).toBe(false);
      expect(caps.maxRefImages).toBe(0);
    });
    it('flux-dev-lora — T2I + LoRA tags, no refs', () => {
      const caps = getCaps(buildServiceWithAtlasModel('black-forest-labs/flux-dev-lora'));
      expect(caps.isFlux).toBe(true);
      expect(caps.isFluxLora).toBe(true);
      expect(caps.supportsEditRefs).toBe(false);
      expect(caps.supportsLoraTags).toBe(true);
    });
    it('flux-kontext-dev — edit-only, single ref, no LoRA', () => {
      const caps = getCaps(buildServiceWithAtlasModel('black-forest-labs/flux-kontext-dev'));
      expect(caps.isFlux).toBe(true);
      expect(caps.isFluxKontext).toBe(true);
      expect(caps.isFluxLora).toBe(false);
      expect(caps.supportsEditRefs).toBe(true);
      expect(caps.maxRefImages).toBe(1);
      expect(caps.supportsLoraTags).toBe(false);
    });
    it('flux-kontext-dev-lora — edit-only, single ref + LoRA tags', () => {
      const caps = getCaps(buildServiceWithAtlasModel('black-forest-labs/flux-kontext-dev-lora'));
      expect(caps.isFluxKontext).toBe(true);
      expect(caps.isFluxLora).toBe(true);
      expect(caps.supportsEditRefs).toBe(true);
      expect(caps.maxRefImages).toBe(1);
      expect(caps.supportsLoraTags).toBe(true);
    });
  });

  describe('GPT Image family (new)', () => {
    for (const slug of [
      'openai/gpt-image-1/text-to-image',
      'openai/gpt-image-1.5/text-to-image',
      'openai/gpt-image-1-mini/text-to-image',
    ]) {
      it(`${slug} — refs + /edit auto-routing`, () => {
        const caps = getCaps(buildServiceWithAtlasModel(slug));
        expect(caps.isGptImage).toBe(true);
        expect(caps.supportsEditRefs).toBe(true);
        expect(caps.maxRefImages).toBe(4);
        expect(caps.supportsRichPrompt).toBe(false);
      });
    }
  });

  describe('Qwen Image families (new)', () => {
    it('qwen/qwen-image-2.0/text-to-image — 3 refs', () => {
      const caps = getCaps(buildServiceWithAtlasModel('qwen/qwen-image-2.0/text-to-image'));
      expect(caps.isQwenImage20).toBe(true);
      expect(caps.isQwenImage).toBe(true);
      expect(caps.supportsEditRefs).toBe(true);
      expect(caps.maxRefImages).toBe(3);
    });
    it('qwen/qwen-image-2.0-pro/text-to-image — 3 refs', () => {
      const caps = getCaps(buildServiceWithAtlasModel('qwen/qwen-image-2.0-pro/text-to-image'));
      expect(caps.isQwenImage20).toBe(true);
      expect(caps.maxRefImages).toBe(3);
    });
    it('alibaba/qwen-image/text-to-image-max — 5 refs (edit-plus variant)', () => {
      const caps = getCaps(buildServiceWithAtlasModel('alibaba/qwen-image/text-to-image-max'));
      expect(caps.isQwenImageAlibaba).toBe(true);
      expect(caps.isQwenImage).toBe(true);
      expect(caps.maxRefImages).toBe(5);
    });
    it('atlascloud/qwen-image/text-to-image — 5 refs', () => {
      const caps = getCaps(buildServiceWithAtlasModel('atlascloud/qwen-image/text-to-image'));
      expect(caps.isQwenImageAlibaba).toBe(true);
      expect(caps.maxRefImages).toBe(5);
    });
  });

  describe('Wan family (new)', () => {
    for (const slug of [
      'alibaba/wan-2.5/text-to-image',
      'alibaba/wan-2.6/text-to-image',
      'alibaba/wan-2.7/text-to-image',
      'alibaba/wan-2.7-pro/text-to-image',
    ]) {
      it(`${slug} — 3 refs with /image-edit routing`, () => {
        const caps = getCaps(buildServiceWithAtlasModel(slug));
        expect(caps.isWan).toBe(true);
        expect(caps.supportsEditRefs).toBe(true);
        expect(caps.maxRefImages).toBe(3);
      });
    }
  });

  describe('Pure text-to-image families (no refs)', () => {
    for (const slug of [
      'google/imagen4-ultra',
      'google/imagen4',
      'google/imagen4-fast',
      'google/imagen3',
      'google/imagen3-fast',
      'z-image/turbo',
      'baidu/ERNIE-Image-Turbo/text-to-image',
    ]) {
      it(`${slug} — no ref support`, () => {
        const caps = getCaps(buildServiceWithAtlasModel(slug));
        expect(caps.supportsEditRefs).toBe(false);
        expect(caps.maxRefImages).toBe(0);
        expect(caps.supportsLoraTags).toBe(false);
      });
    }
  });
});

describe('Atlas Cloud resolveAtlasCloudModel — endpoint routing', () => {
  describe('Nano Banana (preserved behavior)', () => {
    it('routes to /edit when refs present', () => {
      const s = buildServiceWithAtlasModel('google/nano-banana-2/text-to-image');
      expect(resolve(s, true)).toBe('google/nano-banana-2/edit');
      expect(resolve(s, false)).toBe('google/nano-banana-2/text-to-image');
    });
  });

  describe('Seedream (preserved behavior)', () => {
    it('routes across base / edit / sequential / edit-sequential', () => {
      const s = buildServiceWithAtlasModel('bytedance/seedream-v4.5');
      expect(resolve(s, false, false)).toBe('bytedance/seedream-v4.5');
      expect(resolve(s, true, false)).toBe('bytedance/seedream-v4.5/edit');
      expect(resolve(s, false, true)).toBe('bytedance/seedream-v4.5/sequential');
      expect(resolve(s, true, true)).toBe('bytedance/seedream-v4.5/edit-sequential');
    });
  });

  describe('GPT Image (new)', () => {
    it('toggles between /text-to-image and /edit on refs', () => {
      const s = buildServiceWithAtlasModel('openai/gpt-image-1/text-to-image');
      expect(resolve(s, false)).toBe('openai/gpt-image-1/text-to-image');
      expect(resolve(s, true)).toBe('openai/gpt-image-1/edit');
    });
    it('also handles gpt-image-1-mini', () => {
      const s = buildServiceWithAtlasModel('openai/gpt-image-1-mini/text-to-image');
      expect(resolve(s, true)).toBe('openai/gpt-image-1-mini/edit');
    });
  });

  describe('Qwen Image 2.0 (new)', () => {
    it('toggles between /text-to-image and /edit', () => {
      const s = buildServiceWithAtlasModel('qwen/qwen-image-2.0/text-to-image');
      expect(resolve(s, false)).toBe('qwen/qwen-image-2.0/text-to-image');
      expect(resolve(s, true)).toBe('qwen/qwen-image-2.0/edit');
    });
    it('handles qwen-image-2.0-pro', () => {
      const s = buildServiceWithAtlasModel('qwen/qwen-image-2.0-pro/text-to-image');
      expect(resolve(s, true)).toBe('qwen/qwen-image-2.0-pro/edit');
    });
  });

  describe('Alibaba Qwen-Image (new)', () => {
    it('max variant ↔ /edit', () => {
      const s = buildServiceWithAtlasModel('alibaba/qwen-image/text-to-image-max');
      expect(resolve(s, false)).toBe('alibaba/qwen-image/text-to-image-max');
      expect(resolve(s, true)).toBe('alibaba/qwen-image/edit');
    });
    it('plus variant ↔ /edit-plus', () => {
      const s = buildServiceWithAtlasModel('alibaba/qwen-image/text-to-image-plus');
      expect(resolve(s, false)).toBe('alibaba/qwen-image/text-to-image-plus');
      expect(resolve(s, true)).toBe('alibaba/qwen-image/edit-plus');
    });
    it('atlascloud slug routes to its own /edit', () => {
      const s = buildServiceWithAtlasModel('atlascloud/qwen-image/text-to-image');
      expect(resolve(s, true)).toBe('atlascloud/qwen-image/edit');
    });
  });

  describe('Wan (new)', () => {
    it('2.7 routes to /image-edit on refs', () => {
      const s = buildServiceWithAtlasModel('alibaba/wan-2.7/text-to-image');
      expect(resolve(s, false)).toBe('alibaba/wan-2.7/text-to-image');
      expect(resolve(s, true)).toBe('alibaba/wan-2.7/image-edit');
    });
    it('2.7-pro routes to /image-edit on refs', () => {
      const s = buildServiceWithAtlasModel('alibaba/wan-2.7-pro/text-to-image');
      expect(resolve(s, true)).toBe('alibaba/wan-2.7-pro/image-edit');
    });
    it('2.5 and 2.6 also route to /image-edit', () => {
      const s25 = buildServiceWithAtlasModel('alibaba/wan-2.5/text-to-image');
      const s26 = buildServiceWithAtlasModel('alibaba/wan-2.6/text-to-image');
      expect(resolve(s25, true)).toBe('alibaba/wan-2.5/image-edit');
      expect(resolve(s26, true)).toBe('alibaba/wan-2.6/image-edit');
    });
  });

  describe('Flux (new)', () => {
    it('flux-dev passes through unchanged regardless of refs', () => {
      const s = buildServiceWithAtlasModel('black-forest-labs/flux-dev');
      expect(resolve(s, false)).toBe('black-forest-labs/flux-dev');
      expect(resolve(s, true)).toBe('black-forest-labs/flux-dev');
    });
    it('flux-kontext-dev is already an edit model; slug unchanged', () => {
      const s = buildServiceWithAtlasModel('black-forest-labs/flux-kontext-dev');
      expect(resolve(s, true)).toBe('black-forest-labs/flux-kontext-dev');
      expect(resolve(s, false)).toBe('black-forest-labs/flux-kontext-dev');
    });
  });
});

describe('Atlas Cloud resolveAtlasFluxLoras — LoRA payload selection', () => {
  function buildLoraService(
    model: string,
    extras: {
      atlasCloudCharacterLoras?: Record<string, { path: string; scale?: number }>;
      atlasCloudStyleLoras?: { path: string; scale?: number }[];
    } = {},
  ) {
    return new ImageGenerationService({
      enabled: true,
      provider: 'atlas-cloud',
      atlasCloudApiKey: 'test-key',
      atlasCloudModel: model,
      outputDirectory: '/tmp/generated-images-test',
      ...extras,
    } as any);
  }

  function resolveLoras(service: any, metadata?: Record<string, any>) {
    return service.resolveAtlasFluxLoras(metadata);
  }

  it('returns undefined when the active model does not support LoRA tags', () => {
    const s = buildLoraService('bytedance/seedream-v4.5', {
      atlasCloudCharacterLoras: {
        Vance: { path: 'example/vance-lora' },
      },
    });
    expect(resolveLoras(s, { characterName: 'Vance' })).toBeUndefined();
  });

  it('returns undefined when LoRA-capable model has nothing configured', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora');
    expect(resolveLoras(s, { characterName: 'Vance' })).toBeUndefined();
  });

  it('emits style LoRAs even when metadata is empty', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudStyleLoras: [{ path: 'strangerzonehf/Flux-Super-Realism-LoRA' }],
    });
    const loras = resolveLoras(s, {});
    expect(loras).toEqual([
      { path: 'strangerzonehf/Flux-Super-Realism-LoRA', scale: 1 },
    ]);
  });

  it('picks up a single character LoRA via metadata.characterName', () => {
    const s = buildLoraService('black-forest-labs/flux-kontext-dev-lora', {
      atlasCloudCharacterLoras: {
        Vance: { path: 'example/vance-lora', scale: 0.85 },
      },
    });
    const loras = resolveLoras(s, { characterName: 'Vance' });
    expect(loras).toEqual([{ path: 'example/vance-lora', scale: 0.85 }]);
  });

  it('merges style LoRAs ahead of character LoRAs', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudStyleLoras: [
        { path: 'styles/graphic-novel-ink', scale: 0.9 },
      ],
      atlasCloudCharacterLoras: {
        Vance: { path: 'characters/vance', scale: 1 },
        Lin: { path: 'characters/lin', scale: 0.8 },
      },
    });
    const loras = resolveLoras(s, { characterNames: ['Vance', 'Lin'] });
    expect(loras).toEqual([
      { path: 'styles/graphic-novel-ink', scale: 0.9 },
      { path: 'characters/vance', scale: 1 },
      { path: 'characters/lin', scale: 0.8 },
    ]);
  });

  it('is case-insensitive when looking up character names', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudCharacterLoras: {
        Vance: { path: 'characters/vance' },
      },
    });
    const loras = resolveLoras(s, { characterName: 'VANCE' });
    expect(loras).toEqual([{ path: 'characters/vance', scale: 1 }]);
  });

  it('deduplicates when the same path appears as both style and character', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudStyleLoras: [{ path: 'shared/ink-style', scale: 0.9 }],
      atlasCloudCharacterLoras: {
        Vance: { path: 'shared/ink-style', scale: 0.5 },
      },
    });
    const loras = resolveLoras(s, { characterName: 'Vance' });
    // Style wins (first occurrence); dedup is by normalized path.
    expect(loras).toEqual([{ path: 'shared/ink-style', scale: 0.9 }]);
  });

  it('caps output at 5 entries even when more are configured', () => {
    const chars: Record<string, { path: string }> = {};
    for (let i = 0; i < 10; i++) chars[`Char${i}`] = { path: `characters/c${i}` };
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudStyleLoras: [
        { path: 'styles/a' },
        { path: 'styles/b' },
      ],
      atlasCloudCharacterLoras: chars,
    });
    const loras = resolveLoras(s, {
      characterNames: Object.keys(chars),
    });
    expect(loras).toHaveLength(5);
    // Style LoRAs occupy the first two slots.
    expect(loras![0].path).toBe('styles/a');
    expect(loras![1].path).toBe('styles/b');
  });

  it('defaults scale to 1 when omitted', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudStyleLoras: [{ path: 'a/b' }],
    });
    const loras = resolveLoras(s, {});
    expect(loras![0].scale).toBe(1);
  });

  it('ignores entries with empty/whitespace paths', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudStyleLoras: [
        { path: '' },
        { path: '   ' },
        { path: 'valid/ref' },
      ],
    });
    const loras = resolveLoras(s, {});
    expect(loras).toEqual([{ path: 'valid/ref', scale: 1 }]);
  });

  it('ignores empty character names without throwing', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudCharacterLoras: {
        Vance: { path: 'characters/vance' },
      },
    });
    const loras = resolveLoras(s, {
      characterNames: ['', '  ', 'Vance', null, undefined],
    });
    expect(loras).toEqual([{ path: 'characters/vance', scale: 1 }]);
  });

  it('deduplicates repeated character mentions', () => {
    const s = buildLoraService('black-forest-labs/flux-dev-lora', {
      atlasCloudCharacterLoras: {
        Vance: { path: 'characters/vance' },
      },
    });
    const loras = resolveLoras(s, {
      characterName: 'Vance',
      characterNames: ['Vance', 'vance', 'VANCE'],
    });
    expect(loras).toEqual([{ path: 'characters/vance', scale: 1 }]);
  });
});

describe('Atlas Cloud mapAspectRatioToSize — Flux dimension alignment', () => {
  // Flux (flux-dev, flux-schnell, flux-dev-lora, flux-kontext-dev-lora, ...)
  // rejects requests where either dimension of `size` is not a multiple of 16,
  // with HTTP 400 `Invalid request parameters`. This spec locks in the
  // invariant so the standard size map never regresses.
  const ASPECT_RATIOS = [
    '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
    '21:9', '9:21', '9:19.5',
  ];

  it.each(ASPECT_RATIOS)('flux-dev-lora: %s maps to a multiple-of-16 size', (ar) => {
    const service: any = buildServiceWithAtlasModel('black-forest-labs/flux-dev-lora');
    const size: string = service.mapAspectRatioToSize(ar, 'black-forest-labs/flux-dev-lora');
    const match = /^(\d+)\*(\d+)$/.exec(size);
    expect(match, `size ${size} should be W*H`).toBeTruthy();
    const w = Number(match![1]);
    const h = Number(match![2]);
    expect(w % 16, `width ${w} for ${ar} should be multiple of 16`).toBe(0);
    expect(h % 16, `height ${h} for ${ar} should be multiple of 16`).toBe(0);
  });

  it('flux-kontext-dev-lora: 3:4 maps to multiple-of-16 size', () => {
    const service: any = buildServiceWithAtlasModel('black-forest-labs/flux-kontext-dev-lora');
    const size: string = service.mapAspectRatioToSize('3:4', 'black-forest-labs/flux-kontext-dev-lora');
    const [w, h] = size.split('*').map(Number);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
  });

  it('flux-dev (base): falls back to 1024*1024 for unknown ratio', () => {
    const service: any = buildServiceWithAtlasModel('black-forest-labs/flux-dev');
    const size: string = service.mapAspectRatioToSize('bogus', 'black-forest-labs/flux-dev');
    expect(size).toBe('1024*1024');
  });
});
