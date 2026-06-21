import { describe, expect, it } from 'vitest';
import type { RelationshipPacingContract } from '../../types/scenePlan';
import { RelationshipPacingValidator } from './RelationshipPacingValidator';

function contract(overrides: Partial<RelationshipPacingContract> = {}): RelationshipPacingContract {
  return {
    id: 's1-1-rel-mika',
    source: 'treatment',
    npcId: 'mika',
    startStage: 'unmet',
    targetStage: 'spark',
    allowedLabels: ['spark', 'connection', 'invitation'],
    blockedLabels: ['friend', 'trusted ally', 'inner circle'],
    requiredEvidence: ['show behavior before naming the bond'],
    minScenesSinceIntroduction: 1,
    maxDeltaThisScene: 6,
    mechanicDimensions: ['trust', 'affection'],
    ...overrides,
  };
}

function beat(id: string, text: string, extra: Record<string, unknown> = {}): any {
  return { id, text, ...extra };
}

function scene(id: string, text: string, pacing: RelationshipPacingContract[] = [], extra: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    startingBeatId: `${id}-b1`,
    beats: [beat(`${id}-b1`, text)],
    relationshipPacing: pacing,
    ...extra,
  };
}

function story(scenes: any[]): any {
  return {
    id: 'story',
    title: 'Story',
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      scenes,
      startingSceneId: scenes[0]?.id,
    }],
    npcs: [{ id: 'mika', name: 'Mika' }],
  };
}

const validator = new RelationshipPacingValidator();

describe('RelationshipPacingValidator', () => {
  it('fails when narration declares friendship on a first meeting', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika hands you the key card. By the door, she is already your friend.', [contract()]),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.severity === 'error' && issue.message.includes('unearned relationship label'))).toBe(true);
  });

  it('fails when Dusk Club is treated as settled membership too early', () => {
    const result = validator.validate({
      story: story([
        scene('s1-2', 'Stela presses rose quartz into your palm. The Dusk Club is now three.', [
          contract({
            id: 's1-2-rel-dusk-club',
            npcId: undefined,
            groupId: 'dusk-club',
            allowedLabels: ['invitation', 'dare', 'provisional name'],
            blockedLabels: ['inner circle', 'one of us', 'friends now'],
          }),
        ]),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('settled group membership'))).toBe(true);
  });

  it('passes instant chemistry expressed as behavior and provisional invitation', () => {
    const result = validator.validate({
      story: story([
        scene(
          's1-1',
          'Mika notices the shoes first. Her smile cuts sideways, testing and amused, and she offers the key card like an invitation you have not earned yet.',
          [contract()],
        ),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
  });

  it('passes earned friendship after prior scenes and relationship movement', () => {
    const earned = contract({
      id: 's1-3-rel-mika',
      source: 'planner',
      startStage: 'tentative_ally',
      targetStage: 'friend',
      allowedLabels: ['friend'],
      blockedLabels: ['best friend', 'family', 'trusts completely'],
      minScenesSinceIntroduction: 2,
      maxDeltaThisScene: 10,
    });
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika tests your answer and lets you keep the card.', [], {
          beats: [beat('s1-1-b1', 'Mika tests your answer.', {
            choices: [{ id: 'c1', text: 'Answer honestly', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 6 }] }],
          })],
        }),
        scene('s1-2', 'She remembers the joke and waits when she could leave.', [], {
          beats: [beat('s1-2-b1', 'She remembers the joke.', {
            choices: [{ id: 'c2', text: 'Let her help', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'affection', change: 6 }] }],
          })],
        }),
        scene('s1-3', 'After two nights of tests and favors, Mika calls herself your friend and makes it sound like a dare.', [earned]),
      ]),
    });

    expect(result.valid).toBe(true);
  });

  it('flags relationship deltas above the pacing cap', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika offers a key card.', [contract()], {
          beats: [beat('s1-1-b1', 'Mika offers a key card.', {
            choices: [{ id: 'c1', text: 'Trust her', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 20 }] }],
          })],
        }),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('above this scene'))).toBe(true);
  });

  it('flags relationship-gated choices that prior consequences cannot reach', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika offers a key card.', [contract()], {
          beats: [beat('s1-1-b1', 'Mika offers a key card.', {
            choices: [{
              id: 'c1',
              text: 'Ask Mika to trust you completely',
              conditions: { type: 'relationship', npcId: 'mika', dimension: 'trust', operator: '>=', value: 20 },
              consequences: [],
            }],
          })],
        }),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Relationship-gated choice'))).toBe(true);
  });
});
