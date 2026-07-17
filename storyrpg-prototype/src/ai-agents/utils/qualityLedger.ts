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

/**
 * Band a run. `blockingCapCount` is the number of quality caps with
 * maxScore < 90 — each one encodes a KNOWN shipped defect (missing treatment
 * atom, cosmetic branching, false meaningful choice, …), so a run carrying any
 * of them can score >= 70 but must not band "ship"; it lands in "warn" for
 * review instead.
 */
export function scoreBand(score: number | undefined, blockingCapCount?: number): QualityBand {
  if (typeof score !== 'number') return 'block';
  if (score >= QUALITY_SCORE_BANDS.ship && !(blockingCapCount && blockingCapCount > 0)) return 'ship';
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
  /** QA checks that were skipped (score derived from incremental evidence, not a full run). */
  qaSkippedChecks?: string[];
  validationScore?: number;
  validationPassed?: boolean;
  finalStoryContractPassed?: boolean;
  errorCount?: number;
  /** Advisory craft/fidelity warnings the run shipped with (validator tiering, B1). */
  advisoryWarningCount?: number;
  /** Prose craft: fraction (0-1) of sentences opening in second person ("You …"). */
  secondPersonOpenerRatio?: number;
  /** Prose craft: count of passages with a 3+ consecutive second-person-opener run. */
  openerMonotonyPassages?: number;
  episodeCount?: number;
  durationMs?: number;
  llmCalls?: number;
  llmFailures?: number;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  promptChars?: number;
  /** True when the run was hard-blocked (failed a blocking gate / PipelineError). */
  blocked?: boolean;
  /** Coarse failure category for cross-run triage, e.g. the PipelineError `phase`. */
  failureKind?: string;
  /** Typed PipelineFailureCode when available. */
  failureCode?: string;
  /** Owner stage that owns the blocking defect. */
  failureOwnerStage?: string;
  /** Repair class / router hint. */
  retryClass?: string;
  /** Concrete repair target id (scene, task, plan…). */
  repairTarget?: string;
  /** Top blocking validator / agent id. */
  topBlockingValidator?: string;
  /** Fingerprint of resolved GATE_DEFAULTS + env overrides at fail time. */
  gateConfigHash?: string;
  /** Git commit the worker actually ran — resolves which fixes a run exercised. */
  workerGitSha?: string;
  /** Deferral backpressure: owner-stage findings handed to episode-contract repair this run. */
  deferredRealizationCount?: number;
  /** The validator/agent that produced the blocking failure, when known. */
  validatorId?: string;
  /** S3: total remediation attempts (scene/encounter/choice regen, autofix) this run. */
  remediationsAttempted?: number;
  /** S3: how many of those remediations resolved their gate. */
  remediationsSucceeded?: number;
  /** S3: how many degraded gracefully (accepted imperfect output / budget exhausted). */
  remediationsDegraded?: number;
  /** Quality-score cap ids applied to the run (see qualityScoring applyCaps). */
  capIds?: string[];
  /** How many of those caps have maxScore < 90 (known shipped defects). */
  blockingCapCount?: number;
  /** G9 evidence sync: content hash of the packaged story's episodes projection. */
  candidateStoryHash?: string;
  /** G9 evidence sync: true when the QA grades in this row scored content that was later mutated. */
  qaEvidenceStale?: boolean;
  /** Successful rows are only emitted after both retained package files parse. */
  packageVerified?: boolean;
  packageRetention?: 'retain_success_package';
  storyArtifact?: string;
  manifestArtifact?: string;
  /** Pipeline memory telemetry rollup for the run (Cognee recall/write health). */
  memory?: {
    recallCount: number;
    writeCount: number;
    emptyRecallCount: number;
    recallFailureCount: number;
    writeFailureCount: number;
    cognifyFailureCount: number;
    circuitOpenSkipCount: number;
    providerEmptyRecallCount: number;
    filterFallbackCount: number;
    breakerOpenCount: number;
    totalResultCount: number;
    totalLatencyMs: number;
    errorCount: number;
  };
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
 * Append one JSONL row to `{baseDir}/{filename}`. Shared by the quality ledger
 * and sibling append-only ledgers (e.g. the remediation ledger) so the
 * file-writing logic lives in exactly one place. Best-effort: never throws,
 * no-ops on a non-node runtime or empty `baseDir`.
 */
export async function appendJsonlRow(baseDir: string, filename: string, row: unknown): Promise<void> {
  if (!baseDir) return;
  const fsp = await getNodeFs();
  if (!fsp) return; // non-node runtime — skip silently

  try {
    await fsp.mkdir(baseDir, { recursive: true });
    const sep = baseDir.endsWith('/') ? '' : '/';
    const line = JSON.stringify(row) + '\n';
    await fsp.appendFile(`${baseDir}${sep}${filename}`, line, 'utf8');
  } catch (e) {
    console.warn(`[QualityLedger] Failed to append ${filename} row:`, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Append one entry to the quality ledger under `baseDir`
 * (e.g. "generated-stories/"). Best-effort: never throws.
 */
export async function appendQualityLedger(baseDir: string, entry: QualityLedgerEntry): Promise<void> {
  await appendJsonlRow(baseDir, LEDGER_FILENAME, withBand(entry));
}

/** Attach the derived band so the JSONL is self-describing for dashboards. */
function withBand(entry: QualityLedgerEntry): QualityLedgerEntry & { band: QualityBand } {
  return { ...entry, band: scoreBand(entry.overallScore, entry.blockingCapCount) };
}
