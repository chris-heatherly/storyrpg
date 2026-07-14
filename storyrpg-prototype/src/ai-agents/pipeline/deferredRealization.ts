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
 * Critical means the run must not advance past this scene: the task graph is
 * inconsistent (unknown task) or prohibited meaning is on the page where
 * downstream stages (choices, outcomes, media) would echo it. Missing evidence
 * — including on event and premise tasks — is NOT critical once the owner
 * escalation ladder is exhausted: the episode-level semantic contract
 * re-judges every canonical task with full-episode context and routes
 * repair_scene_prose / repair_choice repairs there, and the
 * DeferredRealizationHandoff safety net blocks packaging if a deferred task
 * ever escapes that re-evaluation. Aborting here instead used to discard every
 * previously passed scene (bite-me_2026-07-14T17-29-14 died at s1-3 holding
 * two validated scenes).
 */
export function isCriticalOwnerRealizationFinding(
  finding: RealizationTaskGateFinding,
  tasks: NarrativeRealizationTask[],
): boolean {
  const task = tasks.find((candidate) => candidate.id === finding.taskId);
  if (!task) return true;
  return (finding.matchedForbiddenAtoms?.length ?? 0) > 0;
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
