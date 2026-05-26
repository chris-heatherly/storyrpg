import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Modal,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
  Text,
  useWindowDimensions,
} from 'react-native';
import { Story } from '../../types';
import {
  ChoiceSystemFilterState,
  GraphEdge as GraphEdgeType,
  GraphNode as GraphNodeType,
  MapJumpShortcut,
  StoryGraph,
  ViewState,
  VISUALIZER_COLORS,
  VisualizerMode,
} from '../types';
import { TERMINAL } from '../../theme';
import { PROXY_CONFIG } from '../../config/endpoints';
import { useImageFeedbackStore } from '../../stores/imageFeedbackStore';
import { transformStoryToGraph } from '../storyGraphTransformer';
import { layoutGraph, fitGraphToViewport, zoomToNode } from '../layoutEngine';
import {
  DEFAULT_CHOICE_SYSTEM_FILTERS,
  enrichStoryGraphWithChoiceSystems,
  shouldShowEdge,
} from '../choiceSystemAnalyzer';
import {
  expandStoryGraphResidue,
  shouldShowResidueEdge,
  shouldShowResidueNode,
} from '../residueGraphExpander';
import { GraphCanvas } from './GraphCanvas';
import { VisualizerControls } from './VisualizerControls';

interface StoryVisualizerProps {
  story: Story;
  onBack: () => void;
  onSwitchToColumns?: () => void;
  onStoryUpdated?: (story: Story) => void;
}

