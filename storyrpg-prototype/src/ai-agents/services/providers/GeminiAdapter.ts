/**
 * Gemini / nano-banana adapter.
 *
 * Thin seam over `ImageGenerationService.generateWithNanoBanana`. Full
 * decomposition of the provider body out of the monolith is tracked as
 * TODO(tech-debt-phase-6-finish).
 */
import type { GeneratedImage } from '../../agents/ImageGenerator';
import type {
  ImageProviderAdapter,
  ProviderGenerateRequest,
  ProviderServiceBridge,
} from './ImageProviderAdapter';

export class GeminiAdapter implements ImageProviderAdapter {
  readonly id = 'nano-banana';

  async generate(
    request: ProviderGenerateRequest,
    bridge: ProviderServiceBridge,
  ): Promise<GeneratedImage> {
    return bridge.generateWithNanoBanana(
      request.prompt,
      request.identifier,
      request.jobId,
      request.referenceImages,
      request.imageType,
    );
  }
}
