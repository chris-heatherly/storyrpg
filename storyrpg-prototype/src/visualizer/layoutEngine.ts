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

    let episodeStartY = currentY;

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

  const bounds = {
    width: maxWidth + config.episodePadding * 2,
    height: currentY,
  };

  return { ...graph, bounds };
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
    currentY += config.nodeHeight + config.verticalSpacing;

    const layerNodes = layerGroups.get(layer) || [];
    const layerWidth =
      layerNodes.length * config.nodeWidth +
      (layerNodes.length - 1) * config.horizontalSpacing;
    maxLayerWidth = Math.max(maxLayerWidth, layerWidth);
  }

  // Position nodes within each layer
  for (const layer of sortedLayers) {
    const layerNodes = layerGroups.get(layer) || [];
    const layerWidth =
      layerNodes.length * config.nodeWidth +
      (layerNodes.length - 1) * config.horizontalSpacing;

    // Center the layer
    const startX = (maxLayerWidth - layerWidth) / 2 + config.scenePadding;

    // Order nodes to minimize crossings (simple heuristic)
    orderNodesInLayer(layerNodes, layer, layers, outgoing, incoming);

    for (let i = 0; i < layerNodes.length; i++) {
      const node = layerNodes[i];
      node.x = startX + i * (config.nodeWidth + config.horizontalSpacing);
      node.y = layerYPositions[layer];
    }
  }

  const height = currentY - config.verticalSpacing + config.scenePadding;
  const width = maxLayerWidth + config.scenePadding * 2;

  return { nodes, x: 0, y: 0, width, height };
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
