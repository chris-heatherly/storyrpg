export class TimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly label: string;

  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
    this.label = label;
    this.timeoutMs = ms;
  }
}

/**
 * Race a promise against a timeout. If the promise doesn't settle within `ms`
 * milliseconds, the returned promise rejects with a `TimeoutError`.
 *
 * The underlying promise is NOT cancelled — Node has no native cancellation for
 * arbitrary promises. The caller's catch handler should decide whether to retry,
 * skip, or propagate. The timer is always cleaned up to avoid leaks.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new TimeoutError(label, ms));
      }
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

export const PIPELINE_TIMEOUTS = {
  llmAgent: 5 * 60_000,
  encounterAgent: 10 * 60_000,
  imageGeneration: 3 * 60_000,
  storyboard: 15 * 60_000,
  validateAndRegenerate: 5 * 60_000,
  colorScript: 3 * 60_000,
  outputWriter: 2 * 60_000,
} as const;
