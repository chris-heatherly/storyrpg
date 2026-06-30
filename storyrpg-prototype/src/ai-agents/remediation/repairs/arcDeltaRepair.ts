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

/**
 * Opt-in escalation flag for the LLM-authored endpoint path (default OFF).
 * Resolved through the same `isEnabled` predicate as the gate flag, so the
 * standard `isGateEnabled` env semantics apply (`STORYRPG_LLM_ARC_REPAIR=1`
 * turns it on; absent/`0` keeps the deterministic mirror byte-identical).
 */
export const LLM_ARC_REPAIR_FLAG = 'STORYRPG_LLM_ARC_REPAIR';

/** What the endpoint author callback sees for one single-endpoint arc. */
export interface ArcEndpointAuthorInput {
  npcId: string;
  npcName: string;
  npcDescription?: string;
  npcRole?: string;
  npcWant?: string;
  npcFear?: string;
  npcFlaw?: string;
  /** Which side of the arc is missing and must be authored. */
  missingEndpoint: 'startState' | 'endState';
  /** The populated side the author extrapolates from. */
  populatedEndpoint: 'startState' | 'endState';
  populatedState: string;
  /** Authored arc beats, when present — the strongest signal for direction. */
  arcKeyBeats?: string[];
  storyTitle?: string;
  storySynopsis?: string;
}

/**
 * Injectable LLM escalation: authors the MISSING arc endpoint from the
 * populated one plus story/NPC context, so the arc carries a real delta
 * instead of a zero-delta mirror. Mirrors the remediation precedent
 * (`ResidueCriticLike` in reconvergenceResidueRepair): the module stays
 * decoupled from any agent class, callers wire a BaseAgent-backed
 * implementation, and tests stub it. Output is sanitized strictly — anything
 * thrown, empty, or non-string falls back to the deterministic mirror.
 */
export type ArcEndpointAuthorFn = (
  input: ArcEndpointAuthorInput,
) => Promise<string | null | undefined>;

/** A usable authored endpoint is a non-empty trimmed string. */
function sanitizeAuthoredEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

/**
 * LLM-escalated variant of {@link repairArcDelta}.
 *
 * When `STORYRPG_LLM_ARC_REPAIR` is enabled AND an `authorEndpoint` callback
 * is provided, each single-endpoint arc first asks the callback to author the
 * MISSING endpoint from the populated one plus the NPC/story context this
 * repair already receives — producing a real arc delta instead of a zero-delta
 * mirror. Any failure (throw, empty/non-string result) falls back to the
 * mirror for THAT arc, so endpoint presence is still guaranteed.
 *
 * Default behavior is byte-identical to {@link repairArcDelta}: with the flag
 * off (or no callback wired) this delegates straight to the sync repair.
 */
export async function repairArcDeltaWithLLM(
  story: Story,
  isEnabled: (flag: string) => boolean,
  authorEndpoint?: ArcEndpointAuthorFn,
): Promise<{ fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> }> {
  if (!isEnabled(GATE_FLAG)) {
    return { fixedCount: 0, records: [] };
  }

  // LLM path inactive → exactly the deterministic mirror repair.
  if (!authorEndpoint || !isEnabled(LLM_ARC_REPAIR_FLAG)) {
    return repairArcDelta(story, isEnabled);
  }

  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];

  for (const npc of story.npcs) {
    const arc = npc.arc;
    if (!arc) continue;

    const hasStart = hasEndpoint(arc.startState);
    const hasEnd = hasEndpoint(arc.endState);
    if (hasStart === hasEnd) continue;

    const missingEndpoint = hasStart ? 'endState' : 'startState';
    const populatedEndpoint = hasStart ? 'startState' : 'endState';
    const populatedState = (hasStart ? arc.startState : arc.endState) as string;

    let authored: string | null = null;
    try {
      authored = sanitizeAuthoredEndpoint(
        await authorEndpoint({
          npcId: npc.id,
          npcName: npc.name,
          npcDescription: npc.description || undefined,
          npcRole: npc.role,
          npcWant: npc.want,
          npcFear: npc.fear,
          npcFlaw: npc.flaw,
          missingEndpoint,
          populatedEndpoint,
          populatedState,
          arcKeyBeats: arc.keyBeats,
          storyTitle: story.title,
          storySynopsis: story.synopsis || undefined,
        }),
      );
    } catch {
      // Fall through to the mirror.
    }

    // Authored endpoint when available; the mirror remains the fallback.
    arc[missingEndpoint] = authored ?? populatedState;

    records.push(makeRecord());
  }

  return { fixedCount: records.length, records };
}
