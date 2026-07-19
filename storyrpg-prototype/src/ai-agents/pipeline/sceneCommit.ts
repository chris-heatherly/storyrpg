import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import { stableHash } from './artifacts/store';
import { buildRealizedSceneSummary } from './realizedContext';
import type { SceneCriticReviewOutcome } from './sceneCriticContinuity';

export const SCENE_CHECKPOINT_VERSION = 2;

export interface SceneCommitReceipt {
  version: typeof SCENE_CHECKPOINT_VERSION;
  episodeNumber: number;
  sceneId: string;
  committedAt: string;
  sceneHash: string;
  choiceHash?: string;
  encounterHash?: string;
  handoffHash: string;
  critic: {
    disposition: SceneCriticReviewOutcome['disposition'];
    rewrittenBeatIds: string[];
    reason?: string;
  };
}

export interface SceneCheckpointEnvelope {
  version: typeof SCENE_CHECKPOINT_VERSION;
  contentContract: 'committed-scene-v2';
  scene: SceneContent;
  receipt: SceneCommitReceipt;
}

export interface DecodedSceneCheckpoint {
  scene: SceneContent;
  receipt?: SceneCommitReceipt;
  legacy: boolean;
}

/** Hash the complete authored scene artifact. Nothing narrative or mechanical
 * may be added to a scene after this receipt is issued; media is bound to the
 * assembled Story/Episode projection and therefore is not present here. */
export function sceneCommitContentHash(scene: SceneContent): string {
  return stableHash(scene);
}

export function sceneHandoffHash(scene: SceneContent, blueprint?: SceneBlueprint): string {
  return stableHash({
    summary: buildRealizedSceneSummary(scene, blueprint),
  });
}

export function buildSceneCommitReceipt(input: {
  episodeNumber: number;
  scene: SceneContent;
  blueprint?: SceneBlueprint;
  choiceSet?: ChoiceSet;
  encounter?: EncounterStructure;
  critic: SceneCriticReviewOutcome;
  committedAt?: string;
}): SceneCommitReceipt {
  return {
    version: SCENE_CHECKPOINT_VERSION,
    episodeNumber: input.episodeNumber,
    sceneId: input.scene.sceneId,
    committedAt: input.committedAt ?? new Date().toISOString(),
    sceneHash: sceneCommitContentHash(input.scene),
    ...(input.choiceSet ? { choiceHash: stableHash(input.choiceSet) } : {}),
    ...(input.encounter ? { encounterHash: stableHash(input.encounter) } : {}),
    handoffHash: sceneHandoffHash(input.scene, input.blueprint),
    critic: {
      disposition: input.critic.disposition,
      rewrittenBeatIds: [...input.critic.rewrittenBeatIds],
      ...(input.critic.reason ? { reason: input.critic.reason } : {}),
    },
  };
}

export function buildSceneCheckpointEnvelope(
  scene: SceneContent,
  receipt: SceneCommitReceipt,
): SceneCheckpointEnvelope {
  return {
    version: SCENE_CHECKPOINT_VERSION,
    contentContract: 'committed-scene-v2',
    scene,
    receipt,
  };
}

export function readSceneCheckpoint(value: unknown, blueprint?: SceneBlueprint): DecodedSceneCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SceneCheckpointEnvelope> & Partial<SceneContent>;
  if (candidate.version === SCENE_CHECKPOINT_VERSION && candidate.contentContract === 'committed-scene-v2') {
    if (!candidate.scene || !candidate.receipt) return undefined;
    if (!sceneCommitReceiptMatches(candidate.receipt, candidate.scene, undefined, undefined, blueprint, { requireRelatedArtifacts: false })) return undefined;
    return { scene: candidate.scene, receipt: candidate.receipt, legacy: false };
  }
  if (typeof candidate.sceneId === 'string' && Array.isArray(candidate.beats)) {
    return { scene: candidate as SceneContent, legacy: true };
  }
  return undefined;
}

export function sceneCommitReceiptMatches(
  receipt: SceneCommitReceipt,
  scene: SceneContent,
  choiceSet?: ChoiceSet,
  encounter?: EncounterStructure,
  blueprint?: SceneBlueprint,
  options: { requireRelatedArtifacts?: boolean } = {},
): boolean {
  const requireRelatedArtifacts = options.requireRelatedArtifacts ?? true;
  return receipt.version === SCENE_CHECKPOINT_VERSION
    && receipt.sceneId === scene.sceneId
    && receipt.sceneHash === sceneCommitContentHash(scene)
    && receipt.handoffHash === sceneHandoffHash(scene, blueprint)
    && (receipt.choiceHash === undefined || (!requireRelatedArtifacts && choiceSet === undefined) || (choiceSet !== undefined && receipt.choiceHash === stableHash(choiceSet)))
    && (receipt.encounterHash === undefined || (!requireRelatedArtifacts && encounter === undefined) || (encounter !== undefined && receipt.encounterHash === stableHash(encounter)));
}

export interface SceneCommitMutation {
  sceneId: string;
  surfaces: Array<'scene' | 'choice' | 'encounter' | 'handoff'>;
}

/** Compare the live episode draft with its scene receipts without mutating it. */
export function findSceneCommitMutations(input: {
  receipts: SceneCommitReceipt[];
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
  blueprintScenes?: SceneBlueprint[];
}): SceneCommitMutation[] {
  const sceneById = new Map(input.sceneContents.map((scene) => [scene.sceneId, scene]));
  const blueprintById = new Map((input.blueprintScenes ?? []).map((scene) => [scene.id, scene]));
  const mutations: SceneCommitMutation[] = [];
  for (const receipt of input.receipts) {
    const scene = sceneById.get(receipt.sceneId);
    const choiceSet = input.choiceSets.find((candidate) => candidate.sceneId === receipt.sceneId);
    const encounter = input.encounters.get(receipt.sceneId);
    const surfaces: SceneCommitMutation['surfaces'] = [];
    if (!scene || receipt.sceneHash !== sceneCommitContentHash(scene)) surfaces.push('scene');
    if (scene && receipt.handoffHash !== sceneHandoffHash(scene, blueprintById.get(receipt.sceneId))) surfaces.push('handoff');
    if (receipt.choiceHash !== undefined && (!choiceSet || receipt.choiceHash !== stableHash(choiceSet))) surfaces.push('choice');
    if (receipt.encounterHash !== undefined && (!encounter || receipt.encounterHash !== stableHash(encounter))) surfaces.push('encounter');
    if (surfaces.length > 0) mutations.push({ sceneId: receipt.sceneId, surfaces });
  }
  return mutations;
}

/** Hard boundary used after every post-content phase. A caller may invalidate
 * and regenerate the reported suffix, but it may not refresh the receipt. */
export function assertNoCommittedSceneMutation(
  phase: string,
  input: Parameters<typeof findSceneCommitMutations>[0],
): void {
  const mutations = findSceneCommitMutations(input);
  if (mutations.length === 0) return;
  const detail = mutations
    .map((mutation) => `${mutation.sceneId}[${mutation.surfaces.join(',')}]`)
    .join(', ');
  throw new Error(`Committed scene mutation detected after ${phase}: ${detail}. Invalidate and regenerate the dependent suffix instead.`);
}
