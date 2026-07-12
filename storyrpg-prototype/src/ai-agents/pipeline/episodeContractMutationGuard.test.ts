import { describe, expect, it } from 'vitest';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { EpisodeEventPlan } from '../../types/narrativeContract';
import { captureEpisodeContractSurface, diffEpisodeContractSurface } from './episodeContractMutationGuard';

function blueprint(ids: string[]): EpisodeBlueprint {
  return { scenes: ids.map((id) => ({ id } as any)) } as EpisodeBlueprint;
}

function plan(): EpisodeEventPlan {
  return {
    episodeNumber: 1,
    version: 3,
    sourceGraphHash: 'graph',
    sceneOrder: ['s1', 's2'],
    assignments: [{ eventId: 'event-1', sceneId: 's1' }],
  } as unknown as EpisodeEventPlan;
}

describe('episode contract mutation guard', () => {
  it('detects scene-vector and ownership mutations after commit', () => {
    const canonical = plan();
    const before = captureEpisodeContractSurface(blueprint(['s1', 's2']), canonical);
    const changedPlan = { ...canonical, assignments: [{ eventId: 'event-1', sceneId: 's2' }] } as EpisodeEventPlan;
    const after = captureEpisodeContractSurface(blueprint(['s2', 's1']), changedPlan);

    expect(diffEpisodeContractSurface(before, after).map((issue) => issue.code)).toEqual([
      'scene_order_changed',
      'event_owner_changed',
    ]);
  });

  it('does not treat prose/craft changes as canonical mutations', () => {
    const canonical = plan();
    const before = captureEpisodeContractSurface(blueprint(['s1', 's2']), canonical);
    const after = captureEpisodeContractSurface(blueprint(['s1', 's2']), canonical);
    expect(diffEpisodeContractSurface(before, after)).toEqual([]);
  });
});
