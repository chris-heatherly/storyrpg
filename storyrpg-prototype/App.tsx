import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Modal, Text, TouchableOpacity, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameProvider, useGameActions, useGamePlayerState, useGameStoryState } from './src/stores/gameStore';
import { SettingsProvider, useSettingsStore } from './src/stores/settingsStore';
import { useGenerationJobStore } from './src/stores/generationJobStore';
import {
  HomeScreen,
  EpisodeSelectScreen,
  ReadingScreen,
  VisualizerScreen,
  SettingsScreen,
  EpisodeRecapScreen,
} from './src/screens';
import { GeneratorScreen } from './src/screens/GeneratorScreen';
import { allStories as builtInStories } from './src/data/stories';
import { PlayerState, Story } from './src/types';
import { TERMINAL } from './src/theme';
import { PROXY_CONFIG } from './src/config/endpoints';
import {
  pipelineClient,
  type PipelineHandle,
} from './src/ai-agents/pipeline/PipelineClient';
import { encodeStory } from './src/ai-agents/codec/storyCodec';
import { loadConfig } from './src/ai-agents/config';
import { useVideoJobStore } from './src/stores/videoJobStore';
import { useStoryLibrary } from './src/hooks/useStoryLibrary';
import { useAppNavigationStore } from './src/stores/appNavigationStore';

const GENERATED_STORIES_KEY = '@storyrpg_generated_stories';
const DELETED_STORIES_KEY = '@storyrpg_deleted_stories'; // Track intentionally deleted stories

