/**
 * BaseAgent - Abstract base class for all AI agents
 * Provides common functionality for LLM interaction and output parsing.
 */

import { AgentConfig } from '../config';
import { CORE_STORYTELLING_PROMPT } from '../prompts/storytellingPrinciples';
import { isWebRuntime } from '../../utils/runtimeEnv';
import { AsyncSemaphore } from '../utils/concurrency';
import { getMemoryStore, type MemoryCommand } from '../utils/memoryStore';

// Use proxy server for web to avoid CORS issues
const ANTHROPIC_API_URL = isWebRuntime()
  ? 'http://localhost:3001/v1/messages'  // Local proxy
  : 'https://api.anthropic.com/v1/messages';  // Direct API for native
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | { type: 'image_url'; image_url: { url: string } }>;
}

export interface AgentResponse<T> {
  success: boolean;
  data?: T;
  rawResponse?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  metadata?: Record<string, unknown>;
}

export class LLMQuotaError extends Error {
  public readonly provider: 'gemini' | 'anthropic' | 'openai' | 'unknown';

  constructor(message: string, provider: 'gemini' | 'anthropic' | 'openai' | 'unknown' = 'unknown') {
    super(message);
    this.name = 'LLMQuotaError';
    this.provider = provider;
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

export interface LlmGuardrailConfig {
  maxGlobalInFlight: number;
  maxPerProviderInFlight: number;
  backoffJitterRatio: number;
}

export interface LlmCallObservation {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini';
  success: boolean;
  durationMs: number;
  queueWaitMs: number;
  attempt: number;
  error?: string;
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

  // Shared circuit breaker — prevents retry storms when the proxy/Anthropic is down.
  // After CIRCUIT_BREAKER_THRESHOLD consecutive failures across ALL agents, all LLM
  // calls pause for CIRCUIT_BREAKER_COOLDOWN_MS before the next attempt.
  private static _cbConsecutiveFailures = 0;
  private static _cbCooldownUntil = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private static readonly CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
  private static _globalSemaphore: AsyncSemaphore | null = null;
  private static _providerSemaphores = new Map<'anthropic' | 'openai' | 'gemini', AsyncSemaphore>();
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
  }

  static setLlmCallObserver(observer?: (observation: LlmCallObservation) => void): void {
    BaseAgent._observer = observer;
  }

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
  protected async callLLM(messages: AgentMessage[], retries: number = 2, options?: { useMemory?: boolean; signal?: AbortSignal }): Promise<string> {
    const existingSystemMessage = messages.find((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    // Use existing system message if provided, otherwise auto-inject if opted in
    let systemMessage = existingSystemMessage;
    if (!systemMessage && this.includeSystemPrompt && this.systemPrompt) {
      systemMessage = { role: 'system', content: this.systemPrompt };
    }

    const fullMessages: AgentMessage[] = [
      ...(systemMessage ? [systemMessage] : []),
      ...otherMessages,
    ];

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
      try {
        let result: string;
        const signal = options?.signal;
        if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        if (this.config.provider === 'anthropic' && options?.useMemory) {
          result = await this.callAnthropicWithMemory(fullMessages);
        } else if (this.config.provider === 'anthropic') {
          result = await this.callAnthropic(fullMessages, signal);
        } else if (this.config.provider === 'gemini') {
          result = await this.callGemini(fullMessages, signal);
        } else {
          result = await this.callOpenAI(fullMessages, signal);
        }
        // Success — reset circuit breaker
        if (BaseAgent._cbConsecutiveFailures > 0) {
          console.log(`[${this.name}] LLM call succeeded — circuit breaker reset (was at ${BaseAgent._cbConsecutiveFailures} failures)`);
        }
        BaseAgent._cbConsecutiveFailures = 0;
        BaseAgent._observer?.({
          agentName: this.name,
          provider: this.config.provider,
          success: true,
          durationMs: Date.now() - callStart,
          queueWaitMs,
          attempt,
        });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const msg = lastError.message.toLowerCase();
        const stack = lastError.stack || '';
        const isQuotaError = this.config.provider === 'gemini' && BaseAgent.isQuotaMessage(msg);
        
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

        // Track consecutive failures for circuit breaker
        const isConnectionFailure = msg.includes('fetch failed') || msg.includes('500') ||
          msg.includes('502') || msg.includes('503') || msg.includes('unreachable');
        if (isConnectionFailure) {
          BaseAgent._cbConsecutiveFailures++;
          if (BaseAgent._cbConsecutiveFailures >= BaseAgent.CIRCUIT_BREAKER_THRESHOLD) {
            BaseAgent._cbCooldownUntil = Date.now() + BaseAgent.CIRCUIT_BREAKER_COOLDOWN_MS;
            console.warn(`[${this.name}] Circuit breaker TRIPPED after ${BaseAgent._cbConsecutiveFailures} failures — all LLM calls paused for ${BaseAgent.CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`);
          }
        }
        
        const isAbortError = lastError.name === 'AbortError' || msg.includes('aborted');
        // Only retry on transient/network errors, not on auth, validation, or abort errors
        const isRetryable = !isQuotaError && !isAbortError && (
          msg.includes('fetch failed') ||
          msg.includes('network') ||
          msg.includes('timeout') ||
          msg.includes('econnreset') ||
          msg.includes('econnrefused') ||
          msg.includes('socket hang up') ||
          msg.includes('529') || // Anthropic overloaded
          msg.includes('500') || // Internal server error
          msg.includes('502') || // Bad gateway
          msg.includes('503') || // Service unavailable
          msg.includes('rate limit') ||
          msg.includes('overloaded')
        );
        
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
        
        // Normal exponential backoff — longer ceiling for 5xx/connection errors
        const is5xx = msg.includes('500') || msg.includes('503') || msg.includes('502') || msg.includes('fetch failed');
        const maxDelay = is5xx ? 30000 : 10000;
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

  private async callAnthropic(messages: AgentMessage[], signal?: AbortSignal): Promise<string> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    const totalInputChars = (typeof systemMessage?.content === 'string' ? systemMessage.content.length : 0)
      + otherMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
    console.log(`[${this.name}] Calling Anthropic API via ${isWebRuntime() ? 'proxy' : 'direct'}... (input ~${Math.round(totalInputChars / 4)} tokens, maxTokens: ${this.config.maxTokens})`);

    const body: any = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: typeof systemMessage?.content === 'string' 
        ? systemMessage.content 
        : (Array.isArray(systemMessage?.content) 
            ? (systemMessage?.content[0] as any)?.text || '' 
            : ''),
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
      throw new Error(errorMessage);
    }

    try {
      const data = JSON.parse(text);
      const outputText = data.content[0].text;
      const stopReason = data.stop_reason;
      const outputTokens = data.usage?.output_tokens ?? '?';
      const inputTokens = data.usage?.input_tokens ?? '?';
      console.log(`[${this.name}] Anthropic response: ${inputTokens} input tokens, ${outputTokens} output tokens, stop_reason: ${stopReason}`);
      if (stopReason === 'max_tokens') {
        console.warn(`[${this.name}] ⚠️ RESPONSE TRUNCATED — stop_reason is max_tokens (limit: ${this.config.maxTokens}). Response will be incomplete JSON.`);
      }
      return outputText;
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse Anthropic response as JSON: ${msg}. Response start: ${text.substring(0, 500)}`);
    }
  }

  private async callAnthropicWithMemory(messages: AgentMessage[]): Promise<string> {
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
    console.log(`[${this.name}] Calling Anthropic API with memory via ${isWebRuntime() ? 'proxy' : 'direct'}... (input ~${Math.round(totalInputChars / 4)} tokens)`);

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
        system: systemText,
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
        throw new Error(errorMessage);
      }

      const data = JSON.parse(text);
      const stopReason = data.stop_reason;
      const outputTokens = data.usage?.output_tokens ?? '?';
      const inputTokens = data.usage?.input_tokens ?? '?';
      console.log(`[${this.name}] Memory round ${round + 1}: ${inputTokens} in, ${outputTokens} out, stop: ${stopReason}`);

      if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
        const textBlock = data.content?.find((b: any) => b.type === 'text');

        // Even on end_turn there may be trailing memory writes — execute them
        const toolBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use' && b.name === 'memory');
        for (const tb of toolBlocks) {
          try {
            await memoryStore.execute(tb.input as MemoryCommand);
            console.log(`[${this.name}] Memory write (final): ${tb.input.command} ${tb.input.path || tb.input.old_path || ''}`);
          } catch (err) {
            console.warn(`[${this.name}] Memory write failed (final):`, err);
          }
        }

        if (stopReason === 'max_tokens') {
          console.warn(`[${this.name}] ⚠️ RESPONSE TRUNCATED with memory enabled`);
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
          console.log(`[${this.name}] Memory: ${tb.input.command} ${tb.input.path || tb.input.old_path || ''}`);
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

  private async callOpenAI(messages: AgentMessage[], signal?: AbortSignal): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
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
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} - ${text}`);
    }

    try {
      const data = JSON.parse(text);
      return data.choices[0].message.content;
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse OpenAI response as JSON: ${msg}. Response start: ${text.substring(0, 500)}`);
    }
  }

  private async callGemini(messages: AgentMessage[], signal?: AbortSignal): Promise<string> {
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
        maxOutputTokens: this.config.maxTokens,
      },
    };

    if (systemMessage) {
      body.systemInstruction = {
        parts: toParts(systemMessage.content),
      };
    }

    const response = await fetch(
      `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      }
    );

    const text = await response.text();
    if (!response.ok) {
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

    try {
      const data = JSON.parse(text);
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const output = parts
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .join('');
      if (!output) {
        throw new Error('Gemini returned empty content');
      }
      return output;
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse Gemini response as JSON: ${msg}. Response start: ${text.substring(0, 500)}`);
    }
  }

  /**
   * Parse JSON response from LLM, handling common issues
   */
  protected parseJSON<T>(response: string): T {
    // Strip markdown code blocks with regex for more robust handling
    let cleaned = this.stripMarkdownCodeBlocks(response);

    // First attempt: try parsing as-is
    try {
      return JSON.parse(cleaned) as T;
    } catch (firstError) {
      console.log(`[${this.name}] Initial JSON parse failed, attempting repair...`);

      // Second attempt: try repairing common JSON errors
      try {
        const repaired = this.repairJSON(cleaned);
        const result = JSON.parse(repaired) as T;
        console.log(`[${this.name}] JSON repair successful`);
        return result;
      } catch (repairError) {
        // Both attempts failed - throw original error with context
        throw new Error(`Failed to parse JSON response: ${firstError}\nResponse: ${response.slice(0, 500)}...`);
      }
    }
  }

  /**
   * Robustly strip markdown code blocks from LLM response
   */
  private stripMarkdownCodeBlocks(response: string): string {
    let cleaned = response.trim();
    
    // Pattern 0: LLM outputs prose BEFORE a code block (e.g. "Looking at the character...\n```json\n{...}\n```")
    // This is common — extract the JSON from inside the code block regardless of preamble text
    const embeddedCodeBlock = cleaned.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```/);
    if (embeddedCodeBlock) {
      const extracted = embeddedCodeBlock[1].trim();
      // Verify it looks like JSON before using it
      if (extracted.startsWith('{') || extracted.startsWith('[')) {
        return extracted;
      }
    }
    
    // Pattern 1: ```json\n...\n``` or ```\n...\n``` (entire response is a code block)
    // Use regex to handle whitespace variations
    const codeBlockMatch = cleaned.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    
    // Pattern 2: Just strip leading ```json or ``` and trailing ```
    // Handle cases where there's content after closing ```
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```JSON')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    
    // Remove trailing ``` with possible whitespace
    const trailingMatch = cleaned.match(/([\s\S]*?)\s*```\s*$/);
    if (trailingMatch) {
      cleaned = trailingMatch[1];
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
        console.log(`[BaseAgent] Response looks like JSON missing opening brace — prepending {`);
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
            console.log(`[BaseAgent] Stripped ${preamble.length} chars of preamble text before JSON`);
            cleaned = cleaned.substring(jsonStart);
          }
        }
      }
    }
    
    return cleaned.trim();
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
        console.log(`[BaseAgent] Fixing missing opening brace (case A)`);
        repaired = '{' + repaired;
      }
      // Case B: Starts with a quoted value followed by comma and property name
      // e.g., "episode-1","title":"..." -> {"episodeId":"episode-1","title":"..."
      // This happens when LLM outputs a value instead of key:value
      else if (/^"[^"]+"\s*,\s*"[^"]+"\s*:/.test(repaired)) {
        console.log(`[BaseAgent] Fixing orphan value at start (case B) - prepending episodeId key`);
        repaired = '{"episodeId":' + repaired;
      }
      // Case C: Starts with a bare number followed by comma and property name
      // e.g., 1,"title":"The Client"... -> {"episodeNumber":1,"title":"The Client"...
      else if (/^\d+\s*,\s*"[^"]+"\s*:/.test(repaired)) {
        console.log(`[BaseAgent] Fixing missing opening brace and key (case C)`);
        repaired = '{"episodeNumber":' + repaired;
      }
      // Case D: Starts with a bare number followed by colon (numeric key without brace)
      // e.g., 1: "value" -> {1: "value"} - rare but possible
      else if (/^\d+\s*:/.test(repaired)) {
        console.log(`[BaseAgent] Fixing missing opening brace (case D) - numeric key`);
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
        console.log(`[BaseAgent] Fixing orphan value after opening brace - inserting "episodeId" key`);
        repaired = repaired.replace(/^\{\s*"/, '{"episodeId":"');
      }
    }

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
   * Handle truncated JSON responses (when max_tokens is reached)
   * Finds the last complete element and truncates there
   */
  private handleTruncation(json: string): string {
    // Check if the JSON appears truncated (ends mid-string or mid-value)
    const trimmed = json.trim();
    
    // If it ends with a complete structure, no truncation handling needed
    if (trimmed.endsWith('}') || trimmed.endsWith(']') || trimmed.endsWith('"') || 
        trimmed.endsWith('true') || trimmed.endsWith('false') || trimmed.endsWith('null') ||
        /\d$/.test(trimmed)) {
      return json;
    }

    console.log(`[BaseAgent] Detected truncated response, attempting recovery...`);

    // Find the last complete array element (for shots arrays)
    // Look for the pattern: }, { or }, ] which indicates a complete object in an array
    const lastCompleteObjectMatch = json.match(/.*\}(\s*,\s*\{|\s*\])/s);
    if (lastCompleteObjectMatch) {
      // Find the position of the last complete object
      const lastCompletePos = json.lastIndexOf('},');
      if (lastCompletePos > 0) {
        // Truncate after the last complete object
        const truncated = json.slice(0, lastCompletePos + 1);
        console.log(`[BaseAgent] Truncated to last complete object at position ${lastCompletePos}`);
        return truncated;
      }
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
      const lastPropMatch = beforeLastQuote.match(/.*"([^"]+)"\s*:\s*$/s);
      
      if (lastPropMatch) {
        // Truncate before this property and close the structure
        const propStart = beforeLastQuote.lastIndexOf('"' + lastPropMatch[1] + '"');
        if (propStart > 0) {
          // Go back to find the comma or opening brace
          let truncateAt = propStart;
          while (truncateAt > 0 && json[truncateAt - 1] !== ',' && json[truncateAt - 1] !== '{') {
            truncateAt--;
          }
          if (truncateAt > 0) {
            const truncated = json.slice(0, truncateAt).replace(/,\s*$/, '');
            console.log(`[BaseAgent] Truncated before incomplete property at position ${truncateAt}`);
            return truncated;
          }
        }
      }
    }

    return json;
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
