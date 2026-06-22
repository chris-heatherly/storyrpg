/**
 * BaseAgent - Abstract base class for all AI agents
 * Provides common functionality for LLM interaction and output parsing.
 */

import { AgentConfig } from '../config';
import { CORE_STORYTELLING_PROMPT } from '../prompts/storytellingPrinciples';
import { isWebRuntime } from '../../utils/runtimeEnv';
import { AsyncSemaphore } from '../utils/concurrency';
import { getMemoryStore, type MemoryCommand } from '../utils/memoryStore';
import { PROXY_CONFIG } from '../../config/endpoints';
import { createLogger } from '../../utils/logger';
import {
  shouldStreamLLM,
  readSSEStream,
  anthropicSseHandler,
  openaiSseHandler,
  geminiSseHandler,
} from './streamLLM';
import { isBillingQuotaMessage } from '../utils/providerErrors';

const log = createLogger('BaseAgent');

/**
 * The adaptive-thinking generation of Claude models (Opus 4.6/4.7/4.8,
 * Sonnet 4.6, Haiku 4.5, Fable 5) removed the `temperature`/`top_p`/`top_k`
 * sampling parameters — sending `temperature` returns a 400. Older models
 * (claude-3.x, opus-4-0/4-1/4-5, sonnet-4-0/4-5, haiku-3.x) still accept it.
 * Returns false for the newer family so callers omit `temperature`.
 */
function modelAcceptsTemperature(model: string | undefined): boolean {
  if (!model) return true;
  return !/claude-(?:opus-4-[678]|sonnet-4-6|haiku-4-5|fable-5)/.test(model);
}

// Use proxy server for web to avoid CORS issues
const ANTHROPIC_API_URL = isWebRuntime()
  ? `${PROXY_CONFIG.getProxyUrl()}/v1/messages`  // Local proxy
  : 'https://api.anthropic.com/v1/messages';  // Direct API for native
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// OpenRouter is its own provider/endpoint — never routed through the OpenAI path.
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | { type: 'image_url'; image_url: { url: string } }>;
}

/**
 * Opt-in schema-strict JSON output for a single {@link BaseAgent.callLLM} call.
 * When provided, the agent forces the provider to return JSON matching `schema`:
 * Anthropic via forced tool use (`tool_choice`), OpenAI/OpenRouter via
 * `response_format` `json_schema`, and Gemini via `responseSchema` with
 * `responseMimeType: application/json`. `schema` is a JSON Schema object.
 */
export interface StructuredJsonSchema {
  /** Tool/schema name (must match `^[a-zA-Z0-9_-]+$` for the provider APIs). */
  name: string;
  description?: string;
  /** Expected compact output cap for this schema; prevents structured calls inheriting oversized agent budgets. */
  maxOutputTokens?: number;
  schema: Record<string, unknown>;
}

export interface AgentResponse<T> {
  success: boolean;
  data?: T;
  rawResponse?: string;
  error?: string;
  /**
   * Non-fatal issues recorded when an agent succeeds despite advisory
   * validation failures (e.g. craft/fidelity checks that, after retries, are
   * degraded to warnings instead of aborting the run). See validator tiering
   * in docs/PROJECT_AUDIT_2026-05-28.md (Track B1).
   */
  warnings?: string[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  metadata?: Record<string, unknown>;
}

export class LLMQuotaError extends Error {
  public readonly provider: 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'unknown';

  constructor(message: string, provider: 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'unknown' = 'unknown') {
    super(message);
    this.name = 'LLMQuotaError';
    this.provider = provider;
  }
}

export class TruncatedLLMResponseError extends Error {
  public readonly provider: 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'unknown';
  public readonly finishReason?: string;

  constructor(
    message: string,
    provider: 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'unknown' = 'unknown',
    finishReason?: string,
  ) {
    super(message);
    this.name = 'TruncatedLLMResponseError';
    this.provider = provider;
    this.finishReason = finishReason;
  }
}

export function isLlmQuotaError(err: unknown): boolean {
  if (err instanceof LLMQuotaError) return true;
  const message = err instanceof Error ? err.message : String(err ?? '');
  const lower = message.toLowerCase();
  return (
    lower.includes('exceeded your current quota') ||
    lower.includes('quota exceeded for metric') ||
    lower.includes('generate_requests_per_model_per_day') ||
    lower.includes('limit: 0')
  );
}

function isTruncationFinishReason(reason: unknown): boolean {
  return /^(?:max_tokens|max_tokens?_|max[_-]?tokens|length)$/i.test(String(reason || ''));
}

function toGeminiResponseSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const stripUnsupported = (value: unknown, parentKey?: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => stripUnsupported(item, parentKey));
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      // Gemini's REST `responseSchema` accepts an OpenAPI-style subset and
      // rejects `additionalProperties` even though our deterministic registry
      // uses it for provider-neutral JSON Schema. Strip it only for Gemini.
      if (key === 'additionalProperties') continue;
      // Gemini rejects some otherwise-valid nested array bounds with
      // INVALID_ARGUMENT / "too many states for serving". Keep those bounds in
      // our canonical schemas and local validators; only remove them from the
      // provider-specific responseSchema sent over the wire.
      if (key === 'minItems' || key === 'maxItems') continue;
      // Strip JSON-Schema annotation text, but keep real output properties named
      // "description" under a `properties` map.
      if (key === 'description' && parentKey !== 'properties') continue;
      out[key] = stripUnsupported(nested, key);
    }
    return out;
  };

  return stripUnsupported(schema) as Record<string, unknown>;
}

function structuredMaxTokens(configured: number, schema: StructuredJsonSchema | undefined, defaultCap: number): number {
  const configuredValue = Number.isFinite(configured) && configured > 0 ? configured : defaultCap;
  const schemaCap = Number.isFinite(schema?.maxOutputTokens) && (schema?.maxOutputTokens ?? 0) > 0
    ? schema!.maxOutputTokens!
    : defaultCap;
  return Math.max(256, Math.min(configuredValue, schemaCap));
}

function resolveGeminiThinkingConfig(model: string | undefined, structured: boolean): Record<string, unknown> | undefined {
  if (!structured) return undefined;
  const normalized = String(model || '').toLowerCase();
  const envBudget = Number.parseInt(
    process.env.GEMINI_STRUCTURED_THINKING_BUDGET
      || process.env.EXPO_PUBLIC_GEMINI_STRUCTURED_THINKING_BUDGET
      || '',
    10,
  );
  const envLevel = (
    process.env.GEMINI_STRUCTURED_THINKING_LEVEL
      || process.env.EXPO_PUBLIC_GEMINI_STRUCTURED_THINKING_LEVEL
      || ''
  ).trim().toLowerCase();

  if (/gemini-(?:3|3\.)/.test(normalized)) {
    return { thinkingLevel: envLevel || 'low' };
  }
  if (/gemini-2\.5/.test(normalized)) {
    if (Number.isFinite(envBudget)) return { thinkingBudget: envBudget };
    return { thinkingBudget: normalized.includes('pro') ? 128 : 0 };
  }
  return undefined;
}

function structuredOutputContract(schemaName: string): string {
  return [
    `STRUCTURED OUTPUT CONTRACT: the API request includes the deterministic JSON schema "${schemaName}".`,
    'Return exactly one JSON value matching that schema.',
    'Do not add fields that are not named in the schema. Do not include markdown, commentary, placeholders, schema examples, or rationale.',
    'Keep every string concise and scene-specific; prefer short, concrete prose over broad explanation.',
  ].join(' ');
}

function appendTextInstruction(message: AgentMessage, instruction: string): AgentMessage {
  if (typeof message.content === 'string') {
    return { ...message, content: `${message.content}\n\n${instruction}` };
  }
  return {
    ...message,
    content: [
      ...message.content,
      { type: 'text', text: instruction },
    ],
  };
}

export interface LlmGuardrailConfig {
  maxGlobalInFlight: number;
  maxPerProviderInFlight: number;
  backoffJitterRatio: number;
}

/**
 * The fully-assembled request callLLM is about to send: the exact messages
 * (system prompt included) plus the routing config. This is the unit the
 * prompt-snapshot harness captures — if two pipeline builds produce identical
 * LlmTransportRequest sequences, the LLM sees identical inputs and generated
 * story quality cannot differ because of the code change.
 */
export interface LlmTransportRequest {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini' | 'openrouter';
  model: string;
  messages: AgentMessage[];
}

export type LlmTransportOverride = (request: LlmTransportRequest) => Promise<string>;

/** Fired when truncation recovery DROPS content (silent-loss landmine L4). */
export interface TruncationObservation {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini' | 'openrouter';
}

export interface LlmCallObservation {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini' | 'openrouter';
  success: boolean;
  durationMs: number;
  queueWaitMs: number;
  attempt: number;
  error?: string;
  /**
   * Token usage reported by the provider, when available. Populated by the
   * anthropic, gemini, and OpenAI transports. Undefined
   * when the provider did not return usage data (e.g. on error).
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected name: string;
  protected systemPrompt: string;

  /**
   * When true, callLLM() automatically prepends this.systemPrompt as a system
   * message (if one isn't already provided). Enable this in narrative/creative
   * agents so the LLM receives core storytelling principles and the agent's
   * role description. Leave false for utility agents (image generators,
   * validators) to save tokens.
   */
  protected includeSystemPrompt: boolean = false;

  /**
   * Set to true when the most recent parseJSON() had to recover from a
   * truncated response by DROPPING content (e.g. max_tokens was hit and trailing
   * scenes/beats were cut). This is silent data loss that otherwise looks like a
   * successful parse, so callers/pipeline can read this flag to surface or gate
   * on it. See docs/PROJECT_AUDIT_2026-05-28.md, landmine L4.
   */
  protected lastResponseTruncated = false;

  /**
   * Optional abort signal that applies to ALL `callLLM` calls made for the
   * duration of an `execute()`. Set this once at the top of an agent's
   * `execute(input, { signal })` (and clear it in a `finally`) instead of
   * threading `signal` through every private method down to each `callLLM`
   * call site. `callLLM` falls back to this when no per-call signal is passed,
   * so a timeout-driven abort (see `withTimeoutAbort`) cancels the in-flight
   * fetch and halts the retry loop process-wide for that agent.
   *
   * Only safe when the agent instance runs ONE `execute()` at a time. Agents
   * invoked concurrently on a shared instance (e.g. parallel-episode
   * StoryArchitect) must thread a per-call `signal` explicitly instead.
   */
  protected activeAbortSignal?: AbortSignal;

