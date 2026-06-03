import { describe, expect, it } from 'vitest';
import {
  isCombatCapable,
  capabilityNoteForProfile,
  characterCapabilityWorldFacts,
  capabilityFactStrings,
} from './characterCanonFacts';

const scholar = { id: 'lysandra', name: 'Lysandra', role: 'scholar-noblewoman', traits: ['scholarly', 'cautious'], skills: [{ name: 'lore', level: 80 }] } as any;
const warriorBySkill = { id: 'kael', name: 'Kael', role: 'ally', traits: ['loyal'], skills: [{ name: 'blade combat', level: 70 }] } as any;
const warriorByRole = { id: 'guard', name: 'Guard', role: 'city guard', traits: [], skills: [] } as any;
const warriorByTrait = { id: 'mara', name: 'Mara', role: 'drifter', traits: ['battle-hardened warrior'], skills: [] } as any;

describe('isCombatCapable', () => {
  it('is false for a scholar with no combat signal', () => {
    expect(isCombatCapable(scholar)).toBe(false);
  });
  it('is true when a combat skill with level > 0 exists', () => {
    expect(isCombatCapable(warriorBySkill)).toBe(true);
  });
  it('is true when the role signals combat', () => {
    expect(isCombatCapable(warriorByRole)).toBe(true);
  });
  it('is true when a trait signals combat', () => {
    expect(isCombatCapable(warriorByTrait)).toBe(true);
  });
  it('is false when the combat skill exists but is level 0', () => {
    expect(isCombatCapable({ id: 'x', name: 'X', role: 'clerk', traits: [], skills: [{ name: 'swordplay', level: 0 }] } as any)).toBe(false);
  });
});

describe('capability facts', () => {
  it('emits a no-combat constraint only for non-combatants', () => {
    expect(capabilityNoteForProfile(scholar)).toContain('no formal combat training');
    expect(capabilityNoteForProfile(warriorBySkill)).toBe('');
  });
  it('builds keyed canon world-facts for non-combatants', () => {
    const facts = characterCapabilityWorldFacts([scholar, warriorBySkill]);
    expect(facts).toHaveLength(1);
    expect(facts[0].id).toBe('cap:lysandra:no-combat');
  });
  it('capabilityFactStrings flattens to statements', () => {
    expect(capabilityFactStrings([scholar])[0]).toContain('Lysandra');
  });
});
