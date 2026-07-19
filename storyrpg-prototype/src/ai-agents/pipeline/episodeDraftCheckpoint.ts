import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { DeferredRealizationRecord } from './deferredRealization';
import {
  SCENE_CHECKPOINT_VERSION,
  sceneCommitContentHash,
  type SceneCommitReceipt,
} from './sceneCommit';
import { stableHash } from './artifacts/store';

export const EPISODE_DRAFT_CHECKPOINT_VERSION = 2;

export interface EpisodeDraftCheckpoint {
  version: typeof EPISODE_DRAFT_CHECKPOINT_VERSION;
  episodeNumber: number;
  blueprintId: string;
  contentContract: 'committed-scene-choice-encounter-v2';
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Array<[string, EncounterStructure]>;
  deferredRealizationRecords?: DeferredRealizationRecord[];
  sceneCommitReceipts: SceneCommitReceipt[];
}

export function buildEpisodeDraftCheckpoint(input: {
  episodeNumber: number;
  blueprintId?: string;
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
  deferredRealizationRecords?: DeferredRealizationRecord[];
  sceneCommitReceipts: SceneCommitReceipt[];
}): EpisodeDraftCheckpoint {
  return {
    version: EPISODE_DRAFT_CHECKPOINT_VERSION,
    episodeNumber: input.episodeNumber,
    blueprintId: input.blueprintId || `episode-${input.episodeNumber}`,
    contentContract: 'committed-scene-choice-encounter-v2',
    sceneContents: input.sceneContents,
    choiceSets: input.choiceSets,
    encounters: Array.from(input.encounters.entries()),
    deferredRealizationRecords: input.deferredRealizationRecords ?? [],
    sceneCommitReceipts: input.sceneCommitReceipts,
  };
}

/**
 * Rejects a checkpoint when it belongs to another episode/blueprint or was
 * written against another normalization contract. Legacy payloads remain
 * readable so existing worker jobs are not stranded during rollout.
 */
export function readEpisodeDraftCheckpoint(
  value: unknown,
  expected: { episodeNumber: number; blueprintId?: string; requireCommittedScenes?: boolean },
): Pick<EpisodeDraftCheckpoint, 'sceneContents' | 'choiceSets' | 'encounters' | 'deferredRealizationRecords' | 'sceneCommitReceipts'> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<EpisodeDraftCheckpoint>;
  const version = (value as { version?: number }).version;
  if (version === undefined || version === 1) {
    if (expected.requireCommittedScenes) return undefined;
    if (!Array.isArray(candidate.sceneContents) || !Array.isArray(candidate.choiceSets)) return undefined;
    return {
      sceneContents: candidate.sceneContents,
      choiceSets: candidate.choiceSets,
      encounters: Array.isArray(candidate.encounters) ? candidate.encounters : [],
      deferredRealizationRecords: Array.isArray(candidate.deferredRealizationRecords)
        ? candidate.deferredRealizationRecords
        : [],
      sceneCommitReceipts: [],
    };
  }
  if (
    candidate.version !== EPISODE_DRAFT_CHECKPOINT_VERSION
    || candidate.episodeNumber !== expected.episodeNumber
    || candidate.contentContract !== 'committed-scene-choice-encounter-v2'
    || (expected.blueprintId && candidate.blueprintId !== expected.blueprintId)
    || !Array.isArray(candidate.sceneContents)
    || !Array.isArray(candidate.choiceSets)
    || !Array.isArray(candidate.encounters)
    || !Array.isArray(candidate.sceneCommitReceipts)
  ) return undefined;
  const receiptByScene = new Map(candidate.sceneCommitReceipts.map((receipt) => [receipt.sceneId, receipt]));
  const choiceHashes = new Set(candidate.choiceSets.map((choiceSet) => stableHash(choiceSet)));
  const encounterHashes = new Map(candidate.encounters.map(([sceneId, encounter]) => [sceneId, stableHash(encounter)]));
  if (
    receiptByScene.size !== candidate.sceneCommitReceipts.length
    || receiptByScene.size !== candidate.sceneContents.length
    || candidate.sceneContents.some((scene) => {
      const receipt = receiptByScene.get(scene.sceneId);
      return !receipt
        || receipt.version !== SCENE_CHECKPOINT_VERSION
        || receipt.sceneHash !== sceneCommitContentHash(scene)
        || (receipt.choiceHash !== undefined && !choiceHashes.has(receipt.choiceHash))
        || (receipt.encounterHash !== undefined && encounterHashes.get(scene.sceneId) !== receipt.encounterHash);
    })
  ) {
    return undefined;
  }
  return {
    sceneContents: candidate.sceneContents,
    choiceSets: candidate.choiceSets,
    encounters: candidate.encounters,
    deferredRealizationRecords: Array.isArray(candidate.deferredRealizationRecords)
      ? candidate.deferredRealizationRecords
      : [],
    sceneCommitReceipts: candidate.sceneCommitReceipts,
  };
}
