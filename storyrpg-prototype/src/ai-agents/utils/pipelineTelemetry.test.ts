import { afterEach, describe, expect, it, vi } from 'vitest';

import { PipelineTelemetry, buildLlmCallObserver } from './pipelineTelemetry';
import { AgentResponse, BaseAgent } from '../agents/BaseAgent';
import { setLLMStreamingEnabled } from '../agents/streamLLM';

/**
 * A minimal anthropic-backed agent that exposes the protected callLLM so a test
 * can drive a single provider call end-to-end.
 */
class TestAgent extends BaseAgent {
  constructor() {
    super('Test Agent', {
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });
  }

  protected getAgentSpecificPrompt(): string {
    return 'Test telemetry usage capture.';
  }

  async run(): Promise<string> {
    return this.callLLM([{ role: 'user', content: 'hi' }], 0);
  }

  async execute(): Promise<AgentResponse<unknown>> {
    return { success: true };
  }
}

/** Build a WHATWG ReadableStream emitting the given UTF-8 string chunks then closing. */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
}

/** A streamed (SSE) anthropic Response whose final event carries output usage. */
function anthropicStreamResponse(): Response {
  const body = streamFromChunks([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":120,"output_tokens":1}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"ok\\":true}"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":42}}\n\n',
    'data: [DONE]\n\n',
  ]);
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  setLLMStreamingEnabled(true);
  BaseAgent.setLlmCallObserver(undefined);
  vi.restoreAllMocks();
});

describe('PipelineTelemetry.getLlmLedger aggregation', () => {
  it('totals tokens and counts usageReported only for calls that reported usage', () => {
    const telemetry = new PipelineTelemetry();
    telemetry.observeProviderCall({
      agentName: 'Scene Writer',
      provider: 'anthropic',
      success: true,
      durationMs: 100,
      queueWaitMs: 0,
      attempt: 0,
      usage: { inputTokens: 120, outputTokens: 42 },
    });
    telemetry.observeProviderCall({
      agentName: 'Scene Writer',
      provider: 'anthropic',
      success: true,
      durationMs: 80,
      queueWaitMs: 0,
      attempt: 0,
      // No usage — e.g. a provider that didn't report it. Must be a gap.
    });

    const ledger = telemetry.getLlmLedger()!;
    expect(ledger.totals.calls).toBe(2);
    expect(ledger.totals.usageReported).toBe(1);
    expect(ledger.totals.totalInputTokens).toBe(120);
    expect(ledger.totals.totalOutputTokens).toBe(42);
  });
});

describe('buildLlmCallObserver wiring', () => {
  it('forwards the usage field into telemetry (regression: usage was dropped)', () => {
    const telemetry = new PipelineTelemetry();
    let accumulated = 0;
    const observer = buildLlmCallObserver(telemetry, (t) => {
      accumulated += t;
    });

    observer({
      agentName: 'Scene Writer',
      provider: 'anthropic',
      success: true,
      durationMs: 50,
      queueWaitMs: 0,
      attempt: 0,
      usage: { inputTokens: 120, outputTokens: 42 },
    });

    const ledger = telemetry.getLlmLedger()!;
    expect(ledger.totals.usageReported).toBe(1);
    expect(ledger.totals.totalInputTokens).toBe(120);
    expect(ledger.totals.totalOutputTokens).toBe(42);
    expect(accumulated).toBe(162);
  });

  it('resolves a telemetry getter per call so it follows run-time reassignment', () => {
    let current = new PipelineTelemetry();
    const observer = buildLlmCallObserver(() => current);
    const obs = {
      agentName: 'A',
      provider: 'anthropic' as const,
      success: true,
      durationMs: 1,
      queueWaitMs: 0,
      attempt: 0,
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    observer(obs);
    // Simulate the pipeline swapping in a fresh telemetry between runs.
    current = new PipelineTelemetry();
    observer(obs);

    // The second call must land in the NEW instance, not the stale one.
    expect(current.getLlmLedger()!.totals.usageReported).toBe(1);
  });
});

describe('SSE stream usage -> ledger (end-to-end)', () => {
  it('a streamed call ending with a usage event yields usageReported > 0', async () => {
    const telemetry = new PipelineTelemetry();
    BaseAgent.setLlmCallObserver(buildLlmCallObserver(telemetry));
    setLLMStreamingEnabled(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => anthropicStreamResponse()),
    );

    const agent = new TestAgent();
    const text = await agent.run();
    expect(text).toBe('{"ok":true}');

    const ledger = telemetry.getLlmLedger()!;
    expect(ledger.totals.calls).toBe(1);
    expect(ledger.totals.usageReported).toBeGreaterThan(0);
    expect(ledger.totals.totalInputTokens).toBe(120);
    expect(ledger.totals.totalOutputTokens).toBe(42);
  });
});

describe('truncation shadow counter (WS5)', () => {
  it('aggregates truncation counts into the per-agent rows and totals', async () => {
    const { PipelineTelemetry } = await import('./pipelineTelemetry');
    const t = new PipelineTelemetry();
    t.observeProviderCall({ agentName: 'Scene Writer', provider: 'anthropic', success: true, durationMs: 10, queueWaitMs: 0, attempt: 1 });
    t.observeProviderCall({ agentName: 'Choice Author', provider: 'anthropic', success: true, durationMs: 10, queueWaitMs: 0, attempt: 1 });
    t.observeTruncation('Scene Writer', 'anthropic');
    t.observeTruncation('Scene Writer', 'anthropic');
    const ledger = t.getLlmLedger();
    expect(ledger?.totals.truncatedResponses).toBe(2);
    expect(ledger?.byAgent.find((r) => r.agentName === 'Scene Writer')?.truncatedResponses).toBe(2);
    expect(ledger?.byAgent.find((r) => r.agentName === 'Choice Author')?.truncatedResponses).toBe(0);
  });
});
