import type { SeasonPlan } from '../../types/seasonPlan';
import { stableHash } from './artifacts/store';
import type { PipelineFailureMetadata } from './errors';
import { applyEpisodeEventPlans } from './narrativeContractCompiler';
import { rebuildTreatmentSeasonScenePlan, scenesForEpisode } from './seasonScenePlanBuilder';

export interface PlannedSceneRepairIssue {
  code: string;
  sceneId?: string;
  message: string;
}

export interface PlannedSceneRepairResult {
  refreshed: boolean;
  status: 'repaired' | 'fixpoint' | 'invalid_candidate';
  note: string;
  beforeHash: string;
  afterHash: string;
  repairedSeasonPlan?: SeasonPlan;
}

function episodeRepairSurface(plan: SeasonPlan, episodeNumber: number): unknown {
  const scenePlan = plan.scenePlan;
  return {
    sourceHash: scenePlan?.sourceHash,
    graphHash: scenePlan?.narrativeContractGraph?.sourceHash,
    graphCompilerVersion: scenePlan?.narrativeContractGraph?.compilerVersion,
    scenes: scenePlan ? scenesForEpisode(scenePlan, episodeNumber) : [],
    eventPlan: scenePlan?.episodeEventPlans?.[episodeNumber],
  };
}

/** Validates a candidate without mutating the caller's committed plan. */
export function evaluatePlannedSceneRepairCandidate(input: {
  original: SeasonPlan;
  candidate: SeasonPlan;
  episodeNumber: number;
}): Omit<PlannedSceneRepairResult, 'note' | 'repairedSeasonPlan'> {
  const beforeHash = stableHash(episodeRepairSurface(input.original, input.episodeNumber));
  const afterHash = stableHash(episodeRepairSurface(input.candidate, input.episodeNumber));
  const graph = input.candidate.scenePlan?.narrativeContractGraph;
  const episodePlan = input.candidate.scenePlan?.episodeEventPlans?.[input.episodeNumber];
  const valid = Boolean(graph?.validation.passed && episodePlan?.validation.passed);
  if (!valid) return { refreshed: false, status: 'invalid_candidate', beforeHash, afterHash };
  if (beforeHash === afterHash) return { refreshed: false, status: 'fixpoint', beforeHash, afterHash };
  return { refreshed: true, status: 'repaired', beforeHash, afterHash };
}

/**
 * Rebuilds and recompiles on an isolated clone, then returns a candidate only
 * when the failing episode contract changed and validates. Callers decide when
 * to replace their working plan; committed artifact payloads are never mutated.
 */
export function attemptBoundedPlannedSceneRepair(input: {
  seasonPlan: SeasonPlan;
  episodeNumber: number;
  reason: string;
  failure?: PipelineFailureMetadata;
  issues?: PlannedSceneRepairIssue[];
}): PlannedSceneRepairResult {
  const working = JSON.parse(JSON.stringify(input.seasonPlan)) as SeasonPlan;
  const rebuilt = rebuildTreatmentSeasonScenePlan(working);
  const scenePlan = rebuilt.scenePlan;
  if (!scenePlan?.narrativeContractGraph) {
    const beforeHash = stableHash(episodeRepairSurface(input.seasonPlan, input.episodeNumber));
    return {
      refreshed: false,
      status: 'invalid_candidate',
      note: `Plan repair rejected (${input.reason}): no narrativeContractGraph after rebuild.`,
      beforeHash,
      afterHash: beforeHash,
    };
  }
  scenePlan.episodeEventPlans = applyEpisodeEventPlans(scenePlan.narrativeContractGraph, scenePlan.scenes);
  const seasonEpisode = rebuilt.episodes.find((episode) => episode.episodeNumber === input.episodeNumber);
  if (seasonEpisode) seasonEpisode.plannedScenes = scenesForEpisode(scenePlan, input.episodeNumber);

  const evaluation = evaluatePlannedSceneRepairCandidate({
    original: input.seasonPlan,
    candidate: rebuilt,
    episodeNumber: input.episodeNumber,
  });
  const issueCodes = Array.from(new Set([
    ...(input.failure?.issueCodes ?? []),
    ...(input.issues ?? []).map((issue) => issue.code),
  ])).sort();
  const issueSuffix = issueCodes.length > 0 ? ` Issues: ${issueCodes.join(', ')}.` : '';
  if (!evaluation.refreshed) {
    return {
      ...evaluation,
      note: evaluation.status === 'fixpoint'
        ? `Plan repair reached a deterministic fixpoint for episode ${input.episodeNumber}; the rebuilt contract is byte-identical, so no blind LLM retry will run.${issueSuffix}`
        : `Plan repair candidate for episode ${input.episodeNumber} failed canonical graph or EpisodeEventPlan validation.${issueSuffix}`,
    };
  }
  return {
    ...evaluation,
    note: `Plan repair (${input.reason}) produced a validated episode-contract change for episode ${input.episodeNumber} (${evaluation.beforeHash.slice(0, 8)} -> ${evaluation.afterHash.slice(0, 8)}).${issueSuffix}`,
    repairedSeasonPlan: rebuilt,
  };
}
