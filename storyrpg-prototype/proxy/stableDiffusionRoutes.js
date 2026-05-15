/**
 * Stable Diffusion proxy route.
 *
 * Forwards requests under `/sd-api/*` to a Stable Diffusion backend (default:
 * AUTOMATIC1111 / Forge WebUI's REST surface at `/sdapi/v1/...`). Mirrors the
 * pattern used by the MidAPI and Atlas Cloud routes so the client-side
 * `ImageGenerationService` can stay provider-agnostic.
 *
 * Configuration (all optional except `STABLE_DIFFUSION_BASE_URL`):
 *  - STABLE_DIFFUSION_BASE_URL  – target host, e.g. http://127.0.0.1:7860
 *  - STABLE_DIFFUSION_API_KEY   – optional bearer token or header value
 *  - STABLE_DIFFUSION_AUTH_HEADER – header name to use instead of Authorization
 *                                   (e.g. "X-Api-Key" for some hosted backends)
 *  - STABLE_DIFFUSION_TIMEOUT_MS – override the default 180s timeout
 *
 * The route passes the client's `x-stable-diffusion-token` header through as
 * a Bearer token when present, so per-session tokens sent by the UI win over
 * the environment default.
 */

const DEFAULT_TIMEOUT_MS = 180_000;

function getBaseUrl() {
  const raw = (process.env.STABLE_DIFFUSION_BASE_URL || '').trim();
  return raw.replace(/\/+$/, '');
}

function resolveAuthHeader(req) {
  const clientToken = (req.headers['x-stable-diffusion-token'] || req.headers['x-sd-token'] || '').toString().trim();
  const envToken = (process.env.STABLE_DIFFUSION_API_KEY || '').trim();
  const token = clientToken || envToken;
  if (!token) return null;
  const customHeader = (process.env.STABLE_DIFFUSION_AUTH_HEADER || '').trim();
  if (customHeader) {
    return { name: customHeader, value: token };
  }
  return { name: 'Authorization', value: `Bearer ${token}` };
}

function registerStableDiffusionRoutes(app) {
  const timeoutMs = Number(process.env.STABLE_DIFFUSION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  // Lightweight health check — handy for `preflightImageProvider` and the UI
  // setup checklist. Returns 503 when no backend is configured so the caller
  // can surface an actionable error instead of a generic 404.
  app.get('/sd-api/health', async (_req, res) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      return res.status(503).json({ ok: false, error: 'STABLE_DIFFUSION_BASE_URL is not configured' });
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.min(timeoutMs, 15_000));
    try {
      const r = await fetch(`${baseUrl}/sdapi/v1/sd-models`, { method: 'GET', signal: abort.signal });
      clearTimeout(timer);
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return res.status(r.status).json({ ok: false, status: r.status, error: text.slice(0, 500) });
      }
      const models = await r.json().catch(() => null);
      const modelCount = Array.isArray(models) ? models.length : undefined;
      return res.json({ ok: true, baseUrl, modelCount });
    } catch (err) {
      clearTimeout(timer);
      const message = err && err.message ? err.message : String(err);
      return res.status(502).json({ ok: false, error: message });
    }
  });

  app.use('/sd-api', async (req, res) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      console.error('[Proxy] /sd-api called but STABLE_DIFFUSION_BASE_URL is not set');
      return res.status(503).json({ error: 'STABLE_DIFFUSION_BASE_URL is not configured' });
    }

    // Everything after /sd-api (the Express strip) is forwarded as-is so that
    // the client can hit /sd-api/sdapi/v1/txt2img and we dispatch to
    // <baseUrl>/sdapi/v1/txt2img without remapping.
    const apiPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;
    const url = `${baseUrl}/${apiPath}`;

    const headers = { 'Content-Type': 'application/json' };
    const auth = resolveAuthHeader(req);
    if (auth) headers[auth.name] = auth.value;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    try {
      console.log(`[Proxy] Forwarding ${req.method} to Stable Diffusion: ${url}`);
      const options = { method: req.method, headers, signal: abort.signal };
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
        options.body = JSON.stringify(req.body);
      }
      const response = await fetch(url, options);
      clearTimeout(timer);

      const text = await response.text();
      const contentType = response.headers.get('content-type') || '';
      if (response.status >= 400) {
        console.error(`[Proxy] Stable Diffusion error ${response.status}: ${text.slice(0, 300)}`);
      }
      res.status(response.status);
      if (contentType.includes('application/json')) {
        try {
          return res.json(JSON.parse(text));
        } catch {
          return res.type('application/json').send(text);
        }
      }
      if (contentType) res.set('Content-Type', contentType);
      return res.send(text);
    } catch (error) {
      clearTimeout(timer);
      const isTimeout = String(error?.message || '').toLowerCase().includes('abort');
      console.error(`[Proxy] Stable Diffusion request failed: ${error.message}`);
      return res.status(isTimeout ? 504 : 502).json({ error: error.message, timeout: isTimeout });
    }
  });
}

module.exports = { registerStableDiffusionRoutes };
