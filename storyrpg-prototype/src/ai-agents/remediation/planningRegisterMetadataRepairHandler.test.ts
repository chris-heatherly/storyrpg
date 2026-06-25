import { describe, it, expect } from 'vitest';
import type { Story } from '../../types/story';
import { PlanningRegisterLeakValidator } from '../validators/PlanningRegisterLeakValidator';
import { buildPlanningRegisterMetadataRepairHandler } from './planningRegisterMetadataRepairHandler';

function storyWithLeaks(): Story {
  return {
    id: 'bite-me-test',
    title: 'Bite Me Test',
    description: 'Test',
    genre: 'paranormal-romance',
    metadata: {
      author: 'test',
      version: '1.0.0',
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
      tags: [],
      estimatedPlayTime: 10,
    },
    initialState: {
      flags: {},
      attributes: {},
      resources: {},
      relationships: {},
      inventory: [],
      storyVariables: {},
      skills: {},
    },
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'Episode One',
      description: 'Episode',
      startingSceneId: 'scene-1',
      scenes: [{
        id: 'scene-1',
        title: 'Arrival',
        description: 'Let the fallout settle into the next pressure: Kylie lands in Bucharest fleeing heartbreak.',
        encounter: {
          id: 'scene-1-encounter',
          description: 'A shadow closes in at the edge of Cișmigiu Gardens.',
          payoffContext: {
            aftermathEchoes: [
              'information:treatment_ep1 — Plant INFO-B (Victor staged the attack — seeded by the too-perfect rescue); plant INFO-C (the supernatural is real — the attacker dropped "like a coat"). Scene note: by 6pm it has 80,000 reads.',
            ],
          },
          phases: [{
            id: 'phase-1',
            description: 'Escalate the episode pressure through a concrete turn: rising pressure.',
          }],
        },
        beats: [{
          id: 'beat-1',
          text: 'Everything. Then continue into the planned scene: Open the episode through its immediate question: Kylie lands in Bucharest, forms the Dusk Club, is attacked in the park, rescued by Victor, meets Radu, and notices Mika watching too much.',
          primaryAction: 'Escalate the episode pressure through a concrete turn: Kylie lands in Bucharest fleeing heartbreak.',
          visualMoment: 'Let the fallout settle into the next pressure: rising pressure.',
          emotionalRead: 'Let the fallout settle into the next pressure: rising pressure.',
          relationshipDynamic: 'Escalate the episode pressure through a concrete turn: rising pressure.',
          textVariants: [{
            condition: { type: 'flag', flag: 'survived_cismigiu_shadow', value: true },
            text: 'Escalate the episode pressure through a concrete turn: Kylie arrives in Bucharest to start over while hiding from heartbreak.. Surviving Cișmigiu has left your senses too awake.',
          }],
          choices: [{
            id: 'choice-1',
            text: 'Follow the cold air toward the street.',
            nextSceneId: 'scene-1',
          }],
        }],
      }],
    }],
  } as unknown as Story;
}

describe('buildPlanningRegisterMetadataRepairHandler', () => {
  it('rewrites planning-register beat and scene metadata without touching choices', () => {
    const story = storyWithLeaks();
    const choiceBefore = JSON.stringify(story.episodes[0].scenes[0].beats[0].choices);
    const handler = buildPlanningRegisterMetadataRepairHandler();

    const result = handler({
      story,
      blockingIssues: [{
        type: 'planning_register_prose',
        validator: 'PlanningRegisterLeakValidator',
        sceneId: 'scene-1',
      }],
    });

    expect(result.changed).toBe(true);
    expect(JSON.stringify(story.episodes[0].scenes[0].beats[0].choices)).toBe(choiceBefore);
    expect(story.episodes[0].scenes[0].description).toBe('Kylie lands in Bucharest fleeing heartbreak.');
    expect(story.episodes[0].scenes[0].beats[0].text).toBe(
      'Kylie lands in Bucharest, forms the Dusk Club, is attacked in the park, rescued by Victor, meets Radu, and notices Mika watching too much.',
    );
    expect(story.episodes[0].scenes[0].beats[0].primaryAction).toBe('Kylie lands in Bucharest fleeing heartbreak.');
    expect(story.episodes[0].scenes[0].beats[0].visualMoment).toBe(
      'Kylie lands in Bucharest, forms the Dusk Club, is attacked in the park, rescued by Victor, meets Radu, and notices Mika watching too much.',
    );
    expect(story.episodes[0].scenes[0].beats[0].textVariants?.[0]?.text).toBe(
      'Kylie arrives in Bucharest to start over while hiding from heartbreak. Surviving Cișmigiu has left your senses too awake.',
    );
    expect((story.episodes[0].scenes[0] as any).encounter.phases[0].description).toBe(
      'A shadow closes in at the edge of Cișmigiu Gardens.',
    );
    expect((story.episodes[0].scenes[0] as any).encounter.payoffContext.aftermathEchoes[0]).toContain(
      'too-perfect rescue',
    );
    expect((story.episodes[0].scenes[0] as any).encounter.payoffContext.aftermathEchoes[0]).not.toContain('INFO-B');
    expect((story.episodes[0].scenes[0] as any).encounter.payoffContext.aftermathEchoes[0]).not.toContain('Victor staged');
    expect(new PlanningRegisterLeakValidator().validate({ story }).findings).toHaveLength(0);
  });

  it('no-ops when the final contract is not blocked by planning-register prose', () => {
    const story = storyWithLeaks();
    const before = JSON.stringify(story);
    const handler = buildPlanningRegisterMetadataRepairHandler();

    const result = handler({
      story,
      blockingIssues: [{ validator: 'RequiredBeatRealizationValidator', sceneId: 'scene-1' }],
    });

    expect(result.changed).toBe(false);
    expect(JSON.stringify(story)).toBe(before);
  });
});
