import { describe, expect, it } from 'vitest';
import { toStageableTreatmentMoment } from './stageableTreatmentMoment';
import { evaluateMomentRealization, setRealizationPovContext } from '../remediation/realizationEvaluator';
import { hasDirectTreatmentEventRealization } from '../validators/TreatmentEventLedgerValidator';

describe('toStageableTreatmentMoment', () => {
  it('strips character-dossier register from arrival loglines', () => {
    const stageable = toStageableTreatmentMoment(
      "Kylie Marinescu arrives in Bucharest as a charming, wounded observer with two suitcases, her grandmother's address, and the intent to rebuild after a public breakup",
    );
    expect(stageable.toLowerCase()).toContain('arrives in bucharest');
    expect(stageable.toLowerCase()).toContain('suitcases');
    expect(stageable.toLowerCase()).toContain("grandmother");
    expect(stageable.toLowerCase()).not.toMatch(/charming|wounded observer|intent to rebuild|public breakup/);
  });
});

describe('arrival realization against second-person prose', () => {
  const prose = "You arrive in Bucharest with two suitcases, a crumpled piece of paper bearing your grandmother's old address, and the city's hazy afternoon light in your eyes.";
  const logline = "Kylie Marinescu arrives in Bucharest as a charming, wounded observer with two suitcases, her grandmother's address, and the intent to rebuild after a public breakup";

  it('depicts the dossier logline after stageable reduction', () => {
    setRealizationPovContext({ protagonistAliases: ['Kylie Marinescu', 'Kylie'] });
    try {
      expect(evaluateMomentRealization('RequiredBeatRealizationValidator', logline, prose).depicted).toBe(true);
      expect(hasDirectTreatmentEventRealization(logline, prose)).toBe(true);
    } finally {
      setRealizationPovContext(null);
    }
  });

  it('still fails when arrival is absent', () => {
    setRealizationPovContext({ protagonistAliases: ['Kylie Marinescu', 'Kylie'] });
    try {
      const exploreOnly = 'You wander the Old Town, Lipscani, following the smell of toasted sesame.';
      expect(evaluateMomentRealization('RequiredBeatRealizationValidator', logline, exploreOnly).depicted).toBe(false);
    } finally {
      setRealizationPovContext(null);
    }
  });
});
