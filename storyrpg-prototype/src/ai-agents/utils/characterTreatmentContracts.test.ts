import { describe, expect, it } from 'vitest';
import {
  appendOpeningCharacterTreatmentRequiredBeats,
  extractOpeningIdentityAtoms,
} from './characterTreatmentContracts';
import type { PlannedScene } from '../../types/scenePlan';

describe('extractOpeningIdentityAtoms', () => {
  it('pulls occupation, origin city, engagement, and partner name from protagonist brief prose', () => {
    const atoms = extractOpeningIdentityAtoms(
      'A 34-year-old American food writer turned blogger, newly arrived in Bucharest after her engagement to New York restaurateur Daniel Hayes imploded publicly.',
    );
    expect(atoms.some((atom) => /food writer/i.test(atom))).toBe(true);
    expect(atoms).toContain('New York');
    expect(atoms.some((atom) => /Daniel Hayes/i.test(atom))).toBe(true);
    expect(atoms.some((atom) => /engagement/i.test(atom))).toBe(true);
  });
});

describe('appendOpeningCharacterTreatmentRequiredBeats', () => {
  it('atomizes role/wound mustDepict for opening scenes', () => {
    const opening = {
      id: 's1-1',
      episodeNumber: 1,
      order: 0,
      kind: 'standard',
      title: 'Arrival',
      dramaticPurpose: 'Arrive',
      narrativeRole: 'setup',
      locations: ['Bucharest'],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
      requiredBeats: [],
      characterTreatmentContracts: [{
        id: 'role-1',
        source: 'treatment',
        subject: 'protagonist',
        characterName: 'Kylie',
        fieldName: 'Role in the world',
        sourceText: 'A New York food writer fleeing a publicly cancelled engagement to Daniel Hayes.',
        contractKind: 'role_fact',
        requiredRealization: ['final_prose'],
        targetEpisodeNumbers: [1],
        targetSceneIds: ['s1-1'],
        targetEndingIds: [],
        blockingLevel: 'treatment',
      }],
    } as PlannedScene;

    appendOpeningCharacterTreatmentRequiredBeats([opening]);
    const beat = opening.requiredBeats?.[0];
    expect(beat?.tier).toBe('seed');
    expect(beat?.mustDepict).toMatch(/food writer/i);
    expect(beat?.mustDepict).toMatch(/Daniel Hayes|cancelled engagement|New York/i);
    expect(beat?.mustDepict).not.toMatch(/^Establish the protagonist's role/);
  });
});
