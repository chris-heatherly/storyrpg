type SceneLike = {
  id: string;
  leadsTo?: string[];
  authoredTreatmentFields?: Array<{
    id?: string;
    contractKind?: string;
    requiredRealization?: string[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

type DensityReportLike = {
  sceneId: string;
  overloaded?: boolean;
  hardUnits?: number;
  totalUnits?: number;
};

export interface BoundedDensityRepairResult<TReport extends DensityReportLike> {
  attempted: boolean;
  changed: boolean;
  movedContractIds: string[];
  before: TReport[];
  after: TReport[];
}

function isMovablePressureLane(field: NonNullable<SceneLike['authoredTreatmentFields']>[number]): boolean {
  if (field.contractKind !== 'pressure_lane') return false;
  const realizations = field.requiredRealization ?? [];
  return realizations.length === 0 || realizations.every((item) => item === 'final_prose');
}

function nearestRouteNeighbor(scenes: SceneLike[], sourceIndex: number): SceneLike | undefined {
  const source = scenes[sourceIndex];
  const forward = scenes[sourceIndex + 1];
  if (forward && ((source.leadsTo ?? []).includes(forward.id) || (source.leadsTo ?? []).length === 0)) {
    return forward;
  }
  const backward = scenes[sourceIndex - 1];
  if (backward && ((backward.leadsTo ?? []).includes(source.id) || (backward.leadsTo ?? []).length === 0)) {
    return backward;
  }
  return undefined;
}

/**
 * One deterministic, topology-preserving repair pass for density-only
 * architecture failures. It moves soft pressure lanes to an adjacent scene on
 * the same route; hard authored turns, signature beats, and event ownership are
 * never touched.
 */
export function runBoundedDensityRepair<TScene extends SceneLike, TReport extends DensityReportLike>(
  scenes: TScene[],
  analyze: (scenes: TScene[]) => TReport[],
  unsafe: (reports: TReport[]) => TReport[],
): BoundedDensityRepairResult<TReport> {
  const before = analyze(scenes);
  const unsafeBefore = unsafe(before);
  if (unsafeBefore.length === 0) {
    return { attempted: false, changed: false, movedContractIds: [], before, after: before };
  }

  const movedContractIds: string[] = [];
  for (const report of unsafeBefore) {
    const sourceIndex = scenes.findIndex((scene) => scene.id === report.sceneId);
    if (sourceIndex < 0) continue;
    const source = scenes[sourceIndex];
    const target = nearestRouteNeighbor(scenes, sourceIndex);
    if (!target) continue;
    const fields = source.authoredTreatmentFields ?? [];
    const movableIndex = fields.map(isMovablePressureLane).lastIndexOf(true);
    if (movableIndex < 0) continue;
    const [field] = fields.splice(movableIndex, 1);
    target.authoredTreatmentFields = [...(target.authoredTreatmentFields ?? []), field];
    movedContractIds.push(String(field.id ?? `${source.id}:pressure-lane-${movableIndex}`));
  }

  const after = analyze(scenes);
  return {
    attempted: true,
    changed: movedContractIds.length > 0,
    movedContractIds,
    before,
    after,
  };
}
