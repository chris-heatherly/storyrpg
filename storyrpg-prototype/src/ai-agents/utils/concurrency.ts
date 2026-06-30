/**
 * Lightweight local concurrency primitives for pipeline orchestration.
 */

export type ReleaseFn = () => void;

export class AsyncSemaphore {
  private readonly maxPermits: number;
  private permitsInUse = 0;
  private waiters: Array<(release: ReleaseFn) => void> = [];

  constructor(maxPermits: number) {
    this.maxPermits = Math.max(1, Math.floor(maxPermits));
  }

  async acquire(): Promise<ReleaseFn> {
    if (this.permitsInUse < this.maxPermits) {
      this.permitsInUse++;
      return this.createRelease();
    }

    return new Promise<ReleaseFn>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  get inUse(): number {
    return this.permitsInUse;
  }

  get capacity(): number {
    return this.maxPermits;
  }

  private createRelease(): ReleaseFn {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(this.createRelease());
        return;
      }

      this.permitsInUse = Math.max(0, this.permitsInUse - 1);
    };
  }
}

export interface MapWithConcurrencyOptions {
  concurrency: number;
  continueOnError?: boolean;
}

export interface MapWithConcurrencyResult<T> {
  values: T[];
  errors: Array<{ index: number; error: Error }>;
}

/**
 * Ordered bounded-concurrency map helper.
 */
export async function mapWithConcurrency<I, O>(
  items: I[],
  mapper: (item: I, index: number) => Promise<O>,
  options: MapWithConcurrencyOptions
): Promise<MapWithConcurrencyResult<O>> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const values = new Array<O>(items.length);
  const errors: Array<{ index: number; error: Error }> = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const current = nextIndex;
      nextIndex++;
      if (current >= items.length) return;

      try {
        values[current] = await mapper(items[current], current);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({ index: current, error });
        if (!options.continueOnError) {
          throw error;
        }
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  return {
    values: values.filter((v) => v !== undefined),
    errors,
  };
}

/**
 * Ordered, fail-fast bounded-concurrency map that resolves to a plain `R[]`.
 *
 * This is the shared replacement for the per-agent `mapWithConcurrency<T,R>`
 * copies that have grown up inside individual agents (e.g. EncounterArchitect's
 * Phase 2 branch fan-out and SourceMaterialAnalyzer's per-episode breakdown).
 * Unlike {@link mapWithConcurrency} above — which collects errors and returns a
 * `{ values, errors }` envelope — this variant preserves input order and
 * rejects on the first rejected `fn` call, matching the simpler fail-fast
 * contract those agents rely on.
 *
 * A worker pool of size `min(limit, items.length)` pulls indices off a shared
 * cursor, so one slow call only blocks its own slot while the other workers
 * keep draining the queue. When an AbortSignal is threaded through `fn` (the
 * agents fall back to BaseAgent.activeAbortSignal), an abort surfaces as that
 * rejection.
 */
export async function mapOrderedWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const poolSize = Math.min(Math.max(1, limit), items.length);
  const workers = new Array(poolSize).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export class LocalWorkerQueue {
  private readonly semaphore: AsyncSemaphore;

  constructor(concurrency: number) {
    this.semaphore = new AsyncSemaphore(concurrency);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.semaphore.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }
}

