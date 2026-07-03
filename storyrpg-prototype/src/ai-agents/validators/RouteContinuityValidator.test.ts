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

  it('blocks synthetic lead-in filler from removed SceneWriter padding as unsafe fallback prose', () => {
    const story = makeStory([{
      id: 'filler-scene',
      name: 'Filler Scene',
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          text: 'Pressure is already mounting around you as this moment opens.',
          nextBeatId: 'beat-2',
          choices: [],
        },
        {
          id: 'beat-2',
          text: 'Kylie Marinescu reads another specific shift in the moment before choosing a response.',
          choices: [],
        },
      ],
    }]);

    const result = new RouteContinuityValidator().validate({ story });

    const fillerIssues = result.issues.filter((issue) => issue.type === 'unsafe_fallback_prose');
    expect(fillerIssues.length).toBeGreaterThanOrEqual(2);
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

  it('does not flag escort body-language memory without movement context as a walk-home restage', () => {
    const walkHomeEvent = {
      key: 'cue:walkHome',
      cue: 'walkHome' as const,
      text: 'Walking home through the park, she is attacked and rescued by the stranger, who walks her to her threshold and vanishes.',
      sourceContractIds: ['walk-turn'],
    };
    const story = makeStory([
      {
        id: 'walk-owner',
        name: 'Walk Owner',
        startingBeatId: 'walk-beat',
        sceneEventOwnership: {
          id: 'walk-owner-event-ownership',
          sceneId: 'walk-owner',
          ownedEvents: [walkHomeEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['walk-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'walk-beat',
          text: 'Avery Vale walks you home through the dark park to your threshold, then vanishes.',
          nextSceneId: 'writing-later',
          choices: [],
        }],
        leadsTo: ['writing-later'],
      },
      {
        id: 'writing-later',
        name: 'Writing Later',
        startingBeatId: 'writing-beat',
        sceneEventOwnership: {
          id: 'writing-later-event-ownership',
          sceneId: 'writing-later',
          ownedEvents: [],
          incomingContext: [walkHomeEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [walkHomeEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'writing-beat',
          text: 'You find it, finally: the sudden, impossible weight of a hand on the small of your back. You delete the draft twice before the sentence holds.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('does not count deadbolt-slides-home idiom windows against the walk-home recap exemption', () => {
    // bite-me 2026-07-03T05-47-21 s1-5: the only walk-home mention is a
    // blog-post recap ("The attack, the rescue, the walk home"), but two
    // "deadbolt sliding home" idiom sentences matched the old bare-`home`
    // window pattern as non-recap windows and defeated the exemption.
    const walkHomeEvent = {
      key: 'cue:walkHome',
      cue: 'walkHome' as const,
      text: 'Walking home through the park, she is attacked and rescued by the stranger, who walks her to her threshold and vanishes.',
      sourceContractIds: ['walk-turn'],
    };
    const story = makeStory([
      {
        id: 'walk-owner',
        name: 'Walk Owner',
        startingBeatId: 'walk-beat',
        sceneEventOwnership: {
          id: 'walk-owner-event-ownership',
          sceneId: 'walk-owner',
          ownedEvents: [walkHomeEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['walk-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'walk-beat',
          text: 'Avery Vale walks you home through the dark park to your threshold, then vanishes.',
          nextSceneId: 'writing-later',
          choices: [],
        }],
        leadsTo: ['writing-later'],
      },
      {
        id: 'writing-later',
        name: 'Writing Later',
        startingBeatId: 'writing-beat',
        sceneEventOwnership: {
          id: 'writing-later-event-ownership',
          sceneId: 'writing-later',
          ownedEvents: [],
          incomingContext: [walkHomeEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [walkHomeEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [
          {
            id: 'writing-beat',
            text: 'The heavy oak door clicks shut, the deadbolt sliding home with a finality that does not feel entirely safe. The rest pours out, The attack, the rescue, the walk home. Every detail sharp and strange. You hit publish just as the sky begins to lighten.',
            choices: [],
          },
        ],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('still blocks an actual walk-home restage in a scene forbidden from restaging it', () => {
    const walkHomeEvent = {
      key: 'cue:walkHome',
      cue: 'walkHome' as const,
      text: 'Walking home through the park, she is attacked and rescued by the stranger, who walks her to her threshold and vanishes.',
      sourceContractIds: ['walk-turn'],
    };
    const story = makeStory([
      {
        id: 'walk-owner',
        name: 'Walk Owner',
        startingBeatId: 'walk-beat',
        sceneEventOwnership: {
          id: 'walk-owner-event-ownership',
          sceneId: 'walk-owner',
          ownedEvents: [walkHomeEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['walk-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'walk-beat',
          text: 'Avery Vale walks you home through the dark park to your threshold, then vanishes.',
          nextSceneId: 'replay-later',
          choices: [],
        }],
        leadsTo: ['replay-later'],
      },
      {
        id: 'replay-later',
        name: 'Replay Later',
        startingBeatId: 'replay-beat',
        sceneEventOwnership: {
          id: 'replay-later-event-ownership',
          sceneId: 'replay-later',
          ownedEvents: [],
          incomingContext: [walkHomeEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [walkHomeEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'replay-beat',
          text: 'He walks you home again through the park with a hand on the small of your back, delivering you to your door as if this is the first night.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('route_duplicate_event');
    expect(result.issues.some((issue) => issue.message.includes('restages walkHome'))).toBe(true);
  });

  // Regression: bite-me_2026-07-03T05-47-21 s1-5 — Kylie recounts the night
  // while drafting the blog post; "the walk home" is a noun-phrase mention in
  // a recounting enumeration, not a restaged walk-home event.
  it('does not flag a recounting enumeration ("the walk home") as a walk-home restage', () => {
    const walkHomeEvent = {
      key: 'cue:walkHome',
      cue: 'walkHome' as const,
      text: 'Walking home through Cismigiu, she is attacked and rescued by the impossibly handsome stranger, who walks her to her threshold and vanishes.',
      sourceContractIds: ['walk-turn'],
    };
    const story = makeStory([
      {
        id: 'walk-owner',
        name: 'Walk Owner',
        startingBeatId: 'walk-beat',
        sceneEventOwnership: {
          id: 'walk-owner-event-ownership',
          sceneId: 'walk-owner',
          ownedEvents: [walkHomeEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['walk-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'walk-beat',
          text: 'Avery Vale walks you home through the dark park to your threshold, then vanishes.',
          nextSceneId: 'blog-draft',
          choices: [],
        }],
        leadsTo: ['blog-draft'],
      },
      {
        id: 'blog-draft',
        name: 'Blog Draft',
        startingBeatId: 'deadbolt-beat',
        sceneEventOwnership: {
          id: 'blog-draft-event-ownership',
          sceneId: 'blog-draft',
          ownedEvents: [{
            key: 'cue:lateNightWriting',
            cue: 'lateNightWriting' as const,
            text: 'At 4am she turns the night into the first blog post.',
            sourceContractIds: ['blog-turn'],
          }],
          incomingContext: [walkHomeEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [walkHomeEvent],
          sourceContractIds: ['blog-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [
          {
            id: 'deadbolt-beat',
            text: 'The heavy oak door slams shut, and you frantically slide the deadbolt home.',
            nextBeatId: 'recount-beat',
            choices: [],
          },
          {
            id: 'recount-beat',
            text: 'The rest pours out, The attack, the rescue, the walk home. Every detail sharp and strange. You hit publish just as the sky begins to lighten. The story is out there now, yours again.',
            choices: [],
          },
        ],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('keeps the walk-home recap exemption when unrelated "home" idioms share the scene', () => {
    const walkHomeEvent = {
      key: 'cue:walkHome',
      cue: 'walkHome' as const,
      text: 'Walking home through the park, she is attacked and rescued by the stranger, who walks her to her threshold and vanishes.',
      sourceContractIds: ['walk-turn'],
    };
    const story = makeStory([
      {
        id: 'walk-owner',
        name: 'Walk Owner',
        startingBeatId: 'walk-beat',
        sceneEventOwnership: {
          id: 'walk-owner-event-ownership',
          sceneId: 'walk-owner',
          ownedEvents: [walkHomeEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['walk-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'walk-beat',
          text: 'Avery Vale walks you home through the dark park to your threshold, then vanishes.',
          nextSceneId: 'memory-later',
          choices: [],
        }],
        leadsTo: ['memory-later'],
      },
      {
        id: 'memory-later',
        name: 'Memory Later',
        startingBeatId: 'memory-beat',
        sceneEventOwnership: {
          id: 'memory-later-event-ownership',
          sceneId: 'memory-later',
          ownedEvents: [],
          incomingContext: [walkHomeEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [walkHomeEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [
          {
            id: 'memory-beat',
            text: 'You remember how Avery Vale walks you home through the dark park.',
            nextBeatId: 'idiom-beat',
            choices: [],
          },
          {
            id: 'idiom-beat',
            text: 'The heavy oak door clicks shut, the deadbolt sliding home with a finality that doesn\'t feel entirely safe.',
            choices: [],
          },
        ],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('uses event ownership to block active restaging of an earlier owned route event', () => {
    const story = makeStory([
      {
        id: 'door-owner',
        name: 'Door Owner',
        startingBeatId: 'door-beat',
        sceneEventOwnership: {
          id: 'door-owner-event-ownership',
          sceneId: 'door-owner',
          ownedEvents: [{
            key: 'cue:venueDoor',
            cue: 'venueDoor',
            text: 'A host hands over a private club key card at the side entrance.',
            sourceContractIds: ['door-turn'],
          }],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['door-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'door-beat',
          text: 'A host hands you a private club key card at the side entrance.',
          nextSceneId: 'later',
          choices: [],
        }],
        leadsTo: ['later'],
      },
      {
        id: 'later',
        name: 'Later Consequence',
        startingBeatId: 'later-beat',
        sceneEventOwnership: {
          id: 'later-event-ownership',
          sceneId: 'later',
          ownedEvents: [],
          incomingContext: [{
            key: 'cue:venueDoor',
            cue: 'venueDoor',
            text: 'A host hands over a private club key card at the side entrance.',
            sourceContractIds: ['door-turn'],
          }],
          outgoingResidue: [],
          forbiddenRestageEvents: [{
            key: 'cue:venueDoor',
            cue: 'venueDoor',
            text: 'A host hands over a private club key card at the side entrance.',
            sourceContractIds: ['door-turn'],
          }],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'later-beat',
          text: 'The private club door opens for you again, and the host pulls you through the side entrance as if this is the first invitation.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('route_duplicate_event');
    expect(result.issues.some((issue) => issue.message.includes('restages venueDoor'))).toBe(true);
  });

  it('allows ownership-aware recap of an earlier event when prose is clearly aftermath', () => {
    const ownedEvent = {
      key: 'cue:venueDoor',
      cue: 'venueDoor' as const,
      text: 'A host sends a private club invitation.',
      sourceContractIds: ['door-turn'],
    };
    const story = makeStory([
      {
        id: 'door-owner',
        name: 'Door Owner',
        startingBeatId: 'door-beat',
        sceneEventOwnership: {
          id: 'door-owner-event-ownership',
          sceneId: 'door-owner',
          ownedEvents: [ownedEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['door-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'door-beat',
          text: 'A host sends a private club invitation.',
          nextSceneId: 'later',
          choices: [],
        }],
        leadsTo: ['later'],
      },
      {
        id: 'later',
        name: 'Later Consequence',
        startingBeatId: 'later-beat',
        sceneEventOwnership: {
          id: 'later-event-ownership',
          sceneId: 'later',
          ownedEvents: [],
          incomingContext: [ownedEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [ownedEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'later-beat',
          text: 'After the private club invitation, the blog comments spike and turn the earlier door into public aftermath.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('uses scene event ownership to ignore non-owned cold-open cue words during chronology checks', () => {
    const story = makeStory([
      {
        id: 'cold-open',
        name: 'Opening Arrival',
        startingBeatId: 'cold-beat',
        sceneEventOwnership: {
          id: 'cold-open-event-ownership',
          sceneId: 'cold-open',
          ownedEvents: [{
            key: 'cue:arrival',
            cue: 'arrival',
            text: 'Mara arrives in the city with two suitcases.',
            sourceContractIds: ['arrival-turn'],
          }],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['arrival-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'cold-beat',
          text: 'Mara arrives in the city with two suitcases. The question is what she will write, and what hunts in the dark.',
          nextSceneId: 'club',
          choices: [],
        }],
        leadsTo: ['club'],
      },
      {
        id: 'club',
        name: 'First Table',
        startingBeatId: 'club-beat',
        sceneEventOwnership: {
          id: 'club-event-ownership',
          sceneId: 'club',
          ownedEvents: [{
            key: 'cue:socialMeet',
            cue: 'socialMeet',
            text: 'Mara meets the table at the club.',
            sourceContractIds: ['social-turn'],
          }],
          incomingContext: [{
            key: 'cue:arrival',
            cue: 'arrival',
            text: 'Mara arrives in the city with two suitcases.',
            sourceContractIds: ['arrival-turn'],
          }],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['social-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'club-beat',
          text: 'At the club table, two strangers meet Mara over dark drinks.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_chronology_violation');
    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('treats static luggage or address mentions after a social scene as arrival context, not a new arrival', () => {
    const arrivalEvent = {
      key: 'cue:arrival',
      cue: 'arrival' as const,
      text: 'Mara arrives in the city with two suitcases.',
      sourceContractIds: ['arrival-turn'],
    };
    const socialEvent = {
      key: 'cue:socialMeet',
      cue: 'socialMeet' as const,
      text: 'Mara meets the night-table circle over drinks.',
      sourceContractIds: ['social-turn'],
    };
    const story = makeStory([
      {
        id: 'opening',
        name: 'Opening Arrival',
        startingBeatId: 'opening-beat',
        sceneEventOwnership: {
          id: 'opening-event-ownership',
          sceneId: 'opening',
          ownedEvents: [arrivalEvent, socialEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['arrival-turn', 'social-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'opening-beat',
          text: 'The taxi drops Mara at the curb with two suitcases. Three weeks later, the table gathers around her over dark drinks.',
          nextSceneId: 'booth',
          choices: [],
        }],
        leadsTo: ['booth'],
      },
      {
        id: 'booth',
        name: 'Booth Context',
        startingBeatId: 'booth-beat',
        sceneEventOwnership: {
          id: 'booth-event-ownership',
          sceneId: 'booth',
          ownedEvents: [arrivalEvent],
          incomingContext: [arrivalEvent, socialEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['arrival-context'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'booth-beat',
          text: 'At the velvet booth, the suitcases tucked beside you and the old address in your pocket are context, not a fresh entrance.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_chronology_violation');
  });

  it('allows threat-event memory in a later aftermath scene without treating it as restaging', () => {
    const ownedEvent = {
      key: 'cue:threatEncounter',
      cue: 'threatEncounter' as const,
      text: 'A masked figure attacks Mara and Avery rescues her.',
      sourceContractIds: ['threat-turn'],
    };
    const story = makeStory([
      {
        id: 'threat-owner',
        name: 'Threat Owner',
        startingBeatId: 'threat-beat',
        sceneEventOwnership: {
          id: 'threat-owner-event-ownership',
          sceneId: 'threat-owner',
          ownedEvents: [ownedEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['threat-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'threat-beat',
          text: 'A masked figure attacks Mara under the bridge, and Avery rescues her before the knife reaches her coat.',
          nextSceneId: 'later',
          choices: [],
        }],
        leadsTo: ['later'],
      },
      {
        id: 'later',
        name: 'Aftermath',
        startingBeatId: 'later-beat',
        sceneEventOwnership: {
          id: 'later-event-ownership',
          sceneId: 'later',
          ownedEvents: [],
          incomingContext: [ownedEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [ownedEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'later-beat',
          text: 'The memory of the attack is still raw, but tonight Mara writes about the rescue instead of replaying it.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('allows a later creative-processing recap of a threat event', () => {
    const ownedEvent = {
      key: 'cue:threatEncounter',
      cue: 'threatEncounter' as const,
      text: 'A masked figure attacks Mara and Avery rescues her.',
      sourceContractIds: ['threat-turn'],
    };
    const story = makeStory([
      {
        id: 'threat-owner',
        name: 'Threat Owner',
        startingBeatId: 'threat-beat',
        sceneEventOwnership: {
          id: 'threat-owner-event-ownership',
          sceneId: 'threat-owner',
          ownedEvents: [ownedEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['threat-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'threat-beat',
          text: 'A masked figure attacks Mara under the bridge, and Avery rescues her before the knife reaches her coat.',
          nextSceneId: 'later',
          choices: [],
        }],
        leadsTo: ['later'],
      },
      {
        id: 'later',
        name: 'Writing Aftermath',
        startingBeatId: 'later-beat',
        sceneEventOwnership: {
          id: 'later-event-ownership',
          sceneId: 'later',
          ownedEvents: [],
          incomingContext: [ownedEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [ownedEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'later-beat',
          text: 'The attack in the park, the impossible rescue, feels like a fever dream you have to write down.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('allows short noun-fragment rescue memories in a later writing scene', () => {
    const ownedEvent = {
      key: 'cue:threatEncounter',
      cue: 'threatEncounter' as const,
      text: 'A masked figure attacks Mara and Avery rescues her.',
      sourceContractIds: ['threat-turn'],
    };
    const story = makeStory([
      {
        id: 'threat-owner',
        name: 'Threat Owner',
        startingBeatId: 'threat-beat',
        sceneEventOwnership: {
          id: 'threat-owner-event-ownership',
          sceneId: 'threat-owner',
          ownedEvents: [ownedEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['threat-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'threat-beat',
          text: 'A masked figure attacks Mara under the bridge, and Avery rescues her before the knife reaches her coat.',
          nextSceneId: 'later',
          choices: [],
        }],
        leadsTo: ['later'],
      },
      {
        id: 'later',
        name: 'Writing Aftermath',
        startingBeatId: 'later-beat',
        sceneEventOwnership: {
          id: 'later-event-ownership',
          sceneId: 'later',
          ownedEvents: [],
          incomingContext: [ownedEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [ownedEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'later-beat',
          text: 'Back in your room, the memory of the attack stays sharp. But the rescue. That is something else. You write about the sudden dark and the man who appeared from the fog.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('allows a distinct later danger escalation without treating it as the prior attack restaged', () => {
    const ownedEvent = {
      key: 'cue:threatEncounter',
      cue: 'threatEncounter' as const,
      text: 'A masked figure attacks Mara under the bridge, and Avery rescues her from the knife.',
      sourceContractIds: ['threat-turn'],
    };
    const story = makeStory([
      {
        id: 'threat-owner',
        name: 'Threat Owner',
        startingBeatId: 'threat-beat',
        sceneEventOwnership: {
          id: 'threat-owner-event-ownership',
          sceneId: 'threat-owner',
          ownedEvents: [ownedEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['threat-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'threat-beat',
          text: 'A masked figure attacks Mara under the bridge, and Avery rescues her from the knife.',
          nextSceneId: 'later',
          choices: [],
        }],
        leadsTo: ['later'],
      },
      {
        id: 'later',
        name: 'Club Escalation',
        startingBeatId: 'later-beat',
        sceneEventOwnership: {
          id: 'later-event-ownership',
          sceneId: 'later',
          ownedEvents: [],
          incomingContext: [ownedEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [ownedEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'later-beat',
          text: 'At the velvet club, a bouncer grabs your arm. Radu saves you from being thrown into the alley, but his resentment is obvious.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).not.toContain('route_duplicate_event');
  });

  it('still blocks a later scene that replays the same owned attack and rescue', () => {
    const ownedEvent = {
      key: 'cue:threatEncounter',
      cue: 'threatEncounter' as const,
      text: 'A masked figure attacks Mara under the bridge, and Avery rescues her from the knife.',
      sourceContractIds: ['threat-turn'],
    };
    const story = makeStory([
      {
        id: 'threat-owner',
        name: 'Threat Owner',
        startingBeatId: 'threat-beat',
        sceneEventOwnership: {
          id: 'threat-owner-event-ownership',
          sceneId: 'threat-owner',
          ownedEvents: [ownedEvent],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['threat-turn'],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'threat-beat',
          text: 'A masked figure attacks Mara under the bridge, and Avery rescues her from the knife.',
          nextSceneId: 'later',
          choices: [],
        }],
        leadsTo: ['later'],
      },
      {
        id: 'later',
        name: 'Restaged Threat',
        startingBeatId: 'later-beat',
        sceneEventOwnership: {
          id: 'later-event-ownership',
          sceneId: 'later',
          ownedEvents: [],
          incomingContext: [ownedEvent],
          outgoingResidue: [],
          forbiddenRestageEvents: [ownedEvent],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        },
        beats: [{
          id: 'later-beat',
          text: 'Under the same bridge, the masked figure attacks Mara again and Avery rescues her from the knife as if the first scene never happened.',
          choices: [],
        }],
      },
    ] as Scene[]);

    const result = new RouteContinuityValidator().validate({ story });

    expect(result.issues.map((issue) => issue.type)).toContain('route_duplicate_event');
  });
});
