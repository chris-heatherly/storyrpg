import { describe, expect, it, vi } from 'vitest';
import { convertStateChangeToConsequence } from './stateChangeConverter';

describe('stateChangeConverter normalization', () => {
  it('normalizes encounter stat consequences that use value and description', () => {
    const consequence = convertStateChangeToConsequence({
      type: 'stat',
      value: '3',
      description: 'Your senses are sharpened by the adrenaline of the encounter.',
    } as never);

    expect(consequence).toEqual({
      type: 'setScore',
      score: 'senses_are_sharpened_adrenaline',
      value: 3,
    });
  });

  it('normalizes untargeted relationship residue as a score instead of warning and dropping it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const consequence = convertStateChangeToConsequence({
      type: 'relationship',
      value: '10',
      description: 'Victor left an indelible impression.',
    } as never);

    expect(consequence).toEqual({
      type: 'setScore',
      score: 'victor_left_indelible_impression',
      value: 10,
    });
    expect(warn).not.toHaveBeenCalledWith('[Converter] Invalid StateChange object:', expect.anything());

    warn.mockRestore();
  });

  it('normalizes score consequences that use flag as the score key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const consequence = convertStateChangeToConsequence({
      type: 'score',
      flag: 'creative_resolve',
      value: '2',
      description: 'Gained creative inspiration from the danger',
    } as never);

    expect(consequence).toEqual({
      type: 'setScore',
      score: 'creative_resolve',
      value: 2,
    });
    expect(warn).not.toHaveBeenCalledWith('[Converter] Invalid StateChange object:', expect.anything());

    warn.mockRestore();
  });

  it('normalizes score consequences that only provide description and value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const consequence = convertStateChangeToConsequence({
      type: 'score',
      value: '2',
      description: 'Confidence grew after surviving the dark.',
    } as never);

    expect(consequence).toEqual({
      type: 'setScore',
      score: 'confidence_grew_after_surviving',
      value: 2,
    });
    expect(warn).not.toHaveBeenCalledWith('[Converter] Invalid StateChange object:', expect.anything());

    warn.mockRestore();
  });

  it('normalizes app-facing changeScore consequences emitted in StateChange slots', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const consequence = convertStateChangeToConsequence({
      type: 'changeScore',
      value: 'survival_instincts_increase_victory',
    } as never);

    expect(consequence).toEqual({
      type: 'changeScore',
      score: 'survival_instincts_increase_victory',
      change: 1,
    });
    expect(warn).not.toHaveBeenCalledWith('[Converter] Invalid StateChange object:', expect.anything());

    warn.mockRestore();
  });
});
