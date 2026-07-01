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
});
