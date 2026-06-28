import { describe, expect, it } from 'vitest';
import type { Scene, Story } from '../../types';
import { RouteContinuityValidator } from './RouteContinuityValidator';

function makeStory(scenes: Scene[], startingSceneId = scenes[0]?.id || 'scene-1'): Story {
  return {
    id: 'route-continuity-test',
    title: 'Route Continuity Test',
    genre: 'supernatural romance',
    synopsis: 'A test story.',
    coverImage: '',
    author: 'Test',
    tags: [],
    initialState: {
      attributes: {
        charm: 0,
        wit: 0,
        courage: 0,
        empathy: 0,
        resolve: 0,
        resourcefulness: 0,
      },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [
      { id: 'victor', name: 'Victor', description: 'The intended rescuer.', role: 'rescuer' },
      { id: 'radu', name: 'Radu', description: 'A rival antagonist.', role: 'antagonist' },
    ],
    episodes: [{
      id: 'episode-1',
      number: 1,
      title: 'Episode 1',
      synopsis: 'Test episode.',
      coverImage: '',
      startingSceneId,
      scenes,
    }],
  } as Story;
}

describe('RouteContinuityValidator', () => {
  it('blocks choice bridges that route through a sibling choice payoff', () => {
    const story = makeStory([{
      id: 'cold-open',
      name: 'Cold Open',
      startingBeatId: 'choice-beat',
      beats: [
        {
          id: 'choice-beat',
          text: 'Sadie asks if there are vampires in Romania.',
          choices: [
            { id: 'c1-joke', text: 'Joke back.', nextBeatId: 'bridge-c1-joke' },
            { id: 'c2-deflect', text: 'Deflect.', nextBeatId: 'bridge-c2-deflect' },
          ],
        },
        {
          id: 'bridge-c1-joke',
          text: 'Only the ones I am going to date, baby.',
          isChoiceBridge: true,
          routeContext: {
            sourceSceneId: 'cold-open',
            sourceBeatId: 'choice-beat',
            sourceChoiceId: 'c1-joke',
            choiceSummary: 'Joke back.',
          },
          nextBeatId: 'bridge-c2-deflect',
        },
        {
          id: 'bridge-c2-deflect',
          text: 'You change the subject before the apartment can answer.',
          isChoiceBridge: true,
          routeContext: {
            sourceSceneId: 'cold-open',
            sourceBeatId: 'choice-beat',
            sourceChoiceId: 'c2-deflect',
            choiceSummary: 'Deflect.',
          },
          nextSceneId: 'next-scene',
        },
      ],
      leadsTo: ['next-scene'],
    }, {
      id: 'next-scene',
      name: 'Next Scene',
      startingBeatId: 'next-beat',
      beats: [{ id: 'next-beat', text: 'The next scene begins.', choices: [] }],
    } as Scene]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('choice_bridge_sibling_leak');
  });

  it('blocks route chronology that stages later Bite Me events before earlier setup', () => {
    const story = makeStory([
      {
        id: 'arrival',
        name: 'Grandmother Apartment Arrival',
        startingBeatId: 'arrival-beat',
        beats: [{ id: 'arrival-beat', text: 'You arrive in Bucharest with one suitcase and Sadie on FaceTime.', nextSceneId: 'walk-home', choices: [] }],
        leadsTo: ['walk-home'],
      },
      {
        id: 'walk-home',
        name: 'Victor Walks Kylie Home',
        startingBeatId: 'walk-beat',
        beats: [{ id: 'walk-beat', text: 'The cobblestones are slick under your heels. Victor guides you home with a steady hand at the small of your back.', nextSceneId: 'rooftop', choices: [] }],
        leadsTo: ['rooftop'],
      },
      {
        id: 'rooftop',
        name: 'Valcescu Rooftop',
        startingBeatId: 'roof-beat',
        beats: [{ id: 'roof-beat', text: 'On the rooftop above Vâlcescu Club, Victor finally steps out of the dark beside Mika.', choices: [] }],
      },
    ]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('route_chronology_violation');
  });

  it('blocks generic fallback language before it can score as polished prose', () => {
    const story = makeStory([{
      id: 'cold-open',
      name: 'Cold Open',
      startingBeatId: 'beat-1',
      beats: [{
        id: 'beat-1',
        text: "Kylie Marinescu's composed surface slips through a small evasive movement as her hands and attention lock onto the window.",
        choices: [],
      }],
    }]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('unsafe_fallback_prose');
  });

  it('blocks rescue role swaps when treatment metadata names a required rescuer', () => {
    const story = makeStory([{
      id: 'park-attack',
      name: 'Cismigiu Attack',
      startingBeatId: 'attack-beat',
      authoredTreatmentFields: [{
        id: 'field-1',
        episodeNumber: 1,
        fieldName: 'Episode turns',
        sourceText: 'Victor rescues Kylie during the Cișmigiu Park attack and gets her home.',
        contractKind: 'encounter_anchor',
        requiredRealization: ['encounter', 'scene_turn', 'final_prose'],
        targetSceneIds: ['park-attack'],
        blockingLevel: 'structural',
      }],
      beats: [{
        id: 'attack-beat',
        text: 'Radu rescues you from the attacker and pulls you through the park gate.',
        choices: [],
      }],
    } as Scene]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('role_fidelity_violation');
  });
});
