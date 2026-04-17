/**
 * LoRA trainer adapter factory.
 *
 * Mirrors `createStableDiffusionAdapter` in
 * `src/ai-agents/services/stable-diffusion/factory.ts`: the factory is the
 * only place that maps a string backend id to a concrete adapter class. This
 * keeps `LoraTrainingAgent` free of `switch (settings.backend)` noise and
 * makes future adapters (A1111 Dreambooth, ComfyUI, Replicate, fal.ai) a
 * one-line extension.
 *
 * Only `kohya` has a concrete implementation today; every other listed
 * backend throws a clear error describing how to switch to `kohya`.
 */

import type { LoraTrainerAdapter } from './LoraTrainerAdapter';
import { KohyaAdapter, type KohyaAdapterOptions } from './KohyaAdapter';

export type LoraTrainerBackend =
  | 'kohya'
  | 'a1111-dreambooth'
  | 'comfy-training'
  | 'replicate'
  | 'fal'
  | 'disabled';

export interface LoraTrainerFactoryOptions {
  backend?: LoraTrainerBackend;
  /** Forwarded to adapters that talk HTTP (base URL, API key, timeout, ...). */
  kohya?: KohyaAdapterOptions;
}

/**
 * Build a concrete `LoraTrainerAdapter` for the requested backend.
 *
 * - `kohya` returns a configured `KohyaAdapter`.
 * - `disabled` throws a clear error so callers know the agent should have
 *   short-circuited before reaching here.
 * - Every other recognised backend throws a "not implemented yet" error
 *   that suggests switching to `kohya`.
 * - Unknown strings throw a generic "unknown backend" error.
 */
export function createLoraTrainerAdapter(
  options: LoraTrainerFactoryOptions | undefined,
): LoraTrainerAdapter {
  const backend = options?.backend || 'disabled';
  switch (backend) {
    case 'kohya':
      return new KohyaAdapter(options?.kohya);
    case 'a1111-dreambooth':
      throw new Error(
        'LoRA trainer backend "a1111-dreambooth" is not implemented yet. Set LORA_TRAINER_BACKEND=kohya to use the kohya_ss sidecar.',
      );
    case 'comfy-training':
      throw new Error(
        'LoRA trainer backend "comfy-training" is not implemented yet. Set LORA_TRAINER_BACKEND=kohya to use the kohya_ss sidecar.',
      );
    case 'replicate':
      throw new Error(
        'LoRA trainer backend "replicate" is not implemented yet. Set LORA_TRAINER_BACKEND=kohya to use the kohya_ss sidecar.',
      );
    case 'fal':
      throw new Error(
        'LoRA trainer backend "fal" is not implemented yet. Set LORA_TRAINER_BACKEND=kohya to use the kohya_ss sidecar.',
      );
    case 'disabled':
      throw new Error(
        'LoRA trainer is disabled (backend=disabled). Set LORA_TRAINER_BACKEND to a supported backend (e.g. "kohya") before requesting an adapter.',
      );
    default:
      throw new Error(`Unknown LoRA trainer backend: ${String(backend)}`);
  }
}
