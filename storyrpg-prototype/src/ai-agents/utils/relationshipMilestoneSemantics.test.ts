import { describe, expect, it } from 'vitest';
import { choiceEarnsGroupMilestone } from './relationshipMilestoneSemantics';

describe('choiceEarnsGroupMilestone', () => {
  it('matches source member ids to canonical runtime character ids', () => {
    const contract = {
      id: 'relationship:dusk-club',
      source: 'treatment' as const,
      npcId: 'stela',
      groupId: 'dusk-club',
      startStage: 'acquaintance' as const,
      targetStage: 'friend' as const,
      allowedLabels: ['friend'],
      blockedLabels: ['trusted ally'],
      requiredEvidence: ['The three choose one another.'],
      minScenesSinceIntroduction: 1,
      maxDeltaThisScene: 8,
      mechanicDimensions: ['trust' as const],
      milestone: {
        id: 'dusk-club-forms',
        kind: 'group_formation' as const,
        sourceText: 'Kylie becomes friends with Stela and Mika.',
        subjectType: 'group' as const,
        subjectId: 'dusk-club',
        targetStage: 'friend' as const,
        introductionSceneIds: ['s1-2'],
        testSceneIds: ['s1-3'],
        choiceSceneId: 's1-4',
        memberNpcIds: ['stela', 'mika'],
        routeRealizationPolicy: 'all_routes' as const,
        requiredEvidenceTags: ['respected_agency' as const],
      },
    };

    expect(choiceEarnsGroupMilestone({
      choiceType: 'relationship',
      relationshipMilestoneId: 'dusk-club-forms',
      relationshipGroupId: 'dusk-club',
      consequences: [
        { type: 'relationship', npcId: 'char-stela-pavel', dimension: 'trust', change: 1 },
        { type: 'relationship', npcId: 'char-mika-dragan', dimension: 'trust', change: 1 },
      ],
      relationshipValueEvidence: [
        { npcId: 'char-stela-pavel', axis: 'trust', evidenceTags: ['respected_agency'], reason: 'Stela accepts the pact.' },
        { npcId: 'char-mika-dragan', axis: 'trust', evidenceTags: ['respected_agency'], reason: 'Mika accepts the pact.' },
      ],
    }, contract)).toBe(true);
  });
});
