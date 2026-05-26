import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import {
  GameProvider,
  useGameActions,
  useGamePlayerState,
  useGameStoryState,
} from '../../src/stores/gameStore';
import { SettingsProvider, useSettingsStore } from '../../src/stores/settingsStore';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { LoginScreen } from '../../src/screens/LoginScreen';
import { EpisodeSelectScreen } from '../../src/screens/EpisodeSelectScreen';
import { ReadingScreen } from '../../src/screens/ReadingScreen';
import { ReaderSettingsScreen } from '../../src/screens/reader/ReaderSettingsScreen';
import { allStories as builtInStories } from '../../src/data/stories';
import type { PlayerState, Story } from '../../src/types';
import { TERMINAL } from '../../src/theme';
import { encodeStory } from '../../src/story-codec/storyCodec';
import { useStoryLibrary } from '../../src/hooks/useStoryLibrary';
import { useAuthSession } from '../../src/hooks/useAuthSession';
import type { AuthUser } from '../../src/services/authSession';
import {
  captureAttributionFromUrl,
  identifyAnonymousPlayer,
  incrementPersonProperty,
  initAnalytics,
  screen as trackScreen,
  setSuperProperties,
  track,
} from '../../src/services/analyticsService';

const GENERATED_STORIES_KEY = '@storyrpg_generated_stories';

type ReaderScreen = 'home' | 'episodes' | 'reading' | 'settings';

