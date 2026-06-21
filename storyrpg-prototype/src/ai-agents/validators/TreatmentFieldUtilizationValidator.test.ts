import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis, TreatmentEpisodeGuidance } from '../../types/sourceAnalysis';
import { buildSeasonScenePlan } from '../pipeline/seasonScenePlanBuilder';
import { buildTreatmentFieldContractsForGuidance } from '../utils/treatmentFieldContracts';
import { TreatmentFieldUtilizationValidator } from './TreatmentFieldUtilizationValidator';

const guidance: TreatmentEpisodeGuidance = {
  aPressure: 'Mara needs proof before the steward closes the archive.',
  bPressure: 'Edric tests whether Mara values truth more than safety.',
  cSeed: 'The iron key remains warm in her pocket.',
  encounterAnchors: ['Ritual chase through the archive ladder stacks.'],
  encounterCentralConflict: 'Mara wants truth while Edric protects the locked wing.',
  stakesLayers: ['Identity'],
  themePressure: 'Truth costs comfort.',
  liePressure: 'Mara believes facts keep her safe.',
  encounterBuildup: 'Whispers and locked doors narrow her options.',
  majorChoicePressures: ['Open the door or burn the ledger.'],
  alternativePaths: ['Opening the door creates public suspicion; burning the ledger preserves secrecy.'],
  informationMovement: 'Mara learns the ledger names her family.',
  consequenceSeeds: ['The iron key remains warm in her pocket.'],
  endingTurnout: 'Mara leaves with the key and a new enemy.',
  resolvedEpisodeTension: 'Mara knows the wing is real.',
  cliffhangerHook: 'The portrait opens by itself.',
  cliffhangerQuestion: 'Who unlocked it from inside?',
  nextEpisodePressure: 'The household starts hunting the missing key.',
  cliffhangerSetup: 'The portrait hinge clicked earlier.',
  cliffhangerType: 'revelation',
  emotionalCharge: 'dread',
  endStateChange: 'Mara can enter the locked wing now.',
};

function analysis(treatmentGuidance: TreatmentEpisodeGuidance = guidance): SourceMaterialAnalysis {
  return {
    sourceFormat: 'story_treatment',
    title: 'The Locked Wing',
    genre: 'gothic mystery',
    tone: 'tense',
    synopsis: 'Mara finds a wing that should not exist.',
    majorCharacters: [],
    keyLocations: [],
    themes: [],
    episodeBreakdown: [{
      episodeNumber: 1,
      title: 'The Locked Wing',
      synopsis: 'Mara tests the archive door.',
      structuralRole: ['hook'],
      treatmentGuidance,
    }],
    totalEstimatedEpisodes: 2,
  } as unknown as SourceMaterialAnalysis;
}

function plannedSeasonPlan(treatmentGuidance: TreatmentEpisodeGuidance = guidance): SeasonPlan {
  const plan = {
    id: 'season-1',
    sourceTitle: 'The Locked Wing',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    analysisVersion: 'test',
    seasonTitle: 'The Locked Wing',
    seasonSynopsis: 'A manor resists being catalogued.',
    totalEpisodes: 2,
    estimatedTotalDuration: '2 episodes',
    genre: 'gothic mystery',
    tone: 'tense',
    themes: ['truth costs comfort'],
    anchors: {},
    sevenPoint: { hook: 'Mara finds the locked wing.' },
    arcs: [],
    endingMode: 'single',
    resolvedEndings: [],
    progress: { selectedCount: 0, completedCount: 0, inProgressCount: 0, percentComplete: 0 },
    protagonist: { id: 'mara', name: 'Mara', description: 'An archivist.' },
    characterIntroductions: [],
    locationIntroductions: [],
    encounterPlan: { totalEncounters: 1, difficultyCurve: [], typeDistribution: {} },
    crossEpisodeBranches: [],
    consequenceChains: [{
      id: 'key-seed',
      origin: { episodeNumber: 1, description: 'The iron key remains warm in her pocket.' },
      consequences: [{ episodeNumber: 2, description: 'The household starts hunting the missing key.' }],
    }],
    choiceMoments: [{
      id: 'door-or-ledger',
      episode: 1,
      anchor: 'Open the door or burn the ledger.',
      paysOffEpisode: 2,
    }],
    informationLedger: [{
      id: 'ledger-family',
      label: 'Mara learns the ledger names her family.',
      introducedEpisode: 1,
      plannedRevealEpisode: 1,
      plannedPayoffEpisode: 2,
    }],
    episodes: [{
      episodeNumber: 1,
      title: 'The Locked Wing',
      synopsis: 'Mara tests the archive door.',
      structuralRole: ['hook'],
      status: 'planned',
      dependsOn: [],
      setupsForEpisodes: [2],
      resolvesPlotsFrom: [],
      introducesCharacters: [],
      locations: ['Archive'],
      mainCharacters: ['Mara', 'Edric'],
      estimatedSceneCount: 4,
      treatmentGuidance,
      plannedEncounters: [{
        id: 'treatment-enc-1-1',
        type: 'investigation',
        description: 'Ritual chase through the archive ladder stacks.',
        difficulty: 'moderate',
        relevantSkills: ['notice', 'move'],
        centralConflict: 'Mara wants truth while Edric protects the locked wing.',
        stakes: 'Identity and safety are both at risk.',
        isBranchPoint: true,
        branchOutcomes: { victory: 'Mara keeps the key.', defeat: 'Edric marks her as a threat.' },
      }],
      cliffhangerPlan: {
        type: 'reveal',
        intensity: 'high',
        hook: 'The portrait opens by itself.',
        setup: 'The portrait hinge clicked earlier.',
        resolvedEpisodeTension: 'Mara knows the wing is real.',
        newOpenQuestion: 'Who unlocked it from inside?',
        emotionalCharge: 'dread',
        nextEpisodePressure: 'The household starts hunting the missing key.',
        mappedStructuralRole: 'hook',
        style: 'serialized_tv',
      },
    }],
  } as unknown as SeasonPlan;
  plan.scenePlan = buildSeasonScenePlan(plan);
  return plan;
}

