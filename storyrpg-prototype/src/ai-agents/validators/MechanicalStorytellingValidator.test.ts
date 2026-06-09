import { describe, expect, it } from 'vitest';
import { MechanicalStorytellingValidator } from './MechanicalStorytellingValidator';

describe('MechanicalStorytellingValidator', () => {
  it('rejects witness reactions that reference unknown NPCs', () => {
    const result = new MechanicalStorytellingValidator().validate({
      storyNpcs: [{ id: 'mara' }],
      choices: [{
        id: 'pressure-witness',
        text: 'Pressure the witness.',
        choiceType: 'strategic',
        impactFactors: ['information'],
        outcomeTexts: {
          success: 'She answers.',
          partial: 'She answers, but loudly.',
          failure: 'She shuts down and suspicion spreads.',
        },
        statCheck: { skillWeights: { intimidation: 1 }, difficulty: 55 },
        witnessReactions: [{
          npcId: 'unknown',
          stance: 'questions',
          reactionText: 'Someone goes quiet.',
        }],
      }],
    });

    expect(result.valid).toBe(false);
    expect(result.metrics.invalidWitnessReferences).toBe(1);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('unknown NPC');
  });

  it('flags a relationship consequence targeting an unknown NPC ("None")', () => {
    const result = new MechanicalStorytellingValidator().validate({
      storyNpcs: [{ id: 'lysandra_brightwell' }],
      choices: [{
        id: 'reflexive-protect',
        text: 'Step between her and the blade.',
        choiceType: 'relationship',
        impactFactors: ['relationship'],
        outcomeTexts: { success: 'a', partial: 'b', failure: 'c' },
        consequences: [
          { type: 'adjustRelationship', npcId: 'None', dimension: 'affection', delta: 12 } as any,
          { type: 'adjustRelationship', npcId: 'lysandra_brightwell', dimension: 'trust', delta: 8 } as any,
        ],
      }],
    });
    expect(result.metrics.invalidRelationshipReferences).toBe(1);
    expect(result.issues.map((i) => i.message).join('\n')).toContain('targets unknown NPC');
  });

  it('does not flag a relationship consequence whose npcId is in the roster', () => {
    const result = new MechanicalStorytellingValidator().validate({
      storyNpcs: [{ id: 'lysandra_brightwell' }],
      choices: [{
        id: 'open-up',
        text: 'Tell her the truth.',
        choiceType: 'relationship',
        impactFactors: ['relationship'],
        outcomeTexts: { success: 'a', partial: 'b', failure: 'c' },
        consequences: [{ type: 'adjustRelationship', npcId: 'lysandra_brightwell', dimension: 'trust', delta: 6 } as any],
        delayedConsequences: [{ consequence: { type: 'relationship', npcId: 'lysandra_brightwell', dimension: 'affection', change: 3 }, delay: { type: 'scenes', count: 2 } } as any],
      }],
    });
    expect(result.metrics.invalidRelationshipReferences).toBe(0);
  });

  it('warns when stat-check failure has no playable failure signal', () => {
    const result = new MechanicalStorytellingValidator().validate({
      choices: [{
        id: 'try-door',
        text: 'Try the door.',
        choiceType: 'strategic',
        impactFactors: ['process'],
        storyVerb: 'crack',
        statCheck: { skillWeights: { investigation: 1 }, difficulty: 50 },
        outcomeTexts: {
          success: 'The door opens.',
          partial: 'The door opens slowly.',
          failure: 'The door does not open.',
        },
      }],
    });

    expect(result.valid).toBe(true);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('no playable failure signal');
  });

  it('accepts failure residue as playable failure material', () => {
    const result = new MechanicalStorytellingValidator().validate({
      storyNpcs: [{ id: 'mara' }],
      choices: [{
        id: 'pressure-witness',
        text: 'Pressure the witness.',
        choiceType: 'strategic',
        impactFactors: ['information', 'relationship'],
        storyVerb: 'pressure',
        affordanceSource: 'skill',
        statCheck: { skillWeights: { intimidation: 1 }, difficulty: 55 },
        outcomeTexts: {
          success: 'She names the courier.',
          partial: 'She names the courier, but the room hears how you got there.',
          failure: 'She shuts down completely.',
        },
        failureResidue: {
          kind: 'lost_leverage',
          description: 'The witness becomes harder to reach and the courier gains time.',
        },
        witnessReactions: [{
          npcId: 'mara',
          stance: 'questions',
          reactionText: 'Mara lets her hand fall from your sleeve.',
        }],
      }],
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.statChecksWithPlayableFailure).toBe(1);
    expect(result.metrics.choicesWithStoryVerb).toBe(1);
    expect(result.metrics.choicesWithAffordanceSource).toBe(1);
    expect(result.metrics.choicesWithWitnessReactions).toBe(1);
    expect(result.issues.filter((issue) => issue.severity === 'warning')).toEqual([]);
  });

  it('allows conditioned choices when affordance source can be inferred', () => {
    const result = new MechanicalStorytellingValidator().validate({
      choices: [{
        id: 'merciful-answer',
        text: 'Offer mercy anyway.',
        choiceType: 'dilemma',
        impactFactors: ['identity'],
        storyVerb: 'protect',
        conditions: {
          type: 'identity',
          dimension: 'mercy_justice',
          operator: '<',
          value: -20,
        },
        outcomeTexts: {
          success: 'The room softens.',
          partial: 'The room softens, but not everyone follows.',
          failure: 'The room hardens against your mercy and suspicion follows.',
        },
        statCheck: { skillWeights: { persuasion: 1 }, difficulty: 60 },
      }],
    });

    expect(result.valid).toBe(true);
    expect(result.issues.map((issue) => issue.message).join('\n')).not.toContain('no affordanceSource');
  });
});
