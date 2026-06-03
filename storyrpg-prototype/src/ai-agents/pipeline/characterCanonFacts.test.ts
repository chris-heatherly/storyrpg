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

// Real-shaped fixtures from the Endsong regen: empty skills/traits, archetype only
// in the prose `overview`, generic role.
const paladinByOverview = { id: 'aeth', name: 'Aethavyr', role: 'protagonist', traits: [], skills: [], overview: 'An immortal Lyri\'el paladin whose century of enforced detachment begins to fracture.' } as any;
const warlordAntagonist = { id: 'vraxxan', name: 'Vraxxan', role: 'antagonist', traits: [], skills: [], overview: 'A renegade Xyn\'Taari warlord who engineered the entire war.' } as any;
const scholarByOverview = { id: 'lys2', name: 'Lysandra', role: 'ally', traits: [], skills: [], overview: 'A mortal noblewoman-scholar whose bloodline makes her the Codex\'s living key.' } as any;
const healerByOverview = { id: 'elara', name: 'Elara', role: 'ally', traits: [], skills: [], overview: 'A gentle younger sister — a healer whose captivity rites open the Codex.' } as any;

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

  // Overview-driven discrimination (the audit's real data shape).
  it('reads combat archetype from the overview when skills/traits are empty', () => {
    expect(isCombatCapable(paladinByOverview)).toBe(true);   // "paladin"
  });
  it('treats an antagonist as combat-capable by default', () => {
    expect(isCombatCapable(warlordAntagonist)).toBe(true);   // role antagonist + "warlord"
  });
  it('is false for a non-combatant whose archetype is only in the overview', () => {
    expect(isCombatCapable(scholarByOverview)).toBe(false);  // "scholar"
    expect(isCombatCapable(healerByOverview)).toBe(false);   // "healer"
  });

  // A2 strengthening (audit gaps): protagonist exemption, vocab, weapon-in-attire.
  it('exempts the protagonist even with a non-combat-sounding overview', () => {
    expect(isCombatCapable({ id: 'p', name: 'P', role: 'protagonist', traits: [], skills: [], overview: 'A wandering poet.' } as any)).toBe(true);
  });
  it('reads "Divine Sentinel" archetype (the regen false-positive)', () => {
    expect(isCombatCapable({ id: 'a', name: 'Aethavyr', role: 'ally', traits: [], skills: [], overview: 'An immortal Divine Sentinel.' } as any)).toBe(true);
  });
  it('detects combat vocab in typicalAttire / distinctiveFeatures (fields the scan now reads)', () => {
    expect(isCombatCapable({ id: 's', name: 'Sylvanor', role: 'ally', traits: [], skills: [], overview: 'An elder.', typicalAttire: 'ceremonial robes and a sword at his hip' } as any)).toBe(true);
    expect(isCombatCapable({ id: 's2', name: 'S2', role: 'ally', traits: [], skills: [], overview: 'An elder.', distinctiveFeatures: ['a sworn knight\'s scar', 'silver hair'] } as any)).toBe(true);
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
