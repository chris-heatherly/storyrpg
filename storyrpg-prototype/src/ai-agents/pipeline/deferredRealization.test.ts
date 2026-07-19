import { describe, expect, it } from 'vitest';
import type { NarrativeRealizationTask } from '../../types/narrativeContract';

import {
  appendDeferredRealizationRecord,
  buildDeferredRealizationRecord,
  isCriticalOwnerRealizationFinding,
} from './deferredRealization';

const finding = {
  code: 'SEMANTIC_REALIZATION_MISSING' as const,
  taskId: 'task:theme',
  contractId: 'contract:theme',
  sceneId: 'scene-1',
  ownerStage: 'scene_writer' as const,
  blocking: true,
  field: 'beat_text',
  message: 'Theme pressure is not dramatized.',
  fingerprint: 'theme-fingerprint',
};

const themeTask: NarrativeRealizationTask = {
  id: 'task:theme',
  contractId: 'contract:theme',
  sourceKinds: ['treatment'],
  episodeNumber: 1,
  ownerStage: 'scene_writer' as const,
  repairHandler: 'scene_prose' as const,
  sceneId: 'scene-1',
  evidenceAtoms: [],
  target: { scope: 'owner' as const, surfaces: ['beat_text' as const] },
  sourceContractIds: ['source:theme'],
  blocking: true,
};

describe('deferred realization handoff', () => {
  it('treats every blocking owner finding as critical before scene commit', () => {
    expect(isCriticalOwnerRealizationFinding(finding, [themeTask])).toBe(true);
    expect(isCriticalOwnerRealizationFinding(finding, [{ ...themeTask, canonicalEventId: 'event:1' }])).toBe(true);
    expect(isCriticalOwnerRealizationFinding(finding, [{ ...themeTask, repairHandler: 'premise_realization' }])).toBe(true);
    expect(isCriticalOwnerRealizationFinding({ ...finding, taskId: 'task:unknown' }, [themeTask])).toBe(true);
    expect(isCriticalOwnerRealizationFinding(
      { ...finding, matchedForbiddenAtoms: ['atom:forbidden:1'] },
      [themeTask],
    )).toBe(true);
  });

  it('deduplicates a durable task/finding handoff', () => {
    const record = buildDeferredRealizationRecord({
      episodeNumber: 1,
      sceneId: 'scene-1',
      candidateHash: 'candidate',
      finding,
      tasks: [themeTask],
      reason: 'owner_repair_exhausted',
    });
    const records: typeof record[] = [];
    appendDeferredRealizationRecord(records, record);
    appendDeferredRealizationRecord(records, record);
    expect(records).toEqual([record]);
  });
});
