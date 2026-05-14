import { describe, it, expect, vi } from 'vitest';
import type { GeneratedImage, ImagePrompt } from '../../agents/ImageGenerator';
import type { ProviderServiceBridge } from './ImageProviderAdapter';
import {
  createDefaultImageProviderRegistry,
  ImageProviderRegistry,
  GeminiAdapter,
  AtlasCloudAdapter,
  MidApiAdapter,
  StableDiffusionProviderAdapter,
  PlaceholderAdapter,
  DallEAdapter,
} from './index';

function makeBridge(): ProviderServiceBridge & {
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {};
  const bump = (key: string) => {
    calls[key] = (calls[key] ?? 0) + 1;
  };
  const stub: GeneratedImage = {
    prompt: { prompt: 'x' } as unknown as ImagePrompt,
    imagePath: '/tmp/fake.png',
    imageUrl: undefined,
  };
  return {
    calls,
    generateWithNanoBanana: vi.fn(async () => { bump('gemini'); return stub; }),
    generateWithAtlasCloud: vi.fn(async () => { bump('atlas'); return stub; }),
    generateWithUseapi: vi.fn(async () => { bump('midapi'); return stub; }),
    generateWithDallE: vi.fn(async () => { bump('dall-e'); return stub; }),
    generateWithStableDiffusion: vi.fn(async () => { bump('sd'); return stub; }),
    generatePlaceholder: vi.fn(async () => { bump('placeholder'); return stub; }),
    preflightImageProvider: vi.fn(async () => ({ ok: true, provider: 'test', latencyMs: 1 })),
  };
}

describe('ImageProviderRegistry', () => {
  it('returns registered adapters by id', () => {
    const registry = createDefaultImageProviderRegistry();
    expect(registry.get('nano-banana').id).toBe('nano-banana');
    expect(registry.get('atlas-cloud').id).toBe('atlas-cloud');
    expect(registry.get('midapi').id).toBe('midapi');
    expect(registry.get('useapi').id).toBe('useapi');
    expect(registry.get('stable-diffusion').id).toBe('stable-diffusion');
    expect(registry.get('dall-e').id).toBe('dall-e');
  });

  it('falls back to placeholder for unknown providers', () => {
    const registry = createDefaultImageProviderRegistry();
    expect(registry.get('definitely-not-a-provider').id).toBe('placeholder');
    expect(registry.get(undefined).id).toBe('placeholder');
  });

  it('lists every registered provider', () => {
    const registry = createDefaultImageProviderRegistry();
    const ids = registry.list();
    expect(ids).toEqual(
      expect.arrayContaining([
        'nano-banana',
        'atlas-cloud',
        'midapi',
        'useapi',
        'stable-diffusion',
        'dall-e',
        'placeholder',
      ]),
    );
  });

  it('supports registering a new adapter at runtime', () => {
    const registry = new ImageProviderRegistry([], new PlaceholderAdapter());
    registry.register(new GeminiAdapter());
    expect(registry.has('nano-banana')).toBe(true);
  });
});

describe('adapters', () => {
  const prompt = { prompt: 'a brave knight' } as unknown as ImagePrompt;
  const baseRequest = {
    prompt,
    identifier: 'beat-1',
    jobId: 'job-1',
  };

  it('GeminiAdapter routes to nano-banana backend', async () => {
    const bridge = makeBridge();
    await new GeminiAdapter().generate(baseRequest, bridge);
    expect(bridge.generateWithNanoBanana).toHaveBeenCalledTimes(1);
  });

  it('AtlasCloudAdapter routes to atlas-cloud backend', async () => {
    const bridge = makeBridge();
    await new AtlasCloudAdapter().generate(baseRequest, bridge);
    expect(bridge.generateWithAtlasCloud).toHaveBeenCalledTimes(1);
  });

  it('MidApiAdapter routes to useapi backend for both midapi and useapi ids', async () => {
    const bridge = makeBridge();
    await new MidApiAdapter('midapi').generate(baseRequest, bridge);
    await new MidApiAdapter('useapi').generate(baseRequest, bridge);
    expect(bridge.generateWithUseapi).toHaveBeenCalledTimes(2);
  });

  it('StableDiffusionProviderAdapter routes to SD backend', async () => {
    const bridge = makeBridge();
    await new StableDiffusionProviderAdapter().generate(baseRequest, bridge);
    expect(bridge.generateWithStableDiffusion).toHaveBeenCalledTimes(1);
  });

  it('DallEAdapter routes to dall-e backend', async () => {
    const bridge = makeBridge();
    await new DallEAdapter().generate(baseRequest, bridge);
    expect(bridge.generateWithDallE).toHaveBeenCalledTimes(1);
  });

  it('PlaceholderAdapter writes a prompt artifact via the bridge', async () => {
    const bridge = makeBridge();
    await new PlaceholderAdapter().generate(baseRequest, bridge);
    expect(bridge.generatePlaceholder).toHaveBeenCalledTimes(1);
  });
});
