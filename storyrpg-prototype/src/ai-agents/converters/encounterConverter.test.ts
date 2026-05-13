import { describe, expect, it } from 'vitest';
import { convertEncounterStructureToEncounter } from './encounterConverter';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneBlueprint } from '../agents/StoryArchitect';

function createSceneBlueprint(): SceneBlueprint {
  return {
    id: 'scene-1',
    name: 'Moonlit Confession',
    description: 'A charged confrontation on the balcony.',
    mood: 'tense',
    purpose: 'relationship escalation',
    leadsTo: ['scene-2', 'scene-3'],
    isEncounter: true,
    encounterType: 'romantic',
    encounterStyle: 'romantic',
    encounterDescription: 'A confession that could change the relationship forever.',
    encounterDifficulty: 'moderate',
    beats: [],
  } as any;
}

describe('encounterConverter', () => {
  it('preserves partialVictory, style, and authored visual contracts', () => {
    const structure = {
      sceneId: 'scene-1',
      encounterType: 'romantic',
      encounterStyle: 'romantic',
      startingBeatId: 'beat-1',
      goalClock: { name: 'Trust', segments: 4, description: 'Build trust' },
      threatClock: { name: 'Distance', segments: 4, description: 'Emotional collapse' },
      stakes: { victory: 'Mutual understanding', defeat: 'The relationship fractures' },
      storyboard: {
        spine: [
          {
            id: 'sb-commit',
            role: 'commit',
            title: 'Commit',
            purpose: 'Confession decision window.',
            visualMoment: 'They stand close enough to speak honestly.',
            tacticalFunction: 'Truth can alter relationship pressure and cost.',
            emotionalState: 'vulnerable',
            continuityState: { relationshipDistance: 'near but guarded' },
            decisionWindow: true,
          },
        ],
        styleNotes: 'Romantic encounter uses gaze, hesitation, consent, vulnerability, and emotional risk.',
        convergencePlan: 'Different confession outcomes converge into aftermath.',
        mechanicsVisibility: 'current_clocks_only',
      },
      payoffContext: {
        relationshipPayoffs: [{ npcId: 'lover', dimension: 'trust', effect: 'Trust changes the confession.' }],
        aftermathEchoes: ['The earlier promise is remembered.'],
      },
      tensionCurve: [],
      beats: [
        {
          id: 'beat-1',
          phase: 'setup',
          storyboardFrameId: 'sb-commit',
          storyboardRole: 'commit',
          name: 'Opening distance',
          description: 'They hesitate before speaking.',
          setupText: 'Rain beads on the railing as they decide whether to speak honestly.',
          visualContract: {
            visualMoment: 'Two people on the edge of confession.',
            shotDescription: 'close two-shot with guarded space between them',
          },
          choices: [
            {
              id: 'choice-1',
              text: 'Tell the truth.',
              approach: 'vulnerable',
              primarySkill: 'empathy',
              outcomes: {
                success: {
                  tier: 'success',
                  narrativeText: 'The truth lands and their posture softens.',
                  goalTicks: 2,
                  threatTicks: 0,
                  encounterOutcome: 'partial_victory' as any,
                  cost: {
                    domain: 'relationship',
                    severity: 'major',
                    whoPays: 'relationship',
                    immediateEffect: 'Trust is restored, but the confession still stings.',
                    visibleComplication: 'They cannot quite meet each other\'s eyes.',
                    lingeringEffect: 'The bond is warmer but more fragile.',
                  },
                  visualContract: {
                    visualMoment: 'The confession lands, but the cost is visible.',
                    keyExpression: 'relief mixed with fear',
                    visibleCost: 'They cannot quite meet each other\'s eyes.',
                  },
                  tacticalEffect: 'Relationship pressure softens but visible cost increases.',
                },
                complicated: {
                  tier: 'complicated',
                  narrativeText: 'The truth creates a fragile opening.',
                  goalTicks: 1,
                  threatTicks: 1,
                },
                failure: {
                  tier: 'failure',
                  narrativeText: 'The moment closes down.',
                  goalTicks: 0,
                  threatTicks: 2,
                  encounterOutcome: 'defeat',
                },
              },
            },
          ],
        } as any,
      ],
      storylets: {
        victory: {
          id: 'storylet-victory',
          name: 'Afterglow',
          triggerOutcome: 'victory',
          tone: 'triumphant',
          narrativeFunction: 'Show the relief after honesty.',
          startingBeatId: 'sv-1',
          consequences: [],
          beats: [
            {
              id: 'sv-1',
              text: 'They finally breathe again.',
              isTerminal: true,
              visualContract: { visualMoment: 'Aftermath relief.' },
            },
          ],
        },
        partialVictory: {
          id: 'storylet-partial',
          name: 'Costly honesty',
          triggerOutcome: 'partialVictory',
          tone: 'bittersweet',
          narrativeFunction: 'Success with visible emotional cost.',
          cost: {
            domain: 'relationship',
            severity: 'major',
            whoPays: 'relationship',
            immediateEffect: 'The truth helps, but it leaves both of them raw.',
            visibleComplication: 'They stand closer, but with wounded caution.',
          } as any,
          startingBeatId: 'sp-1',
          consequences: [],
          beats: [
            {
              id: 'sp-1',
              text: 'They are closer, but not unhurt.',
              isTerminal: true,
              visualContract: { visualMoment: 'Bittersweet aftermath.', visibleCost: 'They stand closer, but with wounded caution.' },
            },
          ],
        },
        defeat: {
          id: 'storylet-defeat',
          name: 'Silence',
          triggerOutcome: 'defeat',
          tone: 'somber',
          narrativeFunction: 'Show the setback.',
          startingBeatId: 'sd-1',
          consequences: [],
          beats: [{ id: 'sd-1', text: 'Silence wins.', isTerminal: true }],
        },
      },
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

    const encounter = convertEncounterStructureToEncounter(structure as unknown as EncounterStructure, createSceneBlueprint());

    expect(encounter.type).toBe('romantic');
    expect(encounter.style).toBe('romantic');
    const firstBeat = encounter.phases[0].beats[0] as any;
    expect(firstBeat.visualContract?.visualMoment).toBe('Two people on the edge of confession.');
    expect(firstBeat.storyboardFrameId).toBe('sb-commit');
    expect(firstBeat.storyboardRole).toBe('commit');
    expect(firstBeat.choices[0].outcomes.success.encounterOutcome).toBe('partialVictory');
    expect(firstBeat.choices[0].outcomes.success.tacticalEffect).toContain('Relationship pressure');
    expect(firstBeat.choices[0].outcomes.success.visualContract?.keyExpression).toBe('relief mixed with fear');
    expect(firstBeat.choices[0].outcomes.success.cost?.visibleComplication).toBe('They cannot quite meet each other\'s eyes.');
    expect(encounter.storylets?.partialVictory?.beats[0].visualContract?.visualMoment).toBe('Bittersweet aftermath.');
    expect(encounter.outcomes.partialVictory?.cost?.domain).toBe('relationship');
    expect(encounter.outcomes.partialVictory?.cost?.visibleComplication).toBe('They stand closer, but with wounded caution.');
    expect(encounter.storyboard?.mechanicsVisibility).toBe('current_clocks_only');
    expect(encounter.payoffContext?.relationshipPayoffs?.[0].npcId).toBe('lover');
  });

  it('migrates prose-only partialVictory storylets into a structured cost payload', () => {
    const structure = {
      sceneId: 'scene-1',
      encounterType: 'dramatic',
      startingBeatId: 'beat-1',
      goalClock: { name: 'Goal', segments: 4, description: 'Goal' },
      threatClock: { name: 'Threat', segments: 4, description: 'Threat' },
      stakes: { victory: 'Win', defeat: 'Lose' },
      tensionCurve: [],
      beats: [],
      storylets: {
        victory: { id: 'v', name: 'v', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: 'Clean win.', startingBeatId: 'v1', consequences: [], beats: [{ id: 'v1', text: 'Victory.', isTerminal: true }] },
        partialVictory: {
          id: 'pv',
          name: 'pv',
          triggerOutcome: 'partialVictory',
          tone: 'bittersweet',
          narrativeFunction: 'The secret is exposed and trust frays even though the objective succeeds.',
          startingBeatId: 'pv1',
          consequences: [],
          beats: [{ id: 'pv1', text: 'You get what you came for, but everyone sees the damage.', isTerminal: true }],
        },
        defeat: { id: 'd', name: 'd', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: 'Loss.', startingBeatId: 'd1', consequences: [], beats: [{ id: 'd1', text: 'Defeat.', isTerminal: true }] },
      },
      environmentalElements: [],
      npcStates: [],
      escalationTriggers: [],
      informationVisibility: { threatClockVisible: true, npcTellsRevealAt: 'immediate', environmentElementsHidden: [], choiceOutcomesUnknown: false },
    } as any;

    const encounter = convertEncounterStructureToEncounter(structure, createSceneBlueprint());

    expect(encounter.outcomes.partialVictory?.cost).toBeDefined();
    expect(encounter.outcomes.partialVictory?.cost?.visibleComplication).toContain('secret is exposed');
    expect(encounter.storylets?.partialVictory?.cost?.immediateEffect).toContain('You get what you came for');
  });

  it('falls back to mixed instead of combat for unknown encounter types', () => {
    const structure = {
      sceneId: 'scene-1',
      encounterType: 'unknown-showdown',
      startingBeatId: 'beat-1',
      goalClock: { name: 'Goal', segments: 4, description: 'Goal' },
      threatClock: { name: 'Threat', segments: 4, description: 'Threat' },
      stakes: { victory: 'Win', defeat: 'Lose' },
      tensionCurve: [],
      beats: [],
      storylets: {
        victory: { id: 'v', name: 'v', triggerOutcome: 'victory', tone: 'triumphant', narrativeFunction: '', startingBeatId: 'v1', consequences: [], beats: [{ id: 'v1', text: 'v', isTerminal: true }] },
        defeat: { id: 'd', name: 'd', triggerOutcome: 'defeat', tone: 'somber', narrativeFunction: '', startingBeatId: 'd1', consequences: [], beats: [{ id: 'd1', text: 'd', isTerminal: true }] },
      },
      environmentalElements: [],
      npcStates: [],
      escalationTriggers: [],
      informationVisibility: { threatClockVisible: true, npcTellsRevealAt: 'immediate', environmentElementsHidden: [], choiceOutcomesUnknown: false },
    } as any as EncounterStructure;

    const encounter = convertEncounterStructureToEncounter(structure, createSceneBlueprint());

    expect(encounter.type).toBe('mixed');
  });
});
