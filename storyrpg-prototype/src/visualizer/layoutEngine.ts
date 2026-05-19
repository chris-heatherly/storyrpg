import { StoryGraph, GraphNode, GraphEdge, LayoutConfig, DEFAULT_LAYOUT_CONFIG } from './types';

interface LayerAssignment {
  nodeId: string;
  layer: number;
  column: number;
}

export function layoutGraph(
  graph: StoryGraph,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): StoryGraph {
  if (graph.nodes.length === 0) {
    return { ...graph, bounds: { width: 0, height: 0 } };
  }

  // Group nodes by scene
  const sceneLayouts = new Map<string, { nodes: GraphNode[]; x: number; y: number; width: number; height: number }>();

  // Process each scene separately
  for (const [sceneId, nodeIds] of graph.sceneGroups) {
    const sceneNodes = graph.nodes.filter((n) => nodeIds.includes(n.id));
    const sceneEdges = graph.edges.filter(
      (e) => nodeIds.includes(e.source) && nodeIds.includes(e.target)
    );

    if (sceneNodes.length > 0) {
      const layout = layoutScene(sceneNodes, sceneEdges, config);
      sceneLayouts.set(sceneId, layout);
    }
  }

  // Position scenes relative to each other (vertically stacked by episode)
  let currentY = config.episodePadding;
  let maxWidth = 0;

  for (const [episodeId, nodeIds] of graph.episodeGroups) {
    // Get unique scenes in this episode
    const scenesInEpisode = new Set<string>();
    for (const nodeId of nodeIds) {
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (node?.sceneId) {
        scenesInEpisode.add(node.sceneId);
      }
    }

    for (const sceneId of scenesInEpisode) {
      const layout = sceneLayouts.get(sceneId);
      if (layout) {
        // Apply scene position
        layout.x = config.scenePadding;
        layout.y = currentY;

        // Update node positions
        for (const node of layout.nodes) {
          node.x += layout.x;
          node.y += layout.y;
        }

        currentY += layout.height + config.verticalSpacing;
        maxWidth = Math.max(maxWidth, layout.width + config.scenePadding * 2);
      }
    }

    currentY += config.episodePadding;
  }

  alignSceneEntryMerges(graph.nodes, graph.edges, graph.sceneGroups);
  const minX = Math.min(...graph.nodes.map((node) => node.x));
  if (minX < config.scenePadding) {
    const shiftX = config.scenePadding - minX;
    for (const node of graph.nodes) node.x += shiftX;
  }

  const maxX = Math.max(...graph.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...graph.nodes.map((node) => node.y + node.height));
  const bounds = {
    width: Math.max(maxWidth + config.episodePadding * 2, maxX + config.episodePadding),
    height: Math.max(currentY, maxY + config.episodePadding),
  };

  return { ...graph, bounds };
}

function alignSceneEntryMerges(
  nodes: GraphNode[],
  edges: GraphEdge[],
  sceneGroups: Map<string, string[]>,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const sceneByNodeId = new Map<string, string>();
  for (const [sceneId, nodeIds] of sceneGroups) {
    for (const nodeId of nodeIds) sceneByNodeId.set(nodeId, sceneId);
  }

  const scenesByY = Array.from(sceneGroups.keys()).sort((a, b) => {
    const aTop = getSceneTop(sceneGroups.get(a) ?? [], nodeById);
    const bTop = getSceneTop(sceneGroups.get(b) ?? [], nodeById);
    return aTop - bTop;
  });

  for (const sceneId of scenesByY) {
    const externalIncoming = edges.filter((edge) => (
      sceneByNodeId.get(edge.target) === sceneId &&
      sceneByNodeId.get(edge.source) &&
      sceneByNodeId.get(edge.source) !== sceneId
    ));
    if (externalIncoming.length === 0) continue;

    const edgesByTarget = new Map<string, GraphEdge[]>();
    for (const edge of externalIncoming) {
      const targetEdges = edgesByTarget.get(edge.target) ?? [];
      targetEdges.push(edge);
      edgesByTarget.set(edge.target, targetEdges);
    }

    const merge = Array.from(edgesByTarget.entries())
      .sort(([, a], [, b]) => b.length - a.length)[0];
    if (!merge) continue;

    const target = nodeById.get(merge[0]);
    if (!target) continue;

    const sourceCenters = merge[1]
      .map((edge) => nodeById.get(edge.source))
      .filter((node): node is GraphNode => Boolean(node))
      .map((node) => node.x + node.width / 2)
      .sort((a, b) => a - b);
    if (sourceCenters.length === 0) continue;

    const targetCenter = target.x + target.width / 2;
    const desiredCenter = median(sourceCenters);
    const shiftX = desiredCenter - targetCenter;
    if (Math.abs(shiftX) < 1) continue;

    const nodeIds = sceneGroups.get(sceneId) ?? [];
    for (const nodeId of nodeIds) {
      const node = nodeById.get(nodeId);
      if (node) node.x += shiftX;
    }
  }
}

