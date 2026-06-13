import { afterEach, describe, expect, it } from 'vitest';
import { runFidelityValidators } from './runFidelityValidators';
import { TREATMENT_FIDELITY_GATE_FLAGS } from './treatmentFidelityGate';
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

  it('keeps the info-ledger schedule VISIBLE as an advisory warning while its gate is off (demoted)', () => {
    // GATE_INFORMATION_LEDGER_SCHEDULE is default-off (demoted), so an unset env must
    // still RUN the schedule check on a treatment run and surface the unlanded reveal —
    // but as a non-blocking WARNING, never an error.
    const result = runFidelityValidators({ story, seasonPlan: ledgerSeasonPlan(), sourceAnalysis: treatmentAnalysis() });
    const info = result.fidelityFindings.filter((f) => f.validator === 'InformationLedgerScheduleValidator');
    expect(info.length).toBeGreaterThan(0);
    expect(info.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('hard-blocks the info-ledger schedule (error) when its gate is explicitly on', () => {
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.informationLedgerSchedule] = '1';
    const result = runFidelityValidators({ story, seasonPlan: ledgerSeasonPlan(), sourceAnalysis: treatmentAnalysis() });
    const info = result.fidelityFindings.filter((f) => f.validator === 'InformationLedgerScheduleValidator');
    expect(info.some((f) => f.severity === 'error')).toBe(true);
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
