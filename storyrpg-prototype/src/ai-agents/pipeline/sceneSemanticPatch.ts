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

function cloneScene(scene: SceneContent): SceneContent {
  return JSON.parse(JSON.stringify(scene)) as SceneContent;
}

function assertPatchText(text: string): void {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length < 12 || trimmed.length > 1400) {
    throw new Error(`Semantic patch text must contain 12-1400 characters; received ${trimmed.length}.`);
  }
}

/** Applies only structure-safe operations. Every reader-facing word comes from SceneWriter. */
export function applySceneSemanticPatch(
  scene: SceneContent,
  patch: SceneSemanticPatch,
): AppliedSceneSemanticPatch {
  const baseHash = stableHash(scene);
  if (patch.baseSceneHash !== baseHash) throw new Error('Semantic patch base scene hash is stale.');
  if (!Array.isArray(patch.operations) || patch.operations.length < 1 || patch.operations.length > 2) {
    throw new Error('Semantic patch must contain one or two operations.');
  }

  const candidate = cloneScene(scene);
  const changedBeatIds: string[] = [];
  const insertedBeatIds: string[] = [];
  const touchedIndexes: number[] = [];
  const originalIndexById = new Map(scene.beats.map((beat, index) => [beat.id, index]));
  let transitionOperations = 0;

  for (const [operationIndex, operation] of patch.operations.entries()) {
    assertPatchText(operation.text);
    if (operation.op === 'replace_transition_in') {
      transitionOperations += 1;
      if (transitionOperations > 1) throw new Error('Semantic patch may replace transitionIn only once.');
      candidate.transitionIn = operation.text.trim();
      continue;
    }
    if (operation.op !== 'replace_beat_text' && operation.op !== 'insert_beat_after') {
      throw new Error(`Unsupported semantic patch operation ${String(operation.op)}.`);
    }
    if (!operation.beatId) throw new Error(`${operation.op} requires beatId.`);
    const beatIndex = candidate.beats.findIndex((beat) => beat.id === operation.beatId);
    if (beatIndex < 0) throw new Error(`Semantic patch references unknown beat ${operation.beatId}.`);
    touchedIndexes.push(originalIndexById.get(operation.beatId)!);
    if (operation.op === 'replace_beat_text') {
      candidate.beats[beatIndex].text = operation.text.trim();
      changedBeatIds.push(operation.beatId);
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
    changedBeatIds.push(operation.beatId, insertedId);
    insertedBeatIds.push(insertedId);
  }

  if (touchedIndexes.length > 1 && Math.max(...touchedIndexes) - Math.min(...touchedIndexes) > 1) {
    throw new Error('Semantic patch may change only adjacent beats.');
  }
  candidate.startingBeatId = candidate.beats[0]?.id ?? candidate.startingBeatId;
  return {
    scene: candidate,
    changedBeatIds: [...new Set(changedBeatIds)],
    insertedBeatIds,
  };
}
