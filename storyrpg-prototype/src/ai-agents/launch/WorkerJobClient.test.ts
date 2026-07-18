import { describe, expect, it, vi } from 'vitest';
import { submitWorkerJob } from './WorkerJobClient';
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
