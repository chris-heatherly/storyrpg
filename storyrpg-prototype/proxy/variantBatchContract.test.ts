import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateVariantBatchStartRequest } = require('./variantBatchContract.js');

function child(ordinal: number, total = 4) {
  const manifest = { version: 1, sourceKind: 'authored_lite', requestedEpisodes: [1] };
  return {
    protocolVersion: 2,
    mode: 'generation',
    payload: {
      config: { generation: { assetGenerationMode: 'story-only' } },
      generationInput: {
        brief: { story: { title: 'Bite Me' }, generationManifest: manifest },
        manifest,
        runContext: {
          kind: 'variant', batchId: 'batch-1', variantId: `batch-1-v${ordinal}`,
          ordinal, total, sharedAnalysisHash: 'analysis-hash', sharedSeasonPlanHash: 'plan-hash',
        },
      },
    },
    idempotencyKey: `generation:bite-me:v${ordinal}`,
    storyTitle: 'Bite Me',
    episodeCount: 1,
    launchMetadata: { launchServiceVersion: 1, providerPolicy: 'configured' },
  };
}

describe('Variant Batch admission contract', () => {
  it('accepts four ordinary generation jobs with shared frozen inputs', () => {
    const request = {
      version: 1, kind: 'variant-batch', idempotencyKey: 'variant-batch:batch-1',
      storyTitle: 'Bite Me', variantCount: 4, requests: [1, 2, 3, 4].map((ordinal) => child(ordinal)),
    };
    expect(validateVariantBatchStartRequest(request)).toMatchObject({ ok: true, batchId: 'batch-1' });
  });

  it('rejects more than four variants and drift between child configs', () => {
    const requests = [1, 2, 3, 4].map((ordinal) => child(ordinal));
    requests[2].payload.config = { generation: { assetGenerationMode: 'full' } };
    const result = validateVariantBatchStartRequest({
      version: 1, kind: 'variant-batch', idempotencyKey: 'variant-batch:batch-1',
      storyTitle: 'Bite Me', variantCount: 5, requests,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'variant_batch_size_invalid' }),
      expect.objectContaining({ code: 'variant_batch_children_invalid' }),
    ]));

    const driftResult = validateVariantBatchStartRequest({
      version: 1, kind: 'variant-batch', idempotencyKey: 'variant-batch:batch-1',
      storyTitle: 'Bite Me', variantCount: 4, requests,
    });
    expect(driftResult.issues).toContainEqual(expect.objectContaining({ code: 'variant_batch_config_mismatch' }));
  });
});
