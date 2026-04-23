/**
 * Per-provider capability table.
 *
 * Centralizes what each image provider CAN consume at the transport layer
 * (max refs, inline vs URL, seed support, concurrency) so upstream code
 * (reference pack builder, pre-upload logic, batch router, rate limiter)
 * can make uniform decisions without scattered `if (provider === ...)`
 * checks. Adding a new provider means adding one row here.
 *
 * Relationship to `referenceStrategy.ts`:
 *   - `providerCapabilities` = facts about the API (what it accepts)
 *   - `referenceStrategy`    = opinions about content (what's worth sending)
 *
 * For example, gpt-image-2's capability row declares maxRefs: 16 (the API
 * limit), but the strategy row caps scene refs at 2 (empirical best
 * practice — more refs dilute identity signal). The two tables are kept
 * separate so transport facts don't drift into policy tuning.
 *
 * Per-provider reference strategy summary (see referenceStrategy.ts for details):
 *   - nano-banana / atlas-cloud: full three-view pack + composite style anchor + expressions
 *   - dall-e (gpt-image-2):     front view only; one clean identity ref, no composite/expressions
 *   - midapi (Midjourney):      composite (--cref) + style anchor (--sref); 2 refs total
 *   - stable-diffusion:         three-view pack routed via ControlNet/IP-Adapter
 *   - placeholder:              nothing
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
    // Atlas routes multiple model families. Keep this at the highest practical
    // cap so provider-level filtering doesn't choke newer models (e.g.
    // openai/gpt-image-2 supports larger multi-ref edit packs).
    maxRefs: 16,
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
    // Midjourney honors `--seed` for reproducible variations. Generations are
    // not bit-identical across runs, but the seed reliably produces the same
    // family of outputs — useful for deterministic re-rolls and variation
    // sets, which is what this capability flag is consumed for upstream.
    supportsSeed: true,
    supportsNegativePrompt: true,
    usesMidjourneyRefTokens: true,
    minRequestIntervalMs: 3000,
    concurrency: 2,
    rpmCeiling: 20,
    supportsLoraTraining: false,
  },
  // `useapi` is a legacy alias for `midapi` — both route to the same Midjourney
  // backend via useapi.net. Historically kept as a duplicated row; now that
  // `normalizeProvider()` aliases useapi → midapi at construction, the alias
  // is preserved here only for structural consumers that key off the union.
  // `getProviderCapabilities()` redirects useapi → midapi below so the two
  // can never drift apart.
  useapi: {
    id: 'useapi',
    maxRefs: 2,
    acceptsInlineRefs: false,
    acceptsUrlRefs: true,
    supportsBatch: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    usesMidjourneyRefTokens: true,
    minRequestIntervalMs: 3000,
    concurrency: 2,
    rpmCeiling: 20,
    supportsLoraTraining: false,
  },
  'dall-e': {
    id: 'dall-e',
    maxRefs: 16,
    acceptsInlineRefs: true,
    acceptsUrlRefs: true,
    supportsBatch: false,
    supportsSeed: false,
    supportsNegativePrompt: true,
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
 * Canonicalize legacy / alias provider ids before lookup. `useapi` is the
 * legacy name for what is now `midapi` — both go to the same backend, so
 * we point them at the same capability row (and the same override slot)
 * instead of letting two entries drift out of sync.
 */
function canonicalProviderId(provider: ImageProvider | string | undefined): ImageProvider {
  const p = (provider as ImageProvider) || 'placeholder';
  if (p === 'useapi') return 'midapi';
  return p;
}

/**
 * Returns the effective capability row for a provider, merging runtime
 * overrides on top of the static default. Unknown providers fall back to
 * `placeholder` shape so callers always get a deterministic answer.
 */
export function getProviderCapabilities(provider: ImageProvider | string | undefined): ProviderCapabilities {
  const normalized = canonicalProviderId(provider);
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
  const key = canonicalProviderId(provider);
  if (!override) {
    const next = { ...runtimeOverrides };
    delete next[key];
    runtimeOverrides = next;
    return;
  }
  runtimeOverrides = { ...runtimeOverrides, [key]: override };
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
