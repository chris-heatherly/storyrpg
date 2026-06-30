import { describe, expect, it } from 'vitest';

import type { PlannedScene } from '../../types/scenePlan';
import {
  assignTreatmentFieldContractsToScenes,
  authorFacingInformationMovementText,
  authorFacingTreatmentFieldText,
  buildTreatmentFieldContractsForGuidance,
} from './treatmentFieldContracts';

describe('treatment field information movement sanitation', () => {
  const rawInfoMovement = 'Plant INFO-B (Victor staged the attack and is courting Kylie over the Veronica inheritance — seeded by the too-perfect rescue and the roses/card he could only have prepared in advance); plant INFO-C (the supernatural is real — the attacker dropped "like a coat," the rescue too fast to be human); Scene note: by 6pm it has 80,000 reads.';

  it('keeps the authored source text internally but exposes reader-safe setup surfaces to author prompts', () => {
    const [contract] = buildTreatmentFieldContractsForGuidance(1, {
      informationMovement: rawInfoMovement,
    } as any);

    expect(contract.sourceText).toContain('Victor staged the attack');
    expect(contract.sourceText).toContain('the supernatural is real');

    const safe = authorFacingTreatmentFieldText(contract);
    expect(safe).toContain('too-perfect rescue');
    expect(safe).toContain('the attacker dropped "like a coat,"');
    expect(safe).toContain('80,000 reads');
    expect(safe).not.toContain('Victor staged the attack');
    expect(safe).not.toContain('the supernatural is real');
    expect(safe).not.toContain('INFO-C');
  });

  it('stores sanitized storyPressure for treatment-derived information mechanic pressure', () => {
    const scene = {
      id: 's1',
      order: 1,
      title: 'Attack',
      narrativeRole: 'setup',
      mechanicPressure: [],
    } as unknown as PlannedScene;

    assignTreatmentFieldContractsToScenes(
      { episodeNumber: 1, treatmentGuidance: { informationMovement: rawInfoMovement } as any },
      [scene],
    );

    const pressure = scene.mechanicPressure?.[0]?.storyPressure ?? '';
    expect(pressure).toContain('too-perfect rescue');
    expect(pressure).toContain('80,000 reads');
    expect(pressure).not.toContain('Victor staged the attack');
    expect(pressure).not.toContain('the supernatural is real');
    expect(pressure).not.toContain('INFO-B');
  });

  it('collapses raw ledger planning paragraphs to a generic author-facing instruction', () => {
    expect(authorFacingInformationMovementText('Mystery box collapse: Avoided — the Information Ledger fixes exactly seven planned questions (INFO-A through INFO-G).')).toBe(
      'Preserve the planned information rhythm: plant fair-play evidence now, keep setup oblique, and only confirm answers in their scheduled reveal or payoff scene.',
    );
  });
});
