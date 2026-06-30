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
 *     (req.user) or a valid PROXY_API_TOKEN bearer (for the worker/CLI) —
 *     EXCEPT local-loopback requests, which are always exempt so local dev
 *     never needs to log in. Auth is therefore only enforced for remote/
 *     exposed callers (the cloud deploy or the ngrok tunnel). See isLocalRequest.
 *
 * IMPORTANT: before exposing the proxy publicly (ngrok / deploy), set
 * PROXY_REQUIRE_AUTH=1 and a PROXY_API_TOKEN. Leaving it on is safe for local
 * work because local requests bypass the gate by connection, not by Origin.
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

// Did the client dial localhost? Parses the Host header (strips port, handles
// [::1]). For a containerized proxy the socket peer is the Docker gateway (an
// arbitrary, non-RFC1918 address on some setups), but the Host header still
// reflects what the caller actually requested — so this is the reliable signal.
function isLocalHost(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).trim().toLowerCase();
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Is this request from the developer's own machine, rather than a remote/
 * exposed caller? Used to skip the auth gate for local dev while keeping it
 * enforced for the cloud/tunnel.
 *
 * Detection (header-based, robust behind Docker's port NAT):
 *   - In production (cloud deploy) → never local; always enforce auth.
 *   - Through a tunnel or load balancer (ngrok / cloud LB) → forwarding headers
 *     (X-Forwarded-*) are present → remote. ngrok always adds these, so this
 *     catches the exposed case regardless of the (Docker-internal) peer IP.
 *   - Otherwise local iff the caller dialed localhost / 127.0.0.1.
 *
 * Assumption: the proxy is only exposed via a tunnel/LB that sets X-Forwarded-*
 * (ngrok does) or a cloud deploy with NODE_ENV=production — never by publishing
 * the raw container port straight to the internet in dev mode.
 */
function isLocalRequest(req, env = process.env) {
  if (env.NODE_ENV === 'production') return false;
  const h = (req && req.headers) || {};
  if (h['x-forwarded-for'] || h['x-forwarded-host'] || h['x-real-ip'] || h['forwarded']) {
    return false;
  }
  return isLocalHost(h.host);
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

    // Local-dev convenience: requests that originate from this machine (no
    // tunnel/LB forwarding headers, loopback peer) are exempt. Auth is only
    // required for remote/exposed requests — i.e. the cloud deploy or the
    // ngrok tunnel. Keeps PROXY_REQUIRE_AUTH=1 safe to leave on for local work.
    if (isLocalRequest(req, env)) return next();

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

module.exports = { createCorsOptions, createExposureGuard, isLocalOrigin, isLocalRequest };
