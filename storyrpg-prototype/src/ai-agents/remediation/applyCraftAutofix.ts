/**
 * Craft auto-fix aggregator (gating plan, "Bucket A").
 *
 * Runs the five deterministic, gated craft repairs in a fixed order over an
 * assembled story, summing their `fixedCount` and concatenating their ledger
 * records. Each repair is individually gated behind its own `GATE_*` flag and is
 * a complete no-op when that flag is disabled, so with no flags set this whole
 * aggregator is a no-op (zero behavior change). All repairs are pure with
 * respect to wall-clock/randomness — no LLM, no clock, no `Math.random`.
 *
 * The dispatch order matches the order repairs were authored and is independent
 * of behavior (each repair touches a disjoint slice of the story), but is kept
 * stable so the concatenated record stream is deterministic.
 */

import type { Story } from '../../types/story';
import type { RemediationLedgerRecord } from './remediationLedger';
import { repairStatCheckBalance } from './repairs/statCheckBalanceRepair';
import { repairChoiceImpact } from './repairs/choiceImpactRepair';
import { repairNPCDepth } from './repairs/npcDepthRepair';
import { repairArcDelta } from './repairs/arcDeltaRepair';
import { repairMechanicsLeakage } from './repairs/mechanicsLeakageRepair';

type RepairFn = (
  story: Story,
  isEnabled: (flag: string) => boolean,
) => { fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> };

/** The five craft repairs, run in this fixed order. */
const CRAFT_REPAIRS: RepairFn[] = [
  repairStatCheckBalance,
  repairChoiceImpact,
  repairNPCDepth,
  repairArcDelta,
  repairMechanicsLeakage,
];

/**
 * Apply every gated craft repair to `story` in place.
 *
 * @param story     The assembled story; mutated in place by any enabled repair.
 * @param isEnabled Gate predicate (e.g. `(f) => process.env[f] === '1'`). Each
 *                  repair checks its own `GATE_*` flag through this.
 * @returns aggregated `fixedCount` and the concatenated ledger records.
 */
export function applyCraftAutofix(
  story: Story,
  isEnabled: (flag: string) => boolean,
): { fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> } {
  let fixedCount = 0;
  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];

  for (const repair of CRAFT_REPAIRS) {
    const result = repair(story, isEnabled);
    fixedCount += result.fixedCount;
    records.push(...result.records);
  }

  return { fixedCount, records };
}
