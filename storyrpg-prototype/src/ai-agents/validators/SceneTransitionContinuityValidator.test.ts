import { describe, it, expect } from 'vitest';
import { SceneTransitionContinuityValidator } from './SceneTransitionContinuityValidator';
import type { Scene, Story } from '../../types/story';

function makeScene(overrides: Partial<Scene> & { id: string }): Scene {
  return {
    name: overrides.id,
    beats: [],
    startingBeatId: '',
    ...overrides,
  } as Scene;
}

function makeStory(scenes: Scene[]): Story {
  return {
    id: 'test-story',
    title: 'Test',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [
      { id: 'ep-1', number: 1, title: 'Ep 1', synopsis: '', coverImage: '', scenes, startingSceneId: scenes[0]?.id ?? '' },
    ],
  } as unknown as Story;
}

const validator = new SceneTransitionContinuityValidator();

const beat = (text: string) => ({ id: 'b1', text, nextBeatId: undefined }) as never;

describe('SceneTransitionContinuityValidator', () => {
  it('passes a continuous edge (same place, same time)', () => {
    const story = makeStory([
      makeScene({ id: 's1', leadsTo: ['s2'], beats: [beat('You browse the shelves.')], timeline: { location: 'bookshop', timeOfDay: 'afternoon' } }),
      makeScene({ id: 's2', beats: [beat('Stela rings up the sale without looking at you.')], timeline: { location: 'bookshop', timeOfDay: 'afternoon' } }),
    ]);
    const result = validator.validate({ story });
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('flags the audited hard cut: time+place jump with no acknowledgment', () => {
    const story = makeStory([
      makeScene({ id: 's1-3', leadsTo: ['s1-4'], beats: [beat('You insist on paying, and Stela lets you.')], timeline: { location: 'bookshop', timeOfDay: 'afternoon' } }),
      makeScene({ id: 's1-4', beats: [beat('You are still in your coat. The notebook will not close.')], timeline: { location: 'rooftop', timeOfDay: 'night' } }),
    ]);
    const result = validator.validate({ story });
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toContain('s1-4');
    expect(result.issues[0].message).toContain('bookshop → rooftop');
  });

  it('accepts a transitionIn as acknowledgment', () => {
    const story = makeStory([
      makeScene({ id: 's1', leadsTo: ['s2'], beats: [beat('You leave the shop.')], timeline: { location: 'bookshop', timeOfDay: 'afternoon' } }),
      makeScene({
        id: 's2',
        beats: [beat('You are still in your coat.')],
        timeline: { location: 'rooftop', timeOfDay: 'night', transitionIn: 'Four in the morning, on the roof' },
      }),
    ]);
    expect(validator.validate({ story }).issues).toEqual([]);
  });

  it('accepts transition language in the opening prose', () => {
    const story = makeStory([
      makeScene({ id: 's1', leadsTo: ['s2'], beats: [beat('The wine is wrong somehow.')], timeline: { location: 'estate', timeOfDay: 'evening' } }),
      makeScene({
        id: 's2',
        beats: [beat('The next morning, the table is laid for three and the coffee is hot.')],
        timeline: { location: 'breakfast-room', timeOfDay: 'morning' },
      }),
    ]);
    expect(validator.validate({ story }).issues).toEqual([]);
  });

  it('flags an empty encounter scaffold sitting on a jump (the g10 pattern)', () => {
    const story = makeStory([
      makeScene({ id: 's1', leadsTo: ['enc-1'], beats: [beat('She hands you the receipt.')], timeline: { location: 'bookshop', timeOfDay: 'afternoon' } }),
      makeScene({ id: 'enc-1', beats: [], timeline: { location: 'rooftop', timeOfDay: 'night' } }),
    ]);
    const result = validator.validate({ story });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain('NO opening prose');
  });

  it('reads encounter setup prose when beats are empty', () => {
    const story = makeStory([
      makeScene({ id: 's1', leadsTo: ['enc-1'], beats: [beat('She hands you the receipt.')], timeline: { location: 'bookshop', timeOfDay: 'afternoon' } }),
      makeScene({
        id: 'enc-1',
        beats: [],
        encounter: { setupText: 'Hours later, you reach the rooftop with the city dark below.' } as never,
        timeline: { location: 'rooftop', timeOfDay: 'night' },
      }),
    ]);
    expect(validator.validate({ story }).issues).toEqual([]);
  });

  it('is inert on scenes without timeline metadata (legacy stories)', () => {
    const story = makeStory([
      makeScene({ id: 's1', leadsTo: ['s2'], beats: [beat('Afternoon in the shop.')] }),
      makeScene({ id: 's2', beats: [beat('You are on a rooftop now, somehow.')] }),
    ]);
    expect(validator.validate({ story }).issues).toEqual([]);
  });
});
