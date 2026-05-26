import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Alert, View, StyleSheet, Modal, Text, TouchableOpacity, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameProvider, useGameActions, useGamePlayerState, useGameStoryState } from './src/stores/gameStore';
import { SettingsProvider, useSettingsStore } from './src/stores/settingsStore';
import { useGenerationJobStore } from './src/stores/generationJobStore';
import { getVisibleGenerationJobs } from './src/types/generationJob';
import { seasonPlanStore } from './src/stores/seasonPlanStore';
import {
  HomeScreen,
  EpisodeSelectScreen,
  ReadingScreen,
  VisualizerScreen,
  SettingsScreen,
  LoginScreen,
} from './src/screens';
import { GeneratorScreen } from './src/screens/GeneratorScreen';
import { allStories as builtInStories } from './src/data/stories';
import { MediaSetupTarget, PlayerState, Story, StoryCatalogEntry } from './src/types';
import { TERMINAL } from './src/theme';
import { PROXY_CONFIG } from './src/config/endpoints';
import {
  pipelineClient,
  type PipelineHandle,
} from './src/ai-agents/pipeline/PipelineClient';
import { encodeStory } from './src/story-codec/storyCodec';
import { loadConfig } from './src/ai-agents/config';
import type { PipelineConfig } from './src/ai-agents/config';
import { useVideoJobStore } from './src/stores/videoJobStore';
import { useStoryLibrary } from './src/hooks/useStoryLibrary';
import { GENERATOR_STORAGE_KEYS } from './src/hooks/useGeneratorSettings';
import { fetchStoryByCatalogEntry } from './src/services/storyLibrary';
import { useGeneratorRunner } from './src/hooks/useGeneratorRunner';
import { useAppNavigationStore } from './src/stores/appNavigationStore';
import { getNextPlayableEpisode } from './src/engine/storyEngine';
import {
  captureAttributionFromUrl,
  identifyAnonymousPlayer,
  incrementPersonProperty,
  initAnalytics,
  screen as trackScreen,
  setSuperProperties,
  track,
} from './src/services/analyticsService';
import { fetchAuthMe, type AuthUser } from './src/services/authSession';
import {
  clearSignedOutLatch,
  installWebAuthHistoryGuards,
  isSignedOutLatchActive,
  markSignedOutLatch,
  markWebHistoryAuthenticated,
  sealWebHistoryAfterLogout,
} from './src/utils/webAuthHistory';

const GENERATED_STORIES_KEY = '@storyrpg_generated_stories';
const DELETED_STORIES_KEY = '@storyrpg_deleted_stories'; // Track intentionally deleted stories

type SeasonContinuation = {
  planId: string;
  nextEpisodeNumber: number;
  totalEpisodes: number;
};

const getMediaSetupTargetKey = (target: Pick<MediaSetupTarget, 'kind' | 'storyId' | 'episodeNumber'>) =>
  `${target.kind}:${target.storyId}:episode-${target.episodeNumber}`;

const normalizeContinuationKey = (value?: string | null) => {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/\/+$/, '');
};

type PersistedGeneratorSettings = {
  imageProvider?: string;
  imageStrategy?: 'selective' | 'all-beats';
  artStyle?: string;
  generationSettings?: {
    panelMode?: 'single' | 'special-beats' | 'all-beats';
    storyboardMaxPanelsPerSheet?: number;
  };
  geminiSettings?: PipelineConfig['imageGen'] extends infer T ? T extends { gemini?: infer G } ? G : never : never;
  openaiSettings?: {
    imageModel?: string;
    imageModeration?: 'auto' | 'low';
  };
  midjourneySettings?: PipelineConfig['imageGen'] extends infer T ? T extends { midjourney?: infer M } ? M : never : never;
  stableDiffusionSettings?: PipelineConfig['imageGen'] extends infer T ? T extends { stableDiffusion?: infer S } ? S : never : never;
  loraTrainingSettings?: PipelineConfig['imageGen'] extends infer T ? T extends { loraTraining?: infer L } ? L : never : never;
  atlasCloudModel?: string;
};

