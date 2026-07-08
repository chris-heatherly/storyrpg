import { describe, expect, it } from 'vitest';
import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import {
  mergeDuplicatePublicAftermathScenes,
  validateBlueprintRouteCueOrder,
} from './blueprintRouteCuePreflight';

function scene(id: string, description: string, leadsTo: string[] = []): SceneBlueprint {
  return {
    id,
    name: id,
    description,
    location: 'test-location',
    mood: 'tense',
    purpose: 'bottleneck',
    dramaticQuestion: 'What changes here?',
    wantVsNeed: 'Want control, need truth.',
    conflictEngine: 'Pressure forces a decision.',
    npcsPresent: [],
    narrativeFunction: description,
    keyBeats: [description],
    leadsTo,
  } as SceneBlueprint;
}

function blueprint(scenes: SceneBlueprint[]): EpisodeBlueprint {
  return {
    id: 'ep1',
    episodeId: 'ep1',
    title: 'Episode 1',
    synopsis: '',
    arc: {
      you: '',
      need: '',
      go: '',
      search: '',
      find: '',
      take: '',
      return: '',
      change: '',
    },
    themes: [],
    scenes,
    startingSceneId: scenes[0]?.id,
    bottleneckScenes: [],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
  } as EpisodeBlueprint;
}

