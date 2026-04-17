/**
 * Concrete `LoraTrainerAdapter` that speaks to a kohya_ss sidecar HTTP service.
 *
 * The sidecar is a small wrapper around `sd-scripts` that exposes five
 * endpoints (documented in `docs/LORA_TRAINING.md`):
 *   POST /lora-training/jobs            — submit a training job
 *   GET  /lora-training/jobs/:jobId     — poll status
 *   GET  /lora-training/jobs/:jobId/artifact — download safetensors
 *   POST /lora-training/loras/:name/install  — copy into A1111 models/Lora
 *   GET  /lora-training/preflight       — liveness + model discovery
 *
 * The app talks to the sidecar *through* the Express proxy at
 * `/lora-training/*` (see `proxy/loraTrainingRoutes.js`) so the API key and
 * origin never leak to the browser bundle — same pattern as
 * `stableDiffusionRoutes.js`.
 */

import { PROXY_CONFIG } from '../../../config/endpoints';
import type {
  LoraArtifact,
  LoraJobHandle,
  LoraJobStatus,
  LoraTrainerAdapter,
  LoraTrainerPreflightResult,
  LoraTrainingRequest,
} from './LoraTrainerAdapter';

export interface KohyaAdapterOptions {
  /**
   * Base URL of the proxy's lora-training prefix. Defaults to
   * `${PROXY_CONFIG.getProxyUrl()}/lora-training`.
   */
  proxyBaseUrl?: string;
  /** Optional bearer token forwarded to the sidecar via the proxy. */
  apiKey?: string;
  /** Request timeout in ms. Kept short — the sidecar streams long jobs. */
  timeoutMs?: number;
  /**
   * Optional `fetch` implementation for tests. Falls back to the global
   * `fetch` when omitted.
   */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function getDefaultProxyBase(): string {
  try {
    return `${PROXY_CONFIG.getProxyUrl()}/lora-training`;
  } catch {
    return 'http://localhost:3001/lora-training';
  }
}

export class KohyaAdapter implements LoraTrainerAdapter {
  public readonly id = 'kohya';

  private readonly proxyBaseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KohyaAdapterOptions = {}) {
    this.proxyBaseUrl = (options.proxyBaseUrl || getDefaultProxyBase()).replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fallback: typeof fetch | undefined =
      typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined;
    const impl = options.fetchImpl ?? fallback;
    if (!impl) {
      throw new Error('KohyaAdapter requires a global fetch or an explicit fetchImpl');
    }
    this.fetchImpl = impl;
  }

  async train(request: LoraTrainingRequest): Promise<LoraJobHandle> {
    const payload = {
      storyId: request.storyId,
      name: request.name,
      kind: request.kind,
      trigger: request.trigger,
      fingerprint: request.fingerprint,
      images: request.images,
      regularization: request.regularization ?? [],
      hyperparameters: request.hyperparameters ?? {},
      metadata: request.metadata ?? {},
    };
    const body = await this.request<{
      jobId: string;
      name?: string;
      storyId?: string;
      kind?: LoraTrainingRequest['kind'];
      fingerprint?: string;
    }>('POST', '/jobs', payload);
    if (!body?.jobId) {
      throw new Error('Kohya sidecar did not return a jobId');
    }
    return {
      jobId: body.jobId,
      storyId: body.storyId || request.storyId,
      name: body.name || request.name,
      kind: body.kind || request.kind,
      fingerprint: body.fingerprint || request.fingerprint,
    };
  }

  async pollStatus(handle: LoraJobHandle): Promise<LoraJobStatus> {
    const body = await this.request<LoraJobStatus>(
      'GET',
      `/jobs/${encodeURIComponent(handle.jobId)}`,
    );
    if (!body || typeof body.state !== 'string') {
      throw new Error(`Kohya sidecar returned malformed status for job ${handle.jobId}`);
    }
    return body;
  }

  async fetchArtifact(handle: LoraJobHandle): Promise<LoraArtifact> {
    const body = await this.request<{
      name?: string;
      kind?: LoraArtifact['kind'];
      fingerprint?: string;
      storyId?: string;
      filePath?: string;
      data?: string;
      sizeBytes?: number;
      metadata?: Record<string, unknown>;
    }>('GET', `/jobs/${encodeURIComponent(handle.jobId)}/artifact`);
    if (!body?.filePath && !body?.data) {
      throw new Error(
        `Kohya sidecar returned no artifact bytes or path for job ${handle.jobId}`,
      );
    }
    return {
      name: body.name || handle.name,
      kind: body.kind || handle.kind,
      fingerprint: body.fingerprint || handle.fingerprint,
      storyId: body.storyId || handle.storyId,
      filePath: body.filePath,
      data: body.data,
      sizeBytes: body.sizeBytes,
      metadata: body.metadata,
    };
  }

  async installArtifact(artifact: LoraArtifact): Promise<void> {
    await this.request<{ ok?: boolean }>(
      'POST',
      `/loras/${encodeURIComponent(artifact.name)}/install`,
      {
        name: artifact.name,
        kind: artifact.kind,
        fingerprint: artifact.fingerprint,
        storyId: artifact.storyId,
        filePath: artifact.filePath,
        // Intentionally omit `data` here — install is a server-side move/
        // symlink, not an upload. Upload path is a separate endpoint.
      },
    );
  }

  async cancel(handle: LoraJobHandle): Promise<void> {
    await this.request<{ ok?: boolean }>(
      'POST',
      `/jobs/${encodeURIComponent(handle.jobId)}/cancel`,
    );
  }

  async preflight(): Promise<LoraTrainerPreflightResult> {
    try {
      const body = await this.request<LoraTrainerPreflightResult>('GET', '/preflight');
      if (!body) return { ok: false, message: 'empty preflight response' };
      return body;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.proxyBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers['X-Lora-Trainer-Token'] = this.apiKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `Kohya sidecar ${method} ${path} failed (${response.status}): ${text.slice(0, 300)}`,
        );
      }
      if (!text) return undefined as unknown as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(
          `Kohya sidecar ${method} ${path} returned non-JSON body: ${text.slice(0, 200)}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
