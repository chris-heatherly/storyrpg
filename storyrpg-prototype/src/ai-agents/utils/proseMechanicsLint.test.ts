import { describe, expect, it } from 'vitest';
import { lintProseMechanics, lintSceneMechanics, mechanicsLintFeedback } from './proseMechanicsLint';

describe('proseMechanicsLint (G8)', () => {
  describe('dialogue comma splice — the run 20-44-49 evidence', () => {
    it('flags "I\'m Stela Pavel, Welcome." inside dialogue', () => {
      const findings = lintProseMechanics('She extends a hand. "I\'m Stela Pavel, Welcome."');
      expect(findings.map((f) => f.code)).toContain('dialogue_comma_splice');
    });

    it('flags "The man you fled, Was he worth…" inside dialogue', () => {
      const findings = lintProseMechanics('"The man you fled, Was he worth the ocean you put between you?"');
      expect(findings.map((f) => f.code)).toContain('dialogue_comma_splice');
    });
  });

  describe('negative controls — precision over recall', () => {
    it('never flags a vocative proper noun ("Yes, Kylie")', () => {
      expect(lintProseMechanics('"Yes, Kylie, I remember you."')).toEqual([]);
    });

    it('never flags a title apposition ("my blog, The Dusk Diaries")', () => {
      expect(lintProseMechanics('"You should read my blog, The Dusk Diaries."')).toEqual([]);
    });

    it('never flags the legitimate fiction splice ", I stayed" (I is always capitalized)', () => {
      expect(lintProseMechanics('"He left, I stayed."')).toEqual([]);
    });

    it('never flags splice-shaped text OUTSIDE dialogue (narration handles its own rhythm)', () => {
      expect(lintProseMechanics('The phone keeps buzzing, You ignore it.').filter((f) => f.code === 'dialogue_comma_splice')).toEqual([]);
    });

    it('never flags a correct comma before lowercase continuation', () => {
      expect(lintProseMechanics('"I fled, was reborn, and never looked back."')).toEqual([]);
    });
  });

  describe('doubled punctuation', () => {
    it('flags doubled commas and doubled periods but not ellipses', () => {
      expect(lintProseMechanics('The night stretches on,, endless.').map((f) => f.code)).toContain('doubled_punctuation');
      expect(lintProseMechanics('It ends here.. or does it?').map((f) => f.code)).toContain('doubled_punctuation');
      expect(lintProseMechanics('She hesitates... then knocks.')).toEqual([]);
    });

    it('flags comma adjacent to period', () => {
      expect(lintProseMechanics('She smiles,. and turns away.').map((f) => f.code)).toContain('adjacent_comma_period');
    });
  });

  describe('malformed honorific punctuation', () => {
    it('flags a comma used where an abbreviated honorific requires a period', () => {
      const findings = lintProseMechanics('The caller ID reads Mr, Midnight.');
      expect(findings.map((finding) => finding.code)).toContain('malformed_honorific_punctuation');
    });

    it('does not flag a correctly punctuated honorific or an ordinary vocative', () => {
      expect(lintProseMechanics('The caller ID reads Mr. Midnight.')).toEqual([]);
      expect(lintProseMechanics('Listen, Midnight, we need to talk.')).toEqual([]);
    });
  });

  describe('scene-level walk + feedback', () => {
    it('collects findings across beat surfaces with beat ids', () => {
      const findings = lintSceneMechanics([
        { id: 'b1', text: '"I\'m Stela Pavel, Welcome."' },
        { id: 'b2', text: 'Clean beat.', textVariants: [{ text: 'A variant,, with a defect.' }] },
      ]);
      expect(findings).toHaveLength(2);
      expect(findings[0]).toMatchObject({ beatId: 'b1', code: 'dialogue_comma_splice', field: 'text' });
      expect(findings[1]).toMatchObject({ beatId: 'b2', code: 'doubled_punctuation', field: 'textVariant' });
    });

    it('feedback names each defect and forbids rewording', () => {
      const findings = lintSceneMechanics([{ id: 'b1', text: '"I\'m Stela Pavel, Welcome."' }]);
      const feedback = mechanicsLintFeedback(findings);
      expect(feedback).toContain('MECHANICS FEEDBACK');
      expect(feedback).toContain('b1');
      expect(feedback).toContain('Stela Pavel, Welcome');
      expect(feedback).toContain('do not reword');
    });
  });
});
