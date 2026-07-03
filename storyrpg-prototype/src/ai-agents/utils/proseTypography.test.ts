import { describe, expect, it } from 'vitest';
import { normalizeBeatTypography, normalizeProseTypography } from './proseTypography';

describe('normalizeProseTypography', () => {
  it('fixes the bite-me 2026-07-03 s1-5-b5 artifact cluster', () => {
    const input = "A new user, 'V. V, ', has left a simple, chilling message: 'I look forward to reading more. '.";
    expect(normalizeProseTypography(input)).toBe(
      "A new user, 'V. V', has left a simple, chilling message: 'I look forward to reading more.'",
    );
  });

  it('fixes space-before-closing-quote and trailing period after quoted sentence', () => {
    expect(normalizeProseTypography("'OMG. EVERYONE is reading this, We're famous. '.")).toBe(
      "'OMG. EVERYONE is reading this, We're famous.'",
    );
  });

  it('handles curly quotes', () => {
    expect(normalizeProseTypography('A message: ‘I look forward to reading more. ’.')).toBe(
      'A message: ‘I look forward to reading more.’',
    );
  });

  it('removes spaces before sentence punctuation without touching apostrophes', () => {
    expect(normalizeProseTypography("She waits . And we're done ,")).toBe("She waits. And we're done,");
    expect(normalizeProseTypography("It's Mika's plan.")).toBe("It's Mika's plan.");
  });

  it('leaves clean prose untouched', () => {
    const clean = '"Welcome to Bucharest, Kylie Marinescu," Mika says, her smile electric.';
    expect(normalizeProseTypography(clean)).toBe(clean);
  });

  it('does not auto-repair comma splices (judgment call, SceneCritic concern)', () => {
    const splice = 'By evening, your phone is buzzing incessantly, The post has gone viral.';
    expect(normalizeProseTypography(splice)).toBe(splice);
  });
});

describe('normalizeBeatTypography', () => {
  it('normalizes text, setupText, and variants in place', () => {
    const beat = {
      text: "The message reads: 'Hello. '.",
      setupText: "A note: 'Run. '.",
      textVariants: [{ text: "'Wait. '." }],
    };
    normalizeBeatTypography(beat);
    expect(beat.text).toBe("The message reads: 'Hello.'");
    expect(beat.setupText).toBe("A note: 'Run.'");
    expect(beat.textVariants[0].text).toBe("'Wait.'");
  });
});