function getSceneTop(nodeIds: string[], nodeById: Map<string, GraphNode>): number {
  const yValues = nodeIds
    .map((nodeId) => nodeById.get(nodeId)?.y)
    .filter((value): value is number => typeof value === 'number');
  return yValues.length ? Math.min(...yValues) : 0;
}

function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}

function layoutScene(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: LayoutConfig
): { nodes: GraphNode[]; x: number; y: number; width: number; height: number } {
  if (nodes.length === 0) {
    return { nodes: [], x: 0, y: 0, width: 0, height: 0 };
  }

  // Build adjacency map
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of edges) {
    const out = outgoing.get(edge.source);
    if (out) out.push(edge.target);

    const inc = incoming.get(edge.target);
    if (inc) inc.push(edge.source);
  }

  // Find root nodes (no incoming edges within scene)
  const roots = nodes.filter((n) => (incoming.get(n.id)?.length || 0) === 0);

  // If no roots found, use the first node
  const startNodes = roots.length > 0 ? roots : [nodes[0]];

  // Assign layers using BFS
  const layers = assignLayers(nodes, startNodes, outgoing);

  // Group nodes by layer
  const layerGroups = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const layer = layers.get(node.id) || 0;
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, []);
    }
    layerGroups.get(layer)!.push(node);
  }

  // Sort layers and assign positions
  const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b);

  let maxLayerWidth = 0;
  const layerYPositions: number[] = [];

  let currentY = config.scenePadding;
  for (const layer of sortedLayers) {
    layerYPositions[layer] = currentY;
    const layerNodes = layerGroups.get(layer) || [];
    const layerHeight = Math.max(...layerNodes.map((node) => node.height), config.nodeHeight);
    currentY += layerHeight + config.verticalSpacing;

    const layerWidth = getLayerWidth(layerNodes, config);
    maxLayerWidth = Math.max(maxLayerWidth, layerWidth);
  }

  // Position nodes within each layer
  for (const layer of sortedLayers) {
    const layerNodes = layerGroups.get(layer) || [];
    const layerWidth = getLayerWidth(layerNodes, config);

    // Center the layer
    const startX = (maxLayerWidth - layerWidth) / 2 + config.scenePadding;

    // Order nodes to minimize crossings (simple heuristic)
    orderNodesInLayer(layerNodes, layer, layers, outgoing, incoming);

    let currentX = startX;
    for (let i = 0; i < layerNodes.length; i++) {
      const node = layerNodes[i];
      node.x = currentX;
      node.y = layerYPositions[layer];
      currentX += node.width + config.horizontalSpacing;
    }
  }

  alignEncounterChoiceChips(nodes, edges, config);
  alignStoryletBeatChains(nodes, edges);
  resolveSceneCollisions(nodes, edges);
  const minX = Math.min(...nodes.map((node) => node.x));
  if (minX < config.scenePadding) {
    const shiftX = config.scenePadding - minX;
    for (const node of nodes) node.x += shiftX;
  }

  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const height = maxY + config.scenePadding;
  const width = maxX + config.scenePadding;

  return { nodes, x: 0, y: 0, width, height };
}

function alignEncounterChoiceChips(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: LayoutConfig,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const originalY = new Map(nodes.map((node) => [node.id, node.y] as const));
  const choicesByParent = new Map<string, GraphNode[]>();

  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || target?.type !== 'encounter-choice') continue;
    const choices = choicesByParent.get(source.id) ?? [];
    choices.push(target);
    choicesByParent.set(source.id, choices);
  }

  const verticalGap = 8;
  const rowShifts = new Map<number, number>();
  const groups = Array.from(choicesByParent.entries()).map(([parentId, choices]) => {
    const parent = nodeById.get(parentId);
    const originalChoiceY = Math.min(...choices.map((choice) => originalY.get(choice.id) ?? choice.y));
    const choiceHeight = Math.max(...choices.map((choice) => choice.height));
    const stackHeight = choices.reduce((sum, choice) => sum + choice.height, 0) + (choices.length - 1) * verticalGap;
    if (stackHeight > choiceHeight) {
      rowShifts.set(originalChoiceY, Math.max(rowShifts.get(originalChoiceY) ?? 0, stackHeight - choiceHeight));
    }
    return { parent, choices, originalChoiceY };
  }).filter((group): group is { parent: GraphNode; choices: GraphNode[]; originalChoiceY: number } => (
    Boolean(group.parent) && group.choices.length > 0
  ));

  const sortedShiftRows = Array.from(rowShifts.entries()).sort(([a], [b]) => a - b);
  const getShiftBefore = (y: number) => sortedShiftRows.reduce((sum, [rowY, shift]) => rowY < y ? sum + shift : sum, 0);

  for (const node of nodes) {
    if (node.type === 'encounter-choice') continue;
    const y = originalY.get(node.id) ?? node.y;
    node.y = y + getShiftBefore(y);
  }

  for (const { parent, choices, originalChoiceY } of groups) {
    choices.sort((a, b) => a.x - b.x);
    let currentY = Math.max(
      originalChoiceY + getShiftBefore(originalChoiceY),
      parent.y + parent.height + 24,
    );
    for (const choice of choices) {
      choice.x = parent.x + parent.width / 2 - choice.width / 2;
      choice.y = currentY;
      currentY += choice.height + verticalGap;
    }
  }
}

