import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A1111Adapter } from './A1111Adapter';
import type { StableDiffusionSettings } from '../../config';
import type { SDWriteHelpers } from './StableDiffusionAdapter';
import type { ReferenceImage } from '../imageGenerationService';

function makeIo(): SDWriteHelpers & { _written: Array<{ path: string }> } {
  const written: Array<{ path: string }> = [];
  return {
    outputDir: '/tmp/sd-test',
    writeFile: async (p: string) => {
      written.push({ path: p });
    },
    joinPath: (base: string, ...parts: string[]) => [base, ...parts].join('/'),
    toImageHttpUrl: (p: string) => `http://test/${p}`,
    _written: written,
  };
}

const baseSettings: StableDiffusionSettings = {
  baseUrl: 'http://localhost:7860',
  backend: 'a1111',
  defaultSampler: 'DPM++ 2M Karras',
  defaultSteps: 20,
  defaultCfg: 6,
  defaultModel: 'checkpoint-xyz',
  ipAdapterModel: 'ip-adapter_sdxl',
  controlNetModels: { depth: 'depth_sdxl', canny: 'canny_sdxl' },
};

const okResponse = () => ({
  ok: true,
  json: async () => ({
    images: ['aGVsbG8='],
    info: JSON.stringify({ seed: 1234567, sd_model_name: 'checkpoint-xyz' }),
  }),
});

describe('A1111Adapter', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => okResponse() as any);
    (globalThis as any).fetch = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches txt2img when there is no init image', async () => {
    const adapter = new A1111Adapter();
    await adapter.generate(
      {
        prompt: { prompt: 'hero' } as any,
        identifier: 'scene-1',
        jobId: 'job-1',
        settings: baseSettings,
      },
      makeIo(),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:7860/sdapi/v1/txt2img');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.prompt).toContain('hero');
    expect(body.sampler_name).toBe('DPM++ 2M Karras');
    expect(body.steps).toBe(20);
    expect(body.override_settings.sd_model_checkpoint).toBe('checkpoint-xyz');
    expect(body.init_images).toBeUndefined();
  });

  it('dispatches img2img when a reference with purpose=img2img-init is present', async () => {
    const adapter = new A1111Adapter();
    const refs: ReferenceImage[] = [
      { data: 'BASE64INIT', mimeType: 'image/png', role: 'img2img-init', purpose: 'img2img-init' },
    ];
    await adapter.generate(
      {
        prompt: { prompt: 'hero' } as any,
        identifier: 'scene-1',
        jobId: 'job-1',
        settings: baseSettings,
        referenceImages: refs,
      },
      makeIo(),
    );
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:7860/sdapi/v1/img2img');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.init_images).toEqual(['BASE64INIT']);
    expect(typeof body.denoising_strength).toBe('number');
  });

  it('wires ControlNet depth and IP-Adapter into alwayson_scripts.controlnet.args', async () => {
    const adapter = new A1111Adapter();
    const refs: ReferenceImage[] = [
      { data: 'ENV', mimeType: 'image/png', role: 'location-env', purpose: 'controlnet-depth' },
      {
        data: 'FACE',
        mimeType: 'image/png',
        role: 'character-reference-face',
        characterName: 'hero',
      },
    ];
    await adapter.generate(
      {
        prompt: { prompt: 'hero' } as any,
        identifier: 'scene-1',
        jobId: 'job-1',
        settings: baseSettings,
        referenceImages: refs,
      },
      makeIo(),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const args = body.alwayson_scripts.controlnet.args;
    expect(Array.isArray(args)).toBe(true);
    // One depth controlnet + one IP-adapter entry
    expect(args).toHaveLength(2);
    const depth = args.find((a: any) => a.module === 'depth_midas');
    expect(depth).toBeDefined();
    expect(depth.input_image).toBe('ENV');
    expect(depth.model).toBe('depth_sdxl');
    const ipa = args.find((a: any) => a.module === 'ip-adapter_face_id_plus');
    expect(ipa).toBeDefined();
    expect(ipa.input_image).toBe('FACE');
    expect(ipa.model).toBe('ip-adapter_sdxl');
  });

  it('applies character LoRA from settings registry based on metadata.characterName', async () => {
    const adapter = new A1111Adapter();
    await adapter.generate(
      {
        prompt: { prompt: 'hero' } as any,
        identifier: 'scene-1',
        jobId: 'job-1',
        settings: {
          ...baseSettings,
          characterLoraByName: { hero: { name: 'hero_lora', weight: 0.85 } },
        },
        metadata: { characterName: 'hero' },
      },
      makeIo(),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.prompt).toContain('<lora:hero_lora:0.85>');
  });

  it('stacks character LoRAs for every name in metadata.characterNames (plural)', async () => {
    const adapter = new A1111Adapter();
    await adapter.generate(
      {
        prompt: { prompt: 'duel' } as any,
        identifier: 'scene-2',
        jobId: 'job-2',
        settings: {
          ...baseSettings,
          characterLoraByName: {
            hero: { name: 'hero_lora', weight: 0.85 },
            rival: { name: 'rival_lora', weight: 0.8 },
          },
        },
        metadata: { characterNames: ['hero', 'rival'] },
      },
      makeIo(),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.prompt).toContain('<lora:hero_lora:0.85>');
    expect(body.prompt).toContain('<lora:rival_lora:0.80>');
  });

  it('skips characterNames entries that are not registered without error', async () => {
    const adapter = new A1111Adapter();
    await adapter.generate(
      {
        prompt: { prompt: 'solo' } as any,
        identifier: 'scene-3',
        jobId: 'job-3',
        settings: {
          ...baseSettings,
          characterLoraByName: { hero: { name: 'hero_lora', weight: 0.85 } },
        },
        metadata: { characterNames: ['hero', 'unknown_bystander'] },
      },
      makeIo(),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.prompt).toContain('<lora:hero_lora:0.85>');
    expect(body.prompt).not.toContain('unknown_bystander');
  });

  it('preflight succeeds when /sd-models returns a non-empty array', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ title: 'checkpoint-xyz' }],
    }));
    const adapter = new A1111Adapter();
    const out = await adapter.preflight(baseSettings);
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('stable-diffusion');
  });

  it('preflight fails when /sd-models returns empty', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }));
    const adapter = new A1111Adapter();
    const out = await adapter.preflight(baseSettings);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no models/i);
  });

  it('edit() folds the base image into references as img2img-init', async () => {
    const adapter = new A1111Adapter();
    await adapter.edit(
      {
        prompt: { prompt: 'hero' } as any,
        identifier: 'scene-1',
        jobId: 'job-1',
        settings: baseSettings,
        baseImage: { data: 'BASEBASE', mimeType: 'image/png' },
      },
      makeIo(),
    );
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:7860/sdapi/v1/img2img');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.init_images).toEqual(['BASEBASE']);
  });

  it('forwards the optional api key as x-stable-diffusion-token', async () => {
    const adapter = new A1111Adapter();
    await adapter.generate(
      {
        prompt: { prompt: 'hero' } as any,
        identifier: 'scene-1',
        jobId: 'job-1',
        settings: { ...baseSettings, apiKey: 'secret-123' },
      },
      makeIo(),
    );
    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers['x-stable-diffusion-token']).toBe('secret-123');
  });
});
