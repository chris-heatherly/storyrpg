import type {
  EpisodeEventPlan,
  LegacyNarrativeRealizationTaskV2,
  NarrativeContractGraph,
  NarrativeEvidenceTarget,
  NarrativeRealizationTask,
  PersistedNarrativeRealizationTask,
} from '../../types/narrativeContract';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { ENCOUNTER_OUTCOME_TIERS } from '../validators/encounterTextSurfaces';

function isCanonicalTask(task: PersistedNarrativeRealizationTask): task is NarrativeRealizationTask {
  return Boolean((task as NarrativeRealizationTask).target);
}

function legacyTarget(task: LegacyNarrativeRealizationTaskV2): NarrativeEvidenceTarget {
  if (task.outcomeTier && task.routePolicy === 'terminal_required') {
    return { scope: 'route_terminal', outcomeTier: task.outcomeTier, surfaces: [...task.requiredSurface] };
  }
  if (task.outcomeTier && task.routePolicy === 'path_required') {
    return { scope: 'route_path', outcomeTier: task.outcomeTier, surfaces: [...task.requiredSurface] };
  }
  if (task.routePolicy === 'any_route') {
    return {
      scope: 'any_route',
      outcomeTiers: task.outcomeTier ? [task.outcomeTier] : [...ENCOUNTER_OUTCOME_TIERS],
      surfaces: [...task.requiredSurface],
    };
  }
  return { scope: 'owner', surfaces: [...task.requiredSurface] };
}

export function normalizePersistedRealizationTask(
  task: PersistedNarrativeRealizationTask,
): NarrativeRealizationTask {
  if (isCanonicalTask(task)) return task;
  const { outcomeTier: _outcomeTier, requiredSurface: _requiredSurface, routePolicy: _routePolicy, ...shared } = task;
  return { ...shared, target: legacyTarget(task) };
}

export function normalizePersistedNarrativeContractGraph(
  graph: NarrativeContractGraph,
): NarrativeContractGraph {
  if (!graph.realizationTasks?.length) return graph;
  const realizationTasks = graph.realizationTasks.map((task) =>
    normalizePersistedRealizationTask(task as PersistedNarrativeRealizationTask),
  );
  if (realizationTasks.every((task, index) => task === graph.realizationTasks?.[index])) return graph;
  return { ...graph, realizationTasks };
}

export function normalizePersistedEpisodeEventPlan(plan: EpisodeEventPlan): EpisodeEventPlan {
  if (!plan.realizationTasks?.length) return plan;
  const realizationTasks = plan.realizationTasks.map((task) =>
    normalizePersistedRealizationTask(task as PersistedNarrativeRealizationTask),
  );
  if (realizationTasks.every((task, index) => task === plan.realizationTasks?.[index])) return plan;
  return { ...plan, realizationTasks };
}

/** Normalize the nested episode projections carried by a persisted season scene plan. */
export function normalizePersistedSeasonScenePlan(plan: SeasonScenePlan): SeasonScenePlan {
  const graph = plan.narrativeContractGraph
    ? normalizePersistedNarrativeContractGraph(plan.narrativeContractGraph)
    : plan.narrativeContractGraph;
  const episodeEventPlans = plan.episodeEventPlans
    ? Object.fromEntries(Object.entries(plan.episodeEventPlans).map(([episode, episodePlan]) => [
      episode,
      normalizePersistedEpisodeEventPlan(episodePlan),
    ]))
    : plan.episodeEventPlans;
  if (graph === plan.narrativeContractGraph && episodeEventPlans === plan.episodeEventPlans) return plan;
  return { ...plan, narrativeContractGraph: graph, episodeEventPlans };
}

export function describeNarrativeEvidenceTarget(target: NarrativeEvidenceTarget): string {
  if (target.scope === 'owner') return `owner surfaces=${target.surfaces.join(', ')}`;
  if (target.scope === 'all_options') return `every choice option surfaces=${target.surfaces.join(', ')}`;
  if (target.scope === 'all_choice_outcomes') return `every choice outcome tier surfaces=${target.surfaces.join(', ')}`;
  if (target.scope === 'any_route') {
    return `any route [${target.outcomeTiers.join(', ')}] surfaces=${target.surfaces.join(', ')}`;
  }
  return `${target.scope === 'route_path' ? 'path' : 'terminal'} route=${target.outcomeTier} surfaces=${target.surfaces.join(', ')}`;
}
