import type {
  GeneratedBeat,
  SceneContent,
  SceneSemanticPatch,
} from '../agents/SceneWriter';
import { stableHash } from './artifacts/store';

export interface AppliedSceneSemanticPatch {
  scene: SceneContent;
  changedBeatIds: string[];
  insertedBeatIds: string[];
}

/** Structured signal that the patch needed more edits than the current capacity tier allows. */
export class SemanticPatchOperationLimitError extends Error {
  readonly code = 'patch_operation_limit';

  constructor(message: string) {
    super(message);
    this.name = 'SemanticPatchOperationLimitError';
  }
}

function cloneScene(scene: SceneContent): SceneContent {
  return JSON.parse(JSON.stringify(scene)) as SceneContent;
}

function assertPatchText(text: string): void {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length < 12 || trimmed.length > 1400) {
    throw new Error(`Semantic patch text must contain 12-1400 characters; received ${trimmed.length}.`);
  }
  if (/^```|```$/m.test(trimmed)) {
    throw new Error('Semantic patch text must be reader-facing prose, not a fenced payload.');
  }
  if (/^\s*[\[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        throw new Error('Semantic patch text must be reader-facing prose, not serialized structured output.');
      }
    } catch (error) {
      if (error instanceof Error && /serialized structured output/.test(error.message)) throw error;
    }
  }
  if (/^\s*(?:BASE SCENE HASH|TARGET TASK|TARGET ATOMS|PATCHABLE SCENE WINDOW|FORBIDDEN CONSTRAINTS)\s*:/im.test(trimmed)) {
    throw new Error('Semantic patch text must not contain agent-facing patch metadata.');
  }
}

/** Applies only structure-safe operations. Every reader-facing word comes from SceneWriter. */
export function applySceneSemanticPatch(
  scene: SceneContent,
  patch: SceneSemanticPatch,
  maxOperations = 2,
): AppliedSceneSemanticPatch {
  const baseHash = stableHash(scene);
  if (patch.baseSceneHash !== baseHash) throw new Error('Semantic patch base scene hash is stale.');
  if (!Array.isArray(patch.operations) || patch.operations.length < 1 || patch.operations.length > maxOperations) {
    throw new SemanticPatchOperationLimitError(
      `Semantic patch must contain between one and ${maxOperations} operations.`,
    );
  }

  const candidate = cloneScene(scene);
  const changedBeatIds: string[] = [];
  const insertedBeatIds: string[] = [];
  const touchedIndexes: number[] = [];
  const originalIndexById = new Map(scene.beats.map((beat, index) => [beat.id, index]));
  const insertionTailByAnchor = new Map<string, string>();
  const evidenceBeatIdByOperation = new Map<number, string>();
  let transitionOperations = 0;

  for (const [operationIndex, operation] of patch.operations.entries()) {
    assertPatchText(operation.text);
    if (operation.op === 'replace_transition_in') {
      transitionOperations += 1;
      if (transitionOperations > 1) throw new Error('Semantic patch may replace transitionIn only once.');
      candidate.transitionIn = operation.text.trim();
      evidenceBeatIdByOperation.set(operationIndex, 'transitionIn');
      continue;
    }
    if (operation.op !== 'replace_beat_text' && operation.op !== 'insert_beat_after') {
      throw new Error(`Unsupported semantic patch operation ${String(operation.op)}.`);
    }
    if (!operation.beatId) throw new Error(`${operation.op} requires beatId.`);
    const originalIndex = originalIndexById.get(operation.beatId);
    if (originalIndex == null) throw new Error(`Semantic patch references beat ${operation.beatId} outside the immutable patch window.`);
    const insertionAnchorId = operation.op === 'insert_beat_after'
      ? insertionTailByAnchor.get(operation.beatId) ?? operation.beatId
      : operation.beatId;
    const beatIndex = candidate.beats.findIndex((beat) => beat.id === insertionAnchorId);
    if (beatIndex < 0) throw new Error(`Semantic patch references unknown beat ${operation.beatId}.`);
    touchedIndexes.push(originalIndex);
    if (operation.op === 'replace_beat_text') {
      candidate.beats[beatIndex].text = operation.text.trim();
      changedBeatIds.push(operation.beatId);
      evidenceBeatIdByOperation.set(operationIndex, operation.beatId);
      continue;
    }
    const current = candidate.beats[beatIndex];
    const insertedId = `${candidate.sceneId}-semantic-repair-${stableHash({ baseHash, operationIndex, text: operation.text }).slice(0, 12)}`;
    const inserted = {
      id: insertedId,
      text: operation.text.trim(),
      nextBeatId: current.nextBeatId,
    } as GeneratedBeat;
    current.nextBeatId = insertedId;
    candidate.beats.splice(beatIndex + 1, 0, inserted);
    insertionTailByAnchor.set(operation.beatId, insertedId);
    evidenceBeatIdByOperation.set(operationIndex, insertedId);
    changedBeatIds.push(operation.beatId, insertedId);
    insertedBeatIds.push(insertedId);
  }

  if (touchedIndexes.length > 1 && Math.max(...touchedIndexes) - Math.min(...touchedIndexes) > 1) {
    throw new Error('Semantic patch may change only adjacent beats.');
  }
  const candidateBeatIds = new Set(candidate.beats.map((beat) => beat.id));
  for (const claim of patch.claimedEvidence ?? []) {
    for (const ref of claim.beatIds ?? []) {
      const operationMatch = /^operation:(\d+)$/.exec(ref);
      if (operationMatch) {
        const operationIndex = Number(operationMatch[1]) - 1;
        if (!evidenceBeatIdByOperation.has(operationIndex)) {
          throw new Error(`Semantic patch claimed evidence from unknown operation ${operationMatch[1]}.`);
        }
        continue;
      }
      if (ref !== 'transitionIn' && !candidateBeatIds.has(ref)) {
        throw new Error(`Semantic patch claimed evidence from unknown beat ${ref}.`);
      }
    }
  }
  candidate.startingBeatId = candidate.beats[0]?.id ?? candidate.startingBeatId;
  return {
    scene: candidate,
    changedBeatIds: [...new Set(changedBeatIds)],
    insertedBeatIds,
  };
}
