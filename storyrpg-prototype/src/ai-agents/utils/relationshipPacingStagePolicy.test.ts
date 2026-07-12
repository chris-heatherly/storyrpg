import { describe, expect, it } from 'vitest';
import {
  ensureGroupFormationPacingContracts,
  normalizeRelationshipPacingStages,
} from './relationshipPacingStagePolicy';

describe('relationshipPacingStagePolicy', () => {
  it('synthesizes a spark-capped group contract when a scene stages a named-group founding with no contracts (bite-me 2026-07-03 vacuous pass)', () => {
    const scenes = [{
      id: 's1-2',
      dramaticPurpose: 'Kylie forms the Dusk Club with Mika and Stela over velvet booths.',
      relationshipPacing: [] as never[],
    }];

    const added = ensureGroupFormationPacingContracts(scenes as never);

    expect(added).toBe(1);
    const contract = (scenes[0].relationshipPacing as Array<{ groupId?: string; targetStage?: string; blockedLabels?: string[] }>)[0];
    expect(contract.groupId).toBe('dusk-club');
    expect(contract.targetStage).toBe('spark');
    expect(contract.blockedLabels).toContain('settled membership');
  });

  it('does not mistake a venue mention for a group founding', () => {
    const scenes = [{
      id: 's1-3',
      dramaticPurpose: 'Kylie meets Mika at the Vâlcescu Club and watches the crowd.',
      relationshipPacing: [] as never[],
    }];

    expect(ensureGroupFormationPacingContracts(scenes as never)).toBe(0);
    expect(scenes[0].relationshipPacing).toHaveLength(0);
  });

  it('does not inherit group formation from a stale source label after canonical turn projection', () => {
    const scenes = [{
      id: 's1-5',
      title: 'The three become friends and form the Dusk Club.',
      turnContract: {
        centralTurn: 'At a rooftop bar Kylie catches the attention of two strangers.',
        turnEvent: 'The strangers notice Kylie across the rooftop bar.',
      },
      requiredBeats: [{ mustDepict: 'The strangers notice Kylie across the rooftop bar.' }],
      relationshipPacing: [] as never[],
    }];

    expect(ensureGroupFormationPacingContracts(scenes as never)).toBe(0);
    expect(scenes[0].relationshipPacing).toHaveLength(0);
  });

  it('does not duplicate an existing group contract for the same group', () => {
    const scenes = [{
      id: 's1-2',
      dramaticPurpose: 'She names the Dusk Club with her new friends.',
      relationshipPacing: [{
        id: 'group-1',
        source: 'treatment' as const,
        groupId: 'dusk-club',
        startStage: 'noticed' as const,
        targetStage: 'spark' as const,
        allowedLabels: ['joke'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 1,
        maxDeltaThisScene: 6,
        mechanicDimensions: ['trust' as const],
      }],
    }];

    expect(ensureGroupFormationPacingContracts(scenes)).toBe(0);
    expect(scenes[0].relationshipPacing).toHaveLength(1);
  });

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

  it('does not treat a generic relationship choice as group-defining', () => {
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

    expect(scenes[0].relationshipPacing[0].targetStage).toBe('spark');
    expect(scenes[0].relationshipPacing[0].allowedLabels).toContain('joke');
  });
});
