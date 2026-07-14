import { stableHash } from './artifacts/store';
import type { PipelineFailureMetadata } from './errors';

/** Stable identity for a terminal pipeline failure used by the resume loop-breaker. */
export function computeFailureFingerprint(input: {
  code?: string;
  ownerStage?: string;
  repairTarget?: string;
  issueCodes?: string[];
  phase?: string;
  message?: string;
}): string {
  return stableHash({
    code: input.code ?? 'unknown',
    ownerStage: input.ownerStage ?? '',
    repairTarget: input.repairTarget ?? '',
    issueCodes: [...(input.issueCodes ?? [])].sort(),
    phase: input.phase ?? '',
    // Keep message coarse — first 160 chars — so minor wording churn does not evade the breaker.
    message: (input.message ?? '').slice(0, 160),
  });
}

export function failureFingerprintFromMetadata(
  failure: Partial<PipelineFailureMetadata> & { phase?: string; message?: string },
): string {
  return computeFailureFingerprint({
    code: failure.code,
    ownerStage: failure.ownerStage,
    repairTarget: failure.repairTarget,
    issueCodes: failure.issueCodes,
    phase: failure.phase,
    message: failure.message,
  });
}

export interface FailureFingerprintRecord {
  fingerprint: string;
  /** How many resume attempts have already been started for this fingerprint. */
  resumeCount: number;
  recordedAt: string;
}

export function shouldRefuseIdenticalResume(input: {
  record?: FailureFingerprintRecord | null;
  hasRepairPatches: boolean;
}): boolean {
  if (!input.record?.fingerprint) return false;
  if (input.hasRepairPatches) return false;
  return (input.record.resumeCount ?? 0) >= 1;
}
