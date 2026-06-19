import { describe, expect, it } from 'vitest';
import { coerceThirdPersonProtagonistToSecond } from './PovClarityValidator';

const KYLIE = 'Kylie Marinescu';
const pronouns = { coercePronouns: true, subjectPronoun: 'she' as const };

describe('coerceThirdPersonProtagonistToSecond (WS0.3 encounter-POV backstop)', () => {
  it('fixes the g17 enc-1-1 victory break with verb agreement', () => {
    const src = 'Kylie straightens her borrowed silk collar, breathing in the sharp, electric air.';
    const { text, changed } = coerceThirdPersonProtagonistToSecond(src, KYLIE, pronouns);
    expect(changed).toBe(true);
    expect(text).toBe('You straighten your borrowed silk collar, breathing in the sharp, electric air.');
  });

  it('fixes irregular verbs (isn\'t→aren\'t, has→have)', () => {
    const src = 'Kylie isn\'t the girl chasing the story—she has become it.';
    const { text } = coerceThirdPersonProtagonistToSecond(src, KYLIE, pronouns);
    expect(text).toBe('You aren\'t the girl chasing the story—you have become it.');
  });

  it('fixes the g17 enc-3-1 defeat break (multiple clauses)', () => {
    const src = 'Kylie touches her own arm, realizing how easily she almost let a beautiful face overwrite her instincts.';
    const { text } = coerceThirdPersonProtagonistToSecond(src, KYLIE, pronouns);
    expect(text).toBe('You touch your own arm, realizing how easily you almost let a beautiful face overwrite your instincts.');
  });

  it('does not turn protagonist-name modifiers into malformed "you noun" prose', () => {
    const src = 'Kylie rooftop bar is everything she crossed an ocean for.';
    const { text } = coerceThirdPersonProtagonistToSecond(src, KYLIE, pronouns);
    expect(text).toBe('Your rooftop bar is everything you crossed an ocean for.');
  });

  it('uses possessive second person for name-modifier fallout instead of subject you', () => {
    const src = 'Kylie candle between them dies.';
    const { text } = coerceThirdPersonProtagonistToSecond(src, KYLIE, pronouns);
    expect(text).toBe('Your candle between them dies.');
  });

  it('preserves quoted dialogue', () => {
    const src = '"She is mine," Victor says, as Kylie steps back.';
    const { text } = coerceThirdPersonProtagonistToSecond(src, KYLIE, pronouns);
    expect(text).toBe('"She is mine," Victor says, as you step back.');
  });

  it('is idempotent on already-second-person prose', () => {
    const src = 'You straighten your collar and breathe in the night air.';
    const { text, changed } = coerceThirdPersonProtagonistToSecond(src, KYLIE, pronouns);
    expect(changed).toBe(false);
    expect(text).toBe(src);
  });

  it('does not touch NPC-only prose', () => {
    const src = 'Victor pours the last of the champagne, his gaze lingering.';
    const { text, changed } = coerceThirdPersonProtagonistToSecond(src, KYLIE, pronouns);
    expect(changed).toBe(false);
    expect(text).toBe(src);
  });

  it('with coercePronouns=false (same-gender NPC present), converts the NAME but leaves ambiguous pronouns', () => {
    const src = 'Mika watches as Kylie straightens her collar.';
    const { text, changed } = coerceThirdPersonProtagonistToSecond(src, KYLIE, { coercePronouns: false });
    expect(changed).toBe(true);
    // Name + governed verb fixed; the ambiguous "her" (could be Mika's) is deliberately left
    // for the LLM-regen path rather than risk mis-attribution.
    expect(text).toBe('Mika watches as you straighten her collar.');
  });
});
