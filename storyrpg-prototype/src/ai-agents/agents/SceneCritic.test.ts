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

describe('SceneCritic conditional prose repair', () => {
  it('accepts variant prose changes only when route conditions are unchanged', async () => {
    const condition = { type: 'flag', flag: 'trusted_mika', value: true };
    const critic = new SceneCritic(config);
    const callLLM = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        sceneId: 's1-1', overallCommentary: '', critiqueNotes: [],
        rewrittenBeats: [{
          id: 'b1', text: 'You close the notebook.',
          textVariants: [{ condition, text: 'You follow Mika into the rain.' }],
        }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        sceneId: 's1-1', overallCommentary: '', critiqueNotes: [],
        rewrittenBeats: [{
          id: 'b1', text: 'You close the notebook.',
          textVariants: [{ condition: { ...condition, value: false }, text: 'You follow Mika into the rain.' }],
        }],
      }));
    (critic as any).callLLM = callLLM;
    const input = {
      scene: { sceneId: 's1-1', beats: [{
        id: 'b1', text: 'You close the notebook.',
        textVariants: [{ condition, text: 'Kylie follows Mika into the rain.' }],
      }] },
      flaggedBeatIds: ['b1'],
    } as never;

    const accepted = await critic.execute(input);
    const rejected = await critic.execute(input);

    expect(callLLM.mock.calls[0][0][0].content).toContain('textVariants');
    expect(accepted.data?.rewrittenBeats).toHaveLength(1);
    expect(rejected.data?.rewrittenBeats).toEqual([]);
  });
});
