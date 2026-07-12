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
      startStage: 'spark',
      targetStage: 'spark',
    });
    expect(scenes[0].relationshipPacing[0].allowedLabels).toContain('provisional name');
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

  it('preserves a compiled group milestone only when an option emits canonical member movement and evidence', () => {
    const milestone = {
      id: 'scene-e-milestone-dusk-club',
      kind: 'group_formation' as const,
      sourceText: 'After testing her, they become friends and form the Dusk Club.',
      subjectType: 'group' as const,
      subjectId: 'dusk-club',
      targetStage: 'friend' as const,
      introductionSceneIds: ['scene-c'],
      testSceneIds: ['scene-d'],
      choiceSceneId: 'scene-e',
      memberNpcIds: ['mika', 'stela'],
      requiredEvidenceTags: ['respected_agency' as const],
    };
    const scenes = [{
      id: 'scene-e',
      choicePoint: { type: 'relationship' as const },
      beats: [{
        choices: [{
          id: 'join',
          text: 'Choose the circle.',
          choiceType: 'relationship' as const,
          relationshipMilestoneId: milestone.id,
          relationshipGroupId: 'dusk-club',
          consequences: [
            { type: 'relationship' as const, npcId: 'mika', dimension: 'trust' as const, change: 4 },
            { type: 'relationship' as const, npcId: 'stela', dimension: 'trust' as const, change: 4 },
          ],
          relationshipValueEvidence: [
            { npcId: 'mika', axis: 'trust' as const, evidenceTags: ['respected_agency' as const], reason: 'Mika leaves the decision to her.' },
            { npcId: 'stela', axis: 'trust' as const, evidenceTags: ['respected_agency' as const], reason: 'Stela accepts her answer.' },
          ],
        }],
      }],
      relationshipPacing: [{
        id: 'scene-e-rel-dusk',
        source: 'treatment' as const,
        groupId: 'dusk-club',
        startStage: 'spark' as const,
        targetStage: 'friend' as const,
        allowedLabels: ['friend'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 1,
        maxDeltaThisScene: 6,
        mechanicDimensions: ['trust' as const],
        milestone,
      }],
    }];

    expect(reconcileRelationshipPacingWithChoiceTypes(scenes)).toBe(1);
    expect(scenes[0].relationshipPacing[0].source).toBe('choice');
    expect(scenes[0].relationshipPacing[0].targetStage).toBe('friend');
  });

  it('keeps a capped group milestone aligned with its provisional pacing stage', () => {
    const milestone = {
      id: 'scene-f-milestone',
      kind: 'group_formation' as const,
      sourceText: 'The three become friends.',
      subjectType: 'group' as const,
      subjectId: 'dusk-club',
      targetStage: 'friend' as const,
      introductionSceneIds: ['scene-a'],
      testSceneIds: ['scene-b'],
      choiceSceneId: 'scene-f',
      memberNpcIds: ['mika'],
      requiredEvidenceTags: ['respected_agency' as const],
    };
    const scenes = [{
      id: 'scene-f',
      choicePoint: { type: 'expression' as const },
      relationshipPacing: [{
        id: 'scene-f-rel-group',
        source: 'choice' as const,
        groupId: 'dusk-club',
        startStage: 'unmet' as const,
        targetStage: 'friend' as const,
        allowedLabels: ['friend'],
        blockedLabels: ['friend'],
        requiredEvidence: [],
        minScenesSinceIntroduction: 1,
        maxDeltaThisScene: 6,
        mechanicDimensions: ['trust' as const],
        milestone,
      }],
    }];

    reconcileRelationshipPacingWithChoiceTypes(scenes);

    expect(scenes[0].relationshipPacing[0].targetStage).toBe('spark');
    expect(scenes[0].relationshipPacing[0].milestone?.targetStage).toBe('spark');
  });
});
