import { describe, expect, it } from 'vitest';
import {
  assembleChoiceForStory,
  normalizeConsequence,
  normalizeConsequences,
} from './choiceAssembly';

describe('choice assembly preservation', () => {
  it('normalizes relationshipType and aspect relationship aliases to dimension', () => {
    expect(normalizeConsequence({
      type: 'relationship',
      npcId: 'mika',
      relationshipType: 'affection',
      change: 8,
    } as any)).toMatchObject({
      type: 'relationship',
      npcId: 'mika',
      dimension: 'affection',
      relationshipType: 'affection',
      change: 8,
    });

    expect(normalizeConsequence({
      type: 'relationship',
      npcId: 'stela',
      aspect: 'trust',
      change: -10,
    } as any)).toMatchObject({
      type: 'relationship',
      npcId: 'stela',
      dimension: 'trust',
      aspect: 'trust',
      change: -10,
    });
  });

  it('keeps canonical relationship dimensions unchanged', () => {
    expect(normalizeConsequences([
      {
        type: 'relationship',
        npcId: 'radu',
        dimension: 'respect',
        change: 2,
      } as any,
    ])).toEqual([
      {
        type: 'relationship',
        npcId: 'radu',
        dimension: 'respect',
        change: 2,
      },
    ]);
  });

  it('preserves full mechanical storytelling choice metadata during assembly', () => {
    const assembled = assembleChoiceForStory({
      id: 'choice-pressure',
      text: 'Pressure the witness.',
      choiceType: 'strategic',
      choiceIntent: 'blind',
      impactFactors: ['information', 'relationship'],
      consequenceTier: 'sceneTint',
      stakes: {
        want: 'learn who paid her',
        cost: 'make fear the price of truth',
        identity: 'someone who treats panic as leverage',
      },
      conditions: { type: 'item', itemId: 'black-card', hasItem: true },
      showWhenLocked: true,
      lockedText: 'You need proof before this will work.',
      statCheck: { skillWeights: { intimidation: 1 }, difficulty: 55 },
      consequenceDomain: 'information',
      storyVerb: 'pressure',
      affordanceSource: 'item',
      reminderPlan: {
        immediate: 'The room hears how you got there.',
        shortTerm: 'Mara keeps more distance.',
      },
      feedbackCue: {
        echoSummary: 'You turned fear into leverage.',
        progressSummary: 'This changes who feels safe around you.',
      },
      moralContract: {
        valueA: 'truth',
        valueB: 'safety',
        unavoidableCost: 'Someone loses trust.',
        benefits: ['kylie'],
        harms: ['witness'],
        uncertainty: 'The cost may arrive later.',
      },
      residueHints: [{
        kind: 'relationship_behavior',
        description: 'Mara becomes colder.',
        targetNpcId: 'mara',
      }],
      witnessReactions: [{
        npcId: 'mara',
        stance: 'questions',
        reactionText: 'Mara lets her hand fall from your sleeve.',
      }],
      failureResidue: {
        kind: 'lost_leverage',
        description: 'The courier gains time.',
      },
      visualResidueHint: 'Mara stands farther away next time.',
      consequences: [{
        type: 'relationship',
        npcId: 'mara',
        aspect: 'trust',
        change: -5,
      } as any],
      delayedConsequences: [{
        consequence: {
          type: 'relationship',
          npcId: 'mara',
          relationshipType: 'respect',
          change: -3,
        } as any,
        description: 'Mara later questions the pressure tactic.',
      }],
      nextSceneId: 'scene-4',
      nextBeatId: 'beat-payoff',
      outcomeTexts: {
        success: 'She names the courier.',
        partial: 'She names him, but loudly.',
        failure: 'She shuts down and suspicion spreads.',
      },
      reactionText: 'The silence afterward feels earned and ugly.',
      tintFlag: 'tint:ruthless',
      memorableMoment: {
        id: 'pressured-witness',
        summary: 'You pressured the witness.',
        flags: ['pressed-witness'],
      },
    } as any, 'scene-corrected');

    expect(assembled).toMatchObject({
      choiceType: 'strategic',
      choiceIntent: 'blind',
      impactFactors: ['information', 'relationship'],
      consequenceTier: 'sceneTint',
      storyVerb: 'pressure',
      affordanceSource: 'item',
      witnessReactions: [expect.objectContaining({ npcId: 'mara' })],
      failureResidue: { kind: 'lost_leverage' },
      visualResidueHint: 'Mara stands farther away next time.',
      nextSceneId: 'scene-corrected',
      outcomeTexts: {
        success: 'She names the courier.',
        partial: 'She names him, but loudly.',
        failure: 'She shuts down and suspicion spreads.',
      },
      memorableMoment: { id: 'pressured-witness' },
    });
    expect(assembled.consequences?.[0]).toMatchObject({ dimension: 'trust' });
    expect(assembled.delayedConsequences?.[0].consequence).toMatchObject({ dimension: 'respect' });
  });
});
