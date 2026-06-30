import { describe, expect, it } from 'vitest';
import { reconcileRelationshipPacingWithChoiceTypes } from './relationshipPacingChoiceTypeReconciliation';

describe('reconcileRelationshipPacingWithChoiceTypes', () => {
  it('caps stale choice-sourced relationship pacing after final taxonomy assigns a non-relationship choice', () => {
    const scenes = [{
      id: 'scene-a',
      choicePoint: { type: 'expression' as const },
      relationshipPacing: [{
        id: 'scene-a-rel-circle',
        source: 'choice' as const,
        groupId: 'circle',
        startStage: 'tentative_ally' as const,
        targetStage: 'friend' as const,
        allowedLabels: ['earned circle', 'trusted help'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 0,
        maxDeltaThisScene: 12,
        mechanicDimensions: ['trust' as const],
      }],
    }];

    expect(reconcileRelationshipPacingWithChoiceTypes(scenes)).toBe(1);
    expect(scenes[0].relationshipPacing[0]).toMatchObject({
      source: 'planner',
      startStage: 'acquaintance',
      targetStage: 'acquaintance',
    });
    expect(scenes[0].relationshipPacing[0].allowedLabels).toContain('new acquaintance');
    expect(scenes[0].relationshipPacing[0].blockedLabels).toContain('trusted ally');
  });

  it('leaves relationship choice scenes eligible for relationship advancement', () => {
    const scenes = [{
      id: 'scene-b',
      choicePoint: { type: 'relationship' as const },
      relationshipPacing: [{
        id: 'scene-b-rel-ally',
        source: 'choice' as const,
        npcId: 'ally',
        startStage: 'acquaintance' as const,
        targetStage: 'tentative_ally' as const,
        allowedLabels: ['tentative ally'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 0,
        maxDeltaThisScene: 12,
        mechanicDimensions: ['trust' as const],
      }],
    }];

    expect(reconcileRelationshipPacingWithChoiceTypes(scenes)).toBe(0);
    expect(scenes[0].relationshipPacing[0].targetStage).toBe('tentative_ally');
  });

  it('keeps planner-sourced group pacing provisional even in a relationship choice scene', () => {
    const scenes = [{
      id: 'scene-c',
      choicePoint: { type: 'relationship' as const },
      relationshipPacing: [{
        id: 'scene-c-rel-group',
        source: 'planner' as const,
        groupId: 'new-circle',
        startStage: 'acquaintance' as const,
        targetStage: 'acquaintance' as const,
        allowedLabels: ['tentative group', 'shared ritual'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 0,
        maxDeltaThisScene: 12,
        mechanicDimensions: ['trust' as const],
      }],
    }];

    expect(reconcileRelationshipPacingWithChoiceTypes(scenes)).toBe(1);
    expect(scenes[0].relationshipPacing[0]).toMatchObject({
      startStage: 'spark',
      targetStage: 'spark',
    });
    expect(scenes[0].relationshipPacing[0].allowedLabels).toContain('provisional name');
  });

  it('infers assembled relationship choice scenes from beat choices', () => {
    const scenes = [{
      id: 'scene-d',
      beats: [{
        choices: [{ id: 'c1', choiceType: 'relationship' as const }],
      }],
      relationshipPacing: [{
        id: 'scene-d-rel-ally',
        source: 'choice' as const,
        npcId: 'ally',
        startStage: 'acquaintance' as const,
        targetStage: 'tentative_ally' as const,
        allowedLabels: ['tentative ally'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 0,
        maxDeltaThisScene: 12,
        mechanicDimensions: ['trust' as const],
      }],
    }];

    expect(reconcileRelationshipPacingWithChoiceTypes(scenes)).toBe(0);
    expect(scenes[0].relationshipPacing[0].targetStage).toBe('tentative_ally');
  });
});
