import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SeasonPlannerAgent } from './SeasonPlannerAgent';
import { extractTreatmentFromMarkdown } from '../utils/treatmentExtraction';

function makePlanner() {
  return new SeasonPlannerAgent({
    provider: 'anthropic',
    model: 'test',
    apiKey: 'test',
    maxTokens: 1000,
    temperature: 0,
  });
}

function makeAnalysis() {
  const treatment = readFileSync(join(__dirname, '../fixtures/bite-me-treatment.md'), 'utf8');
  const extracted = extractTreatmentFromMarkdown(treatment);
  return {
    sourceTitle: 'Bite Me',
    analysisTimestamp: new Date('2026-01-01T00:00:00Z'),
    genre: 'paranormal romance',
    tone: 'glamorous and dangerous',
    themes: ['voice', 'friendship'],
    anchors: {
      stakes: 'Kylie risks her voice, humanity, friends, and blog.',
      goal: 'Build a new life in Bucharest without being owned.',
      incitingIncident: 'Kylie is attacked and rescued by Victor.',
      climax: 'Kylie chooses what she will become at the Hunter Moon ball.',
    },
    sevenPoint: {
      hook: 'Kylie arrives and is attacked.',
      plotTurn1: 'The blog and Victor courtship begin.',
      pinch1: 'Victor reaches into her life.',
      midpoint: 'The mirror reveals Victor.',
      pinch2: 'Mika and Radu truths collapse trust.',
      climax: 'The Hunter Moon ball.',
      resolution: 'Kylie writes the final post.',
    },
    storyArcs: [{ id: 'arc-1', name: 'Dusk', description: 'Kylie learns the city.', estimatedEpisodeRange: { start: 1, end: 8 } }],
    protagonist: { id: 'char-kylie', name: 'Kylie', description: 'A blogger.' },
    majorCharacters: [],
    keyLocations: [],
    resolvedEndingMode: 'multiple',
    detectedEndingMode: 'multiple',
    resolvedEndings: extracted.endings,
    treatmentBranches: extracted.branches,
    warnings: [],
    episodeBreakdown: Array.from({ length: 8 }, (_, index) => {
      const episodeNumber = index + 1;
      const roles = [
        ['hook'],
        ['plotTurn1'],
        ['rising'],
        ['pinch1'],
        ['midpoint'],
        ['pinch2'],
        ['falling'],
        ['climax', 'resolution'],
      ][index];
      return {
        episodeNumber,
        title: `Episode ${episodeNumber}`,
        synopsis: `Synopsis ${episodeNumber}`,
        sourceChapters: [`${episodeNumber}`],
        sourceSummary: `Synopsis ${episodeNumber}`,
        plotPoints: [],
        mainCharacters: ['Kylie'],
        supportingCharacters: [],
        locations: ['Bucharest'],
        estimatedSceneCount: 8,
        estimatedChoiceCount: 4,
        structuralRole: roles,
        narrativeFunction: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        treatmentGuidance: extracted.episodes[episodeNumber],
      };
    }),
    totalEstimatedEpisodes: 8,
  } as any;
}

describe('SeasonPlannerAgent treatment handoff', () => {
  it('maps treatment episode guidance into encounters, cliffhangers, branches, and ending routes', () => {
    const planner = makePlanner();
    const analysis = makeAnalysis();
    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      targetScenesPerEpisode: 8,
      targetChoicesPerEpisode: 4,
      pacing: 'moderate',
    });

    expect(plan.endingMode).toBe('multiple');
    expect(plan.resolvedEndings).toHaveLength(3);
    expect(plan.episodes[0].plannedEncounters[0].description).toContain('rooftop bar');
    expect(plan.episodes[0].cliffhangerPlan.hook).toContain('horrible dream');
    expect(plan.episodes[4].cliffhangerPlan.hook).toContain('stag-crest ring');
    expect(plan.episodes[4].cliffhangerPlan.intensity).toBe('high');
    expect(plan.episodes[4].cliffhangerPlan.type).toBe('reframe');
    expect(plan.crossEpisodeBranches.map((branch: any) => branch.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The Quartz'),
        expect.stringContaining('The Blog War'),
        expect.stringContaining('Mika'),
        expect.stringContaining('The Mountain Confession'),
      ]),
    );
    expect(plan.episodes[0].endingRoutes.map((route: any) => route.endingId)).toEqual(
      expect.arrayContaining(plan.resolvedEndings.map((ending: any) => ending.id)),
    );
    expect(plan.preferences.targetScenesPerEpisode).toBe(6);
  });

  it('carries refreshed treatment episode turns, central conflict, and aftermath into planned encounters', () => {
    const planner = makePlanner();
    const treatment = readFileSync(join(__dirname, '../fixtures/refreshed-treatment.md'), 'utf8');
    const extracted = extractTreatmentFromMarkdown(treatment);
    const analysis = {
      ...makeAnalysis(),
      sourceTitle: 'Harbor Light',
      totalEstimatedEpisodes: 2,
      resolvedEndings: extracted.endings,
      treatmentBranches: extracted.branches,
      episodeBreakdown: [1, 2].map((episodeNumber) => ({
        episodeNumber,
        title: extracted.episodes[episodeNumber].authoredTitle,
        synopsis: extracted.episodes[episodeNumber].episodePromise,
        sourceChapters: [`${episodeNumber}`],
        sourceSummary: extracted.episodes[episodeNumber].episodePromise,
        plotPoints: [],
        mainCharacters: ['Mara'],
        supportingCharacters: [],
        locations: ['Lighthouse'],
        estimatedSceneCount: 6,
        estimatedChoiceCount: 4,
        structuralRole: extracted.episodes[episodeNumber].normalizedStructuralRoles,
        narrativeFunction: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        treatmentGuidance: extracted.episodes[episodeNumber],
      })),
    } as any;

    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      targetScenesPerEpisode: 6,
      targetChoicesPerEpisode: 4,
      pacing: 'moderate',
    });

    const encounter = plan.episodes[0].plannedEncounters[0];
    expect(encounter.description).toContain('Central conflict');
    expect(encounter.centralConflict).toContain('miracle worth protecting');
    expect(encounter.aftermathConsequence).toContain('salt burns');
    expect(encounter.encounterSetupContext).toEqual(
      expect.arrayContaining([
        expect.stringContaining('turn:treatment_turn_ep1_1'),
        expect.stringContaining('growth:treatment_growth_ep1_1'),
        expect.stringContaining('aftermath:treatment_ep1'),
      ]),
    );
    expect(plan.episodes[0].cliffhangerPlan.hook).toContain('shadow points inland');
  });
});
