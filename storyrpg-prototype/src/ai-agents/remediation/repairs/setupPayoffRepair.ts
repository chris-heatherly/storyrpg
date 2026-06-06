/**
 * Setup/payoff dangling-thread repair (plan-time, deterministic).
 *
 * SetupPayoffValidator flags a thread as "dangling" (error severity for `major`
 * threads) when it is planted, not yet paid off, and PAST its
 * `expectedPaidOffByEpisode`. The validator's own remedy is: "Add a payoff beat,
 * OR revise expectedPaidOffByEpisode." Adding a payoff beat is content (LLM work);
 * revising the window is a safe, deterministic, content-agnostic metadata fix.
 *
 * This repair takes the second path for threads that STILL HAVE RUNWAY — i.e. the
 * payoff was merely scheduled too early but the season has later episodes in which
 * it can legitimately land. It defers `expectedPaidOffByEpisode` to the season
 * finale (`totalEpisodes`). It NEVER fabricates a plant/payoff, never drops a
 * thread, and never touches a thread with no runway left (currentEpisode at/after
 * the finale) — those are genuine dangling threads that need a real payoff (LLM /
 * author), so they correctly remain failing.
 *
 * Pure: no LLM, no wall-clock, no randomness — same input always yields the same
 * fix. Mutates the passed threads in place (mirrors the autofix-repair convention)
 * and returns a count + ledger records.
 */

import type { NarrativeThread } from '../../../types';
import type { RemediationLedgerRecord } from '../remediationLedger';

const RULE_NAME = 'setup_payoff_window';

export interface SetupPayoffRepairContext {
  /** Episode currently being sealed. */
  currentEpisode: number;
  /** Total episodes in the season (the latest episode a payoff can still land in). */
  totalEpisodes: number;
}

/**
 * Defer the payoff window of dangling-but-still-has-runway threads to the finale.
 *
 * @returns how many threads were re-scheduled, plus ledger records for each.
 */
export function repairSetupPayoff(
  threads: NarrativeThread[],
  ctx: SetupPayoffRepairContext,
): { fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> } {
  let fixedCount = 0;
  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];

  for (const thread of threads) {
    const hasPlant = (thread.plants?.length ?? 0) > 0;
    const hasPayoff = (thread.payoffs?.length ?? 0) > 0;
    const scheduled = thread.expectedPaidOffByEpisode;
    if (scheduled === undefined) continue; // season-wide thread; nothing to reschedule

    const due = ctx.currentEpisode >= scheduled;
    const hasRunway = scheduled < ctx.totalEpisodes;
    if (hasPlant && !hasPayoff && due && hasRunway) {
      const from = scheduled;
      thread.expectedPaidOffByEpisode = ctx.totalEpisodes;
      fixedCount++;
      records.push({
        rule: RULE_NAME,
        scope: 'episode',
        attempted: 1,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Deferred payoff window of thread "${thread.id}" from episode ${from} to ${ctx.totalEpisodes} (still has runway).`,
      });
    }
  }

  return { fixedCount, records };
}
