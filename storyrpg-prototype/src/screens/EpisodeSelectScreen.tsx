import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Image,
} from 'react-native';
import { ChevronRight, Lock, CheckCircle2, Clock } from 'lucide-react-native';
import { useGamePlayerState, useGameStoryState } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { isEpisodeUnlocked } from '../engine/storyEngine';
import { Episode } from '../types';
import { TERMINAL } from '../theme';

interface EpisodeSelectScreenProps {
  onSelectEpisode: (episodeId: string) => void;
  onBack: () => void;
}

export const EpisodeSelectScreen: React.FC<EpisodeSelectScreenProps> = ({
  onSelectEpisode,
  onBack,
}) => {
  const { player } = useGamePlayerState();
  const { currentStory } = useGameStoryState();
  const fonts = useSettingsStore((state) => state.getFontSizes());

  if (!currentStory) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>NO STORY LOADED</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isCompleted = (episodeId: string) =>
    player.completedEpisodes.includes(episodeId);

  const isUnlocked = (episode: Episode, index: number) => {
    if (index === 0) return true;
    const prevEpisode = currentStory.episodes[index - 1];
    if (!isCompleted(prevEpisode.id)) return false;
    return isEpisodeUnlocked(episode, player);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <ChevronRight size={20} color={TERMINAL.colors.muted} style={{ transform: [{ rotate: '180deg' }] }} />
          <Text style={styles.backButtonText}>BACK</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>CHOOSE EPISODE</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Story Summary Card */}
        <View style={styles.storyHero}>
          <Image source={{ uri: currentStory.coverImage }} style={styles.heroImage} />
          <View style={styles.heroOverlay}>
            <Text style={styles.storyTitle}>{(currentStory.title || 'Untitled').toUpperCase()}</Text>
            <View style={styles.metaRow}>
              <View style={styles.genreBadge}>
                <Text style={styles.genreText}>{(currentStory.genre || 'unknown').toUpperCase()}</Text>
              </View>
              <Text style={styles.characterTag}>USER: {(player.characterName || 'Unknown').toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* Episode Grid */}
        <View style={styles.episodeList}>
          {currentStory.episodes.map((episode, index) => {
            const unlocked = isUnlocked(episode, index);
            const completed = isCompleted(episode.id);

            return (
              <TouchableOpacity
                key={episode.id}
                style={[
                  styles.episodeCard,
                  !unlocked && styles.episodeCardLocked,
                  completed && styles.episodeCardCompleted,
                ]}
                onPress={() => unlocked && onSelectEpisode(episode.id)}
                disabled={!unlocked}
                activeOpacity={0.8}
              >
                <View style={styles.episodeInfo}>
                  <View style={styles.episodeNumberContainer}>
                    <Text style={[styles.episodeNumber, !unlocked && styles.textLocked]}>
                      {episode.number.toString().padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={styles.episodeTextContainer}>
                    <Text style={[styles.episodeTitle, !unlocked && styles.textLocked]}>
                      {unlocked ? (episode.title || 'Untitled').toUpperCase() : 'LOCKED CONTENT'}
                    </Text>
                    <Text style={[styles.episodeSynopsis, !unlocked && styles.textLocked]} numberOfLines={2}>
                      {unlocked ? episode.synopsis : 'Complete previous episode to unlock this chapter.'}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.statusIcon}>
                  {completed ? (
                    <CheckCircle2 size={20} color={TERMINAL.colors.primary} />
                  ) : unlocked ? (
                    <ChevronRight size={20} color={TERMINAL.colors.primary} />
                  ) : (
                    <Lock size={20} color={TERMINAL.colors.muted} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Progress Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{player.completedEpisodes.length}</Text>
            <Text style={styles.statLabel}>DONE</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{player.inventory.length}</Text>
            <Text style={styles.statLabel}>ITEMS</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{Object.keys(player.relationships).length}</Text>
            <Text style={styles.statLabel}>CONTACTS</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bg,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
  },
  backButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 2,
  },
  content: {
    flex: 1,
  },
  storyHero: {
    height: 200,
    width: '100%',
    position: 'relative',
    backgroundColor: '#000',
  },
  heroImage: {
    width: '100%',
    height: '100%',
    opacity: 0.5,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 24,
    backgroundColor: 'rgba(15, 17, 21, 0.4)',
  },
  storyTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: 'white',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  genreBadge: {
    backgroundColor: TERMINAL.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  genreText: {
    fontSize: 8,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  characterTag: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
    letterSpacing: 1,
  },
  episodeList: {
    padding: 20,
    gap: 12,
  },
  episodeCard: {
    backgroundColor: '#1e2229',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  episodeCardLocked: {
    opacity: 0.5,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  episodeCardCompleted: {
    borderColor: 'rgba(59, 130, 246, 0.3)',
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
  },
  episodeInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  episodeNumberContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  episodeNumber: {
    fontSize: 14,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
  },
  episodeTextContainer: {
    flex: 1,
    gap: 4,
  },
  episodeTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 0.5,
  },
  episodeSynopsis: {
    fontSize: 11,
    color: TERMINAL.colors.muted,
    lineHeight: 16,
  },
  statusIcon: {
    marginLeft: 12,
  },
  textLocked: {
    color: TERMINAL.colors.muted,
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    marginBottom: 40,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    color: 'white',
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
    marginTop: 4,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '900',
    color: TERMINAL.colors.amber,
    letterSpacing: 2,
  },
});
