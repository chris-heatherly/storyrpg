import { describe, expect, it, vi } from 'vitest';

import { KohyaAdapter } from './KohyaAdapter';
import type {
  LoraArtifact,
  LoraJobHandle,
  LoraTrainingRequest,
} from './LoraTrainerAdapter';

type FetchArgs = Parameters<typeof fetch>;

function makeFetch(responder: (url: string, init: RequestInit) => Response) {
  return vi.fn((...args: FetchArgs) => {
    const [url, init = {}] = args;
    const response = responder(String(url), init as RequestInit);
    return Promise.resolve(response);
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const BASE = 'http://proxy.test/lora-training';

const SAMPLE_REQUEST: LoraTrainingRequest = {
  storyId: 'story-1',
  kind: 'character',
  name: 'hero_abc123',
  fingerprint: 'abc123',
  trigger: 'hero_abc123',
  images: [
    { path: '/tmp/hero/front.png', caption: 'hero_abc123, front view, neutral lighting' },
    { path: '/tmp/hero/side.png', caption: 'hero_abc123, side view' },
  ],
  hyperparameters: { steps: 1500, rank: 32 },
};

const SAMPLE_HANDLE: LoraJobHandle = {
  jobId: 'job-1',
  storyId: 'story-1',
  name: 'hero_abc123',
  kind: 'character',
  fingerprint: 'abc123',
};

describe('KohyaAdapter', () => {
  it('posts the training request to /jobs and returns a handle', async () => {
    const fetchImpl = makeFetch((url, init) => {
      expect(url).toBe(`${BASE}/jobs`);
      expect(init.method).toBe('POST');
      const parsed = JSON.parse(String(init.body));
      expect(parsed.name).toBe('hero_abc123');
      expect(parsed.kind).toBe('character');
      expect(parsed.images).toHaveLength(2);
      expect(parsed.hyperparameters.steps).toBe(1500);
      return jsonResponse({ jobId: 'job-1' });
    });

    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl });
    const handle = await adapter.train(SAMPLE_REQUEST);

    expect(handle).toMatchObject({
      jobId: 'job-1',
      storyId: 'story-1',
      kind: 'character',
      name: 'hero_abc123',
      fingerprint: 'abc123',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('throws when the sidecar omits a jobId', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ error: 'nope' }));
    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl });
    await expect(adapter.train(SAMPLE_REQUEST)).rejects.toThrow(/jobId/);
  });

  it('forwards the apiKey as X-Lora-Trainer-Token', async () => {
    const fetchImpl = makeFetch((_url, init) => {
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Lora-Trainer-Token']).toBe('secret');
      return jsonResponse({ jobId: 'job-1' });
    });
    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, apiKey: 'secret', fetchImpl });
    await adapter.train(SAMPLE_REQUEST);
  });

  it('polls status and returns the parsed body', async () => {
    const fetchImpl = makeFetch((url, init) => {
      expect(url).toBe(`${BASE}/jobs/job-1`);
      expect(init.method).toBe('GET');
      return jsonResponse({ state: 'running', progress: 0.42, step: 630, totalSteps: 1500 });
    });
    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl });
    const status = await adapter.pollStatus(SAMPLE_HANDLE);
    expect(status.state).toBe('running');
    expect(status.progress).toBe(0.42);
    expect(status.step).toBe(630);
    expect(status.totalSteps).toBe(1500);
  });

  it('rejects malformed status bodies', async () => {
    const fetchImpl = makeFetch(() => jsonResponse({ progress: 0.5 }));
    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl });
    await expect(adapter.pollStatus(SAMPLE_HANDLE)).rejects.toThrow(/malformed status/);
  });

  it('fetchArtifact requires either filePath or data', async () => {
    const fetchImplOk = makeFetch(() =>
      jsonResponse({ filePath: '/srv/loras/hero_abc123.safetensors', sizeBytes: 120000 }),
    );
    const adapterOk = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl: fetchImplOk });
    const artifact = await adapterOk.fetchArtifact(SAMPLE_HANDLE);
    expect(artifact.filePath).toBe('/srv/loras/hero_abc123.safetensors');
    expect(artifact.sizeBytes).toBe(120000);

    const fetchImplBad = makeFetch(() => jsonResponse({ metadata: {} }));
    const adapterBad = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl: fetchImplBad });
    await expect(adapterBad.fetchArtifact(SAMPLE_HANDLE)).rejects.toThrow(
      /no artifact bytes or path/,
    );
  });

  it('installArtifact posts to the install endpoint without uploading bytes', async () => {
    const fetchImpl = makeFetch((url, init) => {
      expect(url).toBe(`${BASE}/loras/hero_abc123/install`);
      expect(init.method).toBe('POST');
      const parsed = JSON.parse(String(init.body));
      expect(parsed.filePath).toBe('/srv/loras/hero_abc123.safetensors');
      expect(parsed.data).toBeUndefined();
      return jsonResponse({ ok: true });
    });
    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl });
    const artifact: LoraArtifact = {
      name: 'hero_abc123',
      kind: 'character',
      fingerprint: 'abc123',
      storyId: 'story-1',
      filePath: '/srv/loras/hero_abc123.safetensors',
      data: 'IGNORED_WHEN_INSTALLING',
    };
    await adapter.installArtifact(artifact);
  });

  it('preflight returns ok=false with the error text on failure', async () => {
    const fetchImpl = makeFetch(
      () => new Response('boom', { status: 503, headers: { 'Content-Type': 'text/plain' } }),
    );
    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl });
    const result = await adapter.preflight();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/503/);
  });

  it('preflight returns the parsed body on success', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse({ ok: true, version: '1.0.0', availableBaseModels: ['sd_xl_base_1.0'] }),
    );
    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl });
    const result = await adapter.preflight();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('1.0.0');
    expect(result.availableBaseModels).toEqual(['sd_xl_base_1.0']);
  });

  it('wraps non-2xx responses in a descriptive error', async () => {
    const fetchImpl = makeFetch(
      () => new Response('nope', { status: 500, headers: { 'Content-Type': 'text/plain' } }),
    );
    const adapter = new KohyaAdapter({ proxyBaseUrl: BASE, fetchImpl });
    await expect(adapter.pollStatus(SAMPLE_HANDLE)).rejects.toThrow(
      /GET \/jobs\/job-1 failed \(500\)/,
    );
  });
});
