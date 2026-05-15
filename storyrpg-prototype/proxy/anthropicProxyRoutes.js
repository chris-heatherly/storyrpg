/**
 * POST /v1/messages — Anthropic API proxy with retry/timeout policy.
 * Budgets are sourced from `llm-transport-policy.js`.
 */

const RETRYABLE_ANTHROPIC_STATUSES = new Set([429, 500, 502, 503, 529]);

function registerAnthropicProxyRoutes(app, { getLlmTransportBudgets }) {
  app.post('/v1/messages', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error('[Proxy] Missing API key');
      return res.status(401).json({ error: 'Missing API key' });
    }

    const bodyStr = JSON.stringify(req.body);
    const bodySize = bodyStr.length;
    const budgets = getLlmTransportBudgets(req, req.body, bodySize);
    const responseTimeoutMs = budgets.responseTimeoutMs;
    let lastError = null;
    let lastElapsedMs = 0;

    for (let attempt = 1; attempt <= budgets.retries; attempt++) {
      const attemptConnectMs = (budgets.connectTimeoutsPerAttempt && budgets.connectTimeoutsPerAttempt[attempt - 1])
        || budgets.connectTimeoutMs;
      const attemptStartedAt = Date.now();
      const connectAbort = new AbortController();
      const connectTimer = setTimeout(() => connectAbort.abort(), attemptConnectMs);

      try {
        if (attempt === 1) {
          console.log(`[Proxy] Forwarding request to Anthropic... (step: ${budgets.step || 'unknown'}, Body size: ${bodySize} bytes, connectTimeout: ${attemptConnectMs}ms, responseTimeout: ${responseTimeoutMs}ms)`);
        } else {
          console.log(`[Proxy] Anthropic retry ${attempt}/${budgets.retries} (step: ${budgets.step || 'unknown'}, connectTimeout: ${attemptConnectMs}ms)`);
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
          },
          body: bodyStr,
          signal: connectAbort.signal,
        });
        clearTimeout(connectTimer);

        const headerElapsedMs = Date.now() - attemptStartedAt;
        console.log(`[Proxy] Anthropic response status: ${response.status} (headers in ${headerElapsedMs}ms)`);

        if (RETRYABLE_ANTHROPIC_STATUSES.has(response.status) && attempt < budgets.retries) {
          const errBody = await response.text().catch(() => '');
          const elapsedMs = Date.now() - attemptStartedAt;
          const retryDelay = response.status === 429
            ? Math.max(budgets.retryDelaysMs[attempt - 1], 10000)
            : budgets.retryDelaysMs[attempt - 1];
          console.warn(`[Proxy] Anthropic returned ${response.status} after ${elapsedMs}ms, will retry in ${retryDelay}ms. Body: ${errBody.substring(0, 200)}`);
          await new Promise(r => setTimeout(r, retryDelay));
          continue;
        }

        const bodyTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Response body timeout after ${responseTimeoutMs}ms`)), responseTimeoutMs)
        );

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const text = await Promise.race([response.text(), bodyTimeout]);
          const data = JSON.parse(text);
          res.status(response.status).json(data);
        } else {
          const text = await Promise.race([response.text(), bodyTimeout]);
          console.error(`[Proxy] Non-JSON response from Anthropic: ${text.substring(0, 200)}`);
          res.status(response.status).send(text);
        }
        return;

      } catch (error) {
        clearTimeout(connectTimer);
        lastError = error;
        lastElapsedMs = Date.now() - attemptStartedAt;
        const causeValue = error?.cause?.message || error?.cause?.code || error?.cause;
        const cause = causeValue ? ` [cause: ${causeValue}]` : '';
        const abortKind = String(error?.message || '').toLowerCase().includes('abort')
          ? (lastElapsedMs >= attemptConnectMs * 0.9 ? 'timeout/abort' : 'connect-abort')
          : 'fetch-error';
        console.error(`[Proxy] Anthropic fetch attempt ${attempt}/${budgets.retries} FAILED (${abortKind}, ${lastElapsedMs}ms, limit ${attemptConnectMs}ms): ${error.message}${cause}`);

        if (attempt < budgets.retries) {
          const delay = budgets.retryDelaysMs[attempt - 1];
          console.log(`[Proxy] Retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    const causeValue = lastError?.cause?.message || lastError?.cause?.code || lastError?.cause;
    const cause = causeValue ? ` [cause: ${causeValue}]` : '';
    console.error(`[Proxy] Anthropic request failed after ${budgets.retries} attempts (${lastElapsedMs}ms last attempt): ${lastError.message}${cause}`);
    res.status(502).json({
      error: `Anthropic API unreachable after ${budgets.retries} attempts: ${lastError.message}`,
      cause: causeValue || undefined,
      retries: budgets.retries,
      elapsedMs: lastElapsedMs,
      bodySize,
      connectTimeoutMs: budgets.connectTimeoutMs,
      responseTimeoutMs,
    });
  });
}

module.exports = { registerAnthropicProxyRoutes };
