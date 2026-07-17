import { describe, expect, it } from 'vitest';
import { auditEarnedBonds } from './earnedBondPreflight';

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
