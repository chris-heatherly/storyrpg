import { resolveStructuredCallBudget } from './BaseAgent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentResponse, BaseAgent, TruncatedLLMResponseError, type StructuredJsonSchema, type AgentMessage } from './BaseAgent';
import type { AgentConfig } from '../config';
import { setLLMStreamingEnabled } from './streamLLM';

class TestAgent extends BaseAgent {
  constructor(config?: Partial<AgentConfig>) {
    super('Test Agent', {
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
      ...config,
    });
  }

  protected getAgentSpecificPrompt(): string {
    return 'Test parser behavior.';
  }

  parse<T>(response: string): T {
    return this.parseJSON<T>(response);
  }

  cachedSystem(text: string) {
    return this.buildCachedSystemField(text);
  }

  callStructured(messages: AgentMessage[], schema: StructuredJsonSchema) {
    return this.callLLM(messages, 0, { jsonSchema: schema });
  }

  callStructuredWithRetries(messages: AgentMessage[], schema: StructuredJsonSchema, retries: number) {
    return this.callLLM(messages, retries, { jsonSchema: schema });
  }

  callPlain(messages: AgentMessage[]) {
    return this.callLLM(messages, 0);
  }

  callJson<T>(messages: AgentMessage[]) {
    return this.callLLMForJson<T>(messages);
  }

  async execute(): Promise<AgentResponse<unknown>> {
    return { success: true };
  }
}

describe('BaseAgent JSON repair', () => {
  it('repairs omitted scalar values so agent defaults can handle them', () => {
    const agent = new TestAgent();

    const parsed = agent.parse<{ episodeId: null; title: string }>(
      '{"episodeId":,"title":"Dating After Dusk"}',
    );

    expect(parsed).toEqual({
      episodeId: null,
      title: 'Dating After Dusk',
    });
  });

  it('recovers a complete JSON object followed by trailing non-whitespace content', () => {
    const agent = new TestAgent();
    // The World Builder failure: a complete object, then a stray comment/second value.
    const parsed = agent.parse<{ worldRules: string[] }>(
      '{"worldRules":["Strigoi require an invitation","Strigoi cast no reflection"]}\n\nNote: I have followed the schema exactly.',
    );
    expect(parsed.worldRules).toHaveLength(2);
  });

  it('recovers when the model appends a second JSON object after the first', () => {
    const agent = new TestAgent();
    const parsed = agent.parse<{ a: number; nested: { b: string } }>(
      '{"a":1,"nested":{"b":"brace } inside a string is fine"}} {"ignored":true}',
    );
    expect(parsed).toEqual({ a: 1, nested: { b: 'brace } inside a string is fine' } });
  });

  it('rejects structural repair that synthesizes missing closing delimiters', () => {
    const agent = new TestAgent();
    // The visible scalar is complete, but closing the object would assert that
    // no additional authored fields were intended after the cut.
    expect(() => agent.parse<{ title: string }>('{"title":"The Locked Wing"'))
      .toThrow(TruncatedLLMResponseError);
  });

  it('rejects huge dangling JSON values without greedy regex repair', () => {
    const agent = new TestAgent();
    const hugeDanglingValue = `{"items":[{"a":1},{"a":2}],"dangling":"${'x'.repeat(25000)}`;

    expect(() => agent.parse(hugeDanglingValue)).toThrow(TruncatedLLMResponseError);
  });
});

