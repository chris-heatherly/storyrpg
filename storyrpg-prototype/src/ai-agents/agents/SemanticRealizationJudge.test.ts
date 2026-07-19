import { describe, expect, it, vi } from 'vitest';

import { SemanticRealizationJudge, type SemanticRealizationClaim } from './SemanticRealizationJudge';

describe('SemanticRealizationJudge relationship policy', () => {
  it('requires reciprocity only for mutual relationship transitions', async () => {
    const judge = new SemanticRealizationJudge({
      provider: 'anthropic', model: 'test', apiKey: 'x', maxTokens: 1024, temperature: 0,
    });
    const callLLM = vi.spyOn(judge as any, 'callLLM').mockResolvedValue(JSON.stringify({
      verdicts: [{ id: 'claim-1', verdict: 'not_fulfilled', evidenceRefs: [], missingCriteria: ['changed footing'], rationale: 'Missing.' }],
    }));
    const claim = {
      id: 'claim-1', taskId: 'task-1', atomId: 'atom-1', proposition: 'Mara betrays Kylie.',
      criteria: ['The betrayal changes their footing.'], polarity: 'required', participantIds: ['mara', 'kylie'],
      prerequisiteAtomIds: [], semanticRole: 'relationship_change', narrativeVoice: 'second_person',
      excerpts: [{
        id: 'excerpt-1', taskId: 'task-1', sceneId: 's1', ownerStage: 'scene_writer',
        surface: 'beat_text', groupKey: 'owner:1', text: 'Mara gives the file to their enemy.', textHash: 'hash',
      }],
    } satisfies SemanticRealizationClaim;

    await judge.execute([claim]);

    const prompt = callLLM.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Mutual transitions such as friendship, alliance, bonding, or reconciliation require');
    expect(prompt).toContain('unilateral transitions such as betrayal, rejection, estrangement, intimidation, or trust loss may be fulfilled');
  });
});
