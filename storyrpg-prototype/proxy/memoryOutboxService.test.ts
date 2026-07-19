import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The proxy remains CommonJS; use its runtime export directly in this Node test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createMemoryOutboxService } = require('./memoryOutboxService');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('memory outbox service', () => {
  it('holds writes while story workers are active, then serially adds and cognifies them', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storyrpg-cognee-outbox-'));
    const lifecycle = { activeWorkers: new Map([['story-worker', {}]]) };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const service = createMemoryOutboxService({
      memoryRoot: root,
      lifecycle,
      baseUrl: 'http://cognee:8000',
      apiKey: 'ck_test',
      token: 'internal-token',
    });

    try {
      service.enqueue({ kind: 'validator', dataset: 'storyrpg-validator-history', title: 'Validation', text: 'Passed.' });
      expect(service.status().pending).toBe(1);

      lifecycle.activeWorkers.clear();
      await service.drain();

      expect(service.status()).toMatchObject({ pending: 0, completed: 1, deadLetter: 0, dirtyDatasets: 0 });
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        'http://cognee:8000/api/v1/add',
        'http://cognee:8000/api/v1/cognify',
      ]);
    } finally {
      service.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('backs off transient fetch failures instead of dead-lettering them immediately', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storyrpg-cognee-outbox-'));
    const lifecycle = { activeWorkers: new Map() };
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    const service = createMemoryOutboxService({
      memoryRoot: root,
      lifecycle,
      baseUrl: 'http://cognee:8000',
      apiKey: 'ck_test',
      token: 'internal-token',
    });

    try {
      service.enqueue({ kind: 'validator', dataset: 'storyrpg-validator-history', title: 'Validation', text: 'Passed.' });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(service.status()).toMatchObject({ pending: 1, processing: 0, completed: 0, deadLetter: 0 }));
    } finally {
      service.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('configures Cognee with the queued narrative model before adding a record', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storyrpg-cognee-outbox-'));
    const lifecycle = { activeWorkers: new Map([['story-worker', {}]]) };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const service = createMemoryOutboxService({
      memoryRoot: root,
      lifecycle,
      baseUrl: 'http://cognee:8000',
      apiKey: 'ck_test',
      token: 'internal-token',
      llmApiKeys: { gemini: 'gemini-key' },
    });

    try {
      service.enqueue({
        kind: 'validator', dataset: 'storyrpg-validator-history', title: 'Validation', text: 'Passed.',
        cogneeLlmTarget: { provider: 'gemini', model: 'gemini-2.5-flash' },
      });
      lifecycle.activeWorkers.clear();
      await service.drain();

      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        'http://cognee:8000/api/v1/settings',
        'http://cognee:8000/api/v1/add',
        'http://cognee:8000/api/v1/cognify',
      ]);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        llm: { provider: 'gemini', model: 'gemini/gemini-2.5-flash', apiKey: 'gemini-key' },
      });
    } finally {
      service.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('requeues dead letters for an explicit operator replay', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storyrpg-cognee-outbox-'));
    const lifecycle = { activeWorkers: new Map() };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'expired key' })
      .mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const service = createMemoryOutboxService({
      memoryRoot: root,
      lifecycle,
      baseUrl: 'http://cognee:8000',
      apiKey: 'ck_test',
      token: 'internal-token',
    });

    try {
      service.enqueue({ kind: 'validator', dataset: 'storyrpg-validator-history', title: 'Validation', text: 'Passed.' });
      await vi.waitFor(() => expect(service.status().deadLetter).toBe(1));
      expect(service.retryDeadLetters()).toMatchObject({ requeued: 1, deadLetter: 0 });
      await vi.waitFor(() => expect(service.status()).toMatchObject({ pending: 0, completed: 1, deadLetter: 0 }));
    } finally {
      service.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('recovers records interrupted in processing when the proxy restarts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storyrpg-cognee-outbox-'));
    const outboxRoot = path.join(root, 'cognee-outbox');
    await fs.mkdir(path.join(outboxRoot, 'processing'), { recursive: true });
    await fs.writeFile(path.join(outboxRoot, 'processing', 'interrupted.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'interrupted',
      createdAt: new Date().toISOString(),
      attempts: 1,
      record: { kind: 'validator', dataset: 'storyrpg-validator-history', title: 'Validation', text: 'Passed.' },
    }));
    const lifecycle = { activeWorkers: new Map() };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const service = createMemoryOutboxService({
      memoryRoot: root,
      lifecycle,
      baseUrl: 'http://cognee:8000',
      apiKey: 'ck_test',
      token: 'internal-token',
    });

    try {
      await service.drain();
      expect(service.status()).toMatchObject({ pending: 0, processing: 0, completed: 1, deadLetter: 0 });
    } finally {
      service.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
