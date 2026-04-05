import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { TERMINAL, createDivider } from '../../theme';
import { useSettingsStore } from '../../stores/settingsStore';
import { VISUALIZER_COLORS } from '../types';

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
            <Text style={[styles.controlButtonText, { fontSize: fonts.small }]}>[-] ZOOM_OUT</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onZoomIn} style={styles.controlButton}>
            <Text style={[styles.controlButtonText, { fontSize: fonts.small }]}>[+] ZOOM_IN</Text>
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

        {/* Divider */}
        <Text style={[styles.divider, { fontSize: fonts.small }]} numberOfLines={1}>
          {createDivider(80)}
        </Text>
      </View>
    </SafeAreaView>
  );
};

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
  divider: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.bgHighlight,
    marginTop: 2,
  },
});

export default VisualizerControls;
