import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { registerGeneratorSettingsRoutes } = require('./generatorSettingsRoutes.js');

type Handler = (req: unknown, res: unknown) => void;

function buildApp(settingsFile: string) {
  const routes = new Map<string, Handler>();
  const app = {
    get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
    post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
    patch: (p: string, h: Handler) => routes.set(`PATCH ${p}`, h),
  };
  registerGeneratorSettingsRoutes(app, { settingsFile });
  return routes;
}

function call(routes: Map<string, Handler>, key: string, body?: unknown) {
  const result: { status: number; json?: any } = { status: 200 };
  const res = {
    status(code: number) { result.status = code; return this; },
    json(payload: unknown) { result.json = payload; return this; },
  };
  routes.get(key)!({ body }, res);
  return result;
}

describe('generator-settings routes', () => {
  let dir: string;
  let settingsFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-settings-'));
    settingsFile = path.join(dir, '.generator-settings.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('redacts key/token/secret-shaped values on GET', () => {
    fs.writeFileSync(settingsFile, JSON.stringify({
      fontSize: 16,
      apiKey: 'sk-super-secret-value',
      nested: { providerToken: 'tok-123456789012' },
    }));
    const routes = buildApp(settingsFile);
    const res = call(routes, 'GET /generator-settings');
    expect(res.status).toBe(200);
    expect(res.json.fontSize).toBe(16);
    expect(res.json.apiKey).toBe('[redacted]');
    expect(res.json.nested.providerToken).toBe('[redacted]');
    // The stored file keeps the real value — redaction is response-only.
    expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).apiKey).toBe('sk-super-secret-value');
  });

  it('rejects non-object bodies on POST/PATCH', () => {
    const routes = buildApp(settingsFile);
    expect(call(routes, 'POST /generator-settings', ['not', 'an', 'object']).status).toBe(400);
    expect(call(routes, 'PATCH /generator-settings', 'nope').status).toBe(400);
  });

  it('round-trip is safe: POSTing back a redacted GET never stores "[redacted]"', () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ apiKey: 'sk-real-value-12345', fontSize: 14 }));
    const routes = buildApp(settingsFile);
    const fetched = call(routes, 'GET /generator-settings').json;
    // Client edits fontSize and posts the whole (redacted) object back.
    const posted = call(routes, 'POST /generator-settings', { ...fetched, fontSize: 18 });
    expect(posted.status).toBe(200);
    const stored = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(stored.fontSize).toBe(18);
    expect(stored.apiKey).toBeUndefined(); // dropped, never "[redacted]"
  });

  it('PATCH merges, drops redacted values, and redacts the response', () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ apiKey: 'sk-real-value-12345', fontSize: 14 }));
    const routes = buildApp(settingsFile);
    const res = call(routes, 'PATCH /generator-settings', { fontSize: 20, otherToken: '[redacted]' });
    expect(res.status).toBe(200);
    expect(res.json.settings.apiKey).toBe('[redacted]'); // response redacted
    const stored = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(stored.apiKey).toBe('sk-real-value-12345'); // stored value intact
    expect(stored.fontSize).toBe(20);
    expect(stored.otherToken).toBeUndefined();
  });
});
