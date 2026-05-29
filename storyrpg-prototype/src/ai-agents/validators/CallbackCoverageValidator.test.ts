import { describe, expect, it } from 'vitest';
import { CallbackCoverageValidator } from './CallbackCoverageValidator';
import type { CallbackHook, SerializedCallbackLedger, LedgerConfig } from '../pipeline/callbackLedger';

const CONFIG: LedgerConfig = {
  payoffThreshold: 2,
  defaultWindowSpan: 3,
  maxActiveHooks: 10,
};

function makeHook(overrides: Partial<CallbackHook> & Pick<CallbackHook, 'id'>): CallbackHook {
  return {
    id: overrides.id,
    sourceEpisode: overrides.sourceEpisode ?? 1,
    sourceSceneId: overrides.sourceSceneId ?? 'scene-1',
    sourceChoiceId: overrides.sourceChoiceId ?? 'choice-1',
    flags: overrides.flags ?? [],
    summary:
      overrides.summary ?? 'The player spared the deserter at the river crossing.',
    payoffWindow: overrides.payoffWindow ?? { minEpisode: 2, maxEpisode: 4 },
    payoffCount: overrides.payoffCount ?? 0,
    resolved: overrides.resolved ?? false,
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
  };
}

function makeLedger(hooks: CallbackHook[]): SerializedCallbackLedger {
  return { version: 1, storyId: 'story-1', hooks, config: CONFIG };
}

describe('CallbackCoverageValidator', () => {
  it('passes a clean ledger where prior hooks paid off this episode', () => {
    const ledger = makeLedger([
      makeHook({
        id: 'hook-river',
        sourceEpisode: 1,
        payoffCount: 1,
        payoffWindow: { minEpisode: 2, maxEpisode: 4 },
        summary: 'The player spared the deserter at the river crossing.',
      }),
      makeHook({
        id: 'hook-oath',
        sourceEpisode: 1,
        payoffCount: 1,
        payoffWindow: { minEpisode: 2, maxEpisode: 4 },
        summary: 'The player swore an oath to protect the village elder.',
      }),
    ]);

    const result = new CallbackCoverageValidator().validate({
      ledger,
      currentEpisode: 2,
      totalEpisodes: 5,
    });

    expect(result.passed).toBe(true);
    expect(result.issues.filter((i) => i.level === 'error')).toHaveLength(0);
    // Two prior hooks paid off this episode -> ratio meets the target of 2.
    expect(result.metrics.hooksPaidOffThisEpisode).toBe(2);
    expect(result.metrics.staleHooks).toBe(0);
    expect(result.score).toBe(100);
  });

  it('warns when no prior hooks paid off and flags stale + short-summary hooks', () => {
    const ledger = makeLedger([
      // Unresolved, still within window, never paid off -> drives "no payoff" warning.
      makeHook({
        id: 'hook-eligible',
        sourceEpisode: 2,
        payoffCount: 0,
        resolved: false,
        payoffWindow: { minEpisode: 3, maxEpisode: 5 },
        summary: 'The player betrayed the smuggler at the docks.',
      }),
      // Unresolved with a window that closed before the current episode -> stale.
      makeHook({
        id: 'hook-stale',
        sourceEpisode: 1,
        payoffCount: 0,
        resolved: false,
        payoffWindow: { minEpisode: 2, maxEpisode: 3 },
        summary: 'The player abandoned a wounded ally in the marsh.',
      }),
      // Short summary -> authoring-quality warning.
      makeHook({
        id: 'hook-thin',
        sourceEpisode: 3,
        payoffCount: 0,
        resolved: false,
        payoffWindow: { minEpisode: 4, maxEpisode: 6 },
        summary: 'too short',
      }),
    ]);

    const result = new CallbackCoverageValidator().validate({
      ledger,
      currentEpisode: 4,
      totalEpisodes: 6,
    });

    const messages = result.issues.map((i) => i.message).join('\n');

    // No prior hook paid off this episode, but an eligible hook exists -> warning.
    expect(result.metrics.hooksPaidOffThisEpisode).toBe(0);
    expect(messages).toContain('no scene in this episode referenced any of them');

    // Stale hook produces a suggestion-level issue.
    expect(result.metrics.staleHooks).toBe(1);
    expect(messages).toContain('has expired without a payoff');

    // Short summary produces a warning.
    expect(messages).toContain('missing or too-short summary');

    // No error-level issues, so the result still "passes" structurally,
    // but the score is dragged down well below 100.
    expect(result.passed).toBe(true);
    expect(result.score).toBeLessThan(100);
  });
});
