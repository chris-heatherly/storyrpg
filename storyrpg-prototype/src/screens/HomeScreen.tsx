import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Platform,
  Image,
  useWindowDimensions,
} from 'react-native';
import {
  Play,
  Sword,
  BookOpen,
  Settings,
  LogOut,
  RotateCcw,
  Sparkles,
  Cpu,
  LogIn,
} from 'lucide-react-native';
import { useGameActions, useGamePlayerState, useGameStoryState } from '../stores/gameStore';
import { StoryCatalogEntry } from '../types';
import { TERMINAL } from '../theme';
import { useSettingsStore } from '../stores/settingsStore';
import { APP_FOOTER_LINE_1, APP_FOOTER_LINE_2 } from '../config/version';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConfirmDialog } from '../components/ui';
import { track } from '../services/analyticsService';

interface HomeScreenProps {
  stories: StoryCatalogEntry[];
  onStartStory: (storyId: string) => void;
  onContinueStory: () => void;
  onOpenSettings: () => void;
  /** Web: opens dedicated sign-in screen (proxy OAuth). */
  onOpenLogin?: () => void;
  onOpenGenerator?: () => void;
  activeGenerationJob?: {
    id: string;
    progress?: number;
  } | null;
  onOpenActiveGeneration?: (jobId: string) => void;
}

const STORY_CARD_GAP = 16;
const PLACEHOLDER_IMAGE = 'https://placehold.co/400x600/1a1a2e/94a3b8?text=Story';
const WEB_STORY_CARD_SIZE =
  Platform.OS === 'web'
    ? ({ width: `calc((100% - ${STORY_CARD_GAP}px) / 2)` } as any)
    : undefined;

interface HomeHeaderProps {
  activeGenerationJob?: HomeScreenProps['activeGenerationJob'];
  onOpenActiveGeneration?: HomeScreenProps['onOpenActiveGeneration'];
  onOpenGenerator?: HomeScreenProps['onOpenGenerator'];
  onOpenLogin?: HomeScreenProps['onOpenLogin'];
  onOpenSettings: HomeScreenProps['onOpenSettings'];
}

