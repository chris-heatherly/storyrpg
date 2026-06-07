/**
 * Reusable bounded "regenerate-until-it-validates" runner (Gen-4 Phase 1 / P0).
 *
 * Several remediation paths share the same shape: re-author a unit (a scene, an
 * encounter's outcome prose) with a fix instruction, re-validate it, and either
 * accept the clean candidate or, after a bounded number of attempts, DEGRADE
 * gracefully (keep the best-so-far, never hard-abort). That shape was previously
 * open-coded inside FullStoryPipeline's per-scene "KARPATHY loop"; this extracts
 * it into one budget-aware, fully unit-testable helper so the new backstops
 * (W4 outcome-variant, W6 continuity, W1 ambiguous-pronoun) don't each reinvent
 * the loop.
 *
 * It is deliberately I/O-free: the caller supplies `attempt` (which may call an
 * LLM agent) and `validate` (which re-runs the relevant detector). The runner
 * only owns the loop, the budget accounting, and the accept/degrade decision —
 * so it can be tested with synchronous fakes and no model.
 */

import { shouldAttemptRemediation, type RemediationBudget } from '../remediation/RemediationBudget';

export interface RegenValidation {
  /** True when the candidate passes — the loop accepts and stops. */
  ok: boolean;
  /** Human-readable issues to feed back into the NEXT attempt's fix instruction. */
  issues: string[];
}

export interface RegenAttemptContext {
  /** 1-based attempt number. */
  attempt: number;
  maxAttempts: number;
  /** Issues from the previous validation (empty on the first attempt). */
  priorIssues: string[];
}

export interface RegenEvent {
  type: 'regeneration_triggered' | 'regeneration_accepted' | 'regeneration_degraded';
  label: string;
  attempt: number;
  maxAttempts: number;
  issues: string[];
}

export interface RegenRunParams<T> {
  /** Label for telemetry (e.g. `scene:s3-5/outcome-variant`). */
  label: string;
  /** Max regeneration attempts before degrading. Clamped to >= 0. */
  maxAttempts: number;
  /** Per-run remediation budget; null/undefined ⇒ unbudgeted. */
  budget?: RemediationBudget | null;
  /** Produce a fresh candidate. May call an LLM agent. */
  attempt: (ctx: RegenAttemptContext) => Promise<T>;
  /** Re-validate a candidate. */
  validate: (candidate: T) => RegenValidation | Promise<RegenValidation>;
  /** Optional sink for progress events (wire to pipeline `emit`). */
  onEvent?: (event: RegenEvent) => void;
}

export interface RegenRunResult<T> {
  /** The accepted candidate, or the best (last) candidate when degraded. Undefined if no attempt ran. */
  value: T | undefined;
  accepted: boolean;
  degraded: boolean;
  attempts: number;
  /** Outstanding issues on the returned candidate (empty iff accepted). */
  finalIssues: string[];
}

/**
 * Run `attempt`/`validate` up to `maxAttempts` times, debiting one budget unit per
 * attempt. Returns the first candidate that validates (`accepted: true`), or the
 * last candidate produced once attempts/budget are exhausted (`degraded: true`).
 * Never throws on a validation failure — degradation is the contract. (An error
 * thrown by `attempt`/`validate` itself still propagates to the caller.)
 */
export async function regenUntilClean<T>(params: RegenRunParams<T>): Promise<RegenRunResult<T>> {
  const maxAttempts = Math.max(0, Math.floor(params.maxAttempts));
  let value: T | undefined;
  let priorIssues: string[] = [];
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    if (!shouldAttemptRemediation(params.budget)) {
      // Budget exhausted mid-loop — degrade with whatever we have.
      break;
    }
    const attempt = i + 1;
    params.onEvent?.({ type: 'regeneration_triggered', label: params.label, attempt, maxAttempts, issues: priorIssues });
    params.budget?.spend(1);
    attempts = attempt;

    value = await params.attempt({ attempt, maxAttempts, priorIssues });
    const verdict = await params.validate(value);
    if (verdict.ok) {
      params.onEvent?.({ type: 'regeneration_accepted', label: params.label, attempt, maxAttempts, issues: [] });
      return { value, accepted: true, degraded: false, attempts, finalIssues: [] };
    }
    priorIssues = verdict.issues;
  }

  const degraded = attempts > 0;
  if (degraded) {
    params.onEvent?.({ type: 'regeneration_degraded', label: params.label, attempt: attempts, maxAttempts, issues: priorIssues });
  }
  return { value, accepted: false, degraded, attempts, finalIssues: priorIssues };
}
