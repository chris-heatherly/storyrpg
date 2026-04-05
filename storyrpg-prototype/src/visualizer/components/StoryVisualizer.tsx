import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Story } from '../../types';
import { GraphNode as GraphNodeType, ViewState, VISUALIZER_COLORS } from '../types';
import { TERMINAL } from '../../theme';
import { transformStoryToGraph } from '../storyGraphTransformer';
import { layoutGraph, fitGraphToViewport } from '../layoutEngine';
import { GraphCanvas } from './GraphCanvas';
import { NodeDetailPanel } from './NodeDetailPanel';
import { VisualizerControls } from './VisualizerControls';

interface StoryVisualizerProps {
  story: Story;
  onBack: () => void;
  onSwitchToColumns?: () => void;
}

export const StoryVisualizer: React.FC<StoryVisualizerProps> = ({ story, onBack, onSwitchToColumns }) => {
  const [viewState, setViewState] = useState<ViewState>({
    scale: 0.5,
    translateX: 50,
    translateY: 150,
  });
  const [selectedNode, setSelectedNode] = useState<GraphNodeType | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Transform and layout the graph
  const graph = useMemo(() => {
    const rawGraph = transformStoryToGraph(story);
    return layoutGraph(rawGraph);
  }, [story]);

  // Initial fit to screen
  useEffect(() => {
    if (graph.nodes.length > 0) {
      const fitted = fitGraphToViewport(graph, 400, 600, 50);
      setViewState(fitted);
      setIsLoading(false);
    }
  }, [graph]);

  const handleNodePress = (node: GraphNodeType) => {
    setSelectedNode(node);
  };

  const handleClosePanel = () => {
    setSelectedNode(null);
  };

  const handleZoomIn = () => {
    setViewState((prev) => ({
      ...prev,
      scale: Math.min(3, prev.scale * 1.25),
    }));
  };

  const handleZoomOut = () => {
    setViewState((prev) => ({
      ...prev,
      scale: Math.max(0.1, prev.scale / 1.25),
    }));
  };

  const handleFitToScreen = () => {
    const fitted = fitGraphToViewport(graph, 400, 600, 50);
    setViewState(fitted);
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
        nodeCount={graph.nodes.length}
        edgeCount={graph.edges.length}
      />

      <GraphCanvas
        graph={graph}
        viewState={viewState}
        onViewStateChange={setViewState}
        onNodePress={handleNodePress}
        selectedNodeId={selectedNode?.id || null}
      />

      <NodeDetailPanel node={selectedNode} onClose={handleClosePanel} />
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
});

export default StoryVisualizer;
