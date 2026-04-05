import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { GraphNode, VISUALIZER_COLORS } from '../types';
import { Beat, EncounterPhase } from '../../types';
import { TERMINAL, createBoxTop, createBoxBottom, createDivider } from '../../theme';
import { useSettingsStore } from '../../stores/settingsStore';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
}

export const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({ node, onClose }) => {
  const fonts = useSettingsStore((state) => state.getFontSizes());

  if (!node) return null;

  return (
    <View style={styles.container}>
      {/* Header Border */}
      <Text style={[styles.borderText, { fontSize: 10 }]} numberOfLines={1}>
        {createBoxTop(60)}
      </Text>

      {/* Title Row */}
      <View style={styles.titleRow}>
        <Text style={[styles.typeLabel, { fontSize: fonts.small }]}>
          {TERMINAL.symbols.prompt} NODE.TYPE::{node.type.toUpperCase()}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={[styles.closeButtonText, { fontSize: fonts.medium }]}>[CLOSE_X]</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.labelRow}>
        <Text style={[styles.title, { fontSize: fonts.large }]}>
          {node.label.toUpperCase()}
        </Text>
      </View>

      <Text style={[styles.divider, { fontSize: 10 }]} numberOfLines={1}>
        {createDivider(60)}
      </Text>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {node.sublabel && (
          <View style={styles.sublabelContainer}>
            <Text style={[styles.sublabel, { fontSize: fonts.small }]}>
              {TERMINAL.symbols.bullet} SUB_LABEL: {node.sublabel}
            </Text>
          </View>
        )}

        {/* Indicators Section */}
        {(node.hasStatCheck || node.hasConditions || node.hasConsequences) && (
          <View style={styles.indicators}>
            {node.hasStatCheck && (
              <View style={[styles.badge, { borderColor: VISUALIZER_COLORS.indicators.statCheck }]}>
                <Text style={[styles.badgeText, { color: VISUALIZER_COLORS.indicators.statCheck, fontSize: 9 }]}>STAT_CHECK</Text>
              </View>
            )}
            {node.hasConditions && (
              <View style={[styles.badge, { borderColor: VISUALIZER_COLORS.indicators.condition }]}>
                <Text style={[styles.badgeText, { color: VISUALIZER_COLORS.indicators.condition, fontSize: 9 }]}>CONDITIONAL</Text>
              </View>
            )}
            {node.hasConsequences && (
              <View style={[styles.badge, { borderColor: VISUALIZER_COLORS.indicators.consequence }]}>
                <Text style={[styles.badgeText, { color: VISUALIZER_COLORS.indicators.consequence, fontSize: 9 }]}>HAS_EFFECTS</Text>
              </View>
            )}
          </View>
        )}

        {/* Node-specific content */}
        <View style={styles.dataContainer}>
          {node.type === 'beat' && renderBeatDetails(node.data as Beat, fonts)}
          {node.type === 'phase' && renderPhaseDetails(node.data as EncounterPhase, fonts)}
        </View>

        {/* Metadata Section */}
        <View style={styles.debugSection}>
          <Text style={[styles.sectionHeader, { fontSize: 9 }]}>:: SYSTEM_METADATA ::</Text>
          <View style={styles.debugGrid}>
            <View style={styles.debugItem}>
              <Text style={[styles.debugLabel, { fontSize: 9 }]}>ID:</Text>
              <Text style={[styles.debugValue, { fontSize: 9 }]}>{node.id}</Text>
            </View>
            {node.sceneId && (
              <View style={styles.debugItem}>
                <Text style={[styles.debugLabel, { fontSize: 9 }]}>SCENE:</Text>
                <Text style={[styles.debugValue, { fontSize: 9 }]}>{node.sceneId}</Text>
              </View>
            )}
            {node.episodeId && (
              <View style={styles.debugItem}>
                <Text style={[styles.debugLabel, { fontSize: 9 }]}>EPISODE:</Text>
                <Text style={[styles.debugValue, { fontSize: 9 }]}>{node.episodeId}</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Footer Border */}
      <Text style={[styles.borderText, { fontSize: 10 }]} numberOfLines={1}>
        {createBoxBottom(60)}
      </Text>
    </View>
  );
};

