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
    title: 'Episode 1',
    synopsis: '',
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
          mustDepict: 'The narrator turns a terrifying rescue into the first viral proof that they can author a new life.',
        }],
      },
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

  it('merges duplicate public aftermath scenes before route validation', () => {
    const bp = blueprint([
      scene('scene-arrival', 'The protagonist arrives at the airport with two bags.', ['scene-public-a']),
      {
        ...scene('scene-public-a', 'By evening, the anonymous post has gone viral and the views keep climbing.', ['scene-public-b']),
        requiredBeats: [{ id: 'required-a', tier: 'authored', mustDepict: 'The public response becomes visible.' }],
      },
      {
        ...scene('scene-public-b', 'The readership number climbs until the post becomes a public signal.', ['scene-next']),
        requiredBeats: [{ id: 'required-b', tier: 'authored', mustDepict: 'The public response creates new pressure.' }],
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
