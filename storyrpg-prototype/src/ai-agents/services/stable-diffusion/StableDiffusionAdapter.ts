/**
 * Stable Diffusion adapter interface — the single seam between
 * `ImageGenerationService` and any concrete SD backend (A1111, ComfyUI,
 * Replicate, fal.ai, etc.).
 *
 * Goals:
 *  - Keep `ImageGenerationService` free of backend-specific branching for SD.
 *  - Make it trivial to add more backends: implement the interface, register
 *    the adapter in the adapter factory, done.
 *  - Keep the input/output shape identical to every other provider so callers
 *    treat SD-generated images the same as Gemini / Atlas / Midjourney ones.
 */

import type { ImagePrompt, GeneratedImage } from '../../agents/ImageGenerator';
import type { StableDiffusionSettings } from '../../config';
import type {
  ImageType,
  ReferenceImage,
  ProviderPreflightResult,
} from '../imageGenerationService';

export interface SDRequestMetadata {
  type?: ImageType;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
  characterId?: string;
  characterName?: string;
  tier?: string;
  baseIdentifier?: string;
  /** Marks a regen request so the adapter can override cache/seed behavior. */
  forceRegenerate?: boolean;
  [key: string]: unknown;
}

export interface SDRequest {
  prompt: ImagePrompt;
  identifier: string;
  jobId: string;
  metadata?: SDRequestMetadata;
  referenceImages?: ReferenceImage[];
  settings: StableDiffusionSettings;
}

export interface SDEditRequest extends SDRequest {
  /** The base image to modify (img2img / inpaint). */
  baseImage: { data: string; mimeType: string };
  /** Optional inpaint mask (single-channel PNG). */
  mask?: { data: string; mimeType: string };
}

/**
 * Write helper surface — passed in by `ImageGenerationService` so adapters can
 * persist bytes using the same path normalization / runtime detection as the
 * rest of the pipeline. Keeping this small avoids dragging the full service
 * class into every adapter.
 */
export interface SDWriteHelpers {
  outputDir: string;
  writeFile(filePath: string, content: string | Buffer, isBase64?: boolean): Promise<void>;
  joinPath(base: string, ...parts: string[]): string;
  toImageHttpUrl(imagePath: string, mimeType: string, imageData: string): string;
}

export interface StableDiffusionAdapter {
  /**
   * Generate a fresh image from a prompt + optional reference pack. Must
   * return a `GeneratedImage` with `imageData` + `mimeType` (and ideally
   * `imagePath` + `imageUrl` when the adapter wrote the bytes to disk).
   */
  generate(req: SDRequest, io: SDWriteHelpers): Promise<GeneratedImage>;

  /**
   * Modify an existing image. Used for continuity regen and scene-to-scene
   * transitions. Adapters without native img2img should throw a clear error.
   */
  edit?(req: SDEditRequest, io: SDWriteHelpers): Promise<GeneratedImage>;

  /**
   * Canary health check — should hit a cheap endpoint (e.g. `/sd-models`) and
   * report reachability without burning compute.
   */
  preflight(settings: StableDiffusionSettings): Promise<ProviderPreflightResult>;

  /** Stable identifier used in logs/diagnostics. */
  readonly id: string;
}