function finalStory(text: string): Story {
  return {
    id: 'story-1',
    title: 'The Locked Wing',
    genre: 'gothic mystery',
    synopsis: 'A manor resists being catalogued.',
    metadata: {} as never,
    initialState: {} as never,
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'The Locked Wing',
      synopsis: 'Mara tests the archive door.',
      coverImage: {} as never,
      startingSceneId: 's1-1',
      scenes: [{
        id: 's1-1',
        name: 'Archive Door',
        startingBeatId: 'b1',
        leadsTo: [],
        beats: [{ id: 'b1', text } as never],
      }],
    }],
  } as unknown as Story;
}

describe('TreatmentFieldUtilizationValidator', () => {
  it('builds contracts for every enforced authored treatment field', () => {
    const contracts = buildTreatmentFieldContractsForGuidance(1, guidance);
    expect(contracts.map((contract) => contract.contractKind)).toEqual(expect.arrayContaining([
      'pressure_lane',
      'encounter_anchor',
      'encounter_conflict',
      'stakes_layer',
      'theme_angle',
      'lie_pressure',
      'encounter_buildup',
      'major_choice_pressure',
      'alternative_path',
      'information_movement',
      'consequence_seed',
      'ending_turnout',
      'resolved_episode_tension',
      'cliffhanger_hook',
      'cliffhanger_question',
      'next_episode_pressure',
      'cliffhanger_setup',
      'cliffhanger_type',
      'emotional_charge',
      'end_state_change',
    ]));
    expect(contracts.length).toBeGreaterThanOrEqual(21);
  });

  it('fails plan-time validation when a parsed field is not consumed by any concrete artifact', () => {
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: analysis({ aPressure: 'Mara needs proof before the steward closes the archive.' }),
      seasonPlan: { ...plannedSeasonPlan({}), scenePlan: { scenes: [], byEpisode: {}, setupPayoffEdges: [] } } as SeasonPlan,
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('was not consumed into a concrete plan artifact');
  });

  it('passes plan-time validation when generated scene planning assigns the fields to artifacts', () => {
    const plan = plannedSeasonPlan();
    const result = new TreatmentFieldUtilizationValidator().validatePlan({
      sourceAnalysis: analysis(),
      seasonPlan: plan,
    });

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(plan.scenePlan?.authoredTreatmentFields?.length).toBeGreaterThan(0);
    expect(plan.scenePlan?.scenes.some((scene) => (scene.authoredTreatmentFields ?? []).length > 0)).toBe(true);
  });

  it('fails final validation when assigned fields never reach reader-facing prose', () => {
    const distinctPressure = 'The red ledger must be stolen before sunrise.';
    const result = new TreatmentFieldUtilizationValidator().validate({
      sourceAnalysis: analysis({ aPressure: distinctPressure }),
      seasonPlan: plannedSeasonPlan({ aPressure: distinctPressure }),
      story: finalStory('Mara waits in a quiet room. Nothing changes.'),
      treatmentSourced: true,
      phase: 'final',
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('not realized in reader-facing story pressure'))).toBe(true);
  });
});
