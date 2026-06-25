import { afterEach, describe, expect, it } from 'vitest';
import { runFidelityValidators } from './runFidelityValidators';
import { buildValidationPhaseBaseline } from './validationPhaseBaseline';
import { TREATMENT_FIDELITY_GATE_FLAGS } from './treatmentFidelityGate';
import type { FailureModeAuditContract } from '../../types/scenePlan';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { Story } from '../../types/story';

// Minimal-but-typed fixtures. The validators reason over small slices; we cast to
// the canonical shapes after building only the fields each dispatch path reads.
const story = { episodes: [] } as unknown as Story;

/**
 * A season plan with a beat anchored to the WRONG episode (plotTurn1 authored for
 * Ep3 but assigned to Ep5) so SevenPointAnchorConformanceValidator emits a blocking
 * finding when its gate is enabled.
 */
function misanchoredSeasonPlan(): SeasonPlan {
  return {
    episodes: [
      { episodeNumber: 1, structuralRole: ['hook'] },
      { episodeNumber: 3, structuralRole: ['rising'] },
      { episodeNumber: 5, structuralRole: ['plotTurn1'] },
    ],
  } as unknown as SeasonPlan;
}

function treatmentAnalysis(): SourceMaterialAnalysis {
  return {
    sourceFormat: 'story_treatment',
    treatmentSeasonGuidance: { beatEpisodeAnchors: { hook: 1, plotTurn1: 3 } },
    episodeBreakdown: [],
  } as unknown as SourceMaterialAnalysis;
}

/** A treatment plan whose INFO ledger has a reveal that never lands (no reveal flag/prose). */
function ledgerSeasonPlan(): SeasonPlan {
  return {
    episodes: [{ episodeNumber: 1, structuralRole: ['hook'] }],
    informationLedger: [
      { id: 'info-A', label: 'The steward is the informant', description: 'The steward fed the enemy the route.', plannedRevealEpisode: 1, setupTouchEpisodes: [], introducedEpisode: 1 },
    ],
  } as unknown as SeasonPlan;
}

const ALL_FLAGS = Object.values(TREATMENT_FIDELITY_GATE_FLAGS);

afterEach(() => {
  for (const flag of ALL_FLAGS) delete process.env[flag];
  delete process.env.GATE_TREATMENT_FIELD_UTILIZATION;
  delete process.env.GATE_SEASON_PROMISE_REALIZATION;
  delete process.env.GATE_FAILURE_MODE_AUDIT_REALIZATION;
  delete process.env.GATE_NARRATIVE_MECHANIC_PRESSURE;
  delete process.env.GATE_CHARACTER_TREATMENT_REALIZATION;
  delete process.env.GATE_REQUIRED_BEAT_REALIZATION;
  delete process.env.GATE_TREATMENT_SEED_REALIZATION;
});

