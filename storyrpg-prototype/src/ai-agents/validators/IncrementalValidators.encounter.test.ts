import { describe, expect, it } from 'vitest';
import { IncrementalEncounterValidator } from './IncrementalValidators';
import type { EncounterStructure } from '../agents/EncounterArchitect';

describe('IncrementalEncounterValidator', () => {
  const partialVictoryCost = {
    domain: 'relationship',
    severity: 'major',
    whoPays: 'relationship',
    immediateEffect: 'The truth lands, but the bond is frayed.',
    visibleComplication: 'They stand close while refusing to touch.',
  } as const;

  it('recurses through branching nextSituation trees and recognizes partialVictory paths', () => {
    const validator = new IncrementalEncounterValidator(['empathy', 'wit']);

    const encounter = {
      sceneId: 'scene-7',
      encounterType: 'dramatic',
      encounterStyle: 'dramatic',
      startingBeatId: 'beat-1',
      goalClock: { name: 'Truth', segments: 4, description: 'Reach the truth' },
      threatClock: { name: 'Rupture', segments: 4, description: 'Relationship collapse' },
      stakes: { victory: 'Truth is spoken', defeat: 'Trust is broken' },
      tensionCurve: [],
      beats: [
        {
          id: 'beat-1',
          phase: 'setup',
          name: 'Confrontation',
          description: 'The accusation hangs in the air.',
          setupText: 'You ask the question neither of you has wanted to hear answered.',
          choices: [
            {
              id: 'choice-1',
              text: 'Push for the truth',
              approach: 'direct',
              primarySkill: 'empathy',
              outcomes: {
                success: {
                  tier: 'success',
                  narrativeText: 'The truth breaks through.',
                  goalTicks: 2,
                  threatTicks: 0,
                  nextSituation: {
                    setupText: 'They finally admit what happened.',
                    choices: [
                      {
                        id: 'choice-1a',
                        text: 'Accept the painful truth',
                        approach: 'steady',
                        primarySkill: 'wit',
                        outcomes: {
                          success: {
                            tier: 'success',
                            narrativeText: 'You hold the connection together.',
                            goalTicks: 2,
                            threatTicks: 1,
                            isTerminal: true,
                            encounterOutcome: 'partialVictory',
                            cost: partialVictoryCost as any,
                            visualContract: { visibleCost: partialVictoryCost.visibleComplication },
                          },
                          complicated: {
                            tier: 'complicated',
                            narrativeText: 'The moment stays fragile.',
                            goalTicks: 1,
                            threatTicks: 1,
                            isTerminal: true,
                            encounterOutcome: 'partialVictory',
                            cost: partialVictoryCost as any,
                            visualContract: { visibleCost: partialVictoryCost.visibleComplication },
                          },
                          failure: {
                            tier: 'failure',
                            narrativeText: 'The conversation collapses.',
                            goalTicks: 0,
                            threatTicks: 2,
                            isTerminal: true,
                            encounterOutcome: 'defeat',
                          },
                        },
                      },
                    ],
                  },
                },
                complicated: {
                  tier: 'complicated',
                  narrativeText: 'They hesitate.',
                  goalTicks: 1,
                  threatTicks: 1,
                  isTerminal: true,
                  encounterOutcome: 'partialVictory',
                  cost: partialVictoryCost as any,
                  visualContract: { visibleCost: partialVictoryCost.visibleComplication },
                },
                failure: {
                  tier: 'failure',
                  narrativeText: 'They shut down completely.',
                  goalTicks: 0,
                  threatTicks: 2,
                  isTerminal: true,
                  encounterOutcome: 'defeat',
                },
              },
            },
          ],
        } as any,
        {
          id: 'beat-2',
          phase: 'resolution',
          name: 'Aftershock',
          description: 'The room holds the consequence.',
          setupText: 'No one can take back what was said.',
          choices: [
            {
              id: 'choice-2',
              text: 'Hold the silence',
              approach: 'steady',
              primarySkill: 'wit',
              outcomes: {
                success: { tier: 'success', narrativeText: 'The silence becomes understanding.', goalTicks: 1, threatTicks: 0, isTerminal: true, encounterOutcome: 'partialVictory', cost: partialVictoryCost as any, visualContract: { visibleCost: partialVictoryCost.visibleComplication } },
                complicated: { tier: 'complicated', narrativeText: 'The silence remains uneasy.', goalTicks: 0, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory', cost: partialVictoryCost as any, visualContract: { visibleCost: partialVictoryCost.visibleComplication } },
                failure: { tier: 'failure', narrativeText: 'The silence hardens into distance.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
          ],
        } as any,
      ],
      storylets: {
        victory: { id: 'v', name: 'v', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: '', startingBeatId: 'v1', consequences: [], beats: [{ id: 'v1', text: 'v', isTerminal: true }] },
        partialVictory: { id: 'pv', name: 'pv', triggerOutcome: 'partialVictory', tone: 'bittersweet', narrativeFunction: '', cost: partialVictoryCost as any, startingBeatId: 'pv1', consequences: [], beats: [{ id: 'pv1', text: 'pv', isTerminal: true, visualContract: { visibleCost: partialVictoryCost.visibleComplication } }] },
        defeat: { id: 'd', name: 'd', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: '', startingBeatId: 'd1', consequences: [], beats: [{ id: 'd1', text: 'd', isTerminal: true }] },
      },
      partialVictoryCost: partialVictoryCost as any,
      environmentalElements: [],
      npcStates: [],
      escalationTriggers: [],
      informationVisibility: {
        threatClockVisible: true,
        npcTellsRevealAt: 'immediate',
        environmentElementsHidden: [],
        choiceOutcomesUnknown: false,
      },
    };

    const result = validator.validateEncounter(encounter as unknown as EncounterStructure);

    expect(result.passed).toBe(true);
    expect(result.hasVictoryPath).toBe(true);
    expect(result.hasPartialVictoryPath).toBe(true);
    expect(result.hasDefeatPath).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects partialVictory paths that lack structured cost and visible-cost contracts', () => {
    const validator = new IncrementalEncounterValidator(['empathy']);

    const encounter = {
      sceneId: 'scene-bad',
      encounterType: 'dramatic',
      startingBeatId: 'beat-1',
      goalClock: { name: 'Goal', segments: 4, description: 'Goal' },
      threatClock: { name: 'Threat', segments: 4, description: 'Threat' },
      stakes: { victory: 'Win', defeat: 'Lose' },
      tensionCurve: [],
      beats: [
        {
          id: 'beat-1',
          phase: 'setup',
          name: 'Bad branch',
          description: 'A weak partial victory.',
          setupText: 'The objective can succeed without any authored price.',
          choices: [{
            id: 'choice-1',
            text: 'Force the issue',
            approach: 'direct',
            primarySkill: 'empathy',
            outcomes: {
              success: { tier: 'success', narrativeText: 'You win, sort of.', goalTicks: 2, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
              complicated: { tier: 'complicated', narrativeText: 'Still a partial success.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
              failure: { tier: 'failure', narrativeText: 'You lose.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
            },
          }],
        } as any,
        {
          id: 'beat-2',
          phase: 'resolution',
          name: 'Fallback',
          description: 'Unused',
          setupText: 'Unused',
          choices: [{
            id: 'choice-2',
            text: 'Leave',
            approach: 'direct',
            outcomes: {
              success: { tier: 'success', narrativeText: 'Leave.', goalTicks: 0, threatTicks: 0, isTerminal: true, encounterOutcome: 'defeat' },
              complicated: { tier: 'complicated', narrativeText: 'Leave.', goalTicks: 0, threatTicks: 0, isTerminal: true, encounterOutcome: 'defeat' },
              failure: { tier: 'failure', narrativeText: 'Leave.', goalTicks: 0, threatTicks: 0, isTerminal: true, encounterOutcome: 'defeat' },
            },
          }],
        } as any,
      ],
      storylets: {
        victory: { id: 'v', name: 'v', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: '', startingBeatId: 'v1', consequences: [], beats: [{ id: 'v1', text: 'v', isTerminal: true }] },
        partialVictory: { id: 'pv', name: 'pv', triggerOutcome: 'partialVictory', tone: 'bittersweet', narrativeFunction: '', startingBeatId: 'pv1', consequences: [], beats: [{ id: 'pv1', text: 'pv', isTerminal: true }] },
        defeat: { id: 'd', name: 'd', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: '', startingBeatId: 'd1', consequences: [], beats: [{ id: 'd1', text: 'd', isTerminal: true }] },
      },
      environmentalElements: [],
      npcStates: [],
      escalationTriggers: [],
      informationVisibility: { threatClockVisible: true, npcTellsRevealAt: 'immediate', environmentElementsHidden: [], choiceOutcomesUnknown: false },
    };

    const result = validator.validateEncounter(encounter as unknown as EncounterStructure);

    expect(result.passed).toBe(false);
    expect(result.issues.some(issue => issue.type === 'invalid_partial_victory')).toBe(true);
  });

  it('warns when relationship-heavy encounters never spend relationship state', () => {
    const validator = new IncrementalEncounterValidator(['empathy']);

    const encounter = {
      sceneId: 'scene-relationship-gap',
      encounterType: 'dramatic',
      startingBeatId: 'beat-1',
      goalClock: { name: 'Reconcile', segments: 4, description: 'Repair the bond' },
      threatClock: { name: 'Rupture', segments: 4, description: 'Break the bond' },
      stakes: { victory: 'You mend things', defeat: 'You lose each other' },
      tensionCurve: [],
      beats: [
        {
          id: 'beat-1',
          phase: 'setup',
          name: 'The argument',
          description: 'An emotional confrontation.',
          setupText: 'You stand across from each other in brittle silence.',
          choices: [
            {
              id: 'choice-1',
              text: 'Speak carefully',
              approach: 'steady',
              primarySkill: 'empathy',
              outcomes: {
                success: { tier: 'success', narrativeText: 'They listen.', goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
                complicated: { tier: 'complicated', narrativeText: 'They waver.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory', cost: partialVictoryCost as any, visualContract: { visibleCost: partialVictoryCost.visibleComplication } },
                failure: { tier: 'failure', narrativeText: 'They shut you out.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
          ],
        } as any,
        {
          id: 'beat-2',
          phase: 'resolution',
          name: 'The answer',
          description: 'The emotional fallout lands.',
          setupText: 'No one says what matters most.',
          choices: [
            {
              id: 'choice-2',
              text: 'Let the silence stand',
              approach: 'steady',
              outcomes: {
                success: { tier: 'success', narrativeText: 'The silence softens.', goalTicks: 1, threatTicks: 0, isTerminal: true, encounterOutcome: 'partialVictory', cost: partialVictoryCost as any, visualContract: { visibleCost: partialVictoryCost.visibleComplication } },
                complicated: { tier: 'complicated', narrativeText: 'The silence hurts.', goalTicks: 0, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory', cost: partialVictoryCost as any, visualContract: { visibleCost: partialVictoryCost.visibleComplication } },
                failure: { tier: 'failure', narrativeText: 'The silence ends it.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
              },
            },
          ],
        } as any,
      ],
      storylets: {
        victory: { id: 'v', name: 'v', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: '', startingBeatId: 'v1', consequences: [], beats: [{ id: 'v1', text: 'v', isTerminal: true }] },
        partialVictory: { id: 'pv', name: 'pv', triggerOutcome: 'partialVictory', tone: 'bittersweet', narrativeFunction: '', cost: partialVictoryCost as any, startingBeatId: 'pv1', consequences: [], beats: [{ id: 'pv1', text: 'pv', isTerminal: true, visualContract: { visibleCost: partialVictoryCost.visibleComplication } }] },
        defeat: { id: 'd', name: 'd', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: '', startingBeatId: 'd1', consequences: [], beats: [{ id: 'd1', text: 'd', isTerminal: true }] },
      },
      partialVictoryCost: partialVictoryCost as any,
      environmentalElements: [],
      npcStates: [{ npcId: 'mara', name: 'Mara', currentDisposition: 'wary' }],
      escalationTriggers: [],
      informationVisibility: { threatClockVisible: true, npcTellsRevealAt: 'immediate', environmentElementsHidden: [], choiceOutcomesUnknown: false },
    };

    const result = validator.validateEncounter(encounter as unknown as EncounterStructure);

    expect(result.issues.some(issue => issue.type === 'missing_relationship_payoff')).toBe(true);
  });
});
