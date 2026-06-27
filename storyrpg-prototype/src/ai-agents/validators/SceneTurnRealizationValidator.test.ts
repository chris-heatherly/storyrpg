import { describe, expect, it } from 'vitest';
import type { Beat, Scene, Story } from '../../types';
import type {
  ArcPressureTreatmentContract,
  SceneTurnContract,
  SeasonScenePlan,
  StoryCircleBeatRealizationContract,
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

function storyCircleContract(overrides: Partial<StoryCircleBeatRealizationContract> = {}): StoryCircleBeatRealizationContract {
  return {
    id: 'Story Circle-midpoint-mirror',
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
const cismigiuTurn =
  'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow — and a second figure in a charcoal suit drops the attacker, walks her home, kisses her hand at the threshold, declines to come in, and vanishes.';

function cismigiuEncounter(extraText = '') {
  return {
    phases: [{
      id: 'phase-1',
      name: 'Cișmigiu',
      description: cismigiuTurn,
      situationImage: '',
      beats: [{
        id: 'beat-1',
        phase: 'setup',
        name: 'Willow',
        setupText: 'At 1am in Cișmigiu, a shadow pins you against the willow.',
        choices: [{
          id: 'fight',
          text: 'Fight for air.',
          approach: 'aggressive',
          outcomes: {
            success: {
              tier: 'success',
              goalTicks: 2,
              threatTicks: 0,
              narrativeText: `A second figure in a charcoal suit drops the attacker and walks you home. ${extraText}`,
            },
            complicated: {
              tier: 'complicated',
              goalTicks: 1,
              threatTicks: 1,
              narrativeText: 'The shadow releases you.',
            },
            failure: {
              tier: 'failure',
              goalTicks: 0,
              threatTicks: 2,
              narrativeText: 'The shadow keeps its grip.',
            },
          },
        }],
      }],
    }],
    storylets: {
      victory: {
        beats: [{ id: 'victory-b1', text: extraText }],
      },
    },
  };
}

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

  it('fails encounter scenes that do not realize their own central turn', () => {
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

    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toContain('Encounter scene "enc-1" does not dramatize its central turn');
  });

  it('passes encounter scenes when the central turn lands in nested outcome and storylet prose', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 'treatment-enc-1-1',
          encounter: cismigiuEncounter('At the threshold, he kisses your hand, declines to come in, and vanishes into the fog.') as never,
          turnContract: turnContract({ source: 'encounter', centralTurn: cismigiuTurn }),
          beats: [],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('fails encounter scenes when nested prose still skips the threshold tail', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 'treatment-enc-1-1',
          encounter: cismigiuEncounter() as never,
          turnContract: turnContract({ source: 'encounter', centralTurn: cismigiuTurn }),
          beats: [],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('does not dramatize its central turn');
  });

  it('fails planner-source scene-turn misses because planner turns are load-bearing scene contracts', () => {
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

    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe('error');
  });

  it('keeps choice-source misses as warnings when they are not structurally risky', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract({ source: 'choice', centralTurn: 'Kylie chooses to laugh off the warning.' }),
          beats: [beat('b1', 'Kylie notices the club has a side entrance.')],
        }),
      ]),
      treatmentSourced: false,
    });

    expect(result.valid).toBe(true);
    expect(result.issues[0].severity).toBe('warning');
  });

  it('fails generic planner turns that survive into final story metadata', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract({
            source: 'planner',
            centralTurn: 'Let the fallout settle into the next pressure: rising pressure.',
          }),
          beats: [
            beat('b1', 'Afterward, Kylie locks the door and studies the key card.', {
              sequenceIntent: { beatRole: 'aftermath' },
            }),
          ],
        }),
      ]),
      treatmentSourced: false,
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toContain('generic planner central turn');
  });

  it('fails when a scene carries a Story Circle beat contract but drops the authored event', () => {
    const zp = storyCircleContract();
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract({
            centralTurn: 'Kylie realizes Victor is dangerous.',
            turnEvent: 'Kylie realizes Victor is dangerous.',
          }),
          storyCircleBeatContracts: [zp],
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
          storyCircleBeatContracts: [zp],
        }],
      },
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Story Circle midpoint'))).toBe(true);
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

  it('ignores arc pressure contracts that target a different episode or scene', () => {
    const wrongEpisode = arcPressureContract({
      targetEpisodeNumbers: [2],
      targetSceneIds: ['s2-1'],
      sourceText: 'The glamorous new life is underneath a funnel.',
      eventAtoms: ['glamorous new life underneath a funnel'],
    });
    const broadQuestion = arcPressureContract({
      id: 'arc-pressure-champagne-question',
      contractKind: 'arc_question',
      fieldName: 'Arc dramatic question',
      targetEpisodeNumbers: [1],
      targetSceneIds: ['s1-1'],
      sourceText: 'Can Kylie start over in a city that does not know her ex name?',
      eventAtoms: ['Kylie start over'],
    });
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          turnContract: turnContract(),
          arcPressureContracts: [wrongEpisode, broadQuestion],
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
      scenePlan: {
        ...plan(),
        scenes: [{
          ...plan().scenes[0],
          arcPressureContracts: [wrongEpisode, broadQuestion],
        }],
      },
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('arc pressure'))).toBe(false);
  });

  it('does not merge stale planned arc pressure when the generated scene has explicit current contracts', () => {
    const midpoint = arcPressureContract({
      id: 'arc-pressure-midpoint',
      contractKind: 'arc_midpoint_recontextualization',
      fieldName: 'Midpoint recontextualization',
      targetEpisodeNumbers: [2],
      targetSceneIds: ['s2-1'],
      sourceText: 'The club is a lure and the glamorous new life is a funnel.',
      eventAtoms: ['club is a lure'],
    });
    const staleLateCrisis = arcPressureContract({
      id: 'arc-pressure-late-crisis',
      contractKind: 'arc_late_crisis',
      fieldName: 'Late-arc crisis / all-is-lost beat',
      targetEpisodeNumbers: [2],
      targetSceneIds: ['s2-1'],
      sourceText: 'At the Equinox weekend the first crack between her voice and his approval appears.',
      eventAtoms: ['Equinox weekend first crack'],
    });
    const result = validator.validate({
      story: story([
        scene({
          id: 's2-1',
          turnContract: turnContract({
            centralTurn: 'Kylie realizes Victor is dangerous.',
            turnEvent: 'Kylie realizes Victor is dangerous.',
          }),
          arcPressureContracts: [midpoint],
          beats: [
            beat('b1', 'The blog dashboard climbs while Kylie studies the invitation to Vâlcescu Club.', {
              sequenceIntent: { beatRole: 'setup' },
            }),
            beat('b2', 'Kylie realizes Victor is dangerous and that the club is a lure inside a glamorous funnel.', {
              sequenceIntent: { beatRole: 'turn' },
            }),
            beat('b3', 'Afterward, she closes the laptop but keeps the invitation open on her phone.', {
              sequenceIntent: { beatRole: 'aftermath' },
            }),
          ],
        }),
      ], 2),
      scenePlan: {
        ...plan(2),
        scenes: [{
          ...plan(2).scenes[0],
          id: 's2-1',
          episodeNumber: 2,
          arcPressureContracts: [midpoint, staleLateCrisis],
        }],
      },
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('Equinox weekend'))).toBe(false);
  });
});
