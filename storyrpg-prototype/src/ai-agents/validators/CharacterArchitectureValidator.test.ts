import { describe, expect, it } from 'vitest';

import type { CharacterArchitecture } from '../../types/sourceAnalysis';
import { CharacterArchitectureValidator } from './CharacterArchitectureValidator';

function architecture(overrides: Partial<CharacterArchitecture> = {}): CharacterArchitecture {
  return {
    protagonist: {
      lie: 'Mara believes needing help makes her weak.',
      originPressure: 'Her first crew abandoned her after she trusted the wrong captain.',
      truth: 'Shared trust is the only way she can protect the people who matter.',
      want: 'Keep sole control of the map.',
      need: 'Share control before control becomes another prison.',
      arcMode: 'positive',
      climaxChoice: {
        choiceQuestion: 'Will Mara share the map or seize it alone?',
        integrateTruthOption: 'Choose to share command with the crew.',
        recommitLieOption: 'Take the map and abandon the crew.',
        activeChoiceMechanism: 'The player chooses whom to trust with the final route.',
      },
    },
    supportingCharacters: [
      {
        characterId: 'char-lyra',
        characterName: 'Lyra',
        microLie: 'Lyra believes loyalty means never questioning a captain.',
        originPressure: 'A failed mutiny destroyed her last ship.',
        truthOrCounterPressure: 'Real loyalty can challenge bad command.',
        screenTimeTier: 'supporting',
        pressureRole: 'foil',
        protagonistVisibleSignals: ['Lyra obeys orders until the map endangers the crew.'],
      },
    ],
    ...overrides,
  };
}

describe('CharacterArchitectureValidator', () => {
  it('accepts complete protagonist and supporting character architecture', () => {
    const result = new CharacterArchitectureValidator().validate({
      characterArchitecture: architecture(),
      plan: {
        totalEpisodes: 4,
        episodes: [],
        arcs: [
          {
            id: 'arc-1',
            name: 'Trust the Crew',
            description: 'Mara learns that shared trust is not weakness.',
            episodeRange: { start: 1, end: 4 },
            keyMoments: [],
            identityPressureFacet: 'Mara believes needing help makes her weak.',
            status: 'not_started',
            completionPercentage: 0,
          },
        ],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.hasArchitecture).toBe(true);
    expect(result.metrics.supportingMicroArcCount).toBe(1);
    expect(result.metrics.arcsLinkedToIdentityPressure).toBe(1);
  });

  it('requires protagonist Lie, origin pressure, Truth, Want, Need, and active climax choice', () => {
    const result = new CharacterArchitectureValidator().validate({
      characterArchitecture: architecture({
        protagonist: {
          lie: '',
          originPressure: '',
          truth: '',
          want: '',
          need: '',
          arcMode: 'positive',
          climaxChoice: {
            choiceQuestion: '',
            integrateTruthOption: '',
            recommitLieOption: '',
            activeChoiceMechanism: '',
          },
        },
      }),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('lie is missing'),
        expect.stringContaining('originPressure is missing'),
        expect.stringContaining('truth is missing'),
        expect.stringContaining('want is missing'),
        expect.stringContaining('need is missing'),
        expect.stringContaining('climaxChoice.choiceQuestion is missing'),
      ]),
    );
  });

  it('warns when Want and Need are effectively identical', () => {
    const result = new CharacterArchitectureValidator().validate({
      characterArchitecture: architecture({
        protagonist: {
          ...architecture().protagonist,
          want: 'Find the lost map.',
          need: 'Find the lost map.',
        },
      }),
    });

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) =>
      issue.severity === 'warning' &&
      issue.message.includes('Want and Need appear too similar')
    )).toBe(true);
  });
});
