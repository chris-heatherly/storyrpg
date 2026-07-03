import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { SceneCharacterAvailabilityValidator } from './SceneCharacterAvailabilityValidator';

const validator = new SceneCharacterAvailabilityValidator();

function makeStory(overrides: {
  npcs?: Story['npcs'];
  sceneText: string;
  timeOfDay?: string;
}): Story {
  return {
    id: 'story',
    title: 'Story',
    genre: 'paranormal romance',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: overrides.npcs ?? [],
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      startingSceneId: 's1-1',
      scenes: [{
        id: 's1-1',
        name: 'Arrival',
        beats: [{ id: 'b1', text: overrides.sceneText }],
        startingBeatId: 'b1',
        timeline: overrides.timeOfDay ? { timeOfDay: overrides.timeOfDay } : undefined,
      }],
    }],
  } as unknown as Story;
}

const daylightBoundMika: Story['npcs'][number] = {
  id: 'char-mika-dragan',
  name: 'Mika Dragan',
  description: 'Vintage store owner; secretly a contracted succubus.',
  species: 'succubus',
  timeOfDayConstraints: {
    unavailable: ['morning', 'midday', 'afternoon'],
    reason: 'sunlight burns the strigoi-bound',
  },
};

describe('SceneCharacterAvailabilityValidator', () => {
  it('flags a daylight-bound character appearing in a planned afternoon scene (bite-me 2026-07-03)', () => {
    const story = makeStory({
      npcs: [daylightBoundMika],
      timeOfDay: 'afternoon',
      sceneText: 'Mika steps over the threshold without waiting for an invitation, her smile electric.',
    });
    const result = validator.validate({ story });
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('Mika Dragan');
    expect(result.issues[0].message).toContain('afternoon');
  });

  it('infers the clock from prose when the plan left timeOfDay empty', () => {
    const story = makeStory({
      npcs: [daylightBoundMika],
      sceneText: 'Dust motes dance in the weak afternoon light. Mika steps over the threshold, holding up a paper bag.',
    });
    const result = validator.validate({ story });
    expect(result.valid).toBe(false);
  });

  it('allows remote contact (a text) during forbidden hours', () => {
    const story = makeStory({
      npcs: [daylightBoundMika],
      timeOfDay: 'afternoon',
      sceneText: "Your phone buzzes: a message from Mika. 'Landed safe?! Drinks at dusk.'",
    });
    const result = validator.validate({ story });
    expect(result.valid).toBe(true);
  });

  it('allows on-page presence during permitted hours', () => {
    const story = makeStory({
      npcs: [daylightBoundMika],
      timeOfDay: 'dusk',
      sceneText: 'Mika raises her glass as the lights of the city prick the deep blue of dusk.',
    });
    const result = validator.validate({ story });
    expect(result.valid).toBe(true);
  });

  it('is inert for characters without structured constraints', () => {
    const story = makeStory({
      npcs: [{ id: 'char-stela', name: 'Stela Pavel', description: 'A watchful skeptic.' }],
      timeOfDay: 'afternoon',
      sceneText: 'Stela watches the room over an untouched glass.',
    });
    const result = validator.validate({ story });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
