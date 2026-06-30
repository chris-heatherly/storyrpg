/**
 * Append-only cross-run remediation ledger (gating plan S3).
 *
 * Validators, agents, and pipeline phases attempt remediation (auto-fix, rewrite,
 * regenerate) when a quality gate trips. Those attempts are otherwise invisible
 * once a run finishes. This ledger appends one JSONL row per remediation attempt
 * to `generated-stories/remediation-ledger.jsonl`, parallel to the quality ledger,
 * so remediation frequency / success / degradation can be tracked over time.
 *
 * Node-only (the generation worker runs under node). In a non-node runtime it
 * no-ops gracefully — the ledger is an analytics convenience, never load-bearing.
 *
 * File-writing is delegated to `appendJsonlRow` in `qualityLedger.ts` so the
 * fs/append logic lives in exactly one place.
 */

import { appendJsonlRow } from '../utils/qualityLedger';

const LEDGER_FILENAME = 'remediation-ledger.jsonl';

/** The quality gate that triggered the remediation. */
export type RemediationScope =
  | 'scene'
  | 'choices'
  | 'encounter'
  | 'episode'
  | 'season'
  | 'autofix';

export interface RemediationLedgerRecord {
  /** The validator/rule/gate that triggered the remediation. */
  rule: string;
  /** Which layer of the story the remediation operated on. */
  scope: RemediationScope;
  /** How many items the remediation targeted (e.g. scenes rewritten). */
  attempted: number;
  /** True when the remediation resolved the gate. */
  succeeded: boolean;
  /** True when the result shipped with a quality trade-off (e.g. fallback prose). */
  degraded: boolean;
  /** True when the gate ultimately hard-blocked the run despite remediation. */
  blocked: boolean;
  /** Number of remediation attempts made. */
  attempts: number;
  /**
   * ISO timestamp; supplied by the caller (keeps this function
   * deterministic/testable). The quality ledger uses the same convention.
   */
  timestamp?: string;
  /** Per-run output directory name (e.g. "my-story_2026-05-28T12-34-56"). */
  runDir?: string;
  storyId?: string;
  /** Optional notes / error details for triage. */
  details?: string;
}

/**
 * Append one remediation record to the ledger under `baseDir`
 * (e.g. "generated-stories/"). Best-effort: never throws.
 */
export async function recordRemediation(baseDir: string, record: RemediationLedgerRecord): Promise<void> {
  await appendJsonlRow(baseDir, LEDGER_FILENAME, record);
}
