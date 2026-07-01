import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const require = createRequire(import.meta.url);
const { createGeneratedStoriesStatic, resolveGeneratedStoryPath } = require('./generatedStoriesStatic.js');
const express = require('express');

describe('resolveGeneratedStoryPath', () => {
  const root = path.join(os.tmpdir(), 'storyrpg-stories-root');

  it('resolves a normal request path inside the stories dir', () => {
    expect(resolveGeneratedStoryPath(root, '/run-1/story.json')).toBe(
      path.join(path.resolve(root), 'run-1', 'story.json'),
    );
  });

  it('resolves the root path itself', () => {
    expect(resolveGeneratedStoryPath(root, '/')).toBe(path.resolve(root));
  });

  it('rejects traversal that escapes the stories dir', () => {
    expect(resolveGeneratedStoryPath(root, '/../../../../etc/hosts')).toBeNull();
    expect(resolveGeneratedStoryPath(root, '/../proxy-server.js')).toBeNull();
    expect(resolveGeneratedStoryPath(root, '/run-1/../../.env')).toBeNull();
  });

  it('allows .. segments that stay inside the stories dir', () => {
    expect(resolveGeneratedStoryPath(root, '/run-1/../run-2/story.json')).toBe(
      path.join(path.resolve(root), 'run-2', 'story.json'),
    );
  });

  it('rejects null bytes and non-string paths', () => {
    expect(resolveGeneratedStoryPath(root, '/run-1/\0.json')).toBeNull();
    expect(resolveGeneratedStoryPath(root, undefined)).toBeNull();
  });
});

describe('generated-stories static middleware (raw HTTP — traversal repro)', () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpRoot: string;
  let storiesDir: string;

  // Raw http.request preserves `../` in the path (unlike browsers, which
  // normalize it away) — this mirrors how an attacker actually reaches the
  // route through ngrok/curl.
  function rawGet(rawPath: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}`, { method: 'GET', path: rawPath }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-static-'));
    storiesDir = path.join(tmpRoot, 'generated-stories');
    fs.mkdirSync(path.join(storiesDir, 'run-1'), { recursive: true });
    fs.writeFileSync(path.join(storiesDir, 'run-1', 'story.json'), JSON.stringify({ ok: true }));
    // Secret OUTSIDE the stories dir — must never be reachable.
    fs.writeFileSync(path.join(tmpRoot, 'secret.env'), 'PROVIDER_API_KEY=sk-secret');

    const app = express();
    app.use('/generated-stories', createGeneratedStoriesStatic({ storiesDir }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('serves a story file inside the dir with the right content type', async () => {
    const res = await rawGet('/generated-stories/run-1/story.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('404s literal ../ traversal out of the stories dir', async () => {
    const res = await rawGet('/generated-stories/../secret.env');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('sk-secret');
  });

  it('404s deep traversal to system files', async () => {
    const res = await rawGet('/generated-stories/../../../../../../etc/hosts');
    expect(res.status).toBe(404);
  });

  it('404s encoded %2e%2e traversal (stays encoded, never resolves)', async () => {
    const res = await rawGet('/generated-stories/%2e%2e/secret.env');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('sk-secret');
  });

  it('404s missing files inside the dir', async () => {
    const res = await rawGet('/generated-stories/run-1/missing.json');
    expect(res.status).toBe(404);
  });

  it('answers OPTIONS preflight with 204 and permissive CORS', async () => {
    const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(baseUrl, { method: 'OPTIONS', path: '/generated-stories/run-1/story.json' }, (r) => {
        r.resume();
        r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
