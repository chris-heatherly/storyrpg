import { describe, expect, it, vi } from 'vitest';
import { submitVariantBatch, submitWorkerJob } from './WorkerJobClient';
import type { WorkerJobStartRequest } from '../server/workerPayload';

const request: WorkerJobStartRequest = {
  protocolVersion: 2,
  mode: 'analysis',
  payload: {
    config: {},
    analysisInput: { sourceText: 'source', title: 'Title' },
  },
  idempotencyKey: 'analysis:title:fresh',
  storyTitle: 'Title',
  launchMetadata: { launchServiceVersion: 1, providerPolicy: 'configured' },
};

describe('submitWorkerJob', () => {
  it('is the typed owner of the worker admission endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, jobId: 'worker-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await expect(submitWorkerJob(request, { proxyUrl: 'http://localhost:3001/', fetchImpl })).resolves.toMatchObject({ jobId: 'worker-1' });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3001/worker-jobs/start', expect.objectContaining({ method: 'POST' }));
  });

  it('preserves typed admission diagnostics', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: 'Invalid worker start request',
      failureCode: 'generation_manifest_missing',
      issues: [{ path: 'payload.generationInput.manifest', message: 'required' }],
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    await expect(submitWorkerJob(request, { proxyUrl: 'http://localhost:3001', fetchImpl }))
      .rejects.toMatchObject({ failureCode: 'generation_manifest_missing' });
  });
});

describe('submitVariantBatch', () => {
  it('uses the atomic Variant Batch admission endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      batchId: 'batch-1',
      children: [{ jobId: 'worker-1', variantId: 'variant-1', ordinal: 1 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const batchRequest = {
      version: 1,
      kind: 'variant-batch',
      idempotencyKey: 'variant-batch:batch-1',
      storyTitle: 'Title',
      variantCount: 1,
      requests: [],
    } as never;

    await expect(submitVariantBatch(batchRequest, { proxyUrl: 'http://localhost:3001/', fetchImpl }))
      .resolves.toMatchObject({ batchId: 'batch-1' });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3001/worker-batches/start', expect.objectContaining({ method: 'POST' }));
  });
});
