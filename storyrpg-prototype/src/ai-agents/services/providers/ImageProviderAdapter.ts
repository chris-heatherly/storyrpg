/**
 * Provider-agnostic image-generation adapter interface.
 *
 * Mirrors the `StableDiffusionAdapter` pattern: every concrete provider
 * (Gemini / nano-banana, Atlas Cloud, MidAPI / Midjourney, Stable Diffusion,
 * DALL-E, etc.) implements this seam so `ImageGenerationService` can route
 * a single `generate` / `edit` call through `providerRegistry.get(provider)`
 * instead of a hand-written `switch` statement.
 *
 * The concrete bodies still live inside `imageGenerationService.ts` today —
 * the adapters here delegate to those private methods via the
 * `ProviderServiceBridge`. That lets us expose a stable, testable seam
 * NOW while the large file is progressively decomposed in a follow-up pass.
 */
import type { ImagePrompt, GeneratedImage } from '../../agents/ImageGenerator';
import type {
  ImageType,
  ReferenceImage,
  ProviderPreflightResult,
} from '../imageGenerationService';

export interface ProviderGenerateRequest {
  prompt: ImagePrompt;
  identifier: string;
  jobId: string;
  imageType?: ImageType;
  referenceImages?: ReferenceImage[];
  metadata?: Record<string, unknown>;
}

export interface ProviderEditRequest extends ProviderGenerateRequest {
  baseImage: { data: string; mimeType: string };
  mask?: { data: string; mimeType: string };
}

/**
 * Minimal surface the `ImageGenerationService` exposes to adapters so they
 * can reuse the service's existing private provider implementations without
 * inheriting the whole class. As each provider is ported out of the monolith
 * the matching method on this bridge can be deleted.
 */
export interface ProviderServiceBridge {
  generateWithNanoBanana(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
    referenceImages?: ReferenceImage[],
    imageType?: ImageType,
  ): Promise<GeneratedImage>;
  generateWithAtlasCloud(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
    referenceImages?: ReferenceImage[],
    imageType?: ImageType,
  ): Promise<GeneratedImage>;
  generateWithUseapi(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
    metadata?: Record<string, unknown>,
    referenceImages?: ReferenceImage[],
  ): Promise<GeneratedImage>;
  generateWithDallE(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
  ): Promise<GeneratedImage>;
  generateWithStableDiffusion(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
    referenceImages?: ReferenceImage[],
    metadata?: Record<string, unknown>,
  ): Promise<GeneratedImage>;
  generatePlaceholder(
    prompt: ImagePrompt,
    identifier: string,
    jobId: string,
  ): Promise<GeneratedImage>;
  preflightImageProvider(forceCanary?: boolean): Promise<ProviderPreflightResult>;
}

export interface ImageProviderAdapter {
  /** Stable id used in logs / diagnostics / registry keys. */
  readonly id: string;

  /** Generate a fresh image from a prompt (+ optional reference pack). */
  generate(
    request: ProviderGenerateRequest,
    bridge: ProviderServiceBridge,
  ): Promise<GeneratedImage>;

  /**
   * Optional image-to-image / inpainting path. Adapters that don't support
   * editing should simply omit this method; the dispatcher will fall back
   * to `generate` with a text prompt.
   */
  edit?(
    request: ProviderEditRequest,
    bridge: ProviderServiceBridge,
  ): Promise<GeneratedImage>;

  /**
   * Cheap canary. Defaults to the shared service-level preflight so every
   * adapter behaves identically unless a provider has a bespoke probe.
   */
  preflight?(bridge: ProviderServiceBridge): Promise<ProviderPreflightResult>;
}
