import { Agent, setGlobalDispatcher, interceptors } from 'undici';

let installed = false;

/**
 * Install a process-wide resilient HTTP dispatcher for Node's global `fetch`.
 *
 * Why: the worker runs as a short-lived process inside the proxy's container and
 * cold-dials a fresh TLS connection for every outbound provider call (Gemini,
 * Anthropic, OpenAI, ElevenLabs, blob storage, image providers). When the
 * container's egress is intermittently flaky, those cold dials are exactly what
 * fail — surfacing as `TypeError: fetch failed` and stranding/retrying agents.
 *
 * This dispatcher fixes BOTH halves cheaply and for ALL providers at once:
 *   - Keep-alive: reuse a warm connection across the many calls in one job, so we
 *     stop paying the cold-dial failure tax on every request.
 *   - Connection-level retry: transparently retry transient CONNECTION errors
 *     (no response received yet) a few times with fast backoff.
 *
 * We deliberately retry ONLY connection errors, never HTTP status codes (5xx/429)
 * or response-timeouts — the app's own callLLM retry owns those, and retrying a
 * POST the server already received would risk duplicate work/charges.
 *
 * Node-only (uses undici). Never import this from web/native/reader code.
 */
export function installResilientHttp(): void {
  if (installed) return;
  installed = true;

  const dispatcher = new Agent({
    keepAliveTimeout: 30_000, // keep idle connections 30s for reuse within a job
    keepAliveMaxTimeout: 10 * 60_000,
    connect: { timeout: 30_000 }, // cap connection establishment at 30s
    // undici's DEFAULTS for these are 300s (5 min) each. That silently killed
    // every long LLM generation: our provider calls are NON-streaming, so the
    // first response byte only arrives AFTER the model finishes generating. A
    // large request (e.g. 16k–32k max_tokens story/source planning) routinely
    // takes >5 min to produce its first byte, so undici aborted it as
    // `TypeError: fetch failed` (cause: UND_ERR_HEADERS_TIMEOUT) — looking
    // exactly like an egress failure, and retrying into the same wall until the
    // outer pipeline timeout expired. Raise both well past the heaviest
    // legitimate generation (the app's per-call hint maxes at 900s) but below
    // the outer pipeline budgets, so a genuinely hung socket still dies. This
    // is provider-agnostic: it lifts the cap for Anthropic, Gemini, OpenAI, etc.
    // at once. App-level `withTimeoutAbort`/AbortSignal remain the real
    // cancellation authority for "this call is taking too long, give up."
    //
    // Kept as the OUTERMOST limit (≥ the largest single-call app budget, which is
    // PIPELINE_TIMEOUTS.storyArchitect = 20 min) so the app-level per-call
    // timeout always fires first — undici is only the ultimate backstop, never
    // the thing that prematurely kills a legitimately-long heavy generation.
    headersTimeout: 22 * 60_000,
    bodyTimeout: 22 * 60_000,
  }).compose(
    interceptors.retry({
      maxRetries: 3,
      minTimeout: 500,
      maxTimeout: 4_000,
      timeoutFactor: 2,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      // Empty statusCodes: never retry on an HTTP response — only on the
      // connection-level errors below (where the request never completed, so a
      // retry is safe even for POST).
      statusCodes: [],
      errorCodes: [
        'ECONNRESET',
        'ECONNREFUSED',
        'ENOTFOUND',
        'ENETDOWN',
        'ENETUNREACH',
        'EHOSTDOWN',
        'EHOSTUNREACH',
        'EPIPE',
        'EAI_AGAIN', // transient DNS failure
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_SOCKET',
      ],
    }),
  );

  setGlobalDispatcher(dispatcher);
}
