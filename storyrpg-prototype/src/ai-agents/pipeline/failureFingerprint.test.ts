import { describe, expect, it } from 'vitest';
import {
  computeFailureFingerprint,
  guardFailureResume,
  nextFailureFingerprintRecord,
  shouldRefuseIdenticalResume,
} from './failureFingerprint';

describe('failureFingerprint', () => {
  it('is stable for the same failure identity', () => {
    const a = computeFailureFingerprint({
      code: 'prose_realization_failed',
      ownerStage: 'scene_writer',
      repairTarget: 'task:1',
      issueCodes: ['SEMANTIC_REALIZATION_MISSING'],
      phase: 'scenes',
      message: 'missing atom',
    });
    const b = computeFailureFingerprint({
      code: 'prose_realization_failed',
      ownerStage: 'scene_writer',
      repairTarget: 'task:1',
      issueCodes: ['SEMANTIC_REALIZATION_MISSING'],
      phase: 'scenes',
      message: 'missing atom',
    });
    expect(a).toBe(b);
  });

  it('refuses the second identical resume without patches', () => {
    expect(shouldRefuseIdenticalResume({
      record: { fingerprint: 'abc', resumeCount: 0, recordedAt: 't0' },
      hasRepairPatches: false,
    })).toBe(false);
    expect(shouldRefuseIdenticalResume({
      record: { fingerprint: 'abc', resumeCount: 1, recordedAt: 't0' },
      hasRepairPatches: false,
    })).toBe(true);
    expect(shouldRefuseIdenticalResume({
      record: { fingerprint: 'abc', resumeCount: 1, recordedAt: 't0' },
      hasRepairPatches: true,
    })).toBe(false);
  });

  it('increments only an identical resumed failure and resets for a new blocker', () => {
    const prior = { fingerprint: 'abc', resumeCount: 0, recordedAt: 't0' };
    expect(nextFailureFingerprintRecord({ fingerprint: 'abc', prior, recordedAt: 't1' })).toEqual({
      fingerprint: 'abc',
      resumeCount: 1,
      recordedAt: 't1',
    });
    expect(nextFailureFingerprintRecord({ fingerprint: 'different', prior, recordedAt: 't1' })).toEqual({
      fingerprint: 'different',
      resumeCount: 0,
      recordedAt: 't1',
    });
    expect(prior).toEqual({ fingerprint: 'abc', resumeCount: 0, recordedAt: 't0' });
  });

  it('guards hydrated worker checkpoints and recognizes explicit repair patches', () => {
    const record = { fingerprint: 'abc', resumeCount: 1, recordedAt: 't0' };
    expect(() => guardFailureResume({ outputs: { failure_fingerprint: record } }))
      .toThrow(/DeterministicResumeLoop/);
    expect(guardFailureResume({
      outputs: { failure_fingerprint: record },
      resumeContext: { changedInputs: ['config'] },
    })).toBe(record);
    expect(guardFailureResume({
      outputs: { failure_fingerprint: record },
      resumeContext: { changedOutputs: ['episode_blueprint'] },
    })).toBe(record);
  });
});
