// ========================================
// TREATMENT-FIDELITY GATE (Remediation §4)
// ========================================
//
// The five NEW treatment-fidelity validators (§4.1–§4.5) ship DEFAULT-OFF behind
// a per-rule env flag, mirroring the Bucket-D plan-gate (`planGatePolicy.ts`) and
// the per-issue-class escalation (`issueEscalation.ts`) conventions. With every
// flag unset, behavior is byte-identical to today: the validators are registered
// in `validatorRegistry.ts` for auditability and wired by their owning stage, but
// none of them HARD-BLOCKS until its flag is explicitly enabled.
//
// PURE/UNCACHED: the only `process.env` read is in `on()`, gated to the exact
// string `'1'` (same shape as `issueEscalation.on`). No wall-clock, no randomness.
//
// §4.6 hardening lives here too: when the source is an authored treatment, a
// fidelity-class FINDING must NOT be silently downgraded to a warning at the final
// contract gate. `isTreatmentFidelityFinding` identifies those findings by their
// emitting validator so `FinalStoryContractValidator.validateQAReports` can keep
// QA-prose downgrades while letting fidelity failures hard-fail.

/** The five §4 treatment-fidelity validators, each mapped to its rollout flag. */
export const TREATMENT_FIDELITY_GATE_FLAGS = {
  authoredEpisodeConformance: 'GATE_AUTHORED_EPISODE_CONFORMANCE',
  encounterAnchorContent: 'GATE_ENCOUNTER_ANCHOR_CONTENT',
  informationLedgerSchedule: 'GATE_INFORMATION_LEDGER_SCHEDULE',
  signatureDevicePresence: 'GATE_SIGNATURE_DEVICE_PRESENCE',
  sevenPointAnchorConformance: 'GATE_SEVEN_POINT_ANCHOR_CONFORMANCE',
} as const;

export type TreatmentFidelityGateFlag =
  (typeof TREATMENT_FIDELITY_GATE_FLAGS)[keyof typeof TREATMENT_FIDELITY_GATE_FLAGS];

/** The class (`validator` name) of each §4 fidelity validator's findings. */
export const TREATMENT_FIDELITY_VALIDATORS: readonly string[] = [
  'AuthoredEpisodeConformanceValidator',
  'EncounterAnchorContentValidator',
  'InformationLedgerScheduleValidator',
  'SignatureDevicePresenceValidator',
  'SevenPointAnchorConformanceValidator',
] as const;

import { isGateEnabled } from '../remediation/gateDefaults';

/** Whether a gate is enabled, per the central rollout registry + env overrides. */
function on(name: string): boolean {
  return isGateEnabled(name);
}

/**
 * Whether a given fidelity validator's gate flag is enabled. Default-off: returns
 * false for every flag unless its env var is set to `'1'`.
 */
export function isFidelityGateEnabled(flag: TreatmentFidelityGateFlag): boolean {
  return on(flag);
}

/**
 * §4.6: a contract issue is a treatment-fidelity FINDING iff it was emitted by one
 * of the five §4 validators. Used to keep these findings blocking (not downgraded
 * to a warning) when the source is an authored treatment. QA-prose findings (from
 * `QARunner` / `IntegratedBestPracticesValidator`) are NOT fidelity findings and
 * keep their existing advisory downgrade.
 */
export function isTreatmentFidelityFinding(issue: { validator?: string }): boolean {
  return !!issue.validator && TREATMENT_FIDELITY_VALIDATORS.includes(issue.validator);
}