describe('BaseAgent.classifyLlmError (retry classification)', () => {
  it('treats undici "terminated" as a retryable connection failure (large-prompt socket drop)', () => {
    const c = BaseAgent.classifyLlmError({ message: 'terminated', errorName: 'TypeError' });
    expect(c.isRetryable).toBe(true);
    expect(c.isConnectionFailure).toBe(true);
    expect(c.isAbortError).toBe(false);
  });

  it('does NOT retry "terminated" when the scoped abort signal fired (intentional timeout)', () => {
    const c = BaseAgent.classifyLlmError({ message: 'terminated', errorName: 'TypeError', signalAborted: true });
    expect(c.isAbortError).toBe(true);
    expect(c.isRetryable).toBe(false);
  });

  it('does NOT retry a genuine AbortError or quota error', () => {
    expect(BaseAgent.classifyLlmError({ message: 'The operation was aborted', errorName: 'AbortError' }).isRetryable).toBe(false);
    expect(BaseAgent.classifyLlmError({ message: 'terminated', isQuotaError: true }).isRetryable).toBe(false);
  });

  it('retries other known transient errors and never retries auth/validation', () => {
    expect(BaseAgent.classifyLlmError({ message: 'ECONNRESET' }).isRetryable).toBe(true);
    expect(BaseAgent.classifyLlmError({ message: 'overloaded_error (529)' }).isRetryable).toBe(true);
    expect(BaseAgent.classifyLlmError({ message: 'invalid x-api-key' }).isRetryable).toBe(false);
  });
});