const HomeHeader: React.FC<HomeHeaderProps> = ({
  activeGenerationJob,
  onOpenActiveGeneration,
  onOpenGenerator,
  onOpenLogin,
  onOpenSettings,
}) => {
  const { width } = useWindowDimensions();
  const compactHeader = width < 390;
  const activeGenerationProgress = Math.max(0, Math.min(100, Math.round(activeGenerationJob?.progress || 0)));

  return (
    <View style={styles.header}>
      <View style={styles.logoRow}>
        <View style={styles.logoIcon}>
          <Sword size={20} color="white" />
        </View>
        <Text style={styles.logoText}>STORY<Text style={{ color: TERMINAL.colors.primary }}>RPG</Text></Text>
      </View>
      <View style={styles.headerActions}>
        {activeGenerationJob && onOpenActiveGeneration && (
          <TouchableOpacity
            style={[styles.headerActionButton, styles.pipelineActionButton, compactHeader && styles.pipelineActionButtonCompact]}
            onPress={() => onOpenActiveGeneration(activeGenerationJob.id)}
            activeOpacity={0.82}
          >
            <View style={styles.headerActionContent}>
              <Cpu size={16} color={TERMINAL.colors.primary} />
              <Text style={styles.headerActionButtonText} numberOfLines={1}>
                {compactHeader ? `PIPE ${activeGenerationProgress}%` : `PIPELINE ${activeGenerationProgress}%`}
              </Text>
            </View>
            <View style={styles.pipelineProgressTrack}>
              <View style={[styles.pipelineProgressFill, { width: `${activeGenerationProgress}%` }]} />
            </View>
          </TouchableOpacity>
        )}
        {Platform.OS === 'web' && onOpenLogin ? (
          <TouchableOpacity
            style={[styles.headerIconButton, { flexDirection: 'row', gap: 6, paddingHorizontal: 10 }]}
            onPress={onOpenLogin}
          >
            <LogIn size={16} color={TERMINAL.colors.muted} />
            <Text style={{ color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>
              SIGN IN
            </Text>
          </TouchableOpacity>
        ) : null}
        {onOpenGenerator && (
          <TouchableOpacity
            style={styles.headerActionButton}
            onPress={onOpenGenerator}
          >
            <Sparkles size={16} color={TERMINAL.colors.primary} />
            {!compactHeader && <Text style={styles.headerActionButtonText}>GENERATE</Text>}
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.headerIconButton} onPress={onOpenSettings}>
          <Settings size={20} color={TERMINAL.colors.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface StoryCardProps {
  cardStyle?: object;
  failed: boolean;
  fonts: {
    small: number;
    large: number;
  };
  onImageError: (storyId: string) => void;
  onSelect: (story: StoryCatalogEntry) => void;
  placeholderImage: string;
  story: StoryCatalogEntry;
}

const getStoryCoverUri = (story: StoryCatalogEntry, failed: boolean, placeholderImage: string) => {
  if (failed) return placeholderImage;
  if (story.coverImage && !story.coverImage.endsWith('.prompt.txt') && !story.coverImage.endsWith('.txt')) {
    return story.coverImage;
  }
  return placeholderImage;
};

const StoryCard = memo<StoryCardProps>(({
  cardStyle,
  failed,
  fonts,
  onImageError,
  onSelect,
  placeholderImage,
  story,
}) => {
  const coverUri = getStoryCoverUri(story, failed, placeholderImage);
  const imageSource = useMemo(() => ({
    uri: coverUri,
    headers: { Accept: 'image/*' },
  }), [coverUri]);

  return (
    <TouchableOpacity
      style={[styles.storyCard, cardStyle]}
      onPress={() => onSelect(story)}
      activeOpacity={0.8}
    >
      <Image
        source={imageSource}
        style={styles.storyImage}
        resizeMode="cover"
        crossOrigin="anonymous"
        onError={() => {
          console.warn(`[HomeScreen] Story image failed, using placeholder: ${story.coverImage}`);
          onImageError(story.id);
        }}
      />
      <View style={styles.storyBadge}>
        <Text style={styles.storyBadgeText}>{(story.genre || 'unknown').toUpperCase()}</Text>
      </View>
      <View pointerEvents="none" style={styles.storyOverlayFadeFaint} />
      <View pointerEvents="none" style={styles.storyOverlayFadeMid} />
      <View pointerEvents="none" style={styles.storyOverlayFadeStrong} />
      <View style={styles.storyOverlay}>
        <Text style={[styles.storyCardTitle, { fontSize: fonts.large }]}>{(story.title || 'Untitled').toUpperCase()}</Text>
        <Text style={[styles.storyCardMeta, { fontSize: fonts.small }]}>{story.episodeCount} EPISODES</Text>
        <View style={styles.playButtonMini}>
          <Play size={12} color="white" fill="white" />
          <Text style={styles.playButtonMiniText}>START</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

interface StoryGridProps {
  failedImages: Set<string>;
  fonts: {
    small: number;
    large: number;
  };
  onImageError: (storyId: string) => void;
  onStorySelect: (story: StoryCatalogEntry) => void;
  placeholderImage: string;
  stories: StoryCatalogEntry[];
}

const StoryGridWeb = memo<StoryGridProps>(({
  failedImages,
  fonts,
  onImageError,
  onStorySelect,
  placeholderImage,
  stories,
}) => (
  <View style={styles.storiesGrid}>
    {stories.map((story) => (
      <StoryCard
        key={story.id}
        cardStyle={WEB_STORY_CARD_SIZE}
        failed={failedImages.has(story.id)}
        fonts={fonts}
        onImageError={onImageError}
        onSelect={onStorySelect}
        placeholderImage={placeholderImage}
        story={story}
      />
    ))}
    <LockedStoryCard cardStyle={WEB_STORY_CARD_SIZE} />
  </View>
));

const StoryGridNative = memo<StoryGridProps>(({
  failedImages,
  fonts,
  onImageError,
  onStorySelect,
  placeholderImage,
  stories,
}) => {
  const { width } = useWindowDimensions();
  const storyPosterWidth = (width - 56) / 2;
  const cardStyle = useMemo(() => ({ width: storyPosterWidth }), [storyPosterWidth]);

  return (
    <View style={styles.storiesGrid}>
      {stories.map((story) => (
        <StoryCard
          key={story.id}
          cardStyle={cardStyle}
          failed={failedImages.has(story.id)}
          fonts={fonts}
          onImageError={onImageError}
          onSelect={onStorySelect}
          placeholderImage={placeholderImage}
          story={story}
        />
      ))}
      <LockedStoryCard cardStyle={cardStyle} />
    </View>
  );
});

const StoryGrid = Platform.OS === 'web' ? StoryGridWeb : StoryGridNative;

const LockedStoryCard = memo(({ cardStyle }: { cardStyle?: object }) => (
  <View style={[styles.lockedCard, cardStyle]}>
    <BookOpen size={24} color={TERMINAL.colors.bgHighlight} />
    <Text style={styles.lockedText}>LOCKED CHRONICLE</Text>
    <Text style={styles.lockedSubtext}>EXPANSION PENDING</Text>
  </View>
));

export const HomeScreen: React.FC<HomeScreenProps> = ({
  stories,
  onStartStory,
  onContinueStory,
  onOpenSettings,
  onOpenLogin,
  onOpenGenerator,
  activeGenerationJob,
  onOpenActiveGeneration,
}) => {
  const { player } = useGamePlayerState();
  const { currentStory } = useGameStoryState();
  const { resetGame } = useGameActions();
  const fonts = useSettingsStore((state) => state.getFontSizes());
  const [isWiping, setIsWiping] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const hasSavedGame = currentStory !== null && player.currentEpisodeId !== null;

  useEffect(() => {
    track('home viewed', {
      story_count: stories.length,
      has_saved_game: hasSavedGame,
    });
  }, [stories.length, hasSavedGame]);

  useEffect(() => {
    for (const story of stories) {
      track('story card viewed', {
        story_id: story.id,
        story_genre: story.genre,
        episode_count: story.episodeCount,
        is_generated_story: story.isBuiltIn === false || Boolean(story.outputDir),
      });
    }
  }, [stories]);

  const handleWipeCache = () => {
    setConfirmWipe(true);
  };

  const performWipeCache = async () => {
    setConfirmWipe(false);
    setIsWiping(true);
    try {
      await AsyncStorage.clear();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsWiping(false);
    }
  };

  const handleStorySelect = useCallback((story: StoryCatalogEntry) => {
    // Stories have established protagonists — skip character creation, start directly
    onStartStory(story.id);
  }, [onStartStory]);

  const handleNewGame = () => {
    resetGame();
  };

  const handleImageError = useCallback((storyId: string) => {
    setFailedImages((prev) => {
      if (prev.has(storyId)) return prev;
      const next = new Set(prev);
      next.add(storyId);
      return next;
    });
  }, []);

  // Main Home Screen
  return (
    <SafeAreaView style={styles.container}>
      <HomeHeader
        activeGenerationJob={activeGenerationJob}
        onOpenActiveGeneration={onOpenActiveGeneration}
        onOpenGenerator={onOpenGenerator}
        onOpenLogin={onOpenLogin}
        onOpenSettings={onOpenSettings}
      />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentPadding}
      >
        <Text style={styles.systemStatus}>
          {stories.length} CHRONICLES AVAILABLE
        </Text>

        {/* Active Session */}
        {hasSavedGame && (
          <View style={styles.activeSession}>
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionLabel}>ACTIVE SESSION</Text>
              <Text style={styles.sessionTitle}>{(currentStory?.title || 'Untitled').toUpperCase()}</Text>
              <Text style={styles.sessionUser}>USER: {player.characterName}</Text>
            </View>
            <View style={styles.sessionActions}>
              <TouchableOpacity style={styles.resumeButton} onPress={onContinueStory}>
                <Play size={14} color="white" fill="white" />
                <Text style={styles.resumeButtonText}>RESUME</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.terminateButton} onPress={handleNewGame}>
                <LogOut size={14} color={TERMINAL.colors.muted} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Stories Grid */}
        <StoryGrid
          failedImages={failedImages}
          fonts={fonts}
          onImageError={handleImageError}
          onStorySelect={handleStorySelect}
          placeholderImage={PLACEHOLDER_IMAGE}
          stories={stories}
        />

        <Text style={styles.footerText}>
          {APP_FOOTER_LINE_1}{'\n'}
          {APP_FOOTER_LINE_2}
        </Text>

        <TouchableOpacity 
          style={styles.wipeButton} 
          onPress={handleWipeCache}
          disabled={isWiping}
          accessibilityRole="button"
          accessibilityLabel="Wipe storage cache"
          accessibilityState={{ disabled: isWiping }}
        >
          <RotateCcw size={12} color={TERMINAL.colors.error} />
          <Text style={styles.wipeButtonText}>
            {isWiping ? 'WIPING...' : 'WIPE STORAGE CACHE'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <ConfirmDialog
        visible={confirmWipe}
        title="Wipe all cache?"
        message="This clears all generated stories and save data from browser storage. This action cannot be undone."
        confirmLabel="Wipe"
        cancelLabel="Cancel"
        destructive
        onConfirm={performWipeCache}
        onCancel={() => setConfirmWipe(false)}
        testID="home-wipe-dialog"
      />
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
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: TERMINAL.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '900',
    color: 'white',
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  headerIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  headerActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 12,
    borderRadius: 8,
    height: 36,
    maxWidth: 128,
    overflow: 'hidden',
  },
  pipelineActionButton: {
    width: 172,
    maxWidth: 172,
  },
  pipelineActionButtonCompact: {
    width: 132,
    maxWidth: 132,
    paddingHorizontal: 10,
  },
  headerActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 1,
  },
  headerActionButtonText: {
    color: TERMINAL.colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  pipelineProgressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(59, 130, 246, 0.16)',
  },
  pipelineProgressFill: {
    height: '100%',
    backgroundColor: TERMINAL.colors.primary,
  },
  headerButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
  },
  contentPadding: {
    padding: 20,
    paddingBottom: 40,
  },
  systemStatus: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
    marginBottom: 20,
    textAlign: 'center',
  },
  activeSession: {
    backgroundColor: '#1e2229',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 2,
    marginBottom: 4,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: 'white',
    marginBottom: 4,
  },
  sessionUser: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
  },
  sessionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resumeButton: {
    backgroundColor: TERMINAL.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  resumeButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  terminateButton: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
  },
  storiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  storyCard: {
    aspectRatio: 2 / 3,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#1e2229',
  },
  storyImage: {
    width: '100%',
    height: '100%',
  },
  storyOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    justifyContent: 'flex-end',
  },
  storyOverlayFadeFaint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 140,
    backgroundColor: 'rgba(15, 17, 21, 0.25)',
  },
  storyOverlayFadeMid: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
    backgroundColor: 'rgba(15, 17, 21, 0.45)',
  },
  storyOverlayFadeStrong: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 50,
    backgroundColor: 'rgba(15, 17, 21, 0.6)',
  },
  storyBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: TERMINAL.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    zIndex: 2,
  },
  storyBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  storyCardTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: 'white',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  storyCardMeta: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '700',
    marginBottom: 12,
  },
  playButtonMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playButtonMiniText: {
    fontSize: 10,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  lockedCard: {
    aspectRatio: 2 / 3,
    borderRadius: 24,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  lockedText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.bgHighlight,
    letterSpacing: 1,
    marginTop: 12,
    textAlign: 'center',
  },
  lockedSubtext: {
    fontSize: 8,
    color: TERMINAL.colors.bgHighlight,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  creationHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  creationIcon: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: TERMINAL.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: TERMINAL.colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  creationTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
    marginBottom: 8,
  },
  creationSubtitle: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
    letterSpacing: 1,
  },
  creationContent: {
    padding: 30,
  },
  inputSection: {
    marginBottom: 32,
  },
  label: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 2,
    marginBottom: 12,
  },
  inputWrapper: {
    borderBottomWidth: 2,
    borderBottomColor: TERMINAL.colors.bgHighlight,
    paddingBottom: 8,
  },
  input: {
    fontSize: 24,
    fontWeight: '900',
    color: 'white',
    padding: 0,
  },
  pronounOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  pronounOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
  },
  pronounOptionSelected: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  pronounText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  pronounTextSelected: {
    color: TERMINAL.colors.primary,
  },
  executeButton: {
    backgroundColor: TERMINAL.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 12,
    marginTop: 20,
  },
  executeButtonDisabled: {
    backgroundColor: '#1e293b',
    opacity: 0.5,
  },
  executeButtonText: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 2,
  },
  footerText: {
    fontSize: 9,
    color: TERMINAL.colors.muted,
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  wipeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    marginTop: 10,
    marginBottom: 40,
    gap: 6,
  },
  wipeButtonText: {
    color: TERMINAL.colors.error,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
