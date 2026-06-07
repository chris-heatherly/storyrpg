import { describe, it, expect } from 'vitest';
import { CallbackLedger } from './callbackLedger';
import type { Choice } from '../../types/choice';
import type { TextVariant } from '../../types/content';

function makeChoice(overrides: Partial<Choice> = {}): Choice {
  return {
    id: 'choice-1',
    text: 'Spare the herald',
    ...overrides,
  };
}

describe('CallbackLedger', () => {
  it('ignores choices without memorableMoment', () => {
    const ledger = new CallbackLedger();
    const result = ledger.recordChoice({
      choice: makeChoice(),
      episode: 1,
      sceneId: 'scene-1',
    });
    expect(result).toBeUndefined();
    expect(ledger.size()).toBe(0);
  });

  it('records a memorableMoment as a hook and infers flags when absent', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      memorableMoment: { id: 'spared-herald', summary: 'You spared the herald.' },
      consequences: [{ type: 'setFlag', flag: 'herald-lives', value: true } as any],
    });
    const hook = ledger.recordChoice({ choice, episode: 1, sceneId: 'scene-1' });
    expect(hook).toBeDefined();
    expect(hook!.id).toBe('spared-herald');
    expect(hook!.flags).toContain('herald-lives');
    expect(hook!.conditionKeys).toContain('herald-lives');
    expect(hook!.consequenceTier).toBe('callback');
    expect(hook!.resolved).toBe(false);
    expect(hook!.payoffWindow.minEpisode).toBe(2);
  });

  it('plants a score:<name> promise so a score-keyed payoff is not dangling', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      id: 'earn-thorne-trust',
      text: 'Take the eastern-wall assessment to Thorne yourself.',
      consequences: [{ type: 'changeScore', score: 'thorne_loyalty', change: 1 } as any],
    });
    expect(ledger.trackableScoresOf(choice)).toEqual(['thorne_loyalty']);
    const hook = ledger.recordScoreSet({ choice, score: 'thorne_loyalty', episode: 2, sceneId: 's2-1' });
    expect(hook).toBeDefined();
    expect(hook!.id).toBe('score:thorne_loyalty');
    // A later TextVariant keyed on this score now resolves against a real hook.
    expect(ledger.has('score:thorne_loyalty')).toBe(true);
  });

  it('records impact factors and explicit consequence tier from the choice', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      memorableMoment: { id: 'truth-told', summary: 'You told Mira the truth.', flags: ['truth-told'] },
      impactFactors: ['relationship', 'identity'],
      consequenceTier: 'sceneTint',
    });
    const hook = ledger.recordChoice({ choice, episode: 1, sceneId: 'scene-1' });
    expect(hook!.impactFactors).toEqual(['relationship', 'identity']);
    expect(hook!.consequenceTier).toBe('sceneTint');
  });

  it('uses explicit memorableMoment flags over inferred ones', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      memorableMoment: {
        id: 'spared-herald',
        summary: 'You spared the herald.',
        flags: ['herald-alive'],
      },
      consequences: [{ type: 'setFlag', flag: 'other-flag', value: true } as any],
    });
    const hook = ledger.recordChoice({ choice, episode: 1, sceneId: 'scene-1' });
    expect(hook!.flags).toContain('herald-alive');
  });

  it('records payoff and auto-resolves once threshold is met', () => {
    const ledger = new CallbackLedger({ config: { payoffThreshold: 2, defaultWindowSpan: 3, maxActiveHooks: 10 } });
    ledger.add({
      id: 'hook-1',
      sourceEpisode: 1,
      sourceSceneId: 's1',
      sourceChoiceId: 'c1',
      flags: ['f'],
      summary: 'Summary.',
      payoffWindow: { minEpisode: 2, maxEpisode: 4 },
    });
    ledger.recordPayoff('hook-1');
    expect(ledger.all()[0].resolved).toBe(false);
    ledger.recordPayoff('hook-1');
    expect(ledger.all()[0].resolved).toBe(true);
    expect(ledger.all()[0].payoffCount).toBe(2);
  });

  it('records payoffs from text variants that reference existing hook ids', () => {
    const ledger = new CallbackLedger();
    ledger.add({
      id: 'hook-1',
      sourceEpisode: 1,
      sourceSceneId: 's1',
      sourceChoiceId: 'c1',
      flags: ['f'],
      summary: 'Summary.',
      payoffWindow: { minEpisode: 2, maxEpisode: 4 },
    });
    const variants: TextVariant[] = [
      { condition: { type: 'flag', flag: 'f', value: true }, text: 'Payoff.', callbackHookId: 'hook-1' },
      { condition: { type: 'flag', flag: 'missing', value: true }, text: 'Ignored.', callbackHookId: 'does-not-exist' },
    ];
    const matched = ledger.recordPayoffsFromVariants(variants);
    expect(matched).toEqual(['hook-1']);
    expect(ledger.all()[0].payoffCount).toBe(1);
  });

  it('returns only unresolved hooks within the payoff window', () => {
    const ledger = new CallbackLedger();
    ledger.add({
      id: 'old',
      sourceEpisode: 1,
      sourceSceneId: 's1',
      sourceChoiceId: 'c1',
      flags: [],
      summary: 'Old hook.',
      payoffWindow: { minEpisode: 2, maxEpisode: 3 },
    });
    ledger.add({
      id: 'current',
      sourceEpisode: 2,
      sourceSceneId: 's2',
      sourceChoiceId: 'c2',
      flags: [],
      summary: 'Current hook.',
      payoffWindow: { minEpisode: 3, maxEpisode: 5 },
    });
    expect(ledger.unresolvedFor(3).map((h) => h.id)).toEqual(['old', 'current']);
    expect(ledger.unresolvedFor(4).map((h) => h.id)).toEqual(['current']);
  });

  it('serializes and deserializes losslessly', () => {
    const ledger = new CallbackLedger({ storyId: 'story-1' });
    ledger.add({
      id: 'h',
      sourceEpisode: 1,
      sourceSceneId: 's',
      sourceChoiceId: 'c',
      flags: ['x'],
      summary: 'sum',
      payoffWindow: { minEpisode: 2, maxEpisode: 4 },
    });
    const json = JSON.stringify(ledger.serialize());
    const round = CallbackLedger.deserialize(JSON.parse(json));
    expect(round.size()).toBe(1);
    expect(round.all()[0].id).toBe('h');
  });
});
