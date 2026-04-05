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
      return nextIds.length === 0 && scene.id !== blueprint.endingSceneId;
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
