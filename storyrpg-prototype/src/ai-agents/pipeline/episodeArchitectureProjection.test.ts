import { describe, expect, it } from 'vitest';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { EpisodeEventPlan } from '../../types/narrativeContract';
import type { PlannedScene } from '../../types/scenePlan';
import { projectBlueprintOntoLockedEpisodePlan } from './episodeArchitectureProjection';

function planned(id: string, order: number): PlannedScene {
  return {
    id,
    episodeNumber: 1,
    order,
    kind: 'standard',
    title: id,
    dramaticPurpose: `Purpose for ${id}`,
    narrativeRole: 'development',
    locations: ['the city'],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
  };
}

function blueprint(ids: string[]): EpisodeBlueprint {
  return {
    episodeId: 'episode-1',
    number: 1,
    title: 'Pilot',
    synopsis: 'The beginning.',
    arc: { you: '', need: '', go: '', search: '', find: '', take: '', return: '', change: '' },
    themes: [],
    scenes: ids.map((id) => ({
      id,
      name: id,
      description: id,
      location: 'the city',
      mood: 'charged',
      purpose: 'branch',
      dramaticQuestion: id,
      wantVsNeed: id,
      conflictEngine: id,
      npcsPresent: [],
      narrativeFunction: id,
      keyBeats: [id],
      leadsTo: [],
    })),
    startingSceneId: ids[0] || '',
    bottleneckScenes: [],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
  };
}

function plan(sceneOrder: string[]): EpisodeEventPlan {
  return {
    version: 3,
    episodeNumber: 1,
    sceneOrder,
    orderedEventIds: [],
    assignments: [],
    sceneContexts: sceneOrder.map((sceneId) => ({ sceneId, priorEventIdsWithinEpisode: [] })),
    sourceGraphHash: 'graph-hash',
    validation: { passed: true, issues: [] },
  } as unknown as EpisodeEventPlan;
}

describe('projectBlueprintOntoLockedEpisodePlan', () => {
  it('restores omitted planned scenes in locked order without inventing extras', () => {
    const result = projectBlueprintOntoLockedEpisodePlan(
      blueprint(['s1', 's3']),
      plan(['s1', 's2', 's3']),
      [planned('s1', 0), planned('s2', 1), planned('s3', 2)],
    );

    expect(result.restoredSceneIds).toEqual(['s2']);
    expect(result.missingPlannedSceneIds).toEqual([]);
    expect(result.outsidePlanSceneIds).toEqual([]);
    expect(result.scenes.map((scene) => scene.id)).toEqual(['s1', 's2', 's3']);
    expect(result.scenes[1].description).toBe('Purpose for s2');
  });

  it('reports an unresolvable locked scene instead of creating a shell from synopsis text', () => {
    const result = projectBlueprintOntoLockedEpisodePlan(
      blueprint(['s1']),
      plan(['s1', 's2']),
      [planned('s1', 0)],
    );

    expect(result.missingPlannedSceneIds).toEqual(['s2']);
    expect(result.scenes.map((scene) => scene.id)).toEqual(['s1']);
  });

  it('retains outside-plan scenes for the owning validator to reject', () => {
    const result = projectBlueprintOntoLockedEpisodePlan(
      blueprint(['s1', 'invented']),
      plan(['s1']),
      [planned('s1', 0)],
    );

    expect(result.outsidePlanSceneIds).toEqual(['invented']);
    expect(result.scenes.map((scene) => scene.id)).toEqual(['s1', 'invented']);
  });
});
