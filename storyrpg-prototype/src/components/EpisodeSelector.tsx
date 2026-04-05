/**
 * Episode Selector Component
 *
 * Displays the full episode outline from a season plan and allows
 * users to select specific episodes for generation.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { 
  CheckCircle2, 
  Circle, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Lock,
  Unlock,
} from 'lucide-react-native';
import { TERMINAL } from '../theme';
import { SeasonPlan, SeasonEpisode, EpisodeRecommendation } from '../types/seasonPlan';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface EpisodeSelectorProps {
  seasonPlan: SeasonPlan;
  selectedEpisodes: number[];
  onSelectionChange: (episodes: number[]) => void;
  recommendations?: EpisodeRecommendation[];
  warnings?: string[];
}

export const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  seasonPlan,
  selectedEpisodes,
  onSelectionChange,
  recommendations = [],
  warnings = [],
}) => {
  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null);
  const [showArcs, setShowArcs] = useState(true);

  const toggleEpisode = (episodeNumber: number) => {
    const episode = seasonPlan.episodes.find(e => e.episodeNumber === episodeNumber);
    if (!episode || episode.status === 'completed') return;

    if (selectedEpisodes.includes(episodeNumber)) {
      onSelectionChange(selectedEpisodes.filter(n => n !== episodeNumber));
    } else {
      onSelectionChange([...selectedEpisodes, episodeNumber].sort((a, b) => a - b));
    }
  };

  const selectAll = () => {
    const available = seasonPlan.episodes
      .filter(e => e.status !== 'completed')
      .map(e => e.episodeNumber);
    onSelectionChange(available);
  };

  const clearSelection = () => {
    onSelectionChange([]);
  };

  const selectRecommended = () => {
    const recommended = recommendations
      .filter(r => r.priority === 'must_generate' || r.priority === 'recommended')
      .map(r => r.episodeNumber);
    const combined = [...new Set([...selectedEpisodes, ...recommended])].sort((a, b) => a - b);
    onSelectionChange(combined);
  };

  // Check if episode has unmet dependencies
  const hasUnmetDependencies = (episode: SeasonEpisode): boolean => {
    return episode.dependsOn.some(dep => {
      const depEp = seasonPlan.episodes.find(e => e.episodeNumber === dep);
      return depEp?.status !== 'completed' && !selectedEpisodes.includes(dep);
    });
  };

  // Get arc for an episode
  const getArcForEpisode = (episodeNumber: number) => {
    return seasonPlan.arcs.find(
      arc => episodeNumber >= arc.episodeRange.start && episodeNumber <= arc.episodeRange.end
    );
  };

  // Group episodes by arc
  const episodesByArc = seasonPlan.arcs.map(arc => ({
    arc,
    episodes: seasonPlan.episodes.filter(
      e => e.episodeNumber >= arc.episodeRange.start && e.episodeNumber <= arc.episodeRange.end
    ),
  }));

  return (
    <View style={styles.container}>
      {/* Season Overview */}
      <View style={styles.seasonHeader}>
        <Text style={styles.seasonTitle}>{seasonPlan.seasonTitle.toUpperCase()}</Text>
        <Text style={styles.seasonSynopsis}>{seasonPlan.seasonSynopsis}</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${seasonPlan.progress.percentComplete}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {seasonPlan.progress.completedCount}/{seasonPlan.totalEpisodes} COMPLETED
        </Text>
      </View>

      {/* Selection Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={selectAll}>
          <Text style={styles.controlBtnText}>SELECT ALL</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlBtn} onPress={clearSelection}>
          <Text style={styles.controlBtnText}>CLEAR</Text>
        </TouchableOpacity>
        {recommendations.length > 0 && (
          <TouchableOpacity style={[styles.controlBtn, styles.controlBtnHighlight]} onPress={selectRecommended}>
            <Text style={[styles.controlBtnText, styles.controlBtnTextHighlight]}>+ RECOMMENDED</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Warnings */}
      {warnings.length > 0 && (
        <View style={styles.warningsContainer}>
          {warnings.map((warning, idx) => (
            <View key={idx} style={styles.warningItem}>
              <AlertTriangle size={14} color={TERMINAL.colors.amber} />
              <Text style={styles.warningText}>{warning}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Arc Toggle */}
      <TouchableOpacity 
        style={styles.arcToggle} 
        onPress={() => setShowArcs(!showArcs)}
      >
        <Text style={styles.arcToggleText}>
          {showArcs ? 'HIDE STORY ARCS' : 'SHOW STORY ARCS'}
        </Text>
        {showArcs ? <ChevronUp size={16} color={TERMINAL.colors.muted} /> : <ChevronDown size={16} color={TERMINAL.colors.muted} />}
      </TouchableOpacity>

      {/* Episodes List */}
      <ScrollView style={styles.episodeList} showsVerticalScrollIndicator={false}>
        {showArcs ? (
          // Grouped by arc
          episodesByArc.map(({ arc, episodes }, arcIdx) => (
            <View key={arc.id || `arc-${arcIdx}`} style={styles.arcSection}>
              <View key={`${arc.id || arcIdx}-header`} style={styles.arcHeader}>
                <Text style={styles.arcName}>{arc.name.toUpperCase()}</Text>
                <Text style={styles.arcRange}>EP {arc.episodeRange.start}-{arc.episodeRange.end}</Text>
              </View>
              <Text key={`${arc.id || arcIdx}-desc`} style={styles.arcDescription}>{arc.description}</Text>
              
              {episodes.map(episode => (
                <EpisodeRow
                  key={`${arc.id || arcIdx}-ep-${episode.episodeNumber}`}
                  episode={episode}
                  isSelected={selectedEpisodes.includes(episode.episodeNumber)}
                  isExpanded={expandedEpisode === episode.episodeNumber}
                  hasUnmetDeps={hasUnmetDependencies(episode)}
                  recommendation={recommendations.find(r => r.episodeNumber === episode.episodeNumber)}
                  onToggle={() => toggleEpisode(episode.episodeNumber)}
                  onExpand={() => setExpandedEpisode(
                    expandedEpisode === episode.episodeNumber ? null : episode.episodeNumber
                  )}
                />
              ))}
            </View>
          ))
        ) : (
          // Flat list
          seasonPlan.episodes.map(episode => (
            <EpisodeRow
              key={episode.episodeNumber}
              episode={episode}
              isSelected={selectedEpisodes.includes(episode.episodeNumber)}
              isExpanded={expandedEpisode === episode.episodeNumber}
              hasUnmetDeps={hasUnmetDependencies(episode)}
              recommendation={recommendations.find(r => r.episodeNumber === episode.episodeNumber)}
              onToggle={() => toggleEpisode(episode.episodeNumber)}
              onExpand={() => setExpandedEpisode(
                expandedEpisode === episode.episodeNumber ? null : episode.episodeNumber
              )}
            />
          ))
        )}
      </ScrollView>

      {/* Selection Summary */}
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {selectedEpisodes.length} EPISODE{selectedEpisodes.length !== 1 ? 'S' : ''} SELECTED
        </Text>
        {selectedEpisodes.length > 0 && (
          <Text style={styles.summaryDetail}>
            Est. {selectedEpisodes.length * 15}-{selectedEpisodes.length * 25} min
          </Text>
        )}
      </View>
    </View>
  );
};

// Individual Episode Row
interface EpisodeRowProps {
  episode: SeasonEpisode;
  isSelected: boolean;
  isExpanded: boolean;
  hasUnmetDeps: boolean;
  recommendation?: EpisodeRecommendation;
  onToggle: () => void;
  onExpand: () => void;
}

const EpisodeRow: React.FC<EpisodeRowProps> = ({
  episode,
  isSelected,
  isExpanded,
  hasUnmetDeps,
  recommendation,
  onToggle,
  onExpand,
}) => {
  const isCompleted = episode.status === 'completed';
  const isDisabled = isCompleted;

  return (
    <View style={[
      styles.episodeRow,
      isSelected && styles.episodeRowSelected,
      isCompleted && styles.episodeRowCompleted,
    ]}>
      <TouchableOpacity 
        style={styles.episodeCheckbox}
        onPress={onToggle}
        disabled={isDisabled}
      >
        {isCompleted ? (
          <CheckCircle2 size={24} color={TERMINAL.colors.primary} />
        ) : isSelected ? (
          <CheckCircle2 size={24} color={TERMINAL.colors.cyan} />
        ) : (
          <Circle size={24} color={TERMINAL.colors.muted} />
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.episodeContent} onPress={onExpand}>
        <View style={styles.episodeHeader}>
          <View style={styles.episodeNumber}>
            <Text style={styles.episodeNumberText}>{episode.episodeNumber}</Text>
          </View>
          <View style={styles.episodeTitleContainer}>
            <Text style={[
              styles.episodeTitle,
              isCompleted && styles.episodeTitleCompleted,
            ]}>
              {(episode.title || 'Untitled').toUpperCase()}
            </Text>
            {recommendation && (
              <View style={[
                styles.recommendationBadge,
                recommendation.priority === 'must_generate' && styles.recommendationMust,
                recommendation.priority === 'recommended' && styles.recommendationRecommended,
              ]}>
                <Text style={styles.recommendationText}>
                  {recommendation.priority === 'must_generate' ? 'REQUIRED' : 'SUGGESTED'}
                </Text>
              </View>
            )}
          </View>
          {hasUnmetDeps && !isSelected && (
            <Lock size={14} color={TERMINAL.colors.amber} />
          )}
          {isExpanded ? (
            <ChevronUp size={16} color={TERMINAL.colors.muted} />
          ) : (
            <ChevronDown size={16} color={TERMINAL.colors.muted} />
          )}
        </View>

        {!isExpanded && (
          <Text style={styles.episodeSynopsisPreview} numberOfLines={1}>
            {episode.synopsis}
          </Text>
        )}
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.episodeExpanded}>
          <Text style={styles.episodeSynopsis}>{episode.synopsis}</Text>
          
          {episode.dependsOn.length > 0 && (
            <View style={styles.dependencyInfo}>
              <Text style={styles.dependencyLabel}>DEPENDS ON:</Text>
              <Text style={styles.dependencyList}>
                Episode{episode.dependsOn.length > 1 ? 's' : ''} {episode.dependsOn.join(', ')}
              </Text>
            </View>
          )}
          
          {episode.introducesCharacters.length > 0 && (
            <View style={styles.introInfo}>
              <Text style={styles.introLabel}>INTRODUCES:</Text>
              <Text style={styles.introList}>
                {episode.mainCharacters.slice(0, 3).join(', ')}
                {episode.mainCharacters.length > 3 ? ` +${episode.mainCharacters.length - 3} more` : ''}
              </Text>
            </View>
          )}

          <View style={styles.episodeMeta}>
            <Text style={styles.metaItem}>~{episode.estimatedSceneCount} SCENES</Text>
            <Text style={styles.metaItem}>~{episode.estimatedChoiceCount} CHOICES</Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  seasonHeader: {
    marginBottom: 16,
  },
  seasonTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  seasonSynopsis: {
    fontSize: 12,
    color: TERMINAL.colors.muted,
    lineHeight: 18,
    marginBottom: 12,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: TERMINAL.colors.primary,
  },
  progressText: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  controls: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  controlBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  controlBtnHighlight: {
    borderColor: TERMINAL.colors.cyan,
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
  },
  controlBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },
  controlBtnTextHighlight: {
    color: TERMINAL.colors.cyan,
  },
  warningsContainer: {
    marginBottom: 12,
    padding: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  warningItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  warningText: {
    flex: 1,
    fontSize: 11,
    color: TERMINAL.colors.amber,
    lineHeight: 16,
  },
  arcToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    marginBottom: 8,
  },
  arcToggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },
  episodeList: {
    flex: 1,
    marginBottom: 12,
  },
  arcSection: {
    marginBottom: 16,
  },
  arcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  arcName: {
    fontSize: 11,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 1,
  },
  arcRange: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
  },
  arcDescription: {
    fontSize: 11,
    color: TERMINAL.colors.muted,
    marginBottom: 8,
    lineHeight: 16,
  },
  episodeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    padding: 10,
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  episodeRowSelected: {
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  episodeRowCompleted: {
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  episodeCheckbox: {
    marginRight: 10,
    marginTop: 2,
  },
  episodeContent: {
    flex: 1,
  },
  episodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  episodeNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  episodeNumberText: {
    fontSize: 11,
    fontWeight: '900',
    color: 'white',
  },
  episodeTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  episodeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: 'white',
    letterSpacing: 0.5,
  },
  episodeTitleCompleted: {
    color: TERMINAL.colors.primary,
  },
  recommendationBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  recommendationMust: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  recommendationRecommended: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
  },
  recommendationText: {
    fontSize: 8,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 0.5,
  },
  episodeSynopsisPreview: {
    fontSize: 11,
    color: TERMINAL.colors.muted,
    marginTop: 4,
    marginLeft: 32,
  },
  episodeExpanded: {
    width: '100%',
    marginTop: 10,
    marginLeft: 34,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  episodeSynopsis: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 18,
    marginBottom: 10,
  },
  dependencyInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  dependencyLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: TERMINAL.colors.amber,
    letterSpacing: 0.5,
  },
  dependencyList: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
  },
  introInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  introLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: TERMINAL.colors.cyan,
    letterSpacing: 0.5,
  },
  introList: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
  },
  episodeMeta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  metaItem: {
    fontSize: 9,
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },
  summary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 12,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 1,
  },
  summaryDetail: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
  },
});
