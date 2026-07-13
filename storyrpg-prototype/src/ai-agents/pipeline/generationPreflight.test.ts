import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import {
  assertGenerationPreflight,
  buildGenerationManifest,
  generationArtifactHash,
  inferGenerationSourceKind,
  validateGenerationPreflight,
} from './generationPreflight';

function authoredAnalysis(): SourceMaterialAnalysis {
  return {
    sourceTitle: 'Bite Me',
    sourceFormat: 'story_treatment',
    treatmentMetadata: {
      detected: true,
      confidence: 'high',
      formatVersion: 'story-treatment-lite',
      warnings: [],
    },
    treatmentSeasonGuidance: { sourceKind: 'authored_lite' },
    episodeBreakdown: [{ episodeNumber: 1, treatmentGuidance: { sourceKind: 'authored_lite' } }],
  } as unknown as SourceMaterialAnalysis;
}

function canonicalPlan(): SeasonPlan {
  const plannedScene = { id: 'ep1-scene1', episodeNumber: 1, order: 1 };
  const graph = {
    version: 8,
    compilerVersion: 'narrative-contract-compiler-v21',
    storyId: 'bite-me',
    sourceHash: 'graph-hash',
    events: [],
    characterPresenceContracts: [],
    dependencies: [],
    validation: { passed: true, issues: [] },
  };
  return {
    id: 'bite-me-plan',
    sourceTitle: 'Bite Me',
    episodes: [{ episodeNumber: 1, plannedScenes: [plannedScene] }],
    scenePlan: {
      scenes: [plannedScene],
      narrativeContractGraph: graph,
      episodeEventPlans: {
        1: {
          version: 8,
          compilerVersion: graph.compilerVersion,
          episodeNumber: 1,
          sourceGraphHash: graph.sourceHash,
          orderedEventIds: [],
          assignments: [],
          sceneOrder: [plannedScene.id],
          sceneContexts: [],
          dueDependencyIds: [],
          activeDependencyIds: [],
          characterPresenceContracts: [],
          validation: { passed: true, issues: [] },
        },
      },
    },
  } as unknown as SeasonPlan;
}

describe('generation preflight', () => {
  it('hashes browser objects identically after JSON worker hydration', () => {
    const value = { createdAt: new Date('2026-07-13T12:00:00.000Z'), nested: { ok: true } };
    expect(generationArtifactHash(value)).toBe(generationArtifactHash(JSON.parse(JSON.stringify(value))));
  });

  it('commits and validates the exact canonical authored artifact revisions', () => {
    const sourceAnalysis = authoredAnalysis();
    const seasonPlan = canonicalPlan();
    const manifest = buildGenerationManifest({ sourceAnalysis, seasonPlan, requestedEpisodes: [1] });

    expect(inferGenerationSourceKind(sourceAnalysis)).toBe('authored_lite');
    expect(validateGenerationPreflight({
      brief: { seasonPlan, generationManifest: manifest },
      sourceAnalysis,
      episodeRange: { start: 1, end: 1, specific: [1] },
    })).toEqual([]);
  });

  it('fails closed when an authored run loses its season plan', () => {
    const sourceAnalysis = authoredAnalysis();
    const manifest = buildGenerationManifest({ sourceAnalysis, seasonPlan: null, requestedEpisodes: [1] });
    const issues = validateGenerationPreflight({ brief: { generationManifest: manifest }, sourceAnalysis });

    expect(issues.map((issue) => issue.code)).toContain('generation_season_plan_missing');
    expect(() => assertGenerationPreflight({ brief: { generationManifest: manifest }, sourceAnalysis }))
      .toThrow(/cannot start without its canonical season plan/i);
  });

  it('rejects plan mutation after manifest commitment', () => {
    const sourceAnalysis = authoredAnalysis();
    const seasonPlan = canonicalPlan();
    const manifest = buildGenerationManifest({ sourceAnalysis, seasonPlan, requestedEpisodes: [1] });
    seasonPlan.seasonTitle = 'Mutated after approval';

    expect(validateGenerationPreflight({ brief: { seasonPlan }, sourceAnalysis, manifest })
      .map((issue) => issue.code)).toContain('generation_season_plan_hash_mismatch');
  });

  it('rejects disagreement between the brief and worker manifest copies', () => {
    const sourceAnalysis = authoredAnalysis();
    const seasonPlan = canonicalPlan();
    const embedded = buildGenerationManifest({ sourceAnalysis, seasonPlan, requestedEpisodes: [1] });
    const workerCopy = { ...embedded, seasonPlanId: 'different-plan' };

    expect(validateGenerationPreflight({
      brief: { seasonPlan, generationManifest: embedded },
      sourceAnalysis,
      manifest: workerCopy,
    }).map((issue) => issue.code)).toContain('generation_manifest_copy_mismatch');
  });

  it('rejects missing ownership projections and episode-scope drift', () => {
    const sourceAnalysis = authoredAnalysis();
    const seasonPlan = canonicalPlan();
    const manifest = buildGenerationManifest({ sourceAnalysis, seasonPlan, requestedEpisodes: [1] });
    delete seasonPlan.scenePlan!.episodeEventPlans![1];
    const recommitted = buildGenerationManifest({ sourceAnalysis, seasonPlan, requestedEpisodes: [1] });
    expect(validateGenerationPreflight({
      brief: { seasonPlan },
      sourceAnalysis,
      manifest: recommitted,
      episodeRange: { start: 1, end: 1, specific: [1] },
    }).map((issue) => issue.code)).toContain('generation_episode_event_plan_missing');
    const issues = validateGenerationPreflight({
      brief: { seasonPlan },
      sourceAnalysis,
      manifest: recommitted,
      episodeRange: { start: 1, end: 2, specific: [2] },
    });

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'generation_episode_scope_mismatch',
      'generation_episode_missing',
    ]));
    expect(manifest.requestedEpisodes).toEqual([1]);
  });
});
