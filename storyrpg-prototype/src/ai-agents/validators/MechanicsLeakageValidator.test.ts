import { describe, expect, it } from 'vitest';
import { MechanicsLeakageValidator } from './MechanicsLeakageValidator';

describe('MechanicsLeakageValidator', () => {
  it('flags dice, thresholds, stat deltas, and probabilities in player-facing prose', () => {
    const result = new MechanicsLeakageValidator().validate({
      texts: [
        { id: 'b1', text: 'You roll a d20 and succeed.' },  // RPG dice — should flag
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

  it('does not false-positive on ordinary uses of "build", "bonus", "modifier", "roll"', () => {
    const result = new MechanicsLeakageValidator().validate({
      texts: [
        // Regression: "build" as a verb hard-failed a real story's final contract.
        { id: 'b1', text: 'You watch, with the authority of centuries spent watching mortals build and fall.' },
        { id: 'b2', text: 'A welcome bonus from the king arrived with the dawn.' },
        { id: 'b3', text: 'She works to build trust with the wary villagers.' },
        // Regression: "roll" as a physical action verb hard-failed a real story.
        { id: 'b4', text: "Aethavyr's arms close around Lysandra as they roll to safety." },
        { id: 'b5', text: 'Together you rolled away before the floor collapsed.' },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('still flags genuine die-result language despite the action-verb carve-out', () => {
    const result = new MechanicsLeakageValidator().validate({
      texts: [
        { id: 'b1', text: 'You roll a 17 on the check and shove the door open.' },
        { id: 'b2', text: 'She rolled a 4 and the rope slipped.' },
        { id: 'b3', text: 'Roll under 12 to slip past unseen.' },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.leaksFound).toBeGreaterThanOrEqual(3);
  });

  it('still flags genuine RPG optimization terms', () => {
    const result = new MechanicsLeakageValidator().validate({
      texts: [
        { id: 'b1', text: 'Respec your character build for the boss.' },
        { id: 'b2', text: 'That grants a stat bonus to your next attempt.' },
        { id: 'b3', text: 'The skill modifier applies before the check.' },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.leaksFound).toBeGreaterThanOrEqual(3);
  });
});
