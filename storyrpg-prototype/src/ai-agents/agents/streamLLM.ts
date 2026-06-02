/**
 * streamLLM — shared SSE streaming reader for BaseAgent's provider transports.
 *
 * LEVER A (default-on streaming): instead of buffering a provider response with
 * `await response.text()` and then `JSON.parse`, the node/direct worker path
 * consumes the response as a Server-Sent Events stream, accumulates the text
 * deltas, and returns the SAME final concatenated string that the buffered path
 * produced. Only HOW the bytes are read changes — the model output and the
 * downstream parseJSON are unchanged.
 *
 * Two motivations:
 *  1. An IDLE TIMEOUT: if the stream stalls (no bytes for STREAM_IDLE_MS) we
 *     abort and throw a retryable error, instead of hanging until the much
 *     larger overall per-call timeout. The overall timeout/signal passed in is
 *     still honored as the backstop.
 *  2. First-byte / total-ms instrumentation so we can later distinguish a slow
 *     model from a stalled connection.
 *
 * STREAMING GUARD: streaming is ONLY safe on the node/direct path. In WEB
 * runtime the call goes through the Express proxy, which BUFFERS upstream and
 * returns plain JSON (not SSE) — so the web/proxy path must keep the buffered
 * `response.text()` path. Callers gate with `shouldStreamLLM()`.
 */

const DEFAULT_STREAM_IDLE_MS = 60_000;

let STREAMING_ENABLED = true;
let STREAM_IDLE_MS = DEFAULT_STREAM_IDLE_MS;

/** Default-on streaming toggle (escape hatch for tests / ops). */
export function setLLMStreamingEnabled(enabled: boolean): void {
  STREAMING_ENABLED = enabled;
}

export function isLLMStreamingEnabled(): boolean {
  return STREAMING_ENABLED;
}

/** Override the idle-timeout window (primarily for tests). */
export function setStreamIdleMs(ms: number): void {
  STREAM_IDLE_MS = Math.max(1, Math.floor(ms));
}

export function getStreamIdleMs(): number {
  return STREAM_IDLE_MS;
}

/**
 * Decide whether to stream this call. Streaming is gated on the module-level
 * toggle AND the runtime NOT being web (web => proxy => buffered JSON).
 */
export function shouldStreamLLM(isWeb: boolean): boolean {
  return STREAMING_ENABLED && !isWeb;
}

export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface StreamResult {
  text: string;
  usage?: StreamUsage;
  cacheRead?: number;
  cacheCreate?: number;
}

/**
 * Provider-specific handler invoked for every parsed SSE `data:` JSON event.
 * It mutates the shared accumulator object:
 *  - append decoded text deltas onto `acc.text`
 *  - record usage / cache numbers when the provider emits them
 */
export interface SseEventHandler {
  (eventJson: any, acc: StreamAccumulator): void;
}

export interface StreamAccumulator {
  text: string;
  usage: StreamUsage;
  cacheRead?: number;
  cacheCreate?: number;
}

/** Minimal shape of the streaming body we consume (undici ReadableStream). */
type ByteSource =
  | { getReader: () => ReadableStreamDefaultReader<Uint8Array> }
  | AsyncIterable<Uint8Array>;

function isReadableStreamLike(
  body: unknown,
): body is { getReader: () => ReadableStreamDefaultReader<Uint8Array> } {
  return !!body && typeof (body as any).getReader === 'function';
}

function isAsyncIterable(body: unknown): body is AsyncIterable<Uint8Array> {
  return !!body && typeof (body as any)[Symbol.asyncIterator] === 'function';
}

/**
 * Read a streaming SSE body to completion, accumulating provider deltas.
 *
 * @param body          response.body — a WHATWG ReadableStream<Uint8Array> (undici)
 *                      or any async-iterable of Uint8Array chunks.
 * @param handleEvent   provider parser invoked per `data: {json}` SSE event.
 * @param opts.signal   overall per-call abort signal (backstop timeout). When it
 *                      aborts we stop reading and throw.
 * @param opts.onAbort  called when WE decide to abort (idle timeout) so the
 *                      caller can abort the underlying fetch's AbortController.
 *
 * On idle-timeout / abort / stream error the partial accumulator is discarded
 * and a (retryable, for idle) Error is thrown — never a half response.
 */