  /** Whether the last parseJSON() dropped content during truncation recovery. */
  public wasLastResponseTruncated(): boolean {
    return this.lastResponseTruncated;
  }

  // Truncation shadow counter (WS5, AGENT_ARCHITECTURE_PLAN_2026-06-12).
  // Truncation recovery is SILENT data loss unless the caller polls
  // wasLastResponseTruncated() — and most don't. This observer fires at the
  // moment recovery drops content, so the pipeline can ledger the count per
  // agent (09-llm-ledger.json) and surface a warning. The shadow data decides
  // whether the next slice (retry-on-truncation / fail-fast) is worth its cost.
  private static _truncationObserver?: (event: TruncationObservation) => void;

  static setTruncationObserver(observer?: (event: TruncationObservation) => void): void {
    BaseAgent._truncationObserver = observer;
  }

  /** Mark the in-flight parse as lossy-truncated and notify the observer. */
  protected markResponseTruncated(): void {
    this.lastResponseTruncated = true;
    try {
      BaseAgent._truncationObserver?.({ agentName: this.name, provider: this.config.provider });
    } catch {
      // Observation must never break a parse.
    }
  }

  // Shared circuit breaker — prevents retry storms when the proxy/Anthropic is down.
  // After CIRCUIT_BREAKER_THRESHOLD consecutive failures across ALL agents, all LLM
  // calls pause for CIRCUIT_BREAKER_COOLDOWN_MS before the next attempt.
  private static _cbConsecutiveFailures = 0;
  private static _cbCooldownUntil = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private static readonly CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
  private static _globalSemaphore: AsyncSemaphore | null = null;
  private static _providerSemaphores = new Map<'anthropic' | 'openai' | 'gemini' | 'openrouter', AsyncSemaphore>();
  private static _guardrails: LlmGuardrailConfig = {
    maxGlobalInFlight: 4,
    maxPerProviderInFlight: 2,
    backoffJitterRatio: 0.15,
  };
  private static _observer?: (observation: LlmCallObservation) => void;

  private static isQuotaMessage(message: string): boolean {
    const lower = (message || '').toLowerCase();
    return (
      lower.includes('exceeded your current quota') ||
      lower.includes('quota exceeded for metric') ||
      lower.includes('generate_requests_per_model_per_day') ||
      lower.includes('limit: 0')
    );
  }

  /**
   * Classify an LLM-call failure for the retry loop. PURE (no `this`, no side
   * effects) so it can be unit-tested directly.
   *
   * `terminated` is undici's message when the underlying socket / response body
   * stream drops mid-request (`UND_ERR_SOCKET`). On a very large prompt (e.g. a
   * full treatment) this transient drop is the dominant failure mode, so it counts
   * as a connection failure (feeds the circuit breaker) AND is retryable — UNLESS
   * the call was intentionally aborted (the scoped `withTimeoutAbort` timeout or a
   * caller cancellation), in which case it must never be retried. undici can
   * surface a timeout-abort as a bare `terminated`, so the caller passes the scoped
   * signal's `aborted` state as the authoritative abort signal rather than relying
   * on the message text.
   */
  /**
   * WS1b: latched when any call fails with a definitive billing/quota
   * exhaustion error (message preserved for diagnostics). Account-global, so
   * the pipeline checks it at cancellation checkpoints and pauses the run.
   */
  private static _billingQuotaExhausted: string | null = null;

  static billingQuotaExhausted(): string | null {
    return BaseAgent._billingQuotaExhausted;
  }

  /** Reset at run start so a resumed run after a credit top-up isn't poisoned. */
  static resetBillingQuotaState(): void {
    BaseAgent._billingQuotaExhausted = null;
  }

  static classifyLlmError(input: {
    message: string;
    errorName?: string;
    signalAborted?: boolean;
    isQuotaError?: boolean;
  }): { isRetryable: boolean; isAbortError: boolean; isConnectionFailure: boolean } {
    const msg = (input.message || '').toLowerCase();
    const isConnectionFailure =
      msg.includes('fetch failed') || msg.includes('500') || msg.includes('502') ||
      msg.includes('503') || msg.includes('unreachable') || msg.includes('terminated');
    const isAbortError =
      !!input.signalAborted || input.errorName === 'AbortError' || msg.includes('aborted');
    const isRetryable = !input.isQuotaError && !isAbortError && (
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('terminated') || // undici socket/body-stream drop (UND_ERR_SOCKET)
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('529') || // Anthropic overloaded
      msg.includes('500') || // Internal server error
      msg.includes('502') || // Bad gateway
      msg.includes('503') || // Service unavailable
      msg.includes('rate limit') ||
      msg.includes('overloaded') ||
      msg.includes('high demand') ||
      msg.includes('truncated llm response')
    );
    return { isRetryable, isAbortError, isConnectionFailure };
  }

  constructor(name: string, config: AgentConfig) {
    this.name = name;
    this.config = config;
    this.systemPrompt = this.buildSystemPrompt();
  }

  static configureGuardrails(config: Partial<LlmGuardrailConfig>): void {
    BaseAgent._guardrails = {
      ...BaseAgent._guardrails,
      ...config,
      maxGlobalInFlight: Math.max(1, Math.floor(config.maxGlobalInFlight ?? BaseAgent._guardrails.maxGlobalInFlight)),
      maxPerProviderInFlight: Math.max(1, Math.floor(config.maxPerProviderInFlight ?? BaseAgent._guardrails.maxPerProviderInFlight)),
      backoffJitterRatio: Math.max(0, Math.min(0.5, config.backoffJitterRatio ?? BaseAgent._guardrails.backoffJitterRatio)),
    };
    BaseAgent._globalSemaphore = new AsyncSemaphore(BaseAgent._guardrails.maxGlobalInFlight);
    BaseAgent._providerSemaphores.set('anthropic', new AsyncSemaphore(BaseAgent._guardrails.maxPerProviderInFlight));
    BaseAgent._providerSemaphores.set('openai', new AsyncSemaphore(BaseAgent._guardrails.maxPerProviderInFlight));
    BaseAgent._providerSemaphores.set('gemini', new AsyncSemaphore(BaseAgent._guardrails.maxPerProviderInFlight));
    BaseAgent._providerSemaphores.set('openrouter', new AsyncSemaphore(BaseAgent._guardrails.maxPerProviderInFlight));
  }

  static setLlmCallObserver(observer?: (observation: LlmCallObservation) => void): void {
    BaseAgent._observer = observer;
  }

  /**
   * Test-only seam: when set, callLLM routes every request through this
   * function instead of the real provider transports (no retries, guardrails,
   * circuit breaker, or observer — the override owns the whole exchange).
   * Production code must never set this; it exists so the prompt-snapshot
   * harness can capture/replay full pipeline runs offline.
   */
  static setLlmTransportOverride(override: LlmTransportOverride | null): void {
    BaseAgent._transportOverride = override;
  }

  private static _transportOverride: LlmTransportOverride | null = null;

  private async acquireGuardrailPermits(): Promise<{ release: () => void; queueWaitMs: number }> {
    if (!BaseAgent._globalSemaphore) {
      BaseAgent.configureGuardrails(BaseAgent._guardrails);
    }
    const provider = this.config.provider;
    const providerSemaphore = BaseAgent._providerSemaphores.get(provider);
    if (!BaseAgent._globalSemaphore || !providerSemaphore) {
      return { release: () => undefined, queueWaitMs: 0 };
    }

    const waitStart = Date.now();
    const releaseGlobal = await BaseAgent._globalSemaphore.acquire();
    const releaseProvider = await providerSemaphore.acquire();
    const queueWaitMs = Date.now() - waitStart;

    return {
      queueWaitMs,
      release: () => {
        releaseProvider();
        releaseGlobal();
      },
    };
  }

  /**
   * Build the complete system prompt including core storytelling principles
   * and agent-specific instructions.
   */
  protected buildSystemPrompt(): string {
    return `You are ${this.name}, an expert AI agent specialized in interactive narrative design.

${CORE_STORYTELLING_PROMPT}

${this.getAgentSpecificPrompt()}

## Output Format
Always respond with valid JSON that matches the requested schema.
Do not include any text before or after the JSON.
Do not use markdown code blocks around the JSON.
`;
  }

  /**
   * Agent-specific prompt - override in subclasses
   */
  protected abstract getAgentSpecificPrompt(): string;

