import { describe, expect, it } from 'vitest';
import { fnv1a32Json } from './contentHash';
import {
  aggregateQaEvidence,
  markQaEvidenceStaleness,
  qaGradedContentHash,
  stampQaEvidence,
  type QaEvidenceCarrier,
} from './qaEvidenceStamp';
import { finalContractRepairInputHash } from '../remediation/finalContractRepair';

describe('qaEvidenceStamp (G9 evidence sync)', () => {
  const scenes = [{ id: 's1-1', beats: [{ id: 'b1', text: 'The taxi rattles away.' }] }];
  const choices = [{ id: 'c1', choices: [] }];

  it('stamps the graded content hash and stays fresh while content is unchanged', () => {
    const report: QaEvidenceCarrier = {};
    stampQaEvidence(report, qaGradedContentHash(scenes, choices));
    expect(report.qaEvidence?.gradedContentHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(report.qaEvidence?.stale).toBeUndefined();

    markQaEvidenceStaleness(report, qaGradedContentHash(scenes, choices), 'no mutation happened');
    expect(report.qaEvidence?.stale).toBeUndefined();
    expect(report.qaEvidence?.staleReason).toBeUndefined();
  });

  it('marks STALE when graded content is mutated after grading, and clears on restore', () => {
    const report: QaEvidenceCarrier = {};
    stampQaEvidence(report, qaGradedContentHash(scenes, choices));

    const mutated = [{ ...scenes[0], beats: [{ id: 'b1', text: 'Rewritten by continuity repair.' }] }];
    markQaEvidenceStaleness(report, qaGradedContentHash(mutated, choices), 'continuity repair mutated prose after grading');
    expect(report.qaEvidence?.stale).toBe(true);
    expect(report.qaEvidence?.staleReason).toContain('continuity repair');
    expect(report.qaEvidence?.currentContentHash).not.toBe(report.qaEvidence?.gradedContentHash);

    markQaEvidenceStaleness(report, qaGradedContentHash(scenes, choices), 'restored');
    expect(report.qaEvidence?.stale).toBeUndefined();
  });

  it('does nothing when a report was never stamped', () => {
    const report: QaEvidenceCarrier = {};
    markQaEvidenceStaleness(report, qaGradedContentHash(scenes, choices), 'irrelevant');
    expect(report.qaEvidence).toBeUndefined();
  });

  it('aggregate is stale iff any constituent episode stamp is stale', () => {
    const fresh = stampQaEvidence({}, qaGradedContentHash(scenes, choices)).qaEvidence!;
    const stale = stampQaEvidence({}, qaGradedContentHash(scenes, choices)).qaEvidence!;
    stale.stale = true;
    stale.staleReason = 'mutated';

    expect(aggregateQaEvidence([fresh, undefined])?.stale).toBeUndefined();
    const staleAggregate = aggregateQaEvidence([fresh, stale]);
    expect(staleAggregate?.stale).toBe(true);
    expect(staleAggregate?.staleReason).toContain('1/2');
    expect(aggregateQaEvidence([undefined, undefined])).toBeUndefined();
  });

  it('hash refactor parity: carry-forward hashes are unchanged by the shared primitive', () => {
    // Repair carry-forward candidates persist finalContractRepairInputHash
    // output across resumes; the delegation to fnv1a32Json must be
    // byte-identical or existing candidates would silently stop matching.
    for (const value of [[], {}, scenes, { episodes: [{ scenes }] }, 'text', 42]) {
      expect(finalContractRepairInputHash(value)).toBe(fnv1a32Json(value));
    }
    // Golden pin of the algorithm itself (FNV-1a 32 over JSON.stringify).
    expect(fnv1a32Json([])).toBe('fnv1a32:741638a5');
  });
});
