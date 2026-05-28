/**
 * Proxy security guards — CORS allowlist + opt-in exposure auth gate.
 *
 * Context (see docs/PROJECT_AUDIT_2026-05-28.md, landmine L1): the proxy binds
 * 0.0.0.0 and is reachable on the public internet whenever the ngrok tunnel
 * (PROXY_PUBLIC_URL) is up, yet it previously used `cors({origin:true,
 * credentials:true})` and had no auth on destructive / provider-key routes.
 *
 * These guards are designed to be SAFE FOR LOCAL DEV by default:
 *   - CORS: localhost / 127.0.0.1 (any port) are always allowed, plus any
 *     origins in PROXY_ALLOWED_ORIGINS. Arbitrary external origins are denied
 *     unless PROXY_ALLOW_ALL_ORIGINS=1 (legacy escape hatch).
 *   - Auth gate: OFF unless PROXY_REQUIRE_AUTH=1 (or NODE_ENV=production). When
 *     ON, mutating/sensitive requests require an authenticated session
 *     (req.user) or a valid PROXY_API_TOKEN bearer (for the worker/CLI).
 *
 * IMPORTANT: before exposing the proxy publicly (ngrok / deploy), set
 * PROXY_REQUIRE_AUTH=1 and a PROXY_API_TOKEN. Leave the tunnel off otherwise.
 */

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLocalOrigin(origin) {
  // http(s)://localhost[:port] or http(s)://127.0.0.1[:port] or [::1]
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

/**
 * Build a `cors` options object with an allowlist origin function.
 * Requests with no Origin header (curl, same-origin, server-to-server) are
 * allowed — CORS only governs browser cross-origin access.
 */
function createCorsOptions(env = process.env) {
  const allowAll = env.PROXY_ALLOW_ALL_ORIGINS === '1';
  const allowed = new Set(parseList(env.PROXY_ALLOWED_ORIGINS));

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true); // non-browser / same-origin
      if (allowAll) return callback(null, true);
      if (isLocalOrigin(origin)) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Express middleware enforcing auth on non-safe (mutating) requests when the
 * proxy is in "exposed" mode. No-op when auth enforcement is off.
 *
 * Exempt paths: auth endpoints (you must be able to log in) and a health check.
 */
function createExposureGuard(env = process.env) {
  const enforce = env.PROXY_REQUIRE_AUTH === '1' || env.NODE_ENV === 'production';
  const apiToken = env.PROXY_API_TOKEN || '';

  return function exposureGuard(req, res, next) {
    if (!enforce) return next();
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.path === '/' || req.path.startsWith('/auth/')) return next();

    // Trusted server-side callers (worker, CLI) present a shared bearer token.
    if (apiToken) {
      const header = req.headers.authorization || '';
      const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (presented && presented === apiToken) return next();
    }

    // Authenticated browser session (Passport populates req.user).
    if (req.user) return next();

    return res.status(401).json({
      error: 'Authentication required',
      detail:
        'This proxy is running with PROXY_REQUIRE_AUTH enabled. Log in via /auth, ' +
        'or present a valid PROXY_API_TOKEN bearer token.',
    });
  };
}

module.exports = { createCorsOptions, createExposureGuard, isLocalOrigin };
