import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneContent } from '../agents/SceneWriter';

export const EPISODE_DRAFT_CHECKPOINT_VERSION = 1;

export interface EpisodeDraftCheckpoint {
  version: typeof EPISODE_DRAFT_CHECKPOINT_VERSION;
  episodeNumber: number;
  blueprintId: string;
  contentContract: 'normalized-scene-choice-encounter-v1';
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Array<[string, EncounterStructure]>;
}

export function buildEpisodeDraftCheckpoint(input: {
  episodeNumber: number;
  blueprintId?: string;
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
}): EpisodeDraftCheckpoint {
  return {
    version: EPISODE_DRAFT_CHECKPOINT_VERSION,
    episodeNumber: input.episodeNumber,
    blueprintId: input.blueprintId || `episode-${input.episodeNumber}`,
    contentContract: 'normalized-scene-choice-encounter-v1',
    sceneContents: input.sceneContents,
    choiceSets: input.choiceSets,
    encounters: Array.from(input.encounters.entries()),
  };
}

/**
 * Rejects a checkpoint when it belongs to another episode/blueprint or was
 * written against another normalization contract. Legacy payloads remain
 * readable so existing worker jobs are not stranded during rollout.
 */
export function readEpisodeDraftCheckpoint(
  value: unknown,
  expected: { episodeNumber: number; blueprintId?: string },
): Pick<EpisodeDraftCheckpoint, 'sceneContents' | 'choiceSets' | 'encounters'> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<EpisodeDraftCheckpoint>;
  if (candidate.version === undefined) {
    if (!Array.isArray(candidate.sceneContents) || !Array.isArray(candidate.choiceSets)) return undefined;
    return {
      sceneContents: candidate.sceneContents,
      choiceSets: candidate.choiceSets,
      encounters: Array.isArray(candidate.encounters) ? candidate.encounters : [],
    };
  }
  if (
    candidate.version !== EPISODE_DRAFT_CHECKPOINT_VERSION
    || candidate.episodeNumber !== expected.episodeNumber
    || candidate.contentContract !== 'normalized-scene-choice-encounter-v1'
    || (expected.blueprintId && candidate.blueprintId !== expected.blueprintId)
    || !Array.isArray(candidate.sceneContents)
    || !Array.isArray(candidate.choiceSets)
    || !Array.isArray(candidate.encounters)
  ) return undefined;
  return {
    sceneContents: candidate.sceneContents,
    choiceSets: candidate.choiceSets,
    encounters: candidate.encounters,
  };
}
