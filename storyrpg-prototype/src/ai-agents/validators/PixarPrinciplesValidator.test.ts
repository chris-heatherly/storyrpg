import { describe, expect, it } from 'vitest';
import { PixarPrinciplesValidator } from './PixarPrinciplesValidator';
import type { EncounterStructure } from '../agents/EncounterArchitect';

/**
 * Build a minimal-but-shaped EncounterStructure. The validator only reads
 * `sceneId`, `pixarStakes`, `pixarSurprise`, and `pixarCausality`; the rest of
 * the structure is filled with empty-but-typed scaffolding so the object is a
 * legitimate EncounterStructure rather than `as any`.
 */
function buildEncounter(overrides: Partial<EncounterStructure>): EncounterStructure {
  const base: EncounterStructure = {
    sceneId: 'scene-1',
    encounterType: 'social' as EncounterStructure['encounterType'],
    description: 'You enter a room where every answer changes who holds the leverage.',
    beats: [],
    startingBeatId: 'beat-1',
    goalClock: { name: 'goal', segments: 4, description: 'reach the goal' },
    threatClock: { name: 'threat', segments: 4, description: 'the closing trap' },
    stakes: { victory: 'You win the room.', defeat: 'You are exposed.' },
    tensionCurve: [],
    storylets: {
      victory: {} as EncounterStructure['storylets']['victory'],
      defeat: {} as EncounterStructure['storylets']['defeat'],
    },
    environmentalElements: [],
    npcStates: [],
    escalationTriggers: [],
    informationVisibility: {
      threatClockVisible: true,
      npcTellsRevealAt: 'encounter_50_percent',
      environmentElementsHidden: [],
      choiceOutcomesUnknown: true,
    },
    estimatedDuration: '5 min',
    replayability: 'medium',
    designNotes: '',
  };
  return { ...base, ...overrides };
}

describe('PixarPrinciplesValidator.validateEncounter', () => {
  it('passes a well-formed encounter with stacked odds, stakes, surprise, and clean causality', () => {
    const validator = new PixarPrinciplesValidator();
    const encounter = buildEncounter({
      pixarStakes: {
        initialOddsAgainst: 65,
        whatPlayerLoses: 'The trust of the only ally who believed in them.',
        oddsAgainstNarrative: 'Three guards, one exit, no time.',
        stackedObstacles: ['Locked gate', 'Suspicious captain'],
      },
      pixarSurprise: {
        setup: 'The player expects the captain to be the threat.',
        twist: 'The captain is the one secretly helping them.',
        satisfaction: 'Earlier the captain quietly looked away from the breach.',
      },
      pixarCausality: {
        because: ['The alarm rang because the player tripped the wire.'],
        therefore: ['Therefore the guards converge on the courtyard.'],
      },
    });

    const issues = validator.validateEncounter(encounter, 'scene-1');

    expect(issues).toHaveLength(0);
  });

  it('flags low odds, missing stakes, absent surprise, and a coincidence escape', () => {
    const validator = new PixarPrinciplesValidator();
    const encounter = buildEncounter({
      // initialOddsAgainst < 50 -> odds_not_stacked
      pixarStakes: {
        initialOddsAgainst: 20,
        whatPlayerLoses: '', // empty -> missing_personal_stakes
        oddsAgainstNarrative: '',
        stackedObstacles: [],
      },
      // no pixarSurprise -> no_surprise_element
      pixarCausality: {
        because: [],
        therefore: [],
        // explicit coincidence-escape flag -> coincidence_escape (error)
        noCoincidenceEscapes: false,
      } as unknown as EncounterStructure['pixarCausality'],
    });

    const issues = validator.validateEncounter(encounter, 'scene-1');

    const types = issues.map((i) => i.type);
    expect(types).toContain('odds_not_stacked');
    expect(types).toContain('missing_personal_stakes');
    expect(types).toContain('no_surprise_element');
    expect(types).toContain('coincidence_escape');

    // The coincidence escape is the only error-severity issue (Rule #19, cheating).
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('coincidence_escape');
    expect(errors[0].rule).toBe('19');
    // Location is threaded through from the sceneId argument.
    expect(errors[0].location.sceneId).toBe('scene-1');
  });
});
