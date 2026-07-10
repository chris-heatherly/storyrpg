import { memoryEvidenceModeForValidator, ARTIFACT_VALIDATOR_OWNERSHIP } from '../validators/validatorRegistry';
import type { FullCreativeBrief } from './FullStoryPipeline';
import type { ValidatorEvidenceService } from './validatorEvidenceService';
import type {
  ValidatorEvidenceBundle,
  ValidatorEvidenceRequest,
} from './pipelineMemory';
import type { RecallMode } from './memoryRecallRouter';
import type { PipelineMemoryArtifactKind, PipelineMemoryFactKind } from './artifactMemoryTypes';

function artifactKindsForValidator(validator: string): PipelineMemoryArtifactKind[] {
  return ARTIFACT_VALIDATOR_OWNERSHIP
    .filter((entry) => entry.validator === validator)
    .flatMap((entry) => entry.artifactKinds) as PipelineMemoryArtifactKind[];
}

function recallModeForEvidenceMode(
  evidenceMode: ReturnType<typeof memoryEvidenceModeForValidator>,
): RecallMode {
  if (evidenceMode === 'artifact-required') return 'exact-artifact-pointer';
  if (evidenceMode === 'corroborated-evidence') return 'facts-first';
  if (evidenceMode === 'advisory-memory') return 'validator-history';
  return 'artifact-projection';
}

export function buildValidatorEvidenceRequest(
  validator: string,
  lifecycle: string,
  brief?: FullCreativeBrief,
  overrides: Partial<ValidatorEvidenceRequest> = {},
): ValidatorEvidenceRequest {
  const evidenceMode = overrides.evidenceMode || memoryEvidenceModeForValidator(validator);
  const artifactKinds = overrides.artifactKinds?.length
    ? overrides.artifactKinds
    : artifactKindsForValidator(validator);
  const factKinds: PipelineMemoryFactKind[] | undefined = overrides.factKinds || (
    evidenceMode === 'corroborated-evidence' || evidenceMode === 'artifact-required'
      ? ['validator-failure', 'repair-learning', 'source-obligation']
      : ['validator-failure', 'repair-learning']
  );

  return {
    validator,
    lifecycle,
    storyId: overrides.storyId ?? brief?.story.title,
    episodeNumber: overrides.episodeNumber ?? brief?.episode?.number,
    sourceFingerprint: overrides.sourceFingerprint ?? brief?.multiEpisode?.sourceAnalysis?.sourceTitle,
    evidenceMode,
    recallMode: overrides.recallMode || recallModeForEvidenceMode(evidenceMode),
    artifactKinds,
    artifactIds: overrides.artifactIds,
    factKinds,
    factIds: overrides.factIds,
    topK: overrides.topK,
    maxPromptChars: overrides.maxPromptChars,
    queries: overrides.queries,
    datasets: overrides.datasets,
    nodeNames: overrides.nodeNames,
  };
}

export async function recallValidatorMemory(
  service: ValidatorEvidenceService,
  validator: string,
  lifecycle: string,
  brief?: FullCreativeBrief,
  overrides: Partial<ValidatorEvidenceRequest> = {},
): Promise<ValidatorEvidenceBundle> {
  return service.recall(buildValidatorEvidenceRequest(validator, lifecycle, brief, overrides));
}
