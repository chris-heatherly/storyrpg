import { describe, expect, it, vi } from 'vitest';
import type { Story } from '../../types/story';
import { RouteContinuityValidator } from '../validators/RouteContinuityValidator';
import { buildEncounterMetadataRepairHandler } from './encounterMetadataRepairHandler';

function storyWithEncounterDescription(description: string): Story {
  return {
    id: 'story',
    title: 'Story',
    metadata: {},
    npcs: [],
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'Episode',
      scenes: [{
        id: 'enc-scene',
        name: 'Park Attack',
        beats: [{ id: 'b1', text: 'Fog closes over the path behind you.' }],
        encounter: {
          id: 'encounter',
          name: 'Park Attack',
          description,
          sourceSynopsis: 'Walking home, she is attacked in the park.',
          authoredAnchor: 'The shadow pins her to a willow.',
          phases: [{
            beats: [{
              id: 'eb1',
              setupText: 'A shadow crosses the path and cuts off the gate.',
              choices: [],
            }],
          }],
        },
      }],
    }],
  } as unknown as Story;
}

describe('encounter metadata field-owned repair', () => {
  it('reports the exact shippable path and ignores author-only source fields', () => {
    const story = storyWithEncounterDescription('You face this pressure: the shadow attacks.');
    const issues = new RouteContinuityValidator().validate({ story }).issues
      .filter((issue) => issue.type === 'unsafe_fallback_prose');

    expect(issues).toHaveLength(1);
    expect(issues[0].fieldPath).toBe('encounter.description');
    expect(issues[0].message).not.toContain('Walking home, she is attacked');
  });

  it('re-authors only encounter.description and clears the validator finding', async () => {
    const story = storyWithEncounterDescription('You face this pressure: the shadow attacks.');
    const [issue] = new RouteContinuityValidator().validate({ story }).issues;
    const reauthorEncounterDescription = vi.fn(async () =>
      'A shadow seals the moonlit path behind you while the locked garden gate rattles ahead.');
    const handler = buildEncounterMetadataRepairHandler({
      author: () => ({ reauthorEncounterDescription }),
    });

    const result = await handler({ story, blockingIssues: [issue] });

    expect(result.changed).toBe(true);
    expect(reauthorEncounterDescription).toHaveBeenCalledOnce();
    expect((story.episodes[0].scenes[0].encounter as any).sourceSynopsis)
      .toBe('Walking home, she is attacked in the park.');
    expect((story.episodes[0].scenes[0].encounter as any).authoredAnchor)
      .toBe('The shadow pins her to a willow.');
    expect(new RouteContinuityValidator().validate({ story }).issues).toHaveLength(0);
  });

  it('does not claim ownership without the exact encounter path', async () => {
    const story = storyWithEncounterDescription('You face this pressure: the shadow attacks.');
    const reauthorEncounterDescription = vi.fn();
    const handler = buildEncounterMetadataRepairHandler({
      author: () => ({ reauthorEncounterDescription }),
    });

    const result = await handler({
      story,
      blockingIssues: [{
        type: 'unsafe_fallback_prose',
        validator: 'RouteContinuityValidator',
        sceneId: 'enc-scene',
        fieldPath: 'beats[0].text',
      }],
    });

    expect(result.changed).toBe(false);
    expect(reauthorEncounterDescription).not.toHaveBeenCalled();
  });

  it('reuses one focused authoring result across duplicate description surfaces', async () => {
    const story = storyWithEncounterDescription('You face this pressure: the shadow attacks.');
    (story.episodes[0].scenes[0].encounter as any).phases[0].description = 'You face this pressure: the shadow attacks.';
    const issues = new RouteContinuityValidator().validate({ story }).issues
      .filter((issue) => issue.type === 'unsafe_fallback_prose');
    const reauthorEncounterDescription = vi.fn(async () =>
      'A shadow cuts off your moonlit path while the locked garden gate rattles behind you.');
    const handler = buildEncounterMetadataRepairHandler({
      author: () => ({ reauthorEncounterDescription }),
    });

    const result = await handler({ story, blockingIssues: issues });

    expect(result.changed).toBe(true);
    expect(reauthorEncounterDescription).toHaveBeenCalledOnce();
    expect((story.episodes[0].scenes[0].encounter as any).description)
      .toBe('A shadow cuts off your moonlit path while the locked garden gate rattles behind you.');
    expect((story.episodes[0].scenes[0].encounter as any).phases[0].description)
      .toBe('A shadow cuts off your moonlit path while the locked garden gate rattles behind you.');
    expect(result.atomicScopes).toEqual([{ kind: 'scene', sceneId: 'enc-scene' }]);
    expect(new RouteContinuityValidator().validate({ story }).issues).toHaveLength(0);
  });
});


describe('re-author acceptance uses the shared safety ruler', () => {
  it('rejects re-authored text that still reads as pasted synopsis', async () => {
    const story = {
      episodes: [{
        number: 1,
        scenes: [{
          id: 'enc-1', name: 'Rescue', beats: [],
          encounter: { description: 'Walking home through Cismigiu, she is attacked and rescued by the impossibly handsome stranger, who walks her to her threshold and vanishes.' },
        }],
      }],
    } as never;
    const handler = buildEncounterMetadataRepairHandler({
      author: () => ({
        // The re-author echoes the synopsis right back (the realistic Gemini
        // failure) with only cosmetic changes — must NOT be accepted.
        reauthorEncounterDescription: async () => 'Walking home through Cismigiu, she is attacked and saved by a stranger in a charcoal suit.',
      }),
    });
    const result = await handler({
      story,
      blockingIssues: [{
        type: 'unsafe_fallback_prose', severity: 'error', validator: 'RouteContinuityValidator',
        sceneId: 'enc-1', fieldPath: 'encounter.description', message: 'paste',
      }],
    } as never);
    expect(result.changed).toBe(false);
    const scene = (story as never as { episodes: Array<{ scenes: Array<{ encounter: { description: string } }> }> }).episodes[0].scenes[0];
    expect(scene.encounter.description).toContain('Walking home through Cismigiu');
  });
});