  /**
   * Call the LLM with the given messages (with retry for transient errors)
   */
  protected async callLLM(messages: AgentMessage[], retries: number = 4, options?: { useMemory?: boolean; signal?: AbortSignal; jsonSchema?: StructuredJsonSchema }): Promise<string> {
    const existingSystemMessage = messages.find((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    // Use existing system message if provided, otherwise auto-inject if opted in
    let systemMessage = existingSystemMessage;
    if (!systemMessage && this.includeSystemPrompt && this.systemPrompt) {
      systemMessage = { role: 'system', content: this.systemPrompt };
    }
    if (options?.jsonSchema) {
      const instruction = structuredOutputContract(options.jsonSchema.name);
      systemMessage = systemMessage
        ? appendTextInstruction(systemMessage, instruction)
        : { role: 'system', content: instruction };
    }

    const fullMessages: AgentMessage[] = [
      ...(systemMessage ? [systemMessage] : []),
      ...otherMessages,
    ];

    if (BaseAgent._transportOverride) {
      return BaseAgent._transportOverride({
        agentName: this.name,
        provider: this.config.provider,
        model: this.config.model,
        messages: fullMessages,
      });
    }

    // Circuit breaker: if the shared failure counter has tripped, wait for cooldown
    const now = Date.now();
    if (BaseAgent._cbConsecutiveFailures >= BaseAgent.CIRCUIT_BREAKER_THRESHOLD && now < BaseAgent._cbCooldownUntil) {
      const waitMs = BaseAgent._cbCooldownUntil - now;
      console.warn(`[${this.name}] Circuit breaker OPEN — ${BaseAgent._cbConsecutiveFailures} consecutive failures. Pausing ${Math.round(waitMs / 1000)}s before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const { release, queueWaitMs } = await this.acquireGuardrailPermits();
      const callStart = Date.now();
      // I4: providers write token usage into this capture object when available.
      // `callLLM` forwards it to the observer so the pipeline can aggregate a
      // per-agent / per-phase LLM ledger without each caller having to plumb
      // usage by hand.
      const usageCapture: { inputTokens?: number; outputTokens?: number } = {};
      try {
        let result: string;
        // Fall back to the agent-scoped signal (set by execute) when the caller
        // didn't pass a per-call one, so a timeout abort reaches every call site.
        const signal = options?.signal ?? this.activeAbortSignal;
        if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        if (this.config.provider === 'anthropic' && options?.useMemory) {
          result = await this.callAnthropicWithMemory(fullMessages, usageCapture);
        } else if (this.config.provider === 'anthropic') {
          result = await this.callAnthropic(fullMessages, signal, usageCapture, options?.jsonSchema);
        } else if (this.config.provider === 'gemini') {
          result = await this.callGemini(fullMessages, signal, usageCapture, options?.jsonSchema);
        } else if (this.config.provider === 'openrouter') {
          result = await this.callOpenRouter(fullMessages, signal, usageCapture, options?.jsonSchema);
        } else {
          result = await this.callOpenAI(fullMessages, signal, usageCapture, options?.jsonSchema);
        }
        // Success — reset circuit breaker
        if (BaseAgent._cbConsecutiveFailures > 0) {
          log.debug(`[${this.name}] LLM call succeeded — circuit breaker reset (was at ${BaseAgent._cbConsecutiveFailures} failures)`);
        }
        BaseAgent._cbConsecutiveFailures = 0;
        BaseAgent._observer?.({
          agentName: this.name,
          provider: this.config.provider,
          success: true,
          durationMs: Date.now() - callStart,
          queueWaitMs,
          attempt,
          usage:
            typeof usageCapture.inputTokens === 'number' && typeof usageCapture.outputTokens === 'number'
              ? { inputTokens: usageCapture.inputTokens, outputTokens: usageCapture.outputTokens }
              : undefined,
        });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const msg = lastError.message.toLowerCase();
        const stack = lastError.stack || '';
        const isBillingExhausted = lastError.name === 'LLMQuotaError' || isBillingQuotaMessage(msg);
        const isQuotaError = isBillingExhausted ||
          (this.config.provider === 'gemini' && BaseAgent.isQuotaMessage(msg));
        // WS1b: billing exhaustion is account-global — every later call will
        // fail too. Latch a process-wide flag so the pipeline aborts at its
        // next cancellation checkpoint instead of grinding through the rest of
        // the season one failed scene at a time.
        if (isBillingExhausted) {
          BaseAgent._billingQuotaExhausted = lastError.message;
        }
        
        // Log EVERY failure with full detail so it's visible in browser console
        console.error(`[${this.name}] LLM call attempt ${attempt + 1}/${retries + 1} FAILED: ${lastError.message}`);
        console.error(`[${this.name}] Error stack: ${stack.substring(0, 500)}`);
        BaseAgent._observer?.({
          agentName: this.name,
          provider: this.config.provider,
          success: false,
          durationMs: Date.now() - callStart,
          queueWaitMs,
          attempt,
          error: lastError.message,
        });

        // Truncation is not a transient provider failure. Retrying the same
        // prompt/output schema repeats the same MAX_TOKENS failure and prevents
        // agent-level compact/schema-specific repair paths from running.
        if (lastError instanceof TruncatedLLMResponseError) {
          throw lastError;
        }

        // Classify the failure (pure helper — see BaseAgent.classifyLlmError). The
        // scoped abort signal is authoritative for "was this an intentional abort",
        // since undici can surface a timeout-abort as a bare `terminated`.
        const { isRetryable, isConnectionFailure } = BaseAgent.classifyLlmError({
          message: msg,
          errorName: lastError.name,
          signalAborted: !!this.activeAbortSignal?.aborted,
          isQuotaError,
        });
        // Track consecutive connection failures for the circuit breaker.
        if (isConnectionFailure) {
          BaseAgent._cbConsecutiveFailures++;
          if (BaseAgent._cbConsecutiveFailures >= BaseAgent.CIRCUIT_BREAKER_THRESHOLD) {
            BaseAgent._cbCooldownUntil = Date.now() + BaseAgent.CIRCUIT_BREAKER_COOLDOWN_MS;
            console.warn(`[${this.name}] Circuit breaker TRIPPED after ${BaseAgent._cbConsecutiveFailures} failures — all LLM calls paused for ${BaseAgent.CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`);
          }
        }

        if (!isRetryable || attempt === retries) {
          throw lastError;
        }

        // If circuit breaker just tripped, honor the full cooldown instead of short backoff
        if (BaseAgent._cbConsecutiveFailures >= BaseAgent.CIRCUIT_BREAKER_THRESHOLD) {
          const cbWait = BaseAgent._cbCooldownUntil - Date.now();
          if (cbWait > 0) {
            console.warn(`[${this.name}] Waiting ${Math.round(cbWait / 1000)}s (circuit breaker cooldown) before retry ${attempt + 2}/${retries + 1}`);
            await new Promise(resolve => setTimeout(resolve, cbWait));
            continue;
          }
        }
        
        // Normal exponential backoff — longer ceiling for 5xx/connection and demand errors
        const is5xx = msg.includes('500') || msg.includes('503') || msg.includes('502') || msg.includes('fetch failed');
        const isDemand = msg.includes('high demand') || msg.includes('rate limit') || msg.includes('overloaded') || msg.includes('529');
        const maxDelay = (is5xx || isDemand) ? 30000 : 10000;
        const baseDelay = Math.min(1000 * Math.pow(2, attempt), maxDelay);
        const jitterRatio = BaseAgent._guardrails.backoffJitterRatio;
        const jitterMultiplier = 1 + ((Math.random() * 2 - 1) * jitterRatio);
        const delay = Math.max(100, Math.round(baseDelay * jitterMultiplier));
        console.warn(`[${this.name}] LLM call failed (attempt ${attempt + 1}/${retries + 1}): ${lastError.message}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } finally {
        release();
      }
    }
    
    throw lastError || new Error('LLM call failed after retries');
  }

  /**
   * Build the Anthropic `system` field as a cache-controlled content block so
   * the (large, stable) system prompt is cached across calls (prompt caching,
   * ~90% input-cost reduction on the cached prefix). Returns undefined when
   * there is no system prompt (utility agents). See docs/PROJECT_AUDIT_2026-05-28.md (C1).
   *
   * Below Anthropic's minimum cacheable size the cache_control is simply
   * ignored by the API (no error), so it is always safe to set.
   */
  protected buildCachedSystemField(systemText: string): Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> | undefined {
    if (!systemText) return undefined;
    return [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
  }

  private async callAnthropic(
    messages: AgentMessage[],
    signal?: AbortSignal,
    usageOut?: { inputTokens?: number; outputTokens?: number },
    jsonSchema?: StructuredJsonSchema,
  ): Promise<string> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    const totalInputChars = (typeof systemMessage?.content === 'string' ? systemMessage.content.length : 0)
      + otherMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
    log.debug(`[${this.name}] Calling Anthropic API via ${isWebRuntime() ? 'proxy' : 'direct'}... (input ~${Math.round(totalInputChars / 4)} tokens, maxTokens: ${this.config.maxTokens})`);

    const systemText = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : (Array.isArray(systemMessage?.content)
          ? (systemMessage?.content[0] as any)?.text || ''
          : '');

    const body: any = {
      model: this.config.model,
      max_tokens: jsonSchema ? structuredMaxTokens(this.config.maxTokens, jsonSchema, 8192) : this.config.maxTokens,
      // Cache the stable system prompt prefix across calls (C1).
      system: this.buildCachedSystemField(systemText),
      messages: otherMessages.map((m) => {
        if (typeof m.content === 'string') {
          return { role: m.role, content: m.content };
        }
        
        // Handle array content for vision
        return {
          role: m.role,
          content: m.content.map(part => {
            if (part.type === 'text') return part;
            if (part.type === 'image') return part;
            // Anthropic doesn't support image_url directly, only base64
            return null;
          }).filter(Boolean)
        };
      }),
    };

    // Sampling params (`temperature`/`top_p`/`top_k`) were removed on the
    // adaptive-thinking generation of Claude models (Opus 4.6/4.7/4.8,
    // Sonnet 4.6, Haiku 4.5, Fable 5) — sending `temperature` to those returns
    // a 400 ("temperature is deprecated for this model"). Only pass it to older
    // models that still accept it; the newer models steer via prompting.
    if (modelAcceptsTemperature(this.config.model)) {
      body.temperature = this.config.temperature;
    }

    // Schema-strict JSON via forced tool use: the model must call the single
    // provided tool, whose `input_schema` IS the requested JSON Schema, so the
    // tool_use `input` is guaranteed schema-valid (no markdown, no truncated
    // free-text JSON to repair). Streaming is disabled for these calls — the
    // payloads are small and the buffered path's tool_use extraction is simpler.
    if (jsonSchema) {
      body.tools = [{
        name: jsonSchema.name,
        description: jsonSchema.description ?? 'Return the result as structured JSON.',
        input_schema: jsonSchema.schema,
      }];
      body.tool_choice = { type: 'tool', name: jsonSchema.name };
    }

    // Hint proxy timeout policy for long-running calls.
    // 60s connect timeout is too aggressive for some Anthropic calls (world/story planning),
    // causing repeat 502 timeout/abort failures even when the service is reachable.
    const stepName = this.name.toLowerCase();
    const isHeavyPlanningStep =
      stepName.includes('world builder') ||
      stepName.includes('story architect') ||
      stepName.includes('season planner') ||
      stepName.includes('source material analyzer');
    const timeoutHintMs = this.config.maxTokens >= 32000 ? 900000 : (isHeavyPlanningStep ? 300000 : 180000);
    const connectTimeoutHintMs = this.config.maxTokens >= 32000 ? 180000 : (isHeavyPlanningStep ? 180000 : 120000);

    // LEVER A: stream the response on the node/direct path. In web runtime the
    // proxy buffers and returns plain JSON, so streaming there would break it.
    const useStream = !jsonSchema && shouldStreamLLM(isWebRuntime());
    if (useStream) {
      body.stream = true;
      return await this.callAnthropicStreaming(body, signal, usageOut);
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        ...(isWebRuntime()
          ? {
              'x-llm-timeout-ms': String(timeoutHintMs),
              'x-llm-connect-timeout-ms': String(connectTimeoutHintMs),
              'x-llm-step': this.name,
            }
          : {}),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    const text = await response.text();

    if (!response.ok) {
      let errorMessage = `Anthropic API error: ${response.status} - ${text}`;
      
      // Try to parse as JSON if possible to get a cleaner error
      try {
        const errorJson = JSON.parse(text);
        if (errorJson.error && errorJson.error.message) {
          errorMessage = `Anthropic API error: ${errorJson.error.message}`;
        }
      } catch (e) {
        // Not JSON, keep original error message
      }
      
      console.error(`[${this.name}] Anthropic API returned HTTP ${response.status}: ${errorMessage}`);
      if (response.status === 402 || isBillingQuotaMessage(errorMessage)) {
        throw new LLMQuotaError(errorMessage, 'anthropic');
      }
      throw new Error(errorMessage);
    }

    try {
      const data = JSON.parse(text);
      const stopReason = data.stop_reason;
      const outputTokens = data.usage?.output_tokens ?? '?';
      const inputTokens = data.usage?.input_tokens ?? '?';
      // Prompt-cache visibility (C1): confirms the system prefix is being cached.
      const cacheRead = data.usage?.cache_read_input_tokens ?? 0;
      const cacheCreate = data.usage?.cache_creation_input_tokens ?? 0;
      const cacheNote = (cacheRead || cacheCreate) ? `, cache_read: ${cacheRead}, cache_created: ${cacheCreate}` : '';
      log.debug(`[${this.name}] Anthropic response: ${inputTokens} input tokens, ${outputTokens} output tokens, stop_reason: ${stopReason}${cacheNote}`);
      if (usageOut) {
        if (typeof data.usage?.input_tokens === 'number') usageOut.inputTokens = data.usage.input_tokens;
        if (typeof data.usage?.output_tokens === 'number') usageOut.outputTokens = data.usage.output_tokens;
      }
      if (stopReason === 'max_tokens') {
        throw new TruncatedLLMResponseError(
          `Truncated LLM response from Anthropic: stop_reason=max_tokens (limit: ${this.config.maxTokens})`,
          'anthropic',
          'max_tokens',
        );
      }
      // Schema-strict path: return the forced tool's `input` (already valid JSON)
      // serialized so the caller's parseJSON sees an object. Falls back to text
      // if the response somehow carries no tool_use block (e.g. a proxy that
      // strips `tools`) — the prompt still asks for JSON, so parseJSON recovers.
      if (jsonSchema && Array.isArray(data.content)) {
        const toolBlock = data.content.find((b: any) => b?.type === 'tool_use' && b?.input !== undefined);
        if (toolBlock) return JSON.stringify(toolBlock.input);
      }
      const textBlock = Array.isArray(data.content)
        ? data.content.find((b: any) => typeof b?.text === 'string')
        : undefined;
      return textBlock?.text ?? data.content[0]?.text ?? '';
    } catch (parseError) {
      if (parseError instanceof TruncatedLLMResponseError) throw parseError;
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse Anthropic response as JSON: ${msg}. Response start: ${text.substring(0, 500)}`);
    }
  }

  /**
   * LEVER A: Anthropic streaming transport (node/direct path only). Reads the
   * SSE response, accumulates content_block_delta text into the SAME final
   * string the buffered path returned, and populates usageOut from the streamed
   * message_start / message_delta usage events. parseJSON is unchanged.
   */
  private async callAnthropicStreaming(
    body: any,
    signal?: AbortSignal,
    usageOut?: { inputTokens?: number; outputTokens?: number },
  ): Promise<string> {
    // Fast idle-timeout abort controller, chained to the per-call signal.
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort((signal as { reason?: unknown })?.reason);
    if (signal) {
      if (signal.aborted) controller.abort((signal as { reason?: unknown }).reason);
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      throw err;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      let errorMessage = `Anthropic API error: ${response.status} - ${text}`;
      try {
        const errorJson = JSON.parse(text);
        if (errorJson.error && errorJson.error.message) {
          errorMessage = `Anthropic API error: ${errorJson.error.message}`;
        }
      } catch {
        /* not JSON */
      }
      console.error(`[${this.name}] Anthropic API returned HTTP ${response.status}: ${errorMessage}`);
      if (response.status === 402 || isBillingQuotaMessage(errorMessage)) {
        throw new LLMQuotaError(errorMessage, 'anthropic');
      }
      throw new Error(errorMessage);
    }

    try {
      const result = await readSSEStream(response.body as any, anthropicSseHandler, {
        signal,
        onIdleAbort: () => controller.abort(new Error('stream idle timeout')),
      });
      if (usageOut) {
        if (typeof result.usage?.inputTokens === 'number') usageOut.inputTokens = result.usage.inputTokens;
        if (typeof result.usage?.outputTokens === 'number') usageOut.outputTokens = result.usage.outputTokens;
      }
      const cacheNote = (result.cacheRead || result.cacheCreate)
        ? `, cache_read: ${result.cacheRead ?? 0}, cache_created: ${result.cacheCreate ?? 0}`
        : '';
      log.debug(
        `[${this.name}] Anthropic stream: ${result.usage?.inputTokens ?? '?'} input tokens, ` +
          `${result.usage?.outputTokens ?? '?'} output tokens${cacheNote} ` +
          `(first-byte ${result.firstByteMs}ms, total ${result.totalMs}ms)`,
      );
      return result.text;
    } finally {
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
  }

  private async callAnthropicWithMemory(
    messages: AgentMessage[],
    usageOut?: { inputTokens?: number; outputTokens?: number },
  ): Promise<string> {
    const MAX_MEMORY_ROUNDS = 10;
    const systemMessage = messages.find((m) => m.role === 'system');
    const initialMessages = messages.filter((m) => m.role !== 'system');

    const systemText = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : (Array.isArray(systemMessage?.content)
          ? (systemMessage?.content[0] as any)?.text || ''
          : '');

    const totalInputChars = systemText.length
      + initialMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
    log.debug(`[${this.name}] Calling Anthropic API with memory via ${isWebRuntime() ? 'proxy' : 'direct'}... (input ~${Math.round(totalInputChars / 4)} tokens)`);

    const conversationMessages: any[] = initialMessages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: m.content.map(part => {
          if (part.type === 'text') return part;
          if (part.type === 'image') return part;
          return null;
        }).filter(Boolean)
      };
    });

    const stepName = this.name.toLowerCase();
    const isHeavyPlanningStep =
      stepName.includes('world builder') ||
      stepName.includes('story architect') ||
      stepName.includes('season planner') ||
      stepName.includes('source material analyzer');
    const timeoutHintMs = this.config.maxTokens >= 32000 ? 900000 : (isHeavyPlanningStep ? 300000 : 180000);
    const connectTimeoutHintMs = this.config.maxTokens >= 32000 ? 180000 : (isHeavyPlanningStep ? 180000 : 120000);

    const memoryStore = getMemoryStore();

    for (let round = 0; round < MAX_MEMORY_ROUNDS; round++) {
      const body: any = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        // Cache the stable system prompt prefix across calls (C1).
        system: this.buildCachedSystemField(systemText),
        messages: conversationMessages,
        tools: [{ type: 'memory_20250818', name: 'memory' }],
      };

      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          ...(isWebRuntime()
            ? {
                'x-llm-timeout-ms': String(timeoutHintMs),
                'x-llm-connect-timeout-ms': String(connectTimeoutHintMs),
                'x-llm-step': this.name,
              }
            : {}),
        },
        body: JSON.stringify(body),
      });

      const text = await response.text();
      if (!response.ok) {
        let errorMessage = `Anthropic API error: ${response.status} - ${text}`;
        try {
          const errorJson = JSON.parse(text);
          if (errorJson.error?.message) errorMessage = `Anthropic API error: ${errorJson.error.message}`;
        } catch { /* keep original */ }
        if (response.status === 402 || isBillingQuotaMessage(errorMessage)) {
          throw new LLMQuotaError(errorMessage, 'anthropic');
        }
        throw new Error(errorMessage);
      }

      const data = JSON.parse(text);
      const stopReason = data.stop_reason;
      const outputTokens = data.usage?.output_tokens ?? '?';
      const inputTokens = data.usage?.input_tokens ?? '?';
      log.debug(`[${this.name}] Memory round ${round + 1}: ${inputTokens} in, ${outputTokens} out, stop: ${stopReason}`);
      if (usageOut) {
        if (typeof data.usage?.input_tokens === 'number') {
          usageOut.inputTokens = (usageOut.inputTokens ?? 0) + data.usage.input_tokens;
        }
        if (typeof data.usage?.output_tokens === 'number') {
          usageOut.outputTokens = (usageOut.outputTokens ?? 0) + data.usage.output_tokens;
        }
      }

      if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
        const textBlock = data.content?.find((b: any) => b.type === 'text');

        // Even on end_turn there may be trailing memory writes — execute them
        const toolBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use' && b.name === 'memory');
        for (const tb of toolBlocks) {
          try {
            await memoryStore.execute(tb.input as MemoryCommand);
            log.debug(`[${this.name}] Memory write (final): ${tb.input.command} ${tb.input.path || tb.input.old_path || ''}`);
          } catch (err) {
            console.warn(`[${this.name}] Memory write failed (final):`, err);
          }
        }

        if (stopReason === 'max_tokens') {
          throw new TruncatedLLMResponseError(
            `Truncated LLM response from Anthropic: stop_reason=max_tokens with memory enabled (limit: ${this.config.maxTokens})`,
            'anthropic',
            'max_tokens',
          );
        }
        return textBlock?.text || '';
      }

      if (stopReason === 'tool_use') {
        const toolBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use' && b.name === 'memory');
        if (toolBlocks.length === 0) {
          const textBlock = data.content?.find((b: any) => b.type === 'text');
          return textBlock?.text || '';
        }

        conversationMessages.push({ role: 'assistant', content: data.content });

        const toolResults: any[] = [];
        for (const tb of toolBlocks) {
          log.debug(`[${this.name}] Memory: ${tb.input.command} ${tb.input.path || tb.input.old_path || ''}`);
          let result: string;
          try {
            result = await memoryStore.execute(tb.input as MemoryCommand);
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tb.id,
            content: result,
          });
        }
        conversationMessages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unknown stop reason — extract text and return
      const textBlock = data.content?.find((b: any) => b.type === 'text');
      return textBlock?.text || '';
    }

    console.warn(`[${this.name}] Memory loop exhausted after ${MAX_MEMORY_ROUNDS} rounds`);
    return '';
  }

  private async callOpenAI(
    messages: AgentMessage[],
    signal?: AbortSignal,
    usageOut?: { inputTokens?: number; outputTokens?: number },
    jsonSchema?: StructuredJsonSchema,
  ): Promise<string> {
    const model = this.config.model || 'gpt-5';
    const isReasoningModel = /^(gpt-5|o1|o3|o4)/i.test(model);
    const reasoningEffort = this.config.openaiReasoningEffort || 'medium';
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => {
        if (typeof m.content === 'string') {
          return { role: m.role, content: m.content };
        }

        return {
          role: m.role,
          content: m.content.map(part => {
            if (part.type === 'text') return part;
            if (part.type === 'image_url') return part;
            if (part.type === 'image') {
              return {
                type: 'image_url',
                image_url: {
                  url: `data:${part.source.media_type};base64,${part.source.data}`
                }
              };
            }
            return null;
          }).filter(Boolean)
        };
      }),
    };
    if (jsonSchema) {
      // Schema-strict JSON output (overrides the loose json_object default).
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: jsonSchema.name, schema: jsonSchema.schema },
      };
    } else if (this.config.openaiForceJsonResponse !== false) {
      body.response_format = { type: 'json_object' };
    }
    if (isReasoningModel) {
      // Reasoning-class models (gpt-5, o1/o3/o4) require `max_completion_tokens`
      // instead of `max_tokens`, and reject the `temperature` parameter entirely
      // (temperature is fixed at 1 for these models). The budget is shared between
      // hidden reasoning tokens and visible completion tokens, so we enforce a
      // generous floor — otherwise reasoning alone burns the whole budget and the
      // visible content comes back empty with finish_reason="length".
      const reasoningFloorByEffort: Record<string, number> = {
        minimal: 4096,
        low: 8192,
        medium: 16384,
        high: 32768,
      };
      const floor = reasoningFloorByEffort[reasoningEffort] ?? 16384;
      const budget = jsonSchema
        ? structuredMaxTokens(this.config.maxTokens, jsonSchema, floor)
        : Math.max(this.config.maxTokens ?? 0, floor);
      body.max_completion_tokens = budget;
      body.reasoning_effort = reasoningEffort;
    } else {
      body.max_tokens = jsonSchema ? structuredMaxTokens(this.config.maxTokens, jsonSchema, 8192) : this.config.maxTokens;
      body.temperature = this.config.temperature;
    }

    // LEVER A: stream on the node/direct path; the web/proxy path stays buffered.
    // Schema-strict calls stay buffered (small payload, simpler extraction).
    const useStream = !jsonSchema && shouldStreamLLM(isWebRuntime());
    if (useStream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
      return await this.callOpenAIStreaming(body, model, isReasoningModel, signal, usageOut);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      ...(signal ? { signal } : {}),
      body: JSON.stringify(body),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} - ${text}`);
    }

    try {
      const data = JSON.parse(text);
      if (usageOut) {
        if (typeof data.usage?.prompt_tokens === 'number') usageOut.inputTokens = data.usage.prompt_tokens;
        if (typeof data.usage?.completion_tokens === 'number') usageOut.outputTokens = data.usage.completion_tokens;
      }
      const choice = data.choices?.[0];
      const content: string = choice?.message?.content ?? '';
      const finishReason: string | undefined = choice?.finish_reason;
      if (isTruncationFinishReason(finishReason)) {
        throw new TruncatedLLMResponseError(
          `Truncated LLM response from OpenAI: finish_reason=${finishReason} (limit: ${this.config.maxTokens})`,
          'openai',
          finishReason,
        );
      }

      if (!content || content.trim().length === 0) {
        const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
        const completionTokens = data.usage?.completion_tokens;
        if (isReasoningModel && finishReason === 'length') {
          throw new Error(
            `OpenAI returned empty content (finish_reason=length). The reasoning-class model "${model}" consumed the entire ` +
              `max_completion_tokens budget on internal reasoning ` +
              `(reasoning_tokens=${reasoningTokens ?? '?'}, completion_tokens=${completionTokens ?? '?'}, ` +
              `budget=${body.max_completion_tokens}). ` +
              `Lower REASONING EFFORT in the OPENAI ADVANCED panel, raise maxTokens, or switch to a non-reasoning model like gpt-4o / gpt-4.1.`,
          );
        }
        throw new Error(
          `OpenAI returned empty content (finish_reason=${finishReason ?? 'unknown'}). Model=${model}. Response: ${text.substring(0, 500)}`,
        );
      }

      return content;
    } catch (parseError) {
      if (parseError instanceof TruncatedLLMResponseError) throw parseError;
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      // If we already threw a descriptive error above, rethrow it verbatim.
      if (msg.startsWith('OpenAI returned empty content')) throw parseError;
      throw new Error(`Failed to parse OpenAI response as JSON: ${msg}. Response start: ${text.substring(0, 500)}`);
    }
  }

  /**
   * LEVER A: OpenAI streaming transport (node/direct path only). Accumulates
   * choices[0].delta.content into the SAME final string and reads usage from the
   * final include_usage chunk. parseJSON / empty-content handling preserved.
   */
  private async callOpenAIStreaming(
    body: Record<string, unknown>,
    model: string,
    isReasoningModel: boolean,
    signal?: AbortSignal,
    usageOut?: { inputTokens?: number; outputTokens?: number },
  ): Promise<string> {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort((signal as { reason?: unknown })?.reason);
    if (signal) {
      if (signal.aborted) controller.abort((signal as { reason?: unknown }).reason);
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      throw err;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      throw new Error(`OpenAI API error: ${response.status} - ${text}`);
    }

    let result;
    try {
      result = await readSSEStream(response.body as any, openaiSseHandler, {
        signal,
        onIdleAbort: () => controller.abort(new Error('stream idle timeout')),
      });
    } finally {
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }

    if (usageOut) {
      if (typeof result.usage?.inputTokens === 'number') usageOut.inputTokens = result.usage.inputTokens;
      if (typeof result.usage?.outputTokens === 'number') usageOut.outputTokens = result.usage.outputTokens;
    }
    log.debug(
      `[${this.name}] OpenAI stream: ${result.usage?.inputTokens ?? '?'} input tokens, ` +
        `${result.usage?.outputTokens ?? '?'} output tokens ` +
        `(first-byte ${result.firstByteMs}ms, total ${result.totalMs}ms)`,
    );

    const content = result.text;
    if (!content || content.trim().length === 0) {
      if (isReasoningModel) {
        throw new Error(
          `OpenAI returned empty content (stream). The reasoning-class model "${model}" likely consumed the entire ` +
            `max_completion_tokens budget (budget=${(body as any).max_completion_tokens}) on internal reasoning. ` +
            `Lower REASONING EFFORT in the OPENAI ADVANCED panel, raise maxTokens, or switch to a non-reasoning model like gpt-4o / gpt-4.1.`,
        );
      }
      throw new Error(`OpenAI returned empty content (stream). Model=${model}.`);
    }
    return content;
  }

  /**
   * OpenRouter transport — a SEPARATE path from OpenAI/Anthropic/Gemini that does
   * not touch or gate them. OpenRouter exposes an OpenAI-wire `/chat/completions`
   * API (Bearer auth, `response_format`, SSE `delta.content`, `usage.*_tokens`),
   * so the request/response SHAPE matches OpenAI — but it is its own provider with
   * its own endpoint, attribution headers, model-id namespace (`vendor/model`),
   * and dispatch branch. It deliberately omits OpenAI's reasoning-class shaping
   * (`max_completion_tokens` / `reasoning_effort`): OpenRouter normalizes plain
   * `max_tokens` + `temperature` across every vendor it routes to.
   */
  private async callOpenRouter(
    messages: AgentMessage[],
    signal?: AbortSignal,
    usageOut?: { inputTokens?: number; outputTokens?: number },
    jsonSchema?: StructuredJsonSchema,
  ): Promise<string> {
    const model = this.config.model || 'x-ai/grok-4.3';
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => {
        if (typeof m.content === 'string') {
          return { role: m.role, content: m.content };
        }
        return {
          role: m.role,
          content: m.content.map(part => {
            if (part.type === 'text') return part;
            if (part.type === 'image_url') return part;
            if (part.type === 'image') {
              return {
                type: 'image_url',
                image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` },
              };
            }
            return null;
          }).filter(Boolean),
        };
      }),
      max_tokens: jsonSchema ? structuredMaxTokens(this.config.maxTokens, jsonSchema, 8192) : this.config.maxTokens,
      temperature: this.config.temperature,
    };
    if (jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: jsonSchema.name, schema: jsonSchema.schema },
      };
    } else if (this.config.openaiForceJsonResponse !== false) {
      body.response_format = { type: 'json_object' };
    }

    const useStream = !jsonSchema && shouldStreamLLM(isWebRuntime());
    if (useStream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
      return await this.callOpenRouterStreaming(body, model, signal, usageOut);
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: this.openRouterHeaders(),
      ...(signal ? { signal } : {}),
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${text}`);
    }

    try {
      const data = JSON.parse(text);
      if (usageOut) {
        if (typeof data.usage?.prompt_tokens === 'number') usageOut.inputTokens = data.usage.prompt_tokens;
        if (typeof data.usage?.completion_tokens === 'number') usageOut.outputTokens = data.usage.completion_tokens;
      }
      const choice = data.choices?.[0];
      const content: string = choice?.message?.content ?? '';
      const finishReason: string | undefined = choice?.finish_reason;
      if (isTruncationFinishReason(finishReason)) {
        throw new TruncatedLLMResponseError(
          `Truncated LLM response from OpenRouter: finish_reason=${finishReason} (limit: ${this.config.maxTokens})`,
          'openrouter',
          finishReason,
        );
      }
      if (!content || content.trim().length === 0) {
        throw new Error(
          `OpenRouter returned empty content (finish_reason=${finishReason ?? 'unknown'}). Model=${model}. Response: ${text.substring(0, 500)}`,
        );
      }
      return content;
    } catch (parseError) {
      if (parseError instanceof TruncatedLLMResponseError) throw parseError;
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      if (msg.startsWith('OpenRouter returned empty content')) throw parseError;
      throw new Error(`Failed to parse OpenRouter response as JSON: ${msg}. Response start: ${text.substring(0, 500)}`);
    }
  }

  /** OpenRouter auth + attribution headers (recommended for usage rankings). */
  private openRouterHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'HTTP-Referer': 'https://storyrpg.app',
      'X-Title': 'StoryRPG',
    };
  }

  /** OpenRouter streaming transport (node/direct path only). */
  private async callOpenRouterStreaming(
    body: Record<string, unknown>,
    model: string,
    signal?: AbortSignal,
    usageOut?: { inputTokens?: number; outputTokens?: number },
  ): Promise<string> {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort((signal as { reason?: unknown })?.reason);
    if (signal) {
      if (signal.aborted) controller.abort((signal as { reason?: unknown }).reason);
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }

    let response: Response;
    try {
      response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: this.openRouterHeaders(),
        signal: controller.signal,
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      throw err;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      throw new Error(`OpenRouter API error: ${response.status} - ${text}`);
    }

    let result;
    try {
      result = await readSSEStream(response.body as any, openaiSseHandler, {
        signal,
        onIdleAbort: () => controller.abort(new Error('stream idle timeout')),
      });
    } finally {
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }

    if (usageOut) {
      if (typeof result.usage?.inputTokens === 'number') usageOut.inputTokens = result.usage.inputTokens;
      if (typeof result.usage?.outputTokens === 'number') usageOut.outputTokens = result.usage.outputTokens;
    }
    log.debug(
      `[${this.name}] OpenRouter stream: ${result.usage?.inputTokens ?? '?'} input tokens, ` +
        `${result.usage?.outputTokens ?? '?'} output tokens ` +
        `(first-byte ${result.firstByteMs}ms, total ${result.totalMs}ms)`,
    );

    const content = result.text;
    if (!content || content.trim().length === 0) {
      throw new Error(`OpenRouter returned empty content (stream). Model=${model}.`);
    }
    return content;
  }

  private async callGemini(
    messages: AgentMessage[],
    signal?: AbortSignal,
    usageOut?: { inputTokens?: number; outputTokens?: number },
    jsonSchema?: StructuredJsonSchema,
  ): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key is missing');
    }

    const systemMessage = messages.find((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');
    let model = this.config.model || 'gemini-2.5-pro';
    if (model.startsWith('claude')) {
      console.warn(`[${this.name}] Anthropic model "${model}" passed to Gemini provider — falling back to gemini-2.5-pro`);
      model = 'gemini-2.5-pro';
    }
    const maxOutputTokens = jsonSchema
      ? structuredMaxTokens(this.config.maxTokens, jsonSchema, 8192)
      : this.config.maxTokens;

    const toParts = (content: AgentMessage['content']): Array<{ text: string }> => {
      if (typeof content === 'string') {
        return [{ text: content }];
      }
      const textParts = content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => ({ text: p.text }));
      return textParts.length > 0 ? textParts : [{ text: '' }];
    };

    const body: any = {
      contents: otherMessages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: toParts(m.content),
      })),
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens,
        ...(() => {
          const thinkingConfig = resolveGeminiThinkingConfig(model, !!jsonSchema);
          return thinkingConfig ? { thinkingConfig } : {};
        })(),
        // Gemini's native JSON mode: constrains the model to emit a single valid
        // JSON value — no markdown fences, no prose preamble — which the narrative
        // agents (SceneWriter/ChoiceAuthor/StoryArchitect) all expect. Without it
        // Gemini returns markdown-wrapped or preamble-prefixed JSON that intermittently
        // defeats parseJSON (the recurring SceneWriter/ChoiceAuthor parse failures).
        // Mirrors the OpenAI `response_format: json_object` path and shares its opt-out
        // flag, so an agent that wants free-form prose (openaiForceJsonResponse=false)
        // still gets plain text.
        ...(jsonSchema
          ? {
              responseMimeType: 'application/json',
              responseSchema: toGeminiResponseSchema(jsonSchema.schema),
            }
          : this.config.openaiForceJsonResponse !== false
            ? { responseMimeType: 'application/json' }
            : {}),
      },
      // Gemini's DEFAULT safety filters over-block mature creative fiction — a dark
      // vampire-romance world (blood, predators, hunting, sensuality) trips them and the API
      // returns a candidate with finishReason=SAFETY and NO parts, surfacing as the opaque
      // "Gemini returned empty content" abort (bite-me-g18 World Builder). Send permissive
      // thresholds so legitimate fiction isn't blocked; egregious content still is.
      // Env-overridable (GEMINI_SAFETY_THRESHOLD) — BLOCK_NONE if a run still over-blocks.
      safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
        .map((category) => ({ category, threshold: process.env.GEMINI_SAFETY_THRESHOLD || 'BLOCK_ONLY_HIGH' })),
    };

    if (systemMessage) {
      body.systemInstruction = {
        parts: toParts(systemMessage.content),
      };
    }

    // LEVER A: stream on the node/direct path via :streamGenerateContent?alt=sse.
    // The web/proxy path keeps the buffered :generateContent call below.
    if (!jsonSchema && shouldStreamLLM(isWebRuntime())) {
      return await this.callGeminiStreaming(model, body, signal, usageOut);
    }

    // Bound the request with a REAL client-side timeout. Direct provider calls
    // (the worker path) have no proxy to honor a timeout header, so without this
    // a stalled connection hangs indefinitely with no output and the worker gets
    // killed as "stale". The timeout aborts the fetch so the retry loop can act.
    const timeoutMs = maxOutputTokens >= 32000 ? 900_000 : 300_000;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Gemini request exceeded ${timeoutMs}ms timeout`)),
      timeoutMs,
    );
    if (signal) {
      if (signal.aborted) controller.abort((signal as { reason?: unknown }).reason);
      else signal.addEventListener('abort', () => controller.abort((signal as { reason?: unknown }).reason), { once: true });
    }
    let response: Response;
    let text: string;
    try {
      response = await fetch(
        `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      text = await response.text();
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      if (BaseAgent.isQuotaMessage(text)) {
        throw new LLMQuotaError(`Gemini API quota error: ${text}`, 'gemini');
      }
      let message = `Gemini API error: ${response.status} - ${text}`;
      try {
        const parsed = JSON.parse(text);
        const maybeMessage = parsed?.error?.message;
        const maybeDetails = Array.isArray(parsed?.error?.details)
          ? ` Details: ${JSON.stringify(parsed.error.details).slice(0, 1200)}`
          : '';
        if (maybeMessage) message = `Gemini API error: ${maybeMessage}${maybeDetails}`;
        if (BaseAgent.isQuotaMessage(maybeMessage || text)) {
          throw new LLMQuotaError(message, 'gemini');
        }
      } catch (parseErr) {
        if (parseErr instanceof LLMQuotaError) throw parseErr;
      }
      throw new Error(message);
    }

