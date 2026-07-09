import { describe, expect, it } from 'vitest';
import {
  buildCompiledArcTargetsFromPlan,
  buildCompiledThreadTwistFromEsc,
} from './compiledEscDirectives';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { EpisodeSpineContract } from '../../types/episodeSpine';

describe('compiledEscDirectives', () => {
  it('seeds threads and twist plan from ESC obligations', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'h',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: ['voice vs glamour'],
      units: [
        {
          id: 'u1',
          order: 0,
          text: 'Meet Stela',
          kind: 'meet',
          storyCircleFacets: ['you'],
          prerequisites: [],
          sceneKind: 'standard',
          obligations: [{ id: 't1', kind: 'thread_setup', text: 'Stela friendship seed' }],
        },
        {
          id: 'u2',
          order: 1,
          text: 'Write at 4am',
          kind: 'late_night_writing',
          storyCircleFacets: ['need'],
          prerequisites: ['u1'],
          sceneKind: 'standard',
          obligations: [{ id: 'tw1', kind: 'twist_reveal', text: 'Mr Midnight identity lands' }],
        },
      ],
    };
    const blueprint = {
      episodeId: 'ep1',
      scenes: [
        { id: 's1', spineUnitId: 'u1' },
        { id: 's2', spineUnitId: 'u2' },
      ],
    } as EpisodeBlueprint;

    const seed = buildCompiledThreadTwistFromEsc(blueprint, 1, spine);
    expect(seed.threads).toHaveLength(1);
    expect(seed.threads[0].tags).toContain('esc-compiled');
    expect(seed.twistPlan?.twistSceneId).toBe('s2');
    expect(seed.twistPlan?.foreshadowSceneId).toBe('s1');
    expect(seed.twistPlan?.directives).toHaveLength(2);
  });

  it('seeds arc targets from polarity / contracts', () => {
    const targets = buildCompiledArcTargetsFromPlan({
      episodeId: 'ep1',
      episodeNumber: 1,
      polarityFacets: ['Keep her voice'],
      contracts: [],
    });
    expect(targets?.arcPhaseHeadline).toBe('Keep her voice');
  });
});
