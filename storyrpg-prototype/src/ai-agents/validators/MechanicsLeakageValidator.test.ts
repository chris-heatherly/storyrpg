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

  describe('strict mode (opt-in escalation)', () => {
    // INVARIANT: default (strict omitted / false) keeps every leak a 'warning'.
    it('keeps an isolated stat delta a warning by default', () => {
      const result = new MechanicsLeakageValidator().validate({
        texts: [{ id: 'b1', text: 'Trust +10' }],
      });

      expect(result.valid).toBe(false);
      expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
      expect(result.issues.some((i) => i.severity === 'error')).toBe(false);
    });

    it('escalates only the safe isolated stat-delta class to error', () => {
      // Both fixtures are bare, isolated deltas with NO narrative-frame verb, so
      // both are autofix-safe and must escalate under strict mode.
      const result = new MechanicsLeakageValidator().validate({
        texts: [
          { id: 'b1', text: 'Trust +10' },
          { id: 'b2', text: 'Reputation +5' },
        ],
        strict: true,
      });

      expect(result.valid).toBe(false);
      const deltaIssues = result.issues.filter((i) =>
        i.message.includes('numeric stat delta'),
      );
      expect(deltaIssues.length).toBeGreaterThanOrEqual(2);
      expect(deltaIssues.every((i) => i.severity === 'error')).toBe(true);
    });

    it('leaves narrative-framed stat deltas a warning even in strict mode', () => {
      // A frame verb ("appears") means this delta needs regen, not redaction —
      // so it is NOT in the safe class and must stay a warning.
      const result = new MechanicsLeakageValidator().validate({
        texts: [{ id: 'b1', text: 'Trust +10 appears beside her name.' }],
        strict: true,
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.severity === 'error')).toBe(false);
      expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
    });

    it('keeps non-delta leak classes (dice, thresholds, probability) a warning in strict mode', () => {
      const result = new MechanicsLeakageValidator().validate({
        texts: [
          { id: 'b1', text: 'You roll a d20 and succeed.' },
          { id: 'b2', text: 'Your skill must be 12 or above.' },
          { id: 'b3', text: 'You have a 65% chance of success.' },
        ],
        strict: true,
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.severity === 'error')).toBe(false);
      expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
    });

    it('escalates the delta but not co-located non-delta leaks in the same text', () => {
      // "Trust +10" is an isolated safe delta, but the dice phrase in the same
      // beat is not safe — only the delta issue escalates.
      const result = new MechanicsLeakageValidator().validate({
        texts: [{ id: 'b1', text: 'Trust +10\nYou roll a d20 and succeed.' }],
        strict: true,
      });

      const errors = result.issues.filter((i) => i.severity === 'error');
      const warnings = result.issues.filter((i) => i.severity === 'warning');
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain('numeric stat delta');
      expect(warnings.some((i) => i.message.includes('dice language'))).toBe(true);
    });
  });
});
