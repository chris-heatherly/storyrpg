import { describe, expect, it } from 'vitest';
import {
  coerceProtagonistCardToSecondPerson,
  isBlueprintHygieneUnsafeText,
  sanitizeBlueprintText,
} from './blueprintTextHygiene';

describe('coerceProtagonistCardToSecondPerson', () => {
  // Live-run regression: three Story Architect attempts in a row kept
  // "The protagonist wants …" in wantVsNeed and the episode aborted on the
  // BlueprintContractHygiene raw-synopsis-card check.
  it('rewrites the observed live wantVsNeed cards into hygiene-safe second person', () => {
    const cases: Array<[string, string]> = [
      [
        'The protagonist wants a clean final check so the crew can move.',
        'You want a clean final check so the crew can move.',
      ],
      [
        'The protagonist must decide whether to name it before the window opens.',
        'You must decide whether to name it before the window opens.',
      ],
      [
        'The protagonist wants to call the entry a success and move to the next phase.',
        'You want to call the entry a success and move to the next phase.',
      ],
    ];
    for (const [input, expected] of cases) {
      const result = coerceProtagonistCardToSecondPerson(input);
      expect(result.changed).toBe(true);
      expect(result.text).toBe(expected);
      expect(isBlueprintHygieneUnsafeText(result.text)).toBe(false);
    }
  });

  it('conjugates common third-person verbs and possessives', () => {
    expect(coerceProtagonistCardToSecondPerson('the protagonist tries to hide it').text)
      .toBe('you try to hide it');
    expect(coerceProtagonistCardToSecondPerson('The protagonist is exposed and the protagonist has no exit.').text)
      .toBe('You are exposed and you have no exit.');
    expect(coerceProtagonistCardToSecondPerson("The protagonist's fear surfaces.").text)
      .toBe('Your fear surfaces.');
  });

  it('leaves text without protagonist cards untouched', () => {
    const text = 'Victoria weighs the offer while the crew waits.';
    const result = coerceProtagonistCardToSecondPerson(text);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(text);
  });
});

describe('sanitizeBlueprintText register repair', () => {
  it('prefers the content-preserving coercion over the lossy fallback', () => {
    const repaired = sanitizeBlueprintText(
      'The protagonist wants the crew ready to move in nine minutes.',
      'Generic fallback line.',
    );
    expect(repaired).toBe('You want the crew ready to move in nine minutes.');
  });

  it('still falls back when coercion cannot make the text safe', () => {
    const repaired = sanitizeBlueprintText(
      'A quiet scene establishing her desire to belong.',
      'Generic fallback line.',
    );
    expect(repaired).toBe('Generic fallback line.');
  });
});
