import { describe, expect, it } from 'vitest';
import { collectEncounterParticipantRefs, encounterCastFromStructure, filterProtagonistEncounterRefs } from './encounterParticipants';

describe('encounterCastFromStructure (D3)', () => {
  it('returns the npcStates roster, deduped and trimmed', () => {
    expect(encounterCastFromStructure({
      npcStates: [
        { npcId: 'char-attacker' },
        { npcId: ' char-stranger ' },
        { npcId: 'char-attacker' },
        { npcId: '' },
      ],
    })).toEqual(['char-attacker', 'char-stranger']);
  });

  it('returns undefined when there is no roster so callers keep their fallback', () => {
    expect(encounterCastFromStructure(undefined)).toBeUndefined();
    expect(encounterCastFromStructure({})).toBeUndefined();
    expect(encounterCastFromStructure({ npcStates: [] })).toBeUndefined();
    expect(encounterCastFromStructure({ npcStates: [{ npcId: '  ' }] })).toBeUndefined();
  });
});

describe('collectEncounterParticipantRefs', () => {
  it('unions blueprint and planned participant surfaces', () => {
    expect(collectEncounterParticipantRefs(
      { encounterRequiredNpcIds: ['a'], npcsPresent: ['b'], encounter: { npcsInvolved: ['c'] } },
      { npcsInvolved: ['d'] },
    ).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('filterProtagonistEncounterRefs', () => {
  it('drops the protagonist by id, full name, or first name', () => {
    expect(filterProtagonistEncounterRefs(
      ['kylie', 'char-kylie', 'Kylie Quinn', 'char-stela'],
      { id: 'char-kylie', name: 'Kylie Quinn' },
    )).toEqual(['char-stela']);
  });
});