function alignStoryletBeatChains(nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const storyletEdges = edges.filter((edge) => edge.type === 'storylet');

  const incomingStoryletSource = new Map<string, GraphNode>();
  for (const edge of storyletEdges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || target?.type !== 'storylet-beat') continue;
    incomingStoryletSource.set(target.id, source);
  }

  const storyletBeats = nodes
    .filter((node) => node.type === 'storylet-beat')
    .sort((a, b) => a.y - b.y);

  for (const beat of storyletBeats) {
    const source = incomingStoryletSource.get(beat.id);
    if (!source) continue;
    beat.x = source.x + source.width / 2 - beat.width / 2;
  }

  preventSameRowStoryletOverlap(storyletBeats);
}

function preventSameRowStoryletOverlap(storyletBeats: GraphNode[]) {
  const rows = new Map<number, GraphNode[]>();
  for (const beat of storyletBeats) {
    const row = Math.round(beat.y);
    const rowNodes = rows.get(row) ?? [];
    rowNodes.push(beat);
    rows.set(row, rowNodes);
  }

  for (const rowNodes of rows.values()) {
    rowNodes.sort((a, b) => a.x - b.x);
    for (let i = 1; i < rowNodes.length; i++) {
      const previous = rowNodes[i - 1];
      const current = rowNodes[i];
      const minX = previous.x + previous.width + 24;
      if (current.x < minX) current.x = minX;
    }
  }
}

function resolveSceneCollisions(nodes: GraphNode[], edges: GraphEdge[]) {
  const choiceParentById = buildEncounterChoiceParentMap(nodes, edges);
  const placed: GraphNode[] = [];
  const ordered = [...nodes].sort((a, b) => {
    const aOrderY = getCollisionOrderY(a, choiceParentById);
    const bOrderY = getCollisionOrderY(b, choiceParentById);
    if (Math.abs(aOrderY - bOrderY) > 1) return aOrderY - bOrderY;
    const priorityDelta = getCollisionPriority(a) - getCollisionPriority(b);
    if (priorityDelta !== 0) return priorityDelta;
    return a.x - b.x;
  });

  for (const node of ordered) {
    let guard = 0;
    while (true) {
      const collision = placed.find((other) => rectanglesOverlap(node, other, 18));
      if (!collision) break;
      moveNodeBelow(node, collision);
      guard += 1;
      if (guard > placed.length + 4) break;
    }
    placed.push(node);
  }
}

function buildEncounterChoiceParentMap(nodes: GraphNode[], edges: GraphEdge[]): Map<string, GraphNode> {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const parentByChoiceId = new Map<string, GraphNode>();
  for (const edge of edges) {
    const target = nodeById.get(edge.target);
    if (target?.type !== 'encounter-choice') continue;
    const source = nodeById.get(edge.source);
    if (source) parentByChoiceId.set(target.id, source);
  }
  return parentByChoiceId;
}

function getCollisionOrderY(node: GraphNode, choiceParentById: Map<string, GraphNode>): number {
  const parent = choiceParentById.get(node.id);
  if (node.type === 'encounter-choice' && parent) return parent.y + parent.height + 1;
  return node.y;
}

function getCollisionPriority(node: GraphNode): number {
  switch (node.type) {
    case 'beat':
    case 'phase':
    case 'encounter-situation':
      return 0;
    case 'encounter-choice':
      return 0.5;
    case 'encounter-outcome':
      return 2;
    case 'storylet-beat':
      return 3;
    default:
      return 4;
  }
}

function moveNodeBelow(node: GraphNode, blocker: GraphNode) {
  node.y = blocker.y + blocker.height + 28;
}

