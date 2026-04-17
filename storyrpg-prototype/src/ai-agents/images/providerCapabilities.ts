/**
 * Per-provider capability table.
 *
 * Centralizes what each image provider can consume so upstream code
 * (reference pack builder, pre-upload logic, batch router, rate limiter)
 * can make uniform decisions without scattered `if (provider === ...)`
 * checks. Adding a new provider means adding one row here.
 *
 * Consumed by:
 * - imageGenerationService (rate limits, concurrency, inline-vs-URL refs)
 * - referencePackBuilder (per-provider max ref count)
 * - FullStoryPipeline.runMasterImageGeneration (skip refs the provider can't use)
 * - EncounterImageAgent (batching)
 */

import type { ImageProvider } from '../config';

export interface ProviderCapabilities {
  /** Canonical provider id. */
  id: ImageProvider;
  /** Max reference images the provider will accept in a single request. */
  maxRefs: number;
  /** Can the provider consume inline base64 reference images? */
  acceptsInlineRefs: boolean;
  /** Can the provider consume HTTP URL references? */
  acceptsUrlRefs: boolean;
  /** Does the provider expose a batch endpoint (multiple images per call)? */
  supportsBatch: boolean;
  /** Can a deterministic seed be supplied for reproducibility? */
  supportsSeed: boolean;
  /** Does the provider respect a textual negative prompt? */
  supportsNegativePrompt: boolean;
  /** Does the provider use Midjourney-style `--cref`/`--sref` URL tokens? */
  usesMidjourneyRefTokens: boolean;
  /** Minimum milliseconds between consecutive requests (rate-limiter gap). */
  minRequestIntervalMs: number;
  /** How many concurrent in-flight requests are safe against this provider. */
  concurrency: number;
  /** Rough RPM ceiling advertised by the provider (used for observability). */
  rpmCeiling?: number;
  /**
   * Can this provider consume locally-trained LoRA weights at inference time,
   * and therefore benefit from the auto-training subsystem? Only the
   * self-hosted Stable Diffusion path supports this today. Every hosted
   * provider (Gemini/nano-banana, Atlas/Seedream, Midjourney, DALL-E) has
   * no customer-facing LoRA fine-tune or inference mechanism, so this flag
   * gates `LoraTrainingAgent` to a no-op there.
   */
  supportsLoraTraining: boolean;
}

/**
 * Default capability matrix. Tuned conservatively; individual providers can
 * be overridden at runtime via `overrideProviderCapabilities` if a user's
 * API tier differs from the public default.
 */
const DEFAULT_CAPABILITIES: Record<ImageProvider, ProviderCapabilities> = {
  'nano-banana': {
    id: 'nano-banana',
    maxRefs: 10,
    acceptsInlineRefs: true,
    acceptsUrlRefs: false,
    supportsBatch: false,
    supportsSeed: false,
    supportsNegativePrompt: true,
    usesMidjourneyRefTokens: false,
    minRequestIntervalMs: 1000,
    concurrency: 6,
    rpmCeiling: 60,
    supportsLoraTraining: false,
  },
  'atlas-cloud': {
    id: 'atlas-cloud',
    maxRefs: 14,
    acceptsInlineRefs: false,
    acceptsUrlRefs: true,
    supportsBatch: true,
    supportsSeed: true,
    supportsNegativePrompt: true,
    usesMidjourneyRefTokens: false,
    minRequestIntervalMs: 1500,
    concurrency: 4,
    rpmCeiling: 40,
    supportsLoraTraining: false,
  },
  midapi: {
    id: 'midapi',
    maxRefs: 2,
    acceptsInlineRefs: false,
    acceptsUrlRefs: true,
    supportsBatch: false,
    supportsSeed: false,
    supportsNegativePrompt: true,
    usesMidjourneyRefTokens: true,
    minRequestIntervalMs: 3000,
    concurrency: 2,
    rpmCeiling: 20,
    supportsLoraTraining: false,
  },
  useapi: {
    id: 'useapi',
    maxRefs: 2,
    acceptsInlineRefs: false,
    acceptsUrlRefs: true,
    supportsBatch: false,
    supportsSeed: false,
    supportsNegativePrompt: true,
    usesMidjourneyRefTokens: true,
    minRequestIntervalMs: 3000,
    concurrency: 2,
    rpmCeiling: 20,
    supportsLoraTraining: false,
  },
  'dall-e': {
    id: 'dall-e',
    maxRefs: 0,
    acceptsInlineRefs: false,
    acceptsUrlRefs: false,
    supportsBatch: false,
    supportsSeed: false,
    supportsNegativePrompt: false,
    usesMidjourneyRefTokens: false,
    minRequestIntervalMs: 2000,
    concurrency: 3,
    rpmCeiling: 30,
    supportsLoraTraining: false,
  },
  'stable-diffusion': {
    id: 'stable-diffusion',
    maxRefs: 4,
    acceptsInlineRefs: true,
    acceptsUrlRefs: false,
    supportsBatch: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    usesMidjourneyRefTokens: false,
    minRequestIntervalMs: 0,
    concurrency: 1,
    rpmCeiling: undefined,
    supportsLoraTraining: true,
  },
  placeholder: {
    id: 'placeholder',
    maxRefs: 0,
    acceptsInlineRefs: false,
    acceptsUrlRefs: false,
    supportsBatch: false,
    supportsSeed: false,
    supportsNegativePrompt: false,
    usesMidjourneyRefTokens: false,
    minRequestIntervalMs: 0,
    concurrency: 16,
    rpmCeiling: undefined,
    supportsLoraTraining: false,
  },
};

let runtimeOverrides: Partial<Record<ImageProvider, Partial<ProviderCapabilities>>> = {};

/**
 * Returns the effective capability row for a provider, merging runtime
 * overrides on top of the static default. Unknown providers fall back to
 * `placeholder` shape so callers always get a deterministic answer.
 */
export function getProviderCapabilities(provider: ImageProvider | string | undefined): ProviderCapabilities {
  const normalized = (provider as ImageProvider) || 'placeholder';
  const base = DEFAULT_CAPABILITIES[normalized] ?? DEFAULT_CAPABILITIES.placeholder;
  const override = runtimeOverrides[normalized];
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Apply a runtime override, e.g. when a user supplies a higher-tier API key
 * and their provider-specific RPM limit differs from the public default.
 * Passing `undefined` clears the override for that provider.
 */
export function overrideProviderCapabilities(
  provider: ImageProvider,
  override: Partial<ProviderCapabilities> | undefined
): void {
  if (!override) {
    const next = { ...runtimeOverrides };
    delete next[provider];
    runtimeOverrides = next;
    return;
  }
  runtimeOverrides = { ...runtimeOverrides, [provider]: override };
}

export function resetProviderCapabilityOverrides(): void {
  runtimeOverrides = {};
}

/** Convenience: does this provider meaningfully consume reference images? */
export function providerConsumesRefs(provider: ImageProvider | undefined): boolean {
  const caps = getProviderCapabilities(provider);
  return caps.maxRefs > 0 && (caps.acceptsInlineRefs || caps.acceptsUrlRefs || caps.usesMidjourneyRefTokens);
}

/**
 * Convenience: is it meaningful to train (and apply) LoRAs for this provider?
 *
 * Only self-hosted Stable Diffusion today. Every other provider returns
 * `false` so the auto-training subsystem transparently no-ops when the
 * operator swaps to a hosted backend.
 */
export function providerSupportsLoraTraining(
  provider: ImageProvider | string | undefined
): boolean {
  return getProviderCapabilities(provider).supportsLoraTraining === true;
}