describe('validateBlueprintRouteCueOrder', () => {
  it('passes an ordered route from arrival to public aftermath', () => {
    const bp = blueprint([
      scene('scene-arrival', 'The protagonist arrives at the airport with two bags.', ['scene-social']),
      scene('scene-social', 'A rooftop bar meeting makes the social triangle visible.', ['scene-threat']),
      scene('scene-threat', 'An attacker steps from the park shadows.', ['scene-writing']),
      scene('scene-writing', 'At 3am, the protagonist writes the post.', ['scene-aftermath']),
      scene('scene-aftermath', 'By morning, the post has viral views and comments.'),
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toEqual([]);
  });

  it('flags a route that stages an earlier cue after a later threat cue', () => {
    const bp = blueprint([
      scene('scene-threat', 'An attacker steps from the park shadows.', ['scene-social']),
      scene('scene-social', 'A rooftop bar meeting makes the social triangle visible.'),
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toMatchObject([{
      type: 'route_chronology_violation',
      sceneId: 'scene-social',
    }]);
  });

  it('flags duplicate staged route events across different scenes', () => {
    const bp = blueprint([
      scene('scene-threat-a', 'An attacker steps from the park shadows.', ['scene-threat-b']),
      scene('scene-threat-b', 'A second scene restages the same attacker ambush.'),
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toMatchObject([{
      type: 'route_duplicate_event',
      sceneId: 'scene-threat-b',
    }]);
  });

  it('flags a public aftermath helper that owns a prerequisite publishing beat', () => {
    const bp = blueprint([
      scene('scene-writing', 'At 4 a.m., the narrator chooses a codename and publishes the anonymous post.', ['scene-aftermath']),
      {
        ...scene('scene-aftermath', 'By morning, the post has viral views and comments.'),
        planningOrigin: {
          kind: 'binder_split',
          splitKind: 'viral_aftermath',
          parentSceneId: 'scene-writing',
          reason: 'Split public metrics away from source scene.',
        },
        requiredBeats: [{
          id: 'late-post',
          tier: 'authored',
          sourceTurn: 'At 4 a.m., the narrator chooses a codename and publishes the anonymous post.',
          mustDepict: 'At 4 a.m., the narrator chooses a codename and publishes the anonymous post.',
        }],
      },
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toMatchObject([{
      type: 'helper_owns_prerequisite_event',
      sceneId: 'scene-aftermath',
    }]);
  });

  it('allows a public aftermath helper to summarize prior rescue as viral proof', () => {
    const bp = blueprint([
      scene('scene-threat', 'An attacker steps from the park shadows before a stranger rescues the narrator.', ['scene-writing']),
      scene('scene-writing', 'At 4 a.m., the narrator chooses a codename and publishes the anonymous post.', ['scene-aftermath']),
      {
        ...scene('scene-aftermath', 'By evening, the anonymous post has viral views and comments.'),
        planningOrigin: {
          kind: 'binder_split',
          splitKind: 'viral_aftermath',
          parentSceneId: 'scene-writing',
          reason: 'Split public metrics away from source scene.',
        },
        requiredBeats: [{
          id: 'viral-proof',
          tier: 'authored',
          sourceTurn: 'The narrator turns a terrifying rescue into the first viral proof that they can author a new life.',
          mustDepict: 'The narrator turns a terrifying rescue into the first viral proof that they can author a new life.',
        }],
      },
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toEqual([]);
  });

  it('ignores metadata-only construction obligations when deriving staged route cues', () => {
    const bp = blueprint([
      {
        ...scene('scene-arrival', 'The protagonist arrives at the station with two bags.', ['scene-social']),
        keyBeats: [
          "Introduce the reader's first meeting with the protagonist.",
          'By evening, the anonymous post has gone viral and the views keep climbing.',
        ],
        requiredBeats: [{
          id: 'future-seed',
          tier: 'seed',
          sourceTurn: 'A hidden rescuer staged the initial attack.',
          mustDepict: 'A hidden rescuer staged the initial attack.',
        }],
        sceneConstructionProfile: {
          obligations: [
            { source: 'keyBeat', id: 'keyBeat:0', slot: 'metadata_only' },
            { source: 'keyBeat', id: 'keyBeat:1', slot: 'metadata_only' },
            { source: 'requiredBeat', id: 'future-seed', slot: 'metadata_only' },
          ],
        } as SceneBlueprint['sceneConstructionProfile'],
      },
      scene('scene-social', 'A rooftop table meeting makes the social circle visible.'),
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toEqual([]);
  });

  it('does not reorder routes when arrival prose mentions writing as identity posture', () => {
    const bp = blueprint([
      {
        ...scene('scene-arrival', 'The protagonist arrives at the station with two bags.', ['scene-social']),
        requiredBeats: [{
          id: 'observer-posture',
          tier: 'authored',
          sourceTurn: 'The protagonist uses their writing to watch others rather than participate.',
          mustDepict: 'The protagonist uses their writing to watch others rather than participate.',
        }],
        sceneConstructionProfile: {
          obligations: [
            { source: 'requiredBeat', id: 'observer-posture', slot: 'must_stage' },
          ],
        } as SceneBlueprint['sceneConstructionProfile'],
      },
      scene('scene-social', 'A rooftop table meeting makes the social circle visible.'),
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toEqual([]);
  });

  it('flags a public aftermath route that precedes its late-night writing prerequisite', () => {
    const bp = blueprint([
      scene('scene-social', 'A rooftop bar meeting makes the social triangle visible.', ['scene-aftermath']),
      scene('scene-aftermath', 'By morning, the post has viral views and comments.', ['scene-writing']),
      scene('scene-writing', 'At 4 a.m., the narrator chooses a codename and publishes the anonymous post.'),
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toMatchObject([{
      type: 'route_chronology_violation',
      sceneId: 'scene-writing',
    }]);
  });

  it('does not treat a question-shaped release scene as staging late-night writing (bite-me 2026-07-07 s1-7)', () => {
    const episodeQuestion = 'Can Kylie start over, feel wanted, and write under her own name in a city that is already watching her?';
    const bp = blueprint([
      scene('s1-6', 'At 4am she turns the night into the first Dating After Dusk post under the codename Mr. Midnight.', ['s1-blog-aftermath']),
      scene('s1-blog-aftermath', 'The readership number climbs until the post becomes a public signal.', ['s1-7']),
      {
        ...scene('s1-7', episodeQuestion),
        name: 'Can Kylie start over, feel wanted, and write under.. at Kylie\'s...',
        narrativeFunction: `${episodeQuestion} The blog, Dusk Club, Victor's staged courtship, Stela's protection, Mika's placement, Radu's first sighting, and Kylie's first authored act all become live season anchors.`,
        dramaticPurpose: episodeQuestion,
        keyBeats: [
          episodeQuestion,
          `REST: ${episodeQuestion} establishes what feels stable, desired, or controlled before pressure changes it.`,
        ],
        turnContract: {
          turnId: 's1-7-turn',
          source: 'planner',
          centralTurn: episodeQuestion,
          beforeState: `Before the turn, ${episodeQuestion}`,
          turnEvent: episodeQuestion,
          afterState: 'The fallout has settled into a changed emotional, social, or logistical state.',
          handoff: 'Bridge cleanly into the next episode or scene pressure.',
        },
      },
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toEqual([]);
  });

  it('does not pair an action verb in one field with an object noun in another field', () => {
    const bp = blueprint([
      scene('scene-aftermath', 'By morning, the post has viral views and comments.', ['scene-recap']),
      {
        ...scene('scene-recap', 'She weighs what she is willing to keep secret.'),
        // "writes" lives in the name; "blog" lives in narrativeFunction — no
        // single field stages a writing event.
        name: 'Kylie writes her own future',
        narrativeFunction: 'The blog remains the season anchor under public watch.',
      },
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toEqual([]);
  });

  it('trusts an attached ownership profile over loose field-level cue hits', () => {
    const bp = blueprint([
      scene('scene-aftermath', 'By morning, the post has viral views and comments.', ['scene-late']),
      {
        ...scene('scene-late', 'At 4am, the narrator writes the anonymous post.'),
        // Ownership (the conservative contract-level pass) says this scene
        // stages nothing — the writing wording is reference, not staging.
        sceneEventOwnership: {
          id: 'scene-late-event-ownership',
          sceneId: 'scene-late',
          ownedEvents: [],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: [],
          diagnostics: [],
          promptGuidance: [],
        } as unknown as SceneBlueprint['sceneEventOwnership'],
      },
    ]);

    expect(validateBlueprintRouteCueOrder(bp)).toEqual([]);
  });

  it('merges duplicate public aftermath scenes before route validation', () => {
    const bp = blueprint([
      scene('scene-arrival', 'The protagonist arrives at the airport with two bags.', ['scene-public-a']),
      {
        ...scene('scene-public-a', 'By evening, the anonymous post has gone viral and the views keep climbing.', ['scene-public-b']),
        requiredBeats: [{ id: 'required-a', tier: 'authored', sourceTurn: 'The public response becomes visible.', mustDepict: 'The public response becomes visible.' }],
      },
      {
        ...scene('scene-public-b', 'The readership number climbs until the post becomes a public signal.', ['scene-next']),
        requiredBeats: [{ id: 'required-b', tier: 'authored', sourceTurn: 'The public response creates new pressure.', mustDepict: 'The public response creates new pressure.' }],
      },
      scene('scene-next', 'The next scene starts after the public aftermath.'),
    ]);

    expect(mergeDuplicatePublicAftermathScenes(bp)).toBe(1);
    expect(bp.scenes.map((s) => s.id)).toEqual(['scene-arrival', 'scene-public-a', 'scene-next']);
    expect(bp.scenes[1].leadsTo).toEqual(['scene-next']);
    expect(bp.scenes[1].requiredBeats?.map((beat) => beat.id)).toEqual(['required-a', 'required-b']);
    expect(validateBlueprintRouteCueOrder(bp)).toEqual([]);
  });
});
