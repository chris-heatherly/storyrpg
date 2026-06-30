import { describe, it, expect } from 'vitest';
import { isSustainedSetPiece } from './sustainedEncounter';

describe('isSustainedSetPiece', () => {
  it('detects the Endsong siege intent', () => {
    expect(isSustainedSetPiece('The Siege Grinds — Wall Breach and Repulse')).toBe(true);
    expect(isSustainedSetPiece('a sustained defensive set piece culminating in evacuation')).toBe(true);
    expect(isSustainedSetPiece(undefined, 'wave after wave of raiders hit the gate')).toBe(true);
  });

  it('does not fire on an ordinary single-decision encounter', () => {
    expect(isSustainedSetPiece('A tense rooftop conversation', 'Kylie meets the stranger')).toBe(false);
    expect(isSustainedSetPiece('Negotiate with the broker')).toBe(false);
  });

  it('ignores empty/nullish fragments', () => {
    expect(isSustainedSetPiece(undefined, null, '')).toBe(false);
  });
});
