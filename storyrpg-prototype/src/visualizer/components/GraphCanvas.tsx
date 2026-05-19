import React, { useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, Platform, TouchableOpacity, useWindowDimensions } from 'react-native';
import Svg, { G, Defs, Pattern, Line, Rect } from 'react-native-svg';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import {
  StoryGraph,
  GraphEdge as GraphEdgeType,
  GraphNode as GraphNodeType,
  ViewState,
  VISUALIZER_COLORS,
  VisualizerMode,
} from '../types';
import { TERMINAL } from '../../theme';
import { GraphNode } from './GraphNode';
import { GraphEdge } from './GraphEdge';

interface GraphCanvasProps {
  graph: StoryGraph;
  viewState: ViewState;
  onViewStateChange: (state: ViewState) => void;
  onNodePress: (node: GraphNodeType) => void;
  onEdgePress: (edge: GraphEdgeType) => void;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  mode: VisualizerMode;
  selectedNpcId: string | null;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  graph,
  viewState,
  onViewStateChange,
  onNodePress,
  onEdgePress,
  selectedNodeId,
  selectedEdgeId,
  mode,
  selectedNpcId,
}) => {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const canvasHeight = Math.max(320, viewportHeight - 180);
  const containerRef = useRef<View>(null);
  const isMouseDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const viewStateRef = useRef(viewState);
  const pendingViewStateRef = useRef<ViewState | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Keep viewStateRef in sync
  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  const scheduleViewStateChange = useCallback((nextViewState: ViewState) => {
    viewStateRef.current = nextViewState;
    pendingViewStateRef.current = nextViewState;

    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pendingViewState = pendingViewStateRef.current;
      pendingViewStateRef.current = null;

      if (pendingViewState) {
        onViewStateChange(pendingViewState);
      }
    });
  }, [onViewStateChange]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const element = containerRef.current as unknown as HTMLElement | null;
    const rect = element?.getBoundingClientRect?.();

    if (!rect) {
      return { x: clientX, y: clientY };
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  // Find node at position
  const findNodeAtPosition = useCallback((x: number, y: number): GraphNodeType | null => {
    const canvasPoint = getCanvasPoint(x, y);
    const transformedX = (canvasPoint.x - viewStateRef.current.translateX) / viewStateRef.current.scale;
    const transformedY = (canvasPoint.y - viewStateRef.current.translateY) / viewStateRef.current.scale;

    for (let i = graph.nodes.length - 1; i >= 0; i--) {
      const node = graph.nodes[i];
      if (
        transformedX >= node.x &&
        transformedX <= node.x + node.width &&
        transformedY >= node.y &&
        transformedY <= node.y + node.height
      ) {
        return node;
      }
    }
    return null;
  }, [getCanvasPoint, graph.nodes]);

  // Mouse/touch handlers for web
  const handlePointerDown = useCallback((e: React.PointerEvent | any) => {
    const clientX = e.clientX ?? e.nativeEvent?.pageX ?? 0;
    const clientY = e.clientY ?? e.nativeEvent?.pageY ?? 0;
    e.currentTarget?.setPointerCapture?.(e.pointerId);

    isMouseDownRef.current = true;
    isDraggingRef.current = false;
    dragStartPosRef.current = { x: clientX, y: clientY };
    lastMousePosRef.current = { x: clientX, y: clientY };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent | any) => {
    if (!isMouseDownRef.current) return;

    const clientX = e.clientX ?? e.nativeEvent?.pageX ?? 0;
    const clientY = e.clientY ?? e.nativeEvent?.pageY ?? 0;

    const dx = clientX - lastMousePosRef.current.x;
    const dy = clientY - lastMousePosRef.current.y;

    // Check if we've moved enough to consider it a drag
    const totalDx = Math.abs(clientX - dragStartPosRef.current.x);
    const totalDy = Math.abs(clientY - dragStartPosRef.current.y);

    if (totalDx > 5 || totalDy > 5) {
      isDraggingRef.current = true;
    }

    if (isDraggingRef.current) {
      scheduleViewStateChange({
        ...viewStateRef.current,
        translateX: viewStateRef.current.translateX + dx,
        translateY: viewStateRef.current.translateY + dy,
      });
    }

    lastMousePosRef.current = { x: clientX, y: clientY };
  }, [scheduleViewStateChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent | any) => {
    if (!isMouseDownRef.current) return;

    const clientX = e.clientX ?? e.nativeEvent?.pageX ?? 0;
    const clientY = e.clientY ?? e.nativeEvent?.pageY ?? 0;
    e.currentTarget?.releasePointerCapture?.(e.pointerId);

    // If we didn't drag, check for node click
    if (!isDraggingRef.current) {
      const node = findNodeAtPosition(clientX, clientY);
      if (node) {
        onNodePress(node);
      }
    }

    isMouseDownRef.current = false;
    isDraggingRef.current = false;
    dragStartPosRef.current = { x: 0, y: 0 };
  }, [findNodeAtPosition, onNodePress]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const clientX = e.clientX ?? 0;
    const clientY = e.clientY ?? 0;
    const delta = e.deltaY ?? 0;

    const zoomFactor = delta > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(3, viewStateRef.current.scale * zoomFactor));
    const selectedNode = selectedNodeId
      ? graph.nodes.find((node) => node.id === selectedNodeId)
      : null;

    if (selectedNode) {
      const nodeCenterX = selectedNode.x + selectedNode.width / 2;
      const nodeCenterY = selectedNode.y + selectedNode.height / 2;

      scheduleViewStateChange({
        scale: newScale,
        translateX: viewportWidth / 2 - nodeCenterX * newScale,
        translateY: canvasHeight / 2 - nodeCenterY * newScale,
      });
      return;
    }

    // Zoom toward mouse position
    const canvasPoint = getCanvasPoint(clientX, clientY);
    const scaleChange = newScale / viewStateRef.current.scale;
    const newTranslateX = canvasPoint.x - (canvasPoint.x - viewStateRef.current.translateX) * scaleChange;
    const newTranslateY = canvasPoint.y - (canvasPoint.y - viewStateRef.current.translateY) * scaleChange;

    scheduleViewStateChange({
      scale: newScale,
      translateX: newTranslateX,
      translateY: newTranslateY,
    });
  }, [canvasHeight, getCanvasPoint, graph.nodes, scheduleViewStateChange, selectedNodeId, viewportWidth]);

  const pageView = useCallback((direction: 'up' | 'down') => {
    const screenDelta = canvasHeight * 0.92;
    scheduleViewStateChange({
      ...viewStateRef.current,
      translateY: viewStateRef.current.translateY + (direction === 'up' ? screenDelta : -screenDelta),
    });
  }, [canvasHeight, scheduleViewStateChange]);

  const stopCanvasGesture = useCallback((event: React.PointerEvent | any) => {
    event.stopPropagation?.();
  }, []);

  // Attach wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const container = containerRef.current;
    if (!container) return;

    // Get the underlying DOM element
    const element = container as unknown as HTMLElement;

    element.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Create a node map for edge rendering
  const nodeMap = new Map<string, GraphNodeType>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }
  const outgoingEdgeGroups = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const group = outgoingEdgeGroups.get(edge.source) ?? [];
    group.push(edge.id);
    outgoingEdgeGroups.set(edge.source, group);
  }

  // Find highlighted edges (connected to selected node or selected choice/route)
  const highlightedEdgeIds = new Set<string>();
  const hasFocusedSelection = Boolean(selectedNodeId || selectedEdgeId);
  if (selectedNodeId) {
    for (const edge of graph.edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        highlightedEdgeIds.add(edge.id);
      }
    }
    addEncounterOutcomeHighlights(selectedNodeId, graph.edges, nodeMap, highlightedEdgeIds);
  }
  if (selectedEdgeId) {
    highlightedEdgeIds.add(selectedEdgeId);
  }
  if (selectedNpcId) {
    for (const edge of graph.edges) {
      if (edge.choiceSystem?.relationshipNpcIds.includes(selectedNpcId)) {
        highlightedEdgeIds.add(edge.id);
      }
    }
  }
  const hiddenLabelEdgeIds = aggregateDuplicateEdgeLabels({
    edges: graph.edges,
    nodeMap,
    outgoingEdgeGroups,
    mode,
    highlightedEdgeIds,
  });

  // Build event handlers based on platform
  const eventHandlers = Platform.OS === 'web' ? {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerLeave: handlePointerUp,
  } : {
    onTouchStart: handlePointerDown,
    onTouchMove: handlePointerMove,
    onTouchEnd: handlePointerUp,
  };

  const gridSize = 50;

  return (
    <View
      ref={containerRef}
      style={styles.container}
      {...eventHandlers as any}
    >
      <Svg
        width={viewportWidth}
        height={canvasHeight}
        viewBox={`0 0 ${viewportWidth} ${canvasHeight}`}
        preserveAspectRatio="none"
        style={styles.svg}
      >
        <Defs>
          <Pattern
            id="grid"
            width={gridSize * viewState.scale}
            height={gridSize * viewState.scale}
            patternUnits="userSpaceOnUse"
            x={viewState.translateX % (gridSize * viewState.scale)}
            y={viewState.translateY % (gridSize * viewState.scale)}
          >
            <Line
              x1="0"
              y1="0"
              x2={gridSize * viewState.scale}
              y2="0"
              stroke={TERMINAL.colors.bgHighlight}
              strokeWidth="1"
            />
            <Line
              x1="0"
              y1="0"
              x2="0"
              y2={gridSize * viewState.scale}
              stroke={TERMINAL.colors.bgHighlight}
              strokeWidth="1"
            />
          </Pattern>
        </Defs>

        {/* Background Grid */}
        <Rect width="100%" height="100%" fill="url(#grid)" />

        <G
          transform={`translate(${viewState.translateX}, ${viewState.translateY}) scale(${viewState.scale})`}
        >
          {/* Render edges first (below nodes) */}
          {graph.edges.map((edge) => {
            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);

            if (!sourceNode || !targetNode) return null;
            const outgoingSiblings = outgoingEdgeGroups.get(edge.source) ?? [edge.id];

            return (
              <GraphEdge
                key={edge.id}
                edge={edge}
                sourceNode={sourceNode}
                targetNode={targetNode}
                sourceSiblingIndex={outgoingSiblings.indexOf(edge.id)}
                sourceSiblingCount={outgoingSiblings.length}
                isHighlighted={highlightedEdgeIds.has(edge.id)}
                isDimmed={hasFocusedSelection && !highlightedEdgeIds.has(edge.id)}
                hideLabel={hiddenLabelEdgeIds.has(edge.id)}
                mode={mode}
                selectedNpcId={selectedNpcId}
                onPress={onEdgePress}
              />
            );
          })}

          {/* Render nodes */}
          {graph.nodes.map((node) => (
            <GraphNode
              key={node.id}
              node={node}
              isSelected={node.id === selectedNodeId}
              mode={mode}
              selectedNpcId={selectedNpcId}
            />
          ))}
        </G>

        {/* Scanlines overlay */}
        {(() => {
          const RectAny = Rect as unknown as React.ComponentType<Record<string, unknown>>;
          return (
            <RectAny
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.05)"
              style={{ pointerEvents: 'none' }}
            />
          );
        })()}
      </Svg>
      <View
        style={styles.pageControls}
        pointerEvents="box-none"
        {...(Platform.OS === 'web'
          ? {
            onPointerDown: stopCanvasGesture,
            onPointerMove: stopCanvasGesture,
            onPointerUp: stopCanvasGesture,
          }
          : {
            onTouchStart: stopCanvasGesture,
            onTouchMove: stopCanvasGesture,
            onTouchEnd: stopCanvasGesture,
          }) as any}
      >
        <TouchableOpacity
          accessibilityLabel="Skip up one screen"
          onPress={() => pageView('up')}
          style={styles.pageButton}
          activeOpacity={0.75}
        >
          <ChevronUp size={24} color={TERMINAL.colors.primary} strokeWidth={2.4} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="Skip down one screen"
          onPress={() => pageView('down')}
          style={styles.pageButton}
          activeOpacity={0.75}
        >
          <ChevronDown size={24} color={TERMINAL.colors.primary} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VISUALIZER_COLORS.background,
    ...(Platform.OS === 'web'
      ? ({
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      } as Record<string, string>)
      : null),
  },
  svg: {
    width: '100%',
    height: '100%',
    backgroundColor: VISUALIZER_COLORS.background,
  },
  pageControls: {
    position: 'absolute',
    right: 18,
    gap: 10,
    zIndex: 30,
    elevation: 30,
  },
  pageButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5, 7, 12, 0.88)',
    borderColor: VISUALIZER_COLORS.nodeBorders.beat,
    borderWidth: 1,
  },
});

