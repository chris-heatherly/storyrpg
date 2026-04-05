import { ImageGenerationService } from '../services/imageGenerationService';

/**
 * Global backoff / optional Atlas-first window for encounter image slots.
 * Replaces per-slot circuit breaking: transient API issues should back off, not abort mid-tree.
 */

export interface EncounterProviderPolicyConfig {
  /** After this many consecutive transient-ish failures, add extra delay before next slot (capped). */
  backoffBaseMs?: number;
  /** Cap for exponential backoff (default 30s). */
  backoffMaxMs?: number;
  /** After this many consecutive Gemini failures, prefer Atlas for subsequent encounter slots (if Atlas key exists). 0 = never. */
  atlasWindowAfterConsecutiveFailures?: number;
  /** How many encounter slots to try Atlas-first after the threshold. */
  atlasWindowSlotBudget?: number;
  /**
   * Hard abort after this many consecutive failures (any kind). 0 = disabled (only completeness gate fails the run).
   */
  maxConsecutiveFailuresBeforeAbort?: number;
}

const defaultConfig: Required<EncounterProviderPolicyConfig> = {
  backoffBaseMs: 1200,
  backoffMaxMs: 30_000,
  atlasWindowAfterConsecutiveFailures: 4,
  atlasWindowSlotBudget: 8,
  maxConsecutiveFailuresBeforeAbort: 0,
};

export class EncounterProviderPolicy {
  private consecutiveFailures = 0;
  private atlasWindowRemaining = 0;
  private readonly cfg: Required<EncounterProviderPolicyConfig>;

  constructor(
    private readonly imageService: ImageGenerationService,
    cfg?: EncounterProviderPolicyConfig
  ) {
    this.cfg = { ...defaultConfig, ...cfg };
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.atlasWindowRemaining = 0;
  }

  onSlotSuccess(): void {
    this.consecutiveFailures = 0;
  }

  onSlotFailure(_err: unknown): void {
    this.consecutiveFailures += 1;
    const thr = this.cfg.atlasWindowAfterConsecutiveFailures;
    if (thr > 0 && this.consecutiveFailures >= thr && this.imageService.hasAtlasCloudConfigured()) {
      this.atlasWindowRemaining = Math.max(this.atlasWindowRemaining, this.cfg.atlasWindowSlotBudget);
    }
  }

  shouldAbortHard(): boolean {
    const cap = this.cfg.maxConsecutiveFailuresBeforeAbort;
    return cap > 0 && this.consecutiveFailures >= cap;
  }

  /**
   * Extra delay before starting the next slot (after a failure).
   */
  getBackoffDelayMs(): number {
    if (this.consecutiveFailures <= 0) return 0;
    const exp = Math.min(this.consecutiveFailures, 8);
    const raw = this.cfg.backoffBaseMs * Math.pow(2, Math.max(0, exp - 1));
    const jitter = Math.floor(Math.random() * 400);
    return Math.min(this.cfg.backoffMaxMs, Math.floor(raw) + jitter);
  }

  /**
   * When true, encounter image generation should try Atlas before Gemini for this slot.
   */
  consumePreferAtlasFirst(): boolean {
    if (this.atlasWindowRemaining <= 0) return false;
    this.atlasWindowRemaining -= 1;
    return true;
  }
}
