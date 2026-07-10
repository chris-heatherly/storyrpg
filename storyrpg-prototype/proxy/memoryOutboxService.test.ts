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
});
