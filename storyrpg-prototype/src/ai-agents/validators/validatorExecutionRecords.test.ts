import { describe, expect, it } from 'vitest';
import {
  createValidatorExecutionRecord,
  validatorExecutionIssuesFromIssues,
} from './validatorExecutionRecords';

describe('validator execution ownership records', () => {
  it('preserves canonical narrative task ownership without deriving it from prose', () => {
    const [issue] = validatorExecutionIssuesFromIssues([{
      severity: 'error',
      message: 'Human-readable wording may change.',
      metadata: {
        issueCode: 'OWNER_REALIZATION_MISSING',
        taskId: 'task:event-1:owner-event',
        contractId: 'event-1',
        ownerStage: 'scene_writer',
        retryClass: 'repair_scene_prose',
        repairHandler: 'scene_prose',
        sceneId: 's1-2',
        findingFingerprint: 'OWNER_REALIZATION_MISSING::task:event-1:owner-event::s1-2',
      },
    }]);

    expect(issue).toMatchObject({
      code: 'OWNER_REALIZATION_MISSING',
      ownership: {
        contractId: 'event-1',
        ownerStage: 'scene_writer',
        repairHandler: 'scene_prose',
      },
    });
  });

  it('records policy identity, execution mode, artifact provenance, and timing', () => {
    const record = createValidatorExecutionRecord({
      validatorId: 'NarrativeContractValidator',
      lifecycle: 'final-contract',
      role: 'regression-net',
      placement: 'season-final',
      artifactRefs: ['runtime-episode:ep1@rev4'],
      durationMs: 12,
      issues: [],
    });

    expect(record).toMatchObject({
      policyId: 'NarrativeContractValidator@final',
      mode: 'audit',
      artifactRefs: ['runtime-episode:ep1@rev4'],
      durationMs: 12,
      passed: true,
    });
  });

  it('persists immutable owner-stage realization receipts', () => {
    const realizationReceipt = {
      sceneId: 'enc-1',
      ownerStage: 'encounter_architect' as const,
      candidateHash: 'candidate-hash',
      taskIds: ['task:transition:enc-1'],
      findingFingerprints: [],
    };
    const record = createValidatorExecutionRecord({
      validatorId: 'NarrativeRealizationTaskGate',
      lifecycle: 'episode-contract',
      role: 'primary',
      placement: 'scene',
      passed: true,
      realizationReceipt,
      issues: [],
    });

    expect(record.realizationReceipt).toEqual(realizationReceipt);
  });
});
