/**
 * ArcDelta endpoint-presence repair.
 *
 * A character arc is described on each NPC as `arc.startState` / `arc.endState`
 * (see `Story['npcs'][number].arc` in `src/types/story.ts`). Downstream arc
 * reasoning (CharacterArcTracker targets, ArcDeltaValidator) compares a start
 * endpoint against an end endpoint. When an NPC *declares* an arc but only one
 * endpoint is populated, the arc is a dead-end: the validator cannot evaluate a
 * delta and the runtime/UI has nothing to anchor the missing side to.
 *
 * This repair guarantees endpoint *presence* without fabricating arc movement.
 * When exactly one endpoint of a declared arc is missing/blank, we backfill it
 * by mirroring the populated endpoint. Mirroring states a present-but-static
 * arc (start == end, i.e. a zero delta) rather than inventing a destination the
 * author never intended. This is the conservative, deterministic choice per the
 * "do not fabricate arc movement" constraint — no LLM, no randomness, no clock.
 *
 * Gating: default-off via `GATE_ARC_DELTA`. When the gate is disabled the
 * function is a complete no-op (zero behavior change).
 */

import type { Story } from '../../../types/story';
import type { RemediationLedgerRecord } from '../remediationLedger';

const GATE_FLAG = 'GATE_ARC_DELTA';
const RULE_NAME = 'ArcEndpointPresence';

/** A non-empty endpoint is a string with at least one non-whitespace char. */
function hasEndpoint(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function makeRecord(): Omit<RemediationLedgerRecord, 'timestamp'> {
  return {
    rule: RULE_NAME,
    scope: 'autofix',
    attempted: 1,
    succeeded: true,
    degraded: false,
    blocked: false,
    attempts: 1,
  };
}

/**
 * Backfill missing arc endpoints in place. A fix is counted (and recorded) once
 * per NPC arc whose single populated endpoint is mirrored onto the missing side.
 *
 * @param story    The assembled story; mutated in place when the gate is on.
 * @param isEnabled Gate predicate. `GATE_ARC_DELTA` must be enabled to do work.
 */
export function repairArcDelta(
  story: Story,
  isEnabled: (flag: string) => boolean
): { fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> } {
  // Default-off: a disabled gate is a complete no-op (no story mutation).
  if (!isEnabled(GATE_FLAG)) {
    return { fixedCount: 0, records: [] };
  }

  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];

  for (const npc of story.npcs) {
    const arc = npc.arc;
    if (!arc) continue;

    const hasStart = hasEndpoint(arc.startState);
    const hasEnd = hasEndpoint(arc.endState);

    // Only a single-endpoint arc is a violation. Both-present is valid; the
    // both-missing case is not a "declared" arc and is left untouched (this
    // repair governs endpoint presence, not arc existence).
    if (hasStart === hasEnd) continue;

    if (hasStart) {
      // Mirror the populated start onto the missing end: present, zero delta.
      arc.endState = arc.startState;
    } else {
      // Mirror the populated end onto the missing start: present, zero delta.
      arc.startState = arc.endState;
    }

    records.push(makeRecord());
  }

  return { fixedCount: records.length, records };
}
