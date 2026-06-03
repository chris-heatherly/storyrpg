/**
 * Append-only cross-run quality ledger (docs/PROJECT_AUDIT_2026-05-28.md, B3).
 *
 * The pipeline computes a 0-100 quality score per run but discards it, and the
 * generation success/failure rate is invisible outside the filesystem. This
 * ledger appends one JSONL row per run to `generated-stories/quality-ledger.jsonl`
 * so quality and success-rate can be tracked over time and regressions caught.
 *
 * Node-only (the generation worker runs under node). In a non-node runtime it
 * no-ops gracefully — the ledger is an analytics convenience, never load-bearing.
 */

/** Ship/warn/block bands for the 0-100 validation score (see the contract doc). */
export const QUALITY_SCORE_BANDS = {
  /** >= ship: good to publish. */
  ship: 70,
  /** >= warn (and < ship): publishable but flagged for review. */
  warn: 50,
  // < warn: block / needs rework.
} as const;

export type QualityBand = 'ship' | 'warn' | 'block';

export function scoreBand(score: number | undefined): QualityBand {
  if (typeof score !== 'number') return 'block';
  if (score >= QUALITY_SCORE_BANDS.ship) return 'ship';
  if (score >= QUALITY_SCORE_BANDS.warn) return 'warn';
  return 'block';
}

export interface QualityLedgerEntry {
  /** ISO timestamp; caller supplies it (keeps this function deterministic/testable). */
  timestamp: string;
  /** Per-run output directory name (e.g. "my-story_2026-05-28T12-34-56"). */
  runDir?: string;
  storyId?: string;
  storyTitle?: string;
  outcome: 'success' | 'failed' | 'partial';
  /** Validation (best-practices) overall score, 0-100. */
  overallScore?: number;
  qaScore?: number;
  validationPassed?: boolean;
  finalStoryContractPassed?: boolean;
  errorCount?: number;
  /** Advisory craft/fidelity warnings the run shipped with (validator tiering, B1). */
  advisoryWarningCount?: number;
  episodeCount?: number;
  durationMs?: number;
  /** True when the run was hard-blocked (failed a blocking gate / PipelineError). */
  blocked?: boolean;
  /** Coarse failure category for cross-run triage, e.g. the PipelineError `phase`. */
  failureKind?: string;
  /** The validator/agent that produced the blocking failure, when known. */
  validatorId?: string;
}

const LEDGER_FILENAME = 'quality-ledger.jsonl';

async function getNodeFs(): Promise<typeof import('fs/promises') | null> {
  try {
    // Dynamic import so bundlers targeting the browser don't hard-require fs.
    const mod = await import('fs/promises');
    return (mod as any).default ?? mod;
  } catch {
    return null;
  }
}

/**
 * Append one entry to the quality ledger under `baseDir`
 * (e.g. "generated-stories/"). Best-effort: never throws.
 */
export async function appendQualityLedger(baseDir: string, entry: QualityLedgerEntry): Promise<void> {
  if (!baseDir) return;
  const fsp = await getNodeFs();
  if (!fsp) return; // non-node runtime — skip silently

  try {
    await fsp.mkdir(baseDir, { recursive: true });
    const sep = baseDir.endsWith('/') ? '' : '/';
    const line = JSON.stringify(withBand(entry)) + '\n';
    await fsp.appendFile(`${baseDir}${sep}${LEDGER_FILENAME}`, line, 'utf8');
  } catch (e) {
    console.warn('[QualityLedger] Failed to append ledger entry:', e instanceof Error ? e.message : String(e));
  }
}

/** Attach the derived band so the JSONL is self-describing for dashboards. */
function withBand(entry: QualityLedgerEntry): QualityLedgerEntry & { band: QualityBand } {
  return { ...entry, band: scoreBand(entry.overallScore) };
}
