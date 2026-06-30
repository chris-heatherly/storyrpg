import { describe, expect, it, vi } from 'vitest';

import { ValidatorEvidenceService } from './validatorEvidenceService';
import type { PipelineMemory } from './pipelineMemory';

describe('ValidatorEvidenceService', () => {
  it('normalizes Cognee retrieval into an audit summary without pass/fail authority', async () => {
    const recallForValidator = vi.fn(async () => ({
      validator: 'SceneGraphBranchValidator',
      lifecycle: 'scene-graph',
      artifactIds: ['episode-blueprint'],
      facts: [],
      priorFailures: ['Prior failure: branch fan-out collapsed.'],
      relatedFindings: ['Finding: branch target was missing.'],
      sourceSnippets: ['Prior failure: branch fan-out collapsed.'],
      confidence: 0.35,
      provenance: [{
        query: 'branch failures',
        datasets: ['storyrpg-validator-history'],
        nodeNames: ['validator:SceneGraphBranchValidator'],
        resultCount: 1,
      }],
      retrievalWarnings: ['Cognee evidence must be corroborated against current typed artifacts before deterministic use.'],
    }));
    const service = new ValidatorEvidenceService({ recallForValidator } as unknown as PipelineMemory);

    const bundle = await service.recall({
      validator: 'SceneGraphBranchValidator',
      lifecycle: 'scene-graph',
      artifactIds: ['episode-blueprint'],
      evidenceMode: 'corroborated-evidence',
    });
    const summary = service.summarize(bundle, 'corroborated-evidence');

    expect(bundle.facts).toEqual([]);
    expect(summary).toMatchObject({
      validator: 'SceneGraphBranchValidator',
      evidenceMode: 'corroborated-evidence',
      sourceSnippetCount: 1,
      priorFailureCount: 1,
      corroboratedFactCount: 0,
      confidence: 0.35,
    });
  });
});
