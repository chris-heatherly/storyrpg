import React from 'react';
import { G, Path, Text, Rect } from 'react-native-svg';
import { GraphEdge as GraphEdgeType, GraphNode, VISUALIZER_COLORS, VisualizerMode } from '../types';
import { calculateEdgePath } from '../layoutEngine';
import { TERMINAL } from '../../theme';

interface GraphEdgeProps {
  edge: GraphEdgeType;
  sourceNode: GraphNode;
  targetNode: GraphNode;
  sourceSiblingIndex: number;
  sourceSiblingCount: number;
  isHighlighted: boolean;
  isDimmed: boolean;
  hideLabel?: boolean;
  mode: VisualizerMode;
  selectedNpcId: string | null;
  onPress?: (edge: GraphEdgeType) => void;
}

export const GraphEdge: React.FC<GraphEdgeProps> = ({
  edge,
  sourceNode,
  targetNode,
  sourceSiblingIndex,
  sourceSiblingCount,
  isHighlighted,
  isDimmed,
  hideLabel,
  mode,
  selectedNpcId,
  onPress,
}) => {
  const colors = VISUALIZER_COLORS;
  const systemColor = getChoiceSystemColor(edge);
  const outcomeColor = getOutcomeColor(edge);
  const matchesNpc = Boolean(selectedNpcId && edge.choiceSystem?.relationshipNpcIds.includes(selectedNpcId));
  const edgeColor = isHighlighted || matchesNpc ? outcomeColor ?? colors.selection : systemColor;
  const strokeWidth = isHighlighted || matchesNpc ? 3.25 : edge.type === 'choice' ? 1.5 : 1;
  const edgeOpacity = isHighlighted || matchesNpc ? 1 : isDimmed ? 0.12 : 0.6;
  const strokeDasharray = edge.type === 'callback'
    ? '6,5'
    : edge.choiceSystem?.hasLockedGate || edge.conditioned ? '4,4' : undefined;

  const path = calculateEdgePath(sourceNode, targetNode);

  const sourceCenterX = sourceNode.x + sourceNode.width / 2;
  const sourceBottomY = sourceNode.y + sourceNode.height;
  const targetCenterX = targetNode.x + targetNode.width / 2;
  const targetTopY = targetNode.y;
  const sourceToTargetY = targetTopY - sourceBottomY;
  const isCompressedJump = Math.abs(sourceToTargetY) > 1400 && !isHighlighted && !matchesNpc;
  const jumpDirection = sourceToTargetY >= 0 ? 1 : -1;
  const jumpStubLength = 130;
  const sourceStubPath = `M ${sourceCenterX} ${sourceBottomY} L ${sourceCenterX} ${sourceBottomY + jumpDirection * jumpStubLength}`;
  const targetStubPath = `M ${targetCenterX} ${targetTopY - jumpDirection * jumpStubLength} L ${targetCenterX} ${targetTopY}`;
  const siblingOffset = sourceSiblingIndex - (sourceSiblingCount - 1) / 2;
  const isChoiceEdge = edge.type === 'choice';
  const isOutcomeLabel = isOutcomeEdgeLabel(edge);
  const displayLabel = isCompressedJump && !isOutcomeLabel ? '' : getEdgeLabel(edge, mode);
  const labelLines = wrapText(displayLabel.toUpperCase(), isChoiceEdge ? 23 : 28);
  const labelWidth = Math.max(80, Math.max(...labelLines.map((line) => line.length)) * 6 + 14);
  const labelHeight = labelLines.length * 11 + 8;
  const laneGap = targetTopY - sourceBottomY;
  const canFitLabelInLane = laneGap > labelHeight + 42;

  // Choice labels are centered over their destination lanes. That keeps the
  // branch text from stacking on top of sibling edges when a beat fans out.
  const midX = isOutcomeLabel
    ? targetCenterX
    : isChoiceEdge
    ? targetCenterX + getTightLaneLabelXOffset(canFitLabelInLane, siblingOffset)
    : (sourceCenterX + targetCenterX) / 2;
  const midY = isOutcomeLabel
    ? getSafeLaneLabelY({
      preferredY: targetTopY - 36 - Math.abs(siblingOffset) * 4,
      sourceBottomY,
      targetTopY,
      labelHeight,
      minGap: 14,
    })
    : isChoiceEdge
    ? getSafeLaneLabelY({
      preferredY: targetTopY - 50 - Math.abs(siblingOffset) * 6,
      sourceBottomY,
      targetTopY,
      labelHeight,
      minGap: canFitLabelInLane ? 14 : 22,
    })
    : (sourceBottomY + targetTopY) / 2;
  const shouldRenderLabel = Boolean(displayLabel && !hideLabel && (canFitLabelInLane || isOutcomeLabel || Math.abs(sourceCenterX - targetCenterX) > 80));

  // Arrow head calculation
  const arrowSize = isHighlighted ? 8 : 6;
  const arrowX = targetCenterX;
  const arrowY = targetTopY - 1;

  return (
    <G onPress={() => onPress?.(edge)}>
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
      {isCompressedJump ? (
        <>
          <Path
            d={sourceStubPath}
            stroke={edgeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            fill="none"
            opacity={edgeOpacity}
          />
          <Path
            d={targetStubPath}
            stroke={edgeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            fill="none"
            opacity={edgeOpacity}
          />
        </>
      ) : (
        <Path
          d={path}
          stroke={edgeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          fill="none"
          opacity={edgeOpacity}
        />
      )}

      {/* Arrow head */}
      <Path
        d={`M ${arrowX - arrowSize / 1.5} ${arrowY - arrowSize} L ${arrowX} ${arrowY} L ${arrowX + arrowSize / 1.5} ${arrowY - arrowSize} Z`}
        fill={edgeColor}
        opacity={edgeOpacity}
      />

      {/* Edge label (for choices) */}
      {shouldRenderLabel && (
        <G opacity={isHighlighted || matchesNpc || !isDimmed ? 1 : 0.28}>
          {/* Label background box */}
          <Rect
            x={midX - labelWidth / 2}
            y={midY - labelHeight / 2}
            width={labelWidth}
            height={labelHeight}
            fill={colors.background}
            stroke={edgeColor}
            strokeWidth={0.5}
            opacity={0.9}
          />
          {labelLines.map((line, index) => (
            <Text
              key={`${edge.id}-label-${index}`}
              x={midX}
              y={midY - labelHeight / 2 + 13 + index * 11}
              fill={edgeColor}
              fontSize={8}
              fontFamily={TERMINAL.fonts.mono}
              textAnchor="middle"
              fontWeight="bold"
            >
              {line}
            </Text>
          ))}
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

      {/* Delayed callback / memory marker */}
      {edge.choiceSystem?.hasDelayedCallback && (
        <G>
          <Rect
            x={midX + 10}
            y={midY - 5}
            width={10}
            height={10}
            fill={colors.background}
            stroke={colors.indicators.delayed}
            strokeWidth={1}
          />
          <Text
            x={midX + 15}
            y={midY + 3}
            fill={colors.indicators.delayed}
            fontSize={7}
            fontFamily={TERMINAL.fonts.mono}
            textAnchor="middle"
            fontWeight="bold"
          >
            E
          </Text>
        </G>
      )}
    </G>
  );
};

function getChoiceSystemColor(edge: GraphEdgeType): string {
  const outcomeColor = getOutcomeColor(edge);
  if (outcomeColor) {
    return outcomeColor;
  }
  if (edge.synthetic) {
    return VISUALIZER_COLORS.edges[edge.type] ?? VISUALIZER_COLORS.textMuted;
  }
  const choiceType = edge.choiceSystem?.choiceType;
  if (choiceType && VISUALIZER_COLORS.choiceTypes[choiceType]) {
    return VISUALIZER_COLORS.choiceTypes[choiceType];
  }
  if (edge.choiceSystem?.facets.includes('relationship')) {
    return VISUALIZER_COLORS.indicators.relationship;
  }
  if (edge.choiceSystem?.facets.includes('stat')) {
    return VISUALIZER_COLORS.indicators.statCheck;
  }
  return VISUALIZER_COLORS.edges[edge.type];
}

function getOutcomeColor(edge: GraphEdgeType): string | undefined {
  const outcome = edge.synthetic?.outcome;
  if (outcome && outcome in VISUALIZER_COLORS.outcomes) {
    return VISUALIZER_COLORS.outcomes[outcome as keyof typeof VISUALIZER_COLORS.outcomes];
  }
  if (edge.synthetic?.kind === 'encounter-outcome') {
    if (edge.synthetic.tier === 'success') return VISUALIZER_COLORS.outcomes.victory;
    if (edge.synthetic.tier === 'complicated') return VISUALIZER_COLORS.outcomes.partialVictory;
    if (edge.synthetic.tier === 'failure') return VISUALIZER_COLORS.outcomes.defeat;
  }
  return undefined;
}

function isOutcomeEdgeLabel(edge: GraphEdgeType): boolean {
  return Boolean(edge.synthetic?.outcome || edge.synthetic?.kind === 'encounter-outcome');
}

function getSafeLaneLabelY(input: {
  preferredY: number;
  sourceBottomY: number;
  targetTopY: number;
  labelHeight: number;
  minGap: number;
}): number {
  const halfHeight = input.labelHeight / 2;
  const minY = input.sourceBottomY + halfHeight + input.minGap;
  const maxY = input.targetTopY - halfHeight - input.minGap;

  if (minY > maxY) {
    return (input.sourceBottomY + input.targetTopY) / 2;
  }

  return Math.max(minY, Math.min(maxY, input.preferredY));
}

function getTightLaneLabelXOffset(canFitLabelInLane: boolean, siblingOffset: number): number {
  if (canFitLabelInLane) return 0;
  const direction = siblingOffset >= 0 ? 1 : -1;
  return direction * (92 + Math.abs(siblingOffset) * 18);
}

function getEdgeLabel(edge: GraphEdgeType, mode: VisualizerMode): string {
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

function wrapText(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }

  if (current) lines.push(current);
  return lines;
}

export default GraphEdge;
