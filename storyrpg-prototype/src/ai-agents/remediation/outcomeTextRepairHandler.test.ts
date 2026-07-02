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
const REAL_PARTIAL = 'The bell rings unanswered, but a light shifts behind the frosted glass.';
const REAL_FAILURE = 'The door stays shut, and the hall seems colder than before.';

function storyWith(choices: any[]): Story {
  return { episodes: [{ number: 1, scenes: [{ id: 's1', name: 'The Door', beats: [{ id: 'b1', choices }] }] }] } as unknown as Story;
}

const mockAgent = (impl: OutcomeReauthorAgent['reauthorOutcomeTexts']): OutcomeReauthorAgent => ({ reauthorOutcomeTexts: vi.fn(impl) });

describe('collectStubOutcomeChoices', () => {
  it('finds choices with stub tiers and reports exactly which tiers are stubs', () => {
    const story = storyWith([
      { id: 'c1', text: 'Knock', stakes: { want: 'get in' }, outcomeTexts: { success: STUB_SUCCESS, partial: STUB_PARTIAL, failure: REAL } },
      { id: 'c2', text: 'Leave', outcomeTexts: { success: REAL, partial: REAL_PARTIAL, failure: REAL_FAILURE } }, // all authored and distinct
    ]);
    const targets = collectStubOutcomeChoices(story);
    expect(targets).toHaveLength(1);
    expect(targets[0].choice.id).toBe('c1');
    expect(targets[0].needTiers).toEqual(['success', 'partial']); // failure is real
    expect(targets[0].sceneName).toBe('The Door');
  });

  it('finds choices whose authored tiers are identical', () => {
    const story = storyWith([
      { id: 'c1', text: 'Knock', outcomeTexts: { success: REAL, partial: REAL, failure: 'The lock holds, and the hall seems colder than before.' } },
    ]);
    const targets = collectStubOutcomeChoices(story);
    expect(targets).toHaveLength(1);
    expect(targets[0].needTiers).toEqual(['success', 'partial']);
  });

  it('also walks choices nested inside encounter beats', () => {
    const story = { episodes: [{ number: 1, scenes: [{ id: 's1', name: 'Fight', encounter: { phases: [{ beats: [{ choices: [{ id: 'e1', text: 'Strike', outcomeTexts: { success: STUB_SUCCESS } }] }] }] } }] }] } as unknown as Story;
    const targets = collectStubOutcomeChoices(story);
    expect(targets.map((t) => t.choice.id)).toEqual(['e1']);
  });

  it('derives a scene setting hint from the establishing beat for the re-author prompt', () => {
    const story = {
      episodes: [{ number: 1, scenes: [{
        id: 's1', name: 'Cișmigiu',
        beats: [
          { id: 'b1', text: 'You walk through Cișmigiu Gardens. At 1am the fog hangs low between the willows.' },
          { id: 'b2', choices: [{ id: 'c1', text: 'Scramble away', outcomeTexts: { success: STUB_SUCCESS } }] },
        ],
      }] }],
    } as unknown as Story;
    const targets = collectStubOutcomeChoices(story);
    expect(targets).toHaveLength(1);
    expect(targets[0].sceneLocation).toContain('Cișmigiu Gardens');
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

  it('re-authors duplicate authored tiers with distinct prose', async () => {
    const story = storyWith([
      { id: 'c1', text: 'Knock', stakes: { want: 'get in', cost: 'be heard' }, outcomeTexts: { success: REAL, partial: REAL, failure: 'The door stays shut.' } },
    ]);
    const agent = mockAgent(async ({ needTiers }) => Object.fromEntries(needTiers.map((t) => [t, `${t}: ${REAL}`])));
    const handler = buildOutcomeTextRepairHandler({ author: () => agent });
    const result = await handler({ story, blockingIssues: [] });

    expect(result.changed).toBe(true);
    const choice: any = (result.story as any).episodes[0].scenes[0].beats[0].choices[0];
    expect(choice.outcomeTexts.success).not.toBe(choice.outcomeTexts.partial);
    expect((agent.reauthorOutcomeTexts as any)).toHaveBeenCalledOnce();
  });

  it('rejects a re-authored tier that echoes the choice prompt (would re-flag as equals-prompt)', async () => {
    const story = storyWith([
      { id: 'c1', text: 'Scramble away from the attacker', stakes: { want: 'escape' }, outcomeTexts: { success: STUB_SUCCESS, partial: REAL_PARTIAL, failure: REAL_FAILURE } },
    ]);
    // The re-author lazily returns the choice prompt itself.
    const agent = mockAgent(async () => ({ success: 'Scramble away from the attacker!' }));
    const handler = buildOutcomeTextRepairHandler({ author: () => agent });
    const result = await handler({ story, blockingIssues: [] });

    expect(result.changed).toBe(false);
    const choice: any = (result.story as any).episodes[0].scenes[0].beats[0].choices[0];
    // The stub is kept (gate still blocks) rather than replaced with an echo.
    expect(isFallbackOutcomeText(choice.outcomeTexts.success)).toBe(true);
  });

  it('is a no-op when nothing is stubbed', async () => {
    const story = storyWith([{ id: 'c1', text: 'Knock', outcomeTexts: { success: REAL, partial: REAL_PARTIAL, failure: REAL_FAILURE } }]);
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
