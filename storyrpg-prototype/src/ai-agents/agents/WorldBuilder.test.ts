import { describe, expect, it } from 'vitest';
import { WorldBuilder, type WorldBible, type WorldBuilderInput } from './WorldBuilder';

const config = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

function makeInput(): WorldBuilderInput {
  return {
    storyContext: {
      title: 'Bite Me',
      genre: 'Paranormal Rom-Com / Dark Vampire Romance',
      tone: 'witty and dangerous',
      synopsis: 'A journalist discovers Bucharest after dark.',
    },
    worldPremise: 'Bucharest nightlife hides vampire politics.',
    timePeriod: 'present day',
    technologyLevel: 'modern',
    locationsToCreate: [
      {
        id: 'loc-vâlcescu-club',
        name: 'Vâlcescu Club',
        type: 'club',
        importance: 'major',
        briefDescription: 'A vampire-owned nightlife hub.',
      },
      {
        id: 'loc-lumina-books',
        name: 'Lumina Books',
        type: 'bookshop',
        importance: 'major',
        briefDescription: 'Stela Pavel’s herb-scented occult bookshop.',
      },
    ],
  };
}

function makeBible(): WorldBible {
  return {
    worldRules: ['Vampires hide in plain sight.'],
    taboos: [],
    majorEvents: [],
    locations: [
      {
        id: 'loc-vâlcescu-club',
        name: 'Vâlcescu Club',
        type: 'club',
        overview: 'A club.',
        fullDescription: 'A velvet-lit club with enough concrete detail to pass validation.',
        sensoryDetails: { sights: [], sounds: [], smells: [], textures: [], atmosphere: 'charged' },
        secrets: [],
        dangers: [],
        opportunities: [],
        connectedLocations: ['loc-lumina-books', 'loc-extra'],
      },
      {
        id: 'loc-lumina-books',
        name: 'Lumina Books',
        type: 'bookshop',
        overview: 'A bookshop.',
        fullDescription: 'A herb-scented bookshop with enough concrete detail to pass validation.',
        sensoryDetails: { sights: [], sounds: [], smells: [], textures: [], atmosphere: 'quiet' },
        secrets: [],
        dangers: [],
        opportunities: [],
        connectedLocations: ['loc-extra'],
      },
      {
        id: 'loc-extra',
        name: 'Neon Nectar',
        type: 'lounge',
        overview: 'An extra location.',
        fullDescription: 'An unsolicited location that should not enter episode canon.',
        sensoryDetails: { sights: [], sounds: [], smells: [], textures: [], atmosphere: 'unneeded' },
        secrets: [],
        dangers: [],
        opportunities: [],
        connectedLocations: ['loc-vâlcescu-club'],
      },
    ],
    factions: [
      {
        id: 'faction-1',
        name: 'Night Court',
        type: 'supernatural',
        overview: 'A faction.',
        goals: [],
        methods: [],
        values: [],
        leaderDescription: '',
        memberProfile: '',
        hierarchy: '',
        allies: [],
        enemies: [],
        neutralRelations: [],
        territories: ['loc-vâlcescu-club', 'loc-extra'],
        symbols: [],
        recognition: '',
      },
    ],
    customs: [],
    beliefs: [],
    tensions: [],
    doNotForget: [],
  };
}

describe('WorldBuilder requested location pruning', () => {
  it('removes unsolicited locations and references when locationsToCreate is explicit', () => {
    const author = new WorldBuilder(config);
    const bible = makeBible();

    (author as any).pruneUnrequestedLocations(bible, makeInput());

    expect(bible.locations.map((location) => location.id)).toEqual([
      'loc-vâlcescu-club',
      'loc-lumina-books',
    ]);
    expect(bible.locations.flatMap((location) => location.connectedLocations)).not.toContain('loc-extra');
    expect(bible.factions[0].territories).toEqual(['loc-vâlcescu-club']);
  });

  it('tells the model to create exactly the requested locations', () => {
    const author = new WorldBuilder(config);
    const prompt = (author as any).buildPrompt(makeInput());

    expect(prompt).toContain('Create exactly 2 locations');
    expect(prompt).toContain('Do not add extra locations beyond the requested list.');
    expect(prompt).toContain('"loc-vâlcescu-club"');
    expect(prompt).toContain('"loc-lumina-books"');
  });
});
