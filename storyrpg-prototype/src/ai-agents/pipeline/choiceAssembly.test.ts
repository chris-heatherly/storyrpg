import { describe, expect, it } from 'vitest';
import {
  assembleChoiceForStory,
  foldTintFlagIntoConsequences,
  normalizeConsequence,
  normalizeConsequences,
  routeFallbackChoicesAcrossTargets,
} from './choiceAssembly';

describe('routeFallbackChoicesAcrossTargets (branch-point recovery)', () => {
  it('routes each choice to a distinct target so every leadsTo target is reached', () => {
    const out = routeFallbackChoicesAcrossTargets<{ id: string; nextSceneId?: string }>(
      [{ id: 'c1' }, { id: 'c2' }],
      ['s3-2', 's3-3'],
      'beat-x',
    );
    expect(out.map((c) => c.nextSceneId)).toEqual(['s3-2', 's3-3']);
    // every target is reached by ≥1 choice (the gate's requirement)
    expect(new Set(out.map((c) => c.nextSceneId))).toEqual(new Set(['s3-2', 's3-3']));
  });

  it('pads when there are more targets than base choices, with stable ids', () => {
    const out = routeFallbackChoicesAcrossTargets<{ id: string; nextSceneId?: string }>([{ id: 'c1' }], ['a', 'b', 'c'], 'beat-x');
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.nextSceneId)).toEqual(['a', 'b', 'c']);
    expect(out[1].id).toBe('beat-x-fallback-choice-2');
    expect(out[2].id).toBe('beat-x-fallback-choice-3');
  });

  it('round-robins when there are more choices than targets (all targets still covered)', () => {
    const out = routeFallbackChoicesAcrossTargets<{ id: string; nextSceneId?: string }>([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], ['a', 'b'], 'beat-x');
    expect(out.map((c) => c.nextSceneId)).toEqual(['a', 'b', 'a']);
  });

  it('is a no-op clone when there are no targets', () => {
    const base = [{ id: 'c1', nextSceneId: 'keep' }];
    const out = routeFallbackChoicesAcrossTargets<{ id: string; nextSceneId?: string }>(base, [], 'beat-x');
    expect(out).toEqual(base);
    expect(out).not.toBe(base); // returns a copy, does not mutate input
  });
});

describe('foldTintFlagIntoConsequences (D1)', () => {
  it('adds the tintFlag as a setFlag consequence', () => {
    const out = foldTintFlagIntoConsequences([], 'tint:honest')!;
    expect(out).toEqual([{ type: 'setFlag', flag: 'tint:honest', value: true }]);
  });
  it('does not duplicate an already-present flag', () => {
    const out = foldTintFlagIntoConsequences([{ type: 'setFlag', flag: 'tint:honest', value: true } as any], 'tint:honest')!;
    expect(out).toHaveLength(1);
  });
  it('is a no-op without a tintFlag', () => {
    expect(foldTintFlagIntoConsequences(undefined, undefined)).toBeUndefined();
  });
  it('assembleChoiceForStory folds tintFlag into consequences', () => {
    const assembled = assembleChoiceForStory({ id: 'c', text: 't', choiceType: 'expression', consequences: [], tintFlag: 'tint:control' } as any);
    expect(assembled.consequences).toContainEqual({ type: 'setFlag', flag: 'tint:control', value: true });
  });
});

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
