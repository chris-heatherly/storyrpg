/**
 * AUTOMATIC1111 / Forge WebUI adapter.
 *
 * Targets the REST surface that A1111 and Forge both expose:
 *   - POST /sdapi/v1/txt2img
 *   - POST /sdapi/v1/img2img
 *   - GET  /sdapi/v1/sd-models    (preflight)
 *
 * ControlNet, IP-Adapter, and reference-only are wired through the
 * `sd-webui-controlnet` extension (`alwayson_scripts.controlnet.args[]`).
 * The extension is the de-facto standard on both A1111 and Forge, so one
 * wire format covers both hosts.
 *
 * The adapter itself does no retry/classification logic — that stays in
 * `ImageGenerationService` so SD benefits from the same provider-policy
 * tracking (quarantine / degraded) that Gemini and Atlas already have.
 */

import type { GeneratedImage } from '../../agents/ImageGenerator';
import type {
  StableDiffusionAdapter,
  SDRequest,
  SDEditRequest,
  SDWriteHelpers,
} from './StableDiffusionAdapter';
import type { StableDiffusionSettings } from '../../config';
import type { ProviderPreflightResult } from '../imageGenerationService';
import { EXTERNAL_APIS } from '../../../config/endpoints';
import { buildSDPrompt } from './buildSDPrompt';
import { referencePackToSDInputs } from './referencePackToSDInputs';

interface A1111TxtImgPayload {
  prompt: string;
  negative_prompt: string;
  seed: number;
  steps: number;
  cfg_scale: number;
  sampler_name: string;
  width: number;
  height: number;
  batch_size?: number;
  n_iter?: number;
  override_settings?: Record<string, unknown>;
  alwayson_scripts?: Record<string, unknown>;
}

interface A1111Img2ImgPayload extends A1111TxtImgPayload {
  init_images: string[];
  denoising_strength: number;
  mask?: string;
}

function resolveBaseUrl(settings: StableDiffusionSettings): string {
  const explicit = (settings.baseUrl || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  // Fall back to the local proxy mount — the proxy forwards to the env-configured host.
  const txt2img = EXTERNAL_APIS.stableDiffusion.txt2img;
  return txt2img.replace(/\/sdapi\/v1\/txt2img$/, '');
}

function buildAuthHeaders(settings: StableDiffusionSettings): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) {
    headers['x-stable-diffusion-token'] = settings.apiKey;
  }
  return headers;
}

function buildControlNetArgs(
  controlNets: Array<{ unit: { module: string; model: string; weight?: number; controlMode?: string }; image: { data: string } }>,
  ipAdapter?: { unit: { model: string; weight?: number }; image: { data: string } },
): any[] {
  const args: any[] = [];
  for (const { unit, image } of controlNets) {
    args.push({
      enabled: true,
      input_image: image.data,
      module: unit.module,
      model: unit.model,
      weight: unit.weight ?? 0.55,
      control_mode: unit.controlMode || 'Balanced',
      pixel_perfect: true,
      resize_mode: 'Crop and Resize',
    });
  }
  if (ipAdapter) {
    args.push({
      enabled: true,
      input_image: ipAdapter.image.data,
      module: 'ip-adapter_face_id_plus',
      model: ipAdapter.unit.model,
      weight: ipAdapter.unit.weight ?? 0.7,
      control_mode: 'My prompt is more important',
      pixel_perfect: true,
      resize_mode: 'Crop and Resize',
    });
  }
  return args;
}

function extractImage(response: any): { data: string; mimeType: string } {
  const images: unknown = response?.images;
  if (!Array.isArray(images) || images.length === 0 || typeof images[0] !== 'string') {
    throw new Error('A1111 response missing images array');
  }
  const first = images[0] as string;
  // Forge sometimes returns a data URI; A1111 returns raw base64. Handle both.
  const m = first.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (m) return { mimeType: m[1], data: m[2] };
  return { mimeType: 'image/png', data: first };
}

export class A1111Adapter implements StableDiffusionAdapter {
  readonly id = 'a1111';

  async generate(req: SDRequest, io: SDWriteHelpers): Promise<GeneratedImage> {
    const { prompt, identifier, settings, referenceImages } = req;
    const characterName = req.metadata?.characterName;
    const characterLora = characterName
      ? settings.characterLoraByName?.[characterName]
      : undefined;
    const built = buildSDPrompt(prompt, settings, characterLora);
    const refs = referencePackToSDInputs(referenceImages, settings, {
      controlNet: prompt.controlNet,
      ipAdapter: prompt.ipAdapter,
    });

    const controlnetArgs = buildControlNetArgs(refs.controlNets, refs.ipAdapter);
    const alwayson = controlnetArgs.length > 0
      ? { controlnet: { args: controlnetArgs } }
      : undefined;

    const overrideSettings: Record<string, unknown> = {};
    if (built.model) overrideSettings.sd_model_checkpoint = built.model;

    const baseUrl = resolveBaseUrl(settings);
    const headers = buildAuthHeaders(settings);

    const initImage = refs.init?.data;
    const denoising = prompt.denoisingStrength ?? settings.defaultDenoisingStrength ?? 0.55;

    if (initImage) {
      const payload: A1111Img2ImgPayload = {
        prompt: built.positive,
        negative_prompt: built.negative,
        seed: built.seed,
        steps: built.steps,
        cfg_scale: built.cfgScale,
        sampler_name: built.sampler,
        width: built.width,
        height: built.height,
        init_images: [initImage],
        denoising_strength: denoising,
      };
      if (refs.mask?.data) payload.mask = refs.mask.data;
      if (Object.keys(overrideSettings).length > 0) payload.override_settings = overrideSettings;
      if (alwayson) payload.alwayson_scripts = alwayson;
      return this.sendAndSave(`${baseUrl}/sdapi/v1/img2img`, payload, headers, prompt, identifier, io, built);
    }

    const payload: A1111TxtImgPayload = {
      prompt: built.positive,
      negative_prompt: built.negative,
      seed: built.seed,
      steps: built.steps,
      cfg_scale: built.cfgScale,
      sampler_name: built.sampler,
      width: built.width,
      height: built.height,
    };
    if (Object.keys(overrideSettings).length > 0) payload.override_settings = overrideSettings;
    if (alwayson) payload.alwayson_scripts = alwayson;
    return this.sendAndSave(`${baseUrl}/sdapi/v1/txt2img`, payload, headers, prompt, identifier, io, built);
  }

