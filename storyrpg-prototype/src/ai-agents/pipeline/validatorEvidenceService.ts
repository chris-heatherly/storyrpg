import type { ValidatorEvidenceSummary } from '../../types/validation';
import {
  PipelineMemory,
  type ValidatorEvidenceBundle,
  type ValidatorEvidenceRequest,
  type ValidatorEvidenceMode,
} from './pipelineMemory';

export class ValidatorEvidenceService {
  constructor(private readonly memory: PipelineMemory) {}

  async recall(request: ValidatorEvidenceRequest): Promise<ValidatorEvidenceBundle> {
    return this.memory.recallForValidator(request);
  }

  summarize(bundle: ValidatorEvidenceBundle, evidenceMode: ValidatorEvidenceMode = 'advisory-memory'): ValidatorEvidenceSummary {
    return {
      validator: bundle.validator,
      lifecycle: bundle.lifecycle,
      evidenceMode,
      artifactIds: bundle.artifactIds,
      sourceSnippetCount: bundle.sourceSnippets.length,
      priorFailureCount: bundle.priorFailures.length,
      relatedFindingCount: bundle.relatedFindings.length,
      corroboratedFactCount: bundle.facts.length,
      confidence: bundle.confidence,
      provenance: bundle.provenance,
      retrievalWarnings: bundle.retrievalWarnings,
    };
  }
}
