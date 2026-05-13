/**
 * Atlas Cloud adapter.
 *
 * Thin seam over `ImageGenerationService.generateWithAtlasCloud`. Full
 * decomposition tracked as TODO(tech-debt-phase-6-finish).
 */
import type { GeneratedImage } from '../../agents/ImageGenerator';
import type {
  ImageProviderAdapter,
  ProviderGenerateRequest,
  ProviderServiceBridge,
} from './ImageProviderAdapter';

export class AtlasCloudAdapter implements ImageProviderAdapter {
  readonly id = 'atlas-cloud';

  async generate(
    request: ProviderGenerateRequest,
    bridge: ProviderServiceBridge,
  ): Promise<GeneratedImage> {
    return bridge.generateWithAtlasCloud(
      request.prompt,
      request.identifier,
      request.jobId,
      request.referenceImages,
      request.imageType,
    );
  }
}
