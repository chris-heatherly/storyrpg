import { describe, expect, it } from 'vitest';
import type { Beat, Scene, Story } from '../../types';
import type { SceneTurnContract, SeasonScenePlan } from '../../types/scenePlan';
import { SceneTurnRealizationValidator } from './SceneTurnRealizationValidator';

function turnContract(overrides: Partial<SceneTurnContract> = {}): SceneTurnContract {
  return {
    turnId: 's1-1-turn',
    source: 'treatment',
    centralTurn: 'Mika adopts Kylie at the door of Vâlcescu Club and hands her a key card to the side entrance.',
    beforeState: 'Kylie is outside the club and not yet claimed by Mika.',
    turnEvent: 'Mika adopts Kylie and gives her the side-entrance key card.',
    afterState: 'Kylie has Mika as an ally and access to the side entrance.',
    handoff: 'Show the immediate consequence before moving to the next place.',
    ...overrides,
  };
}

function beat(id: string, text: string, extra: Partial<Beat> = {}): Beat {
  return { id, text, ...extra } as Beat;
}

function scene(overrides: Partial<Scene> & { id: string }): Scene {
  return {
    name: overrides.id,
    beats: [],
    startingBeatId: '',
    ...overrides,
  } as Scene;
}

function story(scenes: Scene[]): Story {
  return {
    id: 'story',
    title: 'Story',
    genre: 'paranormal romance',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [
      { id: 'ep-1', number: 1, title: 'Ep 1', synopsis: '', coverImage: '', scenes, startingSceneId: scenes[0]?.id ?? '' },
    ],
  } as unknown as Story;
}

function plan(contract = turnContract()): SeasonScenePlan {
  return {
    scenes: [{
      id: 's1-1',
      episodeNumber: 1,
      order: 0,
      kind: 'standard',
      title: 'Club door',
      dramaticPurpose: 'Mika claims Kylie at the door.',
      narrativeRole: 'turn',
      locations: ['Vâlcescu Club'],
      npcsInvolved: ['mika'],
      setsUp: [],
      paysOff: [],
      turnContract: contract,
    }],
    byEpisode: { 1: ['s1-1'] },
    setupPayoffEdges: [],
  };
}

const validator = new SceneTurnRealizationValidator();

describe('SceneTurnRealizationValidator', () => {
  it('fails when a treatment turn is mentioned but has no aftermath or handoff', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract(),
          beats: [
            beat('b1', 'Outside Vâlcescu Club, Mika blocks the red rope with one boot.', {
              sequenceIntent: { beatRole: 'setup' },
            }),
            beat('b2', 'Mika adopts Kylie at the door of Vâlcescu Club and hands her a key card to the side entrance.', {
              sequenceIntent: { beatRole: 'turn' },
            }),
          ],
        }),
      ]),
      scenePlan: plan(),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toContain('after-state aftermath/handoff');
  });

  it('fails the Bite Me club-to-bookshop bridge shape as an under-realized turn', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract(),
          leadsTo: ['s1-2'],
          beats: [
            beat('s1-1-b5', 'Kylie waits outside Vâlcescu Club while Mika studies her shoes.', {
              sequenceIntent: { beatRole: 'setup' },
            }),
            beat('s1-1-b7', 'Mika adopts Kylie at the door of Vâlcescu Club and hands her a key card to the side entrance.', {
              sequenceIntent: { beatRole: 'turn' },
            }),
            beat('s1-1-b7-payoff-1', 'The card feels heavier than it should.', {
              isChoiceBridge: true,
              nextSceneId: 's1-2',
            }),
          ],
        }),
        scene({
          id: 's1-2',
          beats: [beat('s1-2-b1', 'The bookshop smells of paper and bay leaf.')],
        }),
      ]),
      scenePlan: plan(),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Mika adopts Kylie'))).toBe(true);
  });

  it('passes when the scene shows setup, turn, and aftermath/handoff roles', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract(),
          beats: [
            beat('b1', 'Outside Vâlcescu Club, Mika blocks the red rope with one boot.', {
              sequenceIntent: { beatRole: 'setup' },
            }),
            beat('b2', 'Mika adopts Kylie at the door of Vâlcescu Club and hands her a key card to the side entrance.', {
              sequenceIntent: { beatRole: 'turn' },
            }),
            beat('b3', 'Afterward, Mika tucks the card into Kylie’s palm and walks her through the side door before the bouncer can object.', {
              sequenceIntent: { beatRole: 'aftermath' },
            }),
          ],
        }),
      ]),
      scenePlan: plan(),
      treatmentSourced: true,
    });

    expect(result.issues).toEqual([]);
  });

  it('keeps encounter scene content scoped to encounter validators', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 'enc-1',
          encounter: {} as never,
          turnContract: turnContract({ source: 'encounter', centralTurn: 'The shadow pins Kylie to the willow.' }),
          beats: [],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.issues).toEqual([]);
  });

  it('downgrades non-treatment craft misses to warnings when they are not structurally risky', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract({ source: 'planner', centralTurn: 'Kylie realizes the club has a side entrance.' }),
          beats: [beat('b1', 'Kylie realizes the club has a side entrance.')],
        }),
      ]),
      treatmentSourced: false,
    });

    expect(result.valid).toBe(true);
    expect(result.issues[0].severity).toBe('warning');
  });
});
