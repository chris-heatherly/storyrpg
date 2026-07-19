import { describe, expect, it } from 'vitest';
import type { PipelineConfig } from '../config';
import type { FullCreativeBrief } from '../pipeline/FullStoryPipeline';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import { prepareGenerationJob, prepareVariantBatch } from './GenerationLaunchService';

function fixtureConfig(provider: 'gemini' | 'anthropic' = 'gemini'): PipelineConfig {
  const agent = { provider, model: provider === 'gemini' ? 'gemini-test' : 'claude-test', apiKey: '', maxTokens: 100, temperature: 0 };
  return {
    agents: {
      storyArchitect: { ...agent },
      sceneWriter: { ...agent },
      choiceAuthor: { ...agent },
      qaRunner: { ...agent },
      branchManager: { ...agent },
      imagePlanner: { ...agent },
      videoDirector: { ...agent },
    },
  } as PipelineConfig;
}

function fixtureSourceAnalysis(): SourceMaterialAnalysis {
  return {
    sourceTitle: 'Bite Me',
    sourceFormat: 'story_treatment',
    treatmentMetadata: { detected: true, formatVersion: 'story-treatment-lite' },
    episodeBreakdown: [{ episodeNumber: 1, title: 'Episode 1', synopsis: 'Opening' }],
  } as SourceMaterialAnalysis;
}

function fixtureSeasonPlan(): SeasonPlan {
  return {
    id: 'bite-me-plan',
    episodes: [{ episodeNumber: 1, plannedScenes: [{ id: 's1-1' }] }],
    scenePlan: {
      scenes: [{ id: 's1-1', episodeNumber: 1 }],
      narrativeContractGraph: {
        sourceHash: 'graph-hash',
        compilerVersion: 'compiler-v28',
        validation: { passed: true },
      },
      episodeEventPlans: {
        1: {
          sourceGraphHash: 'graph-hash',
          validation: { passed: true },
        },
      },
    },
  } as unknown as SeasonPlan;
}

function fixtureBrief(): FullCreativeBrief {
  return {
    story: { title: 'Bite Me', genre: 'Horror', synopsis: 'Opening', tone: 'Gothic', themes: [] },
    world: { premise: 'Bucharest', timePeriod: 'Present', technologyLevel: 'Modern', keyLocations: [] },
    protagonist: { id: 'kylie', name: 'Kylie', pronouns: 'she/her', description: '', role: 'protagonist' },
    npcs: [],
    episode: { number: 1, title: 'Episode 1', synopsis: 'Opening', startingLocation: 'bucharest' },
  } as FullCreativeBrief;
}

describe('GenerationLaunchService', () => {
  it('commits one manifest into the brief and versioned worker request', () => {
    const prepared = prepareGenerationJob({
      config: fixtureConfig(),
      draftBrief: fixtureBrief(),
      sourceAnalysis: fixtureSourceAnalysis(),
      seasonPlan: fixtureSeasonPlan(),
      requestedEpisodes: [1],
      providerPolicy: 'gemini-only',
      runId: 'fresh-1',
    });

    expect(prepared.request.protocolVersion).toBe(2);
    expect(prepared.request.payload.generationInput?.manifest).toEqual(prepared.brief.generationManifest);
    expect(prepared.request.launchMetadata).toMatchObject({
      launchServiceVersion: 1,
      providerPolicy: 'gemini-only',
      configHash: prepared.configHash,
      manifestHash: prepared.manifestHash,
    });
    expect(prepared.request.payload.generationInput?.episodeRange).toEqual({ start: 1, end: 1, specific: [1] });
    expect(prepared.request.payload.generationInput?.identityResolution).toEqual(prepared.identityResolution);
    expect(Object.isFrozen(prepared.request)).toBe(true);
    expect(Object.isFrozen(prepared.request.payload.generationInput)).toBe(true);
  });

  it('normalizes a legacy placeholder from canonical analysis before request admission', () => {
    const sourceAnalysis = fixtureSourceAnalysis();
    sourceAnalysis.protagonist = {
      id: 'char-mara', name: 'Mara Vale', pronouns: 'she/her', description: '', arc: '',
    };
    const seasonPlan = fixtureSeasonPlan();
    seasonPlan.protagonist = { id: 'char-mara', name: 'Mara Vale', description: '' };
    const draftBrief = fixtureBrief();
    draftBrief.protagonist = {
      id: 'protagonist', name: 'The Hero', pronouns: 'he/him', description: '', role: 'protagonist',
    };

    const prepared = prepareGenerationJob({
      config: fixtureConfig(), draftBrief, sourceAnalysis, seasonPlan,
      requestedEpisodes: [1], providerPolicy: 'gemini-only', runId: 'normalize-legacy',
    });

    expect(prepared.brief.protagonist).toMatchObject({ id: 'char-mara', name: 'Mara Vale', pronouns: 'she/her' });
    expect(prepared.identityResolution.action).toBe('normalized');
  });

  it('rejects a non-Gemini route before a worker request exists', () => {
    expect(() => prepareGenerationJob({
      config: fixtureConfig('anthropic'),
      draftBrief: fixtureBrief(),
      sourceAnalysis: fixtureSourceAnalysis(),
      seasonPlan: fixtureSeasonPlan(),
      requestedEpisodes: [1],
      providerPolicy: 'gemini-only',
      runId: 'fresh-2',
    })).toThrow(/non-Gemini routes/i);
  });

  it('prepares two to four isolated variants from one locked analysis and plan', () => {
    const batch = prepareVariantBatch({
      config: fixtureConfig(),
      draftBrief: fixtureBrief(),
      sourceAnalysis: fixtureSourceAnalysis(),
      seasonPlan: fixtureSeasonPlan(),
      requestedEpisodes: [1],
      providerPolicy: 'gemini-only',
      runId: 'variant-run',
      variantCount: 4,
    });

    expect(batch.request.kind).toBe('variant-batch');
    expect(batch.request.requests).toHaveLength(4);
    expect(new Set(batch.request.requests.map((request) => request.idempotencyKey)).size).toBe(4);
    expect(batch.request.requests.map((request) => request.payload.generationInput.runContext)).toEqual(
      [1, 2, 3, 4].map((ordinal) => expect.objectContaining({
        kind: 'variant',
        batchId: batch.batchId,
        ordinal,
        total: 4,
        sharedAnalysisHash: batch.sharedAnalysisHash,
      })),
    );
    expect(() => prepareVariantBatch({
      config: fixtureConfig(), draftBrief: fixtureBrief(), sourceAnalysis: fixtureSourceAnalysis(),
      requestedEpisodes: [1], runId: 'too-many', variantCount: 5,
    })).toThrow(/between 2 and 4/i);
  });
});
