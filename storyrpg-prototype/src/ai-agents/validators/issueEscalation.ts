/**
 * Per-issue-class validator escalation flags.
 *
 * The best-practices validators run in ADVISORY mode by default, so their
 * findings ship as warnings (see IntegratedBestPracticesValidator.overallPassed
 * and FinalStoryContractValidator's downgrade loop). These flags let us promote
 * TWO specific correctness classes — design-note/meta-narration leaks and
 * witness-id integrity — to hard blockers WITHOUT making every advisory finding
 * blocking.
 *
 * Rollout state is owned by the central registry (`remediation/gateDefaults.ts`):
 * `GATE_WITNESS_ID_INTEGRITY` is default-ON (validated by the witnessNpcResolver
 * fix), `GATE_DESIGN_NOTE_LEAK` stays default-OFF pending false-positive shadow
 * data. Either can still be overridden per-environment (env '1'/'0'). PURE/UNCACHED.
 */

import { isGateEnabled } from '../remediation/gateDefaults';

/** Whether a gate is enabled, per the central rollout registry + env overrides. */
function on(name: string): boolean {
  return isGateEnabled(name);
}

/** `GATE_DESIGN_NOTE_LEAK` — also turns on the MechanicsLeakageValidator design-note scan. */
export function gateDesignNoteLeak(): boolean {
  return on('GATE_DESIGN_NOTE_LEAK');
}

/** `GATE_WITNESS_ID_INTEGRITY` — promote unknown-witness-NPC errors to blocking. */
export function gateWitnessIdIntegrity(): boolean {
  return on('GATE_WITNESS_ID_INTEGRITY');
}

/** `GATE_RELATIONSHIP_ID_INTEGRITY` — promote unknown-relationship-NPC errors to blocking. */
export function gateRelationshipIdIntegrity(): boolean {
  return on('GATE_RELATIONSHIP_ID_INTEGRITY');
}

/**
 * True when a best-practices issue belongs to an escalated class AND that class's
 * gating flag is on. Matched on the issue message (the validators don't currently
 * carry a stable machine category for these). Kept narrow so unrelated advisory
 * findings are never escalated.
 */
export function isEscalatedIssue(issue: { category?: string; message?: string }): boolean {
  const message = issue.message || '';
  if (
    gateDesignNoteLeak() &&
    /\bleaks\b.*(?:meta-narration|planning reference|system-variable|planning narration)/i.test(message)
  ) {
    return true;
  }
  // ONLY the genuine integrity class — a witness referencing an NPC that does not
  // exist at all ("references unknown NPC", from MechanicalStorytellingValidator and
  // PhaseValidator). The softer "Witness reaction NPC ... is not listed in scene"
  // class is a presence PREFERENCE (the NPC is real/canonical, just not in that
  // scene's roster — see its own suggestion), NOT a data-integrity bug, so it must
  // NOT be escalated to a hard blocker. A broad /witness reaction/ match used to
  // catch both and hard-aborted runs on the presence class.
  if (gateWitnessIdIntegrity() && /references unknown NPC/i.test(message)) {
    return true;
  }
  // Relationship-consequence id integrity (G10): a relationship delta to "None"/an
  // unknown NPC is silently dropped at runtime, so the choice's bond movement is lost.
  // Distinct phrase ("targets unknown NPC") keeps it off the witness regex above.
  if (gateRelationshipIdIntegrity() && /relationship consequence on choice.*targets unknown NPC/i.test(message)) {
    return true;
  }
  return false;
}
