import { describe, expect, it } from 'vitest';
import { applyEarnedBondAutofix, auditEarnedBonds } from './earnedBondPreflight';

describe('auditEarnedBonds (B3)', () => {
  const jump = { npcId: 'stela', startStage: 'spark', targetStage: 'friend', requiredEvidence: [] };

  it('flags a friend+ jump with no staged earning path (the dusk-club shape)', () => {
    const findings = auditEarnedBonds([{
      id: 's1-4',
      relationshipPacing: [{ groupId: 'dusk-club', startStage: 'noticed', targetStage: 'friend' }],
    }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ sceneId: 's1-4', subject: 'dusk-club' });
    expect(findings[0].message).toContain('declared, not earned');
  });

  it('is silent when the scene stages a social_test behavioral intent', () => {
    expect(auditEarnedBonds([{
      id: 's1-4',
      behavioralIntents: [{ kind: 'behavioral_intent', intentKind: 'social_test' }],
      relationshipPacing: [jump],
    }])).toEqual([]);
  });

  it('is silent when a milestone test path or relationship choice exists', () => {
    expect(auditEarnedBonds([{
      id: 's1-4',
      relationshipPacing: [{ ...jump, milestone: { testSceneIds: ['s1-2'] } }],
    }])).toEqual([]);
    expect(auditEarnedBonds([{
      id: 's1-4',
      hasChoice: true,
      choiceType: 'relationship',
      relationshipPacing: [jump],
    }])).toEqual([]);
  });

  it('ignores gradual advancement and sub-friend targets', () => {
    expect(auditEarnedBonds([{
      id: 's1-3',
      relationshipPacing: [
        { npcId: 'stela', startStage: 'tentative_ally', targetStage: 'friend' },
        { npcId: 'mika', startStage: 'unmet', targetStage: 'spark' },
      ],
    }])).toEqual([]);
  });
});

describe('applyEarnedBondAutofix (B3, r115 gap analysis 2026-07-18)', () => {
  it('clamps both r115 s1-4 jumps to one rank above start', () => {
    // Live regression: bite-me-r115_2026-07-18T04-37-51 planned Stela
    // spark→friend and Mika acquaintance→friend at s1-4 with no staged
    // earning path (same shape as the original dusk-club case, recurring).
    const scenes = [{
      id: 's1-4',
      relationshipPacing: [
        { npcId: 'char-stela-pavel', startStage: 'spark', targetStage: 'friend' },
        { npcId: 'char-mika-dragan', startStage: 'acquaintance', targetStage: 'friend' },
      ],
    }];
    const findings = auditEarnedBonds(scenes);
    expect(findings).toHaveLength(2);

    const applied = applyEarnedBondAutofix(findings, scenes);

    expect(applied).toHaveLength(2);
    expect(scenes[0].relationshipPacing[0]).toMatchObject({ npcId: 'char-stela-pavel', startStage: 'spark', targetStage: 'acquaintance' });
    expect(scenes[0].relationshipPacing[1]).toMatchObject({ npcId: 'char-mika-dragan', startStage: 'acquaintance', targetStage: 'tentative_ally' });
    // Re-auditing the clamped scene finds nothing left to flag.
    expect(auditEarnedBonds(scenes)).toEqual([]);
  });

  it('does not touch scenes with no matching finding', () => {
    const scenes = [{ id: 's1-2', relationshipPacing: [{ npcId: 'stela', startStage: 'unmet', targetStage: 'noticed' }] }];
    expect(applyEarnedBondAutofix([], scenes)).toEqual([]);
    expect(scenes[0].relationshipPacing[0].targetStage).toBe('noticed');
  });
});
