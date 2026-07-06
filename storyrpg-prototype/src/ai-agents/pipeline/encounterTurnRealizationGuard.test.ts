import { describe, expect, it } from 'vitest';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import { assessEncounterTurnRealization } from './encounterTurnRealizationGuard';

const CISMIGIU_TURN =
  'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow — and a second figure in a charcoal suit drops the attacker, walks her home, kisses her hand at the threshold, declines to come in, and vanishes.';

function blueprint(overrides: Partial<SceneBlueprint> = {}): SceneBlueprint {
  return {
    id: 'treatment-enc-1-1',
    name: 'Cișmigiu attack',
    description: CISMIGIU_TURN,
    mood: 'dangerous',
    location: 'Cișmigiu Gardens',
    charactersInvolved: ['kylie', 'victor'],
    keyBeats: [],
    choices: [],
    choicePoint: undefined,
    emotionalTone: 'frightened',
    narrativeFunction: 'encounter',
    isEncounter: true,
    encounterType: 'dramatic',
    turnContract: {
      turnId: 'turn-cismigiu',
      source: 'encounter',
      centralTurn: CISMIGIU_TURN,
      beforeState: 'Kylie is walking home alone.',
      turnEvent: CISMIGIU_TURN,
      afterState: 'A rescuer has intervened and vanished.',
      handoff: 'Get Kylie home with residue.',
    },
    requiredBeats: [{
      id: 'bite-me-cismigiu',
      tier: 'authored',
      sourceTurn: CISMIGIU_TURN,
      mustDepict: CISMIGIU_TURN,
    }],
    ...overrides,
  } as unknown as SceneBlueprint;
}

function encounter(extraText = ''): EncounterStructure {
  return {
    sceneId: 'treatment-enc-1-1',
    encounterType: 'dramatic',
    beats: [{
      id: 'beat-1',
      phase: 'setup',
      name: 'Willow',
      setupText: 'At 1am in Cișmigiu, a shadow pins you hard against a willow.',
      choices: [{
        id: 'fight',
        text: 'Fight for air.',
        approach: 'aggressive',
        outcomes: {
          success: {
            tier: 'success',
            goalTicks: 2,
            threatTicks: 0,
            narrativeText: `A second figure in a charcoal suit drops the attacker and walks you home. ${extraText}`,
          },
          complicated: {
            tier: 'complicated',
            goalTicks: 1,
            threatTicks: 1,
            narrativeText: 'The rescuer drops the attacker but says nothing.',
          },
          failure: {
            tier: 'failure',
            goalTicks: 0,
            threatTicks: 2,
            narrativeText: 'The shadow keeps its grip.',
          },
        },
      }],
    }],
    startingBeatId: 'beat-1',
    goalClock: { name: 'Survive', segments: 4, description: 'Get home alive.' },
    threatClock: { name: 'Shadow', segments: 4, description: 'The shadow closes in.' },
    stakes: { victory: 'Kylie survives.', defeat: 'Kylie is marked.' },
    tensionCurve: [],
    environmentalElements: [],
    npcStates: [],
    escalationTriggers: [],
    storylets: {
      victory: {
        id: 'victory',
        title: 'Threshold',
        beats: [{
          id: 'victory-b1',
          text: extraText,
        }],
      },
      defeat: {
        id: 'defeat',
        title: 'Aftermath',
        beats: [{ id: 'defeat-b1', text: 'The park goes quiet.' }],
      },
    },
  } as unknown as EncounterStructure;
}

describe('assessEncounterTurnRealization', () => {
  it('fails when a fresh encounter depicts the attack and rescue but misses the threshold tail', () => {
    const result = assessEncounterTurnRealization(blueprint(), encounter());

    expect(result.passed).toBe(false);
    expect(result.misses[0].label).toBe('scene turn');
    expect(result.misses[0].missingTokens).toEqual(
      expect.arrayContaining(['kisses', 'hand', 'threshold', 'declines']),
    );
  });

  it('passes when the full turn lands across choices, outcomes, and storylets', () => {
    const result = assessEncounterTurnRealization(
      blueprint(),
      encounter('At the threshold, he kisses your hand, declines to come in, and vanishes into the fog.'),
    );

    expect(result.passed).toBe(true);
  });

  it('accepts threshold refusal wording instead of requiring literal decline tokens', () => {
    const result = assessEncounterTurnRealization(
      blueprint(),
      encounter('At the threshold, he kisses your hand. When you ask him inside, he refuses to cross the threshold, then vanishes into the fog.'),
    );

    expect(result.passed).toBe(true);
  });

  it('ignores generic planner turns but still enforces concrete required beats', () => {
    const result = assessEncounterTurnRealization(
      blueprint({
        turnContract: {
          turnId: 'generic',
          source: 'planner',
          centralTurn: 'Let the fallout settle into the next pressure: Kylie is attacked and writes the viral post.',
          beforeState: '',
          turnEvent: '',
          afterState: '',
          handoff: '',
        },
      }),
      encounter(),
    );

    expect(result.passed).toBe(false);
    expect(result.misses.map((miss) => miss.label)).not.toContain('scene turn');
    expect(result.misses.map((miss) => miss.label)).toContain('required beat bite-me-cismigiu');
  });

  it('stays failed for an under-realized encounter so the caller regenerates instead of injecting text', () => {
    const rescueBlueprint = blueprint({
      turnContract: {
        turnId: 'turn-cismigiu',
        source: 'encounter',
        centralTurn: 'Kylie survives the Cișmigiu attack because Victor intervenes.',
        beforeState: 'Kylie is attacked in the park.',
        turnEvent: 'Kylie survives the Cișmigiu attack because Victor intervenes.',
        afterState: 'Victor has saved her.',
        handoff: 'Get Kylie home with residue.',
      },
      requiredBeats: [],
    });
    const underRealized = encounter();
    const before = JSON.stringify(underRealized);

    const result = assessEncounterTurnRealization(rescueBlueprint, underRealized);

    expect(result.passed).toBe(false);
    // Assessment must never mutate the encounter — no deterministic prose injection.
    expect(JSON.stringify(underRealized)).toBe(before);
  });
});
