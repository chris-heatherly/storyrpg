/**
 * PropIntroduction cast-reference repair (plan-time, deterministic).
 *
 * The PropIntroduction gate (cast-reference subset) errors when a scene references
 * an entity id that is not in the known cast. In practice the dominant cause is the
 * SAME label-vs-id mismatch that produced the witness-id bug: a scene's
 * `charactersInvolved` carries a raw label ("mika", "Mihaela 'Mika' Drăgan") instead
 * of the canonical `char-*` id, so a perfectly-real cast member reads as "unresolved".
 *
 * This repair resolves each referenced id against the authoritative cast roster
 * (ids + names) using the shared 3-tier resolver (exact / normalized±char-prefix /
 * unique name-token) and rewrites it to the canonical id IN PLACE. It deliberately
 * does NOT drop genuinely-unknown references: a reference that resolves to no cast
 * member is a real dangling-reference bug and must stay an error for the gate to
 * catch. So the repair clears only the FALSE-positive (label-variant) class.
 *
 * Pure/deterministic: no LLM, no wall-clock, no randomness — reuses the same
 * resolver the witness fix proved out.
 */

import { resolveWitnessNpcId, type NpcRosterEntry } from '../../utils/witnessNpcResolver';
import type { RemediationLedgerRecord } from '../remediationLedger';
import { PropIntroductionValidator } from '../../validators/PropIntroductionValidator';
import { buildPropIntroductionInput } from '../propIntroductionGate';
import { runGatedRemediation, GatedRemediationError } from '../runGatedRemediation';

export interface PropRepairScene {
  sceneId: string;
  sceneName?: string;
  /** Mutated in place: raw entity references resolved to canonical cast ids. */
  referencedEntityIds: string[];
}

/**
 * Canonicalize raw entity references against the cast roster.
 *
 * @returns how many references were rewritten, plus one ledger record if any were.
 */
export function repairPropIntroduction(
  scenes: PropRepairScene[],
  roster: NpcRosterEntry[],
): { fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> } {
  let fixedCount = 0;
  if (!roster?.length) return { fixedCount, records: [] };

  for (const scene of scenes) {
    const refs = scene.referencedEntityIds;
    if (!Array.isArray(refs)) continue;
    for (let i = 0; i < refs.length; i++) {
      const raw = refs[i];
      const canonical = resolveWitnessNpcId(raw, roster);
      // Only rewrite a genuine label->id resolution; leave exact ids and true
      // unknowns untouched (the latter must remain an error).
      if (canonical && canonical !== raw) {
        refs[i] = canonical;
        fixedCount++;
      }
    }
  }

  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> =
    fixedCount > 0
      ? [{
          rule: 'prop_introduction_resolve',
          scope: 'episode',
          attempted: fixedCount,
          succeeded: true,
          degraded: false,
          blocked: false,
          attempts: 1,
          details: `Resolved ${fixedCount} raw entity reference(s) to canonical cast ids.`,
        }]
      : [];
  return { fixedCount, records };
}

/**
 * The PropIntroduction repair LOOP: detect -> resolve -> re-validate via the
 * canonical {@link runGatedRemediation} driver. Resolution is idempotent so one
 * pass suffices; a second pass would change nothing. Returns whether the gate now
 * passes (no error-severity unresolved references) plus the repair ledger records.
 * Never throws on a GatedRemediationError — the caller decides how to surface a
 * still-failing gate. Kept out of the pipeline monolith and unit-testable against
 * the real validator.
 */
export async function repairAndRevalidatePropIntroduction(
  scenes: PropRepairScene[],
  roster: NpcRosterEntry[],
  opts?: { canSpend?: () => boolean; maxAttempts?: number },
): Promise<{ passed: boolean; fixedCount: number; records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> }> {
  const knownIds = roster.flatMap((r) => [r.id, r.name]).filter(Boolean) as string[];
  let fixedCount = 0;
  const records: Array<Omit<RemediationLedgerRecord, 'timestamp'>> = [];

  const detect = () => {
    const result = new PropIntroductionValidator().validate(
      buildPropIntroductionInput(
        knownIds,
        scenes.map((s) => ({ sceneId: s.sceneId, sceneName: s.sceneName, referencedEntityIds: s.referencedEntityIds })),
      ),
      { strict: true },
    );
    const errs = result.issues.filter((iss) => iss.severity === 'error');
    return { passed: errs.length === 0 };
  };
  const remediate = () => {
    const res = repairPropIntroduction(scenes, roster);
    fixedCount += res.fixedCount;
    records.push(...res.records);
  };

  try {
    const out = await runGatedRemediation({
      detect,
      remediate,
      maxAttempts: opts?.maxAttempts ?? 1,
      blocking: true,
      canSpend: opts?.canSpend,
    });
    return { passed: out.passed, fixedCount, records };
  } catch (e) {
    if (e instanceof GatedRemediationError) return { passed: false, fixedCount, records };
    throw e;
  }
}
