/**
 * Tiny adapter factory for Stable Diffusion backends. Keeps
 * `ImageGenerationService` free of `switch (settings.backend)` noise and
 * makes future adapters (ComfyUI, Replicate, fal.ai, Stability) a one-line
 * extension.
 */

import { A1111Adapter } from './A1111Adapter';
import type { StableDiffusionAdapter } from './StableDiffusionAdapter';
import type { StableDiffusionSettings } from '../../config';

export function createStableDiffusionAdapter(
  settings: StableDiffusionSettings | undefined,
): StableDiffusionAdapter {
  const backend = settings?.backend || 'a1111';
  switch (backend) {
    case 'a1111':
      return new A1111Adapter();
    case 'comfy':
      throw new Error(
        'Stable Diffusion backend "comfy" is not implemented yet. Set STABLE_DIFFUSION_BACKEND=a1111 to use Automatic1111/Forge.',
      );
    case 'replicate':
      throw new Error(
        'Stable Diffusion backend "replicate" is not implemented yet. Set STABLE_DIFFUSION_BACKEND=a1111 to use Automatic1111/Forge.',
      );
    case 'stability':
      throw new Error(
        'Stable Diffusion backend "stability" is not implemented yet. Set STABLE_DIFFUSION_BACKEND=a1111 to use Automatic1111/Forge.',
      );
    case 'fal':
      throw new Error(
        'Stable Diffusion backend "fal" is not implemented yet. Set STABLE_DIFFUSION_BACKEND=a1111 to use Automatic1111/Forge.',
      );
    default:
      throw new Error(`Unknown Stable Diffusion backend: ${String(backend)}`);
  }
}
