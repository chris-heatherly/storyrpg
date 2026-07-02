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

/**
 * Like `withTimeout`, but the wrapped work receives an `AbortSignal` that is
 * aborted when the timeout fires — so it can actually STOP (cancel the in-flight
 * fetch and halt its retry loop) instead of being abandoned to run/retry in the
 * background (wasting tokens, stranding the worker). `callLLM` honors the signal.
 *
 * Usage: withTimeoutAbort((signal) => agent.execute(input, { signal }), ms, label)
 */
export function withTimeoutAbort<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Abort the underlying work first (cancels fetch + stops retries), then
      // reject so the caller sees a TimeoutError.
      controller.abort(new TimeoutError(label, ms));
      reject(new TimeoutError(label, ms));
    }, ms);
  });
  return Promise.race([fn(controller.signal), timeout]).finally(() => clearTimeout(timer!));
}

export const PIPELINE_TIMEOUTS = {
  // Single heavy LLM agent call (WorldBuilder, CharacterDesigner, SceneWriter,
  // ChoiceAuthor, BranchManager, …). Raised 10→15 min: once the process-wide
  // undici headersTimeout was lifted (now 22 min — resilientHttp.ts), the binding
  // limit on a large non-streaming generation became THIS wrapper. A 10-episode
  // treatment's per-call outputs legitimately exceed 10 min, so they were dying
  // here as "timed out after 600s". Stays below the 22-min transport ceiling;
  // buffered provider calls additionally carry their own 5/15-min client abort
  // (BaseAgent.clientTimeoutSignal).
  llmAgent: 15 * 60_000,
  // Source analysis runs MULTIPLE sequential LLM calls (plot points, episode
  // breakdown, ...), so it needs more than the single-call llmAgent budget — one
  // transient network retry on a large source otherwise blows past 10 min
  // mid-analysis. The worker stays alive via heartbeats and per-call timeouts
  // bound each call; this is just the overall backstop.
  sourceAnalysis: 25 * 60_000,
  // StoryArchitect builds an entire episode scene-graph (scenes, choice points,
  // branches, bottlenecks) in one call — the heaviest single-episode planner.
  // Dedicated budget above llmAgent so a large blueprint isn't killed mid-
  // generation (the "StoryArchitect.execute timed out after 600s" failure).
  storyArchitect: 20 * 60_000,
  // EncounterArchitect.execute runs a MULTI-PHASE flow, so this outer budget must
  // exceed the SUM of its internal phase timeouts, not a single call. The flow is
  // phase 1 SEQUENTIAL (180s) → then phases 2/3/4 in parallel, where phase 2 fans
  // out one call per opening-beat choice at concurrency 2. With the enforced
  // minimum of 3 choices that's 2 sequential waves × 240s = 480s. So a clean run
  // is already 180 + 480 = 660s — over the old 10-min cap — and one phase retry or
  // a slower adaptive-thinking model pushes it higher. (The old 10-min budget was
  // sized for the original 120s/90s phase timeouts that summed to ~420s; raising
  // the phase timeouts to 180/240 without raising this cap is what made every
  // 3-choice encounter time out at "600s".) A genuine hang is still caught per
  // phase by each runPhaseWithRetry's own abort, so this only bounds the overall
  // orchestration.
  //
  // 25 min: the WORST case (every attempt of every phase times out) is
  // phase1 2×180s + max-parallel-lane(phase2: ceil(4 choices/concurrency 2)=2
  // waves × 2 attempts × 240s = 960s) ≈ 1,323s incl. backoffs — the previous
  // 20-min cap sat BELOW that, recreating the same class of bug for the
  // all-retries-slow case. EncounterArchitect.worstCasePhaseBudgetMs() computes
  // this from the live constants and a unit test asserts it fits under this cap.
  encounterAgent: 25 * 60_000,
  imageGeneration: 3 * 60_000,
  storyboard: 15 * 60_000,
  validateAndRegenerate: 5 * 60_000,
  finalContractRepair: 20 * 60_000,
  colorScript: 3 * 60_000,
  outputWriter: 2 * 60_000,
} as const;