function renderBeatDetails(beat: Beat, fonts: any) {
  return (
    <View style={styles.detailSection}>
      <Text style={[styles.sectionLabel, { fontSize: fonts.small }]}>[CONTENT_STREAM]</Text>
      <View style={styles.textBubble}>
        <Text style={[styles.beatText, { fontSize: fonts.medium }]}>
          {beat.text}
        </Text>
      </View>

      {beat.speaker && (
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { fontSize: fonts.small }]}>SOURCE:</Text>
          <Text style={[styles.metaValue, { fontSize: fonts.small }]}>{beat.speaker.toUpperCase()}</Text>
          {beat.speakerMood && (
            <Text style={[styles.metaMuted, { fontSize: fonts.small }]}>[{beat.speakerMood.toUpperCase()}]</Text>
          )}
        </View>
      )}

      {beat.choices && beat.choices.length > 0 && (
        <View style={styles.subSection}>
          <Text style={[styles.sectionLabel, { fontSize: fonts.small }]}>[OUTPUT_VECTORS]</Text>
          {beat.choices.map((choice, index) => (
            <View key={choice.id} style={styles.choiceRow}>
              <Text style={[styles.choiceIndex, { fontSize: fonts.small }]}>{index + 1}.</Text>
              <View style={styles.choiceBody}>
                <Text style={[styles.choiceText, { fontSize: fonts.small }]}>{choice.text.toUpperCase()}</Text>
                <View style={styles.choiceBadges}>
                  <Text style={[styles.choiceType, { fontSize: 9 }]}>TYPE::{choice.choiceType?.toUpperCase() || 'STANDARD'}</Text>
                  {choice.statCheck && (
                    <Text style={[styles.choiceStat, { fontSize: 9 }]}>
                      CHECK::{choice.statCheck.attribute?.toUpperCase() || choice.statCheck.skill?.toUpperCase()}::{choice.statCheck.difficulty}
                    </Text>
                  )}
                  {choice.nextBeatId && (
                    <Text style={[styles.choiceLink, { fontSize: 9 }]}>GOTO::{choice.nextBeatId}</Text>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {(beat.nextBeatId || beat.nextSceneId) && !beat.choices?.length && (
        <View style={styles.subSection}>
          <Text style={[styles.sectionLabel, { fontSize: fonts.small }]}>[AUTO_NAV]</Text>
          {beat.nextBeatId && <Text style={[styles.navLink, { fontSize: fonts.small }]}>NEXT_BEAT {'>>'} {beat.nextBeatId}</Text>}
          {beat.nextSceneId && <Text style={[styles.navLink, { fontSize: fonts.small }]}>NEXT_SCENE {'>>'} {beat.nextSceneId}</Text>}
        </View>
      )}
    </View>
  );
}

function renderPhaseDetails(phase: EncounterPhase, fonts: any) {
  return (
    <View style={styles.detailSection}>
      <Text style={[styles.sectionLabel, { fontSize: fonts.small }]}>[PHASE_DATA]</Text>
      <Text style={[styles.phaseTitle, { fontSize: fonts.medium }]}>{phase.name.toUpperCase()}</Text>
      <Text style={[styles.phaseDesc, { fontSize: fonts.small }]}>{phase.description}</Text>
      
      <View style={styles.phaseStats}>
        <View style={styles.phaseStatItem}>
          <Text style={[styles.metaLabel, { fontSize: 9 }]}>SUCCESS_MIN:</Text>
          <Text style={[styles.metaValue, { fontSize: 9, color: '#33cc33' }]}>{phase.successThreshold}</Text>
        </View>
        <View style={styles.phaseStatItem}>
          <Text style={[styles.metaLabel, { fontSize: 9 }]}>FAILURE_MAX:</Text>
          <Text style={[styles.metaValue, { fontSize: 9, color: '#cc3333' }]}>{phase.failureThreshold}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: SCREEN_HEIGHT * 0.5,
    backgroundColor: TERMINAL.colors.bg,
    paddingHorizontal: 12,
  },
  borderText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.bgHighlight,
    lineHeight: 12,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  typeLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.amber,
  },
  closeButton: {
    backgroundColor: TERMINAL.colors.bgHighlight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
  },
  closeButtonText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.error,
  },
  labelRow: {
    paddingVertical: 4,
  },
  title: {
    fontFamily: TERMINAL.fonts.mono,
    fontWeight: 'bold',
    color: TERMINAL.colors.primary,
  },
  divider: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.bgHighlight,
    marginVertical: 4,
  },
  content: {
    flex: 1,
  },
  sublabelContainer: {
    marginBottom: 8,
  },
  sublabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
  },
  indicators: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  badge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: TERMINAL.fonts.mono,
    fontWeight: 'bold',
  },
  dataContainer: {
    marginBottom: 12,
  },
  detailSection: {
    gap: 12,
  },
  sectionLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryDim,
  },
  textBubble: {
    backgroundColor: 'rgba(51, 255, 51, 0.05)',
    padding: 10,
    borderLeftWidth: 2,
    borderLeftColor: TERMINAL.colors.primaryDim,
  },
  beatText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryBright,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
  },
  metaValue: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.cyan,
  },
  metaMuted: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
  },
  subSection: {
    marginTop: 8,
    gap: 8,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  choiceIndex: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.amber,
    width: 20,
  },
  choiceBody: {
    flex: 1,
  },
  choiceText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primary,
    marginBottom: 4,
  },
  choiceBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceType: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
  },
  choiceStat: {
    fontFamily: TERMINAL.fonts.mono,
    color: '#9966ff',
  },
  choiceLink: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.cyan,
  },
  navLink: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.cyan,
    paddingLeft: 8,
  },
  debugSection: {
    marginTop: 16,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: TERMINAL.colors.bgHighlight,
  },
  sectionHeader: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
    marginBottom: 8,
  },
  debugGrid: {
    gap: 4,
  },
  debugItem: {
    flexDirection: 'row',
    gap: 8,
  },
  debugLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
    width: 60,
  },
  debugValue: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.mutedLight,
  },
  phaseTitle: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primary,
    fontWeight: 'bold',
  },
  phaseDesc: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryDim,
  },
  phaseStats: {
    flexDirection: 'row',
    gap: 16,
  },
  phaseStatItem: {
    flexDirection: 'row',
    gap: 6,
  },
});

export default NodeDetailPanel;
