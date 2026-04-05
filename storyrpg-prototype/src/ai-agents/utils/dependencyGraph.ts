import { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';

export interface SceneNode {
  scene: SceneBlueprint;
  predecessors: string[];
  successors: string[];
  inDegree: number;
}

export interface SceneDependencyGraph {
  nodes: Map<string, SceneNode>;
  hasCycle: boolean;
  cycleReason?: string;
}

export interface SceneWave {
  waveIndex: number;
  sceneIds: string[];
}

function stableSceneSort(a: SceneBlueprint, b: SceneBlueprint): number {
  return a.id.localeCompare(b.id);
}

export function buildSceneDependencyGraph(blueprint: EpisodeBlueprint): SceneDependencyGraph {
  const nodes = new Map<string, SceneNode>();
  const sceneById = new Map<string, SceneBlueprint>(blueprint.scenes.map((s) => [s.id, s]));

  for (const scene of blueprint.scenes) {
    nodes.set(scene.id, {
      scene,
      predecessors: [],
      successors: [],
      inDegree: 0,
    });
  }

  for (const scene of blueprint.scenes) {
    for (const toId of scene.leadsTo || []) {
      if (!sceneById.has(toId)) continue;
      const fromNode = nodes.get(scene.id);
      const toNode = nodes.get(toId);
      if (!fromNode || !toNode) continue;

      fromNode.successors.push(toId);
      toNode.predecessors.push(scene.id);
      toNode.inDegree++;
    }
  }

  for (const scene of blueprint.scenes) {
    for (const reqId of scene.requires || []) {
      if (!sceneById.has(reqId)) continue;
      const reqNode = nodes.get(reqId);
      const sceneNode = nodes.get(scene.id);
      if (!reqNode || !sceneNode) continue;
      if (reqNode.successors.includes(scene.id)) continue;

      reqNode.successors.push(scene.id);
      sceneNode.predecessors.push(reqId);
      sceneNode.inDegree++;
    }
  }

  const hasCycle = detectCycle(nodes);
  return {
    nodes,
    hasCycle,
    cycleReason: hasCycle ? 'Scene dependency graph contains a cycle; concurrency must fall back to serial execution.' : undefined,
  };
}

function detectCycle(nodes: Map<string, SceneNode>): boolean {
  const inDegrees = new Map<string, number>();
  for (const [id, node] of nodes) {
    inDegrees.set(id, node.inDegree);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegrees) {
    if (deg === 0) queue.push(id);
  }
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    const node = nodes.get(id);
    if (!node) continue;
    for (const succId of node.successors) {
      const next = (inDegrees.get(succId) ?? 0) - 1;
      inDegrees.set(succId, next);
      if (next === 0) queue.push(succId);
    }
  }
  return visited !== nodes.size;
}

export function buildTopologicalWaves(blueprint: EpisodeBlueprint): SceneWave[] {
  const graph = buildSceneDependencyGraph(blueprint);
  if (graph.hasCycle) return [];

  const inDegrees = new Map<string, number>();
  const sceneById = new Map<string, SceneBlueprint>(blueprint.scenes.map((s) => [s.id, s]));
  for (const [id, node] of graph.nodes) {
    inDegrees.set(id, node.inDegree);
  }

  const waves: SceneWave[] = [];
  let waveIndex = 0;
  let ready = Array.from(inDegrees.entries())
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort((a, b) => stableSceneSort(sceneById.get(a)!, sceneById.get(b)!));

  while (ready.length > 0) {
    waves.push({ waveIndex, sceneIds: ready });
    const next: string[] = [];
    for (const id of ready) {
      const node = graph.nodes.get(id);
      if (!node) continue;
      for (const succId of node.successors) {
        const deg = (inDegrees.get(succId) ?? 0) - 1;
        inDegrees.set(succId, deg);
        if (deg === 0) next.push(succId);
      }
    }
    ready = next.sort((a, b) => stableSceneSort(sceneById.get(a)!, sceneById.get(b)!));
    waveIndex++;
  }

  return waves;
}

