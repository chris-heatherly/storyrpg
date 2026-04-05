import React, { useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, Dimensions, Platform } from 'react-native';
import Svg, { G, Defs, Pattern, Line, Rect } from 'react-native-svg';
import { StoryGraph, GraphNode as GraphNodeType, ViewState, VISUALIZER_COLORS } from '../types';
import { TERMINAL } from '../../theme';
import { GraphNode } from './GraphNode';
import { GraphEdge } from './GraphEdge';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface GraphCanvasProps {
  graph: StoryGraph;
  viewState: ViewState;
  onViewStateChange: (state: ViewState) => void;
  onNodePress: (node: GraphNodeType) => void;
  selectedNodeId: string | null;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  graph,
  viewState,
  onViewStateChange,
  onNodePress,
  selectedNodeId,
}) => {
  const containerRef = useRef<View>(null);
  const isMouseDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const viewStateRef = useRef(viewState);

  // Keep viewStateRef in sync
  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  // Find node at position
  const findNodeAtPosition = useCallback((x: number, y: number): GraphNodeType | null => {
    // Account for potential header height (approx 140px)
    const headerOffset = 140;
    const transformedX = (x - viewStateRef.current.translateX) / viewStateRef.current.scale;
    const transformedY = (y - headerOffset - viewStateRef.current.translateY) / viewStateRef.current.scale;

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
  }, [graph.nodes]);

  // Mouse/touch handlers for web
  const handlePointerDown = useCallback((e: React.PointerEvent | any) => {
    const clientX = e.clientX ?? e.nativeEvent?.pageX ?? 0;
    const clientY = e.clientY ?? e.nativeEvent?.pageY ?? 0;

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
      onViewStateChange({
        ...viewStateRef.current,
        translateX: viewStateRef.current.translateX + dx,
        translateY: viewStateRef.current.translateY + dy,
      });
    }

    lastMousePosRef.current = { x: clientX, y: clientY };
  }, [onViewStateChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent | any) => {
    if (!isMouseDownRef.current) return;

    const clientX = e.clientX ?? e.nativeEvent?.pageX ?? 0;
    const clientY = e.clientY ?? e.nativeEvent?.pageY ?? 0;

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

    // Zoom toward mouse position
    const scaleChange = newScale / viewStateRef.current.scale;
    const newTranslateX = clientX - (clientX - viewStateRef.current.translateX) * scaleChange;
    const newTranslateY = clientY - (clientY - viewStateRef.current.translateY) * scaleChange;

    onViewStateChange({
      scale: newScale,
      translateX: newTranslateX,
      translateY: newTranslateY,
    });
  }, [onViewStateChange]);

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

  // Find highlighted edges (connected to selected node)
  const highlightedEdgeIds = new Set<string>();
  if (selectedNodeId) {
    for (const edge of graph.edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        highlightedEdgeIds.add(edge.id);
      }
    }
  }

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
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT - 180}
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

            return (
              <GraphEdge
                key={edge.id}
                edge={edge}
                sourceNode={sourceNode}
                targetNode={targetNode}
                isHighlighted={highlightedEdgeIds.has(edge.id)}
              />
            );
          })}

          {/* Render nodes */}
          {graph.nodes.map((node) => (
            <GraphNode
              key={node.id}
              node={node}
              isSelected={node.id === selectedNodeId}
            />
          ))}
        </G>

        {/* Scanlines overlay */}
        <Rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.05)"
          style={{ pointerEvents: 'none' }}
        />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VISUALIZER_COLORS.background,
  },
  svg: {
    backgroundColor: VISUALIZER_COLORS.background,
  },
});

export default GraphCanvas;
