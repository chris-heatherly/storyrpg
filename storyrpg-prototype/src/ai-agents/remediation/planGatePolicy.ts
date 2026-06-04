// ========================================
// PLAN GATE POLICY (Bucket D)
// ========================================
//
// Bucket D of the validator-gating plan lets the plan-time / season-planning
// craft validators HARD-BLOCK on error-severity findings instead of staying
// advisory — but ONLY when a per-rule env flag is set. This is the opt-in (B0)
// convention: default-off, gate only when the flag is explicitly enabled.
//
// Unlike the SevenPoint season gate (inverted opt-out, default ON), the Bucket D
// rules are still being validated against multi-episode regens, so they default
// OFF and roll out one flag at a time.
//
// Pure by construction: the env lookup is INJECTED via `isEnabled`, so there is
// no wall-clock, no randomness, and no direct `process.env` read here. The
// default-off guarantee lives at the call site (pass a lookup that returns false
// and `gate` is always false → behavior unchanged).

/**
 * The four plan-time craft rules eligible for Bucket D gating, mapping each rule
 * to its per-rule rollout env flag.
 */
export const PLAN_GATE_FLAGS = {
  setupPayoff: 'GATE_SETUP_PAYOFF',
  callbackCoverage: 'GATE_CALLBACK_COVERAGE',
  choiceDistribution: 'GATE_CHOICE_DISTRIBUTION',
  arcPressure: 'GATE_ARC_PRESSURE',
  // ConsequenceBudgetValidator strict mode: promotes extreme-deviation budget
  // warnings to errors (which hard-block downstream). Default-off; the seam
  // lives in the validator itself, see ConsequenceBudgetValidator.validate.
  consequenceBudget: 'GATE_CONSEQUENCE_BUDGET',
  // ChoiceDensityValidator strict mode: promotes structural (D4) + timing-cap
  // density violations from warning to error so the all-scenes seam gate can
  // hard-block on them. Default-off; the seam lives in FullStoryPipeline.
  choiceDensity: 'GATE_CHOICE_DENSITY',
  // PropIntroductionValidator episode-level gate (PARTIAL — cast-reference
  // subset; see propIntroductionGate.ts SCOPE NOTE). Hard-blocks on
  // error-severity unresolved references at the all-scenes seam. Default-off.
  propIntroduction: 'GATE_PROP_INTRODUCTION',
} as const;

/**
 * Decide whether a plan-time validator's findings should hard-block.
 *
 * Returns `gate: true` only when BOTH the rule's flag is enabled (per the
 * injected `isEnabled`) AND at least one finding has `severity === 'error'`.
 * `blockingCount` is the number of error-severity findings regardless of the
 * flag state. With the flag disabled, `gate` is always false (default-off).
 */
export function shouldGate(
  flag: string,
  issues: Array<{ severity: string }>,
  isEnabled: (flag: string) => boolean,
): { gate: boolean; blockingCount: number } {
  const blockingCount = issues.reduce(
    (count, issue) => (issue.severity === 'error' ? count + 1 : count),
    0,
  );
  const gate = isEnabled(flag) && blockingCount > 0;
  return { gate, blockingCount };
}
