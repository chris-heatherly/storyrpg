import { describe, expect, it } from 'vitest';
import { buildChoiceResolutionRepairHandler } from './choiceResolutionRepairHandler';

// Regression for bite-me_2026-07-14T23-29-29: the s1-4 choice-resolution
// finding was withheld as diagnostic_stop through every repair round because
// no final-contract executor existed for choice_reauthor.

const task = {
  id: 'task:event:ep1-u4:choice-resolution',
  contractId: 'event:ep1-u4',
  episodeNumber: 1,
  ownerStage: 'choice_author' as const,
  repairHandler: 'choice_reauthor' as const,
  sceneId: 's1-4',
  evidenceAtoms: [
    { id: 'event:ep1-u4:semantic:1', description: 'Kylie, Stela, and Mika form the Dusk Club.', acceptedPatterns: [], kind: 'semantic', required: true },
    { id: 'event:ep1-u4:semantic:2', description: 'Kylie is tested.', acceptedPatterns: [], kind: 'semantic', required: true },
  ],
  target: { scope: 'owner' as const, surfaces: ['choice_outcome' as const] },
  sourceContractIds: ['ep1-u4'],
  blocking: true,
} as never;

const issue = {
  type: 'semantic_realization_violation',
  severity: 'error' as const,
  message: 'Canonical realization validation confirms that task task:event:ep1-u4:choice-resolution is missing: event:ep1-u4:semantic:2, event:ep1-u4:semantic:1.',
  validator: 'SemanticRealizationJudge',
  sceneId: 's1-4',
  episodeNumber: 1,
  taskId: 'task:event:ep1-u4:choice-resolution',
  repairHandler: 'choice_reauthor',
  missingEvidenceAtoms: ['event:ep1-u4:semantic:1', 'event:ep1-u4:semantic:2'],
} as never;

function storyWithChoices() {
  return {
    episodes: [{
      number: 1,
      scenes: [{
        id: 's1-4',
        name: 'The Test',
        beats: [{
          id: 's1-4-b4',
          text: 'Mika leans forward.',
          choices: [{
            id: 's1-4-b4-c1',
            text: 'Answer honestly.',
            outcomeTexts: { success: 'Mika smiles.', partial: 'Mika hesitates.', failure: 'Mika frowns.' },
          }],
        }],
      }],
    }],
  } as never;
}

describe('choiceResolutionRepairHandler', () => {
  it('re-authors the shared payoff from atom meanings and projects it into every tier', async () => {
    const received: string[][] = [];
    const handler = buildChoiceResolutionRepairHandler({
      author: () => ({
        reauthorSharedResolutionText: async (ctx) => {
          received.push(ctx.requiredMeanings);
          return 'The three of you seal it with a toast — the Dusk Club, tested and true.';
        },
      }),
      tasksById: () => new Map([[String((task as { id: string }).id), task]]),
    });
    const story = storyWithChoices();
    const result = await handler({ story, blockingIssues: [issue] } as never);
    expect(result.changed).toBe(true);
    // The author saw the authored meanings, not opaque atom IDs.
    expect(received[0].join(' ')).toContain('Dusk Club');
    expect(received[0].join(' ')).toContain('tested');
    const choice = (story as never as { episodes: Array<{ scenes: Array<{ beats: Array<{ choices: Array<{ outcomeTexts: Record<string, string> }> }> }> }> })
      .episodes[0].scenes[0].beats[0].choices[0];
    for (const tier of ['success', 'partial', 'failure']) {
      expect(choice.outcomeTexts[tier]).toContain('Dusk Club');
    }
    expect(result.attemptedIssueKeys?.length).toBe(1);
  });

  it('prefers tier-distinct variants over one pasted passage (G4: convergent endpoint, distinct residue)', async () => {
    let sharedCalled = false;
    const handler = buildChoiceResolutionRepairHandler({
      author: () => ({
        reauthorSharedResolutionText: async () => {
          sharedCalled = true;
          return 'One pasted passage.';
        },
        reauthorSharedResolutionVariants: async (ctx) => {
          expect(ctx.tiers.sort()).toEqual(['failure', 'partial', 'success']);
          return {
            success: 'The pact lands clean — the Dusk Club is born over raised glasses.',
            partial: 'The pact forms anyway, but the Dusk Club begins on a guarded smile.',
            failure: 'Even after the stumble, the Dusk Club takes shape — earned the hard way.',
          };
        },
      }),
      tasksById: () => new Map([[String((task as { id: string }).id), task]]),
    });
    const story = storyWithChoices();
    const result = await handler({ story, blockingIssues: [issue] } as never);
    expect(result.changed).toBe(true);
    expect(sharedCalled).toBe(false);
    const choice = (story as never as { episodes: Array<{ scenes: Array<{ beats: Array<{ choices: Array<{ outcomeTexts: Record<string, string> }> }> }> }> })
      .episodes[0].scenes[0].beats[0].choices[0];
    const texts = ['success', 'partial', 'failure'].map((tier) => choice.outcomeTexts[tier]);
    for (const text of texts) expect(text).toContain('Dusk Club');
    expect(new Set(texts).size).toBe(3);
  });

  it('falls back to the shared passage when the variants author declines', async () => {
    const handler = buildChoiceResolutionRepairHandler({
      author: () => ({
        reauthorSharedResolutionText: async () => 'The Dusk Club is born.',
        reauthorSharedResolutionVariants: async () => undefined,
      }),
      tasksById: () => new Map([[String((task as { id: string }).id), task]]),
    });
    const story = storyWithChoices();
    const result = await handler({ story, blockingIssues: [issue] } as never);
    expect(result.changed).toBe(true);
  });

  it('reports unchanged when the author produces nothing', async () => {
    const handler = buildChoiceResolutionRepairHandler({
      author: () => ({ reauthorSharedResolutionText: async () => undefined }),
    });
    const story = storyWithChoices();
    const result = await handler({ story, blockingIssues: [issue] } as never);
    expect(result.changed).toBe(false);
    expect(result.attemptedIssueKeys?.length).toBe(1);
  });
});
