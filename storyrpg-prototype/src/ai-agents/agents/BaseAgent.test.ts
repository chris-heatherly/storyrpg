import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentResponse, BaseAgent, type StructuredJsonSchema, type AgentMessage } from './BaseAgent';
import type { AgentConfig } from '../config';

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
  it('flags wasLastResponseTruncated when recovery drops content', () => {
    const agent = new TestAgent();

    // Truncated array of objects (ends mid-string, no closing brackets) — the
    // recovery cuts back to the last complete object, dropping the rest.
    const parsed = agent.parse<{ shots: Array<Record<string, unknown>> }>(
      '{"shots":[{"a":1},{"b":2},{"c":"hello',
    );

    expect(parsed.shots).toEqual([{ a: 1 }, { b: 2 }]);
    expect(agent.wasLastResponseTruncated()).toBe(true);
  });

  it('does not flag truncation for a complete response', () => {
    const agent = new TestAgent();

    agent.parse<{ ok: boolean }>('{"ok":true}');

    expect(agent.wasLastResponseTruncated()).toBe(false);
  });

  it('recovers a response cut mid-string VALUE inside a nested array (the analyzer overflow)', () => {
    const agent = new TestAgent();

    // Mimics the structure-analysis overflow: valid leading fields, then cut
    // mid-string inside an array element with no closing quote/brackets. Used to
    // throw "Unterminated string …"; now the string is closed + structures
    // balanced so the leading data survives.
    const parsed = agent.parse<{ genre: string; themes: string[] }>(
      '{"genre":"Epic romantasy","themes":["Is a life measured by how long it lasts, or by what',
    );

    expect(parsed.genre).toBe('Epic romantasy');
    expect(Array.isArray(parsed.themes)).toBe(true);
    expect(parsed.themes[0]).toContain('Is a life measured by how long it lasts');
    expect(agent.wasLastResponseTruncated()).toBe(true);
  });

  it('recovers an array-element string cut with a dangling escape', () => {
    const agent = new TestAgent();
    // Cut inside an ARRAY element string (preceded by `[`, not `"prop":`), ending
    // on a lone backslash — exercises the close-the-string fallback + escape trim.
    const parsed = agent.parse<{ a: string; themes: string[] }>(
      '{"a":"ok","themes":["a complete one","a partial one ending in a dangling escape\\',
    );
    expect(parsed.a).toBe('ok');
    expect(Array.isArray(parsed.themes)).toBe(true);
    expect(parsed.themes[0]).toBe('a complete one');
    expect(parsed.themes[1]).toContain('a partial one');
  });

  it('recovers a SceneWriter response cut right after `"text":"` (dangling open quote)', () => {
    const agent = new TestAgent();
    // bite-me-g14 s1-6: the response was truncated mid-string so the last
    // non-whitespace char is a `"` (the just-opened value quote). handleTruncation
    // used to early-return on `endsWith('"')` and assume the JSON was complete,
    // rethrowing "Unterminated string in JSON". Now the dangling string is closed,
    // the incomplete trailing beat is dropped, and the completed beats survive.
    const parsed = agent.parse<{ sceneId: string; beats: Array<{ id: string; text: string }> }>(
      '{"sceneId":"s1-6","name":"release scene 6","beats":[{"id":"b1","text":"She opened the door."},{"id":"b2","text":"',
    );
    expect(parsed.sceneId).toBe('s1-6');
    expect(parsed.beats[0]).toEqual({ id: 'b1', text: 'She opened the door.' });
    expect(agent.wasLastResponseTruncated()).toBe(true);
  });

  it('recovers when the cut lands on a bare opening value quote with no prior beats', () => {
    const agent = new TestAgent();
    const parsed = agent.parse<{ sceneId: string; beats: unknown[] }>(
      '{"sceneId":"s1-6","name":"n","beats":[{"id":"b1","text":"',
    );
    expect(parsed.sceneId).toBe('s1-6');
    expect(Array.isArray(parsed.beats)).toBe(true);
  });
});

describe('BaseAgent truncation shadow counter (WS5)', () => {
  it('fires the static truncation observer when recovery drops content', () => {
    const events: Array<{ agentName: string; provider: string }> = [];
    BaseAgent.setTruncationObserver((e) => events.push(e));
    try {
      const agent = new TestAgent();
      // An array cut mid-object: recovery drops the trailing partial element.
      const parsed = agent.parse<{ scenes: Array<{ id: string }> }>(
        '{"scenes":[{"id":"s1"},{"id":"s2"},{"id":"s3","te',
      );
      expect(parsed.scenes.length).toBeGreaterThanOrEqual(2);
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
      const parsed = agent.parse<{ scenes: Array<{ id: string }> }>(
        '{"scenes":[{"id":"s1"},{"id":"s2","te',
      );
      expect(parsed.scenes.length).toBeGreaterThanOrEqual(1);
      expect(agent.wasLastResponseTruncated()).toBe(true);
    } finally {
      BaseAgent.setTruncationObserver(undefined);
    }
  });
});

describe('BaseAgent structured JSON output (opt-in jsonSchema)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const schema: StructuredJsonSchema = {
    name: 'demo',
    description: 'demo schema',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  };

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
});
