import type {
  VariantBatchStartRequest,
  VariantBatchStartResponse,
  WorkerJobStartRequest,
  WorkerJobStartResponse,
} from '../server/workerPayload';

export interface SubmitWorkerJobOptions {
  proxyUrl: string;
  fetchImpl?: typeof fetch;
  credentials?: RequestCredentials;
}

/** Shared HTTP admission client for Generator UX and headless tools. */
export async function submitWorkerJob(
  request: WorkerJobStartRequest,
  options: SubmitWorkerJobOptions,
): Promise<WorkerJobStartResponse> {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${options.proxyUrl.replace(/\/$/, '')}/worker-jobs/start`, {
    method: 'POST',
    credentials: options.credentials,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: string;
      failureCode?: string;
      issues?: Array<{ code?: string; path?: string; message?: string }>;
    } | null;
    const details = body?.issues?.map((issue) => `${issue.path || '$'}: ${issue.message || issue.code || 'invalid'}`).join(' | ');
    const error = new Error(
      `${body?.error || 'Failed to start worker job'} (${response.status})${details ? `: ${details}` : ''}`,
    ) as Error & { failureCode?: string; issues?: unknown };
    error.failureCode = body?.failureCode;
    error.issues = body?.issues;
    throw error;
  }
  const result = await response.json() as WorkerJobStartResponse;
  if (!result.jobId) throw new Error('Worker start response missing jobId');
  return result;
}

/** Submit one atomic Variant Batch containing ordinary generation jobs. */
export async function submitVariantBatch(
  request: VariantBatchStartRequest,
  options: SubmitWorkerJobOptions,
): Promise<VariantBatchStartResponse> {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${options.proxyUrl.replace(/\/$/, '')}/worker-batches/start`, {
    method: 'POST',
    credentials: options.credentials,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: string;
      failureCode?: string;
      issues?: Array<{ code?: string; path?: string; message?: string }>;
    } | null;
    const details = body?.issues?.map((issue) => `${issue.path || '$'}: ${issue.message || issue.code || 'invalid'}`).join(' | ');
    const error = new Error(
      `${body?.error || 'Failed to start Variant Batch'} (${response.status})${details ? `: ${details}` : ''}`,
    ) as Error & { failureCode?: string; issues?: unknown };
    error.failureCode = body?.failureCode;
    error.issues = body?.issues;
    throw error;
  }
  const result = await response.json() as VariantBatchStartResponse;
  if (!result.batchId || !Array.isArray(result.children)) {
    throw new Error('Variant Batch start response is malformed');
  }
  return result;
}
