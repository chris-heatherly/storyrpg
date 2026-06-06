/**
 * Episode-time charge-materialization gate (Plan Part 9 + Part 10 Phase 6),
 * gated by `consequenceFlags().materializationGate` (`GATE_CHARGE_MATERIALIZATION`).
 *
 * This is the thin wiring around {@link ChargeMaterializationValidator} that the
 * episode pipeline calls after `ChoiceAuthor` has authored the actual
 * {@link Consequence}[] for an episode. It keeps the big pipeline files (the
 * monolith ratchet — `FullStoryPipeline.ts`) from growing and keeps the gate
 * decision in ONE place, mirroring the `GATE_SEASON_BUDGETS` pattern in
 * `SeasonPlannerAgent`:
 *
 *   - ALWAYS runs the validator advisory — findings are returned for the
 *     diagnostics trail (the caller pushes them into the episode's warnings).
 *   - ONLY when `GATE_CHARGE_MATERIALIZATION='1'` do error-severity findings
 *     (hollow branches) BLOCK: the helper throws so the caller's retry/repair
 *     pipeline kicks in. With the flag unset, the same findings are advisory and
 *     behavior is byte-identical to before this phase.
 *
 * The annotated ledger (edges carrying `materialized`) is returned so the caller
 * can persist it for cross-run diagnostics.
 *
 * Pure / deterministic apart from reading the env flag (the gate decision) — the
 * validation itself is a pure function of (plan, ledger, episode, consequences).
 */

import {
  ChargeMaterializationValidator,
  type ChargeMaterializationContext,
  type ChargeMaterializationResult,
} from '../validators/ChargeMaterializationValidator';
import type { ConvergenceLedger } from '../../types/convergenceLedger';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { consequenceFlags } from './consequenceFlags';

/** Outcome of the gate: the advisory result plus whether the gate is hard. */
export interface ChargeMaterializationGateOutcome {
  /** The full validator result, including the annotated ledger. */
  result: ChargeMaterializationResult;
  /** True iff `GATE_CHARGE_MATERIALIZATION='1'` (the gate is blocking). */
  blocking: boolean;
}

/**
 * Run the charge-materialization check for one episode. Returns the validator
 * result (annotated ledger included) and the gate mode. When the gate is on and
 * there are hollow-branch errors, this THROWS — the caller's repair loop should
 * regenerate the offending heavy tiers (or demote them).
 *
 * Always-advisory contract: the result is returned regardless of the flag, so the
 * caller can record findings into the diagnostics trail even when not gating.
 */
export function runChargeMaterializationGate(
  plan: SeasonScenePlan,
  ledger: ConvergenceLedger,
  ctx: ChargeMaterializationContext,
): ChargeMaterializationGateOutcome {
  const result = new ChargeMaterializationValidator().validate(plan, ledger, ctx);
  const blocking = consequenceFlags().materializationGate;

  if (blocking) {
    const errors = result.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      throw new Error(
        `[ChargeMaterializationGate] Episode ${ctx.episodeNumber} has ${errors.length} hollow branch(es) — promised heavy-tier charge did not materialize: ` +
          errors.map((i) => i.message).join('; ') +
          '. Unset GATE_CHARGE_MATERIALIZATION to downgrade to advisory.',
      );
    }
  }

  return { result, blocking };
}
