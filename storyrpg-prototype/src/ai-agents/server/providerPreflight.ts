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
import { PipelineError } from '../pipeline/errors';

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

export interface NarrativeProviderConfig {
  provider?: string;
  apiKey?: string;
  model?: string;
}

export interface WorkerProviderPreflightResult {
  checked: Array<{ provider: string; model: string }>;
  skipped: string[];
}

export interface NarrativeJobContractOptions {
  geminiOnly?: boolean;
  textOnly?: boolean;
  qualityCouncilEnabled?: boolean;
}

/** Validate immutable run intent before spending on source analysis. */
export function validateNarrativeJobContract(
  config: Record<string, any>,
  options: NarrativeJobContractOptions = {},
): void {
  const agents = config.agents ?? {};
  if (options.geminiOnly) {
    const nonGemini = Object.entries(agents)
      .filter(([name]) => options.qualityCouncilEnabled === false && /^qualityCouncil/i.test(name) ? false : true)
      .filter(([, value]) => {
        const provider = String((value as NarrativeProviderConfig)?.provider || '').toLowerCase();
        return provider !== 'gemini' && provider !== 'google';
      })
      .map(([name, value]) => `${name}:${String((value as NarrativeProviderConfig)?.provider || 'unset')}`);
    if (nonGemini.length > 0) {
      throw providerFailure(`Gemini-only job contains non-Gemini narrative route(s): ${nonGemini.join(', ')}.`, 'provider_configuration_invalid', 'none');
    }
  }
  if (options.textOnly && (config.imageGen?.enabled === true || config.video?.enabled === true || config.videoGeneration?.enabled === true)) {
    throw providerFailure('Text-only job has image or video generation enabled.', 'job_config_mismatch', 'none');
  }
  if (options.qualityCouncilEnabled === false && Object.keys(agents).some((name) => /^qualityCouncil/i.test(name))) {
    throw providerFailure('Story Council is disabled but council routes remain in the immutable job config.', 'job_config_mismatch', 'none');
  }
}

function providerFailure(message: string, code: 'provider_configuration_invalid' | 'provider_model_unavailable' | 'provider_transient' | 'job_config_mismatch', retryClass: 'none' | 'retry_provider'): PipelineError {
  return new PipelineError(message, 'provider_preflight', {
    agent: 'ProviderPreflight',
    failure: { code, ownerStage: 'provider', retryClass, repairTarget: 'job-settings' },
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Definitively validates key/model pairs before source-analysis spend. */
export async function narrativeProviderPreflight(options: {
  agents: Record<string, NarrativeProviderConfig>;
  qualityCouncilEnabled?: boolean;
  imageGenerationEnabled?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<WorkerProviderPreflightResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const active = Object.entries(options.agents ?? {}).filter(([name]) =>
    options.qualityCouncilEnabled !== false || !/^qualityCouncil/i.test(name),
  );
  if (active.length === 0) {
    throw providerFailure('No narrative agent configurations are active.', 'provider_configuration_invalid', 'none');
  }
  if (options.qualityCouncilEnabled === false && Object.keys(options.agents).some((name) => /^qualityCouncil/i.test(name))) {
    throw providerFailure('Quality Council is disabled but council agent configurations remain active.', 'provider_configuration_invalid', 'none');
  }
  const unique = new Map<string, NarrativeProviderConfig>();
  for (const [name, config] of active) {
    const provider = String(config.provider || '').toLowerCase();
    const model = String(config.model || '').trim();
    if (!provider || !model || !config.apiKey) {
      throw providerFailure(`Narrative agent "${name}" is missing provider, model, or API key.`, 'provider_configuration_invalid', 'none');
    }
    unique.set(`${provider}:${model}`, { ...config, provider, model });
  }
  const checked: Array<{ provider: string; model: string }> = [];
  const skipped: string[] = [];
  for (const config of unique.values()) {
    const provider = config.provider!;
    const model = config.model!;
    let url: string | undefined;
    let headers: Record<string, string> = {};
    if (provider === 'gemini' || provider === 'google') {
      const normalizedModel = model.replace(/^models\//, '');
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}?key=${encodeURIComponent(config.apiKey!)}`;
    } else if (provider === 'openai') {
      url = `https://api.openai.com/v1/models/${encodeURIComponent(model)}`;
      headers = { Authorization: `Bearer ${config.apiKey}` };
    } else if (provider === 'openrouter') {
      url = `https://openrouter.ai/api/v1/models/${encodeURIComponent(model)}`;
      headers = { Authorization: `Bearer ${config.apiKey}` };
    } else if (provider === 'anthropic') {
      await anthropicCreditPreflight({ apiKey: config.apiKey, model, timeoutMs });
      checked.push({ provider, model });
      continue;
    } else {
      skipped.push(`${provider}:${model}:unsupported-preflight`);
      continue;
    }
    try {
      const response = await fetchWithTimeout(url, { method: 'GET', headers }, timeoutMs, fetchImpl);
      if (response.ok) {
        checked.push({ provider, model });
        continue;
      }
      const body = await response.text().catch(() => '');
      if ([400, 401, 403, 404].includes(response.status)) {
        throw providerFailure(`${provider} model preflight failed for ${model} (HTTP ${response.status}): ${body.slice(0, 240)}`, 'provider_model_unavailable', 'none');
      }
      if (response.status === 402 || response.status === 429 || isBillingQuotaMessage(body)) {
        throw new LLMQuotaError(`${provider} preflight quota failure for ${model} (HTTP ${response.status}): ${body.slice(0, 240)}`, provider === 'gemini' ? 'gemini' : provider as 'openai' | 'openrouter');
      }
      throw providerFailure(`${provider} model preflight was unavailable for ${model} (HTTP ${response.status}).`, 'provider_transient', 'retry_provider');
    } catch (error) {
      if (error instanceof PipelineError || isProviderQuotaError(error)) throw error;
      throw providerFailure(`${provider} model preflight could not reach ${model}: ${error instanceof Error ? error.message : String(error)}`, 'provider_transient', 'retry_provider');
    }
  }
  return { checked, skipped };
}