const normalizeImageProviderForPipeline = (provider?: string) => {
  if (provider === 'useapi') return 'midapi';
  if (provider === 'scenario-gg') return 'atlas-cloud';
  return provider;
};

async function loadImageOnlyPipelineConfigFromSavedSettings(): Promise<PipelineConfig> {
  const config = loadConfig();
  let saved: PersistedGeneratorSettings = {};
  try {
    const response = await fetch(PROXY_CONFIG.generatorSettings);
    if (response.ok) {
      saved = await response.json();
    }
  } catch (error) {
    console.warn('[App] Failed to load generator settings for image-only run; falling back to env config:', error);
  }

  const entries = await AsyncStorage.multiGet([
    GENERATOR_STORAGE_KEYS.openaiApiKey,
    GENERATOR_STORAGE_KEYS.geminiApiKey,
    GENERATOR_STORAGE_KEYS.atlasCloudApiKey,
    GENERATOR_STORAGE_KEYS.midapiToken,
  ]);
  const stored = Object.fromEntries(entries);
  const provider = normalizeImageProviderForPipeline(saved.imageProvider) as NonNullable<PipelineConfig['imageGen']>['provider'] | undefined;

  config.imageGen = {
    ...(config.imageGen || {}),
    enabled: true,
    provider: provider || config.imageGen?.provider,
    strategy: saved.imageStrategy || config.imageGen?.strategy,
    geminiApiKey: stored[GENERATOR_STORAGE_KEYS.geminiApiKey] || config.imageGen?.geminiApiKey || config.imageGen?.apiKey,
    apiKey: stored[GENERATOR_STORAGE_KEYS.geminiApiKey] || config.imageGen?.apiKey,
    openaiApiKey: stored[GENERATOR_STORAGE_KEYS.openaiApiKey] || config.imageGen?.openaiApiKey,
    atlasCloudApiKey: stored[GENERATOR_STORAGE_KEYS.atlasCloudApiKey] || config.imageGen?.atlasCloudApiKey,
    atlasCloudModel: saved.atlasCloudModel || config.imageGen?.atlasCloudModel,
    midapiToken: stored[GENERATOR_STORAGE_KEYS.midapiToken] || config.imageGen?.midapiToken,
    openaiImageModel: saved.openaiSettings?.imageModel || config.imageGen?.openaiImageModel,
    openaiModeration: saved.openaiSettings?.imageModeration || config.imageGen?.openaiModeration,
    gemini: saved.geminiSettings ? { ...(config.imageGen?.gemini || {}), ...(saved.geminiSettings as any) } : config.imageGen?.gemini,
    midjourney: saved.midjourneySettings ? { ...(config.imageGen?.midjourney || {}), ...(saved.midjourneySettings as any) } : config.imageGen?.midjourney,
    stableDiffusion: saved.stableDiffusionSettings ? { ...(config.imageGen?.stableDiffusion || {}), ...(saved.stableDiffusionSettings as any) } : config.imageGen?.stableDiffusion,
    loraTraining: saved.loraTrainingSettings ? { ...(config.imageGen?.loraTraining || {}), ...(saved.loraTrainingSettings as any) } : config.imageGen?.loraTraining,
    panelMode: saved.generationSettings?.panelMode || config.imageGen?.panelMode,
    storyboardV2: {
      ...(config.imageGen?.storyboardV2 || {}),
      maxPanelsPerSheet: saved.generationSettings?.storyboardMaxPanelsPerSheet || config.imageGen?.storyboardV2?.maxPanelsPerSheet,
    },
  };
  if (saved.artStyle !== undefined) {
    config.artStyle = saved.artStyle || config.artStyle;
  }
  return config;
}

