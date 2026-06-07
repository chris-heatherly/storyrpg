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
