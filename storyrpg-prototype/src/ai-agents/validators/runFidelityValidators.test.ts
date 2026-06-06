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
  it('is a no-op when every gate flag is unset (default-off, no regression)', () => {
    const result = runFidelityValidators({
      story,
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
    });
    // Treatment-sourced flag still resolves, but no validator ran → no findings.
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
    process.env[TREATMENT_FIDELITY_GATE_FLAGS.encounterAnchorContent] = '1';
    const result = runFidelityValidators({
      story,
      seasonPlan: misanchoredSeasonPlan(), // no scenePlan field
      sourceAnalysis: treatmentAnalysis(),
    });
    expect(result.fidelityFindings).toEqual([]);
  });
});
