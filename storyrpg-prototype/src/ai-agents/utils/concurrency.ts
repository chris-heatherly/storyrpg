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

