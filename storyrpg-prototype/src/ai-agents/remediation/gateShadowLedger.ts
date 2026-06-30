/**
 * Append-only gate SHADOW ledger (validator-tiering Wave 0).
 *
 * For every gateable validator on every run, this records what the gate WOULD
 * have done — independent of whether its flag is currently enabled — so a gate
 * can be promoted off -> on based on real firing/false-positive data instead of
 * guesswork. Rows land in `generated-stories/gate-shadow-ledger.jsonl`, parallel
 * to the quality and remediation ledgers.
 *
 * `wouldGate` + `blockingCount` answer "if I flip this flag on, how often and how
 * hard would it fire?"; pairing that with the shipped story tells you the
 * false-positive rate. `wouldRepairCount` answers "and how many would the repair
 * have resolved?" for repair-backed gates.
 *
 * Node-only and best-effort (delegates to `appendJsonlRow`); never load-bearing.
 */

import { appendJsonlRow } from '../utils/qualityLedger';
import type { RemediationScope } from './remediationLedger';

const LEDGER_FILENAME = 'gate-shadow-ledger.jsonl';

export interface GateShadowRecord {
  /** The GATE_* flag governing this decision. */
  gate: string;
  /** The validator/rule that produced the findings. */
  validator: string;
  /** Story layer the gate operates on. */
  scope: RemediationScope;
  /** Whether the flag is currently enabled (i.e. this would actually block). */
  enabled: boolean;
  /** True when there is >=1 error-severity finding (the gate WOULD fire if on). */
  wouldGate: boolean;
  /** Count of error-severity findings (firing magnitude, flag-independent). */
  blockingCount: number;
  /** For repair-backed gates: how many findings an eligible repair would resolve. */
  wouldRepairCount?: number;
  /** Where this gate executes (plan, episode, or season-final). */
  placement?: string;
  /** Whether a repair/retry path actually ran for this gate class. */
  repairAttempted?: boolean;
  /** Whether the repair/retry path cleared the class it targeted. */
  repairSucceeded?: boolean;
  /** Blocking findings still present after repair/judge/suppression. */
  residualBlockingCount?: number;
  /** Why a would-fire finding was intentionally not counted as blockable. */
  suppressedReason?: string;
  /**
   * ISO timestamp; supplied by the caller (keeps this deterministic/testable),
   * matching the quality/remediation ledger convention.
   */
  timestamp?: string;
  /** Per-run output directory name. */
  runDir?: string;
  storyId?: string;
  /** Optional notes for triage (e.g. the first few finding messages). */
  details?: string;
}

/**
 * Append one shadow record to the ledger under `baseDir` (e.g. "generated-stories/").
 * Best-effort: never throws.
 */
export async function recordGateShadow(baseDir: string, record: GateShadowRecord): Promise<void> {
  await appendJsonlRow(baseDir, LEDGER_FILENAME, record);
}

/**
 * Build a shadow record (sans timestamp/runDir, which the pipeline stamps) from a
 * gate evaluation. Lives here, not in the pipeline monolith, so the dozens of
 * gate seams stay one-liners. `blockingCount` drives `wouldGate`; `issues` (if
 * given) are summarized into `details` (first 3 error messages).
 */
export function buildGateShadowRecord(opts: {
  gate: string;
  validator: string;
  scope: RemediationScope;
  enabled: boolean;
  blockingCount: number;
  storyId?: string;
  wouldRepairCount?: number;
  placement?: string;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  residualBlockingCount?: number;
  suppressedReason?: string;
  issues?: Array<{ severity: string; message?: string }>;
  /** Explicit details override; otherwise summarized from issues. */
  details?: string;
}): Omit<GateShadowRecord, 'timestamp' | 'runDir'> {
  const details =
    opts.details ??
    ((opts.issues ?? [])
      .filter((x) => x.severity === 'error')
      .slice(0, 3)
      .map((x) => x.message)
      .filter(Boolean)
      .join('; ') || undefined);
  return {
    gate: opts.gate,
    validator: opts.validator,
    scope: opts.scope,
    enabled: opts.enabled,
    wouldGate: opts.blockingCount > 0,
    blockingCount: opts.blockingCount,
    wouldRepairCount: opts.wouldRepairCount,
    placement: opts.placement,
    repairAttempted: opts.repairAttempted,
    repairSucceeded: opts.repairSucceeded,
    residualBlockingCount: opts.residualBlockingCount,
    suppressedReason: opts.suppressedReason,
    storyId: opts.storyId,
    details,
  };
}

/**
 * Promotion-readiness telemetry helper. It is intentionally just a stricter
 * facade over `buildGateShadowRecord` so rollout reports and live shadow rows
 * use one stable shape while old consumers keep reading normal shadow fields.
 */
export function buildValidatorPromotionRecord(opts: {
  gate: string;
  validator: string;
  scope: RemediationScope;
  placement: string;
  enabled: boolean;
  blockingCount: number;
  storyId?: string;
  wouldRepairCount?: number;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  residualBlockingCount?: number;
  suppressedReason?: string;
  details?: string;
  issues?: Array<{ severity: string; message?: string }>;
}): Omit<GateShadowRecord, 'timestamp' | 'runDir'> {
  return buildGateShadowRecord(opts);
}
