import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readSSEStream,
  anthropicSseHandler,
  openaiSseHandler,
  geminiSseHandler,
  shouldStreamLLM,
  setLLMStreamingEnabled,
  isLLMStreamingEnabled,
} from './streamLLM';

/**
 * Build a WHATWG ReadableStream<Uint8Array> that emits the given string chunks
 * (each already encoded as UTF-8 bytes) in order, then closes.
 */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/**
 * A stream that emits one initial chunk (optional) and then STALLS forever —
 * never enqueues again and never closes — to exercise the idle timeout.
 */
function stallingStream(initial?: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let emitted = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (initial && !emitted) {
        emitted = true;
        controller.enqueue(encoder.encode(initial));
        return;
      }
      // Return a never-resolving promise so the reader hangs.
      return new Promise<void>(() => {});
    },
  });
}

afterEach(() => {
  setLLMStreamingEnabled(true);
  vi.restoreAllMocks();
});

describe('shouldStreamLLM guard', () => {
  it('streams in node (non-web) when enabled, never in web', () => {
    setLLMStreamingEnabled(true);
    expect(shouldStreamLLM(false)).toBe(true); // node/direct
    expect(shouldStreamLLM(true)).toBe(false); // web => proxy buffers
  });

  it('disables streaming entirely via the escape hatch', () => {
    setLLMStreamingEnabled(false);
    expect(isLLMStreamingEnabled()).toBe(false);
    expect(shouldStreamLLM(false)).toBe(false);
    setLLMStreamingEnabled(true);
    expect(isLLMStreamingEnabled()).toBe(true);
  });
});

describe('readSSEStream chunk reassembly (Anthropic)', () => {
  it('reassembles text deltas across SSE frames split mid-frame', async () => {
    // Two content_block_delta events, but the byte boundaries cut a frame in half.
    const e1 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello, "}}\n\n';
    const e2 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world!"}}\n\n';
    // Split the concatenated payload into awkward byte chunks.
    const full = e1 + e2;
    const mid = Math.floor(full.length / 2) + 7;
    const chunks = [full.slice(0, mid), full.slice(mid)];

    const result = await readSSEStream(streamFromChunks(chunks), anthropicSseHandler);
    expect(result.text).toBe('Hello, world!');
  });

  it('ignores [DONE] sentinels and captures usage + cache from message_start/message_delta', async () => {
    const chunks = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":120,"cache_read_input_tokens":80,"cache_creation_input_tokens":10}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"ok\\":true}"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":42}}\n\n',
      'data: [DONE]\n\n',
    ];
    const result = await readSSEStream(streamFromChunks(chunks), anthropicSseHandler);
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 42 });
    expect(result.cacheRead).toBe(80);
    expect(result.cacheCreate).toBe(10);
  });
});

describe('readSSEStream OpenAI handler', () => {
  it('accumulates choices[0].delta.content and reads usage from final chunk', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"part-A "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"part-B"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":11,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ];
    const result = await readSSEStream(streamFromChunks(chunks), openaiSseHandler);
    expect(result.text).toBe('part-A part-B');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 5 });
  });
});

describe('readSSEStream Gemini handler', () => {
  it('accumulates candidate parts text and reads usageMetadata', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"foo"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"bar"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3}}\n\n',
    ];
    const result = await readSSEStream(streamFromChunks(chunks), geminiSseHandler);
    expect(result.text).toBe('foobar');
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('captures finishReason/blockReason so an empty SAFETY block is diagnosable (bite-me-g18)', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"parts":[]},"finishReason":"SAFETY"}],"promptFeedback":{"blockReason":"SAFETY"}}\n\n',
    ];
    const result = await readSSEStream(streamFromChunks(chunks), geminiSseHandler);
    expect(result.text).toBe('');
    expect(result.finishReason).toBe('SAFETY');
    expect(result.blockReason).toBe('SAFETY');
  });
});

describe('readSSEStream idle timeout', () => {
  it('aborts and throws a retryable error when no bytes arrive within the window', async () => {
    const onIdleAbort = vi.fn();
    const stream = stallingStream(); // never emits, never closes
    await expect(
      readSSEStream(stream, anthropicSseHandler, { idleMs: 30, onIdleAbort }),
    ).rejects.toThrow(/stream idle timeout/i);
    expect(onIdleAbort).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when an initial byte arrives, then stalls after the window re-arm', async () => {
    // Emits one valid frame quickly, then stalls. The idle timer re-arms after
    // the first byte, so it must still eventually fire on the subsequent stall.
    const initial =
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"seed"}}\n\n';
    const stream = stallingStream(initial);
    await expect(
      readSSEStream(stream, anthropicSseHandler, { idleMs: 40 }),
    ).rejects.toThrow(/stream idle timeout/i);
  });
});

describe('readSSEStream overall signal backstop', () => {
  it('throws when the per-call abort signal fires mid-stream', async () => {
    const controller = new AbortController();
    const stream = stallingStream(); // never emits
    const promise = readSSEStream(stream, anthropicSseHandler, {
      idleMs: 10_000, // long enough that the signal wins
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toThrow(/aborted/i);
  });

  it('throws immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readSSEStream(streamFromChunks(['data: [DONE]\n\n']), anthropicSseHandler, {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/i);
  });
});

describe('readSSEStream trailing frame flush', () => {
  it('parses a final frame that lacks a terminating blank line', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"only"}}]}', // no trailing \n\n
    ];
    const result = await readSSEStream(streamFromChunks(chunks), openaiSseHandler);
    expect(result.text).toBe('only');
  });
});