describe('BaseAgent prompt caching (C1)', () => {
  it('wraps a non-empty system prompt in a cache_control:ephemeral block', () => {
    const agent = new TestAgent();
    const field = agent.cachedSystem('You are a storyteller. '.repeat(50));
    expect(Array.isArray(field)).toBe(true);
    expect(field).toHaveLength(1);
    expect(field![0].type).toBe('text');
    expect(field![0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('returns undefined when there is no system prompt (utility agents)', () => {
    expect(new TestAgent().cachedSystem('')).toBeUndefined();
  });
});

describe('BaseAgent truncation-loss signal (L4)', () => {
  afterEach(() => {
    delete process.env.STORYRPG_ALLOW_LOSSY_JSON_TRUNCATION;
  });

  it('rejects lossy truncation recovery by default', () => {
    const agent = new TestAgent();

    // Truncated array of objects (ends mid-string, no closing brackets) — the
    // recovery used to cut back to the last complete object, silently dropping the rest.
    expect(() => agent.parse<{ shots: Array<Record<string, unknown>> }>(
      '{"shots":[{"a":1},{"b":2},{"c":"hello',
    )).toThrow(TruncatedLLMResponseError);

    expect(agent.wasLastResponseTruncated()).toBe(true);
  });

  it('does not flag truncation for a complete response', () => {
    const agent = new TestAgent();

    agent.parse<{ ok: boolean }>('{"ok":true}');

    expect(agent.wasLastResponseTruncated()).toBe(false);
  });

  it('rejects a response cut mid-string VALUE inside a nested array', () => {
    const agent = new TestAgent();

    expect(() => agent.parse<{ genre: string; themes: string[] }>(
      '{"genre":"Epic romantasy","themes":["Is a life measured by how long it lasts, or by what',
    )).toThrow(TruncatedLLMResponseError);

    expect(agent.wasLastResponseTruncated()).toBe(true);
  });

  it('rejects an array-element string cut with a dangling escape', () => {
    const agent = new TestAgent();
    // Cut inside an ARRAY element string (preceded by `[`, not `"prop":`), ending
    // on a lone backslash — exercises the close-the-string fallback + escape trim.
    expect(() => agent.parse<{ a: string; themes: string[] }>(
      '{"a":"ok","themes":["a complete one","a partial one ending in a dangling escape\\',
    )).toThrow(TruncatedLLMResponseError);
  });

  it('never uses a literal "}," INSIDE a prose string as the truncation cut point', () => {
    const agent = new TestAgent();
    // The prose contains `},` inside a string value; the old raw
    // lastIndexOf('},') scan would cut mid-string and produce garbage. The
    // string-aware scan must cut at the last STRUCTURAL object boundary
    // (after {"a":1}) — recovering a valid document that keeps element one.
    process.env.STORYRPG_ALLOW_LOSSY_JSON_TRUNCATION = '1';
    const result = agent.parse<{ shots: Array<Record<string, unknown>> }>(
      '{"shots":[{"a":1},{"quote":"she typed \\"}, \\" and hit send"},{"c":"cut mid-str',
    );
    // Structural cut after the SECOND complete object (the one containing the
    // decoy "},"), not inside its string.
    expect(result.shots.length).toBe(2);
    expect(result.shots[0]).toEqual({ a: 1 });
    expect(String((result.shots[1] as { quote?: string }).quote)).toContain('hit send');
  });

  it('treats a string ending in an ESCAPED backslash before the quote as closed', () => {
    const agent = new TestAgent();
    // `"path ends in backslash\\"` — the closing quote follows an escaped
    // backslash (even run), so it IS a real delimiter. The old single-char
    // escape check miscounted parity here and misrouted recovery.
    const result = agent.parse<{ path: string; ok: boolean }>(
      '{"path":"C:\\\\storyrpg\\\\","ok":true}',
    );
    expect(result.ok).toBe(true);
    expect(result.path.endsWith('\\')).toBe(true);
  });

  it('rejects a SceneWriter response cut right after `"text":"` (dangling open quote)', () => {
    const agent = new TestAgent();
    // bite-me-g14 s1-6: the response was truncated mid-string so the last
    // non-whitespace char is a `"` (the just-opened value quote).
    expect(() => agent.parse<{ sceneId: string; beats: Array<{ id: string; text: string }> }>(
      '{"sceneId":"s1-6","name":"release scene 6","beats":[{"id":"b1","text":"She opened the door."},{"id":"b2","text":"',
    )).toThrow(TruncatedLLMResponseError);
    expect(agent.wasLastResponseTruncated()).toBe(true);
  });

  it('rejects when the cut lands on a bare opening value quote with no prior beats', () => {
    const agent = new TestAgent();
    expect(() => agent.parse<{ sceneId: string; beats: unknown[] }>(
      '{"sceneId":"s1-6","name":"n","beats":[{"id":"b1","text":"',
    )).toThrow(TruncatedLLMResponseError);
  });

  it('can temporarily allow lossy truncation recovery behind the explicit escape hatch', () => {
    process.env.STORYRPG_ALLOW_LOSSY_JSON_TRUNCATION = '1';
    const agent = new TestAgent();

    const parsed = agent.parse<{ shots: Array<Record<string, unknown>> }>(
      '{"shots":[{"a":1},{"b":2},{"c":"hello',
    );

    expect(parsed.shots).toEqual([{ a: 1 }, { b: 2 }]);
    expect(agent.wasLastResponseTruncated()).toBe(true);
  });
});

describe('BaseAgent truncation shadow counter (WS5)', () => {
  it('fires the static truncation observer when recovery drops content', () => {
    const events: Array<{ agentName: string; provider: string }> = [];
    BaseAgent.setTruncationObserver((e) => events.push(e));
    try {
      const agent = new TestAgent();
      // An array cut mid-object: recovery drops the trailing partial element.
      expect(() => agent.parse<{ scenes: Array<{ id: string }> }>(
        '{"scenes":[{"id":"s1"},{"id":"s2"},{"id":"s3","te',
      )).toThrow(TruncatedLLMResponseError);
      expect(agent.wasLastResponseTruncated()).toBe(true);
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]).toEqual({ agentName: 'Test Agent', provider: 'anthropic' });
    } finally {
      BaseAgent.setTruncationObserver(undefined);
    }
  });

  it('does not fire the observer on a clean parse', () => {
    const events: unknown[] = [];
    BaseAgent.setTruncationObserver((e) => events.push(e));
    try {
      const agent = new TestAgent();
      agent.parse('{"ok":true}');
      expect(agent.wasLastResponseTruncated()).toBe(false);
      expect(events).toEqual([]);
    } finally {
      BaseAgent.setTruncationObserver(undefined);
    }
  });

  it('a throwing observer never breaks the parse', () => {
    BaseAgent.setTruncationObserver(() => {
      throw new Error('observer bug');
    });
    try {
      const agent = new TestAgent();
      expect(() => agent.parse<{ scenes: Array<{ id: string }> }>(
        '{"scenes":[{"id":"s1"},{"id":"s2","te',
      )).toThrow(TruncatedLLMResponseError);
      expect(agent.wasLastResponseTruncated()).toBe(true);
    } finally {
      BaseAgent.setTruncationObserver(undefined);
    }
  });
});

describe('BaseAgent structured JSON output (opt-in jsonSchema)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    BaseAgent.setLlmTransportOverride(null);
  });

  const schema: StructuredJsonSchema = {
    name: 'demo',
    description: 'demo schema',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  };

  it('prepends a deterministic schema-shape contract for every structured call', async () => {
    let captured: any = null;
    BaseAgent.setLlmTransportOverride(async (request) => {
      captured = request;
      return '{"ok":true}';
    });

    await new TestAgent().callStructured([{ role: 'user', content: 'go' }], schema);

    const system = captured.messages.find((message: AgentMessage) => message.role === 'system');
    expect(system?.content).toContain('deterministic JSON schema "demo"');
    expect(system?.content).toContain('Do not add fields that are not named in the schema');
  });

  it('Anthropic: forces tool use (non-streaming) and returns the tool_use input as JSON', async () => {
    let captured: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          content: [{ type: 'tool_use', name: 'demo', input: { ok: true, note: 'hi' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      } as any;
    }));

    const out = await new TestAgent().callStructured([{ role: 'user', content: 'go' }], schema);

    expect(captured.tools).toHaveLength(1);
    expect(captured.tools[0]).toMatchObject({ name: 'demo', input_schema: schema.schema });
    expect(captured.tool_choice).toEqual({ type: 'tool', name: 'demo' });
    expect(captured.stream).toBeUndefined(); // structured calls do not stream
    expect(JSON.parse(out)).toEqual({ ok: true, note: 'hi' });
  });

  it('Anthropic: falls back to text when the response carries no tool_use block', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as any)));

    const out = await new TestAgent().callStructured([{ role: 'user', content: 'go' }], schema);
    expect(JSON.parse(out)).toEqual({ ok: true });
  });

  it('does not retry MAX_TOKENS truncation with the same structured request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{
          finishReason: 'MAX_TOKENS',
          content: { parts: [{ text: '{"ok":' }] },
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 8192,
          thoughtsTokenCount: 64,
        },
      }),
    } as any));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new TestAgent({ provider: 'gemini', model: 'gemini-2.5-pro' })
        .callStructuredWithRetries([{ role: 'user', content: 'go' }], schema, 3),
    ).rejects.toThrow(TruncatedLLMResponseError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('OpenAI: sets response_format json_schema (non-streaming)', async () => {
    let captured: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }),
      } as any;
    }));

    const out = await new TestAgent({ provider: 'openai', model: 'gpt-4o' }).callStructured(
      [{ role: 'user', content: 'go' }],
      schema,
    );

    expect(captured.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'demo', schema: schema.schema } });
    expect(captured.stream).toBeUndefined();
    expect(JSON.parse(out)).toEqual({ ok: true });
  });

  it('Gemini: requests native JSON mode (responseMimeType) so output is parseable, not markdown-wrapped', async () => {
    setLLMStreamingEnabled(false); // force the buffered path so we can read the request body
    try {
      let body: any = null;
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
        body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          }),
        } as any;
      }));

      const out = await new TestAgent({ provider: 'gemini', model: 'gemini-2.5-pro' }).callPlain(
        [{ role: 'user', content: 'go' }],
      );

      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(JSON.parse(out)).toEqual({ ok: true });
    } finally {
      setLLMStreamingEnabled(true);
    }
  });

  it('Gemini: sends responseSchema for structured JSON calls and stays on the buffered path', async () => {
    setLLMStreamingEnabled(true);
    let body: any = null;
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      url = u;
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      } as any;
    }));

    const geminiSchema: StructuredJsonSchema = {
      ...schema,
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          nested: {
            type: 'object',
            additionalProperties: true,
            properties: { note: { type: 'string' } },
          },
          items: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: { type: 'string' },
          },
        },
        required: ['ok'],
      },
    };

    const out = await new TestAgent({ provider: 'gemini', model: 'gemini-2.5-pro', maxTokens: 4096 }).callStructured(
      [{ role: 'user', content: 'go' }],
      geminiSchema,
    );

    expect(url).toContain(':generateContent?');
    expect(url).not.toContain(':streamGenerateContent');
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
    // 2048, not 128: a 128-token thinking budget starved gemini-2.5-pro into
    // truncated structured JSON (bite-me 2026-07-04 analyzer aborts).
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 2048 });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toEqual({
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        nested: {
          type: 'object',
          properties: { note: { type: 'string' } },
        },
        items: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['ok'],
    });
    expect(JSON.parse(out)).toEqual({ ok: true });
  });

  it('Gemini: caps structured-output headroom by the schema budget', async () => {
    setLLMStreamingEnabled(true);
    let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      } as any;
    }));

    await new TestAgent({ provider: 'gemini', model: 'gemini-2.5-pro', maxTokens: 16384 }).callStructured(
      [{ role: 'user', content: 'go' }],
      { ...schema, maxOutputTokens: 12000 },
    );

    expect(body.generationConfig.maxOutputTokens).toBe(12000);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 2048 });
  });

  it('Gemini: reserves visible semantic-patch output beyond minimal thinking', async () => {
    let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: 12 },
        }),
      } as any;
    }));

    await new TestAgent({ provider: 'gemini', model: 'gemini-2.5-pro', maxTokens: 16384 }).callStructured(
      [{ role: 'user', content: 'go' }],
      {
        ...schema,
        outputBudget: {
          visibleTokens: 1536,
          reasoningProfile: 'minimal',
          safetyTokens: 256,
          totalCeiling: 4096,
        },
      },
    );

    expect(body.generationConfig.maxOutputTokens).toBe(2304);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 512 });
  });

  it('Gemini: uses low thinking level for Gemini 3 structured JSON calls', async () => {
    setLLMStreamingEnabled(true);
    let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      } as any;
    }));

    await new TestAgent({ provider: 'gemini', model: 'gemini-3.1-pro-preview', maxTokens: 16384 }).callStructured(
      [{ role: 'user', content: 'go' }],
      schema,
    );

    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('Gemini: omits JSON mode when the agent opts out (openaiForceJsonResponse=false)', async () => {
    setLLMStreamingEnabled(false);
    try {
      let body: any = null;
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
        body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'plain prose' }] } }], usageMetadata: {} }),
        } as any;
      }));

      await new TestAgent({ provider: 'gemini', model: 'gemini-2.5-pro', openaiForceJsonResponse: false }).callPlain(
        [{ role: 'user', content: 'go' }],
      );

      expect(body.generationConfig.responseMimeType).toBeUndefined();
    } finally {
      setLLMStreamingEnabled(true);
    }
  });

  it('OpenRouter: dispatches to its OWN endpoint + headers, never the OpenAI path', async () => {
    let url = '';
    let headers: Record<string, string> = {};
    let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      url = u;
      headers = init.headers;
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }),
      } as any;
    }));

    const out = await new TestAgent({ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' }).callStructured(
      [{ role: 'user', content: 'go' }],
      schema,
    );

    // Separate path: OpenRouter endpoint + attribution headers, NOT api.openai.com.
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headers['HTTP-Referer']).toBe('https://storyrpg.app');
    expect(headers['X-Title']).toBe('StoryRPG');
    // No OpenAI reasoning-class shaping leaks in — plain max_tokens + temperature.
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_tokens).toBe(1024);
    expect(body.model).toBe('deepseek/deepseek-v4-pro');
    expect(JSON.parse(out)).toEqual({ ok: true });
  });
});