function rectanglesOverlap(a: GraphNode, b: GraphNode, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function getLayerWidth(nodes: GraphNode[], config: LayoutConfig): number {
  if (nodes.length === 0) return 0;
  return nodes.reduce((sum, node) => sum + node.width, 0) + (nodes.length - 1) * config.horizontalSpacing;
}

function assignLayers(
  nodes: GraphNode[],
  startNodes: GraphNode[],
  outgoing: Map<string, string[]>
): Map<string, number> {
  const layers = new Map<string, number>();
  const visited = new Set<string>();
  const queue: { node: GraphNode; layer: number }[] = [];

  // Initialize with start nodes at layer 0
  for (const node of startNodes) {
    queue.push({ node, layer: 0 });
    layers.set(node.id, 0);
  }

  while (queue.length > 0) {
    const { node, layer } = queue.shift()!;

    if (visited.has(node.id)) continue;
    visited.add(node.id);

    // Update layer if we found a longer path
    const currentLayer = layers.get(node.id) || 0;
    if (layer > currentLayer) {
      layers.set(node.id, layer);
    }

    // Process children
    const children = outgoing.get(node.id) || [];
    for (const childId of children) {
      const childNode = nodes.find((n) => n.id === childId);
      if (childNode) {
        const childLayer = Math.max(layers.get(childId) || 0, layer + 1);
        layers.set(childId, childLayer);
        queue.push({ node: childNode, layer: childLayer });
      }
    }
  }

  // Assign layer 0 to any unvisited nodes
  for (const node of nodes) {
    if (!layers.has(node.id)) {
      layers.set(node.id, 0);
    }
  }

  return layers;
}

function orderNodesInLayer(
  layerNodes: GraphNode[],
  layer: number,
  layers: Map<string, number>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>
): void {
  if (layerNodes.length <= 1) return;

  // Simple barycenter heuristic: order by average position of connected nodes in adjacent layers
  const scores = new Map<string, number>();

  for (const node of layerNodes) {
    let sum = 0;
    let count = 0;

    // Check incoming connections (from previous layer)
    const inc = incoming.get(node.id) || [];
    for (const parentId of inc) {
      const parentLayer = layers.get(parentId) || 0;
      if (parentLayer === layer - 1) {
        // Estimate position based on array index
        sum += layerNodes.findIndex((n) => n.id === parentId);
        count++;
      }
    }

    // Check outgoing connections (to next layer)
    const out = outgoing.get(node.id) || [];
    for (const childId of out) {
      const childLayer = layers.get(childId) || 0;
      if (childLayer === layer + 1) {
        sum += layerNodes.findIndex((n) => n.id === childId);
        count++;
      }
    }

    scores.set(node.id, count > 0 ? sum / count : layerNodes.indexOf(node));
  }

  // Sort by barycenter score
  layerNodes.sort((a, b) => (scores.get(a.id) || 0) - (scores.get(b.id) || 0));
}

export function calculateEdgePath(
  source: GraphNode,
  target: GraphNode,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): string {
  const sourceX = source.x + source.width / 2;
  const sourceY = source.y + source.height;
  const targetX = target.x + target.width / 2;
  const targetY = target.y;

  // Simple curved path
  const midY = (sourceY + targetY) / 2;

  if (Math.abs(sourceX - targetX) < 10) {
    // Nearly vertical - use straight line
    return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  }

  // Use cubic bezier for curved connection
  return `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
}

export function getNodeCenter(node: GraphNode): { x: number; y: number } {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

export function fitGraphToViewport(
  graph: StoryGraph,
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 50
): { scale: number; translateX: number; translateY: number } {
  if (graph.bounds.width === 0 || graph.bounds.height === 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const availableWidth = viewportWidth - padding * 2;
  const availableHeight = viewportHeight - padding * 2;

  const scaleX = availableWidth / graph.bounds.width;
  const scaleY = availableHeight / graph.bounds.height;
  const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in past 1:1

  const scaledWidth = graph.bounds.width * scale;
  const scaledHeight = graph.bounds.height * scale;

  const translateX = (viewportWidth - scaledWidth) / 2;
  const translateY = (viewportHeight - scaledHeight) / 2;

  return { scale, translateX, translateY };
}

export function zoomToNode(
  node: GraphNode,
  viewportWidth: number,
  viewportHeight: number,
  targetScale: number = 1
): { scale: number; translateX: number; translateY: number } {
  const center = getNodeCenter(node);

  const translateX = viewportWidth / 2 - center.x * targetScale;
  const translateY = viewportHeight / 2 - center.y * targetScale;

  return { scale: targetScale, translateX, translateY };
}
