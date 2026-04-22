import { describe, it, expect } from 'vitest';
import { selectTextVariant, conditionSpecificity } from './templateProcessor';
import type { PlayerState, TextVariant } from '../types';

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    characterName: 'Test',
    characterPronouns: 'they/them',
    attributes: { charisma: 0, intellect: 0, willpower: 0, charm: 0, observation: 0, cunning: 0 } as any,
    skills: {} as any,
    relationships: {},
    flags: { 'herald-alive': true, 'city-saved': true, 'wealthy': true },
    scores: {},
    tags: new Set<string>(),
    identityProfile: undefined as any,
    pendingConsequences: [],
    inventory: [],
    currentStoryId: null,
    currentEpisodeId: null,
    currentSceneId: null,
    completedEpisodes: [],
    ...overrides,
  };
}

describe('conditionSpecificity', () => {
  it('counts atomic conditions as 1', () => {
    expect(conditionSpecificity({ type: 'flag', flag: 'x', value: true } as any)).toBe(1);
  });

  it('sums AND/OR subclauses', () => {
    const cond = {
      type: 'and',
      conditions: [
        { type: 'flag', flag: 'a', value: true },
        { type: 'flag', flag: 'b', value: true },
        { type: 'flag', flag: 'c', value: true },
      ],
    } as any;
    expect(conditionSpecificity(cond)).toBe(3);
  });

  it('treats undefined as 0', () => {
    expect(conditionSpecificity(undefined)).toBe(0);
  });
});

describe('selectTextVariant', () => {
  it('returns base text when no variants match', () => {
    const player = makePlayer({ flags: {} });
    const variants: TextVariant[] = [
      { condition: { type: 'flag', flag: 'nope', value: true }, text: 'Nope.' },
    ];
    expect(selectTextVariant('base', variants, player)).toBe('base');
  });

  it('prefers the most specific matching variant over a broader one', () => {
    const player = makePlayer();
    const variants: TextVariant[] = [
      {
        condition: { type: 'flag', flag: 'herald-alive', value: true },
        text: 'Broad: you helped someone.',
      },
      {
        condition: {
          type: 'and',
          conditions: [
            { type: 'flag', flag: 'herald-alive', value: true },
            { type: 'flag', flag: 'city-saved', value: true },
            { type: 'flag', flag: 'wealthy', value: true },
          ],
        } as any,
        text: 'Specific: you spared the herald and saved the city.',
      },
    ];
    expect(selectTextVariant('base', variants, player)).toContain('Specific');
  });

  it('breaks ties by authoring order (first wins)', () => {
    const player = makePlayer();
    const variants: TextVariant[] = [
      { condition: { type: 'flag', flag: 'herald-alive', value: true }, text: 'First.' },
      { condition: { type: 'flag', flag: 'city-saved', value: true }, text: 'Second.' },
    ];
    expect(selectTextVariant('base', variants, player)).toBe('First.');
  });

  it('gives a callbackHookId variant a +1 boost', () => {
    const player = makePlayer();
    const variants: TextVariant[] = [
      { condition: { type: 'flag', flag: 'herald-alive', value: true }, text: 'Plain.' },
      {
        condition: { type: 'flag', flag: 'city-saved', value: true },
        text: 'Callback.',
        callbackHookId: 'some-hook',
      },
    ];
    expect(selectTextVariant('base', variants, player)).toBe('Callback.');
  });

  it('skips variants with empty text', () => {
    const player = makePlayer();
    const variants: TextVariant[] = [
      { condition: { type: 'flag', flag: 'herald-alive', value: true }, text: '   ' },
      { condition: { type: 'flag', flag: 'city-saved', value: true }, text: 'Real.' },
    ];
    expect(selectTextVariant('base', variants, player)).toBe('Real.');
  });
});
