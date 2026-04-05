import React from 'react';
import { G, Rect, Text, Line, Path } from 'react-native-svg';
import { GraphNode as GraphNodeType, VISUALIZER_COLORS } from '../types';
import { TERMINAL } from '../../theme';

interface GraphNodeProps {
  node: GraphNodeType;
  isSelected: boolean;
}

export const GraphNode: React.FC<GraphNodeProps> = ({ node, isSelected }) => {
  const colors = VISUALIZER_COLORS;
  const fillColor = colors.nodeTypes[node.type];
  const borderColor = isSelected ? colors.selection : colors.nodeBorders[node.type];
  const borderWidth = isSelected ? 2 : 1;

  // Calculate indicator positions
  const indicatorSize = 6;
  const indicatorSpacing = 10;
  let indicatorX = node.width - 12;

  return (
    <G>
      {/* Glow effect for selected node */}
      {isSelected && (
        <Rect
          x={node.x - 2}
          y={node.y - 2}
          width={node.width + 4}
          height={node.height + 4}
          fill="none"
          stroke={colors.selection}
          strokeWidth={4}
          opacity={0.3}
        />
      )}

      {/* Main Node Box */}
      <Rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        fill={fillColor}
        stroke={borderColor}
        strokeWidth={borderWidth}
      />

      {/* ASCII Corner decorations (simulated with lines) */}
      <G stroke={borderColor} strokeWidth={1}>
        {/* Top-left */}
        <Line x1={node.x} y1={node.y + 5} x2={node.x} y2={node.y} />
        <Line x1={node.x} y1={node.y} x2={node.x + 5} y2={node.y} />
        
        {/* Top-right */}
        <Line x1={node.x + node.width - 5} y1={node.y} x2={node.x + node.width} y2={node.y} />
        <Line x1={node.x + node.width} y1={node.y} x2={node.x + node.width} y2={node.y + 5} />
        
        {/* Bottom-left */}
        <Line x1={node.x} y1={node.y + node.height - 5} x2={node.x} y2={node.y + node.height} />
        <Line x1={node.x} y1={node.y + node.height} x2={node.x + 5} y2={node.y + node.height} />
        
        {/* Bottom-right */}
        <Line x1={node.x + node.width - 5} y1={node.y + node.height} x2={node.x + node.width} y2={node.y + node.height} />
        <Line x1={node.x + node.width} y1={node.y + node.height - 5} x2={node.x + node.width} y2={node.y + node.height} />
      </G>

      {/* Title Bar Area */}
      <Rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={24}
        fill={borderColor}
        opacity={0.1}
      />
      <Line
        x1={node.x}
        y1={node.y + 24}
        x2={node.x + node.width}
        y2={node.y + 24}
        stroke={borderColor}
        strokeWidth={0.5}
        opacity={0.5}
      />

      {/* Main label */}
      <Text
        x={node.x + 8}
        y={node.y + 16}
        fill={isSelected ? colors.selection : colors.text}
        fontSize={11}
        fontWeight="bold"
        fontFamily={TERMINAL.fonts.mono}
      >
        {truncateLabel(node.label.toUpperCase(), 20)}
      </Text>

      {/* Sublabel (if exists) */}
      {node.sublabel && (
        <Text
          x={node.x + 8}
          y={node.y + 38}
          fill={colors.textMuted}
          fontSize={9}
          fontFamily={TERMINAL.fonts.mono}
        >
          {truncateLabel(node.sublabel, 24)}
        </Text>
      )}

      {/* Type label in bottom left */}
      <Text
        x={node.x + 8}
        y={node.y + node.height - 6}
        fill={borderColor}
        fontSize={8}
        fontFamily={TERMINAL.fonts.mono}
        opacity={0.8}
      >
        {getTypeLabel(node).toUpperCase()}
      </Text>

      {/* Indicator badges (top right) */}
      {node.hasStatCheck && (
        <G>
          <Path
            d={`M ${node.x + indicatorX - 3} ${node.y + 12} L ${node.x + indicatorX} ${node.y + 9} L ${node.x + indicatorX + 3} ${node.y + 12} L ${node.x + indicatorX} ${node.y + 15} Z`}
            fill={colors.indicators.statCheck}
          />
          {(indicatorX -= indicatorSpacing)}
        </G>
      )}

      {node.hasConditions && (
        <G>
          <Rect
            x={node.x + indicatorX - 3}
            y={node.y + 9}
            width={6}
            height={6}
            fill={colors.indicators.condition}
          />
          {(indicatorX -= indicatorSpacing)}
        </G>
      )}

      {node.hasConsequences && (
        <G>
          <Path
            d={`M ${node.x + indicatorX} ${node.y + 9} L ${node.x + indicatorX + 3} ${node.y + 15} L ${node.x + indicatorX - 3} ${node.y + 15} Z`}
            fill={colors.indicators.consequence}
          />
          {(indicatorX -= indicatorSpacing)}
        </G>
      )}

      {/* Choice count badge (bottom right) */}
      {node.choiceCount > 0 && (
        <G>
          <Rect
            x={node.x + node.width - 24}
            y={node.y + node.height - 18}
            width={18}
            height={12}
            fill="none"
            stroke={colors.edges.choice}
            strokeWidth={1}
          />
          <Text
            x={node.x + node.width - 15}
            y={node.y + node.height - 9}
            fill={colors.edges.choice}
            fontSize={8}
            fontWeight="bold"
            fontFamily={TERMINAL.fonts.mono}
            textAnchor="middle"
          >
            {node.choiceCount}
          </Text>
        </G>
      )}
    </G>
  );
};

function truncateLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function getTypeLabel(node: GraphNodeType): string {
  switch (node.type) {
    case 'beat':
      return 'Beat';
    case 'scene':
      return 'Scene';
    case 'episode':
      return 'Episode';
    case 'encounter':
      return 'Encounter';
    case 'phase':
      return 'Phase';
    default:
      return '';
  }
}

export default GraphNode;