const isSeasonEpisodeGenerated = (episode?: {
  status?: string;
  generatedEpisodeId?: string;
  generatedStoryId?: string;
  generatedJobId?: string;
  outputDir?: string;
}) => Boolean(
  episode
  && (
    episode.status === 'completed'
    || episode.generatedEpisodeId
    || episode.generatedStoryId
    || episode.generatedJobId
    || episode.outputDir
  )
);

function AppContent() {
  // Protagonist name/pronouns come from the story's established characters
  const [videoGeneratingStoryId, setVideoGeneratingStoryId] = useState<string | null>(null);
  const [imageGeneratingStoryId, setImageGeneratingStoryId] = useState<string | null>(null);
  const videoPipelineRef = useRef<PipelineHandle | null>(null);
  const [visualizerStory, setVisualizerStory] = useState<Story | null>(null);
  /** undefined = checking session; null = signed out; AuthUser = signed in */
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(() => {
    if (Platform.OS === 'web' && isSignedOutLatchActive()) return null;
    return undefined;
  });
  const currentScreen = useAppNavigationStore((state) => state.currentScreen);
  const showPauseMenu = useAppNavigationStore((state) => state.showPauseMenu);
  const visualizerStoryId = useAppNavigationStore((state) => state.visualizerStoryId);
  const resumeJobId = useAppNavigationStore((state) => state.resumeJobId);
  const generatorSeasonPlanId = useAppNavigationStore((state) => state.generatorSeasonPlanId);
  const navigateTo = useAppNavigationStore((state) => state.navigateTo);
  const openPauseMenu = useAppNavigationStore((state) => state.openPauseMenu);
  const closePauseMenu = useAppNavigationStore((state) => state.closePauseMenu);
  const openVisualizerRoute = useAppNavigationStore((state) => state.openVisualizer);
  const closeVisualizerRoute = useAppNavigationStore((state) => state.closeVisualizer);
  const openGeneratorRoute = useAppNavigationStore((state) => state.openGenerator);
  const closeGeneratorRoute = useAppNavigationStore((state) => state.closeGenerator);
  const resetNavigationAfterLogout = useAppNavigationStore((state) => state.resetAfterLogout);

  const refreshAuthSession = useCallback(async () => {
    if (Platform.OS === 'web' && isSignedOutLatchActive()) {
      resetNavigationAfterLogout();
      setAuthUser(null);
      return null;
    }
    try {
      const me = await fetchAuthMe();
      if (me.user) {
        if (Platform.OS === 'web') {
          clearSignedOutLatch();
          markWebHistoryAuthenticated();
        }
        setAuthUser(me.user);
      } else {
        resetNavigationAfterLogout();
        setAuthUser(null);
      }
      return me.user;
    } catch (err) {
      console.warn('[App] Auth session check failed:', err);
      resetNavigationAfterLogout();
      setAuthUser(null);
      return null;
    }
  }, [resetNavigationAfterLogout]);

  const handleHistoryNavigation = useCallback(() => {
    resetNavigationAfterLogout();
    if (Platform.OS === 'web' && isSignedOutLatchActive()) {
      setAuthUser(null);
      return;
    }
    setAuthUser(undefined);
    void refreshAuthSession();
  }, [resetNavigationAfterLogout, refreshAuthSession]);

  useEffect(() => {
    refreshAuthSession();
  }, [refreshAuthSession]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    return installWebAuthHistoryGuards({
      onNavigate: handleHistoryNavigation,
    });
  }, [handleHistoryNavigation]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const afterOAuth = url.searchParams.get('afterAuth') === 'home';
    const authError = url.searchParams.has('auth');
    if (!afterOAuth && !authError) return;
    url.searchParams.delete('afterAuth');
    url.searchParams.delete('auth');
    const qs = url.searchParams.toString();
    const next = `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
    window.history.replaceState({}, document.title, next);
    refreshAuthSession().then((user) => {
      if (user) {
        navigateTo('home');
      }
    });
  }, [navigateTo, refreshAuthSession]);

  const handleAuthenticated = useCallback(
    (user: AuthUser) => {
      if (Platform.OS === 'web') {
        clearSignedOutLatch();
        markWebHistoryAuthenticated();
      }
      setAuthUser(user);
      navigateTo('home');
    },
    [navigateTo],
  );

  const handleSignedOut = useCallback(() => {
    resetNavigationAfterLogout();
    setAuthUser(null);
    if (Platform.OS === 'web') {
      markSignedOutLatch();
      sealWebHistoryAfterLogout();
    }
  }, [resetNavigationAfterLogout]);
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
  const { player } = useGamePlayerState();
  const { currentStory, currentEpisode } = useGameStoryState();
  const { initializeStory, updateCurrentStory, loadEpisode, loadScene, setBeat } = useGameActions();
  const { ensureProxyAvailable, runWorkerJob } = useGeneratorRunner();
  
  // Generation job store for the floating indicator
  const { jobs, loadJobs, registerJob: registerGenJob, updateJob: updateGenJob, addJobEvent } = useGenerationJobStore();
  const activeGenerationJob = getVisibleGenerationJobs(jobs).find(j => j.status === 'running' || j.status === 'pending');
  const [seasonContinuations, setSeasonContinuations] = useState<Record<string, SeasonContinuation>>({});

  // Video job store for live preview
  const { addJob: addVideoJob, updateJob: updateVideoJob, removeJob: removeVideoJob, clearJobs: clearVideoJobs } = useVideoJobStore();

  useEffect(() => {
    loadJobs(); // Load generation jobs on app start
    initAnalytics();
    identifyAnonymousPlayer();
    captureAttributionFromUrl();
    track('app opened');
    
    seasonPlanStore.initialize().catch(err => {
      console.warn('[App] Failed to initialize season plan store:', err);
    });
  }, [loadJobs]);

  useEffect(() => {
    const rebuildSeasonContinuations = () => {
      const next: Record<string, SeasonContinuation> = {};
      const addContinuationKey = (key: string | null | undefined, continuation: SeasonContinuation) => {
        const normalized = normalizeContinuationKey(key);
        if (normalized) next[normalized] = continuation;
      };

      for (const saved of seasonPlanStore.getPlans()) {
        const nextEpisode = saved.plan.episodes
          .filter((episode) => !isSeasonEpisodeGenerated(episode))
          .sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
        if (!nextEpisode) continue;

        const continuation = {
          planId: saved.plan.id,
          nextEpisodeNumber: nextEpisode.episodeNumber,
          totalEpisodes: saved.plan.totalEpisodes,
        };

        addContinuationKey(saved.plan.id, continuation);
        addContinuationKey(saved.plan.sourceTitle, continuation);
        addContinuationKey(saved.plan.seasonTitle, continuation);
        addContinuationKey(saved.sourceAnalysis?.sourceTitle, continuation);

        for (const episode of saved.plan.episodes) {
          addContinuationKey(episode.generatedStoryId, continuation);
          addContinuationKey(episode.outputDir, continuation);
          addContinuationKey(episode.outputDir?.split('/').filter(Boolean).pop(), continuation);
        }
      }
      setSeasonContinuations(next);
    };

    seasonPlanStore.initialize()
      .then(rebuildSeasonContinuations)
      .catch((err) => console.warn('[App] Failed to load season continuations:', err));

    return seasonPlanStore.subscribe(rebuildSeasonContinuations);
  }, []);

  useEffect(() => {
    trackScreen(currentScreen, {
      has_current_story: Boolean(currentStory?.id),
      current_story_id: currentStory?.id,
      current_episode_id: currentEpisode?.id,
    });
  }, [currentScreen, currentStory?.id, currentEpisode?.id]);

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
    const catalogStory = stories.find((story) => story.id === storyId);
    track('story selected', {
      story_id: storyId,
      story_genre: catalogStory?.genre,
      episode_count: catalogStory?.episodeCount,
      is_generated_story: catalogStory?.isBuiltIn === false || Boolean(catalogStory?.outputDir),
    });

    const story = await loadFullStory(storyId);
    if (!story) return;

    // Use an actual character name; never derive the player name from story title text.
    const protagonist = resolveProtagonist(story);
    initializeStory(story, protagonist.name, protagonist.pronouns);
    setSuperProperties({
      last_story_id: story.id,
      last_story_genre: story.genre,
    });
    incrementPersonProperty('stories_started_count');
    track('story started', {
      story_id: story.id,
      story_genre: story.genre,
      episode_count: story.episodes.length,
      is_generated_story: Boolean(story.outputDir),
    });
    navigateTo('episodes');
  };

  const handleContinueStory = () => {
    track('continue story clicked', {
      story_id: currentStory?.id,
      story_genre: currentStory?.genre,
      episode_id: currentEpisode?.id,
    });
    navigateTo('episodes');
  };

  const handleSelectEpisode = (episodeId: string) => {
    const episode = currentStory?.episodes.find((e) => e.id === episodeId);
    if (!episode) return;

    setSuperProperties({
      last_story_id: currentStory?.id,
      last_story_genre: currentStory?.genre,
      last_episode_id: episode.id,
    });
    track('episode selected', {
      story_id: currentStory?.id,
      story_genre: currentStory?.genre,
      episode_id: episode.id,
      episode_number: episode.number,
      scene_count: episode.scenes.length,
      beat_count: episode.scenes.reduce((sum, scene) => sum + scene.beats.length, 0),
      is_completed: player.completedEpisodes.includes(episode.id),
    });
    loadEpisode(episodeId);
    if (episode.startingSceneId) {
      loadScene(episode.startingSceneId, episode);
    }
    track('episode started', {
      story_id: currentStory?.id,
      story_genre: currentStory?.genre,
      episode_id: episode.id,
      episode_number: episode.number,
    });
    navigateTo('reading');
  };

  const handleEpisodeComplete = () => {
    if (currentEpisode?.id) {
      incrementPersonProperty('episodes_completed_count');
    }

    const isSceneEpisodeStory = currentStory?.episodes.some(
      episode => episode.episodeStructureMode === 'sceneEpisodes' || episode.routeMeta
    );
    if (isSceneEpisodeStory && currentStory && currentEpisode) {
      const completedEpisodes = player.completedEpisodes.includes(currentEpisode.id)
        ? player.completedEpisodes
        : [...player.completedEpisodes, currentEpisode.id];
      const nextEpisode = getNextPlayableEpisode(
        currentStory,
        currentEpisode.id,
        { ...player, completedEpisodes }
      );

      if (nextEpisode) {
        loadEpisode(nextEpisode.id);
        if (nextEpisode.startingSceneId) {
          loadScene(nextEpisode.startingSceneId, nextEpisode);
        }
        navigateTo('reading');
        return;
      }
    }

    navigateTo('episodes');
  };

  const handlePause = () => {
    track('pause menu opened', {
      story_id: currentStory?.id,
      story_genre: currentStory?.genre,
      episode_id: currentEpisode?.id,
    });
    openPauseMenu();
  };

  const handleResume = () => {
    track('pause menu resumed', {
      story_id: currentStory?.id,
      story_genre: currentStory?.genre,
      episode_id: currentEpisode?.id,
    });
    closePauseMenu();
  };

  const handleQuitToMenu = () => {
    track('quit to menu clicked', {
      story_id: currentStory?.id,
      story_genre: currentStory?.genre,
      episode_id: currentEpisode?.id,
    });
    closePauseMenu();
    navigateTo('home');
  };

  const handleBackFromEpisodes = () => {
    navigateTo('home');
  };

  const handleOpenSettings = () => {
    track('settings opened');
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

  const handleVisualizerStoryUpdated = useCallback((story: Story) => {
    setVisualizerStory(story);
    upsertStory(story);
    if (currentStory?.id === story.id) {
      updateCurrentStory(story);
    }
  }, [currentStory?.id, updateCurrentStory, upsertStory]);

  const handleOpenGenerator = (jobId?: string) => {
    track('generator opened', {
      resume_job: Boolean(jobId),
    });
    openGeneratorRoute(jobId);
  };

  const handleContinueSeasonPlan = async (planId: string) => {
    await seasonPlanStore.setActivePlan(planId);
    track('season continuation opened', { plan_id: planId });
    openGeneratorRoute(undefined, undefined, planId);
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
    setSuperProperties({
      last_story_id: target.id,
      last_story_genre: target.genre,
    });
    incrementPersonProperty('stories_started_count');
    track('story started', {
      story_id: target.id,
      story_genre: target.genre,
      episode_count: target.episodes.length,
      is_generated_story: true,
      start_source: 'generator',
    });
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

  const handleStoryArtifactsChanged = useCallback(async (storyEntry: StoryCatalogEntry) => {
    await loadStories();
    const freshStory = await fetchStoryByCatalogEntry(storyEntry, builtInStories);
    if (!freshStory) return;
    upsertStory(freshStory);
    if (currentStory?.id === freshStory.id) {
      updateCurrentStory(freshStory);
    }
  }, [builtInStories, currentStory?.id, loadStories, updateCurrentStory, upsertStory]);

  const handleGenerateVideos = useCallback(async (target: MediaSetupTarget) => {
    if (videoGeneratingStoryId) return;
    const story = await loadFullStory(target.storyId);
    if (!story) return;

    const jobId = `vidgen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const targetKey = getMediaSetupTargetKey(target);
    setVideoGeneratingStoryId(targetKey);
    clearVideoJobs();

    await registerGenJob({
      id: jobId,
      storyTitle: `VIDEO: ${story.title || 'Untitled'} · Episode ${target.episodeNumber}`,
      startedAt: new Date().toISOString(),
      status: 'running',
      currentPhase: 'video_generation',
      progress: 0,
      episodeCount: 1,
      currentEpisode: target.episodeNumber,
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

      const result = await rawPipeline.runVideoOnly(story, {
        targetEpisodeNumber: target.episodeNumber,
      });

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

  const handleGenerateImages = useCallback(async (target: MediaSetupTarget) => {
    if (imageGeneratingStoryId) return;
    const storyEntry = stories.find((candidate) => candidate.id === target.storyId);
    const outputDir = target.outputDir || storyEntry?.outputDir;
    if (!outputDir) {
      Alert.alert('Missing Output Directory', 'This story does not have a saved draft directory for image generation.');
      return;
    }
    const proxyAvailable = await ensureProxyAvailable();
    if (!proxyAvailable) {
      Alert.alert('Backend Unavailable', 'Proxy server is not reachable at http://localhost:3001.');
      return;
    }

    const jobTitle = `${storyEntry?.title || 'Story'} Episode ${target.episodeNumber} Images`;
    let workerJobId: string | null = null;
    const targetKey = getMediaSetupTargetKey(target);
    setImageGeneratingStoryId(targetKey);

    try {
      const config = await loadImageOnlyPipelineConfigFromSavedSettings();
      config.generation = {
        ...(config.generation || {}),
        assetGenerationMode: 'image-only',
      };
      config.imageGen = {
        ...(config.imageGen || {}),
        enabled: true,
      };

      const worker = await runWorkerJob<any>(
        {
          mode: 'image-generation',
          payload: {
            config: config as unknown as Record<string, unknown>,
            imageGenerationInput: {
              outputDirectory: outputDir,
              targetEpisodeNumber: target.episodeNumber,
            },
          } as any,
          idempotencyKey: `image-generation:${outputDir}:episode-${target.episodeNumber}`,
          storyTitle: jobTitle,
          episodeCount: 1,
        },
        (event) => {
          if (!workerJobId) return;
          addJobEvent(workerJobId, {
            type: event.type,
            phase: event.phase,
            agent: event.agent,
            message: event.message,
            timestamp: new Date().toISOString(),
          });
        },
        (statusData) => {
          if (!workerJobId) return;
          updateGenJob(workerJobId, {
            status: (statusData?.status as any) || 'running',
            currentPhase: statusData?.currentPhase || 'images',
            progress: Math.max(0, Math.min(100, Number(statusData?.progress ?? 0))),
            currentEpisode: Number(statusData?.currentEpisode || target.episodeNumber),
            episodeCount: Number(statusData?.episodeCount || 1),
          });
        },
        async (jobId) => {
          workerJobId = jobId;
          await registerGenJob({
            id: jobId,
            storyTitle: jobTitle,
            startedAt: new Date().toISOString(),
            status: 'running',
            currentPhase: 'queued',
            progress: 0,
            episodeCount: 1,
            currentEpisode: target.episodeNumber,
            outputDir,
            events: [],
          });
          openGeneratorRoute(jobId);
        },
      );

      if (!worker.result?.success) {
        throw new Error(worker.result?.error || 'Image generation failed');
      }
      if (worker.result?.story) {
        upsertStory(worker.result.story);
      } else {
        await loadStories();
      }
      if (workerJobId) {
        await updateGenJob(workerJobId, {
          status: 'completed',
          progress: 100,
          currentPhase: 'complete',
          outputDir: worker.result?.outputDirectory || outputDir,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[App] Image generation failed:', errMsg);
      if (workerJobId) {
        await updateGenJob(workerJobId, {
          status: 'failed',
          error: errMsg,
        });
      }
      Alert.alert('Image Generation Failed', errMsg);
    } finally {
      setImageGeneratingStoryId(null);
    }
  }, [
    imageGeneratingStoryId,
    stories,
    ensureProxyAvailable,
    runWorkerJob,
    addJobEvent,
    updateGenJob,
    registerGenJob,
    openGeneratorRoute,
    upsertStory,
    loadStories,
  ]);

  const signedOutLatch = Platform.OS === 'web' && isSignedOutLatchActive();
  const showAppShell = !signedOutLatch && authUser != null;

  if ((!signedOutLatch && authUser === undefined) || !storiesLoaded) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style="light" />
        <Text style={{ color: TERMINAL.colors.primary, fontSize: fonts.medium }}>
          {TERMINAL.symbols.prompt} LOADING...
        </Text>
      </View>
    );
  }

  if (!showAppShell) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <LoginScreen onAuthenticated={handleAuthenticated} />
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
          activeGenerationJob={activeGenerationJob}
          onOpenActiveGeneration={(jobId) => handleOpenGenerator(jobId)}
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
          onGenerateImages={handleGenerateImages}
          onContinueSeasonPlan={handleContinueSeasonPlan}
          seasonContinuations={seasonContinuations}
          generatedStoryIds={Array.from(fileLoadedStoryIds)}
          onRefreshStories={loadStories}
          onStoryArtifactsChanged={handleStoryArtifactsChanged}
          isRefreshing={isRefreshing}
          videoGeneratingStoryId={videoGeneratingStoryId}
          imageGeneratingStoryId={imageGeneratingStoryId}
        />
      )}

      {currentScreen === 'generator' && (
        <GeneratorScreen
          onBack={handleBackFromGenerator}
          onStoryGenerated={handleStoryGenerated}
          onPlayStory={handlePlayGeneratedStory}
          onViewLibrary={handleViewLibrary}
          resumeJobId={resumeJobId}
          initialSeasonPlanId={generatorSeasonPlanId}
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
          onStoryUpdated={handleVisualizerStoryUpdated}
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
});
