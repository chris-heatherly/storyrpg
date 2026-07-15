import { describe, expect, it, vi } from 'vitest';
import { SceneCritic } from './SceneCritic';

const config = {
  provider: 'gemini',
  model: 'gemini-test',
  apiKey: 'test',
  maxTokens: 1024,
} as never;

describe('SceneCritic append-only semantic repair', () => {
  it('accepts an extension that preserves the exact existing beat prefix', async () => {
    const critic = new SceneCritic(config);
    (critic as any).callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      sceneId: 's1-1', overallCommentary: '', critiqueNotes: [],
      rewrittenBeats: [{ id: 'b1', text: 'Existing accepted fact. Missing relationship now lands.' }],
    }));

    const result = await critic.execute({
      scene: { sceneId: 's1-1', beats: [{ id: 'b1', text: 'Existing accepted fact.' }] } as never,
      flaggedBeatIds: ['b1'],
      appendOnlyBeatIds: ['b1'],
    });

    expect(result.data?.rewrittenBeats).toHaveLength(1);
  });

  it('rejects a lossy rewrite that removes accepted beat text', async () => {
    const critic = new SceneCritic(config);
    (critic as any).callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      sceneId: 's1-1', overallCommentary: '', critiqueNotes: [],
      rewrittenBeats: [{ id: 'b1', text: 'Replacement text that drops the accepted fact.' }],
    }));

    const result = await critic.execute({
      scene: { sceneId: 's1-1', beats: [{ id: 'b1', text: 'Existing accepted fact.' }] } as never,
      flaggedBeatIds: ['b1'],
      appendOnlyBeatIds: ['b1'],
    });

    expect(result.data?.rewrittenBeats).toEqual([]);
  });
});
