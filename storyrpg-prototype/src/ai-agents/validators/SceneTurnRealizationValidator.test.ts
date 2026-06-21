import { describe, expect, it } from 'vitest';
import type { Beat, Scene, Story } from '../../types';
import type {
  ArcPressureTreatmentContract,
  SceneTurnContract,
  SeasonScenePlan,
  SevenPointBeatRealizationContract,
} from '../../types/scenePlan';
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

function sevenPointContract(overrides: Partial<SevenPointBeatRealizationContract> = {}): SevenPointBeatRealizationContract {
  return {
    id: 'seven-point-midpoint-mirror',
    beat: 'midpoint',
    sourceText: 'Kylie sees herself alone in Victor mirror; Stela confesses two truths; the genre changes; the blog skips a day.',
    targetEpisodeNumber: 1,
    requiredRealization: ['season_plan', 'scene_turn', 'mechanic_pressure', 'final_prose'],
    eventAtoms: ['Kylie sees herself alone in Victor mirror', 'Stela confesses two truths', 'the blog skips a day'],
    stateChange: 'the genre changes and the blog skips a day',
    targetSceneIds: ['s1-1'],
    blockingLevel: 'treatment',
    ...overrides,
  };
}

function arcPressureContract(overrides: Partial<ArcPressureTreatmentContract> = {}): ArcPressureTreatmentContract {
  return {
    id: 'arc-pressure-champagne-midpoint',
    source: 'treatment',
    arcId: 'arc-1',
    arcTitle: 'Champagne',
    fieldName: 'Midpoint recontextualization',
    sourceText: 'The glamorous new life is underneath a funnel.',
    contractKind: 'arc_midpoint_recontextualization',
    requiredRealization: ['season_arc', 'scene_turn', 'mechanic_pressure', 'final_prose'],
    targetEpisodeNumbers: [1],
    targetSceneIds: ['s1-1'],
    eventAtoms: ['The glamorous new life is underneath a funnel'],
    blockingLevel: 'treatment',
    ...overrides,
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

  it('fails when a scene carries a seven-point beat contract but drops the authored event', () => {
    const zp = sevenPointContract();
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract({
            centralTurn: 'Kylie realizes Victor is dangerous.',
            turnEvent: 'Kylie realizes Victor is dangerous.',
          }),
          sevenPointBeatContracts: [zp],
          beats: [
            beat('b1', 'Kylie arrives at the apartment still thinking about Victor.', {
              sequenceIntent: { beatRole: 'setup' },
            }),
            beat('b2', 'Kylie realizes Victor is dangerous.', {
              sequenceIntent: { beatRole: 'turn' },
            }),
            beat('b3', 'Afterward, she locks the door and decides to call Stela.', {
              sequenceIntent: { beatRole: 'aftermath' },
            }),
          ],
        }),
      ]),
      scenePlan: {
        ...plan(),
        scenes: [{
          ...plan().scenes[0],
          sevenPointBeatContracts: [zp],
        }],
      },
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('seven-point midpoint'))).toBe(true);
  });

  it('fails when a scene carries an arc pressure contract but drops the authored event', () => {
    const arc = arcPressureContract();
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract({
            centralTurn: 'Kylie realizes Victor is dangerous.',
            turnEvent: 'Kylie realizes Victor is dangerous.',
          }),
          arcPressureContracts: [arc],
          beats: [
            beat('b1', 'Kylie arrives at the rooftop still trying to enjoy the night.', {
              sequenceIntent: { beatRole: 'setup' },
            }),
            beat('b2', 'Kylie realizes Victor is dangerous.', {
              sequenceIntent: { beatRole: 'turn' },
            }),
            beat('b3', 'Afterward, she leaves with Mika and keeps checking the door.', {
              sequenceIntent: { beatRole: 'aftermath' },
            }),
          ],
        }),
      ]),
      scenePlan: {
        ...plan(),
        scenes: [{
          ...plan().scenes[0],
          arcPressureContracts: [arc],
        }],
      },
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('arc pressure'))).toBe(true);
  });
});