describe('BaseAgent callLLMForJson re-sample on parse failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setLLMStreamingEnabled(true);
  });

  const anthropicText = (text: string) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  });

  it('re-samples once when the first response is unrepairable JSON, then succeeds', async () => {
    setLLMStreamingEnabled(false); // buffered path so the stub body is read verbatim
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      // First sample mirrors the real WorldBuilder failure: a missing opening
      // quote on an array element that repairJSON cannot salvage.
      const text = calls === 1
        ? '{"worldRules":["Control",Secrecy"]}'
        : '{"worldRules":["Control","Secrecy"]}';
      return anthropicText(text) as any;
    }));

    const out = await new TestAgent().callJson<{ worldRules: string[] }>([{ role: 'user', content: 'go' }]);
    expect(calls).toBe(2);
    expect(out.data.worldRules).toEqual(['Control', 'Secrecy']);
  });

  it('does not re-sample when the first response already parses', async () => {
    setLLMStreamingEnabled(false);
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return anthropicText('{"ok":true}') as any;
    }));

    const out = await new TestAgent().callJson<{ ok: boolean }>([{ role: 'user', content: 'go' }]);
    expect(calls).toBe(1);
    expect(out.data).toEqual({ ok: true });
  });

  it('throws when both samples are unparseable', async () => {
    setLLMStreamingEnabled(false);
    vi.stubGlobal('fetch', vi.fn(async () => anthropicText('{"worldRules":["Control",Secrecy"]}') as any));
    await expect(
      new TestAgent().callJson<{ worldRules: string[] }>([{ role: 'user', content: 'go' }]),
    ).rejects.toThrow(/Failed to parse JSON/);
  });
});

