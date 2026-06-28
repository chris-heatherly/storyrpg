/**
 * MidAPI / Midjourney (useapi.net) adapter.
 *
 * Thin seam over `ImageGenerationService.generateWithUseapi`. StoryRPG's
 * canonical provider id is `midapi`; the underlying API still uses useapi.net.
 */
import type { GeneratedImage } from '../../images/imageTypes';
import type {
  ImageProviderAdapter,
  ProviderGenerateRequest,
  ProviderServiceBridge,
} from './ImageProviderAdapter';

export class MidApiAdapter implements ImageProviderAdapter {
  readonly id: string;

  constructor(id: 'midapi' = 'midapi') {
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
