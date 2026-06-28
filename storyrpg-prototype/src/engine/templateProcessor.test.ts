import { describe, it, expect } from 'vitest';
import { selectTextVariant, conditionSpecificity, processText } from './templateProcessor';
import { sanitizeReaderProse } from './readerProseSanitizer';
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

describe('processText', () => {
  it('strips structural callback scaffolding from selected variants', () => {
    const player = makePlayer({ flags: { shared_card_with_mika: true } });
    const text = processText(
      'Three brand-deal inquiries are already in your inbox.',
      [
        {
          condition: { type: 'flag', flag: 'shared_card_with_mika', value: true },
          text: 'Three brand-deal inquiries are already in your inbox.\n\nOpening the card and read it aloud to Mika still changes how this moment lands.',
          callbackHookId: 'flag:shared_card_with_mika',
        } as any,
      ],
      player,
      null,
    );

    expect(text).toBe('Three brand-deal inquiries are already in your inbox.');
  });

  it('falls back to base text when a matching variant is only scaffolding', () => {
    const player = makePlayer({ flags: { shared_card_with_mika: true } });
    const text = processText(
      'The roses wait on the counter.',
      [
        {
          condition: { type: 'flag', flag: 'shared_card_with_mika', value: true },
          text: 'Opening the card and read it aloud to Mika still changes how this moment lands.',
          callbackHookId: 'flag:shared_card_with_mika',
        } as any,
      ],
      player,
      null,
    );

    expect(text).toBe('The roses wait on the counter.');
  });

  it('strips scene-planning prose before it can render as reader text', () => {
    const player = makePlayer();
    const text = processText(
      'Aftermath that resettles stakes; serves the hook beat ("Kylie unpacks in Bucharest.").',
      undefined,
      player,
      null,
    );

    expect(text).toBe('');
  });

  it('strips structural pressure callback prose before it can render', () => {
    const text = sanitizeReaderProse(
      'The Vâlcescu Club is a whisper of woodsmoke and old money.\n\nIn the next room, access, trust, and pressure have already shifted.',
    );

    expect(text).toBe('The Vâlcescu Club is a whisper of woodsmoke and old money.');
  });

  it('strips generic choice-reaction placeholders before they can render', () => {
    expect(sanitizeReaderProse('The moment lands immediately.')).toBe('');
    expect(sanitizeReaderProse('Your understanding changes.')).toBe('');
    expect(sanitizeReaderProse('You chose cunning over panic.')).toBe('');
    expect(sanitizeReaderProse('The selected route changes the next scene.')).toBe('');
    expect(sanitizeReaderProse('The world gives up a little more of its pattern.')).toBe('');
    expect(sanitizeReaderProse('Your ordinary world is reinvention-as-performance.')).toBe('');
    expect(sanitizeReaderProse("Her grandmother's address.")).toBe('');
    expect(sanitizeReaderProse("You arrive with your grandmother's address folded in your passport.")).toBe("You arrive with your grandmother's address folded in your passport.");
    expect(sanitizeReaderProse('Protects herself the way she always has — by observing.')).toBe('');
    expect(sanitizeReaderProse('Provide aftermath or a grounded transition into the next scene.')).toBe('');
    expect(sanitizeReaderProse('Let the public attention pressure the next scene without restaging the writing moment.')).toBe('');
    expect(sanitizeReaderProse('Development scene 5.')).toBe('');
    expect(sanitizeReaderProse('PEAK: In the park when the shadow appears: scream, run, freeze, or fight.')).toBe('');
    expect(sanitizeReaderProse('In the park when the shadow appears: scream, run, freeze, or fight — and next morning, what name do you give him: Mr. Midnight (canonical), The Stranger, The Velvet, or The Suit.')).toBe('');
    expect(sanitizeReaderProse("Kylie Marinescu's composed surface slips through a small evasive movement as her hands and attention lock onto the window.")).toBe('');
    expect(sanitizeReaderProse("The protagonist's posture, glance, and distance make the unspoken tension visible.")).toBe('');
    expect(sanitizeReaderProse("Victor Vâlcescu's smile, averted eyes, and busy hands betray what the words avoid.")).toBe('');
    expect(sanitizeReaderProse('[whispering] You hear the lock give.')).toBe('You hear the lock give.');
    expect(sanitizeReaderProse('<prosody rate="slow">You wait.</prosody>')).toBe('You wait.');
  });
});