describe('BaseAgent provider truncation guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setLLMStreamingEnabled(true);
  });

  it('rejects Gemini MAX_TOKENS responses even when content is present', async () => {
    setLLMStreamingEnabled(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{
          finishReason: 'MAX_TOKENS',
          content: { parts: [{ text: '{"partial":true}' }] },
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      }),
    })) as any);

    await expect(
      new TestAgent({ provider: 'gemini', model: 'gemini-2.5-pro' }).callPlain([{ role: 'user', content: 'go' }]),
    ).rejects.toThrow(TruncatedLLMResponseError);
  });
});


describe('resolveStructuredCallBudget fail-open (infeasible declarations)', () => {
  it('lifts an infeasible schema ceiling to the requirement when the provider cap allows', () => {
    const resolved = resolveStructuredCallBudget({
      configured: 8192,
      schema: {
        name: 'tiny_reauthor',
        schema: { type: 'object' },
        maxOutputTokens: 256,
        outputBudget: { visibleTokens: 256, reasoningProfile: 'minimal', safetyTokens: 64, totalCeiling: 512 },
      } as never,
      defaultCap: 8192,
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
    });
    // The 512 ceiling is advisory once infeasible: the call RUNS with the full
    // requirement instead of being rejected on every attempt (the encounter
    // description re-author was dead across three resumes this way).
    expect(resolved.maxOutputTokens).toBeGreaterThanOrEqual(resolved.visibleTokens + resolved.safetyTokens);
    expect(resolved.visibleTokens).toBe(256);
  });

  it('shrinks the reasoning reservation when the provider cap itself cannot fit', () => {
    const resolved = resolveStructuredCallBudget({
      configured: 1024,
      schema: {
        name: 'tiny_reauthor',
        schema: { type: 'object' },
        maxOutputTokens: 256,
        outputBudget: { visibleTokens: 256, reasoningProfile: 'minimal', safetyTokens: 64 },
      } as never,
      defaultCap: 1024,
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
    });
    expect(resolved.maxOutputTokens).toBe(1024);
    expect(resolved.reasoningTokens).toBe(1024 - 256 - 64);
  });
});
