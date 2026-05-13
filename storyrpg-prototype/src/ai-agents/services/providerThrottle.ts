/**
 * Per-provider rate-limiter + concurrency gate + inflight deduplicator.
 *
 * Replaces the previous single-instance `lastRequestTime` + `_concurrencyLimit`
 * pair in `ImageGenerationService`, which serialized every provider through
 * one global throttle. With this helper:
 *
 * - Each provider has its own `minIntervalMs` and semaphore. Midjourney's slow
 *   limits no longer penalize Gemini.
 * - Concurrent requests compose: a caller `await`s the gate and then runs,
 *   releasing on completion. The helper is a thin facade over `AsyncSemaphore`.
 * - Inflight dedup: callers can supply a stable `dedupKey`. If another call
 *   with the same key is already in flight, the second call awaits the first's
 *   result instead of hitting the provider twice.
 *
 * The helper is intentionally framework-free (no direct dependency on the
 * image service) so unit tests can exercise it in isolation.
 */

import { AsyncSemaphore, type ReleaseFn } from '../utils/concurrency';
import { getProviderCapabilities } from '../images/providerCapabilities';
import type { ImageProvider } from '../config';

interface ProviderGate {
  semaphore: AsyncSemaphore;
  minIntervalMs: number;
  lastRequestAt: number;
  /** Serializes the "wait for interval then stamp now" block per-provider. */
  pacerChain: Promise<void>;
}

export interface ThrottleRunOptions {
  /**
   * Stable key used for inflight dedup. Two concurrent calls with the same
   * dedupKey share a single provider round-trip. Leave undefined to skip.
   */
  dedupKey?: string;
}

export class ProviderThrottle {
  private readonly gates = new Map<ImageProvider, ProviderGate>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  private getGate(provider: ImageProvider): ProviderGate {
    let gate = this.gates.get(provider);
    if (!gate) {
      const caps = getProviderCapabilities(provider);
      gate = {
        semaphore: new AsyncSemaphore(caps.concurrency),
        minIntervalMs: caps.minRequestIntervalMs,
        lastRequestAt: 0,
        pacerChain: Promise.resolve(),
      };
      this.gates.set(provider, gate);
    }
    return gate;
  }

  /**
   * Run `task` against `provider` respecting the provider's concurrency cap
   * and min-request interval. The interval is enforced with a serial chain
   * per-provider so concurrent callers fairly share the gap.
   */
  async run<T>(
    provider: ImageProvider,
    task: () => Promise<T>,
    options: ThrottleRunOptions = {}
  ): Promise<T> {
    const { dedupKey } = options;

    if (dedupKey) {
      const existing = this.inflight.get(dedupKey) as Promise<T> | undefined;
      if (existing) return existing;
    }

    const wrapped = this.runThrottled(provider, task);

    if (dedupKey) {
      this.inflight.set(dedupKey, wrapped);
      wrapped.finally(() => {
        if (this.inflight.get(dedupKey) === (wrapped as Promise<unknown>)) {
          this.inflight.delete(dedupKey);
        }
      });
    }

    return wrapped;
  }

  private async runThrottled<T>(provider: ImageProvider, task: () => Promise<T>): Promise<T> {
    const gate = this.getGate(provider);
    const release: ReleaseFn = await gate.semaphore.acquire();
    try {
      await this.waitForInterval(gate);
      return await task();
    } finally {
      release();
    }
  }

  /**
   * Acquire a concurrency slot without also waiting for the pacing interval.
   * Caller must invoke the returned `release` function when done.
   *
   * Useful when the HTTP call needs to happen inside a larger bookkeeping
   * block (prompt save, job events) but we still want the call itself to
   * be throttled.
   */
  async acquire(provider: ImageProvider): Promise<ReleaseFn> {
    const gate = this.getGate(provider);
    return gate.semaphore.acquire();
  }

  /**
   * Wait until the next request against `provider` is allowed by its
   * min-interval. Safe to call outside of `acquire` (e.g. a retry loop that
   * re-paces without releasing the slot).
   */
  async waitForPacing(provider: ImageProvider): Promise<void> {
    const gate = this.getGate(provider);
    await this.waitForInterval(gate);
  }

  private async waitForInterval(gate: ProviderGate): Promise<void> {
    if (gate.minIntervalMs <= 0) return;
    const prev = gate.pacerChain;
    let resolveNext!: () => void;
    gate.pacerChain = new Promise<void>((res) => {
      resolveNext = res;
    });
    try {
      await prev;
      const now = Date.now();
      const elapsed = now - gate.lastRequestAt;
      if (elapsed < gate.minIntervalMs) {
        await delay(gate.minIntervalMs - elapsed);
      }
      gate.lastRequestAt = Date.now();
    } finally {
      resolveNext();
    }
  }

  /**
   * Override capability (interval or concurrency) for a provider at runtime.
   * Usually unnecessary; getProviderCapabilities is the source of truth.
   */
  updateProvider(provider: ImageProvider, update: { minIntervalMs?: number; concurrency?: number }): void {
    const gate = this.getGate(provider);
    if (typeof update.minIntervalMs === 'number') {
      gate.minIntervalMs = Math.max(0, update.minIntervalMs);
    }
    if (typeof update.concurrency === 'number' && update.concurrency > 0) {
      // AsyncSemaphore is immutable; swap with a new one. In-flight tasks
      // retain their original semaphore until they release, which is fine
      // because only new acquirers see the updated capacity.
      gate.semaphore = new AsyncSemaphore(update.concurrency);
    }
  }

  /** Stats for observability / tests. */
  getStats(provider: ImageProvider): { inUse: number; capacity: number; minIntervalMs: number } | null {
    const gate = this.gates.get(provider);
    if (!gate) return null;
    return {
      inUse: gate.semaphore.inUse,
      capacity: gate.semaphore.capacity,
      minIntervalMs: gate.minIntervalMs,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
