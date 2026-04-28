import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  TextInput,
  Alert,
  PanResponder,
  GestureResponderEvent,
  Platform,
} from 'react-native';
import Svg, { Path, Defs, Marker, Polygon, G, Line, Pattern, Rect } from 'react-native-svg';
import {
  GitBranch,
  MessageSquare,
  Info,
  Eye,
  X,
  Layout,
  Map as MapIcon,
  MousePointer2,
  Wand2,
  RefreshCw,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Move,
} from 'lucide-react-native';
import { Story, Beat, Choice, Scene, Episode } from '../types';
import { mediaRefAsString } from '../assets/assetRef';
import { TERMINAL } from '../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface StoryBrowserProps {
  story: Story;
  onClose: () => void;
  onJumpToNode?: (nodeId: string) => void;
  viewMode?: 'columns' | 'map';
  onViewModeChange?: (mode: 'columns' | 'map') => void;
}

// Flat node representation for map view
interface MapNode {
  id: string;
  type: 'beat' | 'scene' | 'episode';
  label: string;
  sublabel?: string;
  image?: string;
  sceneId: string;
  episodeId: string;
  beatId?: string;
  beat?: Beat;
  scene?: Scene;
}

// Connection between nodes
interface MapConnection {
  from: string;
  to: string;
  type: 'next' | 'choice' | 'success' | 'failure' | 'partial';
  label?: string;
}

function buildMapData(story: Story) {
  const nodes: MapNode[] = [];
  const connections: MapConnection[] = [];
  const nodeMap = new Map<string, MapNode>();

  // Helper to create unique node IDs
  const makeNodeId = (epIndex: number, scIndex: number, beatIndex: number) => 
    `node-ep${epIndex}-sc${scIndex}-beat${beatIndex}`;

  // Build lookup tables
  const beatToNodeId = new Map<string, string>(); // beatId -> nodeId
  const sceneFirstBeat = new Map<string, string>(); // sceneId -> first beat nodeId

  story.episodes.forEach((episode, epIndex) => {
    episode.scenes.forEach((scene, scIndex) => {
      scene.beats.forEach((beat, beatIndex) => {
        const nodeId = makeNodeId(epIndex, scIndex, beatIndex);
        beatToNodeId.set(`${scene.id}:${beat.id}`, nodeId);
        
        // Track first beat of each scene
        if (beatIndex === 0 || beat.id === scene.startingBeatId) {
          sceneFirstBeat.set(scene.id, nodeId);
        }

        const node: MapNode = {
          id: nodeId,
          type: 'beat',
          label: beat.speaker || `Beat ${beatIndex + 1}`,
          sublabel: beat.text.slice(0, 50) + (beat.text.length > 50 ? '...' : ''),
          image: mediaRefAsString(beat.image) || undefined,
          sceneId: scene.id,
          episodeId: episode.id,
          beatId: beat.id,
          beat,
          scene,
        };
        nodes.push(node);
        nodeMap.set(nodeId, node);
      });
    });
  });

  // Build connections
  story.episodes.forEach((episode, epIndex) => {
    episode.scenes.forEach((scene, scIndex) => {
      scene.beats.forEach((beat, beatIndex) => {
        const fromId = makeNodeId(epIndex, scIndex, beatIndex);

        if (beat.choices && beat.choices.length > 0) {
          beat.choices.forEach((choice) => {
            if (choice.nextBeatId) {
              const toId = beatToNodeId.get(`${scene.id}:${choice.nextBeatId}`);
              if (toId && nodeMap.has(toId)) {
                connections.push({
                  from: fromId,
                  to: toId,
                  type: 'choice',
                  label: choice.text,
                });
              }
            }
            if (choice.nextSceneId) {
              const toId = sceneFirstBeat.get(choice.nextSceneId);
              if (toId && nodeMap.has(toId)) {
                connections.push({
                  from: fromId,
                  to: toId,
                  type: 'choice',
                  label: choice.text,
                });
              }
            }
          });
        } else {
          // Auto-advance
          if (beat.nextBeatId) {
            const toId = beatToNodeId.get(`${scene.id}:${beat.nextBeatId}`);
            if (toId && nodeMap.has(toId)) {
              connections.push({
                from: fromId,
                to: toId,
                type: 'next',
              });
            }
          } else if (beat.nextSceneId) {
            const toId = sceneFirstBeat.get(beat.nextSceneId);
            if (toId && nodeMap.has(toId)) {
              connections.push({
                from: fromId,
                to: toId,
                type: 'next',
              });
            }
          } else if (beatIndex < scene.beats.length - 1) {
            // Connect to next beat in sequence
            const toId = makeNodeId(epIndex, scIndex, beatIndex + 1);
            connections.push({
              from: fromId,
              to: toId,
              type: 'next',
            });
          }
        }
      });
    });
  });

  // Calculate positions using BFS levels
  const levels: string[][] = [];
  const nodeToLevel = new Map<string, number>();
  const visited = new Set<string>();

  if (nodes.length > 0) {
    const queue: { id: string; level: number }[] = [{ id: nodes[0].id, level: 0 }];
    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      if (!levels[level]) levels[level] = [];
      levels[level].push(id);
      nodeToLevel.set(id, level);

      connections
        .filter(c => c.from === id)
        .forEach(c => {
          if (!visited.has(c.to)) {
            queue.push({ id: c.to, level: level + 1 });
          }
        });
    }

    // Add orphans
    nodes.forEach(node => {
      if (!visited.has(node.id)) {
        if (!levels[0]) levels[0] = [];
        levels[0].push(node.id);
        visited.add(node.id);
      }
    });
  }

  // Assign positions
  const HORIZONTAL_SPACING = 280;
  const VERTICAL_SPACING = 140;
  const nodePositions = new Map<string, { x: number; y: number }>();

  levels.forEach((levelNodes, levelIdx) => {
    const totalHeight = (levelNodes.length - 1) * VERTICAL_SPACING;
    levelNodes.forEach((nodeId, i) => {
      nodePositions.set(nodeId, {
        x: levelIdx * HORIZONTAL_SPACING + 100,
        y: i * VERTICAL_SPACING - totalHeight / 2 + 400,
      });
    });
  });

  return { nodes, connections, nodePositions, levels };
}

