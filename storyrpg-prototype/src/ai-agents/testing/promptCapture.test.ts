import { afterEach, describe, expect, it } from 'vitest';

import { BaseAgent, type AgentMessage } from '../agents/BaseAgent';
import {
  createScriptedResponder,
  fnv1a64,
  MissingFixtureError,
  normalizeCheckpointsForSnapshot,
  normalizeEventsForSnapshot,
  serializePromptSnapshot,
  startPromptCapture,
} from './promptCapture';
import type { PipelineEvent } from '../pipeline/events';

class ProbeAgent extends BaseAgent {
  constructor(name: string) {
    super(name, {
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return 'Probe instructions.';
  }

  async execute(): Promise<{ success: boolean }> {
    return { success: true };
  }

  callForTest(messages: AgentMessage[]): Promise<string> {
    return this.callLLM(messages, 0);
  }
}

afterEach(() => {
  BaseAgent.setLlmTransportOverride(null);
});

describe('prompt capture harness', () => {
  it('intercepts callLLM with the fully assembled messages, in call order', async () => {
    const session = startPromptCapture(() => '{"ok":true}');
    try {
      const writer = new ProbeAgent('ProbeWriter');
      const critic = new ProbeAgent('ProbeCritic');
      await writer.callForTest([{ role: 'user', content: 'write scene 1' }]);
      await critic.callForTest([{ role: 'user', content: 'critique scene 1' }]);
    } finally {
      session.stop();
    }

    expect(session.exchanges.map((e) => e.agentName)).toEqual(['ProbeWriter', 'ProbeCritic']);
    expect(session.exchanges[0].index).toBe(0);
    expect(session.exchanges[1].index).toBe(1);
    // System prompt is auto-injected, so the capture sees the EXACT request.
    expect(session.exchanges[0].messages[0].role).toBe('system');
    expect(String(session.exchanges[0].messages[0].content)).toContain('ProbeWriter');
    expect(session.exchanges[0].messages[1]).toEqual({ role: 'user', content: 'write scene 1' });
    expect(session.exchanges[0].provider).toBe('anthropic');
    expect(session.exchanges[0].model).toBe('test-model');
    expect(session.exchanges[0].responseDigest).toBe(fnv1a64('{"ok":true}'));
  });

  it('stop() uninstalls the override so later sessions start clean', async () => {
    const first = startPromptCapture(() => 'one');
    const agent = new ProbeAgent('ProbeWriter');
    await agent.callForTest([{ role: 'user', content: 'a' }]);
    first.stop();

    const second = startPromptCapture(() => 'two');
    try {
      await agent.callForTest([{ role: 'user', content: 'b' }]);
    } finally {
      second.stop();
    }

    expect(first.exchanges).toHaveLength(1);
    expect(second.exchanges).toHaveLength(1);
  });

  it('scripted responder consumes per-agent arrays FIFO and reuses single fixtures', async () => {
    const responder = createScriptedResponder({
      ProbeWriter: ['first', 'second'],
      ProbeCritic: 'always-this',
    });
    const session = startPromptCapture(responder);
    try {
      const writer = new ProbeAgent('ProbeWriter');
      const critic = new ProbeAgent('ProbeCritic');
      expect(await writer.callForTest([{ role: 'user', content: 'x' }])).toBe('first');
      expect(await critic.callForTest([{ role: 'user', content: 'x' }])).toBe('always-this');
      expect(await writer.callForTest([{ role: 'user', content: 'y' }])).toBe('second');
      expect(await critic.callForTest([{ role: 'user', content: 'y' }])).toBe('always-this');
      await expect(writer.callForTest([{ role: 'user', content: 'z' }])).rejects.toThrow(
        MissingFixtureError
      );
    } finally {
      session.stop();
    }
  });

  it('function fixtures receive the request and indices', async () => {
    const responder = createScriptedResponder({
      ProbeWriter: [(request, perAgent, global) => `${request.agentName}:${perAgent}:${global}`],
    });
    const session = startPromptCapture(responder);
    try {
      const writer = new ProbeAgent('ProbeWriter');
      expect(await writer.callForTest([{ role: 'user', content: 'x' }])).toBe('ProbeWriter:0:0');
    } finally {
      session.stop();
    }
  });

  it('serialization is deterministic and ends with a newline', () => {
    const exchanges = [
      {
        index: 0,
        agentName: 'A',
        provider: 'anthropic',
        model: 'm',
        messages: [{ role: 'user' as const, content: 'hi' }],
        responseDigest: fnv1a64('r'),
      },
    ];
    const one = serializePromptSnapshot(exchanges);
    const two = serializePromptSnapshot(JSON.parse(JSON.stringify(exchanges)));
    expect(one).toBe(two);
    expect(one.endsWith('\n')).toBe(true);
  });

  it('event normalization strips wall-clock noise', () => {
    const events: PipelineEvent[] = [
      {
        type: 'phase_complete',
        phase: 'world_building',
        message: 'World building done in 12.4s',
        timestamp: new Date(),
        telemetry: { elapsedSeconds: 12 },
      },
      {
        type: 'phase_complete',
        phase: 'saving',
        message: 'Saved 20 files to generated-stories/the-locked-wing_2026-07-19-22-25-34-081_4499933825-8ytqfme/',
        timestamp: new Date(),
      },
    ];
    expect(normalizeEventsForSnapshot(events)).toEqual([
      { type: 'phase_complete', phase: 'world_building', message: 'World building done in <t>' },
      { type: 'phase_complete', phase: 'saving', message: 'Saved 20 files to generated-stories/<run>/' },
    ]);
  });

  it('checkpoint normalization keeps shape, not payload', () => {
    const normalized = normalizeCheckpointsForSnapshot([
      { phase: 'worldBible', data: { b: 1, a: 2 }, requiresApproval: false },
    ]);
    expect(normalized).toEqual([{ phase: 'worldBible', requiresApproval: false, dataKeys: ['a', 'b'] }]);
  });
});