function addEncounterOutcomeHighlights(
  selectedNodeId: string,
  edges: GraphEdgeType[],
  nodeMap: Map<string, GraphNodeType>,
  highlightedEdgeIds: Set<string>,
) {
  const selectedNode = nodeMap.get(selectedNodeId);
  if (!selectedNode || !isEncounterBeatNode(selectedNode)) return;

  const localChoiceIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source !== selectedNodeId) continue;
    const target = nodeMap.get(edge.target);
    if (target?.type === 'encounter-choice') {
      localChoiceIds.add(target.id);
      highlightedEdgeIds.add(edge.id);
    }
  }

  if (localChoiceIds.size === 0) return;

  for (const edge of edges) {
    if (!localChoiceIds.has(edge.source)) continue;
    if (isEncounterOutcomeEdge(edge)) {
      highlightedEdgeIds.add(edge.id);
    }
  }
}

function isEncounterBeatNode(node: GraphNodeType): boolean {
  return node.type === 'phase' || node.type === 'encounter-situation';
}

function isEncounterOutcomeEdge(edge: GraphEdgeType): boolean {
  return Boolean(edge.synthetic?.kind === 'encounter-outcome' || edge.synthetic?.outcome);
}

function aggregateDuplicateEdgeLabels(input: {
  edges: GraphEdgeType[];
  nodeMap: Map<string, GraphNodeType>;
  outgoingEdgeGroups: Map<string, string[]>;
  mode: VisualizerMode;
  highlightedEdgeIds: Set<string>;
}): Set<string> {
  const hidden = new Set<string>();
  const keptByLabel = new Map<string, Array<{ x: number; y: number; highlighted: boolean }>>();
  const sortedEdges = [...input.edges].sort((a, b) => {
    const aHighlighted = input.highlightedEdgeIds.has(a.id) ? 0 : 1;
    const bHighlighted = input.highlightedEdgeIds.has(b.id) ? 0 : 1;
    return aHighlighted - bHighlighted;
  });

  for (const edge of sortedEdges) {
    if (!shouldAggregateLabel(edge)) continue;
    const sourceNode = input.nodeMap.get(edge.source);
    const targetNode = input.nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const label = getCanvasEdgeLabel(edge, input.mode).toUpperCase();
    if (!label) continue;

    const siblings = input.outgoingEdgeGroups.get(edge.source) ?? [edge.id];
    const position = getCanvasEdgeLabelPosition(
      edge,
      sourceNode,
      targetNode,
      siblings.indexOf(edge.id),
      siblings.length,
    );
    const labelKey = `${label}:${edge.synthetic?.outcome ?? edge.synthetic?.tier ?? edge.type}`;
    const kept = keptByLabel.get(labelKey) ?? [];
    const highlighted = input.highlightedEdgeIds.has(edge.id);
    const nearby = kept.find((item) => Math.abs(item.x - position.x) < 190 && Math.abs(item.y - position.y) < 88);

    if (nearby && !highlighted) {
      hidden.add(edge.id);
      continue;
    }

    if (nearby && highlighted && !nearby.highlighted) {
      hidden.add(edge.id);
      continue;
    }

    kept.push({ ...position, highlighted });
    keptByLabel.set(labelKey, kept);
  }

  return hidden;
}

