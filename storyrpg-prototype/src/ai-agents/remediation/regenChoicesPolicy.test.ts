import { describe, expect, it } from 'vitest';
import {
  REGEN_CHOICES_FLAG,
  isChoiceRegenImprovement,
  shouldRegenChoices,
} from './regenChoicesPolicy';

const allOff = () => false;
const enable =
  (...flags: string[]) =>
  (flag: string) =>
    flags.includes(flag);

describe('regenChoicesPolicy', () => {
  it('exposes the rollout flag constant', () => {
    expect(REGEN_CHOICES_FLAG).toBe('GATE_REGEN_CHOICES');
  });

  describe('shouldRegenChoices', () => {
    it('returns false when the flag is off, even with the right signal + stakes on', () => {
      expect(shouldRegenChoices('choices', true, allOff)).toBe(false);
    });

    it('returns true when flag on + signal is "choices" + stakes enabled', () => {
      expect(
        shouldRegenChoices('choices', true, enable(REGEN_CHOICES_FLAG)),
      ).toBe(true);
    });

    it('returns false when stakes validation is disabled (no signal source)', () => {
      expect(
        shouldRegenChoices('choices', false, enable(REGEN_CHOICES_FLAG)),
      ).toBe(false);
    });

    it('returns false for a non-"choices" regeneration signal', () => {
      expect(
        shouldRegenChoices('scene', true, enable(REGEN_CHOICES_FLAG)),
      ).toBe(false);
      expect(
        shouldRegenChoices('encounter', true, enable(REGEN_CHOICES_FLAG)),
      ).toBe(false);
      expect(
        shouldRegenChoices('none', true, enable(REGEN_CHOICES_FLAG)),
      ).toBe(false);
    });

    it('only responds to its own flag, not an unrelated enabled flag', () => {
      expect(
        shouldRegenChoices('choices', true, enable('GATE_SOMETHING_ELSE')),
      ).toBe(false);
    });
  });

  describe('isChoiceRegenImprovement', () => {
    it('accepts when the rewrite passes outright (even if issue count did not drop)', () => {
      expect(isChoiceRegenImprovement(2, 2, true)).toBe(true);
      expect(isChoiceRegenImprovement(0, 5, true)).toBe(true);
    });

    it('accepts when the issue count strictly decreases', () => {
      expect(isChoiceRegenImprovement(3, 1, false)).toBe(true);
    });

    it('rejects when the issue count is unchanged and it does not pass', () => {
      expect(isChoiceRegenImprovement(2, 2, false)).toBe(false);
    });

    it('rejects when the issue count increases and it does not pass', () => {
      expect(isChoiceRegenImprovement(1, 3, false)).toBe(false);
    });
  });
});
