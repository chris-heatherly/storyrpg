/**
 * LoRA training proxy route.
 *
 * Forwards requests under `/lora-training/*` to a kohya_ss (or compatible)
 * sidecar HTTP service. Mirrors the pattern used by
 * `stableDiffusionRoutes.js` so the client-side `KohyaAdapter` can stay
 * provider-agnostic and never talks to the sidecar directly.
 *
 * Contract exposed by the sidecar (see docs/LORA_TRAINING.md):
 *   POST /lora-training/jobs                    – submit a training job
 *   GET  /lora-training/jobs/:jobId             – poll status
 *   POST /lora-training/jobs/:jobId/cancel      – cancel a running job
 *   GET  /lora-training/jobs/:jobId/artifact    – download safetensors
 *   POST /lora-training/loras/:name/install     – copy into A1111 models/Lora
 *   GET  /lora-training/preflight               – liveness + model discovery
 *
 * Configuration (all optional except `LORA_TRAINER_BASE_URL`):
 *  - LORA_TRAINER_BASE_URL   – target host, e.g. http://127.0.0.1:7861
 *  - LORA_TRAINER_API_KEY    – optional bearer token
 *  - LORA_TRAINER_AUTH_HEADER – header name to use instead of Authorization
 *  - LORA_TRAINER_TIMEOUT_MS – override the default 10-minute timeout
 *
 * Per-request tokens can be supplied via the `x-lora-trainer-token` header
 * so the UI can override the environment default.
 */

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ARTIFACT_TIMEOUT_MS = 15 * 60 * 1000;

function getBaseUrl() {
  const raw = (process.env.LORA_TRAINER_BASE_URL || '').trim();
  return raw.replace(/\/+$/, '');
}

function resolveAuthHeader(req) {
  const clientToken = (
    req.headers['x-lora-trainer-token'] ||
    req.headers['x-lora-token'] ||
    ''
  ).toString().trim();
  const envToken = (process.env.LORA_TRAINER_API_KEY || '').trim();
  const token = clientToken || envToken;
  if (!token) return null;
  const customHeader = (process.env.LORA_TRAINER_AUTH_HEADER || '').trim();
  if (customHeader) {
    return { name: customHeader, value: token };
  }
  return { name: 'Authorization', value: `Bearer ${token}` };
}

function registerLoraTrainingRoutes(app) {
  const timeoutMs = Number(process.env.LORA_TRAINER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  // Liveness check for the Generator UI readiness indicator. Returns 503 when
  // no backend is configured so the caller can surface an actionable error.
  app.get('/lora-training/preflight', async (req, res) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      return res.status(503).json({ ok: false, error: 'LORA_TRAINER_BASE_URL is not configured' });
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.min(timeoutMs, 15_000));
    try {
      const headers = {};
      const auth = resolveAuthHeader(req);
      if (auth) headers[auth.name] = auth.value;
      const r = await fetch(`${baseUrl}/preflight`, { method: 'GET', headers, signal: abort.signal });
      clearTimeout(timer);
      const text = await r.text();
      if (!r.ok) {
        return res.status(r.status).json({ ok: false, status: r.status, error: text.slice(0, 500) });
      }
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.json({ ok: true, raw: text.slice(0, 500) });
      }
    } catch (err) {
      clearTimeout(timer);
      const message = err && err.message ? err.message : String(err);
      return res.status(502).json({ ok: false, error: message });
    }
  });

  // Proxy everything else under /lora-training/* to the sidecar. `req.url` is
  // the path after the Express strip (e.g. `/jobs/abc/artifact`) and is
  // forwarded verbatim to `<baseUrl><path>`.
  app.use('/lora-training', async (req, res) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      console.error('[Proxy] /lora-training called but LORA_TRAINER_BASE_URL is not set');
      return res.status(503).json({ error: 'LORA_TRAINER_BASE_URL is not configured' });
    }

    const apiPath = req.url.startsWith('/') ? req.url : `/${req.url}`;
    const url = `${baseUrl}${apiPath}`;

    const headers = {};
    const auth = resolveAuthHeader(req);
    if (auth) headers[auth.name] = auth.value;

    // Preserve body on methods that carry one; default to JSON.
    let body;
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }

    // Artifact downloads can be very large and training jobs themselves may
    // stream status lines for a while. The per-route timeout below lifts the
    // default ceiling for GET /jobs/:id/artifact.
    const isArtifactDownload = /\/jobs\/[^/]+\/artifact$/.test(apiPath);
    const perRequestTimeout = isArtifactDownload ? DEFAULT_ARTIFACT_TIMEOUT_MS : timeoutMs;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), perRequestTimeout);

    try {
      console.log(`[Proxy] Forwarding ${req.method} to LoRA trainer: ${url}`);
      const response = await fetch(url, { method: req.method, headers, body, signal: abort.signal });
      clearTimeout(timer);

      const contentType = response.headers.get('content-type') || '';
      res.status(response.status);

      // Stream binary artifacts through untouched so large safetensors files
      // don't get coerced to base64 or buffered in V8 strings.
      if (contentType && !contentType.includes('application/json') && !contentType.startsWith('text/')) {
        res.set('Content-Type', contentType);
        const len = response.headers.get('content-length');
        if (len) res.set('Content-Length', len);
        const dispo = response.headers.get('content-disposition');
        if (dispo) res.set('Content-Disposition', dispo);
        const arrayBuf = await response.arrayBuffer();
        return res.end(Buffer.from(arrayBuf));
      }

      const text = await response.text();
      if (response.status >= 400) {
        console.error(`[Proxy] LoRA trainer error ${response.status}: ${text.slice(0, 300)}`);
      }
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
      console.error(`[Proxy] LoRA trainer request failed: ${error.message}`);
      return res.status(isTimeout ? 504 : 502).json({ error: error.message, timeout: isTimeout });
    }
  });
}

module.exports = { registerLoraTrainingRoutes };
