import { describe, expect, it } from 'vitest';
import { normalizeRelationshipPacingStages } from './relationshipPacingStagePolicy';

describe('relationshipPacingStagePolicy', () => {
  it('keeps unearned group identity at spark without a group-defining choice', () => {
    const scenes = [{
      id: 's1',
      relationshipPacing: [{
        id: 'group-1',
        source: 'treatment' as const,
        groupId: 'night-circle',
        startStage: 'unmet' as const,
        targetStage: 'friend' as const,
        allowedLabels: ['friends', 'official circle'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 1,
        maxDeltaThisScene: 6,
        mechanicDimensions: ['trust' as const],
      }],
    }];

    const changed = normalizeRelationshipPacingStages(scenes);

    expect(changed).toBeGreaterThan(0);
    expect(scenes[0].relationshipPacing[0].targetStage).toBe('spark');
    expect(scenes[0].relationshipPacing[0].allowedLabels).toContain('joke');
    expect(scenes[0].relationshipPacing[0].blockedLabels).toContain('official');
    expect(scenes[0].relationshipPacing[0].blockedLabels).toContain('one of us');
  });

  it('caps first group choice movement at acquaintance instead of instant friendship', () => {
    const scenes = [{
      id: 's1',
      choicePoint: { type: 'relationship' },
      relationshipPacing: [{
        id: 'group-1',
        source: 'treatment' as const,
        groupId: 'night-circle',
        startStage: 'spark' as const,
        targetStage: 'trusted_ally' as const,
        allowedLabels: ['trusted allies'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 1,
        maxDeltaThisScene: 6,
        mechanicDimensions: ['trust' as const],
      }],
    }];

    normalizeRelationshipPacingStages(scenes);

    expect(scenes[0].relationshipPacing[0].targetStage).toBe('acquaintance');
    expect(scenes[0].relationshipPacing[0].allowedLabels).toContain('new acquaintance');
  });
});
