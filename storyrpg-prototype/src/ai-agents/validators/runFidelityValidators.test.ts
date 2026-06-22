import { afterEach, describe, expect, it } from 'vitest';
import { runFidelityValidators } from './runFidelityValidators';
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
    expect(result.fidelityFindings.some((finding) => finding.validator === 'NarrativeFailureModeValidator')).toBe(true);
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
