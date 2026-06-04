// ========================================
// REMEDIATION BUDGET
// ========================================
//
// A per-run cap on the number of "remediation" calls a pipeline run may spend.
// Remediation means any corrective re-work that costs an extra LLM call:
// scene/choice regeneration, validator-driven repair passes, etc. Without a cap
// a pathological run can loop on repairs and burn unbounded tokens/time.
//
// Usage contract:
//   - One RemediationBudget is created per pipeline run (`total` calls allowed).
//   - Before kicking off a remediation, callers check `canSpend(n)`.
//   - When `canSpend()` returns false the budget is exhausted and callers are
//     expected to DEGRADE GRACEFULLY — accept the current (imperfect) output
//     instead of attempting another repair — rather than block or throw.
//   - On a successful remediation, callers `spend(n)` to debit the budget.
//
// The budget is pure data + pure transforms: no I/O, no wall-clock, no
// randomness, fully deterministic. Buckets/pipeline wiring lives elsewhere.

export class RemediationBudget {
  private readonly total: number;
  private used = 0;

  /**
   * @param total Maximum number of remediation (regen / LLM-repair) calls
   *   allowed for the whole run. Negative inputs are clamped to 0.
   */
  constructor(total: number) {
    this.total = Math.max(0, total);
  }

  /**
   * Debit the budget by `n` calls (default 1). The running total never exceeds
   * `total`, so spending past the cap is a no-op once exhausted. Non-positive
   * `n` is ignored.
   */
  spend(n = 1): void {
    if (n <= 0) {
      return;
    }
    this.used = Math.min(this.total, this.used + n);
  }

  /** Number of remediation calls already spent this run. */
  spent(): number {
    return this.used;
  }

  /** Remaining remediation calls; never negative. */
  remaining(): number {
    return Math.max(0, this.total - this.used);
  }

  /**
   * Whether `n` more remediation calls (default 1) can still be afforded. When
   * this returns false, callers should degrade gracefully (see file header).
   */
  canSpend(n = 1): boolean {
    return this.remaining() >= n;
  }
}

/**
 * Factory mirroring the per-run construction pattern. Defaults to 12 allowed
 * remediation calls per run when no explicit total is supplied.
 */
export function createRemediationBudget(total = 12): RemediationBudget {
  return new RemediationBudget(total);
}

/**
 * Budget-aware guard for a regeneration loop's entry/continuation. Returns true
 * when another remediation attempt should be made. A `null`/`undefined` budget
 * means "unbudgeted" (always allow) so call sites can wire the guard before a
 * budget is provisioned without changing behavior. Pure + null-safe so the
 * monolith's loop guards can be unit-tested without the loops themselves.
 */
export function shouldAttemptRemediation(budget: RemediationBudget | null | undefined, n = 1): boolean {
  return !budget || budget.canSpend(n);
}
