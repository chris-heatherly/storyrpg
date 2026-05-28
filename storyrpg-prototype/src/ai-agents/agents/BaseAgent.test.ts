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
});
