import type { NarrativeRealizationOwnerStage, NarrativeRealizationTask } from '../../types/narrativeContract';
import type { RealizationTaskGateFinding } from './realizationTaskGate';

export type DeferredRealizationReason = 'owner_repair_exhausted' | 'semantic_inconclusive';

/** Durable handoff from an owner phase to the authoritative final semantic repair loop. */
export interface DeferredRealizationRecord {
  schemaVersion: 1;
  episodeNumber: number;
  sceneId: string;
  taskId: string;
  ownerStage: NarrativeRealizationOwnerStage;
  repairHandler: NarrativeRealizationTask['repairHandler'];
  reason: DeferredRealizationReason;
  candidateHash: string;
  finding: RealizationTaskGateFinding;
}

/**
 * Every blocking owner finding is critical at the scene boundary. Advancing
 * with missing meaning would force an episode/final-stage rewrite after later
 * scenes had already consumed the defective handoff. The orchestrator may
 * invalidate and regenerate this scene plus its dependent suffix, but it may
 * not defer the finding and seal an incomplete artifact.
 */
export function isCriticalOwnerRealizationFinding(
  finding: RealizationTaskGateFinding,
  tasks: NarrativeRealizationTask[],
): boolean {
  void finding;
  void tasks;
  return true;
}

export function buildDeferredRealizationRecord(input: {
  episodeNumber: number;
  sceneId: string;
  candidateHash: string;
  finding: RealizationTaskGateFinding;
  tasks: NarrativeRealizationTask[];
  reason: DeferredRealizationReason;
}): DeferredRealizationRecord {
  const task = input.tasks.find((candidate) => candidate.id === input.finding.taskId);
  if (!task) {
    throw new Error(`Cannot defer realization finding ${input.finding.fingerprint}: task ${input.finding.taskId} is missing.`);
  }
  return {
    schemaVersion: 1,
    episodeNumber: input.episodeNumber,
    sceneId: input.sceneId,
    taskId: task.id,
    ownerStage: task.ownerStage,
    repairHandler: task.repairHandler,
    reason: input.reason,
    candidateHash: input.candidateHash,
    finding: input.finding,
  };
}

export function appendDeferredRealizationRecord(
  records: DeferredRealizationRecord[],
  record: DeferredRealizationRecord,
): void {
  const key = `${record.taskId}::${record.sceneId}::${record.finding.fingerprint}`;
  if (records.some((candidate) =>
    `${candidate.taskId}::${candidate.sceneId}::${candidate.finding.fingerprint}` === key)) return;
  records.push(record);
}

export function mergeDeferredRealizationRecords(
  target: DeferredRealizationRecord[],
  incoming: DeferredRealizationRecord[] | undefined,
): void {
  for (const record of incoming ?? []) appendDeferredRealizationRecord(target, record);
  target.sort((left, right) =>
    left.episodeNumber - right.episodeNumber
    || left.sceneId.localeCompare(right.sceneId)
    || left.taskId.localeCompare(right.taskId));
}
