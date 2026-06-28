import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseAgent } from './BaseAgent';
import type { AgentConfig } from '../config';
import type { AgentResponse } from './BaseAgent';

class TestOpenRouterAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Test OpenRouter Agent', config);
  }

  protected getAgentSpecificPrompt(): string {
    return 'Test agent.';
  }

  execute(): Promise<AgentResponse<unknown>> {
    throw new Error('Not used by this test.');
  }

  run(): Promise<string> {
    return this.callLLM([{ role: 'user', content: 'Return JSON.' }], 0, {
      jsonSchema: {
        name: 'test_openrouter_routing',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: { ok: { type: 'boolean' } },
        },
      },
    });
  }
}

describe('BaseAgent OpenRouter routing metadata', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes OpenRouter routing fields using API wire names', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    } as Response);

    const agent = new TestOpenRouterAgent({
      provider: 'openrouter',
      model: 'openrouter/fusion',
      apiKey: 'or-key',
      maxTokens: 1024,
      temperature: 0.2,
      openRouter: {
        models: ['qwen/qwen3.6-flash', 'mistralai/mistral-medium-3.5'],
        provider: {
          order: ['Together'],
          allowFallbacks: true,
          requireParameters: true,
          dataCollection: 'deny',
          sort: 'latency',
        },
        transforms: ['middle-out'],
        route: 'fusion',
      },
    });

    await agent.run();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.models).toEqual(['qwen/qwen3.6-flash', 'mistralai/mistral-medium-3.5']);
    expect(body.provider).toMatchObject({
      order: ['Together'],
      allow_fallbacks: true,
      require_parameters: true,
      data_collection: 'deny',
      sort: 'latency',
    });
    expect(body.transforms).toEqual(['middle-out']);
  });
});
