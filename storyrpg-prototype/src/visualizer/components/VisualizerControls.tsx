import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { TERMINAL, createDivider } from '../../theme';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  ChoiceSystemFilterState,
  ChoiceSystemNpcSummary,
  MapJumpShortcut,
  VISUALIZER_COLORS,
  VisualizerMode,
} from '../types';

interface VisualizerControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  onBack: () => void;
  onSwitchToColumns?: () => void;
  storyTitle: string;
  nodeCount: number;
  edgeCount: number;
  mode: VisualizerMode;
  filters: ChoiceSystemFilterState;
  npcs: ChoiceSystemNpcSummary[];
  selectedNpcId: string | null;
  jumpShortcuts: MapJumpShortcut[];
  onModeChange: (mode: VisualizerMode) => void;
  onToggleFilter: (key: keyof ChoiceSystemFilterState) => void;
  onSelectNpc: (npcId: string | null) => void;
  onJumpToNode: (nodeId: string) => void;
}

export const VisualizerControls: React.FC<VisualizerControlsProps> = ({
  scale,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onBack,
  onSwitchToColumns,
  storyTitle,
  nodeCount,
  edgeCount,
  mode,
  filters,
  npcs,
  selectedNpcId,
  jumpShortcuts,
  onModeChange,
  onToggleFilter,
  onSelectNpc,
  onJumpToNode,
}) => {
  const fonts = useSettingsStore((state) => state.getFontSizes());

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={[styles.backButtonText, { fontSize: fonts.medium }]}>[ESC]</Text>
          </TouchableOpacity>
          <View style={styles.titleContainer}>
            <Text style={[styles.title, { fontSize: fonts.large }]} numberOfLines={1}>
              {TERMINAL.symbols.prompt} SYSTEM.STORY_MAP::{storyTitle.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { fontSize: fonts.small }]}>NODES:</Text>
            <Text style={[styles.statValue, { fontSize: fonts.small }]}>{nodeCount}</Text>
          </View>
          <Text style={[styles.separator, { fontSize: fonts.small }]}>{TERMINAL.symbols.separator}</Text>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { fontSize: fonts.small }]}>EDGES:</Text>
            <Text style={[styles.statValue, { fontSize: fonts.small }]}>{edgeCount}</Text>
          </View>
          <Text style={[styles.separator, { fontSize: fonts.small }]}>{TERMINAL.symbols.separator}</Text>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { fontSize: fonts.small }]}>ZOOM:</Text>
            <Text style={[styles.statValue, { fontSize: fonts.small }]}>{Math.round(scale * 100)}%</Text>
          </View>
        </View>

        {/* Legend Row */}
        <View style={styles.legendRow}>
          <View style={styles.legendGroup}>
            <View style={styles.legendItem}>
              <View style={[styles.legendBox, { backgroundColor: VISUALIZER_COLORS.nodeBorders.beat }]} />
              <Text style={[styles.legendText, { fontSize: 8 }]}>BEAT</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendBox, { backgroundColor: VISUALIZER_COLORS.nodeBorders.scene }]} />
              <Text style={[styles.legendText, { fontSize: 8 }]}>SCENE</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendBox, { backgroundColor: VISUALIZER_COLORS.nodeBorders.encounter }]} />
              <Text style={[styles.legendText, { fontSize: 8 }]}>ENCOUNTER</Text>
            </View>
          </View>
          
          <View style={styles.legendGroup}>
            <View style={styles.legendItem}>
              <View style={[styles.legendMarker, { backgroundColor: VISUALIZER_COLORS.indicators.statCheck, borderRadius: 0 }]} />
              <Text style={[styles.legendText, { fontSize: 8 }]}>STAT</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendMarker, { backgroundColor: VISUALIZER_COLORS.indicators.condition, borderRadius: 0 }]} />
              <Text style={[styles.legendText, { fontSize: 8 }]}>COND</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendMarker, { backgroundColor: VISUALIZER_COLORS.indicators.consequence, borderRadius: 0 }]} />
              <Text style={[styles.legendText, { fontSize: 8 }]}>FX</Text>
            </View>
          </View>
        </View>

        {/* Controls Row */}
        <View style={styles.controlsRow}>
          <TouchableOpacity onPress={onZoomOut} style={styles.controlButton}>
            <Text style={[styles.controlButtonText, { fontSize: fonts.small }]}>[CMD-] ZOOM_OUT</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onZoomIn} style={styles.controlButton}>
            <Text style={[styles.controlButtonText, { fontSize: fonts.small }]}>[CMD+] ZOOM_IN</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onFitToScreen} style={styles.controlButton}>
            <Text style={[styles.controlButtonText, { fontSize: fonts.small }]}>[F] FIT_VIEW</Text>
          </TouchableOpacity>
          {onSwitchToColumns && (
            <TouchableOpacity onPress={onSwitchToColumns} style={styles.controlButton}>
              <Text style={[styles.controlButtonText, { fontSize: fonts.small }]}>[C] COLUMNS</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity
            onPress={() => onModeChange(mode === 'author' ? 'player' : 'author')}
            style={[styles.controlButton, styles.modeButton]}
          >
            <Text style={[styles.controlButtonText, { fontSize: fonts.small }]}>
              MODE::{mode === 'author' ? 'AUTHOR' : 'PLAYER'}
            </Text>
          </TouchableOpacity>
          {renderFilterButton('ROUTES', 'showRouting', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('BONDS', 'showRelationships', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('STATS', 'showStats', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('LOCKED', 'showLockedPaths', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('ECHOES', 'showDelayedCallbacks', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('BRANCH', 'showOnlyMeaningfulBranches', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('TINTS', 'showTints', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('PAYOFFS', 'showTintPayoffs', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('BRANCHLETS', 'showBranchlets', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('STORYLETS', 'showStorylets', filters, onToggleFilter, fonts.small)}
          {renderFilterButton('CALLBACKS', 'showCallbacks', filters, onToggleFilter, fonts.small)}
        </View>

        {npcs.length > 0 && (
          <View style={styles.npcRow}>
            <Text style={[styles.npcLabel, { fontSize: fonts.small }]}>NPC_OVERLAY:</Text>
            <TouchableOpacity
              onPress={() => onSelectNpc(null)}
              style={[styles.npcButton, !selectedNpcId && styles.npcButtonActive]}
            >
              <Text style={[styles.npcButtonText, { fontSize: 9 }]}>ALL</Text>
            </TouchableOpacity>
            {npcs.slice(0, 6).map((npc) => (
              <TouchableOpacity
                key={npc.npcId}
                onPress={() => onSelectNpc(selectedNpcId === npc.npcId ? null : npc.npcId)}
                style={[styles.npcButton, selectedNpcId === npc.npcId && styles.npcButtonActive]}
              >
                <Text style={[styles.npcButtonText, { fontSize: 9 }]} numberOfLines={1}>
                  {npc.npcId.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {jumpShortcuts.length > 0 && (
          <View style={styles.jumpRow}>
            <Text style={[styles.jumpLabel, { fontSize: fonts.small }]}>JUMP_TO:</Text>
            {jumpShortcuts.map((shortcut) => (
              <TouchableOpacity
                key={shortcut.id}
                onPress={() => onJumpToNode(shortcut.nodeId)}
                style={[styles.jumpButton, getJumpButtonStyle(shortcut.kind)]}
              >
                <Text style={[styles.jumpButtonText, { fontSize: 9 }]} numberOfLines={1}>
                  {shortcut.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Divider */}
        <Text style={[styles.divider, { fontSize: fonts.small }]} numberOfLines={1}>
          {createDivider(80)}
        </Text>
      </View>
    </SafeAreaView>
  );
};

function renderFilterButton(
  label: string,
  key: keyof ChoiceSystemFilterState,
  filters: ChoiceSystemFilterState,
  onToggleFilter: (key: keyof ChoiceSystemFilterState) => void,
  fontSize: number,
) {
  const isActive = filters[key];
  return (
    <TouchableOpacity
      key={key}
      onPress={() => onToggleFilter(key)}
      style={[styles.filterButton, isActive && styles.filterButtonActive]}
    >
      <Text style={[styles.filterButtonText, isActive && styles.filterButtonTextActive, { fontSize }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function getJumpButtonStyle(kind: MapJumpShortcut['kind']) {
  switch (kind) {
    case 'encounter':
      return styles.jumpButtonEncounter;
    case 'storylet':
      return styles.jumpButtonStorylet;
    case 'branchlet':
      return styles.jumpButtonBranchlet;
    default:
      return styles.jumpButtonScene;
  }
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: TERMINAL.colors.bg,
  },
  container: {
    backgroundColor: TERMINAL.colors.bg,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    marginBottom: 4,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  backButtonText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.amber,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontFamily: TERMINAL.fonts.mono,
    fontWeight: 'bold',
    color: TERMINAL.colors.primary,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
    marginRight: 4,
  },
  statValue: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.cyan,
  },
  separator: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.border,
    marginHorizontal: 12,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: TERMINAL.colors.bgHighlight,
    marginVertical: 4,
  },
  legendGroup: {
    flexDirection: 'row',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendBox: {
    width: 8,
    height: 8,
    marginRight: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  legendMarker: {
    width: 6,
    height: 6,
    marginRight: 4,
  },
  legendText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingVertical: 8,
    gap: 12,
  },
  controlButton: {
    backgroundColor: TERMINAL.colors.bgHighlight,
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  controlButtonText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryDim,
  },
  modeButton: {
    borderColor: TERMINAL.colors.cyan,
  },
  filterButton: {
    backgroundColor: TERMINAL.colors.bg,
    borderWidth: 1,
    borderColor: TERMINAL.colors.bgHighlight,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  filterButtonActive: {
    backgroundColor: TERMINAL.colors.bgHighlight,
    borderColor: TERMINAL.colors.primaryDim,
  },
  filterButtonText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
  },
  filterButtonTextActive: {
    color: TERMINAL.colors.primary,
  },
  npcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 6,
  },
  npcLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
  },
  npcButton: {
    maxWidth: 130,
    borderWidth: 1,
    borderColor: TERMINAL.colors.bgHighlight,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  npcButtonActive: {
    borderColor: VISUALIZER_COLORS.indicators.relationship,
    backgroundColor: 'rgba(51, 204, 255, 0.12)',
  },
  npcButtonText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryDim,
  },
  jumpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 6,
  },
  jumpLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
  },
  jumpButton: {
    maxWidth: 150,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: TERMINAL.colors.bg,
  },
  jumpButtonScene: {
    borderColor: TERMINAL.colors.bgHighlight,
  },
  jumpButtonEncounter: {
    borderColor: VISUALIZER_COLORS.nodeBorders.encounter,
    backgroundColor: 'rgba(153, 102, 255, 0.1)',
  },
  jumpButtonStorylet: {
    borderColor: VISUALIZER_COLORS.nodeBorders['storylet-beat'],
    backgroundColor: 'rgba(51, 204, 255, 0.1)',
  },
  jumpButtonBranchlet: {
    borderColor: VISUALIZER_COLORS.nodeBorders.branchlet,
    backgroundColor: 'rgba(255, 170, 0, 0.1)',
  },
  jumpButtonText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryDim,
  },
  divider: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.bgHighlight,
    marginTop: 2,
  },
});

export default VisualizerControls;
