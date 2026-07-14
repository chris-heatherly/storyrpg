import { describe, expect, it } from 'vitest';
import {
  computeFailureFingerprint,
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
});