export async function readSSEStream(
  body: ByteSource | null | undefined,
  handleEvent: SseEventHandler,
  opts: { signal?: AbortSignal; onIdleAbort?: () => void; idleMs?: number } = {},
): Promise<StreamResult & { firstByteMs: number; totalMs: number }> {
  if (!body) {
    throw new Error('stream body is missing — cannot read SSE stream');
  }

  const idleMs = opts.idleMs ?? STREAM_IDLE_MS;
  const acc: StreamAccumulator = { text: '', usage: {} };
  const decoder = new TextDecoder();
  let buffer = '';

  const startedAt = Date.now();
  let firstByteAt = 0;

  // Idle-timeout watchdog: re-armed on every chunk. If it fires we trigger the
  // caller's abort hook and reject pending reads.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleFired = false;
  let idleRejecter: ((err: Error) => void) | undefined;

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const armIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleFired = true;
      try {
        opts.onIdleAbort?.();
      } catch {
        /* best-effort */
      }
      idleRejecter?.(
        new Error(`stream idle timeout — no bytes for ${idleMs}ms (retryable)`),
      );
    }, idleMs);
  };

  // Honor the overall/per-call signal as the backstop.
  const onOuterAbort = () => {
    clearIdle();
    idleRejecter?.(
      new Error('stream aborted by signal (operation aborted)'),
    );
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      throw new Error('stream aborted by signal (operation aborted)');
    }
    opts.signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  // Feed a decoded text chunk into the SSE frame parser.
  const ingest = (chunk: string) => {
    buffer += chunk;
    // SSE frames are separated by a blank line (\n\n). Tolerate \r\n\r\n too.
    let sepIndex: number;
    // Normalize CRLF to LF for splitting.
    buffer = buffer.replace(/\r\n/g, '\n');
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      handleFrame(frame);
    }
  };

  const handleFrame = (frame: string) => {
    // A frame may have multiple `data:` lines; concatenate them per SSE spec.
    const dataLines: string[] = [];
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.trimStart();
      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
      // event:/id:/comment lines are ignored — the JSON payload carries type.
    }
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n').trim();
    if (!payload || payload === '[DONE]') return;
    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // A partial/garbage data line — skip it; the full text comes from valid frames.
      return;
    }
    handleEvent(parsed, acc);
  };

  const markByte = () => {
    if (firstByteAt === 0) firstByteAt = Date.now();
    armIdle();
  };

  try {
    if (isReadableStreamLike(body)) {
      const reader = body.getReader();
      armIdle();
      while (true) {
        if (idleFired) throw new Error(`stream idle timeout (retryable)`);
        const read = reader.read();
        const idleWait = new Promise<never>((_, reject) => {
          idleRejecter = reject;
        });
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await Promise.race([read, idleWait]);
        } catch (err) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          throw err;
        }
        idleRejecter = undefined;
        if (chunk.done) break;
        if (chunk.value && chunk.value.length > 0) {
          markByte();
          ingest(decoder.decode(chunk.value, { stream: true }));
        }
      }
    } else if (isAsyncIterable(body)) {
      armIdle();
      const iterator = body[Symbol.asyncIterator]();
      while (true) {
        if (idleFired) throw new Error(`stream idle timeout (retryable)`);
        const next = iterator.next();
        const idleWait = new Promise<never>((_, reject) => {
          idleRejecter = reject;
        });
        let res: IteratorResult<Uint8Array>;
        try {
          res = await Promise.race([next, idleWait]);
        } catch (err) {
          try {
            await iterator.return?.();
          } catch {
            /* ignore */
          }
          throw err;
        }
        idleRejecter = undefined;
        if (res.done) break;
        if (res.value && res.value.length > 0) {
          markByte();
          ingest(decoder.decode(res.value, { stream: true }));
        }
      }
    } else {
      throw new Error('stream body is not a ReadableStream or async iterable');
    }

    // Flush any trailing buffered frame (no terminating blank line).
    if (buffer.trim().length > 0) {
      handleFrame(buffer);
      buffer = '';
    }
  } finally {
    clearIdle();
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onOuterAbort);
    }
  }

  return {
    text: acc.text,
    usage: acc.usage,
    cacheRead: acc.cacheRead,
    cacheCreate: acc.cacheCreate,
    firstByteMs: firstByteAt === 0 ? 0 : firstByteAt - startedAt,
    totalMs: Date.now() - startedAt,
  };
}

/**
 * Anthropic SSE parser. Event types we care about:
 *  - message_start: usage.input_tokens, cache_read_input_tokens, cache_creation_input_tokens
 *  - content_block_delta: delta.text (text deltas)
 *  - message_delta: usage.output_tokens
 */
export const anthropicSseHandler: SseEventHandler = (evt, acc) => {
  const type = evt?.type;
  if (type === 'message_start') {
    const u = evt.message?.usage;
    if (u) {
      if (typeof u.input_tokens === 'number') acc.usage.inputTokens = u.input_tokens;
      if (typeof u.output_tokens === 'number') acc.usage.outputTokens = u.output_tokens;
      if (typeof u.cache_read_input_tokens === 'number') acc.cacheRead = u.cache_read_input_tokens;
      if (typeof u.cache_creation_input_tokens === 'number') acc.cacheCreate = u.cache_creation_input_tokens;
    }
  } else if (type === 'content_block_delta') {
    const delta = evt.delta;
    if (delta && typeof delta.text === 'string') {
      acc.text += delta.text;
    }
  } else if (type === 'message_delta') {
    const u = evt.usage;
    if (u && typeof u.output_tokens === 'number') {
      acc.usage.outputTokens = u.output_tokens;
    }
  }
};

/**
 * OpenAI chat-completions SSE parser. Accumulate choices[0].delta.content; the
 * final chunk (with stream_options.include_usage) carries `usage`.
 */
export const openaiSseHandler: SseEventHandler = (evt, acc) => {
  const delta = evt?.choices?.[0]?.delta;
  if (delta && typeof delta.content === 'string') {
    acc.text += delta.content;
  }
  const u = evt?.usage;
  if (u) {
    if (typeof u.prompt_tokens === 'number') acc.usage.inputTokens = u.prompt_tokens;
    if (typeof u.completion_tokens === 'number') acc.usage.outputTokens = u.completion_tokens;
  }
};

/**
 * Gemini :streamGenerateContent?alt=sse parser. Each event is a partial
 * GenerateContentResponse; accumulate candidates[0].content.parts[].text and
 * capture usageMetadata when present (final chunk).
 */
export const geminiSseHandler: SseEventHandler = (evt, acc) => {
  const parts = evt?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (p && typeof p.text === 'string') acc.text += p.text;
    }
  }
  const meta = evt?.usageMetadata;
  if (meta) {
    if (typeof meta.promptTokenCount === 'number') acc.usage.inputTokens = meta.promptTokenCount;
    if (typeof meta.candidatesTokenCount === 'number') acc.usage.outputTokens = meta.candidatesTokenCount;
  }
};
