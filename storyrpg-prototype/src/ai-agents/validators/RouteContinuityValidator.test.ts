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
      { id: 'rescuer', name: 'Avery Vale', description: 'The intended rescuer.', role: 'rescuer' },
      { id: 'rival', name: 'Morgan Ash', description: 'A rival antagonist.', role: 'antagonist' },
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
          text: 'A friend asks whether the new city has teeth.',
          choices: [
            { id: 'c1-joke', text: 'Joke back.', nextBeatId: 'bridge-c1-joke' },
            { id: 'c2-deflect', text: 'Deflect.', nextBeatId: 'bridge-c2-deflect' },
          ],
        },
        {
          id: 'bridge-c1-joke',
          text: 'Only the ones worth writing about.',
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

  it('blocks route chronology that stages a later event before earlier setup', () => {
    const story = makeStory([
      {
        id: 'arrival',
        name: 'Apartment Arrival',
        startingBeatId: 'arrival-beat',
        beats: [{ id: 'arrival-beat', text: 'You arrive in the city with one suitcase and a friend on FaceTime.', nextSceneId: 'walk-home', choices: [] }],
        leadsTo: ['walk-home'],
      },
      {
        id: 'walk-home',
        name: 'Guided Walk Home',
        startingBeatId: 'walk-beat',
        beats: [{ id: 'walk-beat', text: 'The cobblestones are slick under your heels. Avery Vale guides you home with a steady hand at the small of your back.', nextSceneId: 'rooftop', choices: [] }],
        leadsTo: ['rooftop'],
      },
      {
        id: 'rooftop',
        name: 'Rooftop Meeting',
        startingBeatId: 'roof-beat',
        beats: [{ id: 'roof-beat', text: 'On the rooftop above the private club, Avery finally steps out of the dark beside a host.', choices: [] }],
      },
    ]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('route_chronology_violation');
  });

  it('allows distinct social scenes without treating them as duplicate route events', () => {
    const story = makeStory([
      {
        id: 'arrival',
        name: 'City Arrival',
        startingBeatId: 'arrival-beat',
        beats: [{
          id: 'arrival-beat',
          text: 'The protagonist arrives in the city with two suitcases and an old address.',
          nextSceneId: 'friends',
          choices: [],
        }],
        leadsTo: ['friends'],
      },
      {
        id: 'friends',
        name: 'Friend Group Forms',
        startingBeatId: 'friends-beat',
        beats: [{
          id: 'friends-beat',
          text: 'Two new acquaintances gather the friend group over too-dark drinks and trade jokes about starting over.',
          nextSceneId: 'rooftop',
          choices: [],
        }],
        leadsTo: ['rooftop'],
      },
      {
        id: 'rooftop',
        name: 'Rooftop bar',
        startingBeatId: 'roof-beat',
        beats: [{
          id: 'roof-beat',
          text: 'On the rooftop, a charcoal-suited stranger watches from across the bar.',
          choices: [],
        }],
      },
    ]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
    expect(result.issues.map((issue) => issue.type)).not.toContain('route_chronology_violation');
  });

  it('does not use generated scene summary names as route event evidence', () => {
    const story = makeStory([
      {
        id: 'social-scene',
        name: 'Rooftop social pressure',
        startingBeatId: 'social-beat',
        beats: [{
          id: 'social-beat',
          text: 'At the terrace bar, the protagonist trades guarded jokes with a new ally.',
          nextSceneId: 'summary-named-scene',
          choices: [],
        }],
        leadsTo: ['summary-named-scene'],
      },
      {
        id: 'summary-named-scene',
        name: 'The protagonist arrives with bags before joining the terrace circle',
        startingBeatId: 'after-beat',
        beats: [{
          id: 'after-beat',
          text: 'The conversation continues in the apartment, focused on what to publish next.',
          choices: [],
        }],
      },
    ]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_chronology_violation');
  });

  it('does not treat publication aftermath, online club requests, or rescue recaps as duplicated primary events', () => {
    const story = makeStory([
      {
        id: 'attack',
        name: 'Park Attack',
        startingBeatId: 'attack-beat',
        beats: [{
          id: 'attack-beat',
          text: 'In the park, rough hands grab your coat before a stranger rescues you from the fog.',
          nextSceneId: 'publication',
          choices: [],
        }],
        leadsTo: ['publication'],
      },
      {
        id: 'publication',
        name: 'Publication Aftermath',
        startingBeatId: 'post-beat',
        beats: [{
          id: 'post-beat',
          text: 'By evening, the public post is viral. A reader requests access to the online night club, and the essay turns the rescue story into proof that the city is watching.',
          choices: [],
        }],
      },
    ]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
    expect(result.issues.map((issue) => issue.type)).not.toContain('route_chronology_violation');
  });

  it('blocks generic fallback language before it can score as polished prose', () => {
    const story = makeStory([{
      id: 'cold-open',
      name: 'Cold Open',
      startingBeatId: 'beat-1',
      beats: [{
        id: 'beat-1',
        text: "The protagonist's composed surface slips through a small evasive movement as their hands and attention lock onto the window.",
        choices: [],
      }],
    }]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('unsafe_fallback_prose');
  });

  it('scans textVariant prose without treating callback control fields as reader-facing prose', () => {
    const story = makeStory([{
      id: 'callback-scene',
      name: 'Callback Scene',
      startingBeatId: 'beat-1',
      beats: [{
        id: 'beat-1',
        text: 'You set the folded note on the counter.',
        textVariants: [{
          condition: { type: 'flag', flag: 'internal_setup_flag', value: true },
          callbackHookId: 'flag:internal_setup_flag',
          text: 'The folded note is still on the counter when the argument returns to it.',
        }],
        choices: [],
      }],
    }]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues).toEqual([]);
  });

  it('still blocks unsafe fallback prose inside textVariant text', () => {
    const story = makeStory([{
      id: 'callback-scene',
      name: 'Callback Scene',
      startingBeatId: 'beat-1',
      beats: [{
        id: 'beat-1',
        text: 'You set the folded note on the counter.',
        textVariants: [{
          condition: { type: 'flag', flag: 'internal_setup_flag', value: true },
          callbackHookId: 'flag:internal_setup_flag',
          text: 'A visible gesture, object cue, or shift in distance changes the room.',
        }],
        choices: [],
      }],
    }]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('unsafe_fallback_prose');
  });

  it('blocks rescue role swaps when treatment metadata names a required rescuer', () => {
    const story = makeStory([{
      id: 'park-attack',
      name: 'Park Attack',
      startingBeatId: 'attack-beat',
      authoredTreatmentFields: [{
        id: 'field-1',
        episodeNumber: 1,
        fieldName: 'Episode turns',
        sourceText: 'Avery Vale rescues the protagonist during the park attack and gets them home.',
        contractKind: 'encounter_anchor',
        requiredRealization: ['encounter', 'scene_turn', 'final_prose'],
        targetSceneIds: ['park-attack'],
        blockingLevel: 'structural',
      }],
      beats: [{
        id: 'attack-beat',
        text: 'Morgan Ash rescues you from the attacker and pulls you through the park gate.',
        choices: [],
      }],
    } as Scene]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('role_fidelity_violation');
  });

  it('does not treat descriptive rescuer phrases as proper-name role obligations', () => {
    const story = makeStory([{
      id: 'park-attack',
      name: 'Park Attack',
      startingBeatId: 'attack-beat',
      authoredTreatmentFields: [{
        id: 'field-1',
        episodeNumber: 1,
        fieldName: 'Episode turns',
        sourceText: 'The protagonist is rescued by the masked stranger and reaches the threshold alive.',
        contractKind: 'encounter_anchor',
        requiredRealization: ['encounter', 'scene_turn', 'final_prose'],
        targetSceneIds: ['park-attack'],
        blockingLevel: 'structural',
      }],
      beats: [{
        id: 'attack-beat',
        text: 'A masked stranger rescues you from the attacker and disappears before you can learn a name.',
        choices: [],
      }],
    } as Scene]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('role_fidelity_violation');
  });
});
