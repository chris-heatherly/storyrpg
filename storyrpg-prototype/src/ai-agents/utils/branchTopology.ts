import type { EpisodeBlueprint } from '../agents/StoryArchitect';

export interface DeterministicBranchTopology {
  unreachableSceneIds: string[];
  deadEndSceneIds: string[];
  reconvergenceSceneIds: string[];
  incomingCounts: Record<string, number>;
}

export function analyzeBranchTopology(blueprint: EpisodeBlueprint): DeterministicBranchTopology {
  const sceneIds = new Set(blueprint.scenes.map((scene) => scene.id));
  const incomingCounts: Record<string, number> = {};
  const adjacency = new Map<string, string[]>();

  for (const scene of blueprint.scenes) {
    const nextIds = (scene.leadsTo || []).filter((targetId) => sceneIds.has(targetId));
    adjacency.set(scene.id, nextIds);
    for (const targetId of nextIds) {
      incomingCounts[targetId] = (incomingCounts[targetId] || 0) + 1;
    }
  }

  const reachable = new Set<string>();
  const queue = blueprint.startingSceneId ? [blueprint.startingSceneId] : [];

  while (queue.length > 0) {
    const sceneId = queue.shift()!;
    if (reachable.has(sceneId) || !sceneIds.has(sceneId)) continue;
    reachable.add(sceneId);
    for (const nextId of adjacency.get(sceneId) || []) {
      if (!reachable.has(nextId)) {
        queue.push(nextId);
      }
    }
  }

  const unreachableSceneIds = blueprint.scenes
    .map((scene) => scene.id)
    .filter((sceneId) => !reachable.has(sceneId));

  const deadEndSceneIds = blueprint.scenes
    .filter((scene) => {
      const nextIds = adjacency.get(scene.id) || [];
      return nextIds.length === 0 && scene.id !== (blueprint as { endingSceneId?: string }).endingSceneId;
    })
    .map((scene) => scene.id);

  const reconvergenceSceneIds = Object.entries(incomingCounts)
    .filter(([, count]) => count > 1)
    .map(([sceneId]) => sceneId);

  return {
    unreachableSceneIds,
    deadEndSceneIds,
    reconvergenceSceneIds,
    incomingCounts,
  };
}

// ============================================================================
// Deterministic branch SKELETON (paths + reconvergence)
//
// The LLM BranchManager used to enumerate paths and reconvergence points itself
// — a graph-traversal task it does unreliably (hallucinated edges, miscounted
// paths, malformed/truncated JSON). These helpers compute the same structure
// by pure graph walk over `leadsTo`, so it is correct by construction and
// cannot fail to parse. The LLM is then left to ANNOTATE this skeleton (path
// names, reconvergence acknowledgment prose) rather than generate it.
// ============================================================================

/** Minimal scene shape these helpers need (a SceneBlueprint satisfies it). */
export interface TopologyScene {
  id: string;
  leadsTo?: string[];
  name?: string;
  purpose?: string;
}

export interface BranchPathSkeleton {
  id: string;
  startSceneId: string;
  endSceneId: string;
  sceneSequence: string[];
}

export interface ReconvergenceSkeleton {
  sceneId: string;
  /** Direct predecessor scene ids (scenes with an edge into this one). */
  incomingSceneIds: string[];
  /** Enumerated path ids that pass through this scene (≥2 ⇒ true reconvergence). */
  incomingPathIds: string[];
}

export interface BranchSkeleton {
  paths: BranchPathSkeleton[];
  reconvergence: ReconvergenceSkeleton[];
  /** True when path enumeration hit the cap; `paths` is then a representative subset. */
  pathsTruncated: boolean;
}

/** Safety cap so a pathological fan-out graph can't blow up enumeration. */
const MAX_PATHS = 256;

function buildAdjacency(scenes: TopologyScene[]): {
  sceneIds: Set<string>;
  adjacency: Map<string, string[]>;
  incoming: Map<string, Set<string>>;
} {
  const sceneIds = new Set(scenes.map((s) => s.id));
  const adjacency = new Map<string, string[]>();
  const incoming = new Map<string, Set<string>>();
  for (const scene of scenes) {
    const next = (scene.leadsTo || []).filter((t) => sceneIds.has(t));
    adjacency.set(scene.id, next);
    for (const t of next) {
      if (!incoming.has(t)) incoming.set(t, new Set());
      incoming.get(t)!.add(scene.id);
    }
  }
  return { sceneIds, adjacency, incoming };
}

/**
 * Enumerate every distinct path through the scene graph from `startingSceneId`,
 * following `leadsTo`. Cycle-guarded per path (a scene already on the current
 * path terminates that branch) and capped at {@link MAX_PATHS}.
 */
export function enumerateBranchPaths(
  scenes: TopologyScene[],
  startingSceneId: string,
): { paths: BranchPathSkeleton[]; truncated: boolean } {
  const { sceneIds, adjacency } = buildAdjacency(scenes);
  const start = sceneIds.has(startingSceneId) ? startingSceneId : scenes[0]?.id;
  const paths: BranchPathSkeleton[] = [];
  let truncated = false;
  if (!start) return { paths, truncated };

  const walk = (sceneId: string, trail: string[]): void => {
    if (paths.length >= MAX_PATHS) {
      truncated = true;
      return;
    }
    const nextTrail = [...trail, sceneId];
    const next = (adjacency.get(sceneId) || []).filter((t) => !nextTrail.includes(t));
    if (next.length === 0) {
      paths.push({
        id: `path-${paths.length + 1}`,
        startSceneId: nextTrail[0],
        endSceneId: sceneId,
        sceneSequence: nextTrail,
      });
      return;
    }
    for (const t of next) {
      if (paths.length >= MAX_PATHS) {
        truncated = true;
        return;
      }
      walk(t, nextTrail);
    }
  };

  walk(start, []);
  return { paths, truncated };
}

/**
 * Build the full deterministic branch skeleton: enumerated paths plus the
 * reconvergence points (scenes reached by ≥2 enumerated paths), each annotated
 * with its direct predecessors and the path ids flowing through it.
 */
export function buildBranchSkeleton(
  scenes: TopologyScene[],
  startingSceneId: string,
): BranchSkeleton {
  const { incoming } = buildAdjacency(scenes);
  const { paths, truncated } = enumerateBranchPaths(scenes, startingSceneId);

  const pathsThroughScene = new Map<string, string[]>();
  for (const path of paths) {
    for (const sid of path.sceneSequence) {
      const arr = pathsThroughScene.get(sid) || [];
      arr.push(path.id);
      pathsThroughScene.set(sid, arr);
    }
  }

  const reconvergence: ReconvergenceSkeleton[] = [];
  for (const scene of scenes) {
    const preds = incoming.get(scene.id);
    // A reconvergence point is a scene with ≥2 distinct INCOMING edges (paths
    // merging back together). Being on ≥2 paths is not sufficient — the shared
    // prefix (e.g. the start scene) sits on every path but isn't a merge point.
    if (preds && preds.size >= 2) {
      reconvergence.push({
        sceneId: scene.id,
        incomingSceneIds: [...preds],
        incomingPathIds: pathsThroughScene.get(scene.id) || [],
      });
    }
  }

  return { paths, reconvergence, pathsTruncated: truncated };
}
