import { describe, expect, it } from 'vitest';
import type { SavedSeasonPlan, SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import { resolveGenerationSeasonPlan } from './resolveGenerationSeasonPlan';

function analysis(title: string): SourceMaterialAnalysis {
  return {
    sourceTitle: title,
    sourceFormat: 'story_treatment',
    treatmentSeasonGuidance: { sourceKind: 'authored_lite' },
    episodeBreakdown: [],
  } as unknown as SourceMaterialAnalysis;
}

function saved(title: string, id: string): SavedSeasonPlan {
  return {
    sourceAnalysis: analysis(title),
    plan: { id, sourceTitle: title } as SeasonPlan,
  };
}

describe('resolveGenerationSeasonPlan', () => {
  it('recovers the matching durable plan when screen state is missing', () => {
    expect(resolveGenerationSeasonPlan({
      sourceAnalysis: analysis('Bite Me'),
      currentPlan: null,
      savedPlans: [saved('Other Story', 'wrong'), saved('Bite Me', 'bite-me-plan')],
    })?.id).toBe('bite-me-plan');
  });

  it('does not attach an active plan from another source', () => {
    expect(resolveGenerationSeasonPlan({
      sourceAnalysis: analysis('Bite Me'),
      currentPlan: null,
      savedPlans: [saved('Other Story', 'wrong')],
    })).toBeNull();
  });

  it('keeps the current plan authoritative when present', () => {
    const current = { id: 'current' } as SeasonPlan;
    expect(resolveGenerationSeasonPlan({
      sourceAnalysis: analysis('Bite Me'),
      currentPlan: current,
      savedPlans: [saved('Bite Me', 'stored')],
    })).toBe(current);
  });
});