function shouldAggregateLabel(edge: GraphEdgeType): boolean {
  return Boolean(edge.synthetic?.outcome || edge.synthetic?.kind === 'encounter-outcome');
}

function getCanvasEdgeLabel(edge: GraphEdgeType, mode: VisualizerMode): string {
  if (edge.synthetic) {
    return mode === 'author' ? edge.synthetic.authorLabel : edge.synthetic.playerLabel;
  }
  if (mode === 'player' && edge.choiceSystem?.playerLabel) {
    return edge.choiceSystem.playerLabel;
  }
  if (mode === 'author' && edge.choiceSystem?.authorLabel) {
    return edge.choiceSystem.authorLabel;
  }
  return edge.label ?? '';
}

function getCanvasEdgeLabelPosition(
  edge: GraphEdgeType,
  sourceNode: GraphNodeType,
  targetNode: GraphNodeType,
  sourceSiblingIndex: number,
  sourceSiblingCount: number,
): { x: number; y: number } {
  const sourceCenterX = sourceNode.x + sourceNode.width / 2;
  const sourceBottomY = sourceNode.y + sourceNode.height;
  const targetCenterX = targetNode.x + targetNode.width / 2;
  const targetTopY = targetNode.y;
  const siblingOffset = sourceSiblingIndex - (sourceSiblingCount - 1) / 2;
  const isChoiceEdge = edge.type === 'choice';
  const isOutcomeLabel = shouldAggregateLabel(edge);

  return {
    x: isOutcomeLabel
      ? targetCenterX
      : isChoiceEdge ? targetCenterX : (sourceCenterX + targetCenterX) / 2,
    y: isOutcomeLabel
      ? Math.min(targetTopY - 24, Math.max(sourceBottomY + 24, targetTopY - 48 - Math.abs(siblingOffset) * 4))
      : isChoiceEdge
      ? Math.max(sourceBottomY + 18, targetTopY - 54 - Math.abs(siblingOffset) * 6)
      : (sourceBottomY + targetTopY) / 2,
  };
}

export default GraphCanvas;