export const StoryVisualizer: React.FC<StoryVisualizerProps> = ({ story, onBack, onSwitchToColumns, onStoryUpdated }) => {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const addImageFeedback = useImageFeedbackStore((state) => state.addFeedback);
  const [viewState, setViewState] = useState<ViewState>({
    scale: 0.5,
    translateX: 50,
    translateY: 150,
  });
  const [selectedNode, setSelectedNode] = useState<GraphNodeType | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<VisualizerMode>('author');
  const [filters, setFilters] = useState<ChoiceSystemFilterState>(DEFAULT_CHOICE_SYSTEM_FILTERS);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [correctionNode, setCorrectionNode] = useState<GraphNodeType | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false);
  const canvasHeight = Math.max(320, viewportHeight - 180);
  const focusedNodeIdRef = useRef<string | null>(null);
  const initializedGraphKeyRef = useRef<string | null>(null);
  const lastViewportRef = useRef({ width: viewportWidth, height: canvasHeight });

  // Transform and layout the graph
  const graph = useMemo(() => {
    const rawGraph = transformStoryToGraph(story);
    const choiceGraph = enrichStoryGraphWithChoiceSystems(story, rawGraph);
    return layoutGraph(expandStoryGraphResidue(story, choiceGraph));
  }, [story]);

  const visibleGraph = useMemo(() => {
    const nodes = graph.nodes.filter((node) => shouldShowResidueNode(node, filters));
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      ...graph,
      nodes,
      edges: graph.edges.filter((edge) => (
        nodeIds.has(edge.source) &&
        nodeIds.has(edge.target) &&
        shouldShowEdge(edge, filters, selectedNpcId) &&
        shouldShowResidueEdge(edge, filters)
      )),
    };
  }, [filters, graph, selectedNpcId]);

  const jumpShortcuts = useMemo(() => buildJumpShortcuts(graph), [graph]);
  const graphKey = `${story.id}:${graph.nodes.length}:${graph.edges.length}`;

  useEffect(() => {
    if (!selectedNode) return;
    const refreshed = findNodeById(graph.nodes, selectedNode.id);
    if (refreshed && refreshed !== selectedNode) {
      setSelectedNode(refreshed);
    }
  }, [graph.nodes, selectedNode]);

  // Initial focus on the opening beat at reader-card scale. This runs only
  // when a different graph is loaded, not when the viewport changes.
  useEffect(() => {
    if (graph.nodes.length === 0 || initializedGraphKeyRef.current === graphKey) return;
    const firstBeat = findStoryOpeningBeatNode(story, graph.nodes) ?? findOpeningBeatNode(graph.nodes) ?? graph.nodes[0];
    focusedNodeIdRef.current = firstBeat.id;
    initializedGraphKeyRef.current = graphKey;
    lastViewportRef.current = { width: viewportWidth, height: canvasHeight };
    setViewState(focusNodeInViewport(firstBeat, viewportWidth, canvasHeight, 1.16, 0));
    setIsLoading(false);
  }, [canvasHeight, graph, graphKey, story, viewportWidth]);

  // Resizing the viewport should add or remove space around the focused beat
  // while keeping that beat centered and preserving the current zoom.
  useEffect(() => {
    if (isLoading || graph.nodes.length === 0) return;
    const lastViewport = lastViewportRef.current;
    if (lastViewport.width === viewportWidth && lastViewport.height === canvasHeight) return;

    const focusedNode = findNodeById(graph.nodes, focusedNodeIdRef.current)
      ?? selectedNode
      ?? findStoryOpeningBeatNode(story, graph.nodes)
      ?? findOpeningBeatNode(graph.nodes)
      ?? graph.nodes[0];

    lastViewportRef.current = { width: viewportWidth, height: canvasHeight };
    setViewState((current) => focusNodeInViewport(focusedNode, viewportWidth, canvasHeight, current.scale, 0));
  }, [canvasHeight, graph.nodes, isLoading, selectedNode, story, viewportWidth]);

  const getZoomFocusNode = useCallback((): GraphNodeType | undefined => {
    return selectedNode
      ?? findNodeById(graph.nodes, focusedNodeIdRef.current)
      ?? findStoryOpeningBeatNode(story, graph.nodes)
      ?? findOpeningBeatNode(graph.nodes)
      ?? graph.nodes[0];
  }, [graph.nodes, selectedNode, story]);

  const zoomAroundFocusNode = useCallback((scaleMultiplier: number) => {
    setViewState((current) => {
      const nextScale = Math.max(0.1, Math.min(3, current.scale * scaleMultiplier));
      const focusNode = getZoomFocusNode();

      if (!focusNode) {
        return { ...current, scale: nextScale };
      }

      focusedNodeIdRef.current = focusNode.id;
      return focusNodeInViewport(focusNode, viewportWidth, canvasHeight, nextScale, 0);
    });
  }, [canvasHeight, getZoomFocusNode, viewportWidth]);

  const handleNodePress = (node: GraphNodeType) => {
    focusedNodeIdRef.current = node.id;
    setSelectedEdge(null);
    setSelectedNode(node);
    setViewState((current) => focusNodeInViewport(node, viewportWidth, canvasHeight, current.scale, 0));
  };

  const handleJumpToNode = useCallback((nodeId: string) => {
    const node = findNodeById(graph.nodes, nodeId);
    if (!node) return;

    focusedNodeIdRef.current = node.id;
    setSelectedEdge(null);
    setSelectedNode(node);
    setViewState((current) => focusNodeInViewport(node, viewportWidth, canvasHeight, current.scale, 0));
  }, [canvasHeight, graph.nodes, viewportWidth]);

  const handleEdgePress = (edge: GraphEdgeType) => {
    setSelectedNode(null);
    setSelectedEdge(edge);
  };

  const handleCanvasPress = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const handleRejectImage = useCallback((node: GraphNodeType) => {
    setCorrectionNode(node);
    setCorrectionText('');
    setRegenerationError(null);
  }, []);

  const handleCloseCorrection = useCallback(() => {
    if (isRegeneratingImage) return;
    setCorrectionNode(null);
    setCorrectionText('');
    setRegenerationError(null);
  }, [isRegeneratingImage]);

  const handleSubmitCorrection = useCallback(async () => {
    if (!correctionNode || isRegeneratingImage) return;
    const notes = correctionText.trim();
    if (!notes) {
      setRegenerationError('Describe what should be fixed before regenerating.');
      return;
    }

    const beatId = (correctionNode.data as { id?: string })?.id;
    if (!story.id || !correctionNode.image || !beatId || !correctionNode.sceneId || !correctionNode.episodeId) {
      setRegenerationError('This beat is missing the IDs needed for regeneration.');
      return;
    }

    setIsRegeneratingImage(true);
    setRegenerationError(null);
    try {
      const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/regenerate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: correctionNode.image,
          storyId: story.id,
          episodeId: correctionNode.episodeId,
          sceneId: correctionNode.sceneId,
          beatId,
          feedback: {
            rating: 'negative',
            notes,
            reasons: ['other'],
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Image regeneration failed (${response.status})`);
      }

      await addImageFeedback({
        storyId: story.id,
        episodeId: correctionNode.episodeId,
        sceneId: correctionNode.sceneId,
        beatId,
        imageUrl: correctionNode.image,
        rating: 'negative',
        reasons: ['other'],
        notes,
        regenerated: true,
        regeneratedImageUrl: data.newImageUrl,
      });

      if (data.story) {
        onStoryUpdated?.(data.story as Story);
      }
      setCorrectionNode(null);
      setCorrectionText('');
    } catch (err) {
      setRegenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRegeneratingImage(false);
    }
  }, [addImageFeedback, correctionNode, correctionText, isRegeneratingImage, onStoryUpdated, story.id]);

  const handleZoomIn = useCallback(() => {
    zoomAroundFocusNode(1.25);
  }, [zoomAroundFocusNode]);

  const handleZoomOut = useCallback(() => {
    zoomAroundFocusNode(1 / 1.25);
  }, [zoomAroundFocusNode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        handleZoomIn();
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        handleZoomOut();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleZoomIn, handleZoomOut]);

  const handleFitToScreen = () => {
    const fitted = fitGraphToViewport(visibleGraph, viewportWidth, canvasHeight, 50);
    setViewState(fitted);
  };

  const handleToggleFilter = (key: keyof ChoiceSystemFilterState) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>INITIALIZING GRAPH...</Text>
        <Text style={styles.loadingDots}>█</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <VisualizerControls
        scale={viewState.scale}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToScreen={handleFitToScreen}
        onBack={onBack}
        onSwitchToColumns={onSwitchToColumns}
        storyTitle={story.title}
        nodeCount={visibleGraph.nodes.length}
        edgeCount={visibleGraph.edges.length}
        mode={mode}
        filters={filters}
        npcs={graph.choiceSystem?.npcs ?? []}
        selectedNpcId={selectedNpcId}
        jumpShortcuts={jumpShortcuts}
        onModeChange={setMode}
        onToggleFilter={handleToggleFilter}
        onSelectNpc={setSelectedNpcId}
        onJumpToNode={handleJumpToNode}
      />

      <GraphCanvas
        graph={visibleGraph}
        viewState={viewState}
        onViewStateChange={setViewState}
        onNodePress={handleNodePress}
        onEdgePress={handleEdgePress}
        onCanvasPress={handleCanvasPress}
        selectedNodeId={selectedNode?.id || null}
        selectedEdgeId={selectedEdge?.id || null}
        mode={mode}
        selectedNpcId={selectedNpcId}
        onRejectImage={handleRejectImage}
      />

      <Modal
        visible={Boolean(correctionNode)}
        transparent
        animationType="fade"
        onRequestClose={handleCloseCorrection}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.correctionModal}>
            <Text style={styles.modalEyebrow}>IMAGE REGENERATION</Text>
            <Text style={styles.modalTitle}>What should change?</Text>
            <Text style={styles.modalSubtitle} numberOfLines={2}>
              {correctionNode?.sceneTitle || correctionNode?.sceneId || 'Selected beat'} · {correctionNode?.label || 'Image beat'}
            </Text>
            <TextInput
              style={styles.correctionInput}
              value={correctionText}
              onChangeText={setCorrectionText}
              multiline
              editable={!isRegeneratingImage}
              placeholder="Describe the visual fix..."
              placeholderTextColor={TERMINAL.colors.muted}
              textAlignVertical="top"
            />
            {regenerationError && (
              <Text style={styles.errorText}>{regenerationError}</Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={handleCloseCorrection}
                disabled={isRegeneratingImage}
              >
                <Text style={styles.cancelButtonText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.regenerateButton,
                  (!correctionText.trim() || isRegeneratingImage) && styles.regenerateButtonDisabled,
                ]}
                onPress={handleSubmitCorrection}
                disabled={!correctionText.trim() || isRegeneratingImage}
              >
                {isRegeneratingImage ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.regenerateButtonText}>REGENERATE</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: TERMINAL.colors.bg,
  },
  loadingText: {
    color: TERMINAL.colors.primary,
    fontSize: 12,
    fontFamily: 'Courier',
    marginBottom: 8,
  },
  loadingDots: {
    color: TERMINAL.colors.primary,
    fontSize: 16,
    fontFamily: 'Courier',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  correctionModal: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#05070c',
    borderColor: TERMINAL.colors.primary,
    borderWidth: 1,
    padding: 22,
    gap: 14,
  },
  modalEyebrow: {
    color: TERMINAL.colors.primary,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  modalTitle: {
    color: '#fff',
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 20,
    fontWeight: '900',
  },
  modalSubtitle: {
    color: TERMINAL.colors.muted,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  correctionInput: {
    minHeight: 132,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    color: '#fff',
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 13,
    lineHeight: 19,
    padding: 14,
  },
  errorText: {
    color: '#f87171',
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalButton: {
    minWidth: 124,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cancelButton: {
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  cancelButtonText: {
    color: TERMINAL.colors.muted,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  regenerateButton: {
    borderColor: '#ef4444',
    backgroundColor: '#b91c1c',
  },
  regenerateButtonDisabled: {
    opacity: 0.52,
  },
  regenerateButtonText: {
    color: '#fff',
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
});

function findOpeningBeatNode(nodes: GraphNodeType[]): GraphNodeType | undefined {
  return nodes
    .filter((node) => node.type === 'beat')
    .sort((a, b) => {
      const episodeCompare = String(a.episodeId || '').localeCompare(String(b.episodeId || ''));
      if (episodeCompare !== 0) return episodeCompare;
      const sceneCompare = String(a.sceneId || '').localeCompare(String(b.sceneId || ''));
      if (sceneCompare !== 0) return sceneCompare;
      return (a.beatNumber ?? Number.MAX_SAFE_INTEGER) - (b.beatNumber ?? Number.MAX_SAFE_INTEGER);
    })[0];
}

function findStoryOpeningBeatNode(story: Story, nodes: GraphNodeType[]): GraphNodeType | undefined {
  const firstEpisode = [...(story.episodes ?? [])].sort((a, b) => {
    const numberCompare = (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER);
    if (numberCompare !== 0) return numberCompare;
    return (story.episodes ?? []).indexOf(a) - (story.episodes ?? []).indexOf(b);
  })[0];
  if (!firstEpisode) return undefined;

  const startScene = firstEpisode.scenes.find((scene) => scene.id === firstEpisode.startingSceneId)
    ?? firstEpisode.scenes[0];
  if (!startScene) return undefined;

  const startBeatId = startScene.startingBeatId ?? startScene.beats?.[0]?.id;
  if (!startBeatId) return undefined;

  return nodes.find((node) => (
    node.type === 'beat' &&
    node.episodeId === firstEpisode.id &&
    node.sceneId === startScene.id &&
    (node.data as { id?: string })?.id === startBeatId
  ));
}

function findNodeById(nodes: GraphNodeType[], nodeId: string | null): GraphNodeType | undefined {
  if (!nodeId) return undefined;
  return nodes.find((node) => node.id === nodeId);
}

function buildJumpShortcuts(graph: StoryGraph): MapJumpShortcut[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const incoming = buildIncomingMap(graph.edges);
  const shortcuts: MapJumpShortcut[] = [];

  for (const [sceneId, nodeIds] of graph.sceneGroups) {
    const sceneNodes = nodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is GraphNodeType => Boolean(node));
    const sceneStart = findSceneStartNode(sceneId, sceneNodes, incoming);
    if (!sceneStart) continue;
    shortcuts.push({
      id: `scene:${sceneId}`,
      label: buildSceneShortcutLabel(sceneStart, shortcuts.length + 1),
      kind: sceneStart.type === 'phase' || sceneStart.type === 'encounter-situation' ? 'encounter' : 'scene',
      nodeId: sceneStart.id,
    });
  }

  const storyletStarts = findStoryletStartNodes(graph);
  for (const [index, node] of storyletStarts.entries()) {
    shortcuts.push({
      id: `storylet:${node.id}`,
      label: `ST${index + 1}:${truncateShortcutLabel(node.sceneTitle || node.synthetic?.outcome || 'STORYLET', 10)}`,
      kind: 'storylet',
      nodeId: node.id,
    });
  }

  const branchlets = graph.nodes
    .filter((node) => node.type === 'branchlet')
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const [index, node] of branchlets.entries()) {
    shortcuts.push({
      id: `branchlet:${node.id}`,
      label: `BR${index + 1}:${truncateShortcutLabel(node.sublabel || node.label || 'BRANCH', 12)}`,
      kind: 'branchlet',
      nodeId: node.id,
    });
  }

  return shortcuts.sort((a, b) => {
    const nodeA = nodeById.get(a.nodeId);
    const nodeB = nodeById.get(b.nodeId);
    return (nodeA?.y ?? 0) - (nodeB?.y ?? 0) || (nodeA?.x ?? 0) - (nodeB?.x ?? 0);
  });
}

function buildIncomingMap(edges: StoryGraph['edges']): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }
  return incoming;
}

function findSceneStartNode(
  sceneId: string,
  sceneNodes: GraphNodeType[],
  incoming: Map<string, string[]>,
): GraphNodeType | undefined {
  const structuralNodes = sceneNodes.filter((node) => (
    node.type === 'beat' ||
    node.type === 'phase' ||
    node.type === 'encounter-situation'
  ));
  const roots = structuralNodes.filter((node) => {
    const incomingIds = incoming.get(node.id) ?? [];
    return incomingIds.every((sourceId) => !sceneNodes.some((candidate) => candidate.id === sourceId));
  });
  const candidates = roots.length > 0 ? roots : structuralNodes;
  return candidates.sort((a, b) => a.y - b.y || a.x - b.x)[0];
}

function findStoryletStartNodes(graph: StoryGraph): GraphNodeType[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  return graph.nodes
    .filter((node) => node.type === 'storylet-beat')
    .filter((node) => {
      const incomingStoryletEdges = graph.edges.filter((edge) => edge.target === node.id && edge.type === 'storylet');
      return incomingStoryletEdges.some((edge) => nodeById.get(edge.source)?.type !== 'storylet-beat');
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function buildSceneShortcutLabel(node: GraphNodeType, index: number): string {
  const prefix = node.type === 'phase' || node.type === 'encounter-situation' ? 'ENC' : `S${index}`;
  return `${prefix}:${truncateShortcutLabel(node.sceneTitle || node.sceneId || node.label || 'SCENE', 12)}`;
}

function truncateShortcutLabel(value: string, maxLength: number): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(1, maxLength - 3))}...`;
}

function focusNodeInViewport(
  node: GraphNodeType,
  viewportWidth: number,
  canvasHeight: number,
  scale: number,
  bottomOcclusion: number,
): ViewState {
  if (bottomOcclusion <= 0) return zoomToNode(node, viewportWidth, canvasHeight, scale);

  const availableHeight = Math.max(240, canvasHeight - bottomOcclusion);
  const visibleCenterY = availableHeight / 2;
  const nodeCenterX = node.x + node.width / 2;
  const nodeCenterY = node.y + node.height / 2;
  const nextBeatPeek = Math.min(130, Math.max(70, bottomOcclusion * 0.42));

  return {
    scale,
    translateX: viewportWidth / 2 - nodeCenterX * scale,
    translateY: visibleCenterY - nodeCenterY * scale - nextBeatPeek,
  };
}

export default StoryVisualizer;
