/**
 * Provider credit preflight (Consistency Plan WS1b).
 *
 * A 1-token ping before a run starts, so a billing-exhausted account pauses
 * the job up front instead of after spending on world/character/episode
 * generation and dying mid-season (9 of the first 75 ledger runs died this
 * way with all spend discarded).
 *
 * Fail-open by design: only a definitive billing signal blocks the run.
 * Network failures, rate limits, and unexpected statuses let the run proceed —
 * the in-run quota latch (BaseAgent) catches anything the preflight missed.
 */

import { LLMQuotaError } from '../agents/BaseAgent';
import { isBillingQuotaMessage, isProviderQuotaError } from '../utils/providerErrors';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export interface PreflightResult {
  ok: true;
  skipped?: boolean;
  reason?: string;
}

/**
 * Throws LLMQuotaError on a definitive billing failure; resolves otherwise.
 */
export async function anthropicCreditPreflight(options: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<PreflightResult> {
  const { apiKey, model, timeoutMs = 15_000 } = options;
  if (!apiKey) return { ok: true, skipped: true, reason: 'no anthropic api key configured' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) return { ok: true };
    const text = await response.text().catch(() => '');
    if (response.status === 402 || isBillingQuotaMessage(text)) {
      throw new LLMQuotaError(
        `Anthropic credit preflight failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
        'anthropic',
      );
    }
    return { ok: true, skipped: true, reason: `preflight inconclusive: HTTP ${response.status}` };
  } catch (error) {
    if (isProviderQuotaError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: true, skipped: true, reason: `preflight unreachable: ${message}` };
  }
}
