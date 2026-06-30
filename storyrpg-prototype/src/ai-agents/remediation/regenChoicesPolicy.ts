// ========================================
// REGEN-CHOICES POLICY (Bucket B1 core)
// ========================================
//
// B1 of the validator-gating plan adds a per-scene "regen-choices" Karpathy loop
// to FullStoryPipeline: when the incremental scene validator asks for a choice-set
// regeneration, re-invoke ChoiceAuthor with the stakes issues and accept the
// rewrite on improvement (mirroring the existing scene/encounter regen loops).
//
// This module is the PURE policy core for that loop. It owns two decisions —
// "should we run the loop?" and "is the rewrite an improvement?" — with zero
// I/O, no wall-clock, and no direct `process.env` read (the env lookup is
// INJECTED via `isEnabled`). That keeps the logic out of the (type-unchecked)
// FullStoryPipeline monolith and makes it deterministically testable.
//
// DEFAULT-OFF GUARANTEE: `shouldRegenChoices` returns false unless
// `GATE_REGEN_CHOICES` is set, so with the flag unset the loop never runs and
// there is zero behavior change.

/** Rollout flag gating the per-scene regen-choices loop. Default-off. */
export const REGEN_CHOICES_FLAG = 'GATE_REGEN_CHOICES';

/**
 * Decide whether the per-scene regen-choices loop should run.
 *
 * True iff ALL of:
 *   1. the scene validator requested a choice-set regeneration
 *      (`regenerationRequested === 'choices'`),
 *   2. incremental stakes validation is enabled (the signal source), and
 *   3. the `GATE_REGEN_CHOICES` rollout flag is enabled.
 *
 * The env lookup is injected via `isEnabled` so this stays pure. With the flag
 * unset, this always returns false (default-off).
 */
export function shouldRegenChoices(
  regenerationRequested: string,
  stakesValidationEnabled: boolean,
  isEnabled: (flag: string) => boolean,
): boolean {
  return (
    regenerationRequested === 'choices' &&
    stakesValidationEnabled &&
    isEnabled(REGEN_CHOICES_FLAG)
  );
}

/**
 * Accept-on-improvement check for a regenerated choice set, mirroring the
 * encounter loop: a rewrite is accepted when it passes outright OR when it
 * reduces the validator issue count relative to the previous attempt.
 */
export function isChoiceRegenImprovement(
  prevIssueCount: number,
  nextIssueCount: number,
  nextPassed: boolean,
): boolean {
  return nextPassed || nextIssueCount < prevIssueCount;
}
