import type { SavedSeasonPlan, SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import {
  inferGenerationSourceKind,
  requiresCanonicalSeasonPlan,
} from '../../ai-agents/pipeline/generationPreflight';

function sourceKey(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

/** Resolve the generation plan from durable store state when React state lags analysis completion. */
export function resolveGenerationSeasonPlan(input: {
  sourceAnalysis: SourceMaterialAnalysis | null;
  currentPlan: SeasonPlan | null;
  savedPlans: SavedSeasonPlan[];
}): SeasonPlan | null {
  if (input.currentPlan) return input.currentPlan;
  if (!input.sourceAnalysis || !requiresCanonicalSeasonPlan(inferGenerationSourceKind(input.sourceAnalysis))) return null;
  const expectedSource = sourceKey(input.sourceAnalysis.sourceTitle);
  const expectedKind = inferGenerationSourceKind(input.sourceAnalysis);
  const saved = input.savedPlans.find((candidate) => (
    sourceKey(candidate.sourceAnalysis.sourceTitle) === expectedSource
    && inferGenerationSourceKind(candidate.sourceAnalysis) === expectedKind
  ));
  return saved?.plan ?? null;
}
