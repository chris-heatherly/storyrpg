/**
 * Gated Remediation Runner
 *
 * A standalone, deterministic driver for detect -> remediate retry loops. It runs
 * a detector, and while the result is failing (and attempts/budget allow) it runs
 * a remediation step, then re-detects. On exhaustion it either degrades (advisory)
 * or, for blocking gates that were not opted out and were allowed to spend budget,
 * throws a typed {@link GatedRemediationError}.
 *
 * The module is pure: it reads no wall-clock and uses no randomness. All
 * non-determinism is delegated to the injected `detect`/`remediate`/`canSpend`
 * callbacks supplied by the caller.
 *
 * CANONICAL DRIVER (S4): this is the canonical detect->remediate driver for any
 * NEW regen-style gate (e.g. future prose/image regeneration loops). New gates
 * should route through `runGatedRemediation` and feed its `canSpend` from the
 * per-run RemediationBudget so budget/degrade/blocking semantics stay uniform.
 *
 * The existing hand-written loops in FullStoryPipeline.ts (scene regen, encounter
 * regen, regen-choices) PREDATE this module and were intentionally NOT refactored
 * onto it: their acceptance logic is stateful and bespoke (e.g. regen-choices
 * keeps trying on "improved-but-not-passed" and mutates choiceSets/validation
 * results in place), which does not map cleanly onto the simpler
 * "passed OR exhausted" contract here. Forcing that refactor carried real
 * behavioral-regression risk for no functional gain, so they remain hand-written
 * and were wired to the RemediationBudget + remediation ledger directly. Treat
 * this module as the pattern of record going forward, not a mandate to retrofit.
 */

/**
 * Thrown when a blocking gate fails after exhausting its remediation attempts
 * (and the caller did not opt out and was permitted to spend budget).
 */
export class GatedRemediationError extends Error {
  public readonly attempts: number;
  constructor(message: string, details: { attempts: number }) {
    super(message);
    this.name = 'GatedRemediationError';
    this.attempts = details.attempts;
  }
}

export interface GatedRemediationDetectResult {
  passed: boolean;
  issues?: unknown[];
}

export interface RunGatedRemediationOptions {
  /** Runs the gate check. Returns whether it passed plus any issues. */
  detect: () => Promise<GatedRemediationDetectResult> | GatedRemediationDetectResult;
  /** Applies one remediation pass. `attempt` is 1-based. */
  remediate: (attempt: number) => Promise<void> | void;
  /** Maximum number of remediation passes before giving up. */
  maxAttempts: number;
  /** Whether failure of this gate is blocking (throws) vs advisory (degrades). */
  blocking: boolean;
  /** When true, a blocking gate degrades instead of throwing. */
  optedOut?: boolean;
  /** Gate on budget; when it returns false no remediation is attempted. */
  canSpend?: () => boolean;
  /** Observability hook fired before each remediation pass (1-based). */
  onAttempt?: (attempt: number) => void;
}

export interface RunGatedRemediationResult {
  passed: boolean;
  degraded: boolean;
  blocked: boolean;
  attempts: number;
}

/**
 * Drive a detect -> remediate loop with deterministic gating semantics.
 *
 * @returns the terminal outcome. `passed` when the detector eventually passes;
 *   `degraded` when a non-blocking (or opted-out / budget-denied) gate is
 *   exhausted; `blocked` accompanies the thrown {@link GatedRemediationError}.
 */
export async function runGatedRemediation(opts: RunGatedRemediationOptions): Promise<RunGatedRemediationResult> {
  const { detect, remediate, maxAttempts, blocking, optedOut = false, canSpend, onAttempt } = opts;

  let attempts = 0;

  for (;;) {
    const result = await detect();
    if (result.passed) {
      return { passed: true, degraded: false, blocked: false, attempts };
    }

    const hasBudget = canSpend ? canSpend() : true;
    const canRetry = attempts < maxAttempts && hasBudget;
    if (!canRetry) {
      // Exhausted (or never started, when budget was denied up front).
      const budgetAllowed = hasBudget;
      if (blocking && !optedOut && budgetAllowed) {
        throw new GatedRemediationError(`Blocking remediation gate failed after ${attempts} attempt(s)`, { attempts });
      }
      return { passed: false, degraded: true, blocked: false, attempts };
    }

    attempts += 1;
    onAttempt?.(attempts);
    await remediate(attempts);
  }
}