  async edit(req: SDEditRequest, io: SDWriteHelpers): Promise<GeneratedImage> {
    // Fold the base image into the reference pack as the init image and
    // optionally as an inpaint mask, then reuse the standard generate path.
    const refs = [...(req.referenceImages || [])];
    refs.unshift({
      data: req.baseImage.data,
      mimeType: req.baseImage.mimeType,
      role: 'img2img-init',
      purpose: 'img2img-init',
    });
    if (req.mask) {
      refs.unshift({
        data: req.mask.data,
        mimeType: req.mask.mimeType,
        role: 'inpaint-mask',
        purpose: 'inpaint-mask',
      });
    }
    return this.generate({ ...req, referenceImages: refs }, io);
  }

  async preflight(settings: StableDiffusionSettings): Promise<ProviderPreflightResult> {
    const startedAt = Date.now();
    const baseUrl = resolveBaseUrl(settings);
    if (!baseUrl) {
      return { ok: false, provider: 'stable-diffusion', reason: 'missing SD base URL', latencyMs: 0 };
    }
    const headers = buildAuthHeaders(settings);
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      const timer = controller ? setTimeout(() => controller.abort(), 15_000) : undefined;
      const response = await fetch(`${baseUrl}/sdapi/v1/sd-models`, {
        method: 'GET',
        headers,
        signal: controller?.signal,
      });
      if (timer) clearTimeout(timer);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return {
          ok: false,
          provider: 'stable-diffusion',
          reason: `SD preflight failed: HTTP ${response.status}${text ? ` - ${text.slice(0, 200)}` : ''}`,
          latencyMs: Date.now() - startedAt,
        };
      }
      const models = await response.json().catch(() => null);
      if (!Array.isArray(models) || models.length === 0) {
        return {
          ok: false,
          provider: 'stable-diffusion',
          reason: 'SD backend reachable but reports no models',
          latencyMs: Date.now() - startedAt,
        };
      }
      return { ok: true, provider: 'stable-diffusion', latencyMs: Date.now() - startedAt };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, provider: 'stable-diffusion', reason: `SD preflight error: ${msg}`, latencyMs: Date.now() - startedAt };
    }
  }

  private async sendAndSave(
    url: string,
    payload: any,
    headers: Record<string, string>,
    prompt: SDRequest['prompt'],
    identifier: string,
    io: SDWriteHelpers,
    built: ReturnType<typeof buildSDPrompt>,
  ): Promise<GeneratedImage> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Stable Diffusion ${url} failed: HTTP ${response.status}${text ? ` - ${text.slice(0, 500)}` : ''}`);
    }
    const json = await response.json();
    const { data, mimeType } = extractImage(json);

    // Try to pull the actually-used seed/model from A1111's `info` payload so
    // downstream consumers can reuse it for continuity or regeneration.
    let effectiveSeed: number | undefined;
    let effectiveModel: string | undefined;
    try {
      const info = typeof json.info === 'string' ? JSON.parse(json.info) : json.info;
      if (info) {
        if (typeof info.seed === 'number') effectiveSeed = info.seed;
        if (typeof info.sd_model_name === 'string') effectiveModel = info.sd_model_name;
      }
    } catch {
      // `info` is diagnostic; don't fail the request if it's malformed.
    }

    const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg'
      : mimeType.includes('webp') ? 'webp' : 'png';
    const imagePath = io.joinPath(io.outputDir, `${identifier}.${extension}`);
    await io.writeFile(imagePath, data, true);
    const imageUrl = io.toImageHttpUrl(imagePath, mimeType, data);

    return {
      prompt,
      imagePath,
      imageUrl,
      imageData: data,
      mimeType,
      provider: 'stable-diffusion',
      model: effectiveModel || built.model,
      metadata: {
        provider: 'stable-diffusion',
        model: effectiveModel || built.model,
        format: extension,
        effectivePromptChars: built.positive.length,
        effectiveNegativeChars: built.negative.length,
        ...(typeof effectiveSeed === 'number' ? { seed: effectiveSeed } : {}),
      } as any,
    };
  }
}