describe('runFidelityValidators (GAP-D dispatch)', () => {
  it('dispatches by default now that the Wave-5 gates are promoted ON', () => {
    // Wave 5 (gateDefaults): the §4 gates are default-ON, so an unset env now RUNS
    // the validators on a treatment-sourced plan and surfaces the misanchor finding.
    const result = runFidelityValidators({
      story,
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
    });
    expect(result.treatmentSourced).toBe(true);
    expect(result.fidelityFindings.some((f) => f.validator === 'SevenPointAnchorConformanceValidator')).toBe(true);
  });

  it('env "0" is a kill-switch that disables every gate (no findings)', () => {
    for (const flag of ALL_FLAGS) process.env[flag] = '0';
    const result = runFidelityValidators({
      story,
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
    });
    // Treatment-sourced flag still resolves, but every gate is killed → no findings.
    expect(result.fidelityFindings).toEqual([]);
    expect(result.treatmentSourced).toBe(true);
  });

  it('dispatches an enabled validator and surfaces its finding tagged with the validator name', () => {
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.sevenPointAnchorConformance] = '1';
    const result = runFidelityValidators({
      story,
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
    });
    expect(result.treatmentSourced).toBe(true);
    expect(result.fidelityFindings.length).toBeGreaterThan(0);
    const f = result.fidelityFindings[0];
    expect(f.validator).toBe('SevenPointAnchorConformanceValidator');
    expect(f.severity).toBe('error');
    expect(f.findingClass).toBe('authored_contract');
    expect(f.sourceKind).toBe('treatment');
    expect(f.hasConcreteObligation).toBe(true);
  });

  it('detects a non-treatment source (treatmentSourced=false) and stays a no-op without findings', () => {
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.sevenPointAnchorConformance] = '1';
    const result = runFidelityValidators({
      story,
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: { sourceFormat: 'source_material', episodeBreakdown: [] } as unknown as SourceMaterialAnalysis,
    });
    expect(result.treatmentSourced).toBe(false);
    // No anchor map on a non-treatment source → the anchor validator is skipped.
    expect(result.fidelityFindings).toEqual([]);
  });

  it('treats prompt-tagged runs with authored treatment contracts as treatment-sourced', () => {
    const result = runFidelityValidators({
      story,
      seasonPlan: {
        ...misanchoredSeasonPlan(),
        characterTreatmentContracts: [{
          id: 'char-treatment-kylie-voice',
          characterId: 'kylie',
          sourceText: 'Kylie must protect her authorial voice.',
          requiredRealization: ['final_prose'],
          targetEpisodeNumbers: [1],
          blockingLevel: 'warning',
        }],
      } as unknown as SeasonPlan,
      sourceAnalysis: {
        sourceFormat: 'prompt',
        episodeBreakdown: [],
        worldTreatmentContracts: [{
          id: 'world-treatment-club',
          sourceText: 'Vâlcescu Club is a glamorous funnel.',
          requiredRealization: ['final_prose'],
          targetEpisodeNumbers: [1],
          blockingLevel: 'warning',
        }],
      } as unknown as SourceMaterialAnalysis,
    });

    expect(result.treatmentSourced).toBe(true);
  });

  it('treats surviving season-plan treatment contracts as treatment-sourced even without source analysis', () => {
    const result = runFidelityValidators({
      story,
      seasonPlan: {
        ...misanchoredSeasonPlan(),
        characterTreatmentContracts: [{
          id: 'char-treatment-kylie-voice',
          characterId: 'kylie',
          sourceText: 'Kylie must protect her authorial voice.',
          requiredRealization: ['final_prose'],
          targetEpisodeNumbers: [1],
          blockingLevel: 'warning',
        }],
      } as unknown as SeasonPlan,
    });

    expect(result.treatmentSourced).toBe(true);
  });

  it('hard-blocks the info-ledger schedule by default on treatment runs', () => {
    const result = runFidelityValidators({ story, seasonPlan: ledgerSeasonPlan(), sourceAnalysis: treatmentAnalysis() });
    const info = result.fidelityFindings.filter((f) => f.validator === 'InformationLedgerScheduleValidator');
    expect(info.length).toBeGreaterThan(0);
    expect(info.some((f) => f.severity === 'error')).toBe(true);
  });

  it('keeps the info-ledger schedule visible as advisory when the gate is explicitly disabled', () => {
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.informationLedgerSchedule] = '0';
    const result = runFidelityValidators({ story, seasonPlan: ledgerSeasonPlan(), sourceAnalysis: treatmentAnalysis() });
    const info = result.fidelityFindings.filter((f) => f.validator === 'InformationLedgerScheduleValidator');
    expect(info.length).toBeGreaterThan(0);
    expect(info.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('does NOT run the info-ledger schedule on a non-treatment run', () => {
    const result = runFidelityValidators({
      story,
      seasonPlan: ledgerSeasonPlan(),
      sourceAnalysis: { sourceFormat: 'source_material', episodeBreakdown: [] } as unknown as SourceMaterialAnalysis,
    });
    expect(result.fidelityFindings.filter((f) => f.validator === 'InformationLedgerScheduleValidator')).toEqual([]);
  });

  it('skips a gated validator whose required input is missing (no scene plan → no encounter-anchor dispatch)', () => {
    // Isolate the encounter-anchor gate: kill the other (now default-on) gates so
    // only encounterAnchorContent is active, proving it skips when its input is absent.
    for (const flag of ALL_FLAGS) process.env[flag] = '0';
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.encounterAnchorContent] = '1';
    const result = runFidelityValidators({
      story,
      seasonPlan: misanchoredSeasonPlan(), // no scenePlan field
      sourceAnalysis: treatmentAnalysis(),
    });
    expect(result.fidelityFindings).toEqual([]);
  });

  it('dispatches authored failure-mode audit contracts through the final fidelity gate', () => {
    process.env.GATE_TREATMENT_FIELD_UTILIZATION = '0';
    process.env.GATE_FAILURE_MODE_AUDIT_REALIZATION = '1';
    const result = runFidelityValidators({
      story,
      seasonPlan: {
        ...ledgerSeasonPlan(),
        informationLedger: [],
        failureModeAuditContracts: [failureModeContract()],
      } as SeasonPlan,
      sourceAnalysis: {
        ...treatmentAnalysis(),
        treatmentSeasonGuidance: {},
        failureModeAuditContracts: [failureModeContract()],
      } as SourceMaterialAnalysis,
    });

    expect(result.treatmentSourced).toBe(true);
    const finding = result.fidelityFindings.find((candidate) => candidate.validator === 'NarrativeFailureModeValidator');
    expect(finding).toBeDefined();
    expect(finding?.findingClass).toBe('authored_contract');
    expect(finding?.sourceKind).toBe('treatment');
    expect(finding?.hasConcreteObligation).toBe(true);
  });

  it('does not run plan-only season conformance validators during an episode-incremental seal', () => {
    const result = runFidelityValidators({
      story: {
        episodes: [{ number: 1, scenes: [] }],
      } as unknown as Story,
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
      scope: {
        mode: 'episode-incremental',
        requestedEpisodeNumbers: [1],
        generatedEpisodeNumbers: [1],
        generatedThroughEpisode: 1,
      },
    });

    expect(result.treatmentSourced).toBe(true);
    expect(result.fidelityFindings.some((finding) =>
      finding.validator === 'AuthoredEpisodeConformanceValidator'
      || finding.validator === 'SevenPointAnchorConformanceValidator'
    )).toBe(false);
  });

  it('filters future-episode season promise contracts out of an episode-incremental seal', () => {
    for (const flag of ALL_FLAGS) process.env[flag] = '0';
    process.env.GATE_SEASON_PROMISE_REALIZATION = '1';

    const result = runFidelityValidators({
      story: {
        episodes: [{ number: 1, scenes: [] }],
      } as unknown as Story,
      seasonPlan: {
        ...ledgerSeasonPlan(),
        episodes: [
          { episodeNumber: 1, structuralRole: ['hook'] },
          { episodeNumber: 8, structuralRole: ['resolution'] },
        ],
        seasonPromiseContracts: [{
          id: 'season-resolution',
          sourceText: 'Kylie must resolve whether chosen safety is worth the price of authorship.',
          contractKind: 'season_resolution_obligation',
          requiredRealization: ['final_prose'],
          targetEpisodeNumbers: [8],
          targetSceneIds: ['s8-1'],
          blockingLevel: 'treatment',
        }],
      } as unknown as SeasonPlan,
      sourceAnalysis: treatmentAnalysis(),
      scope: {
        mode: 'episode-incremental',
        requestedEpisodeNumbers: [1],
        generatedEpisodeNumbers: [1],
        generatedThroughEpisode: 1,
      },
    });

    expect(result.fidelityFindings.filter((finding) => finding.validator === 'SeasonPromiseRealizationValidator')).toEqual([]);
  });

  it('keeps in-slice season promise contracts active for a generated-slice seal', () => {
    for (const flag of ALL_FLAGS) process.env[flag] = '0';
    process.env.GATE_SEASON_PROMISE_REALIZATION = '1';

    const result = runFidelityValidators({
      story: {
        episodes: [{ number: 1, scenes: [] }],
      } as unknown as Story,
      seasonPlan: {
        ...ledgerSeasonPlan(),
        episodes: [{ episodeNumber: 1, structuralRole: ['hook'] }],
        seasonPromiseContracts: [{
          id: 'episode-one-pressure',
          sourceText: 'Kylie must feel the cost of mistaking Victor for safety.',
          contractKind: 'central_pressure',
          requiredRealization: ['final_prose'],
          targetEpisodeNumbers: [1],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'treatment',
        }],
      } as unknown as SeasonPlan,
      sourceAnalysis: treatmentAnalysis(),
      scope: {
        mode: 'generated-slice',
        requestedEpisodeNumbers: [1],
        generatedEpisodeNumbers: [1],
        generatedThroughEpisode: 1,
      },
    });

    expect(result.fidelityFindings.some((finding) => finding.validator === 'SeasonPromiseRealizationValidator')).toBe(true);
  });

  it('does not run broad mechanic-pressure validators during an episode-incremental seal', () => {
    for (const flag of ALL_FLAGS) process.env[flag] = '0';
    process.env.GATE_NARRATIVE_MECHANIC_PRESSURE = '1';

    const pressureStory = {
      episodes: [{
        number: 1,
        scenes: [{
          id: 's1-1',
          name: 'Quiet Room',
          startingBeatId: 's1-1-b1',
          mechanicPressure: [{
            id: 'treatment-pressure',
            source: 'treatment',
            domain: 'flag',
            mechanicRef: { flag: 'forbidden_key_known' },
            function: 'plant',
            storyPressure: 'The forbidden key should change who can enter the archive.',
            evidenceRequired: ['show the forbidden key changing access'],
            visibleResidue: ['access pressure or route permission'],
            allowedPayoffs: ['route permission'],
            blockedPayoffs: ['metadata-only pressure'],
            originatingSceneId: 's1-1',
          }],
          beats: [{ id: 's1-1-b1', text: 'Mara waits in a quiet room.' }],
        }],
      }],
    } as unknown as Story;

    const incremental = runFidelityValidators({
      story: pressureStory,
      seasonPlan: {
        ...ledgerSeasonPlan(),
        informationLedger: [],
        scenePlan: { scenes: [{ id: 's1-1', episodeNumber: 1, order: 1 }] },
      } as unknown as SeasonPlan,
      sourceAnalysis: treatmentAnalysis(),
      scope: {
        mode: 'episode-incremental',
        requestedEpisodeNumbers: [1],
        generatedEpisodeNumbers: [1],
        generatedThroughEpisode: 1,
      },
    });

    expect(incremental.fidelityFindings.filter((finding) => finding.validator === 'NarrativeMechanicPressureValidator')).toEqual([]);

    const slice = runFidelityValidators({
      story: pressureStory,
      seasonPlan: {
        ...ledgerSeasonPlan(),
        informationLedger: [],
        scenePlan: { scenes: [{ id: 's1-1', episodeNumber: 1, order: 1 }] },
      } as unknown as SeasonPlan,
      sourceAnalysis: treatmentAnalysis(),
      scope: {
        mode: 'generated-slice',
        requestedEpisodeNumbers: [1],
        generatedEpisodeNumbers: [1],
        generatedThroughEpisode: 1,
      },
    });

    expect(slice.fidelityFindings.some((finding) => finding.validator === 'NarrativeMechanicPressureValidator')).toBe(true);
  });

  it('does not run broad character-treatment realization during an episode-incremental seal', () => {
    for (const flag of ALL_FLAGS) process.env[flag] = '0';
    process.env.GATE_CHARACTER_TREATMENT_REALIZATION = '1';

    const characterContract = {
      id: 'kylie-ending-truth',
      characterId: 'kylie',
      characterName: 'Kylie Marinescu',
      fieldName: 'Truth',
      sourceText: 'Her voice belongs to her, and being adored is not the same as being seen.',
      contractKind: 'truth_target',
      requiredRealization: ['final_prose'],
      targetEpisodeNumbers: [2],
      targetSceneIds: ['s2-1'],
      blockingLevel: 'treatment',
    };
    const scopedStory = {
      episodes: [{
        number: 2,
        scenes: [{
          id: 's2-1',
          name: 'Episode Two Opening',
          startingBeatId: 'b1',
          beats: [{ id: 'b1', text: 'Kylie looks at the city and keeps moving.' }],
        }],
      }],
    } as unknown as Story;
    const scopedPlan = {
      ...ledgerSeasonPlan(),
      episodes: [{ episodeNumber: 2, structuralRole: ['plotTurn1'] }],
      characterTreatmentContracts: [characterContract],
      scenePlan: {
        scenes: [{ id: 's2-1', episodeNumber: 2, order: 1 }],
        byEpisode: { 2: ['s2-1'] },
      },
    } as unknown as SeasonPlan;
    const scopedAnalysis = {
      ...treatmentAnalysis(),
      characterTreatmentContracts: [characterContract],
    } as unknown as SourceMaterialAnalysis;

    const incremental = runFidelityValidators({
      story: scopedStory,
      seasonPlan: scopedPlan,
      sourceAnalysis: scopedAnalysis,
      scope: {
        mode: 'episode-incremental',
        requestedEpisodeNumbers: [2],
        generatedEpisodeNumbers: [2],
        generatedThroughEpisode: 2,
      },
    });

    expect(incremental.fidelityFindings.filter((finding) => finding.validator === 'CharacterTreatmentRealizationValidator')).toEqual([]);

    expect(incremental.treatmentSourced).toBe(true);
  });

  it('rebinds stale planned-scene required beats before episode-incremental fidelity validation', () => {
    for (const flag of ALL_FLAGS) process.env[flag] = '0';
    process.env.GATE_REQUIRED_BEAT_REALIZATION = '1';
    process.env.GATE_TREATMENT_SEED_REALIZATION = '1';

    const chainedBeat = "Kylie lands in Bucharest with two suitcases and her grandmother's address; by night three she's at a rooftop bar with two new friends watching two men watch her; by 1am she's walking home through Cișmigiu; by 1:15 she's pinned to a tree; by 1:16 a man in a charcoal suit asks if she can stand. She writes about him as Mr. Midnight, and the post does 80,000 reads in a week.";
    const stalePlan = {
      ...ledgerSeasonPlan(),
      informationLedger: [],
      scenePlan: {
        scenes: [
          {
            id: 's1-1',
            episodeNumber: 1,
            order: 1,
            kind: 'standard',
            title: 'Vâlcescu door',
            dramaticPurpose: 'Mika adopts Kylie at the door of Vâlcescu Club on night two.',
            narrativeRole: 'setup',
            locations: ['Vâlcescu Club'],
            npcsInvolved: ['Mika'],
            setsUp: [],
            paysOff: [],
            requiredBeats: [
              { id: 'coldopen', tier: 'coldopen', sourceTurn: "Kylie lands in Bucharest with two suitcases and her grandmother's address.", mustDepict: "Kylie lands in Bucharest with two suitcases and her grandmother's address." },
              { id: 'stale-chain', tier: 'authored', sourceTurn: chainedBeat, mustDepict: chainedBeat },
              { id: 'future-seed', tier: 'seed', sourceTurn: 'Victor is a strigoi (and what the supernatural world is) — confirmed at the mirror.', mustDepict: 'Victor is a strigoi (and what the supernatural world is) — confirmed at the mirror.' },
            ],
          },
          {
            id: 'treatment-enc-1-1',
            episodeNumber: 1,
            order: 2,
            kind: 'encounter',
            title: 'Rooftop bar',
            dramaticPurpose: 'On night three at a rooftop bar, two new friends watch two men watch Kylie.',
            narrativeRole: 'turn',
            locations: ['Rooftop Bar'],
            npcsInvolved: ['Victor'],
            setsUp: [],
            paysOff: [],
            encounter: { type: 'romantic', difficulty: 'moderate', relevantSkills: [], isBranchPoint: false },
          },
          {
            id: 's1-4',
            episodeNumber: 1,
            order: 3,
            kind: 'standard',
            title: 'Cișmigiu attack',
            dramaticPurpose: "By 1am Kylie's walking home through Cișmigiu; by 1:15 she's pinned to a tree; by 1:16 a man in a charcoal suit asks if she can stand.",
            narrativeRole: 'payoff',
            locations: ['Cișmigiu Gardens'],
            npcsInvolved: [],
            setsUp: [],
            paysOff: [],
          },
          {
            id: 's1-5',
            episodeNumber: 1,
            order: 4,
            kind: 'standard',
            title: 'Mr. Midnight post',
            dramaticPurpose: 'She writes about him as Mr. Midnight, and the post does 80,000 reads in a week.',
            narrativeRole: 'release',
            locations: ["Kylie's Lipscani Apartment"],
            npcsInvolved: [],
            setsUp: [],
            paysOff: [],
          },
        ],
        byEpisode: { 1: ['s1-1', 'treatment-enc-1-1', 's1-4', 's1-5'] },
      },
    } as unknown as SeasonPlan;

    const generatedStory = {
      episodes: [{
        number: 1,
        title: 'Dating After Dusk',
        scenes: [
          {
            id: 's1-arrival-cold-open',
            name: 'Kylie arrives in Bucharest',
            beats: [{ id: 'b1', text: "Kylie lands in Bucharest with two suitcases and her grandmother's address." }],
          },
          {
            id: 's1-1',
            name: 'Vâlcescu door',
            beats: [{ id: 'b1', text: 'Mika adopts Kylie at the door of Vâlcescu Club on night two and hands her a side-entrance key card.' }],
          },
          {
            id: 'treatment-enc-1-1',
            name: 'Rooftop bar',
            beats: [{ id: 'b1', text: 'On night three at a rooftop bar, Kylie sits with two new friends while two men watch her across the room.' }],
          },
          {
            id: 's1-4',
            name: 'Cișmigiu attack',
            beats: [{ id: 'b1', text: "By 1am Kylie is walking home through Cișmigiu; by 1:15 she is pinned to a tree; by 1:16 a man in a charcoal suit asks if she can stand." }],
          },
          {
            id: 's1-5',
            name: 'Mr. Midnight post',
            beats: [{ id: 'b1', text: 'She writes about him as Mr. Midnight, and the post does 80,000 reads in a week.' }],
          },
        ],
      }],
    } as unknown as Story;

    const result = runFidelityValidators({
      story: generatedStory,
      seasonPlan: stalePlan,
      sourceAnalysis: treatmentAnalysis(),
      scope: {
        mode: 'episode-incremental',
        requestedEpisodeNumbers: [1],
        generatedEpisodeNumbers: [1],
        generatedThroughEpisode: 1,
      },
    });

    expect(result.fidelityFindings.filter((finding) => finding.validator === 'RequiredBeatRealizationValidator')).toEqual([]);
  });
});

