import { describe, expect, it } from 'vitest';
import { MechanicsLeakageValidator } from './MechanicsLeakageValidator';

describe('MechanicsLeakageValidator', () => {
  it('flags dice, thresholds, stat deltas, and probabilities in player-facing prose', () => {
    const result = new MechanicsLeakageValidator().validate({
      texts: [
        { id: 'b1', text: 'You roll a d20 and succeed.' },
        { id: 'b2', text: 'Trust +10 appears beside her name.' },
        { id: 'b3', text: 'Your skill must be 12 or above.' },
        { id: 'b4', text: 'You have a 65% chance of success.' },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.leaksFound).toBeGreaterThanOrEqual(4);
  });

  it('allows fiction-first risk language', () => {
    const result = new MechanicsLeakageValidator().validate({
      texts: [{
        id: 'b1',
        text: 'Mira studies your face, trying to decide whether courage or panic is carrying your voice.',
      }],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
