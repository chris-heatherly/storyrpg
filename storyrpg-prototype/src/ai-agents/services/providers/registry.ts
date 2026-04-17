/**
 * Image provider registry.
 *
 * `ImageGenerationService.generateImageCore` routes through this registry
 * instead of a hand-written `switch (provider)`, keeping the dispatcher
 * small and making it trivial to add providers (register once, done).
 */
import type { ImageProvider } from '../../config';
import type { ImageProviderAdapter } from './ImageProviderAdapter';
import { GeminiAdapter } from './GeminiAdapter';
import { AtlasCloudAdapter } from './AtlasCloudAdapter';
import { MidApiAdapter } from './MidApiAdapter';
import { StableDiffusionProviderAdapter } from './StableDiffusionProviderAdapter';
import { PlaceholderAdapter, DallEAdapter } from './PlaceholderAdapter';

export class ImageProviderRegistry {
  private readonly adapters = new Map<string, ImageProviderAdapter>();
  private readonly fallback: ImageProviderAdapter;

  constructor(adapters: ImageProviderAdapter[], fallback: ImageProviderAdapter) {
    for (const adapter of adapters) this.adapters.set(adapter.id, adapter);
    this.fallback = fallback;
  }

  get(provider: ImageProvider | string | undefined): ImageProviderAdapter {
    if (!provider) return this.fallback;
    return this.adapters.get(provider) ?? this.fallback;
  }

  has(provider: string): boolean {
    return this.adapters.has(provider);
  }

  register(adapter: ImageProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}

export function createDefaultImageProviderRegistry(): ImageProviderRegistry {
  const placeholder = new PlaceholderAdapter();
  return new ImageProviderRegistry(
    [
      new GeminiAdapter(),
      new AtlasCloudAdapter(),
      new MidApiAdapter('midapi'),
      new MidApiAdapter('useapi'),
      new StableDiffusionProviderAdapter(),
      new DallEAdapter(),
      placeholder,
    ],
    placeholder,
  );
}
