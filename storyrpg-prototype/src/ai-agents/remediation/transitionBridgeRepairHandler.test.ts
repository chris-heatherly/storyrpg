import { describe, expect, it } from 'vitest';
import type { Beat, Scene, Story } from '../../types';
import { SceneTransitionContinuityValidator } from '../validators/SceneTransitionContinuityValidator';
import { buildTransitionBridgeRepairHandler, repairDetectedTransitionBridgeContinuity } from './transitionBridgeRepairHandler';

function beat(overrides: Partial<Beat> & { id: string }): Beat {
  return {
    text: overrides.text ?? '',
    ...overrides,
    id: overrides.id,
  } as Beat;
}

function scene(overrides: Partial<Scene> & { id: string }): Scene {
  return {
    name: overrides.name ?? overrides.id,
    beats: overrides.beats ?? [],
    startingBeatId: overrides.startingBeatId ?? overrides.beats?.[0]?.id ?? '',
    leadsTo: overrides.leadsTo,
    timeline: overrides.timeline,
    encounter: overrides.encounter,
    id: overrides.id,
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
    episodes: [{
      id: 'ep-3',
      number: 3,
      title: 'Episode 3',
      synopsis: '',
      coverImage: '',
      scenes,
      startingSceneId: scenes[0]?.id ?? '',
    }],
  } as unknown as Story;
}

describe('buildTransitionBridgeRepairHandler', () => {
  it('adds arrival language to a named choice bridge without changing routing', async () => {
    const bridge = beat({
      id: 's3-6-b6-payoff-3',
      text: 'You accept the cost because waiting would be worse.',
      isChoiceBridge: true,
      nextSceneId: 'enc-3',
    });
    const inputStory = story([
      scene({
        id: 's3-6',
        beats: [bridge],
        timeline: { location: "Kylie's Lipscani Apartment", timeOfDay: 'night' },
      }),
      scene({
        id: 'enc-3',
        beats: [beat({ id: 'enc-3-b1', text: 'Victor watches your face for the answer.' })],
        timeline: { location: 'Black Car (Drive North)', timeOfDay: 'night' },
      }),
    ]);
    const initial = new SceneTransitionContinuityValidator().validate({ story: inputStory });
    expect(initial.valid).toBe(false);

    const result = await buildTransitionBridgeRepairHandler()({
      story: inputStory,
      blockingIssues: [{
        validator: 'SceneTransitionContinuityValidator',
        type: 'transition_continuity_violation',
        severity: 'error',
        episodeNumber: 3,
        sceneId: 's3-6',
        message:
          'Unacknowledged location jump into scene "enc-3" (episode 3) via choice bridge "s3-6-b6-payoff-3": planned shift (location Kylie\'s Lipscani Apartment → Black Car (Drive North)) but neither the bridge nor the arriving scene carries transition or arrival language. The reader cannot follow how the story moved.',
      }],
    });

    expect(result.changed).toBe(true);
    expect(bridge.nextSceneId).toBe('enc-3');
    expect(bridge.text.startsWith("You drive out of Kylie's Lipscani Apartment")).toBe(true);
    expect(bridge.text).toContain('Black Car');
    const repaired = new SceneTransitionContinuityValidator().validate({ story: inputStory });
    expect(repaired.valid).toBe(true);
  });

  it('repairs detected long bridge prose by prepending transition language inside the validator window', () => {
    const bridge = beat({
      id: 's3-6-b6-payoff-3',
      text: `${'The dread in your gut hardens. '.repeat(25)}The black car waits outside and the engine turns over.`,
      isChoiceBridge: true,
      nextSceneId: 'enc-3',
    });
    const inputStory = story([
      scene({
        id: 's3-6',
        beats: [bridge],
        timeline: { location: "Kylie's Lipscani Apartment", timeOfDay: 'night' },
      }),
      scene({
        id: 'enc-3',
        beats: [beat({ id: 'enc-3-b1', text: 'Victor watches your face for the answer.' })],
        timeline: { location: 'Black Car (Drive North)', timeOfDay: 'night' },
      }),
    ]);
    expect(new SceneTransitionContinuityValidator().validate({ story: inputStory }).valid).toBe(false);

    const touched = repairDetectedTransitionBridgeContinuity(inputStory);

    expect(touched).toBe(1);
    expect(bridge.text.startsWith("You drive out of Kylie's Lipscani Apartment")).toBe(true);
    expect(new SceneTransitionContinuityValidator().validate({ story: inputStory }).valid).toBe(true);
  });

  it('repairs detected adjacent-scene jumps using scene-plan timeline metadata', () => {
    const bridge = beat({
      id: 's3-2-b6',
      text: 'You snap the laptop shut. The club is waiting for its next chapter.',
      nextSceneId: 'enc-3',
    });
    const inputStory = story([
      scene({
        id: 's3-2',
        beats: [bridge],
        leadsTo: ['enc-3'],
      }),
      scene({
        id: 'enc-3',
        beats: [beat({ id: 'enc-3-b1', text: 'Victor watches your face for the answer.' })],
      }),
    ]);
    const scenePlan = {
      scenes: [
        {
          id: 's3-2',
          episodeNumber: 3,
          order: 0,
          kind: 'standard',
          title: 'Apartment',
          dramaticPurpose: 'Kylie leaves her apartment.',
          narrativeRole: 'setup',
          locations: ["Kylie's Lipscani Apartment"],
          setsUp: [],
          paysOff: [],
          npcsInvolved: [],
        },
        {
          id: 'enc-3',
          episodeNumber: 3,
          order: 1,
          kind: 'encounter',
          title: 'Club',
          dramaticPurpose: 'Kylie arrives at the club.',
          narrativeRole: 'escalation',
          locations: ['Vâlcescu Club'],
          setsUp: [],
          paysOff: [],
          npcsInvolved: [],
        },
      ],
      byEpisode: { 3: ['s3-2', 'enc-3'] },
      setupPayoffEdges: [],
    } as any;
    expect(new SceneTransitionContinuityValidator().validate({ story: inputStory, scenePlan }).valid).toBe(false);

    const touched = repairDetectedTransitionBridgeContinuity(inputStory, scenePlan);

    expect(touched).toBe(1);
    expect(inputStory.episodes[0].scenes[1].timeline?.transitionIn?.startsWith("You leave Kylie's Lipscani Apartment behind and make your way to Vâlcescu Club")).toBe(true);
    expect(inputStory.episodes[0].scenes[1].timeline?.transitionIn).not.toContain('grounding the next step');
    expect(new SceneTransitionContinuityValidator().validate({ story: inputStory, scenePlan }).valid).toBe(true);
  });
});
