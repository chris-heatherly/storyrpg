import { describe, expect, it } from 'vitest';
import { PhaseValidator } from './PhaseValidator';
import { WorldBible, LocationDetails } from '../agents/WorldBuilder';

function makeLocation(overrides: Partial<LocationDetails> = {}): LocationDetails {
  return {
    id: 'loc-harbor',
    name: 'Saltspire Harbor',
    type: 'city',
    overview: 'A bustling harbor town clinging to the cliffs.',
    fullDescription:
      'Saltspire Harbor sprawls across the cliffside, its weathered docks groaning under the weight of trade and tide. Lantern light flickers against the fog as sailors haggle over crates of dried fish and stolen secrets.',
    sensoryDetails: {
      sights: ['lantern light', 'tall ships'],
      sounds: ['creaking ropes', 'gull cries'],
      smells: ['brine', 'tar'],
      textures: ['slick cobblestone'],
      atmosphere: 'restless and salt-stung',
    },
    secrets: ['A smuggler tunnel beneath the fish market'],
    dangers: ['Press gangs at night'],
    opportunities: ['Black-market contacts'],
    connectedLocations: ['loc-cliffs'],
    ...overrides,
  };
}

function makeWorldBible(overrides: Partial<WorldBible> = {}): WorldBible {
  return {
    worldRules: [
      'Tides obey the moon-twins, not the sun.',
      'Debts sworn on saltwater bind across lifetimes.',
      'Iron rusts the moment it touches spire-stone.',
    ],
    taboos: ['Speaking the drowned king\'s name aloud'],
    majorEvents: [
      {
        name: 'The Great Surge',
        description: 'A tidal wave reshaped the coast overnight.',
        yearsAgo: '40',
        impact: 'Half the lower city was lost to the sea.',
      },
    ],
    locations: [makeLocation()],
    factions: [],
    customs: ['Sailors tattoo their first voyage on their wrists'],
    beliefs: ['The sea remembers every promise'],
    tensions: ['Harbor guild versus the smuggler cartels'],
    doNotForget: ['Spire-stone corrodes iron'],
    ...overrides,
  };
}

describe('PhaseValidator.validateWorldBible', () => {
  it('passes a well-formed world bible with no errors', () => {
    const result = new PhaseValidator().validateWorldBible(makeWorldBible());

    expect(result.valid).toBe(true);
    expect(result.canProceed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.issues).toEqual([]);
  });

  it('flags an empty location list with a blocking error', () => {
    const result = new PhaseValidator().validateWorldBible(makeWorldBible({ locations: [] }));

    expect(result.valid).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('NO_LOCATIONS');
    const noLocations = result.issues.find((i) => i.code === 'NO_LOCATIONS');
    expect(noLocations?.severity).toBe('error');
  });

  it('warns about thin descriptions and missing sensory details', () => {
    const thin = makeLocation({
      fullDescription: 'Too short.',
      sensoryDetails: {
        sights: [],
        sounds: [],
        smells: [],
        textures: [],
        atmosphere: '',
      },
    });
    // Replace sensoryDetails with an empty object to trigger LOCATION_NO_SENSORY.
    const result = new PhaseValidator().validateWorldBible(
      makeWorldBible({ locations: [{ ...thin, sensoryDetails: {} as LocationDetails['sensoryDetails'] }] })
    );

    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('LOCATION_THIN_DESCRIPTION');
    expect(codes).toContain('LOCATION_NO_SENSORY');
    // No error-severity issues here, so it stays valid but with a reduced score.
    expect(result.valid).toBe(true);
    expect(result.score).toBeLessThan(100);
  });

  it('detects duplicate location IDs as an error', () => {
    const result = new PhaseValidator().validateWorldBible(
      makeWorldBible({ locations: [makeLocation(), makeLocation()] })
    );

    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('DUPLICATE_LOCATION_IDS');
    expect(result.valid).toBe(false);
  });
});
