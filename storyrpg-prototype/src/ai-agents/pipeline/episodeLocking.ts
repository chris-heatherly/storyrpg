import type { Episode } from '../../types';
import type { EpisodeCompletionLockEvidence } from './episodeCheckpoints';

export interface LockGeneratedEpisodeInput {
  episodeNumber: number;
  title: string;
  episode: Episode;
  hasEpisodeBrief: boolean;
  writeWatermark: boolean;
  validateRuntimeContract: () => Promise<void>;
  sealCanon: () => Promise<EpisodeCompletionLockEvidence | undefined>;
  writeCompletion: (lock: EpisodeCompletionLockEvidence) => Promise<void>;
}

export async function lockGeneratedEpisodeArtifact(
  input: LockGeneratedEpisodeInput,
): Promise<EpisodeCompletionLockEvidence> {
  if (!input.hasEpisodeBrief) {
    throw new Error(`Episode ${input.episodeNumber} cannot be locked without an episode brief for incremental contract validation.`);
  }

  await input.validateRuntimeContract();
  const canonLockEvidence = await input.sealCanon();
  const lockEvidence: EpisodeCompletionLockEvidence = {
    ...(canonLockEvidence ?? {}),
    runtimeContractPassed: true,
    incrementalContractArtifact: `episode-${input.episodeNumber}-incremental-contract.json`,
  };
  if (input.writeWatermark) {
    await input.writeCompletion(lockEvidence);
  }
  return lockEvidence;
}
