import React from 'react';
import { G, Path, Text, Rect } from 'react-native-svg';
import { GraphEdge as GraphEdgeType, GraphNode, VISUALIZER_COLORS } from '../types';
import { calculateEdgePath } from '../layoutEngine';
import { TERMINAL } from '../../theme';

interface GraphEdgeProps {
  edge: GraphEdgeType;
  sourceNode: GraphNode;
  targetNode: GraphNode;
  isHighlighted: boolean;
}

export const GraphEdge: React.FC<GraphEdgeProps> = ({
  edge,
  sourceNode,
  targetNode,
  isHighlighted,
}) => {
  const colors = VISUALIZER_COLORS;
  const edgeColor = isHighlighted ? colors.selection : colors.edges[edge.type];
  const strokeWidth = isHighlighted ? 2 : edge.type === 'choice' ? 1.5 : 1;
  const strokeDasharray = edge.conditioned ? '4,4' : undefined;

  const path = calculateEdgePath(sourceNode, targetNode);

  // Calculate label position (middle of the path)
  // Simple approximation for Bezier path middle
  const midX = (sourceNode.x + sourceNode.width / 2 + targetNode.x + targetNode.width / 2) / 2;
  const midY = (sourceNode.y + sourceNode.height + targetNode.y) / 2;

  // Arrow head calculation
  const arrowSize = isHighlighted ? 8 : 6;
  const arrowX = targetNode.x + targetNode.width / 2;
  const arrowY = targetNode.y - 1;

  return (
    <G>
      {/* Edge Glow for Highlighted */}
      {isHighlighted && (
        <Path
          d={path}
          stroke={colors.selection}
          strokeWidth={strokeWidth + 3}
          fill="none"
          opacity={0.2}
        />
      )}

      {/* Edge path */}
      <Path
        d={path}
        stroke={edgeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        fill="none"
        opacity={isHighlighted ? 1 : 0.6}
      />

      {/* Arrow head */}
      <Path
        d={`M ${arrowX - arrowSize / 1.5} ${arrowY - arrowSize} L ${arrowX} ${arrowY} L ${arrowX + arrowSize / 1.5} ${arrowY - arrowSize} Z`}
        fill={edgeColor}
        opacity={isHighlighted ? 1 : 0.6}
      />

      {/* Edge label (for choices) */}
      {edge.label && (
        <G>
          {/* Label background box */}
          <Rect
            x={midX - (truncateLabel(edge.label, 15).length * 3 + 6)}
            y={midY - 8}
            width={truncateLabel(edge.label, 15).length * 6 + 12}
            height={16}
            fill={colors.background}
            stroke={edgeColor}
            strokeWidth={0.5}
            opacity={0.9}
          />
          <Text
            x={midX}
            y={midY + 4}
            fill={edgeColor}
            fontSize={8}
            fontFamily={TERMINAL.fonts.mono}
            textAnchor="middle"
            fontWeight="bold"
          >
            {truncateLabel(edge.label.toUpperCase(), 15)}
          </Text>
        </G>
      )}

      {/* Condition indicator if no label */}
      {edge.conditioned && !edge.label && (
        <G>
          <Rect
            x={midX - 4}
            y={midY - 4}
            width={8}
            height={8}
            fill={colors.background}
            stroke={colors.indicators.condition}
            strokeWidth={1}
          />
          <Rect
            x={midX - 2}
            y={midY - 2}
            width={4}
            height={4}
            fill={colors.indicators.condition}
          />
        </G>
      )}
    </G>
  );
};

function truncateLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export default GraphEdge;
