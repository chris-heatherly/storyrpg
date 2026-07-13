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
import { compileNarrativeRealizationTasks } from './realizationTaskCompiler';

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function migrateSeasonGraphToV7(plan: SeasonScenePlan): SeasonScenePlan {
  const graph = plan.narrativeContractGraph;
  if (!graph || graph.version == null || graph.version >= 7) return plan;
  const transitionContracts = (graph.transitionContracts ?? []).map((transition) => {
    const locationChanged = Boolean(transition.toLocation)
      && normalized(transition.fromLocation) !== normalized(transition.toLocation);
    const timeChanged = Boolean(transition.toTimeOfDay)
      && normalized(transition.fromTimeOfDay) !== normalized(transition.toTimeOfDay);
    const hasBlockingState = transition.stateContracts?.some((state) => state.blocking) ?? false;
    return {
      ...transition,
      bridgePolicy: hasBlockingState ? 'state_handoff' as const : 'orientation_only' as const,
      locationRequirement: locationChanged
        ? { canonicalValue: transition.toLocation!, acceptedAliases: [], required: true }
        : undefined,
      timeRequirement: timeChanged
        ? { canonicalValue: transition.toTimeOfDay!, acceptedAliases: [], required: true }
        : undefined,
    };
  });
  const compilerVersion = `${graph.compilerVersion}:migration-v7`;
  const migratedGraph: NarrativeContractGraph = {
    ...graph,
    version: 7,
    compilerVersion,
    sourceHash: `${graph.sourceHash}:migration-v7`,
    transitionContracts,
    realizationTasks: undefined,
  };
  migratedGraph.realizationTasks = compileNarrativeRealizationTasks(migratedGraph, plan.scenes);
  const episodeEventPlans = plan.episodeEventPlans
    ? Object.fromEntries(Object.entries(plan.episodeEventPlans).map(([episodeKey, episodePlan]) => {
        const episodeNumber = Number(episodeKey);
        return [episodeKey, {
          ...episodePlan,
          version: 7,
          compilerVersion,
          sourceGraphHash: migratedGraph.sourceHash,
          transitionContracts: transitionContracts.filter((transition) => transition.episodeNumber === episodeNumber),
          realizationTasks: migratedGraph.realizationTasks?.filter((task) => task.episodeNumber === episodeNumber),
        }];
      }))
    : plan.episodeEventPlans;
  return { ...plan, narrativeContractGraph: migratedGraph, episodeEventPlans };
}

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
  const migrated = migrateSeasonGraphToV7(plan);
  const graph = migrated.narrativeContractGraph
    ? normalizePersistedNarrativeContractGraph(migrated.narrativeContractGraph)
    : migrated.narrativeContractGraph;
  const episodeEventPlans = migrated.episodeEventPlans
    ? Object.fromEntries(Object.entries(migrated.episodeEventPlans).map(([episode, episodePlan]) => [
      episode,
      normalizePersistedEpisodeEventPlan(episodePlan),
    ]))
    : migrated.episodeEventPlans;
  if (migrated === plan && graph === plan.narrativeContractGraph && episodeEventPlans === plan.episodeEventPlans) return plan;
  return { ...migrated, narrativeContractGraph: graph, episodeEventPlans };
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
