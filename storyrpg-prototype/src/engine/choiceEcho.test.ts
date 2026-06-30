import { describe, it, expect } from 'vitest';
import { sentenceFromChoiceText } from './choiceEcho';

describe('sentenceFromChoiceText', () => {
  it('renders a short imperative label as a "You chose to …" sentence', () => {
    expect(sentenceFromChoiceText('Open the door')).toBe('You chose to open the door.');
    expect(sentenceFromChoiceText('Grant her the forward position')).toBe('You chose to grant her the forward position.');
  });

  it('handles negation', () => {
    expect(sentenceFromChoiceText("Don't trust him")).toBe('You chose not to trust him.');
  });

  it('strips a leading verb stem', () => {
    expect(sentenceFromChoiceText('Try to read his stance')).toBe('You chose to read his stance.');
  });

  it('does NOT mangle first-person dialogue choice text (the S4 B4 bug)', () => {
    const dialogue = 'I knew less than I should have. I dismissed the threat because I dismissed all of you. That was a mistake I will not repeat.';
    const out = sentenceFromChoiceText(dialogue);
    expect(out).not.toMatch(/^You chose to i knew/);
    expect(out).toMatch(/^You said: /);
    // long lines are truncated with an ellipsis
    expect(out!.length).toBeLessThan(110);
  });

  it('treats short first-person / multi-sentence statements as quoted speech', () => {
    expect(sentenceFromChoiceText('I will stay.')).toMatch(/^You said: /);
    expect(sentenceFromChoiceText('We hold the line. No retreat.')).toMatch(/^You said: /);
  });

  it('returns undefined for empty input', () => {
    expect(sentenceFromChoiceText('')).toBeUndefined();
    expect(sentenceFromChoiceText(undefined)).toBeUndefined();
  });
});
