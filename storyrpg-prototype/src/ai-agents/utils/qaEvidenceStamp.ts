/**
 * QA evidence sync (G9): every QA/judge artifact records WHICH content it
 * graded, and artifacts whose graded content no longer matches the shipped
 * content are marked STALE instead of silently presenting as fresh.
 *
 * Root cause this closes: continuity repair mutates episode prose in place
 * AFTER the QA pass grades it, and only the continuity block is conditionally
 * re-derived — so `*-qa-report.post-repair.json` (and the scores derived from
 * it) could grade text the reader never sees, invisibly.
 *
 * Reporting-layer only: staleness never gates, caps, or blocks anything.
 */
import { fnv1a32Json } from './contentHash';

export interface QaEvidenceStamp {
  /** Hash of the exact content the QA pass graded. */
  gradedContentHash: string;
  gradedAt: string;
  /** True when the shipped content no longer matches what was graded. */
  stale?: boolean;
  staleReason?: string;
  /** Content hash at staleness-check time (differs from gradedContentHash when stale). */
  currentContentHash?: string;
}

/** Anything that can carry a QA evidence stamp (QAReport, aggregates, score reports). */
export interface QaEvidenceCarrier {
  qaEvidence?: QaEvidenceStamp;
}

/**
 * Hash the content surface a QA pass actually grades: scene contents plus
 * choice sets. Top-level run fields (cover art, output dir) are excluded for
 * the same reason carryForwardStoryHash excludes them.
 */
export function qaGradedContentHash(sceneContents: unknown, choiceSets?: unknown): string {
  return fnv1a32Json({ scenes: sceneContents ?? [], choices: choiceSets ?? [] });
}

export function stampQaEvidence<T extends QaEvidenceCarrier>(report: T, gradedContentHash: string): T {
  report.qaEvidence = {
    gradedContentHash,
    gradedAt: new Date().toISOString(),
  };
  return report;
}

/**
 * Compare the stamp against the content as it stands NOW. Call after any
 * in-place mutation of graded content (e.g. continuity repair). Idempotent:
 * re-checking with a matching hash clears a previous stale mark only if the
 * content was restored to what was graded (hash equality is the one ruler).
 */
export function markQaEvidenceStaleness<T extends QaEvidenceCarrier>(
  report: T,
  currentContentHash: string,
  staleReason: string,
): T {
  const evidence = report.qaEvidence;
  if (!evidence) return report;
  if (evidence.gradedContentHash === currentContentHash) {
    delete evidence.stale;
    delete evidence.staleReason;
    delete evidence.currentContentHash;
    return report;
  }
  evidence.stale = true;
  evidence.staleReason = staleReason;
  evidence.currentContentHash = currentContentHash;
  return report;
}

/** Aggregate stamp: stale if any constituent episode report is stale. */
export function aggregateQaEvidence(parts: Array<QaEvidenceStamp | undefined>): QaEvidenceStamp | undefined {
  const present = parts.filter((part): part is QaEvidenceStamp => Boolean(part));
  if (present.length === 0) return undefined;
  const staleParts = present.filter((part) => part.stale);
  const aggregate: QaEvidenceStamp = {
    gradedContentHash: fnv1a32Json(present.map((part) => part.gradedContentHash)),
    gradedAt: present.map((part) => part.gradedAt).sort()[present.length - 1],
  };
  if (staleParts.length > 0) {
    aggregate.stale = true;
    aggregate.staleReason = `${staleParts.length}/${present.length} episode QA report(s) graded content that was mutated after grading`;
  }
  return aggregate;
}