export const StoryBrowser: React.FC<StoryBrowserProps> = ({
  story,
  onClose,
  onJumpToNode,
  viewMode: externalViewMode,
  onViewModeChange,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [internalViewMode, setInternalViewMode] = useState<'columns' | 'map'>('columns');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  
  // Map view state
  const [scale, setScale] = useState(0.8);
  const [translate, setTranslate] = useState({ x: 50, y: 200 });
  const [isDragging, setIsDragging] = useState(false);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<View>(null);

  const viewMode = externalViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(2, prev * 1.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(0.2, prev / 1.25));
  }, []);

  const handleFitToScreen = useCallback(() => {
    setScale(0.6);
    setTranslate({ x: 50, y: 200 });
  }, []);

  // Wheel handler for zoom (must be at top level)
  const handleWheel = useCallback((e: any) => {
    if (Platform.OS === 'web') {
      e.preventDefault?.();
      const delta = e.deltaY || 0;
      const zoomFactor = delta > 0 ? 0.9 : 1.1;
      setScale(prev => Math.max(0.2, Math.min(2, prev * zoomFactor)));
    }
  }, []);

  // Attach wheel listener for web (must be at top level)
  useEffect(() => {
    if (Platform.OS === 'web' && viewMode === 'map' && containerRef.current) {
      const element = containerRef.current as unknown as HTMLElement;
      element?.addEventListener?.('wheel', handleWheel, { passive: false });
      return () => {
        element?.removeEventListener?.('wheel', handleWheel);
      };
    }
  }, [viewMode, handleWheel]);

  // Pan handlers
  const handleMouseDown = useCallback((e: any) => {
    if (Platform.OS === 'web') {
      setIsDragging(true);
      lastPanRef.current = { x: e.clientX || e.nativeEvent?.pageX || 0, y: e.clientY || e.nativeEvent?.pageY || 0 };
    }
  }, []);

  const handleMouseMove = useCallback((e: any) => {
    if (Platform.OS === 'web' && isDragging) {
      const clientX = e.clientX || e.nativeEvent?.pageX || 0;
      const clientY = e.clientY || e.nativeEvent?.pageY || 0;
      const dx = clientX - lastPanRef.current.x;
      const dy = clientY - lastPanRef.current.y;
      setTranslate(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPanRef.current = { x: clientX, y: clientY };
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const mapData = useMemo(() => buildMapData(story), [story]);

  useEffect(() => {
    if (mapData.nodes.length > 0 && !selectedNodeId) {
      setSelectedNodeId(mapData.nodes[0].id);
    }
  }, [mapData, selectedNodeId]);

  const selectedNode = useMemo(
    () => mapData.nodes.find((n) => n.id === selectedNodeId),
    [mapData, selectedNodeId]
  );

  const outgoingConnections = useMemo(
    () => (selectedNodeId ? mapData.connections.filter((c) => c.from === selectedNodeId) : []),
    [mapData, selectedNodeId]
  );

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setGenStatus('Initializing Nano Banana...');

    const steps = [
      'Parsing prompt instructions...',
      'Synthesizing cinematic frame...',
      'Applying cinematic aesthetic...',
      'Finalizing image buffer...',
    ];

    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setGenStatus(step);
    }

    Alert.alert(
      'Regeneration Completed',
      `Image regenerated for node: ${selectedNode?.label}`
    );
    setIsRegenerating(false);
    setGenStatus('');
  };

  const getConnectionColor = (type: string, isSelected: boolean) => {
    const alpha = isSelected ? '0.9' : '0.4';
    switch (type) {
      case 'success':
        return `rgba(34, 197, 94, ${alpha})`;
      case 'failure':
        return `rgba(239, 68, 68, ${alpha})`;
      case 'partial':
        return `rgba(245, 158, 11, ${alpha})`;
      case 'choice':
        return `rgba(139, 92, 246, ${alpha})`;
      default:
        return `rgba(59, 130, 246, ${alpha})`;
    }
  };

  const renderNodeItem = (node: MapNode, index: number) => {
    const isSelected = selectedNodeId === node.id;
    return (
      <TouchableOpacity
        key={node.id}
        onPress={() => setSelectedNodeId(node.id)}
        style={[styles.nodeItem, isSelected && styles.nodeItemSelected]}
      >
        <View style={[styles.nodeBadge, isSelected && styles.nodeBadgeSelected]}>
          <Text style={[styles.nodeBadgeText, isSelected && styles.nodeBadgeTextSelected]}>
            {index}
          </Text>
        </View>
        <View style={styles.nodeTextContainer}>
          <Text
            numberOfLines={1}
            style={[styles.nodeLabel, isSelected && styles.nodeLabelSelected]}
          >
            {node.label}
          </Text>
          {node.sublabel && (
            <Text
              numberOfLines={1}
              style={[styles.nodeSublabel, isSelected && styles.nodeSublabelSelected]}
            >
              {node.sublabel}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderDecisionMatrix = () => {
    if (outgoingConnections.length === 0) {
      return (
        <View style={styles.emptyDecision}>
          <Info size={40} color={TERMINAL.colors.muted} />
          <Text style={styles.emptyDecisionText}>END OF PATH</Text>
        </View>
      );
    }

    return outgoingConnections.map((conn, i) => {
      const targetNode = mapData.nodes.find((n) => n.id === conn.to);
      const targetIndex = mapData.nodes.findIndex((n) => n.id === conn.to);
      return (
        <TouchableOpacity
          key={`${conn.from}-${conn.to}-${i}`}
          onPress={() => setSelectedNodeId(conn.to)}
          style={styles.decisionCard}
        >
          <View style={styles.decisionHeader}>
            <View
              style={[
                styles.decisionTypeBadge,
                {
                  backgroundColor:
                    conn.type === 'choice'
                      ? 'rgba(139, 92, 246, 0.2)'
                      : conn.type === 'success'
                      ? 'rgba(34, 197, 94, 0.2)'
                      : conn.type === 'failure'
                      ? 'rgba(239, 68, 68, 0.2)'
                      : 'rgba(59, 130, 246, 0.2)',
                },
              ]}
            >
              <Text
                style={[
                  styles.decisionTypeText,
                  {
                    color:
                      conn.type === 'choice'
                        ? '#a78bfa'
                        : conn.type === 'success'
                        ? '#4ade80'
                        : conn.type === 'failure'
                        ? '#f87171'
                        : '#60a5fa',
                  },
                ]}
              >
                {conn.type.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.decisionTargetText}>TO NODE {targetIndex}</Text>
          </View>
          <Text style={styles.decisionLabel}>{conn.label || 'AUTO-ADVANCE'}</Text>
        </TouchableOpacity>
      );
    });
  };

  const renderColumnsView = () => (
    <View style={styles.content}>
      {/* Column 1: Node List */}
      <View style={styles.column1}>
        <View style={styles.columnHeader}>
          <Text style={styles.columnHeaderText}>NODE HIERARCHY</Text>
        </View>
        <ScrollView style={styles.columnBody}>
          {mapData.nodes.map((node, idx) => renderNodeItem(node, idx))}
        </ScrollView>
      </View>

      {/* Column 2: Node Details */}
      <View style={styles.column2}>
        <View style={styles.columnHeader}>
          <Text style={styles.columnHeaderText}>SCENE CONTENT</Text>
        </View>
        <ScrollView style={styles.columnBody}>
          {selectedNode && (
            <>
              <View style={styles.imageContainer}>
                {selectedNode.image ? (
                  <Image
                    source={{ uri: selectedNode.image }}
                    style={[styles.nodeImage, isRegenerating && styles.nodeImageDimmed]}
                  />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <Text style={styles.placeholderText}>NO IMAGE</Text>
                  </View>
                )}

                {isRegenerating && (
                  <View style={styles.regenerationOverlay}>
                    <RefreshCw size={32} color={TERMINAL.colors.primary} />
                    <Text style={styles.regenerationText}>{genStatus}</Text>
                  </View>
                )}

                <View style={styles.imageOverlay}>
                  <Text style={styles.speakerLabel}>SPEAKER</Text>
                  <Text style={styles.speakerName}>{selectedNode.label || 'N/A'}</Text>
                </View>
              </View>

              <View style={styles.detailsBody}>
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <MessageSquare size={14} color={TERMINAL.colors.muted} />
                    <Text style={styles.sectionHeaderText}>DIALOGUE BLOCKS</Text>
                  </View>
                  <View style={styles.contentCard}>
                    <Text style={styles.contentCardLabel}>BASE</Text>
                    <Text style={styles.dialogueText}>
                      "{selectedNode.beat?.text || 'No dialogue text'}"
                    </Text>
                  </View>
                </View>

                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Wand2 size={14} color={TERMINAL.colors.primary} />
                    <Text style={[styles.sectionHeaderText, { color: TERMINAL.colors.primary }]}>
                      IMAGE GENERATION PROMPT
                    </Text>
                  </View>
                  <TextInput
                    style={styles.promptInput}
                    multiline
                    placeholder="Enter generation prompt..."
                    placeholderTextColor={TERMINAL.colors.muted}
                    defaultValue={`A cinematic scene of ${selectedNode.label}. High detail, 8k, dramatic lighting.`}
                  />
                  <TouchableOpacity
                    onPress={handleRegenerate}
                    disabled={isRegenerating}
                    style={[
                      styles.regenerateButton,
                      isRegenerating && styles.regenerateButtonDisabled,
                    ]}
                  >
                    <RefreshCw size={16} color="white" />
                    <Text style={styles.regenerateButtonText}>
                      {isRegenerating ? genStatus : 'REGENERATE IMAGE'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {onJumpToNode && (
                  <TouchableOpacity
                    onPress={() => onJumpToNode(selectedNode.id)}
                    style={styles.jumpButton}
                  >
                    <Eye size={16} color="white" />
                    <Text style={styles.jumpButtonText}>JUMP TO SCENE</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </View>

      {/* Column 3: Decision Matrix */}
      <View style={styles.column3}>
        <View style={styles.columnHeader}>
          <Text style={styles.columnHeaderText}>DECISION MATRIX</Text>
        </View>
        <ScrollView style={styles.columnBody}>
          <View style={styles.decisionList}>{renderDecisionMatrix()}</View>
        </ScrollView>
      </View>
    </View>
  );

  const renderFlowMapView = () => {
    const mapWidth = 5000;
    const mapHeight = 2000;

    const webEventHandlers = Platform.OS === 'web' ? {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
    } : {};

    return (
      <View style={styles.mapContainer}>
        {/* Zoom Controls */}
        <View style={styles.zoomControls}>
          <TouchableOpacity onPress={handleZoomIn} style={styles.zoomButton}>
            <ZoomIn size={18} color="white" />
          </TouchableOpacity>
          <View style={styles.zoomDivider} />
          <TouchableOpacity onPress={handleZoomOut} style={styles.zoomButton}>
            <ZoomOut size={18} color="white" />
          </TouchableOpacity>
          <View style={styles.zoomDivider} />
          <TouchableOpacity onPress={handleFitToScreen} style={styles.zoomButton}>
            <Maximize2 size={18} color="white" />
          </TouchableOpacity>
        </View>

        {/* Zoom Level Indicator */}
        <View style={styles.zoomIndicator}>
          <Text style={styles.zoomIndicatorText}>{Math.round(scale * 100)}%</Text>
        </View>

        {/* Pannable/Zoomable Canvas */}
        <View
          ref={containerRef}
          style={[styles.mapCanvas, isDragging && styles.mapCanvasDragging]}
          {...webEventHandlers as any}
        >
          <View
            style={{
              transform: [
                { translateX: translate.x },
                { translateY: translate.y },
                { scale: scale },
              ],
              width: mapWidth,
              height: mapHeight,
            }}
          >
            {/* SVG Connections */}
            <Svg
              width={mapWidth}
              height={mapHeight}
              style={{ position: 'absolute', top: 0, left: 0 }}
            >
              <Defs>
                <Marker id="arrowhead-next" markerWidth={10} markerHeight={7} refX={9} refY={3.5} orient="auto">
                  <Polygon points="0,0 10,3.5 0,7" fill="rgba(59, 130, 246, 0.6)" />
                </Marker>
                <Marker id="arrowhead-choice" markerWidth={10} markerHeight={7} refX={9} refY={3.5} orient="auto">
                  <Polygon points="0,0 10,3.5 0,7" fill="rgba(139, 92, 246, 0.6)" />
                </Marker>
                <Marker id="arrowhead-success" markerWidth={10} markerHeight={7} refX={9} refY={3.5} orient="auto">
                  <Polygon points="0,0 10,3.5 0,7" fill="rgba(34, 197, 94, 0.6)" />
                </Marker>
                <Marker id="arrowhead-failure" markerWidth={10} markerHeight={7} refX={9} refY={3.5} orient="auto">
                  <Polygon points="0,0 10,3.5 0,7" fill="rgba(239, 68, 68, 0.6)" />
                </Marker>
              </Defs>

              {/* Grid pattern */}
              <Defs>
                <Pattern id="grid" width={50} height={50} patternUnits="userSpaceOnUse">
                  <Line x1={0} y1={0} x2={50} y2={0} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
                  <Line x1={0} y1={0} x2={0} y2={50} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
                </Pattern>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#grid)" />

              {/* Connection paths */}
              {mapData.connections.map((conn, i) => {
                const start = mapData.nodePositions.get(conn.from);
                const end = mapData.nodePositions.get(conn.to);
                if (!start || !end) return null;

                const isSelected = selectedNodeId === conn.from;
                const color = getConnectionColor(conn.type, isSelected);

                const path = `M ${start.x + 200} ${start.y} C ${start.x + 260} ${start.y}, ${end.x - 60} ${end.y}, ${end.x} ${end.y}`;

                return (
                  <Path
                    key={`conn-${i}`}
                    d={path}
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 2}
                    fill="none"
                    markerEnd={`url(#arrowhead-${conn.type})`}
                  />
                );
              })}
            </Svg>

            {/* Nodes */}
            {mapData.nodes.map((node, idx) => {
              const pos = mapData.nodePositions.get(node.id);
              if (!pos) return null;
              const isSelected = selectedNodeId === node.id;

              return (
                <TouchableOpacity
                  key={node.id}
                  onPress={() => setSelectedNodeId(node.id)}
                  style={[
                    styles.mapNode,
                    isSelected && styles.mapNodeSelected,
                    { left: pos.x, top: pos.y - 40 },
                  ]}
                >
                  <View style={styles.mapNodeHeader}>
                    <View style={[styles.mapNodeBadge, isSelected && styles.mapNodeBadgeSelected]}>
                      <Text style={styles.mapNodeBadgeText}>NODE {idx}</Text>
                    </View>
                    {isSelected && <MousePointer2 size={12} color="white" />}
                  </View>
                  <Text
                    style={[styles.mapNodeLabel, isSelected && styles.mapNodeLabelSelected]}
                    numberOfLines={1}
                  >
                    {node.label}
                  </Text>
                  <Text
                    style={[styles.mapNodeSublabel, isSelected && styles.mapNodeSublabelSelected]}
                    numberOfLines={2}
                  >
                    {node.sublabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Map Legend */}
        <View style={styles.mapLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.legendText}>SUCCESS</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: '#f59e0b' }]} />
            <Text style={styles.legendText}>PARTIAL</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: '#ef4444' }]} />
            <Text style={styles.legendText}>FAILURE</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: '#8b5cf6' }]} />
            <Text style={styles.legendText}>CHOICE</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: '#3b82f6' }]} />
            <Text style={styles.legendText}>NEXT</Text>
          </View>
          <View style={styles.legendSeparator} />
          <View style={styles.legendItem}>
            <Move size={12} color={TERMINAL.colors.muted} />
            <Text style={styles.legendText}>DRAG</Text>
          </View>
          <Text style={styles.legendHint}>SCROLL TO ZOOM • DRAG TO PAN</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoContainer}>
            <GitBranch size={20} color="white" />
          </View>
          <View>
            <Text style={styles.headerTitle}>ADVENTURE NAVIGATOR</Text>
            <Text style={styles.headerSubtitle}>GLOBAL STORY GRAPH</Text>
          </View>
          <View style={styles.headerSeparator} />
          <View style={styles.adventureBadge}>
            <Text style={styles.adventureBadgeText}>{(story.title || 'Untitled').toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.viewModes}>
            <TouchableOpacity
              onPress={() => setViewMode('columns')}
              style={[styles.modeButton, viewMode === 'columns' && styles.modeButtonActive]}
            >
              <Layout size={14} color={viewMode === 'columns' ? 'white' : TERMINAL.colors.muted} />
              <Text style={[styles.modeButtonText, viewMode === 'columns' && styles.modeButtonTextActive]}>
                COLUMNS
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('map')}
              style={[styles.modeButton, viewMode === 'map' && styles.modeButtonActive]}
            >
              <MapIcon size={14} color={viewMode === 'map' ? 'white' : TERMINAL.colors.muted} />
              <Text style={[styles.modeButtonText, viewMode === 'map' && styles.modeButtonTextActive]}>
                FLOW MAP
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <X size={20} color={TERMINAL.colors.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {viewMode === 'columns' ? renderColumnsView() : renderFlowMapView()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0f12',
  },
  header: {
    height: 64,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    backgroundColor: '#0f1115',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: TERMINAL.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1.5,
  },
  headerSubtitle: {
    fontSize: 8,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 2,
  },
  headerSeparator: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: 16,
  },
  adventureBadge: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  adventureBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewModes: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginRight: 16,
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  },
  modeButtonActive: {
    backgroundColor: TERMINAL.colors.primary,
  },
  modeButtonText: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  modeButtonTextActive: {
    color: 'white',
  },
  closeButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
  },
  column1: {
    width: 300,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.05)',
    backgroundColor: '#0f1115',
  },
  column2: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.05)',
    backgroundColor: '#0d0f12',
  },
  column3: {
    width: 350,
    backgroundColor: '#0f1115',
  },
  columnHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  columnHeaderText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
  },
  columnBody: {
    flex: 1,
  },
  nodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 8,
    gap: 12,
  },
  nodeItemSelected: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  nodeBadge: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeBadgeSelected: {
    backgroundColor: TERMINAL.colors.primary,
    borderColor: TERMINAL.colors.primaryBright,
  },
  nodeBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: 'white',
  },
  nodeBadgeTextSelected: {
    color: 'white',
  },
  nodeTextContainer: {
    flex: 1,
  },
  nodeLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  nodeLabelSelected: {
    color: 'white',
  },
  nodeSublabel: {
    fontSize: 8,
    color: TERMINAL.colors.muted,
    marginTop: 2,
  },
  nodeSublabelSelected: {
    color: TERMINAL.colors.primaryBright,
  },
  imageContainer: {
    aspectRatio: 16 / 9,
    width: '100%',
    backgroundColor: 'black',
    position: 'relative',
  },
  nodeImage: {
    width: '100%',
    height: '100%',
    opacity: 0.8,
  },
  nodeImageDimmed: {
    opacity: 0.3,
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '900',
  },
  regenerationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  regenerationText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 24,
  },
  speakerLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 3,
    marginBottom: 4,
  },
  speakerName: {
    fontSize: 24,
    fontWeight: '900',
    color: 'white',
    letterSpacing: -0.5,
  },
  detailsBody: {
    padding: 24,
    gap: 24,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeaderText: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
  },
  contentCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  contentCardLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
    marginBottom: 8,
  },
  dialogueText: {
    fontSize: 18,
    fontWeight: '900',
    color: 'white',
    fontStyle: 'italic',
    lineHeight: 24,
  },
  promptInput: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 16,
    color: '#cbd5e1',
    fontSize: 11,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TERMINAL.colors.primary,
    padding: 12,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  regenerateButtonDisabled: {
    backgroundColor: '#1e293b',
  },
  regenerateButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 2,
  },
  jumpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    padding: 12,
    borderRadius: 12,
    gap: 8,
    marginTop: 16,
  },
  jumpButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 3,
  },
  decisionList: {
    padding: 16,
    gap: 12,
  },
  decisionCard: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  decisionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  decisionTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  decisionTypeText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  decisionTargetText: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
  },
  decisionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'white',
  },
  emptyDecision: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.3,
  },
  emptyDecisionText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
    marginTop: 16,
  },
  // Flow Map styles
  mapContainer: {
    flex: 1,
    backgroundColor: '#0d0f12',
    overflow: 'hidden',
  },
  mapCanvas: {
    flex: 1,
    overflow: 'hidden',
    cursor: 'grab' as unknown as undefined,
  },
  mapCanvasDragging: {
    cursor: 'grabbing' as unknown as undefined,
  },
  zoomControls: {
    position: 'absolute',
    top: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 100,
    overflow: 'hidden',
  },
  zoomButton: {
    padding: 12,
  },
  zoomDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  zoomIndicator: {
    position: 'absolute',
    top: 24,
    left: 24,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 100,
  },
  zoomIndicatorText: {
    fontSize: 11,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 1,
  },
  mapNode: {
    position: 'absolute',
    width: 200,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#1a1d21',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  mapNodeSelected: {
    backgroundColor: TERMINAL.colors.primary,
    borderColor: '#60a5fa',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
    transform: [{ scale: 1.05 }],
    zIndex: 100,
  },
  mapNodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  mapNodeBadge: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  mapNodeBadgeSelected: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.4)',
  },
  mapNodeBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  mapNodeLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  mapNodeLabelSelected: {
    color: 'rgba(255,255,255,0.9)',
  },
  mapNodeSublabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    fontStyle: 'italic',
    lineHeight: 14,
  },
  mapNodeSublabelSelected: {
    color: 'white',
  },
  mapLegend: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendLine: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  legendSeparator: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 8,
  },
  legendHint: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 1,
    marginLeft: 12,
  },
});
