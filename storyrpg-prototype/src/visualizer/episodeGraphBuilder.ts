// ========================================
// EPISODE GRAPH BUILDER
// ========================================
//
// Plan 2: builds a per-episode graph decorated with the player's visit state
// for the post-episode flowchart recap UI. Reuses `transformStoryToGraph`
// so we don't reimplement node/edge construction, then filters down to the
// episode of interest and attaches `visitState` to each node.
//
// Visit states:
//   - 'taken'    — the node was visited during this playthrough
//   - 'chosen'   — the node was the target of a committed choice
//   - 'skipped'  — the node is reachable but was not visited
//
// Consumers: EpisodeRecapScreen.

import type { Story, VisitRecord } from '../types';
import { transformStoryToGraph } from './storyGraphTransformer';
import type { GraphNode, GraphEdge, StoryGraph } from './types';

export type VisitState = 'taken' | 'chosen' | 'skipped';

export interface DecoratedGraphNode extends GraphNode {
  visitState: VisitState;
}

export interface DecoratedGraphEdge extends GraphEdge {
  visitState: VisitState;
}

export interface EpisodeGraph {
  episodeId: string;
  nodes: DecoratedGraphNode[];
  edges: DecoratedGraphEdge[];
  bounds: { width: number; height: number };
  metrics: {
    totalNodes: number;
    visitedNodes: number;
    committedChoices: number;
    uniqueScenesVisited: number;
  };
}

export interface BuildEpisodeGraphOptions {
  /**
   * Optional beat id to highlight as the "current" position (e.g. for
   * displaying a pulse around the last-visited beat when the recap opens).
   */
  focusBeatId?: string;
}

/**
 * Filter the full story graph down to a single episode and decorate each
 * node / edge with its visit state from `visitLog`.
 */
export function buildEpisodeGraph(
  story: Story,
  episodeId: string,
  visitLog: VisitRecord[],
  _options?: BuildEpisodeGraphOptions,
): EpisodeGraph {
  const fullGraph = transformStoryToGraph(story) as StoryGraph;

  const nodeIdsInEpisode = new Set(fullGraph.episodeGroups.get(episodeId) ?? []);
  const nodes: DecoratedGraphNode[] = [];
  for (const node of fullGraph.nodes) {
    if (!nodeIdsInEpisode.has(node.id) && node.episodeId !== episodeId) continue;
    nodes.push({ ...node, visitState: 'skipped' });
  }

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const edges: DecoratedGraphEdge[] = [];
  for (const edge of fullGraph.edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
    edges.push({ ...edge, visitState: 'skipped' });
  }

  // Build lookup sets of visited beats / scenes / committed choices.
  const episodeVisits = visitLog.filter((v) => v.episodeId === episodeId);
  const visitedBeatIds = new Set(episodeVisits.map((v) => v.beatId));
  const visitedSceneIds = new Set(episodeVisits.map((v) => v.sceneId));
  const committedChoiceIds = new Set(
    episodeVisits.filter((v) => !!v.choiceId).map((v) => v.choiceId as string),
  );

  // Decorate nodes. A beat-like node whose `data.id` matches a visited beat
  // is `taken`. A choice-like node whose id matches a committed choice is
  // `chosen`. Scene-level nodes light up if any of their beats were visited.
  for (const node of nodes) {
    const data = node.data as { id?: string; sceneId?: string } | undefined;
    const dataId = data?.id ?? '';
    if (committedChoiceIds.has(dataId) || committedChoiceIds.has(node.id)) {
      node.visitState = 'chosen';
      continue;
    }
    if (visitedBeatIds.has(dataId) || visitedBeatIds.has(node.id)) {
      node.visitState = 'taken';
      continue;
    }
    if (node.sceneId && visitedSceneIds.has(node.sceneId)) {
      node.visitState = 'taken';
    }
  }

  // Decorate edges: if both endpoints are visited and neither is skipped,
  // mark taken. If the edge's target corresponds to a committed choice's
  // destination, mark chosen.
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  for (const edge of edges) {
    const src = nodeById.get(edge.source);
    const dst = nodeById.get(edge.target);
    if (!src || !dst) continue;
    if (src.visitState !== 'skipped' && dst.visitState !== 'skipped') {
      edge.visitState = 'taken';
    }
    if (src.visitState === 'chosen' || dst.visitState === 'chosen') {
      edge.visitState = 'chosen';
    }
  }

  return {
    episodeId,
    nodes,
    edges,
    bounds: fullGraph.bounds,
    metrics: {
      totalNodes: nodes.length,
      visitedNodes: nodes.filter((n) => n.visitState !== 'skipped').length,
      committedChoices: committedChoiceIds.size,
      uniqueScenesVisited: visitedSceneIds.size,
    },
  };
}
