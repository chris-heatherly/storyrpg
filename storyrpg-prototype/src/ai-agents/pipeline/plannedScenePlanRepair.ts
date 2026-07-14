import type { SeasonPlan } from '../../types/seasonPlan';
import { applyEpisodeEventPlans } from './narrativeContractCompiler';
import { rebuildTreatmentSeasonScenePlan, scenesForEpisode } from './seasonScenePlanBuilder';

/**
 * R1.1 minimal plan-repair rung: when elaborate-mode StoryArchitect fails with
 * a plan-owned gate (density / construction / binding), force a treatment spine
 * rebuild + EpisodeEventPlan recompile for the failing episode. Does not mutate
 * ESC spineUnitId order freely — rebuildTreatmentSeasonScenePlan owns that.
 */
export function attemptBoundedPlannedSceneRepair(input: {
  seasonPlan: SeasonPlan;
  episodeNumber: number;
  reason: string;
}): { refreshed: boolean; note: string } {
  const beforeHash = input.seasonPlan.scenePlan?.sourceHash ?? '';
  const rebuilt = rebuildTreatmentSeasonScenePlan(input.seasonPlan);
  Object.assign(input.seasonPlan, rebuilt);
  const scenePlan = input.seasonPlan.scenePlan;
  if (!scenePlan?.narrativeContractGraph) {
    return { refreshed: false, note: `Plan repair skipped (${input.reason}): no narrativeContractGraph after rebuild.` };
  }
  scenePlan.episodeEventPlans = applyEpisodeEventPlans(scenePlan.narrativeContractGraph, scenePlan.scenes);
  const refreshed = scenesForEpisode(scenePlan, input.episodeNumber);
  const seasonEpisode = input.seasonPlan.episodes.find((episode) => episode.episodeNumber === input.episodeNumber);
  if (seasonEpisode) seasonEpisode.plannedScenes = refreshed;
  const afterHash = scenePlan.sourceHash ?? '';
  return {
    refreshed: true,
    note: `Plan repair (${input.reason}): rebuilt treatment spine and recompiled EpisodeEventPlan for episode ${input.episodeNumber}`
      + (beforeHash && afterHash && beforeHash !== afterHash ? ` (sourceHash ${beforeHash.slice(0, 8)}→${afterHash.slice(0, 8)}).` : '.'),
  };
}
