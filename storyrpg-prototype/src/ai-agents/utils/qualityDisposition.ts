import { fnv1a32Json } from './contentHash';
import type { QualityBand } from './qualityLedger';
import type { QualityDomainScore } from './qualityScoring';

export const QUALITY_DISPOSITION_VERSION = 1 as const;

export interface QualityBaselineSnapshot {
  version: 1;
  key: string;
  runDir: string;
  finalScore: number;
  evidenceCoverage: number;
  capIds: string[];
  domains: Record<string, number>;
  candidateStoryHash?: string;
  committedAt: string;
}

export interface QualityBaselineComparison {
  baselineFound: boolean;
  accepted: boolean;
  regressions: string[];
  baselineRunDir?: string;
}

export interface QualityDisposition {
  version: typeof QUALITY_DISPOSITION_VERSION;
  status: 'promoted' | 'held';
  band: QualityBand;
  eligibleForReader: boolean;
  reasonCodes: string[];
  score: number;
  capIds: string[];
  blockingCapCount: number;
  qaEvidenceStale: boolean;
  candidateStoryHash?: string;
  baselineKey?: string;
  baselineComparison?: QualityBaselineComparison;
  createdAt: string;
  override?: {
    approvedBy: string;
    approvedAt: string;
    reason: string;
  };
}

export function qualityDomainSnapshot(domains: QualityDomainScore[]): Record<string, number> {
  return Object.fromEntries(
    domains.filter((domain) => domain.active).map((domain) => [domain.id, domain.score]),
  );
}

export function buildQualityBaselineKey(input: {
  storyId: string;
  storyTitle?: string;
  sourceKind?: string;
  requestedEpisodes?: number[];
  sourceAnalysisHash?: string;
  seasonPlanHash?: string;
  compilerVersion?: string;
  generator?: Record<string, unknown>;
}): string {
  const identity = (input.storyTitle || input.storyId)
    .trim()
    .replace(/[ _-]+r\d+(?:[ _-].*)?$/i, '')
    .toLocaleLowerCase();
  return fnv1a32Json({
    keySchema: 2,
    storyIdentity: input.sourceAnalysisHash ? '' : identity,
    sourceKind: input.sourceKind ?? '',
    requestedEpisodes: input.requestedEpisodes ?? [],
    sourceAnalysisHash: input.sourceAnalysisHash ?? '',
  });
}

export function compareQualityBaseline(
  candidate: Omit<QualityBaselineSnapshot, 'version' | 'committedAt'>,
  baseline?: QualityBaselineSnapshot,
): QualityBaselineComparison {
  if (!baseline) return { baselineFound: false, accepted: true, regressions: [] };
  const regressions: string[] = [];
  const baselineCaps = new Set(baseline.capIds);
  const newCaps = candidate.capIds.filter((capId) => !baselineCaps.has(capId));
  if (newCaps.length > 0) regressions.push(`new_caps:${newCaps.sort().join(',')}`);
  if (candidate.finalScore < baseline.finalScore) {
    regressions.push(`final_score:${candidate.finalScore}<${baseline.finalScore}`);
  }
  if (candidate.evidenceCoverage < baseline.evidenceCoverage) {
    regressions.push(`evidence_coverage:${candidate.evidenceCoverage}<${baseline.evidenceCoverage}`);
  }
  for (const [domainId, baselineScore] of Object.entries(baseline.domains)) {
    const candidateScore = candidate.domains[domainId];
    if (typeof candidateScore === 'number' && candidateScore < baselineScore) {
      regressions.push(`domain:${domainId}:${candidateScore}<${baselineScore}`);
    }
  }
  return {
    baselineFound: true,
    accepted: regressions.length === 0,
    regressions,
    baselineRunDir: baseline.runDir,
  };
}

export function deriveQualityDisposition(input: {
  score: number;
  rawBand: QualityBand;
  capIds: string[];
  blockingCapCount: number;
  qaEvidenceStale?: boolean;
  candidateStoryHash?: string;
  baselineKey?: string;
  baselineComparison?: QualityBaselineComparison;
  createdAt: string;
}): QualityDisposition {
  const reasonCodes: string[] = [];
  if (input.rawBand !== 'ship') reasonCodes.push(`quality_band_${input.rawBand}`);
  if (input.blockingCapCount > 0) reasonCodes.push('blocking_quality_caps');
  if (input.qaEvidenceStale) reasonCodes.push('qa_evidence_stale');
  if (input.baselineComparison && !input.baselineComparison.accepted) reasonCodes.push('best_known_regression');
  const eligibleForReader = reasonCodes.length === 0;
  const band: QualityBand = eligibleForReader ? 'ship' : input.rawBand === 'block' ? 'block' : 'warn';
  return {
    version: QUALITY_DISPOSITION_VERSION,
    status: eligibleForReader ? 'promoted' : 'held',
    band,
    eligibleForReader,
    reasonCodes,
    score: input.score,
    capIds: [...input.capIds],
    blockingCapCount: input.blockingCapCount,
    qaEvidenceStale: input.qaEvidenceStale === true,
    candidateStoryHash: input.candidateStoryHash,
    baselineKey: input.baselineKey,
    baselineComparison: input.baselineComparison,
    createdAt: input.createdAt,
  };
}
