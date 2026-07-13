import { describe, expect, it } from 'vitest';
import type { EpisodeEventPlan } from '../../types/narrativeContract';
import { episodePlanResumeCompatibility } from './episodePlanResumeCompatibility';

function plan(compilerVersion = 'v16'): EpisodeEventPlan {
  return {
    version: 5,
    compilerVersion,
    episodeNumber: 1,
    sourceGraphHash: 'source',
    orderedEventIds: ['event:1'],
    assignments: [{ eventId: 'event:1', sceneId: 's1-1', order: 0 }],
    sceneOrder: ['s1-1'],
    sceneContexts: [{ sceneId: 's1-1', ownedEventIds: ['event:1'], priorEventIdsWithinEpisode: [], forbiddenRestageEventIds: [] }],
    dueDependencyIds: [],
    activeDependencyIds: [],
    characterPresenceContracts: [],
    realizationTasks: [],
    validation: { passed: true, issues: [] },
  };
}

describe('episodePlanResumeCompatibility', () => {
  it('rejects a blueprint compiled by an older compiler', () => {
    expect(episodePlanResumeCompatibility(plan('v15'), plan('v16'))).toEqual({
      compatible: false,
      reason: 'compiler v15 does not match v16',
    });
  });

  it('rejects realization-task drift even when source and compiler hashes match', () => {
    const resumed = plan();
    const canonical = plan();
    canonical.realizationTasks = [{ id: 'task:new' } as never];
    expect(episodePlanResumeCompatibility(resumed, canonical)).toEqual({
      compatible: false,
      reason: 'canonical event assignments or realization tasks changed',
    });
  });

  it('accepts an identical canonical projection', () => {
    expect(episodePlanResumeCompatibility(plan(), plan())).toEqual({ compatible: true });
  });
});
