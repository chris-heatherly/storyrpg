import type { Episode } from '../../types';
import type { ArtifactValidationSummary } from './artifacts';
import type { EpisodeCompletionLockEvidence } from './episodeCheckpoints';

export interface LockGeneratedEpisodeInput {
  episodeNumber: number;
  title: string;
  episode: Episode;
  hasEpisodeBrief: boolean;
  writeWatermark: boolean;
  validateRuntimeContract: () => Promise<ArtifactValidationSummary>;
  sealCanon: () => Promise<EpisodeCompletionLockEvidence | undefined>;
  writeCompletion: (lock: EpisodeCompletionLockEvidence, validation: ArtifactValidationSummary) => Promise<void>;
}

export function validateEpisodeOutputBoundary(episode: Episode): string[] {
  const issues: string[] = [];
  if (!episode || !Number.isInteger(episode.number) || episode.number < 1) {
    issues.push('episode.number must be a positive integer');
  }
  if (!episode?.id || !episode.title) issues.push('episode.id and episode.title are required');
  if (!Array.isArray(episode?.scenes) || episode.scenes.length === 0) {
    issues.push('episode.scenes must contain at least one scene');
    return issues;
  }
  const sceneIds = new Set<string>();
  for (const scene of episode.scenes) {
    if (!scene?.id) issues.push('every scene must have an id');
    else if (sceneIds.has(scene.id)) issues.push(`duplicate scene id: ${scene.id}`);
    else sceneIds.add(scene.id);
    if (!Array.isArray(scene?.beats)) issues.push(`scene ${scene?.id || '<unknown>'} must have a beats array`);
    const isEncounterScene = Boolean(scene?.encounter);
    if (isEncounterScene) {
      if (!scene.encounter?.startingPhaseId || !Array.isArray(scene.encounter.phases) || scene.encounter.phases.length === 0) {
        issues.push(`encounter scene ${scene?.id || '<unknown>'} must have a starting phase and phases`);
      }
    } else if (!scene?.startingBeatId || !scene.beats.some((beat) => beat.id === scene.startingBeatId)) {
      issues.push(`scene ${scene?.id || '<unknown>'} must have a valid startingBeatId`);
    }
  }
  return issues;
}

export async function lockGeneratedEpisodeArtifact(
  input: LockGeneratedEpisodeInput,
): Promise<EpisodeCompletionLockEvidence> {
  if (!input.hasEpisodeBrief) {
    throw new Error(`Episode ${input.episodeNumber} cannot be locked without an episode brief for incremental contract validation.`);
  }

  const boundaryIssues = validateEpisodeOutputBoundary(input.episode);
  if (boundaryIssues.length > 0) {
    throw new Error(`Episode ${input.episodeNumber} output boundary failed: ${boundaryIssues.join('; ')}`);
  }

  const validation = await input.validateRuntimeContract();
  const canonLockEvidence = await input.sealCanon();
  const lockEvidence: EpisodeCompletionLockEvidence = {
    ...(canonLockEvidence ?? {}),
    runtimeContractPassed: true,
    incrementalContractArtifact: `episode-${input.episodeNumber}-incremental-contract.json`,
  };
  if (input.writeWatermark) {
    await input.writeCompletion(lockEvidence, validation);
  }
  return lockEvidence;
}
