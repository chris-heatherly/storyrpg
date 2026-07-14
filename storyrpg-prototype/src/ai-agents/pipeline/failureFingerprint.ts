import { stableHash } from './artifacts/store';
import { PipelineError, type PipelineFailureMetadata } from './errors';

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

/** Builds the terminal record without mutating the checkpoint supplied by the worker. */
export function nextFailureFingerprintRecord(input: {
  fingerprint: string;
  prior?: FailureFingerprintRecord | null;
  recordedAt?: string;
}): FailureFingerprintRecord {
  const sameFailure = input.prior?.fingerprint === input.fingerprint;
  return {
    fingerprint: input.fingerprint,
    resumeCount: sameFailure ? (input.prior?.resumeCount ?? 0) + 1 : 0,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
}

export function shouldRefuseIdenticalResume(input: {
  record?: FailureFingerprintRecord | null;
  hasRepairPatches: boolean;
}): boolean {
  if (!input.record?.fingerprint) return false;
  if (input.hasRepairPatches) return false;
  return (input.record.resumeCount ?? 0) >= 1;
}

export interface FailureResumeCheckpoint {
  steps?: Record<string, { status?: string }>;
  outputs?: Record<string, unknown>;
  resumeContext?: { changedInputs?: unknown[]; changedOutputs?: unknown[] };
}

/** Returns prior state or throws before an identical deterministic resume starts. */
export function guardFailureResume(checkpoint?: FailureResumeCheckpoint): FailureFingerprintRecord | undefined {
  const prior = checkpoint?.outputs?.failure_fingerprint as FailureFingerprintRecord | undefined;
  const hasRepairPatches = Boolean(
    checkpoint?.outputs?.payload_patch
    || checkpoint?.outputs?.outputs_patch
    || (Array.isArray(checkpoint?.resumeContext?.changedInputs) && checkpoint.resumeContext.changedInputs.length > 0)
    || (Array.isArray(checkpoint?.resumeContext?.changedOutputs) && checkpoint.resumeContext.changedOutputs.length > 0),
  );
  if (!shouldRefuseIdenticalResume({ record: prior, hasRepairPatches })) return prior;
  throw new PipelineError(
    `[DeterministicResumeLoop] Refusing resume of identical failure fingerprint ${prior!.fingerprint} without repair patches.`,
    'resume',
    {
      context: {
        failureKind: 'deterministic_resume_loop',
        failureFingerprint: prior!.fingerprint,
        resumeCount: prior!.resumeCount,
      },
      failure: {
        code: 'deterministic_resume_loop',
        ownerStage: 'packaging',
        retryClass: 'none',
        issueCodes: ['deterministic_resume_loop'],
        repairTarget: prior!.fingerprint,
      },
    },
  );
}