    try {
      const data = JSON.parse(text);
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const output = parts
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .join('');
      if (usageOut) {
        const promptTokens = data?.usageMetadata?.promptTokenCount;
        const candidatesTokens = data?.usageMetadata?.candidatesTokenCount;
        if (typeof promptTokens === 'number') usageOut.inputTokens = promptTokens;
        if (typeof candidatesTokens === 'number') usageOut.outputTokens = candidatesTokens;
      }
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (isTruncationFinishReason(finishReason)) {
        const candidatesTokens = data?.usageMetadata?.candidatesTokenCount;
        const thoughtsTokens = data?.usageMetadata?.thoughtsTokenCount;
        throw new TruncatedLLMResponseError(
          `Truncated LLM response from Gemini: finishReason=${finishReason} (limit: ${maxOutputTokens}, outputTokens: ${typeof candidatesTokens === 'number' ? candidatesTokens : 'unknown'}, thoughtsTokens: ${typeof thoughtsTokens === 'number' ? thoughtsTokens : 'unknown'})`,
          'gemini',
          finishReason,
        );
      }
      if (!output) {
        const blockReason = data?.promptFeedback?.blockReason;
        throw new Error(
          `Gemini returned empty content (finishReason=${finishReason ?? 'unknown'}`
          + `${blockReason ? `, blockReason=${blockReason}` : ''}). Model=${model}.`,
        );
      }
      return output;
    } catch (parseError) {
      if (parseError instanceof TruncatedLLMResponseError) throw parseError;
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse Gemini response as JSON: ${msg}. Response start: ${text.substring(0, 500)}`);
    }
  }

  /**
   * LEVER A: Gemini streaming transport (node/direct path only). Uses the
   * :streamGenerateContent?alt=sse endpoint, accumulates
   * candidates[0].content.parts[].text into the SAME final string and reads
   * usageMetadata from the final chunk. The overall timeout backstop and the
   * fast idle-timeout both abort the underlying fetch.
   */
  private async callGeminiStreaming(
    model: string,
    body: any,
    signal?: AbortSignal,
    usageOut?: { inputTokens?: number; outputTokens?: number },
  ): Promise<string> {
    const timeoutMs = this.config.maxTokens >= 32000 ? 900_000 : 300_000;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Gemini request exceeded ${timeoutMs}ms timeout`)),
      timeoutMs,
    );
    const onOuterAbort = () => controller.abort((signal as { reason?: unknown })?.reason);
    if (signal) {
      if (signal.aborted) controller.abort((signal as { reason?: unknown }).reason);
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }

    let response: Response;
    try {
      response = await fetch(
        `${GEMINI_API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.config.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
    } catch (err) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      throw err;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      if (BaseAgent.isQuotaMessage(text)) {
        throw new LLMQuotaError(`Gemini API quota error: ${text}`, 'gemini');
      }
      let message = `Gemini API error: ${response.status} - ${text}`;
      try {
        const parsed = JSON.parse(text);
        const maybeMessage = parsed?.error?.message;
        if (maybeMessage) message = `Gemini API error: ${maybeMessage}`;
        if (BaseAgent.isQuotaMessage(maybeMessage || text)) {
          throw new LLMQuotaError(message, 'gemini');
        }
      } catch (parseErr) {
        if (parseErr instanceof LLMQuotaError) throw parseErr;
      }
      throw new Error(message);
    }

    let result;
    try {
      result = await readSSEStream(response.body as any, geminiSseHandler, {
        signal,
        onIdleAbort: () => controller.abort(new Error('stream idle timeout')),
      });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }

    if (usageOut) {
      if (typeof result.usage?.inputTokens === 'number') usageOut.inputTokens = result.usage.inputTokens;
      if (typeof result.usage?.outputTokens === 'number') usageOut.outputTokens = result.usage.outputTokens;
    }
    log.debug(
      `[${this.name}] Gemini stream: ${result.usage?.inputTokens ?? '?'} input tokens, ` +
        `${result.usage?.outputTokens ?? '?'} output tokens ` +
        `(first-byte ${result.firstByteMs}ms, total ${result.totalMs}ms)`,
    );
    if (!result.text) {
      throw new Error(
        `Gemini returned empty content (stream, finishReason=${result.finishReason ?? 'unknown'}`
        + `${result.blockReason ? `, blockReason=${result.blockReason}` : ''}). Model=${model}.`,
      );
    }
    if (isTruncationFinishReason(result.finishReason)) {
      throw new TruncatedLLMResponseError(
        `Truncated LLM response from Gemini stream: finishReason=${result.finishReason} (limit: ${this.config.maxTokens})`,
        'gemini',
        result.finishReason,
      );
    }
    return result.text;
  }

  /**
   * Parse JSON response from LLM, handling common issues
   */
  protected parseJSON<T>(response: string): T {
    // Reset the per-call truncation-loss signal (set by handleTruncation if it
    // has to drop content). See landmine L4.
    this.lastResponseTruncated = false;
    // Strip markdown code blocks with regex for more robust handling
    const cleaned = this.stripMarkdownCodeBlocks(response);

    // First attempt: try parsing as-is
    try {
      return JSON.parse(cleaned) as T;
    } catch (firstError) {
      log.debug(`[${this.name}] Initial JSON parse failed, attempting repair...`);

      // Second attempt: a COMPLETE JSON value followed by trailing non-whitespace
      // (a model appends commentary, a second object, or a stray code fence — the
      // "Unexpected non-whitespace character after JSON at position N" failure).
      // Extract the first balanced top-level value and ignore the trailing junk.
      const balanced = this.extractFirstBalancedJson(cleaned);
      if (balanced && balanced.length < cleaned.length) {
        try {
          const result = JSON.parse(balanced) as T;
          log.debug(`[${this.name}] Recovered JSON by dropping ${cleaned.length - balanced.length} trailing chars`);
          return result;
        } catch {
          // fall through to structural repair
        }
      }

      // Third attempt: try repairing common JSON errors (truncation, missing brace)
      try {
        const repaired = this.repairJSON(cleaned);
        const result = JSON.parse(repaired) as T;
        if (this.lastResponseTruncated && process.env.STORYRPG_ALLOW_LOSSY_JSON_TRUNCATION !== '1') {
          throw new TruncatedLLMResponseError(
            `Truncated LLM response from ${this.name}: JSON repair dropped or synthesized content; rejecting lossy parse.`,
            this.config.provider,
          );
        }
        log.debug(`[${this.name}] JSON repair successful`);
        return result;
      } catch (repairError) {
        if (repairError instanceof TruncatedLLMResponseError) throw repairError;
        // All attempts failed - throw original error with context
        throw new Error(`Failed to parse JSON response: ${firstError}\nResponse: ${response.slice(0, 500)}...`);
      }
    }
  }

  /**
   * Call the LLM and parse its response as JSON, re-sampling ONCE if the parse
   * fails. The heaviest structured agents (WorldBuilder, StoryArchitect,
   * EncounterArchitect — all on the planning tier) occasionally emit a single
   * malformed JSON value that repairJSON can't salvage: a doubled quote, or a
   * missing opening quote on an array element (e.g. `["Control",Secrecy"]`). On
   * an unreliable provider that one bad sample hard-aborted the whole run. A
   * fresh sample almost always parses, so we retry once with an explicit
   * "valid JSON only" nudge before giving up.
   *
   * Provider-agnostic and golden-safe: the happy path is identical to
   * callLLM()+parseJSON(), and the retry only fires when the first parse throws
   * (deterministic-transport tests return valid JSON, so they never hit it).
   */
  protected async callLLMForJson<T>(
    messages: AgentMessage[],
    options?: { useMemory?: boolean; signal?: AbortSignal; jsonSchema?: StructuredJsonSchema },
  ): Promise<{ data: T; rawResponse: string }> {
    const response = await this.callLLM(messages, 4, options);
    try {
      return { data: this.parseJSON<T>(response), rawResponse: response };
    } catch (parseError) {
      const reason = parseError instanceof Error ? parseError.message : String(parseError);
      log.warn(`[${this.name}] JSON parse failed; re-sampling once for strictly valid JSON. (${reason.slice(0, 160)})`);
      const retryMessages: AgentMessage[] = [
        ...messages,
        {
          role: 'user',
          content:
            'IMPORTANT: your previous response was not valid JSON (a quoting or bracket error). ' +
            'Re-send the SAME content as a SINGLE, strictly valid JSON value only — no prose, ' +
            'no markdown code fences, every property name and string value double-quoted and ' +
            'properly escaped, and no trailing commas.',
        },
      ];
      const retryResponse = await this.callLLM(retryMessages, 4, options);
      return { data: this.parseJSON<T>(retryResponse), rawResponse: retryResponse };
    }
  }

  /**
   * Return the first balanced top-level JSON object/array in `text` (from its first
   * `{`/`[` to the matching close), ignoring anything after it — or null when no
   * balanced value exists (e.g. the response was truncated mid-object, which the
   * structural repair path handles instead). String contents and escapes are
   * respected so braces inside string values never miscount the depth.
   */
  private extractFirstBalancedJson(text: string): string | null {
    const start = text.search(/[{[]/);
    if (start < 0) return null;
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  /**
   * Robustly strip markdown code blocks from LLM response
   */
  private stripMarkdownCodeBlocks(response: string): string {
    let cleaned = response.trim();

    // Avoid broad /[\s\S]*?/ regex extraction on model output. Large or malformed
    // SceneWriter responses can otherwise burn CPU inside V8 regexp matching before
    // the truncation/repair guards get a chance to reject them. Fence handling is a
    // simple bounded scan: find the first ``` fence, skip an optional language tag,
    // and use the next fence if present.
    const fenced = this.extractMarkdownFenceBody(cleaned);
    if (fenced) return fenced;
    
    // Pattern 2: Just strip leading ```json or ``` and trailing ```
    // Handle cases where there's content after closing ```
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```JSON')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    
    // Remove a trailing fence with possible whitespace using linear string ops.
    const trailingFence = cleaned.lastIndexOf('```');
    if (trailingFence >= 0 && cleaned.slice(trailingFence + 3).trim() === '') {
      cleaned = cleaned.slice(0, trailingFence);
    }
    
    // Pattern 3: Sometimes LLM wraps with single backticks
    if (cleaned.startsWith('`') && cleaned.endsWith('`')) {
      cleaned = cleaned.slice(1, -1);
    }
    
    // Pattern 4: No code blocks but response doesn't start with { or [
    const trimmedCleaned = cleaned.trim();
    if (!trimmedCleaned.startsWith('{') && !trimmedCleaned.startsWith('[')) {
      // Pattern 4a: The response IS JSON but the opening brace is missing.
      // Detect this by checking if the text starts with a quoted string followed by , or :
      // e.g., "episode-1","title":"..." or "episodeId":"ep-1",...
      // In this case, do NOT strip to the first { (that would grab a nested brace).
      // Instead, prepend { and let repairJSON handle the rest.
      if (/^"[^"]+"\s*[,:]/.test(trimmedCleaned)) {
        log.debug(`[BaseAgent] Response looks like JSON missing opening brace — prepending {`);
        cleaned = '{' + trimmedCleaned;
      } else {
        // Pattern 4b: Prose before JSON — find the first { or [ that starts a JSON structure
        const firstBrace = cleaned.indexOf('{');
        const firstBracket = cleaned.indexOf('[');
        const jsonStart = firstBrace >= 0 && firstBracket >= 0 
          ? Math.min(firstBrace, firstBracket)
          : Math.max(firstBrace, firstBracket);
        if (jsonStart > 0) {
          const preamble = cleaned.substring(0, jsonStart).trim();
          if (preamble.length > 0) {
            log.debug(`[BaseAgent] Stripped ${preamble.length} chars of preamble text before JSON`);
            cleaned = cleaned.substring(jsonStart);
          }
        }
      }
    }
    
    return cleaned.trim();
  }

  private extractMarkdownFenceBody(text: string): string | null {
    const open = text.indexOf('```');
    if (open < 0) return null;

    let bodyStart = open + 3;
    while (bodyStart < text.length && /[ \t]/.test(text[bodyStart])) bodyStart += 1;

    const lineEnd = text.indexOf('\n', bodyStart);
    if (lineEnd >= 0) {
      const tag = text.slice(bodyStart, lineEnd).trim().toLowerCase();
      if (tag === '' || tag === 'json') {
        bodyStart = lineEnd + 1;
      } else if (open === 0) {
        // Unknown fence language; keep the body after the tag for backward
        // compatibility with providers that return ```JSON5-ish labels.
        bodyStart = lineEnd + 1;
      }
    }

    const close = text.indexOf('```', bodyStart);
    if (close < 0) return null;

    const body = text.slice(bodyStart, close).trim();
    if (body.startsWith('{') || body.startsWith('[')) return body;
    return null;
  }

  /**
   * Attempt to repair common JSON syntax errors from LLMs
   */
  private repairJSON(json: string): string {
    let repaired = json.trim();

    // 0. FIX TRUNCATION - Handle responses cut off mid-generation
    // This commonly happens when max_tokens is reached
    repaired = this.handleTruncation(repaired);

    // 1. FIX MISSING OPENING BRACE
    // LLMs sometimes output JSON starting with a property name instead of {
    // e.g., "episodeId":"ep-1",... instead of {"episodeId":"ep-1",...}
    if (!repaired.startsWith('{') && !repaired.startsWith('[')) {
      // Case A: Starts with a quoted string followed by : (missing opening brace)
      // e.g., "episodeId":"ep-1",... -> {"episodeId":"ep-1",...
      if (/^"[^"]+"\s*:/.test(repaired)) {
        log.debug(`[BaseAgent] Fixing missing opening brace (case A)`);
        repaired = '{' + repaired;
      }
      // Case B: Starts with a quoted value followed by comma and property name
      // e.g., "episode-1","title":"..." -> {"episodeId":"episode-1","title":"..."
      // This happens when LLM outputs a value instead of key:value
      else if (/^"[^"]+"\s*,\s*"[^"]+"\s*:/.test(repaired)) {
        log.debug(`[BaseAgent] Fixing orphan value at start (case B) - prepending episodeId key`);
        repaired = '{"episodeId":' + repaired;
      }
      // Case C: Starts with a bare number followed by comma and property name
      // e.g., 1,"title":"The Client"... -> {"episodeNumber":1,"title":"The Client"...
      else if (/^\d+\s*,\s*"[^"]+"\s*:/.test(repaired)) {
        log.debug(`[BaseAgent] Fixing missing opening brace and key (case C)`);
        repaired = '{"episodeNumber":' + repaired;
      }
      // Case D: Starts with a bare number followed by colon (numeric key without brace)
      // e.g., 1: "value" -> {1: "value"} - rare but possible
      else if (/^\d+\s*:/.test(repaired)) {
        log.debug(`[BaseAgent] Fixing missing opening brace (case D) - numeric key`);
        repaired = '{' + repaired;
      }
    }

    // 1b. FIX ORPHAN VALUE AFTER OPENING BRACE
    // LLM sometimes outputs {"episode-1","title":"..." instead of {"episodeId":"episode-1","title":"..."
    // The opening { is present but the first element is a value, not a key:value pair
    const orphanValueMatch = repaired.match(/^\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*:/);
    if (orphanValueMatch) {
      // Check if the first "value" doesn't have a colon after it (it's an orphan value)
      const afterFirstQuote = repaired.match(/^\{\s*"[^"]+"\s*([,}])/);
      if (afterFirstQuote && afterFirstQuote[1] === ',') {
        log.debug(`[BaseAgent] Fixing orphan value after opening brace - inserting "episodeId" key`);
        repaired = repaired.replace(/^\{\s*"/, '{"episodeId":"');
      }
    }

    // 1c. FIX EMPTY VALUES
    // LLM retries can occasionally omit a scalar value while keeping the key,
    // e.g. {"episodeId":,"title":"..."}. Use null so agent-specific
    // normalization/defaulting can repair the field without losing the object.
    repaired = repaired.replace(/:\s*(?=[,}\]])/g, ':null');

    // 2. Remove trailing commas before ] or }
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

    // 3. Fix missing closing braces/brackets by analyzing structure
    repaired = this.balanceBrackets(repaired);

    // 4. Fix unquoted property names (rare but happens)
    // Match property names that aren't quoted: { foo: "bar" } -> { "foo": "bar" }
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

    return repaired;
  }

  /**
   * True when `json` has an even number of unescaped `"` — i.e. every string is
   * closed. An odd count means a string was left open (the response was cut
   * mid-string), which {@link handleTruncation} must recover rather than treat
   * as complete. Pure; mirrors the escape handling of the recovery loop below.
   */
  private hasBalancedJsonQuotes(json: string): boolean {
    let quotes = 0;
    for (let i = 0; i < json.length; i++) {
      if (json[i] === '"' && (i === 0 || json[i - 1] !== '\\')) quotes++;
    }
    return quotes % 2 === 0;
  }

  /**
   * Handle truncated JSON responses (when max_tokens is reached)
   * Finds the last complete element and truncates there
   */
  private handleTruncation(json: string): string {
    // Check if the JSON appears truncated (ends mid-string or mid-value)
    const trimmed = json.trim();

    // Only short-circuit when the JSON ends on a STRUCTURAL closer (`}`/`]`) AND
    // every string is closed (even unescaped-quote parity). handleTruncation is
    // only ever reached AFTER the initial JSON.parse already failed, so a naive
    // "ends with a quote / digit / keyword → assume complete" check is wrong: a
    // response truncated mid-string commonly ends on a dangling `"` (the cut
    // landed right after an opening or escaped quote), and treating that as
    // complete skips ALL recovery and rethrows "Unterminated string in JSON"
    // (the bite-me-g14 SceneWriter s1-6 abort). A trailing scalar (`"`, digit,
    // true/false/null) is NOT a completeness signal; only `}`/`]` is.
    if ((trimmed.endsWith('}') || trimmed.endsWith(']')) && this.hasBalancedJsonQuotes(trimmed)) {
      return json;
    }

    log.debug(`[BaseAgent] Detected truncated response, attempting recovery...`);

    // Find the last complete array element (for shots arrays)
    // Look for the pattern: }, { or }, ] which indicates a complete object in an array
    const lastCompletePos = json.lastIndexOf('},');
    if (lastCompletePos > 0) {
      const truncated = json.slice(0, lastCompletePos + 1);
      const droppedChars = json.length - truncated.length;
      this.markResponseTruncated();
      log.warn(
        `[${this.name}] Truncation recovery DROPPED ~${droppedChars} chars of content ` +
          `(recovered to last complete object). Output is incomplete — likely missing trailing ` +
          `scenes/beats. Consider raising maxTokens. See landmine L4.`,
      );
      return truncated;
    }

    // If we can't find a clean truncation point, try to close the current string
    // Count quotes to see if we're in an unterminated string
    let quoteCount = 0;
    let lastQuotePos = -1;
    for (let i = 0; i < json.length; i++) {
      if (json[i] === '"' && (i === 0 || json[i-1] !== '\\')) {
        quoteCount++;
        lastQuotePos = i;
      }
    }

    // Odd number of quotes means unterminated string
    if (quoteCount % 2 === 1 && lastQuotePos > 0) {
      // Find the last property name before the unterminated value
      const beforeLastQuote = json.slice(0, lastQuotePos);
      const lastPropName = this.findPropertyNameBeforeDanglingValue(beforeLastQuote);
      
      if (lastPropName) {
        // Truncate before this property and close the structure
        const propStart = beforeLastQuote.lastIndexOf('"' + lastPropName + '"');
        if (propStart > 0) {
          // Go back to find the comma or opening brace
          let truncateAt = propStart;
          while (truncateAt > 0 && json[truncateAt - 1] !== ',' && json[truncateAt - 1] !== '{') {
            truncateAt--;
          }
          if (truncateAt > 0) {
            const truncated = json.slice(0, truncateAt).replace(/,\s*$/, '');
            const droppedChars = json.length - truncated.length;
            this.markResponseTruncated();
            log.warn(
              `[${this.name}] Truncation recovery DROPPED ~${droppedChars} chars of content ` +
                `(cut an incomplete property). Output is incomplete — likely missing trailing ` +
                `scenes/beats. Consider raising maxTokens. See landmine L4.`,
            );
            return truncated;
          }
        }
      }
    }

    // Fallback: the response was cut mid-string VALUE (not right after a
    // `"prop":`) and no clean property/array cut point was found — e.g. a giant
    // structure analysis truncated inside a "themes" array element at the
    // max_tokens cap. The dangling open quote makes the whole parse fail
    // ("Unterminated string …"). Close the string (dropping a trailing partial
    // escape) so repairJSON's balanceBrackets can then close the open
    // objects/arrays. Result: valid JSON with only the final value truncated —
    // far better than discarding the entire response.
    if (quoteCount % 2 === 1) {
      this.markResponseTruncated();
      const safe = json.replace(/\\+$/, (m) => (m.length % 2 ? m.slice(1) : m));
      return `${safe}"`;
    }

    return json;
  }

  private findPropertyNameBeforeDanglingValue(text: string): string | null {
    let i = text.length - 1;
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
    if (text[i] !== ':') return null;
    i -= 1;
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
    if (text[i] !== '"') return null;

    const end = i;
    i -= 1;
    while (i >= 0) {
      if (text[i] === '"' && (i === 0 || text[i - 1] !== '\\')) {
        return text.slice(i + 1, end);
      }
      i -= 1;
    }
    return null;
  }

  /**
   * Balance brackets and braces in malformed JSON
   * Handles cases where LLM forgets closing } or ]
   */
  private balanceBrackets(json: string): string {
    const stack: string[] = [];
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < json.length; i++) {
      const char = json[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '{') {
          stack.pop();
        }
      } else if (char === ']') {
        // Check if we're about to close an array but the last open was an object
        // This is the missing } before ] case
        if (stack.length > 0 && stack[stack.length - 1] === '{') {
          // Find where to insert the missing }
          // Look backwards from current position to find the right spot
          const insertPos = this.findMissingBracePosition(json, i);
          if (insertPos !== -1) {
            json = json.slice(0, insertPos) + '}' + json.slice(insertPos);
            // Adjust index since we inserted a character
            i++;
            stack.pop(); // Pop the { we just closed
          }
        }
        if (stack.length > 0 && stack[stack.length - 1] === '[') {
          stack.pop();
        }
      }
    }

    // Add any missing closing brackets/braces at the end
    let suffix = '';
    while (stack.length > 0) {
      const open = stack.pop();
      suffix += open === '{' ? '}' : ']';
    }

    return json + suffix;
  }

  /**
   * Find the position where a missing } should be inserted before a ]
   */
  private findMissingBracePosition(json: string, closeBracketPos: number): number {
    // Look backwards to find the last complete value before the ]
    // Usually the missing } goes right before the ]
    let pos = closeBracketPos - 1;

    // Skip whitespace
    while (pos >= 0 && /\s/.test(json[pos])) {
      pos--;
    }

    // If we're at a quote (end of string value) or a number/boolean/null,
    // the } should go right after it (before the ])
    if (pos >= 0) {
      return closeBracketPos;
    }

    return -1;
  }

  /**
   * Execute the agent's primary function
   */
  abstract execute(input: unknown): Promise<AgentResponse<unknown>>;

  /**
   * Get agent name for logging
   */
  getName(): string {
    return this.name;
  }
}
