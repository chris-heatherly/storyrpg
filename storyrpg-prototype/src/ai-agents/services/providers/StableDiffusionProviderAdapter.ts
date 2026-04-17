/**
 * Registry wrapper around the existing Stable Diffusion adapter family.
 *
 * Keeps the main provider registry uniform — every provider (Gemini, Atlas,
 * MidAPI, SD, DALL-E, placeholder) implements `ImageProviderAdapter`. The
 * underlying `StableDiffusionAdapter` (A1111 / ComfyUI / Replicate / …) is
 * still chosen by `createStableDiffusionAdapter` at runtime.
 */
import type { GeneratedImage } from '../../agents/ImageGenerator';
import type {
  ImageProviderAdapter,
  ProviderGenerateRequest,
  ProviderServiceBridge,
} from './ImageProviderAdapter';

export class StableDiffusionProviderAdapter implements ImageProviderAdapter {
  readonly id = 'stable-diffusion';

  async generate(
    request: ProviderGenerateRequest,
    bridge: ProviderServiceBridge,
  ): Promise<GeneratedImage> {
    return bridge.generateWithStableDiffusion(
      request.prompt,
      request.identifier,
      request.jobId,
      request.referenceImages,
      request.metadata,
    );
  }
}