describe('runPlanTimeFidelityChecks (WS1 plan placement)', () => {
  it('fails a misanchored treatment plan BEFORE generation (default-ON gate)', async () => {
    const { runPlanTimeFidelityChecks } = await import('./runFidelityValidators');
    const result = runPlanTimeFidelityChecks({
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
    });
    expect(result.treatmentSourced).toBe(true);
    expect(result.blockingErrors.some((f) => f.validator === 'SevenPointAnchorConformanceValidator')).toBe(true);
  });

  it('reports nothing on a non-treatment run (mirrors the §4.6 advisory downgrade)', async () => {
    const { runPlanTimeFidelityChecks } = await import('./runFidelityValidators');
    const result = runPlanTimeFidelityChecks({
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: { sourceFormat: 'source_material', episodeBreakdown: [] } as unknown as SourceMaterialAnalysis,
    });
    expect(result).toEqual({ findings: [], blockingErrors: [], treatmentSourced: false });
  });

  it('env "0" kill-switch disables the plan-time gates', async () => {
    const { runPlanTimeFidelityChecks } = await import('./runFidelityValidators');
    for (const flag of ALL_FLAGS) process.env[flag] = '0';
    const result = runPlanTimeFidelityChecks({
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
    });
    expect(result.findings).toEqual([]);
    expect(result.blockingErrors).toEqual([]);
  });

  it('is a no-op without a season plan', async () => {
    const { runPlanTimeFidelityChecks } = await import('./runFidelityValidators');
    const result = runPlanTimeFidelityChecks({ sourceAnalysis: treatmentAnalysis() });
    expect(result.blockingErrors).toEqual([]);
  });

  it('downgrades repeated plan-primary final findings when plan artifacts are unchanged', async () => {
    const { runPlanTimeFidelityChecks } = await import('./runFidelityValidators');
    const seasonPlan = misanchoredSeasonPlan();
    const sourceAnalysis = treatmentAnalysis();
    const planTime = runPlanTimeFidelityChecks({ seasonPlan, sourceAnalysis });

    const final = runFidelityValidators({
      story,
      seasonPlan,
      sourceAnalysis,
      planTimeBaseline: planTime.baseline,
    });

    const anchorFindings = final.fidelityFindings.filter((finding) =>
      finding.validator === 'SevenPointAnchorConformanceValidator'
    );
    expect(anchorFindings.length).toBeGreaterThan(0);
    expect(anchorFindings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(anchorFindings.some((finding) => finding.suggestion?.includes('regression-net repeat'))).toBe(true);
  });

  it('keeps plan-primary final findings blocking when the season plan drifts after plan-time', async () => {
    const { runPlanTimeFidelityChecks } = await import('./runFidelityValidators');
    const seasonPlan = misanchoredSeasonPlan();
    const sourceAnalysis = treatmentAnalysis();
    const planTime = runPlanTimeFidelityChecks({ seasonPlan, sourceAnalysis });
    const driftedPlan = {
      ...seasonPlan,
      planRevisionMarker: 'mutated-after-plan-time',
    } as unknown as SeasonPlan;

    const final = runFidelityValidators({
      story,
      seasonPlan: driftedPlan,
      sourceAnalysis,
      planTimeBaseline: planTime.baseline,
    });

    expect(final.fidelityFindings.some((finding) =>
      finding.validator === 'SevenPointAnchorConformanceValidator'
      && finding.severity === 'error'
    )).toBe(true);
  });

  it('keeps a new plan-primary error fingerprint blocking even when plan hashes match', () => {
    const seasonPlan = misanchoredSeasonPlan();
    const sourceAnalysis = treatmentAnalysis();
    const staleCleanBaseline = buildValidationPhaseBaseline({
      seasonPlan,
      sourceAnalysis,
      findings: [],
    });

    const final = runFidelityValidators({
      story,
      seasonPlan,
      sourceAnalysis,
      planTimeBaseline: staleCleanBaseline,
    });

    expect(final.fidelityFindings.some((finding) =>
      finding.validator === 'SevenPointAnchorConformanceValidator'
      && finding.severity === 'error'
    )).toBe(true);
  });
});

function failureModeContract(): FailureModeAuditContract {
  return {
    id: 'failure-mode-passive-protagonist-agency',
    source: 'treatment',
    code: 'passive_protagonist',
    label: 'Passive protagonist',
    status: 'watch_item',
    sourceText: 'Mara must choose to use the map she earned instead of being rescued by guards.',
    contractKind: 'agency_claim',
    requiredRealization: ['choice', 'scene_turn', 'ending_route', 'mechanic_pressure', 'final_prose'],
    targetEpisodeNumbers: [1],
    targetSceneIds: ['s1'],
    linkedContractIds: [],
    blockingLevel: 'treatment',
  };
}