function AppContent() {
  // Protagonist name/pronouns come from the story's established characters
  const [videoGeneratingStoryId, setVideoGeneratingStoryId] = useState<string | null>(null);
  const videoPipelineRef = useRef<PipelineHandle | null>(null);
  const [visualizerStory, setVisualizerStory] = useState<Story | null>(null);
  const [recapEpisodeId, setRecapEpisodeId] = useState<string | null>(null);
  const currentScreen = useAppNavigationStore((state) => state.currentScreen);
  const showPauseMenu = useAppNavigationStore((state) => state.showPauseMenu);
  const visualizerStoryId = useAppNavigationStore((state) => state.visualizerStoryId);
  const resumeJobId = useAppNavigationStore((state) => state.resumeJobId);
  const navigateTo = useAppNavigationStore((state) => state.navigateTo);
  const openPauseMenu = useAppNavigationStore((state) => state.openPauseMenu);
  const closePauseMenu = useAppNavigationStore((state) => state.closePauseMenu);
  const openVisualizerRoute = useAppNavigationStore((state) => state.openVisualizer);
  const closeVisualizerRoute = useAppNavigationStore((state) => state.closeVisualizer);
  const openGeneratorRoute = useAppNavigationStore((state) => state.openGenerator);
  const closeGeneratorRoute = useAppNavigationStore((state) => state.closeGenerator);
  const {
    stories,
    setStories,
    storiesLoaded,
    fileLoadedStoryIds,
    deletedStoryIds,
    setDeletedStoryIds,
    isRefreshing,
    storyCacheRef,
    loadStories,
    loadFullStory,
    upsertStory,
    removeStory,
  } = useStoryLibrary(builtInStories);
  
  // Generation job store for the floating indicator
  const { jobs, loadJobs, registerJob: registerGenJob, updateJob: updateGenJob, addJobEvent } = useGenerationJobStore();
  const activeGenerationJob = jobs.find(j => j.status === 'running' || j.status === 'pending');

  // Video job store for live preview
  const { addJob: addVideoJob, updateJob: updateVideoJob, removeJob: removeVideoJob, clearJobs: clearVideoJobs } = useVideoJobStore();

  useEffect(() => {
    loadJobs(); // Load generation jobs on app start
    
    // Initialize season plan store for episode selection persistence
    import('./src/stores/seasonPlanStore').then(({ seasonPlanStore }) => {
      seasonPlanStore.initialize().catch(err => {
        console.warn('[App] Failed to initialize season plan store:', err);
      });
    });
  }, [loadJobs]);

  // Save non-file stories to AsyncStorage (for non-web platforms)
  useEffect(() => {
    if (!storiesLoaded || Platform.OS === 'web') return;

    const saveStories = async () => {
      try {
        // Persist each client-cached story as a v3 StoryPackage so the
        // AsyncStorage reader can `decodeStory` it back on the next boot.
        // encodeStory throws `StoryValidationError` on malformed data —
        // we skip those (they'd fail to decode anyway).
        const storiesToSave = stories
          .filter((story) => !fileLoadedStoryIds.has(story.id))
          .map((story) => storyCacheRef.current.get(story.id))
          .filter(Boolean)
          .map((story) => {
            try {
              return encodeStory(story as unknown as Story, {
                assets: {},
                generator: { version: '3', pipeline: 'client-cache' },
              });
            } catch (err) {
              console.warn('[App] Skipping story that failed encode:', err instanceof Error ? err.message : err);
              return null;
            }
          })
          .filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== null);
        
        if (storiesToSave.length === 0) return;

        const data = JSON.stringify(storiesToSave);
        try {
          await AsyncStorage.setItem(GENERATED_STORIES_KEY, data);
        } catch (storageErr) {
          if (storageErr instanceof Error && storageErr.name === 'QuotaExceededError') {
            await AsyncStorage.setItem(GENERATED_STORIES_KEY, JSON.stringify(storiesToSave));
          } else {
            throw storageErr;
          }
        }
      } catch (err) {
        console.error('[App] ✗ Failed to save stories:', err);
      }
    };
    saveStories();
  }, [stories, storiesLoaded, fileLoadedStoryIds]);

  const { player } = useGamePlayerState();
  const { currentStory, currentEpisode } = useGameStoryState();
  const { initializeStory, loadEpisode, loadScene, setBeat } = useGameActions();
  const fonts = useSettingsStore((state) => state.getFontSizes());

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

    // Prefer explicit protagonist-like NPC entries when available.
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
    const story = await loadFullStory(storyId);
    if (!story) return;

    // Use an actual character name; never derive the player name from story title text.
    const protagonist = resolveProtagonist(story);
    initializeStory(story, protagonist.name, protagonist.pronouns);
    navigateTo('episodes');
  };

  const handleContinueStory = () => {
    navigateTo('episodes');
  };

  const handleSelectEpisode = (episodeId: string) => {
    const episode = currentStory?.episodes.find((e) => e.id === episodeId);
    if (!episode) return;

    loadEpisode(episodeId);
    if (episode.startingSceneId) {
      loadScene(episode.startingSceneId, episode);
    }
    navigateTo('reading');
  };

  const handleEpisodeComplete = () => {
    // Plan 2: show the post-episode flowchart recap before returning the
    // player to the episode-select screen.
    if (currentEpisode?.id) {
      setRecapEpisodeId(currentEpisode.id);
      navigateTo('recap');
    } else {
      navigateTo('episodes');
    }
  };

  const handleRecapContinue = () => {
    setRecapEpisodeId(null);
    navigateTo('episodes');
  };

  const handleRecapRewind = (target: { episodeId: string; sceneId: string; beatId: string }) => {
    if (!currentStory) return;
    const episode = currentStory.episodes.find((e) => e.id === target.episodeId);
    if (!episode) return;
    loadEpisode(target.episodeId);
    loadScene(target.sceneId, episode);
    setBeat(target.beatId);
    setRecapEpisodeId(null);
    navigateTo('reading');
  };

  const handlePause = () => {
    openPauseMenu();
  };

  const handleResume = () => {
    closePauseMenu();
  };

  const handleQuitToMenu = () => {
    closePauseMenu();
    navigateTo('home');
  };

  const handleBackFromEpisodes = () => {
    navigateTo('home');
  };

  const handleOpenSettings = () => {
    navigateTo('settings');
  };

  const handleBackFromSettings = () => {
    navigateTo('home');
  };

  const handleOpenVisualizer = async (storyId: string) => {
    const story = await loadFullStory(storyId);
    if (!story) return;
    setVisualizerStory(story);
    openVisualizerRoute(storyId);
  };

  const handleBackFromVisualizer = () => {
    setVisualizerStory(null);
    closeVisualizerRoute();
  };

  const handleOpenGenerator = (jobId?: string) => {
    openGeneratorRoute(jobId);
  };

  const handleBackFromGenerator = () => {
    // closeGenerator() without an argument defaults to the recorded launch
    // origin (home or settings), so Back returns the user where they came from.
    closeGeneratorRoute();
  };

  const handleStoryGenerated = (story: Story) => {
    if (!story || !story.id || !story.title) return;
    upsertStory(story);
  };

  // Called when the user clicks "Play now" on the generator's complete screen.
  // Initializes the generated story in the game store and navigates to reading.
  const handlePlayGeneratedStory = async (story: Story) => {
    if (!story || !story.id) return;
    upsertStory(story);
    const full = await loadFullStory(story.id);
    const target = full || story;
    const protagonist = resolveProtagonist(target);
    initializeStory(target, protagonist.name, protagonist.pronouns);
    closeGeneratorRoute('episodes');
  };

  // Called when the user clicks "View in library" — route back to home so the
  // story card is visible in the main library.
  const handleViewLibrary = () => {
    closeGeneratorRoute('home');
  };

  const handleDeleteStory = async (storyId: string) => {
    // Delete from filesystem via proxy server (works for both generated and built-in stories)
    // The proxy server will also add the storyId to the filesystem deleted-stories list
    if (Platform.OS === 'web') {
      try {
        const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/delete-story/${encodeURIComponent(storyId)}`, {
          method: 'DELETE',
        });
        const result = await response.json();
        console.log(`[App] Delete story ${storyId}: ${result.deleted > 0 ? 'success' : 'not found'}`);
      } catch (err) {
        console.error('[App] Failed to delete story files:', err);
      }
    }

    // Remove from state
    removeStory(storyId);

    // Track this story as intentionally deleted (prevents re-installation of built-in stories)
    // Save to BOTH filesystem (primary, survives cache reset) and AsyncStorage (backup)
    setDeletedStoryIds(prev => {
      const newSet = new Set(prev);
      newSet.add(storyId);
      const deletedArray = [...newSet];
      
      // Save to filesystem (survives cache resets)
      if (Platform.OS === 'web') {
        fetch(`${PROXY_CONFIG.getProxyUrl()}/deleted-stories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deletedIds: deletedArray }),
        }).catch(err => {
          console.warn('[App] Failed to save deleted stories to filesystem:', err);
        });
      }
      
      // Also save to AsyncStorage as backup
      AsyncStorage.setItem(DELETED_STORIES_KEY, JSON.stringify(deletedArray)).catch(err => {
        console.warn('[App] Failed to save deleted stories to AsyncStorage:', err);
      });
      console.log(`[App] Added ${storyId} to deleted stories list`);
      return newSet;
    });

    // Also try to remove from AsyncStorage if it was stored there
    try {
      const stored = await AsyncStorage.getItem(GENERATED_STORIES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Story[];
        const filtered = parsed.filter(s => s.id !== storyId);
        await AsyncStorage.setItem(GENERATED_STORIES_KEY, JSON.stringify(filtered));
      }
    } catch (err) {
      // Ignore AsyncStorage errors
    }
  };

  const handleRenameStory = async (storyId: string, newTitle: string) => {
    const story = stories.find(s => s.id === storyId);
    if (!story) return;

    const oldOutputDir = story.outputDir || '';

    // Optimistically update the UI
    setStories(prev => prev.map(s => {
      if (s.id === storyId) {
        return { ...s, title: newTitle };
      }
      return s;
    }));

    // Perform the actual rename
    const success = await pipelineClient.renameStory(storyId, oldOutputDir, newTitle);
    
    if (!success) {
      console.warn('[App] Failed to rename story on backend');
    } else if (Platform.OS === 'web') {
      // Refresh stories after rename to get updated paths/manifests
      loadStories();
    }
  };

  const handleGenerateVideos = useCallback(async (storyId: string) => {
    if (videoGeneratingStoryId) return;
    const story = await loadFullStory(storyId);
    if (!story) return;

    const jobId = `vidgen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setVideoGeneratingStoryId(story.id);
    clearVideoJobs();

    await registerGenJob({
      id: jobId,
      storyTitle: `VIDEO: ${story.title || 'Untitled'}`,
      startedAt: new Date().toISOString(),
      status: 'running',
      currentPhase: 'video_generation',
      progress: 0,
      episodeCount: 1,
      currentEpisode: 1,
      events: [],
    });

    openGeneratorRoute(jobId);

    try {
      const config = loadConfig();
      config.videoGen = {
        ...(config.videoGen || {}),
        enabled: true,
      };

      const pipeline = await pipelineClient.createPipeline(config);
      pipeline.setExternalJobId(jobId);
      videoPipelineRef.current = pipeline;
      const rawPipeline = pipeline.raw as any;

      rawPipeline.videoService.onEvent((event: any) => {
        switch (event.type) {
          case 'job_added':
            addVideoJob({
              id: event.job.id,
              identifier: event.job.identifier,
              sourceImageUrl: event.job.sourceImageUrl,
              metadata: event.job.metadata,
            });
            break;
          case 'job_updated':
            updateVideoJob(event.id, {
              status: event.updates.status as any,
              progress: event.updates.progress,
              videoUrl: event.updates.videoUrl,
              ...(event.updates.status === 'completed' || event.updates.status === 'failed' ? { endTime: Date.now() } : {}),
            });
            break;
          case 'job_removed':
            removeVideoJob(event.id);
            break;
        }
      });

      pipeline.onEvent((event) => {
        console.log(`[VideoOnly] ${event.type}: ${event.message}`);

        const eventData = {
          type: event.type,
          phase: event.phase,
          agent: event.agent,
          message: event.message,
          timestamp: new Date().toISOString(),
        };
        addJobEvent(jobId, eventData);

        if (event.telemetry) {
          updateGenJob(jobId, {
            progress: event.telemetry.overallProgress ?? undefined,
            currentPhase: event.phase || 'video_generation',
            ...(event.telemetry.currentItem !== undefined && event.telemetry.totalItems !== undefined
              ? { currentItem: event.telemetry.currentItem, totalItems: event.telemetry.totalItems }
              : {}),
          });
        }
        if (event.type === 'phase_start' && event.phase) {
          updateGenJob(jobId, { currentPhase: event.phase });
        }
      });

      const result = await rawPipeline.runVideoOnly(story);

      await updateGenJob(jobId, {
        status: 'completed',
        progress: 100,
        currentPhase: 'complete',
      });

      upsertStory(result.story);

      console.log(`[App] Video-only generation complete: ${result.videosGenerated} videos`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[App] Video-only generation failed:', errMsg);
      await updateGenJob(jobId, {
        status: 'failed',
        error: errMsg,
      });
    } finally {
      setVideoGeneratingStoryId(null);
      videoPipelineRef.current = null;
    }
  }, [videoGeneratingStoryId, registerGenJob, updateGenJob, addJobEvent, addVideoJob, updateVideoJob, removeVideoJob, clearVideoJobs, loadFullStory]);

  if (!storiesLoaded) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style="light" />
        <Text style={{ color: TERMINAL.colors.primary, fontSize: fonts.medium }}>
          {TERMINAL.symbols.prompt} LOADING...
        </Text>
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
          onOpenSettings={handleOpenSettings}
          onOpenGenerator={() => handleOpenGenerator()}
        />
      )}

      {currentScreen === 'settings' && (
        <SettingsScreen
          stories={stories}
          onBack={handleBackFromSettings}
          onOpenVisualizer={handleOpenVisualizer}
          onOpenGenerator={handleOpenGenerator}
          onDeleteStory={handleDeleteStory}
          onRenameStory={handleRenameStory}
          onGenerateVideos={handleGenerateVideos}
          generatedStoryIds={Array.from(fileLoadedStoryIds)}
          onRefreshStories={loadStories}
          isRefreshing={isRefreshing}
          videoGeneratingStoryId={videoGeneratingStoryId}
        />
      )}

      {currentScreen === 'generator' && (
        <GeneratorScreen
          onBack={handleBackFromGenerator}
          onStoryGenerated={handleStoryGenerated}
          onPlayStory={handlePlayGeneratedStory}
          onViewLibrary={handleViewLibrary}
          resumeJobId={resumeJobId}
          onCancelExternalPipeline={() => {
            if (videoPipelineRef.current) {
              videoPipelineRef.current.cancel();
              videoPipelineRef.current = null;
            }
          }}
        />
      )}

      {currentScreen === 'visualizer' && visualizerStoryId && visualizerStory && (
        <VisualizerScreen
          story={visualizerStory}
          onBack={handleBackFromVisualizer}
          onJumpToNode={(nodeId) => {
            for (const episode of visualizerStory.episodes) {
              for (const scene of episode.scenes) {
                if (nodeId === `scene-${scene.id}` || nodeId.includes(scene.id)) {
                  let targetBeatId = scene.startingBeatId;
                  for (const beat of scene.beats) {
                    if (nodeId.includes(beat.id)) {
                      targetBeatId = beat.id;
                      break;
                    }
                  }
                  initializeStory(visualizerStory, player.characterName, player.characterPronouns);
                  loadEpisode(episode.id);
                  if (scene.id) {
                    loadScene(scene.id, episode);
                  }
                  if (targetBeatId) {
                    setBeat(targetBeatId);
                  }
                  navigateTo('reading');
                  return;
                }
              }
            }
          }}
        />
      )}

      {currentScreen === 'episodes' && (
        <EpisodeSelectScreen
          onSelectEpisode={handleSelectEpisode}
          onBack={handleBackFromEpisodes}
        />
      )}

      {currentScreen === 'reading' && (
        <ReadingScreen
          onEpisodeComplete={handleEpisodeComplete}
          onPause={handlePause}
        />
      )}

      {currentScreen === 'recap' && recapEpisodeId && (
        <EpisodeRecapScreen
          episodeId={recapEpisodeId}
          onContinue={handleRecapContinue}
          onRewindToBeat={handleRecapRewind}
        />
      )}

      {/* Floating Active Generation Indicator */}
      {activeGenerationJob && currentScreen !== 'generator' && (
        <TouchableOpacity 
          style={styles.activeGenIndicator}
          onPress={() => handleOpenGenerator(activeGenerationJob.id)}
        >
          <View style={styles.activeGenPulse} />
          <View style={styles.activeGenContent}>
            <Text style={styles.activeGenLabel}>GENERATING</Text>
            <Text style={styles.activeGenTitle} numberOfLines={1}>
              {(activeGenerationJob.storyTitle || 'Untitled').toUpperCase()}
            </Text>
            <Text style={styles.activeGenMeta} numberOfLines={1}>
              {(activeGenerationJob.currentPhase || 'PROCESSING').toUpperCase()}
              {typeof activeGenerationJob.etaSeconds === 'number' ? ` • ETA ${Math.max(0, Math.round(activeGenerationJob.etaSeconds))}S` : ''}
            </Text>
            <View style={styles.activeGenProgress}>
              <View style={[styles.activeGenProgressBar, { width: `${activeGenerationJob.progress || 5}%` }]} />
            </View>
          </View>
          <Text style={styles.activeGenArrow}>→</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={showPauseMenu}
        transparent
        animationType="fade"
        onRequestClose={handleResume}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.pauseMenu}>
            <Text style={styles.pauseHeader}>SYSTEM PAUSED</Text>
            <Text style={[styles.pauseTitle, { fontSize: fonts.header }]}>PAUSED</Text>
            {currentEpisode && (
              <Text style={[styles.pauseSubtitle, { fontSize: fonts.small }]}>
                EP.{currentEpisode.number}: {currentEpisode.title.toUpperCase()}
              </Text>
            )}
            <View style={styles.pauseStats}>
              <Text style={styles.statLabel}>USER:</Text>
              <Text style={[styles.statValue, { fontSize: fonts.medium }]}>{player.characterName}</Text>
            </View>
            <TouchableOpacity style={styles.menuButton} onPress={handleResume}>
              <Text style={styles.menuButtonText}>RESUME</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuButton, styles.menuButtonSecondary]}
              onPress={handleQuitToMenu}
            >
              <Text style={styles.menuButtonTextSecondary}>SAVE & EXIT</Text>
            </TouchableOpacity>
            <Text style={styles.pauseFooter}>STORYRPG ENGINE v1.0.0</Text>
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
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#000' }}>
          <Text style={{ color: '#ff0000', fontSize: 18, marginBottom: 10 }}>ERROR</Text>
          <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{this.state.error?.message || 'Unknown error'}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <GameProvider>
          <AppContent />
        </GameProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: TERMINAL.colors.bg },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.9)', justifyContent: 'center', alignItems: 'center' },
  pauseMenu: { backgroundColor: '#1e2229', padding: 30, width: '85%', maxWidth: 400, borderRadius: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  pauseHeader: { color: TERMINAL.colors.primary, fontWeight: '900', letterSpacing: 2, marginBottom: 20, textAlign: 'center' },
  pauseTitle: { fontWeight: '900', color: 'white', marginBottom: 8, textAlign: 'center', letterSpacing: -1 },
  pauseSubtitle: { color: TERMINAL.colors.muted, marginBottom: 24, textAlign: 'center', fontWeight: '700' },
  pauseStats: { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  statLabel: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  statValue: { color: TERMINAL.colors.primary, fontWeight: '900', marginTop: 4 },
  menuButton: { backgroundColor: TERMINAL.colors.primary, paddingVertical: 16, borderRadius: 16, marginBottom: 12 },
  menuButtonSecondary: { backgroundColor: 'rgba(255,255,255,0.05)' },
  menuButtonText: { color: 'white', fontWeight: '900', textAlign: 'center', letterSpacing: 1 },
  menuButtonTextSecondary: { color: TERMINAL.colors.muted, textAlign: 'center', fontWeight: '900', letterSpacing: 1 },
  pauseFooter: { color: TERMINAL.colors.muted, marginTop: 12, textAlign: 'center', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  // Active generation floating indicator
  activeGenIndicator: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: '#1e2229',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: TERMINAL.colors.amber,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: TERMINAL.colors.amber,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  activeGenPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: TERMINAL.colors.amber,
    marginRight: 12,
  },
  activeGenContent: {
    flex: 1,
  },
  activeGenLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.amber,
    letterSpacing: 1,
    marginBottom: 2,
  },
  activeGenTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  activeGenMeta: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  activeGenProgress: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  activeGenProgressBar: {
    height: '100%',
    backgroundColor: TERMINAL.colors.amber,
    borderRadius: 2,
  },
  activeGenArrow: {
    fontSize: 18,
    fontWeight: '900',
    color: TERMINAL.colors.amber,
    marginLeft: 12,
  },
});
