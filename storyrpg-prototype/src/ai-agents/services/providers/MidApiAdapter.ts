/**
 * MidAPI / Midjourney (useapi.net) adapter.
 *
 * Thin seam over `ImageGenerationService.generateWithUseapi`. Both the
 * `midapi` and legacy `useapi` provider slugs route here. Full decomposition
 * is tracked as TODO(tech-debt-phase-6-finish).
 */
import type { GeneratedImage } from '../../agents/ImageGenerator';
import type {
  ImageProviderAdapter,
  ProviderGenerateRequest,
  ProviderServiceBridge,
} from './ImageProviderAdapter';

export class MidApiAdapter implements ImageProviderAdapter {
  readonly id: string;

  constructor(id: 'midapi' | 'useapi' = 'midapi') {
    this.id = id;
  }

  async generate(
    request: ProviderGenerateRequest,
    bridge: ProviderServiceBridge,
  ): Promise<GeneratedImage> {
    return bridge.generateWithUseapi(
      request.prompt,
      request.identifier,
      request.jobId,
      request.metadata,
      request.referenceImages,
    );
  }
}