function ReaderAppContent() {
  const [currentScreen, setCurrentScreen] = useState<ReaderScreen>('home');
  const [showPauseMenu, setShowPauseMenu] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const {
    authUser,
    signedOutLatch,
    isChecking: isAuthChecking,
    isSignedIn,
    handleAuthenticated,
    handleSignedOut,
  } = useAuthSession({
    onSessionRestored: () => {
      setCurrentScreen('home');
    },
  });
  const {
    stories,
    setStories,
    storiesLoaded,
    fileLoadedStoryIds,
    isRefreshing,
    storyCacheRef,
    loadStories,
    loadFullStory,
    removeStory,
  } = useStoryLibrary(builtInStories);
  const { player } = useGamePlayerState();
  const { currentStory, currentEpisode } = useGameStoryState();
  const {
    initializeStory,
    loadEpisode,
    loadScene,
  } = useGameActions();
  const fonts = useSettingsStore((state) => state.getFontSizes());

  const onAuthenticated = useCallback(
    (user: AuthUser) => {
      handleAuthenticated(user);
      setCurrentScreen('home');
    },
    [handleAuthenticated],
  );

  const onSignOut = useCallback(async () => {
    setIsSigningOut(true);
    setShowPauseMenu(false);
    try {
      await handleSignedOut();
    } finally {
      setIsSigningOut(false);
    }
  }, [handleSignedOut]);

  useEffect(() => {
    initAnalytics();
    identifyAnonymousPlayer();
    captureAttributionFromUrl();
    track('reader opened');
  }, []);

  useEffect(() => {
    trackScreen(currentScreen, {
      app_target: 'reader',
      has_current_story: Boolean(currentStory?.id),
      current_story_id: currentStory?.id,
      current_episode_id: currentEpisode?.id,
    });
  }, [currentScreen, currentStory?.id, currentEpisode?.id]);

  useEffect(() => {
    if (!storiesLoaded || Platform.OS === 'web') return;

    const saveStories = async () => {
      const storiesToSave = stories
        .filter((story) => !fileLoadedStoryIds.has(story.id))
        .map((story) => storyCacheRef.current.get(story.id))
        .filter(Boolean)
        .map((record) => {
          try {
            return encodeStory((record as { story: Story }).story, {
              assets: {},
              generator: { version: '3', pipeline: 'reader-cache' },
            });
          } catch (err) {
            console.warn('[ReaderApp] Skipping story that failed encode:', err instanceof Error ? err.message : err);
            return null;
          }
        })
        .filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== null);

      if (storiesToSave.length > 0) {
        await AsyncStorage.setItem(GENERATED_STORIES_KEY, JSON.stringify(storiesToSave));
      }
    };

    void saveStories().catch((err) => {
      console.error('[ReaderApp] Failed to save stories:', err);
    });
  }, [fileLoadedStoryIds, stories, storiesLoaded, storyCacheRef]);

  const normalizePronouns = (value: unknown): PlayerState['characterPronouns'] | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'he/him' || normalized === 'she/her' || normalized === 'they/them') {
      return normalized;
    }
    return null;
  };

  const resolveProtagonist = (story: Story): { name: string; pronouns: PlayerState['characterPronouns'] } => {
    const firstSceneCharacter = (story as any)?.episodes?.[0]?.scenes?.[0]?.characters?.[0];
    const firstSceneCharacterName = typeof firstSceneCharacter?.name === 'string' ? firstSceneCharacter.name.trim() : '';
    const firstSceneCharacterPronouns = normalizePronouns(firstSceneCharacter?.pronouns);
    if (firstSceneCharacterName) {
      return {
        name: firstSceneCharacterName,
        pronouns: firstSceneCharacterPronouns || 'he/him',
      };
    }

    const protagonistNpc = story.npcs?.find((npc) => {
      const id = (npc.id || '').toLowerCase();
      const desc = (npc.description || '').toLowerCase();
      return id.includes('protagonist')
        || id.includes('player')
        || id.includes('hero')
        || desc.includes('protagonist')
        || desc.includes('player character');
    });
    if (protagonistNpc?.name?.trim()) {
      return {
        name: protagonistNpc.name.trim(),
        pronouns: normalizePronouns(protagonistNpc.pronouns) || 'he/him',
      };
    }

    if (story.npcs?.[0]?.name?.trim()) {
      return {
        name: story.npcs[0].name.trim(),
        pronouns: normalizePronouns(story.npcs[0].pronouns) || 'he/him',
      };
    }

    return { name: 'Protagonist', pronouns: 'he/him' };
  };

  const handleStartStory = async (storyId: string) => {
    const catalogStory = stories.find((story) => story.id === storyId);
    track('story selected', {
      app_target: 'reader',
      story_id: storyId,
      story_genre: catalogStory?.genre,
      episode_count: catalogStory?.episodeCount,
      is_generated_story: catalogStory?.isBuiltIn === false || Boolean(catalogStory?.outputDir),
    });

    const story = await loadFullStory(storyId);
    if (!story) return;
    const protagonist = resolveProtagonist(story);
    initializeStory(story, protagonist.name, protagonist.pronouns);
    setSuperProperties({
      last_story_id: story.id,
      last_story_genre: story.genre,
    });
    incrementPersonProperty('stories_started_count');
    track('story started', {
      app_target: 'reader',
      story_id: story.id,
      story_genre: story.genre,
      episode_count: story.episodes.length,
      is_generated_story: Boolean(story.outputDir),
    });
    setCurrentScreen('episodes');
  };

  const handleContinueStory = () => {
    track('continue story clicked', {
      app_target: 'reader',
      story_id: currentStory?.id,
      story_genre: currentStory?.genre,
      episode_id: currentEpisode?.id,
    });
    setCurrentScreen('episodes');
  };

  const handleSelectEpisode = (episodeId: string) => {
    const episode = currentStory?.episodes.find((candidate) => candidate.id === episodeId);
    if (!episode) return;
    setSuperProperties({
      last_story_id: currentStory?.id,
      last_story_genre: currentStory?.genre,
      last_episode_id: episode.id,
    });
    loadEpisode(episodeId);
    if (episode.startingSceneId) {
      loadScene(episode.startingSceneId, episode);
    }
    track('episode started', {
      app_target: 'reader',
      story_id: currentStory?.id,
      story_genre: currentStory?.genre,
      episode_id: episode.id,
      episode_number: episode.number,
    });
    setCurrentScreen('reading');
  };

  const handleDeleteStory = async (storyId: string) => {
    removeStory(storyId);
    try {
      const stored = await AsyncStorage.getItem(GENERATED_STORIES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown[];
        const filtered = parsed.filter((raw) => {
          if (!raw || typeof raw !== 'object') return true;
          const obj = raw as { id?: string; storyId?: string; story?: { id?: string } };
          return obj.id !== storyId && obj.storyId !== storyId && obj.story?.id !== storyId;
        });
        await AsyncStorage.setItem(GENERATED_STORIES_KEY, JSON.stringify(filtered));
      }
    } catch (err) {
      console.warn('[ReaderApp] Failed to remove story from local storage:', err);
    }
  };

  const handleRenameStory = (storyId: string, title: string) => {
    setStories((prev) => prev.map((story) => (
      story.id === storyId ? { ...story, title } : story
    )));
  };

  if (isSigningOut || (!signedOutLatch && isAuthChecking) || (isSignedIn && !storiesLoaded)) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <Text style={{ color: TERMINAL.colors.primary, fontSize: fonts.medium }}>
          {TERMINAL.symbols.prompt} LOADING...
        </Text>
      </View>
    );
  }

  const showAppShell = !signedOutLatch && authUser != null;

  if (!showAppShell) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <LoginScreen onAuthenticated={onAuthenticated} allowDevBypass={false} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {currentScreen === 'home' && (
        <HomeScreen
          stories={stories}
          onStartStory={handleStartStory}
          onContinueStory={handleContinueStory}
          onOpenSettings={() => setCurrentScreen('settings')}
        />
      )}

      {currentScreen === 'settings' && (
        <ReaderSettingsScreen
          stories={stories}
          authUser={authUser}
          onSignOut={() => { void onSignOut(); }}
          onBack={() => setCurrentScreen('home')}
          onDeleteStory={handleDeleteStory}
          onRefreshStories={loadStories}
          isRefreshing={isRefreshing}
        />
      )}

      {currentScreen === 'episodes' && (
        <EpisodeSelectScreen
          onSelectEpisode={handleSelectEpisode}
          onBack={() => setCurrentScreen('home')}
        />
      )}

      {currentScreen === 'reading' && (
        <ReadingScreen
          onEpisodeComplete={() => setCurrentScreen('episodes')}
          onPause={() => setShowPauseMenu(true)}
        />
      )}

      <Modal
        visible={showPauseMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPauseMenu(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.pauseMenu}>
            <Text style={styles.pauseHeader}>SYSTEM PAUSED</Text>
            <Text style={[styles.pauseTitle, { fontSize: fonts.header }]}>PAUSED</Text>
            {currentEpisode ? (
              <Text style={[styles.pauseSubtitle, { fontSize: fonts.small }]}>
                EP.{currentEpisode.number}: {currentEpisode.title.toUpperCase()}
              </Text>
            ) : null}
            <TouchableOpacity style={styles.menuButton} onPress={() => setShowPauseMenu(false)}>
              <Text style={styles.menuButtonText}>RESUME</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuButton, styles.menuButtonSecondary]}
              onPress={() => {
                setShowPauseMenu(false);
                setCurrentScreen('home');
              }}
            >
              <Text style={styles.menuButtonTextSecondary}>SAVE & EXIT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={[styles.container, styles.centered, { padding: 20 }]}>
          <Text style={{ color: TERMINAL.colors.error, fontSize: 18, marginBottom: 10 }}>ERROR</Text>
          <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>
            {this.state.error?.message || 'Unknown error'}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function ReaderApp() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <GameProvider>
          <ReaderAppContent />
        </GameProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: TERMINAL.colors.bg },
  centered: { justifyContent: 'center', alignItems: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseMenu: {
    backgroundColor: '#1e2229',
    padding: 30,
    width: '85%',
    maxWidth: 400,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pauseHeader: {
    color: TERMINAL.colors.primary,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 20,
    textAlign: 'center',
  },
  pauseTitle: {
    fontWeight: '900',
    color: 'white',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 1,
  },
  pauseSubtitle: {
    color: TERMINAL.colors.muted,
    marginBottom: 24,
    textAlign: 'center',
    fontWeight: '700',
  },
  menuButton: {
    backgroundColor: TERMINAL.colors.primary,
    paddingVertical: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  menuButtonSecondary: { backgroundColor: 'rgba(255,255,255,0.05)' },
  menuButtonText: { color: 'white', fontWeight: '900', textAlign: 'center', letterSpacing: 1 },
  menuButtonTextSecondary: { color: TERMINAL.colors.muted, textAlign: 'center', fontWeight: '900', letterSpacing: 1 },
});
