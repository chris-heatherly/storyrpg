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
import type { ChoiceSystemChoiceSummary, SyntheticGraphNodeData, VisualizerMode } from '../types';
import { Beat, EncounterPhase } from '../../types';
import { TERMINAL } from '../../theme';
import { useSettingsStore } from '../../stores/settingsStore';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
  mode: VisualizerMode;
  selectedNpcId: string | null;
}

export const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({ node, onClose, mode, selectedNpcId }) => {
  const fonts = useSettingsStore((state) => state.getFontSizes());

  if (!node) return null;

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { fontSize: fonts.medium }]} numberOfLines={1}>
          {node.label.toUpperCase()}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={[styles.closeButtonText, { fontSize: fonts.small }]}>CLOSE</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
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

        <View style={styles.dataContainer}>
          {node.type === 'beat' && renderBeatDetails(node.data as Beat, fonts, node.choiceSystem?.choices ?? [], mode, selectedNpcId)}
          {node.type === 'phase' && renderPhaseDetails(node.data as EncounterPhase, fonts, mode)}
          {node.synthetic && renderSyntheticDetails(node.synthetic, fonts, mode)}
        </View>
      </ScrollView>
    </View>
  );
};

function renderBeatDetails(
  beat: Beat,
  fonts: any,
  choiceSummaries: ChoiceSystemChoiceSummary[],
  mode: VisualizerMode,
  selectedNpcId: string | null,
) {
  return (
    <View style={styles.detailSection}>
      <View style={styles.textBubble}>
        <Text style={[styles.beatText, { fontSize: fonts.medium }]}>
          {beat.text}
        </Text>
      </View>

      {beat.choices && beat.choices.length > 0 && (
        <View style={styles.subSection}>
          {beat.choices.map((choice, index) => (
            <View key={choice.id} style={styles.choiceRow}>
              <Text style={[styles.choiceIndex, { fontSize: fonts.small }]}>{index + 1}.</Text>
              <View style={styles.choiceBody}>
                <Text style={[styles.choiceText, { fontSize: fonts.small }]}>{choice.text.toUpperCase()}</Text>
                {renderChoiceSystem(choiceSummaries.find((summary) => summary.id === choice.id), mode, selectedNpcId)}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function renderChoiceSystem(
  summary: ChoiceSystemChoiceSummary | undefined,
  mode: VisualizerMode,
  selectedNpcId: string | null,
) {
  if (!summary) return null;

  const visibleConditions = selectedNpcId
    ? summary.conditions.filter((item) => !item.npcId || item.npcId === selectedNpcId)
    : summary.conditions;
  const visibleEffects = selectedNpcId
    ? summary.effects.filter((item) => !item.npcId || item.npcId === selectedNpcId)
    : summary.effects;

  return (
    <View style={styles.choiceSystemBlock}>
      <View style={styles.choiceBadges}>
        {summary.route.isMeaningfulBranch && (
          <Text style={[styles.choiceLink, { fontSize: 9 }]}>
            {mode === 'author' ? summary.route.authorLabel : summary.route.playerLabel}
          </Text>
        )}
        {summary.route.isMeaningfulBranch && (
          <Text style={[styles.choiceBranch, { fontSize: 9 }]}>
            {mode === 'author' ? 'HARD_BRANCH' : 'PATH'}
          </Text>
        )}
      </View>

      {visibleConditions.length > 0 && (
        <View style={styles.systemList}>
          <Text style={[styles.systemListLabel, { fontSize: 9 }]}>
            {mode === 'author' ? 'GATES' : 'OPENS WHEN'}
          </Text>
          {visibleConditions.map((condition, index) => (
            <Text key={`${summary.id}-condition-${index}`} style={[styles.systemListItem, { fontSize: 9 }]}>
              {mode === 'author' ? condition.authorLabel : condition.playerLabel}
            </Text>
          ))}
        </View>
      )}

      {summary.check && (
        <View style={styles.systemList}>
          <Text style={[styles.systemListLabel, { fontSize: 9 }]}>
            {mode === 'author' ? 'CHECK' : 'PRESSURE'}
          </Text>
          <Text style={[styles.systemListItem, { fontSize: 9 }]}>
            {mode === 'author' ? summary.check.authorLabel : summary.check.playerLabel}
          </Text>
        </View>
      )}

      {visibleEffects.length > 0 && (
        <View style={styles.systemList}>
          <Text style={[styles.systemListLabel, { fontSize: 9 }]}>
            {mode === 'author' ? 'EFFECTS' : 'AFTERMATH'}
          </Text>
          <Text style={[styles.systemListItem, { fontSize: 9 }]}>
            {visibleEffects.map((effect) => mode === 'author' ? effect.authorLabel : effect.playerLabel).join(', ')}
          </Text>
        </View>
      )}
    </View>
  );
}

function renderPhaseDetails(phase: EncounterPhase, fonts: any, mode: VisualizerMode) {
  return (
    <View style={styles.detailSection}>
      <Text style={[styles.sectionLabel, { fontSize: fonts.small }]}>[PHASE_DATA]</Text>
      <Text style={[styles.phaseTitle, { fontSize: fonts.medium }]}>{phase.name.toUpperCase()}</Text>
      <Text style={[styles.phaseDesc, { fontSize: fonts.small }]}>{phase.description}</Text>
      
      <View style={styles.phaseStats}>
        <View style={styles.phaseStatItem}>
          <Text style={[styles.metaLabel, { fontSize: 9 }]}>{mode === 'author' ? 'SUCCESS_MIN:' : 'SUCCESS:'}</Text>
          <Text style={[styles.metaValue, { fontSize: 9, color: '#33cc33' }]}>
            {mode === 'author' ? phase.successThreshold : 'possible'}
          </Text>
        </View>
        <View style={styles.phaseStatItem}>
          <Text style={[styles.metaLabel, { fontSize: 9 }]}>{mode === 'author' ? 'FAILURE_MAX:' : 'FAILURE:'}</Text>
          <Text style={[styles.metaValue, { fontSize: 9, color: '#cc3333' }]}>
            {mode === 'author' ? phase.failureThreshold : 'possible'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function renderSyntheticDetails(data: SyntheticGraphNodeData, fonts: any, mode: VisualizerMode) {
  return (
    <View style={styles.detailSection}>
      <Text style={[styles.sectionLabel, { fontSize: fonts.small }]}>
        [{data.kind.toUpperCase().replace('-', '_')}]
      </Text>
      <Text style={[styles.systemSummary, { fontSize: fonts.medium }]}>
        {mode === 'author' ? data.authorLabel : data.playerLabel}
      </Text>

      {data.text && (
        <View style={styles.textBubble}>
          <Text style={[styles.beatText, { fontSize: fonts.small }]}>
            {data.text}
          </Text>
        </View>
      )}

      <View style={styles.systemList}>
        {mode === 'author' ? (
          <>
            {data.flag && <Text style={[styles.systemListItem, { fontSize: 9 }]}>FLAG::{data.flag}</Text>}
            {data.hookId && <Text style={[styles.systemListItem, { fontSize: 9 }]}>HOOK::{data.hookId}</Text>}
            {data.sourceChoiceId && <Text style={[styles.systemListItem, { fontSize: 9 }]}>SOURCE_CHOICE::{data.sourceChoiceId}</Text>}
            {data.sourceBeatId && <Text style={[styles.systemListItem, { fontSize: 9 }]}>SOURCE_BEAT::{data.sourceBeatId}</Text>}
            {data.targetBeatId && <Text style={[styles.systemListItem, { fontSize: 9 }]}>TARGET_BEAT::{data.targetBeatId}</Text>}
            {data.targetSceneId && <Text style={[styles.systemListItem, { fontSize: 9 }]}>TARGET_SCENE::{data.targetSceneId}</Text>}
            {data.outcome && <Text style={[styles.systemListItem, { fontSize: 9 }]}>OUTCOME::{data.outcome}</Text>}
            {data.tier && <Text style={[styles.systemListItem, { fontSize: 9 }]}>TIER::{data.tier}</Text>}
          </>
        ) : (
          <Text style={[styles.systemListItem, { fontSize: 9 }]}>
            {getSyntheticPlayerHint(data.kind)}
          </Text>
        )}
      </View>

      {mode === 'author' && data.details && data.details.length > 0 && (
        <View style={styles.systemList}>
          <Text style={[styles.systemListLabel, { fontSize: 9 }]}>DETAILS</Text>
          {data.details.map((detail, index) => (
            <Text key={`${data.id}-detail-${index}`} style={[styles.systemListItem, { fontSize: 9 }]}>
              {detail}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function getSyntheticPlayerHint(kind: SyntheticGraphNodeData['kind']): string {
  switch (kind) {
    case 'tint':
      return 'A tone choice has been planted for later scenes.';
    case 'tint-payoff':
      return 'This moment changes because of an earlier tone choice.';
    case 'branchlet':
      return 'This is a short detour that lets the choice breathe before the main path continues.';
    case 'storylet':
    case 'storylet-beat':
      return 'This belongs to the aftermath sequence after an encounter outcome.';
    case 'callback-source':
      return 'This is a memory the story can bring back later.';
    case 'callback-payoff':
      return 'This moment pays off a memory from earlier play.';
    default:
      return 'This node explains hidden story residue.';
  }
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: SCREEN_HEIGHT * 0.28,
    backgroundColor: TERMINAL.colors.bg,
    borderTopWidth: 1,
    borderTopColor: TERMINAL.colors.bgHighlight,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 6,
  },
  typeLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.amber,
  },
  closeButton: {
    backgroundColor: TERMINAL.colors.bgHighlight,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
  },
  closeButtonText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.error,
  },
  title: {
    fontFamily: TERMINAL.fonts.mono,
    fontWeight: 'bold',
    color: TERMINAL.colors.primary,
    flex: 1,
    paddingRight: 12,
  },
  content: {
    maxHeight: SCREEN_HEIGHT * 0.2,
  },
  indicators: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
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
    marginBottom: 0,
  },
  detailSection: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryDim,
  },
  textBubble: {
    backgroundColor: 'rgba(51, 255, 51, 0.05)',
    padding: 8,
    borderLeftWidth: 2,
    borderLeftColor: TERMINAL.colors.primaryDim,
  },
  beatText: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryBright,
    lineHeight: 18,
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
    marginTop: 2,
    gap: 4,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
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
    marginBottom: 2,
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
  choiceBranch: {
    fontFamily: TERMINAL.fonts.mono,
    color: VISUALIZER_COLORS.indicators.branching,
  },
  choiceSystemBlock: {
    gap: 3,
  },
  systemSummary: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.primaryDim,
    lineHeight: 14,
  },
  systemList: {
    gap: 2,
  },
  systemListLabel: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.amber,
    fontWeight: 'bold',
  },
  systemListItem: {
    fontFamily: TERMINAL.fonts.mono,
    color: TERMINAL.colors.muted,
    lineHeight: 13,
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
