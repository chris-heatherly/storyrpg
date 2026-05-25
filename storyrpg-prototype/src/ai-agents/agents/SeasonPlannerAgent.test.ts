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
    characterArchitecture: {
      protagonist: {
        lie: 'Kylie believes attention is the same thing as safety.',
        originPressure: 'Her old life rewarded performance more than honesty.',
        truth: 'She has to choose selfhood over being consumed by someone else gaze.',
        want: 'Build a dazzling new life in Bucharest.',
        need: 'Keep her voice and selfhood even when glamour offers protection.',
        arcMode: 'ambiguous',
        climaxChoice: {
          choiceQuestion: 'Will Kylie choose her own voice or let Victor define her?',
          integrateTruthOption: 'Choose her own voice and boundaries.',
          recommitLieOption: 'Trade selfhood for glamorous protection.',
          activeChoiceMechanism: 'The player chooses what Kylie risks at the Hunter Moon ball.',
        },
      },
      supportingCharacters: [],
    },
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
    expect(plan.arcs[0].arcQuestion).toContain('Kylie');
    expect(plan.arcs[0].midpointRecontextualization.questionAfter).toContain('understand');
    expect(plan.arcs[0].lateArcCrisis.irreversibleCost).toBeTruthy();
    expect(plan.arcs[0].episodeTurnouts).toHaveLength(8);
    expect(plan.arcs[0].episodeTurnouts[4].turnType).toBe('recontextualization');
    expect(plan.seasonPromiseArchitecture!.seasonDramaticQuestion).toContain('Kylie');
    expect(plan.seasonPromiseArchitecture!.centralPressure.pressuresLieBy).toContain('attention');
    expect(plan.seasonPromiseArchitecture!.seasonPromise.playerExperiencePromise).toContain('player');
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

  it('carries sceneEpisode treatment contracts into encounters and cliffhangers without encounter anchors', () => {
    const planner = makePlanner();
    const analysis = {
      ...makeAnalysis(),
      sourceTitle: 'Harbor Debt',
      totalEstimatedEpisodes: 1,
      treatmentSeasonGuidance: {
        episodeStructureMode: 'sceneEpisodes',
        informationLedger: 'info-seal',
        rawSectionSummary: ['informationLedger'],
      },
      resolvedEndings: makeAnalysis().resolvedEndings,
      treatmentBranches: [],
      episodeBreakdown: [{
        episodeNumber: 1,
        title: 'The Auction Bell',
        synopsis: 'Mara exposes herself at the auction.',
        sourceChapters: ['1'],
        sourceSummary: 'Mara exposes herself at the auction.',
        plotPoints: [],
        mainCharacters: ['Mara'],
        supportingCharacters: [],
        locations: ['Harbor'],
        estimatedSceneCount: 1,
        estimatedChoiceCount: 2,
        episodeStructureMode: 'sceneEpisodes',
        structuralRole: ['hook'],
        narrativeFunction: { setup: 'auction', conflict: 'bid', resolution: 'registry' },
        treatmentGuidance: {
          authoredTitle: 'The Auction Bell',
          dramaticQuestion: 'Will Mara make herself visible to save the ledger?',
          entryGoal: 'Buy the fish crate quietly.',
          obstacle: 'The syndicate bids with Jonas family ring.',
          forcedChoice: 'Publicly challenge the bid or let the crate disappear.',
          exitShift: 'Mara leaves exposed as a bidder.',
          stakesLayers: ['Material: ledger access', 'Relational: Jonas trust', 'Identity: visibility'],
          themePressure: 'What does truth demand in public?',
          liePressure: 'Mara believes invisibility keeps people safe.',
          informationMovement: 'Plant the seal and open the brother question.',
          consequenceResidue: 'The auctioneer now knows Mara father name.',
          nextEpisodeCausality: 'The named father forces Mara to visit the closed registry.',
          majorChoicePressures: ['Challenge the bid or use Jonas secret.'],
          alternativePaths: ['Challenge creates public suspicion; secrecy creates private debt.'],
        },
      }],
    } as any;

    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      episodeStructureMode: 'sceneEpisodes',
      targetScenesPerEpisode: 1,
      targetChoicesPerEpisode: 2,
      pacing: 'tight',
    });

    const encounter = plan.episodes[0].plannedEncounters[0];
    expect(plan.episodes[0].episodeStructureMode).toBe('sceneEpisodes');
    expect(encounter.description).toContain('Forced choice');
    expect(encounter.centralConflict).toContain('make herself visible');
    expect(encounter.stakes).toContain('Material: ledger access');
    expect(encounter.aftermathConsequence).toContain('Mara leaves exposed');
    expect(encounter.encounterSetupContext).toEqual(
      expect.arrayContaining([
        expect.stringContaining('entry_goal:treatment_ep1'),
        expect.stringContaining('forced_choice:treatment_ep1'),
        expect.stringContaining('information:treatment_ep1'),
        expect.stringContaining('residue:treatment_ep1'),
      ]),
    );
    expect(plan.episodes[0].plannedEncounters[0].isBranchPoint).toBe(true);
  });
});
