import { describe, expect, it, vi } from 'vitest';
import {
  buildOutcomeTextRepairHandler,
  collectStubOutcomeChoices,
  type OutcomeReauthorAgent,
} from './outcomeTextRepairHandler';
import { FALLBACK_OUTCOME_TEXT_POOLS, isFallbackOutcomeText } from '../constants/choiceTextFallbacks';
import type { Story } from '../../types/story';

const STUB_SUCCESS = FALLBACK_OUTCOME_TEXT_POOLS.success[0];
const STUB_PARTIAL = FALLBACK_OUTCOME_TEXT_POOLS.partial[0];
const REAL = 'She presses the bell and the door gives; inside, the corridor smells of cold wax.';

function storyWith(choices: any[]): Story {
  return { episodes: [{ number: 1, scenes: [{ id: 's1', name: 'The Door', beats: [{ id: 'b1', choices }] }] }] } as unknown as Story;
}

const mockAgent = (impl: OutcomeReauthorAgent['reauthorOutcomeTexts']): OutcomeReauthorAgent => ({ reauthorOutcomeTexts: vi.fn(impl) });

describe('collectStubOutcomeChoices', () => {
  it('finds choices with stub tiers and reports exactly which tiers are stubs', () => {
    const story = storyWith([
      { id: 'c1', text: 'Knock', stakes: { want: 'get in' }, outcomeTexts: { success: STUB_SUCCESS, partial: STUB_PARTIAL, failure: REAL } },
      { id: 'c2', text: 'Leave', outcomeTexts: { success: REAL, partial: REAL, failure: REAL } }, // all authored
    ]);
    const targets = collectStubOutcomeChoices(story);
    expect(targets).toHaveLength(1);
    expect(targets[0].choice.id).toBe('c1');
    expect(targets[0].needTiers).toEqual(['success', 'partial']); // failure is real
    expect(targets[0].sceneName).toBe('The Door');
  });

  it('also walks choices nested inside encounter beats', () => {
    const story = { episodes: [{ number: 1, scenes: [{ id: 's1', name: 'Fight', encounter: { phases: [{ beats: [{ choices: [{ id: 'e1', text: 'Strike', outcomeTexts: { success: STUB_SUCCESS } }] }] }] } }] }] } as unknown as Story;
    const targets = collectStubOutcomeChoices(story);
    expect(targets.map((t) => t.choice.id)).toEqual(['e1']);
  });
});

describe('buildOutcomeTextRepairHandler', () => {
  it('re-authors stub tiers with real prose and reports changed', async () => {
    const story = storyWith([
      { id: 'c1', text: 'Knock', stakes: { want: 'get in', cost: 'be seen' }, outcomeTexts: { success: STUB_SUCCESS, partial: STUB_PARTIAL, failure: REAL } },
    ]);
    const agent = mockAgent(async ({ needTiers }) => Object.fromEntries(needTiers.map((t) => [t, `${t}: ${REAL}`])));
    const handler = buildOutcomeTextRepairHandler({ author: () => agent });
    const result = await handler({ story, blockingIssues: [] });

    expect(result.changed).toBe(true);
    const choice: any = (result.story as any).episodes[0].scenes[0].beats[0].choices[0];
    expect(isFallbackOutcomeText(choice.outcomeTexts.success)).toBe(false);
    expect(isFallbackOutcomeText(choice.outcomeTexts.partial)).toBe(false);
    expect(choice.outcomeTexts.failure).toBe(REAL); // untouched (was already real)
    expect(result.record?.rule).toBe('final_contract_outcome_text');
    expect((agent.reauthorOutcomeTexts as any)).toHaveBeenCalledOnce();
  });

  it('is a no-op when nothing is stubbed', async () => {
    const story = storyWith([{ id: 'c1', text: 'Knock', outcomeTexts: { success: REAL, partial: REAL, failure: REAL } }]);
    const agent = mockAgent(async () => ({}));
    const result = await buildOutcomeTextRepairHandler({ author: () => agent })({ story, blockingIssues: [] });
    expect(result.changed).toBe(false);
    expect(agent.reauthorOutcomeTexts).not.toHaveBeenCalled();
  });

  it('keeps the stub when the re-author returns another stub or empty (never replaces a stub with a stub)', async () => {
    const story = storyWith([{ id: 'c1', text: 'Knock', outcomeTexts: { success: STUB_SUCCESS } }]);
    const agent = mockAgent(async () => ({ success: FALLBACK_OUTCOME_TEXT_POOLS.success[1] })); // still a stub
    const result = await buildOutcomeTextRepairHandler({ author: () => agent })({ story, blockingIssues: [] });
    expect(result.changed).toBe(false);
    const choice: any = (story as any).episodes[0].scenes[0].beats[0].choices[0];
    expect(choice.outcomeTexts.success).toBe(STUB_SUCCESS); // unchanged
  });

  it('caps the number of choices re-authored per round', async () => {
    const choices = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, text: `Choice ${i}`, outcomeTexts: { success: STUB_SUCCESS } }));
    const story = storyWith(choices);
    const agent = mockAgent(async ({ needTiers }) => Object.fromEntries(needTiers.map((t) => [t, `${t}: ${REAL}`])));
    await buildOutcomeTextRepairHandler({ author: () => agent, maxChoicesPerRound: 2 })({ story, blockingIssues: [] });
    expect((agent.reauthorOutcomeTexts as any).mock.calls.length).toBe(2);
  });

  it('skips (changed:false) when no author is available', async () => {
    const story = storyWith([{ id: 'c1', text: 'Knock', outcomeTexts: { success: STUB_SUCCESS } }]);
    const result = await buildOutcomeTextRepairHandler({ author: () => null })({ story, blockingIssues: [] });
    expect(result.changed).toBe(false);
  });
});
