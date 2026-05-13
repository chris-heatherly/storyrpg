import { describe, expect, it } from 'vitest';
import { deriveRelationshipStance } from './relationshipStance';

describe('deriveRelationshipStance', () => {
  it('maps high trust, affection, and respect to loyal conspirator', () => {
    const profile = deriveRelationshipStance({
      npcId: 'mara',
      trust: 60,
      affection: 40,
      respect: 35,
      fear: 10,
    });

    expect(profile.stance).toBe('loyal_conspirator');
    expect(profile.visualBlocking).toContain('stands close');
    expect(profile.encounterBehavior).toContain('offers help');
  });

  it('maps respect without trust to respectful rival', () => {
    const profile = deriveRelationshipStance({
      npcId: 'mara',
      trust: 0,
      affection: 0,
      respect: 50,
      fear: 10,
    });

    expect(profile.stance).toBe('respectful_rival');
    expect(profile.dialogueTone).toContain('competitive');
  });

  it('maps strong fear and low trust to wary opponent', () => {
    const profile = deriveRelationshipStance({
      npcId: 'mara',
      trust: -30,
      affection: 0,
      respect: 10,
      fear: 70,
    });

    expect(profile.stance).toBe('wary_opponent');
    expect(profile.callbackPosture).toContain('old injuries');
  });
});
