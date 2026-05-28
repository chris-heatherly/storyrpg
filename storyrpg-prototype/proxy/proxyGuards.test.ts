import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// proxyGuards is a CommonJS module; load it via require for stable interop.
const require = createRequire(import.meta.url);
const { createCorsOptions, createExposureGuard, isLocalOrigin } = require('./proxyGuards.js');

function originDecision(env: Record<string, string>, origin: string | undefined): boolean {
  const opts = createCorsOptions(env);
  let allowed = false;
  opts.origin(origin, (err: Error | null, ok?: boolean) => {
    allowed = !err && !!ok;
  });
  return allowed;
}

function runGuard(
  env: Record<string, string>,
  req: { method: string; path: string; headers?: Record<string, string>; user?: unknown },
) {
  const mw = createExposureGuard(env);
  let status: number | null = null;
  let nexted = false;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };
  mw({ headers: {}, ...req }, res, () => {
    nexted = true;
  });
  return { status, nexted };
}

describe('proxyGuards CORS allowlist', () => {
  it('always allows localhost / 127.0.0.1 origins', () => {
    expect(originDecision({}, 'http://localhost:8081')).toBe(true);
    expect(originDecision({}, 'http://127.0.0.1:8082')).toBe(true);
    expect(isLocalOrigin('http://localhost:19006')).toBe(true);
  });

  it('allows requests with no Origin header (curl / same-origin)', () => {
    expect(originDecision({}, undefined)).toBe(true);
  });

  it('denies arbitrary external origins by default', () => {
    expect(originDecision({}, 'https://evil.example.com')).toBe(false);
  });

  it('allows explicitly allowlisted external origins', () => {
    expect(
      originDecision({ PROXY_ALLOWED_ORIGINS: 'https://reader.vercel.app' }, 'https://reader.vercel.app'),
    ).toBe(true);
  });

  it('reflects any origin only with the explicit escape hatch', () => {
    expect(originDecision({ PROXY_ALLOW_ALL_ORIGINS: '1' }, 'https://evil.example.com')).toBe(true);
  });
});

describe('proxyGuards exposure auth gate', () => {
  it('is a no-op when enforcement is off (local dev default)', () => {
    expect(runGuard({}, { method: 'DELETE', path: '/story/x' }).nexted).toBe(true);
  });

  it('blocks unauthenticated mutating requests when enforced', () => {
    const r = runGuard({ PROXY_REQUIRE_AUTH: '1' }, { method: 'DELETE', path: '/story/x' });
    expect(r.status).toBe(401);
    expect(r.nexted).toBe(false);
  });

  it('always allows safe methods and the auth/health endpoints', () => {
    expect(runGuard({ PROXY_REQUIRE_AUTH: '1' }, { method: 'GET', path: '/story/x' }).nexted).toBe(true);
    expect(runGuard({ PROXY_REQUIRE_AUTH: '1' }, { method: 'POST', path: '/auth/login' }).nexted).toBe(true);
    expect(runGuard({ PROXY_REQUIRE_AUTH: '1' }, { method: 'POST', path: '/' }).nexted).toBe(true);
  });

  it('allows an authenticated session', () => {
    expect(
      runGuard({ PROXY_REQUIRE_AUTH: '1' }, { method: 'POST', path: '/x', user: { id: 1 } }).nexted,
    ).toBe(true);
  });

  it('allows a valid PROXY_API_TOKEN bearer and rejects a wrong one', () => {
    expect(
      runGuard(
        { PROXY_REQUIRE_AUTH: '1', PROXY_API_TOKEN: 'secret' },
        { method: 'POST', path: '/x', headers: { authorization: 'Bearer secret' } },
      ).nexted,
    ).toBe(true);
    expect(
      runGuard(
        { PROXY_REQUIRE_AUTH: '1', PROXY_API_TOKEN: 'secret' },
        { method: 'POST', path: '/x', headers: { authorization: 'Bearer nope' } },
      ).status,
    ).toBe(401);
  });
});
