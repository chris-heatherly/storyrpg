/**
 * Placeholder adapter — writes a text file with the prompt instead of
 * generating a real image. Covers both the explicit `placeholder` slug and
 * any unknown provider (so the service never crashes on misconfiguration).
 */
import type { GeneratedImage } from '../../agents/ImageGenerator';
import type {
  ImageProviderAdapter,
  ProviderGenerateRequest,
  ProviderServiceBridge,
} from './ImageProviderAdapter';

export class PlaceholderAdapter implements ImageProviderAdapter {
  readonly id: string;

  constructor(id: string = 'placeholder') {
    this.id = id;
  }

  async generate(
    request: ProviderGenerateRequest,
    bridge: ProviderServiceBridge,
  ): Promise<GeneratedImage> {
    return bridge.generatePlaceholder(request.prompt, request.identifier, request.jobId);
  }
}

export class DallEAdapter implements ImageProviderAdapter {
  readonly id = 'dall-e';

  async generate(
    request: ProviderGenerateRequest,
    bridge: ProviderServiceBridge,
  ): Promise<GeneratedImage> {
    return bridge.generateWithDallE(request.prompt, request.identifier, request.jobId);
  }
}
