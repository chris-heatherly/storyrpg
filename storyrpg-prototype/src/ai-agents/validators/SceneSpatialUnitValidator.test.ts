import { describe, expect, it } from 'vitest';
import type { Scene, Story } from '../../types';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { SceneSpatialUnitValidator } from './SceneSpatialUnitValidator';

function story(scene: Scene): Story {
  return {
    id: 'spatial-test',
    title: 'Spatial Test',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      startingSceneId: scene.id,
      scenes: [scene],
    }],
  } as Story;
}

describe('SceneSpatialUnitValidator', () => {
  it('treats location ids and display names as the same major location', () => {
    const scene = {
      id: 's1-1',
      name: 'Valescu Club',
      timeline: { location: 'Valescu Club' },
      startingBeatId: 'b1',
      beats: [{
        id: 'b1',
        text: 'Inside Valescu Club, Mara accepts the card and sits at the booth.',
        choices: [],
      }],
    } as Scene;
    const scenePlan: SeasonScenePlan = {
      scenes: [{
        id: 's1-1',
        episodeNumber: 1,
        order: 0,
        kind: 'standard',
        title: 'Club',
        dramaticPurpose: 'Mara enters the club.',
        narrativeRole: 'turn',
        locations: ['loc-valescu-club'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
      }],
      byEpisode: { 1: ['s1-1'] },
      setupPayoffEdges: [],
    };

    const result = new SceneSpatialUnitValidator().validate({ story: story(scene), scenePlan });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('does not count a departed prior venue as meaningful action in two locations', () => {
    const scene = {
      id: 's1-2',
      name: 'Garden Shortcut',
      timeline: { location: 'Cismigiu Gardens' },
      startingBeatId: 'b1',
      beats: [{
        id: 'b1',
        text: "The Rooftop Bar's champagne buzz fades as you take a shortcut home through Cismigiu Gardens. The path narrows under the trees.",
        choices: [],
      }],
    } as Scene;
    const scenePlan: SeasonScenePlan = {
      scenes: [{
        id: 's1-2',
        episodeNumber: 1,
        order: 1,
        kind: 'standard',
        title: 'Garden',
        dramaticPurpose: 'The prior venue falls away as the scene begins in the gardens.',
        narrativeRole: 'turn',
        locations: ['Rooftop Bar', 'Cismigiu Gardens'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
      }],
      byEpisode: { 1: ['s1-2'] },
      setupPayoffEdges: [],
    };

    const result = new SceneSpatialUnitValidator().validate({ story: story(scene), scenePlan });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('does not mine a named social group as a second location without locative context (bite-me 2026-07-02)', () => {
    // "the Dusk Club" is a friend group; lexically it matches the venue pattern.
    // A prose mention with no locative lead ("First rule of the Dusk Club") must
    // not register the group as a place the scene conducts action in.
    const scene = {
      id: 's1-1',
      name: 'Cafe Patio',
      timeline: { location: 'Venue' },
      startingBeatId: 'b1',
      beats: [
        {
          id: 'b1',
          text: 'At the venue, Mika waves from a cafe patio and pulls you into a hug. "First rule of the Dusk Club," she murmurs. "We don\'t let the new girl carry her own baggage." She hands you a negroni and asks what you will write about first.',
          choices: [],
        },
      ],
    } as Scene;
    const scenePlan: SeasonScenePlan = {
      scenes: [{
        id: 's1-1',
        episodeNumber: 1,
        order: 0,
        kind: 'standard',
        title: 'Arrival',
        dramaticPurpose: 'Kylie meets Mika and the group takes shape.',
        narrativeRole: 'setup',
        locations: ['Venue'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
      }],
      byEpisode: { 1: ['s1-1'] },
      setupPayoffEdges: [],
    };

    const result = new SceneSpatialUnitValidator().validate({ story: story(scene), scenePlan });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('allows a scene whose plan declares every active location (sanctioned multi-location scene)', () => {
    const scene = {
      id: 's1-4',
      name: 'Club to Gardens',
      timeline: { location: 'Valescu Club' },
      startingBeatId: 'b1',
      beats: [
        {
          id: 'b1',
          text: 'You step inside Valescu Club, and Mika introduces you to the owner while he offers you wine. You walk into Cismigiu Gardens and a stranger blocks the path and warns you to turn back.',
          choices: [],
        },
      ],
    } as Scene;
    const scenePlan: SeasonScenePlan = {
      scenes: [{
        id: 's1-4',
        episodeNumber: 1,
        order: 3,
        kind: 'standard',
        title: 'Club to gardens',
        dramaticPurpose: 'The plan stages this scene across both places.',
        narrativeRole: 'turn',
        locations: ['Valescu Club', 'Cismigiu Gardens'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
      }],
      byEpisode: { 1: ['s1-4'] },
      setupPayoffEdges: [],
    };

    const result = new SceneSpatialUnitValidator().validate({ story: story(scene), scenePlan });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('allows two active anchors when the scene owns a movement event cue (arrival spans origin and destination)', () => {
    const scene = {
      id: 's1-5',
      name: 'Arrival at the Club',
      timeline: { location: 'Valescu Club' },
      startingBeatId: 'b1',
      beats: [
        {
          id: 'b1',
          text: 'You step inside Valescu Club, and Mika introduces you to the owner while he offers you wine. You walk into Cismigiu Gardens and a stranger blocks the path and warns you to turn back.',
          choices: [],
        },
      ],
    } as Scene;
    const scenePlan: SeasonScenePlan = {
      scenes: [{
        id: 's1-5',
        episodeNumber: 1,
        order: 4,
        kind: 'standard',
        title: 'Arrival',
        dramaticPurpose: 'The arrival is owned here and touches both endpoints.',
        narrativeRole: 'turn',
        locations: ['Valescu Club'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
        sceneEventOwnership: {
          id: 'own-s1-5',
          sceneId: 's1-5',
          ownedEvents: [{ key: 'arrival-club', cue: 'arrival', text: 'Kylie arrives at the club.', sourceContractIds: [] }],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
      }],
      byEpisode: { 1: ['s1-5'] },
      setupPayoffEdges: [],
    };

    const result = new SceneSpatialUnitValidator().validate({ story: story(scene), scenePlan });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('still mines a prose venue that carries locative context', () => {
    const scene = {
      id: 's1-3',
      name: 'Split Scene',
      timeline: { location: 'Cismigiu Gardens' },
      startingBeatId: 'b1',
      beats: [
        {
          id: 'b1',
          text: 'You step inside Valescu Club, and Mika introduces you to the owner while he offers you wine. You walk into Cismigiu Gardens and a stranger blocks the path and warns you to turn back.',
          choices: [],
        },
      ],
    } as Scene;
    const scenePlan: SeasonScenePlan = {
      scenes: [{
        id: 's1-3',
        episodeNumber: 1,
        order: 2,
        kind: 'standard',
        title: 'Split scene',
        dramaticPurpose: 'Action spans two major places.',
        narrativeRole: 'turn',
        locations: ['Cismigiu Gardens'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
      }],
      byEpisode: { 1: ['s1-3'] },
      setupPayoffEdges: [],
    };

    const result = new SceneSpatialUnitValidator().validate({ story: story(scene), scenePlan });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('multiple major locations');
  });
});
