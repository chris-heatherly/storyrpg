import { describe, expect, it } from 'vitest';
import { AgentResponse, BaseAgent } from './BaseAgent';

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
    return 'Test parser behavior.';
  }

  parse<T>(response: string): T {
    return this.parseJSON<T>(response);
  }

  cachedSystem(text: string) {
    return this.buildCachedSystemField(text);
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
});
