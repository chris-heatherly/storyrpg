import React from 'react';
import { G, Rect, Text, Line, Path, Image as SvgImage } from 'react-native-svg';
import { ChoiceSystemFacet, GraphNode as GraphNodeType, VISUALIZER_COLORS, VisualizerMode } from '../types';
import { TERMINAL } from '../../theme';

interface GraphNodeProps {
  node: GraphNodeType;
  isSelected: boolean;
  mode: VisualizerMode;
  selectedNpcId: string | null;
}

export const GraphNode: React.FC<GraphNodeProps> = ({ node, isSelected, mode, selectedNpcId }) => {
  const colors = VISUALIZER_COLORS;
  const fillColor = colors.nodeTypes[node.type];
  const matchesNpc = Boolean(selectedNpcId && node.choiceSystem?.npcIds.includes(selectedNpcId));
  const outcomeColor = getOutcomeColor(node);
  const borderColor = isSelected || matchesNpc ? colors.selection : outcomeColor ?? colors.nodeBorders[node.type];
  const borderWidth = isSelected || matchesNpc ? 2 : 1;

  // Calculate indicator positions
  const indicatorSize = 6;
  const indicatorSpacing = 10;
  let indicatorX = node.width - 12;

  if (node.type === 'encounter-choice') {
    const lines = wrapText(node.label || '', 28).slice(0, 2);
    const chipHeight = node.height;
    const lineStartY = node.y + chipHeight / 2 - ((lines.length - 1) * 6) + 4;

    return (
      <G>
        {isSelected && (
          <Rect
            x={node.x - 2}
            y={node.y - 2}
            width={node.width + 4}
            height={node.height + 4}
            fill="none"
            stroke={colors.selection}
            strokeWidth={3}
            opacity={0.32}
          />
        )}
        <Rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={chipHeight}
          fill={colors.background}
          stroke={colors.edges.choice}
          strokeWidth={1}
          opacity={0.94}
        />
        {lines.map((line, index) => (
          <Text
            key={`${node.id}-choice-chip-${index}`}
            x={node.x + node.width / 2}
            y={lineStartY + index * 12}
            fill={isSelected ? colors.selection : colors.edges.choice}
            fontSize={8}
            fontWeight="bold"
            fontFamily={TERMINAL.fonts.mono}
            textAnchor="middle"
          >
            {line.toUpperCase()}
          </Text>
        ))}
      </G>
    );
  }

  if ((node.type === 'beat' || node.type === 'storylet-beat' || node.type === 'phase' || node.type === 'encounter-situation') && node.image) {
      const isStoryletBeat = node.type === 'storylet-beat';
      const isEncounterPreview = node.type === 'phase' || node.type === 'encounter-situation';
      const panelX = node.x + 14;
      const panelWidth = node.width - 28;
      const panelHeight = 92;
      const panelY = node.y + node.height - 112;
      const proseLines = wrapText(node.fullText || node.sublabel || '', 31).slice(0, 4);
      const sceneChip = truncateLabel(String(node.sceneTitle || node.sceneId || 'Scene').toUpperCase(), isStoryletBeat || isEncounterPreview ? 11 : 10);
      const beatChip = isEncounterPreview ? 'ENC' : `B${node.beatNumber ?? ''}`;
      const chipWidth = isEncounterPreview ? 132 : isStoryletBeat ? 112 : 84;

      return (
        <G>
          {isSelected && (
            <Rect
              x={node.x - 3}
              y={node.y - 3}
              width={node.width + 6}
              height={node.height + 6}
              fill="none"
              stroke={colors.selection}
              strokeWidth={5}
              opacity={0.35}
            />
          )}

          <Rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill="#030712"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />

          <SvgImage
            href={node.image}
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            preserveAspectRatio="xMidYMid meet"
          />

          <Rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={58}
            fill="#030712"
            opacity={0.42}
          />
          <Rect
            x={node.x}
            y={node.y + node.height - 138}
            width={node.width}
            height={138}
            fill="#030712"
            opacity={0.72}
          />

          <Rect
            x={node.x + 12}
            y={node.y + 12}
            width={chipWidth}
            height={28}
            rx={14}
            fill="#05070c"
            stroke={borderColor}
            strokeWidth={0.75}
            opacity={0.88}
          />
          <Text
            x={node.x + 12 + chipWidth / 2}
            y={node.y + 30}
            fill={isSelected ? colors.selection : outcomeColor ?? colors.text}
            fontSize={10}
            fontWeight="bold"
            fontFamily={TERMINAL.fonts.mono}
            textAnchor="middle"
          >
            {`${sceneChip} ${beatChip}`}
          </Text>

          {node.choiceCount > 0 && (
            <G>
              <Rect
                x={node.x + node.width - 52}
                y={node.y + 12}
                width={40}
                height={28}
                rx={14}
                fill="#05070c"
                stroke={colors.edges.choice}
                strokeWidth={0.75}
                opacity={0.88}
              />
              <Text
                x={node.x + node.width - 32}
                y={node.y + 30}
                fill={colors.edges.choice}
                fontSize={10}
                fontWeight="bold"
                fontFamily={TERMINAL.fonts.mono}
                textAnchor="middle"
              >
                {node.choiceCount}
              </Text>
            </G>
          )}

          <Rect
            x={panelX}
            y={panelY}
            width={panelWidth}
            height={panelHeight}
            rx={10}
            fill="#05070c"
            stroke={colors.textMuted}
            strokeWidth={0.5}
            opacity={0.9}
          />
          {proseLines.map((line, index) => (
            <Text
              key={`${node.id}-reader-line-${index}`}
              x={panelX + 10}
              y={panelY + 20 + index * 16}
              fill={colors.text}
              fontSize={10.5}
              fontWeight={index === 0 ? 'bold' : 'normal'}
              fontFamily={TERMINAL.fonts.mono}
            >
              {line}
            </Text>
          ))}
        </G>
      );
  }

  if (node.type === 'beat' || node.type === 'phase' || node.type === 'encounter-situation' || node.type === 'storylet-beat') {
    const isEncounterPreview = node.type === 'phase' || node.type === 'encounter-situation';
    const isStoryletBeat = node.type === 'storylet-beat';
    const headerText = isEncounterPreview
      ? `${node.sceneTitle || node.sceneId || 'Encounter'} • ENC`
      : `${node.sceneTitle || node.sceneId || 'Scene'} • Beat ${node.beatNumber ?? ''}`;
    const typeLabel = isEncounterPreview ? 'Encounter' : isStoryletBeat ? 'Storylet Beat' : 'Beat';
    return (
      <G>
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

        <Rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          fill={fillColor}
          stroke={borderColor}
          strokeWidth={borderWidth}
        />

        <Rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={30}
          fill={borderColor}
          opacity={0.12}
        />
        <Line
          x1={node.x}
          y1={node.y + 30}
          x2={node.x + node.width}
          y2={node.y + 30}
          stroke={borderColor}
          strokeWidth={0.5}
          opacity={0.5}
        />

        <Text
          x={node.x + 10}
          y={node.y + 18}
          fill={isSelected ? colors.selection : colors.text}
          fontSize={11}
          fontWeight="bold"
          fontFamily={TERMINAL.fonts.mono}
        >
          {truncateLabel(headerText.toUpperCase(), 34)}
        </Text>

        <G>
          {wrapText(node.fullText || node.sublabel || '', 48).slice(0, 8).map((line, index) => (
            <Text
              key={`${node.id}-line-${index}`}
              x={node.x + 10}
              y={node.y + 50 + index * 13}
              fill={colors.textMuted}
              fontSize={9}
              fontFamily={TERMINAL.fonts.mono}
            >
              {line}
            </Text>
          ))}
        </G>

        <Text
          x={node.x + 10}
          y={node.y + node.height - 8}
          fill={borderColor}
          fontSize={8}
          fontFamily={TERMINAL.fonts.mono}
          opacity={0.8}
        >
          {typeLabel.toUpperCase()}
        </Text>

        {node.choiceCount > 0 && (
          <G>
            <Rect
              x={node.x + node.width - 34}
              y={node.y + node.height - 22}
              width={24}
              height={14}
              fill="none"
              stroke={colors.edges.choice}
              strokeWidth={1}
            />
            <Text
              x={node.x + node.width - 22}
              y={node.y + node.height - 12}
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
  }

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

      {/* Choice-system badges */}
      {node.choiceSystem?.badges.slice(0, 4).map((badge, index) => (
        <G key={`${node.id}-${badge.facet}`}>
          <Rect
            x={node.x + 8 + index * 38}
            y={node.y + node.height - 31}
            width={34}
            height={10}
            fill="none"
            stroke={getFacetColor(badge.facet)}
            strokeWidth={0.75}
            opacity={matchesNpc || !selectedNpcId ? 1 : 0.35}
          />
          <Text
            x={node.x + 25 + index * 38}
            y={node.y + node.height - 23}
            fill={getFacetColor(badge.facet)}
            fontSize={6}
            fontWeight="bold"
            fontFamily={TERMINAL.fonts.mono}
            textAnchor="middle"
            opacity={matchesNpc || !selectedNpcId ? 1 : 0.35}
          >
            {(mode === 'author' ? badge.authorLabel : badge.playerLabel).slice(0, 6)}
          </Text>
        </G>
      ))}
    </G>
  );
};

function getFacetColor(facet: ChoiceSystemFacet): string {
  switch (facet) {
    case 'relationship':
      return VISUALIZER_COLORS.indicators.relationship;
    case 'stat':
      return VISUALIZER_COLORS.indicators.statCheck;
    case 'identity':
      return VISUALIZER_COLORS.indicators.identity;
    case 'delayed':
      return VISUALIZER_COLORS.indicators.delayed;
    case 'branching':
      return VISUALIZER_COLORS.indicators.branching;
    default:
      return VISUALIZER_COLORS.textMuted;
  }
}

function truncateLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function getOutcomeColor(node: GraphNodeType): string | undefined {
  const outcome = node.synthetic?.outcome;
  if (!outcome || !(outcome in VISUALIZER_COLORS.outcomes)) {
    return undefined;
  }
  return VISUALIZER_COLORS.outcomes[outcome as keyof typeof VISUALIZER_COLORS.outcomes];
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
    case 'encounter-choice':
      return 'Encounter Choice';
    case 'encounter-outcome':
      return 'Roll Outcome';
    case 'encounter-situation':
      return 'Encounter Situation';
    case 'tint':
      return 'Tint';
    case 'tint-payoff':
      return 'Tint Payoff';
    case 'branchlet':
      return 'Branchlet';
    case 'storylet':
      return 'Storylet';
    case 'storylet-beat':
      return 'Storylet Beat';
    case 'callback-source':
      return 'Callback Source';
    case 'callback-payoff':
      return 'Callback Payoff';
    default:
      return '';
  }
}

export default GraphNode;
