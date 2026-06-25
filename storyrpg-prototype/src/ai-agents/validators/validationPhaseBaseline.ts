import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { SeasonPlan } from '../../types/seasonPlan';
import { stableHash, stableStringify } from '../pipeline/artifacts/store';
import { sha256Hex } from '../utils/atomicIo';
import type { FidelityFinding } from './runFidelityValidators';

export interface NormalizedFidelityFinding {
  validator: string;
  severity: 'error' | 'warning';
  message: string;
  episodeNumber?: number;
  sceneId?: string;
}

export interface ValidationPhaseBaseline {
  sourceAnalysisHash: string;
  seasonPlanHash: string;
  findingFingerprints: string[];
  errorFingerprints: string[];
}

function hashStable(value: unknown): string {
  const text = stableStringify(value ?? null);
  try {
    return sha256Hex(text);
  } catch {
    return stableHash(text);
  }
}

export function normalizeFidelityFinding(finding: FidelityFinding): NormalizedFidelityFinding {
  const out: NormalizedFidelityFinding = {
    validator: finding.validator,
    severity: finding.severity,
    message: finding.message,
  };
  if (typeof finding.episodeNumber === 'number') out.episodeNumber = finding.episodeNumber;
  if (finding.sceneId) out.sceneId = finding.sceneId;
  return out;
}

export function fidelityFindingFingerprint(finding: FidelityFinding | NormalizedFidelityFinding): string {
  return hashStable(normalizeFidelityFinding(finding as FidelityFinding));
}

export function buildValidationPhaseBaseline(input: {
  sourceAnalysis?: SourceMaterialAnalysis;
  seasonPlan?: SeasonPlan;
  findings?: FidelityFinding[];
}): ValidationPhaseBaseline {
  const findings = input.findings ?? [];
  return {
    sourceAnalysisHash: hashStable(input.sourceAnalysis ?? null),
    seasonPlanHash: hashStable(input.seasonPlan ?? null),
    findingFingerprints: findings.map(fidelityFindingFingerprint).sort(),
    errorFingerprints: findings
      .filter((finding) => finding.severity === 'error')
      .map(fidelityFindingFingerprint)
      .sort(),
  };
}

export function planArtifactsMatchBaseline(
  baseline: ValidationPhaseBaseline | undefined,
  current: Pick<ValidationPhaseBaseline, 'sourceAnalysisHash' | 'seasonPlanHash'>,
): boolean {
  return !!baseline
    && baseline.sourceAnalysisHash === current.sourceAnalysisHash
    && baseline.seasonPlanHash === current.seasonPlanHash;
}
