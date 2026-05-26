import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { GameProvider, useGameActions, useGameStoryState } from '../../src/stores/gameStore';
import { GeneratorSettingsProvider } from '../../src/stores/generatorSettingsStore';
import { SettingsProvider, useSettingsStore } from '../../src/stores/settingsStore';
import { useGenerationJobStore } from '../../src/stores/generationJobStore';
import { useVideoJobStore } from '../../src/stores/videoJobStore';
import { seasonPlanStore } from '../../src/stores/seasonPlanStore';
import { GeneratorScreen } from '../../src/screens/GeneratorScreen';
import { LoginScreen, SettingsScreen, VisualizerScreen } from '../../src/screens';
import { allStories as builtInStories } from '../../src/data/stories';
import type { MediaSetupTarget, Story, StoryCatalogEntry } from '../../src/types';
import { TERMINAL } from '../../src/theme';
import { PROXY_CONFIG } from '../../src/config/endpoints';
import { pipelineClient, type PipelineHandle } from '../../src/ai-agents/pipeline/PipelineClient';
import { loadConfig, type PipelineConfig } from '../../src/ai-agents/config';
import { GENERATOR_STORAGE_KEYS } from '../../src/hooks/useGeneratorSettings';
import { useStoryLibrary } from '../../src/hooks/useStoryLibrary';
import { useAuthSession } from '../../src/hooks/useAuthSession';
import { useGeneratorRunner } from '../../src/hooks/useGeneratorRunner';
import type { AuthUser } from '../../src/services/authSession';
import { fetchStoryByCatalogEntry } from '../../src/services/storyLibrary';
import {
  captureAttributionFromUrl,
  identifyAnonymousPlayer,
  initAnalytics,
  screen as trackScreen,
  track,
} from '../../src/services/analyticsService';

type GeneratorRoute = 'home' | 'generator' | 'visualizer';
type GeneratorSetupView = 'story' | 'image' | 'video';

type SeasonContinuation = {
  planId: string;
  nextEpisodeNumber: number;
  totalEpisodes: number;
};

type PersistedGeneratorSettings = {
  llmProvider?: string;
  llmModel?: string;
  imageLlmProvider?: string;
  imageLlmModel?: string;
  videoLlmProvider?: string;
  videoLlmModel?: string;
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
  videoSettings?: PipelineConfig['videoGen'];
};

const normalizeContinuationKey = (value?: string | null) => {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/\/+$/, '');
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
    console.warn('[GeneratorApp] Failed to load generator settings for image-only run; falling back to env config:', error);
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

async function loadVideoOnlyPipelineConfigFromSavedSettings(): Promise<PipelineConfig> {
  const config = loadConfig();
  let saved: PersistedGeneratorSettings = {};
  try {
    const response = await fetch(PROXY_CONFIG.generatorSettings);
    if (response.ok) {
      saved = await response.json();
    }
  } catch (error) {
    console.warn('[GeneratorApp] Failed to load generator settings for video-only run; falling back to env config:', error);
  }

  const entries = await AsyncStorage.multiGet([
    GENERATOR_STORAGE_KEYS.anthropicApiKey,
    GENERATOR_STORAGE_KEYS.openaiApiKey,
    GENERATOR_STORAGE_KEYS.llmGeminiApiKey,
    GENERATOR_STORAGE_KEYS.geminiApiKey,
  ]);
  const stored = Object.fromEntries(entries);
  const selectedVideoProvider = saved.videoLlmProvider || config.agents?.videoDirector?.provider || config.agents?.storyArchitect?.provider;
  const selectedVideoModel = saved.videoLlmModel || config.agents?.videoDirector?.model || config.agents?.storyArchitect?.model;

  config.videoGen = {
    ...(config.videoGen || {}),
    ...(saved.videoSettings || {}),
    enabled: true,
  };
  config.agents = {
    ...(config.agents || {}),
    videoDirector: {
      ...(config.agents?.videoDirector || config.agents?.storyArchitect || {}),
      provider: selectedVideoProvider,
      model: selectedVideoModel,
      apiKey:
        selectedVideoProvider === 'openai'
          ? stored[GENERATOR_STORAGE_KEYS.openaiApiKey] || config.agents?.videoDirector?.apiKey || config.agents?.storyArchitect?.apiKey
          : selectedVideoProvider === 'gemini'
            ? stored[GENERATOR_STORAGE_KEYS.llmGeminiApiKey] || stored[GENERATOR_STORAGE_KEYS.geminiApiKey] || config.agents?.videoDirector?.apiKey || config.agents?.storyArchitect?.apiKey
            : stored[GENERATOR_STORAGE_KEYS.anthropicApiKey] || config.agents?.videoDirector?.apiKey || config.agents?.storyArchitect?.apiKey,
    },
  } as PipelineConfig['agents'];
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

function GeneratorAppContent() {
  const [route, setRoute] = useState<GeneratorRoute>('home');
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
      setRoute('home');
    },
  });
  const [resumeJobId, setResumeJobId] = useState<string | undefined>();
  const [generatorSeasonPlanId, setGeneratorSeasonPlanId] = useState<string | undefined>();
  const [generatorSetupView, setGeneratorSetupView] = useState<GeneratorSetupView>('story');
  const [mediaSetupTarget, setMediaSetupTarget] = useState<MediaSetupTarget | undefined>();
  const [visualizerStory, setVisualizerStory] = useState<Story | null>(null);
  const [videoGeneratingStoryId, setVideoGeneratingStoryId] = useState<string | null>(null);
  const [imageGeneratingStoryId, setImageGeneratingStoryId] = useState<string | null>(null);
  const [seasonContinuations, setSeasonContinuations] = useState<Record<string, SeasonContinuation>>({});
  const videoPipelineRef = useRef<PipelineHandle | null>(null);

  const {
    stories,
    setStories,
    storiesLoaded,
    fileLoadedStoryIds,
    setDeletedStoryIds,
    isRefreshing,
    loadStories,
    loadFullStory,
    upsertStory,
    removeStory,
  } = useStoryLibrary(builtInStories);
  const { currentStory } = useGameStoryState();
  const { updateCurrentStory } = useGameActions();
  const { ensureProxyAvailable, runWorkerJob } = useGeneratorRunner();
  const {
    registerJob: registerGenJob,
    updateJob: updateGenJob,
    addJobEvent,
    loadJobs,
  } = useGenerationJobStore();
  const {
    addJob: addVideoJob,
    updateJob: updateVideoJob,
    removeJob: removeVideoJob,
    clearJobs: clearVideoJobs,
  } = useVideoJobStore();
  const fonts = useSettingsStore((state) => state.getFontSizes());

  const onAuthenticated = useCallback(
    (user: AuthUser) => {
      handleAuthenticated(user);
      setRoute('home');
    },
    [handleAuthenticated],
  );

  const onSignOut = useCallback(async () => {
    setIsSigningOut(true);
    setResumeJobId(undefined);
    setGeneratorSeasonPlanId(undefined);
    setGeneratorSetupView('story');
    setMediaSetupTarget(undefined);
    setVisualizerStory(null);
    try {
      await handleSignedOut();
    } finally {
      setIsSigningOut(false);
      setRoute('home');
    }
  }, [handleSignedOut]);

  useEffect(() => {
    initAnalytics();
    identifyAnonymousPlayer();
    captureAttributionFromUrl();
    track('generator app opened');
    loadJobs();
    seasonPlanStore.initialize().catch((err) => {
      console.warn('[GeneratorApp] Failed to initialize season plan store:', err);
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
      .catch((err) => console.warn('[GeneratorApp] Failed to load season continuations:', err));

    return seasonPlanStore.subscribe(rebuildSeasonContinuations);
  }, []);

  useEffect(() => {
    trackScreen(route, { app_target: 'generator' });
  }, [route]);

  const getMediaTargetKey = useCallback((target: MediaSetupTarget) => (
    `${target.storyId}:${target.episodeNumber}`
  ), []);

  const openGenerator = useCallback((
    jobId?: string,
    seasonPlanId?: string,
    setupView: GeneratorSetupView = 'story',
    target?: MediaSetupTarget,
  ) => {
    setResumeJobId(jobId);
    setGeneratorSeasonPlanId(seasonPlanId);
    setGeneratorSetupView(jobId || seasonPlanId ? 'story' : setupView);
    setMediaSetupTarget(jobId || seasonPlanId ? undefined : target);
    setRoute('generator');
  }, []);

  const handleOpenVisualizer = useCallback(async (storyId: string) => {
    const story = await loadFullStory(storyId);
    if (!story) return;
    setVisualizerStory(story);
    setRoute('visualizer');
  }, [loadFullStory]);

  const handleDeleteStory = useCallback(async (storyId: string) => {
    if (Platform.OS === 'web') {
      try {
        const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/delete-story/${encodeURIComponent(storyId)}`, {
          method: 'DELETE',
        });
        const result = await response.json();
        console.log(`[GeneratorApp] Delete story ${storyId}: ${result.deleted > 0 ? 'success' : 'not found'}`);
      } catch (err) {
        console.error('[GeneratorApp] Failed to delete story files:', err);
      }
    }

    removeStory(storyId);
    setDeletedStoryIds((prev) => {
      const next = new Set(prev);
      next.add(storyId);
      const deletedIds = [...next];
      if (Platform.OS === 'web') {
        fetch(`${PROXY_CONFIG.getProxyUrl()}/deleted-stories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deletedIds }),
        }).catch((err) => {
          console.warn('[GeneratorApp] Failed to save deleted stories to filesystem:', err);
        });
      }
      AsyncStorage.setItem('@storyrpg_deleted_stories', JSON.stringify(deletedIds)).catch((err) => {
        console.warn('[GeneratorApp] Failed to save deleted stories to AsyncStorage:', err);
      });
      return next;
    });
  }, [removeStory, setDeletedStoryIds]);

  const handleRenameStory = useCallback(async (storyId: string, newTitle: string) => {
    const story = stories.find((candidate) => candidate.id === storyId);
    if (!story) return;
    const oldOutputDir = story.outputDir || '';
    setStories((prev) => prev.map((candidate) => (
      candidate.id === storyId ? { ...candidate, title: newTitle } : candidate
    )));
    const success = await pipelineClient.renameStory(storyId, oldOutputDir, newTitle);
    if (!success) {
      console.warn('[GeneratorApp] Failed to rename story on backend');
    } else if (Platform.OS === 'web') {
      loadStories();
    }
  }, [loadStories, setStories, stories]);

  const handleContinueSeasonPlan = useCallback(async (planId: string) => {
    await seasonPlanStore.setActivePlan(planId);
    track('season continuation opened', { plan_id: planId });
    openGenerator(undefined, planId);
  }, [openGenerator]);

  const handleStoryArtifactsChanged = useCallback(async (storyEntry: StoryCatalogEntry) => {
    await loadStories();
    const freshStory = await fetchStoryByCatalogEntry(storyEntry, builtInStories);
    if (!freshStory) return;
    upsertStory(freshStory);
    if (currentStory?.id === freshStory.id) {
      updateCurrentStory(freshStory);
    }
  }, [currentStory?.id, loadStories, updateCurrentStory, upsertStory]);

  const handleOpenImageSetup = useCallback((target: MediaSetupTarget) => {
    openGenerator(undefined, undefined, 'image', target);
  }, [openGenerator]);

  const handleOpenVideoSetup = useCallback((target: MediaSetupTarget) => {
    openGenerator(undefined, undefined, 'video', target);
  }, [openGenerator]);

  const handleGenerateVideos = useCallback(async (target: MediaSetupTarget) => {
    if (videoGeneratingStoryId) return;
    const story = await loadFullStory(target.storyId);
    if (!story) return;

    const jobId = `vidgen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setVideoGeneratingStoryId(getMediaTargetKey(target));
    clearVideoJobs();

    await registerGenJob({
      id: jobId,
      storyTitle: `VIDEO EP ${target.episodeNumber}: ${story.title || 'Untitled'}`,
      startedAt: new Date().toISOString(),
      status: 'running',
      currentPhase: 'video_generation',
      progress: 0,
      episodeCount: 1,
      currentEpisode: target.episodeNumber,
      events: [],
    });

    openGenerator(jobId);

    try {
      const config = await loadVideoOnlyPipelineConfigFromSavedSettings();

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
        addJobEvent(jobId, {
          type: event.type,
          phase: event.phase,
          agent: event.agent,
          message: event.message,
          timestamp: new Date().toISOString(),
        });
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

      const result = await rawPipeline.runVideoOnly(story, { targetEpisodeNumber: target.episodeNumber });
      await updateGenJob(jobId, { status: 'completed', progress: 100, currentPhase: 'complete' });
      upsertStory(result.story);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[GeneratorApp] Video-only generation failed:', errMsg);
      await updateGenJob(jobId, { status: 'failed', error: errMsg });
    } finally {
      setVideoGeneratingStoryId(null);
      videoPipelineRef.current = null;
    }
  }, [
    addJobEvent,
    addVideoJob,
    clearVideoJobs,
    getMediaTargetKey,
    loadFullStory,
    openGenerator,
    registerGenJob,
    removeVideoJob,
    updateGenJob,
    updateVideoJob,
    upsertStory,
    videoGeneratingStoryId,
  ]);

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

    const jobTitle = `${storyEntry?.title || 'Story'} Ep ${target.episodeNumber} Images`;
    let workerJobId: string | null = null;
    setImageGeneratingStoryId(getMediaTargetKey(target));

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
            currentEpisode: target.episodeNumber,
            episodeCount: 1,
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
          openGenerator(jobId);
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
      console.error('[GeneratorApp] Image generation failed:', errMsg);
      if (workerJobId) {
        await updateGenJob(workerJobId, { status: 'failed', error: errMsg });
      }
      Alert.alert('Image Generation Failed', errMsg);
    } finally {
      setImageGeneratingStoryId(null);
    }
  }, [
    addJobEvent,
    ensureProxyAvailable,
    getMediaTargetKey,
    imageGeneratingStoryId,
    loadStories,
    openGenerator,
    registerGenJob,
    runWorkerJob,
    stories,
    updateGenJob,
    upsertStory,
  ]);

  if (isSigningOut || (!signedOutLatch && isAuthChecking) || (isSignedIn && !storiesLoaded)) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <Text style={{ color: TERMINAL.colors.primary, fontSize: fonts.medium }}>
          {TERMINAL.symbols.prompt} LOADING GENERATOR...
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
      {route === 'home' ? (
        <SettingsScreen
          stories={stories}
          authUser={authUser}
          onSignOut={() => { void onSignOut(); }}
          onBack={() => openGenerator()}
          onOpenVisualizer={handleOpenVisualizer}
          onOpenGenerator={(jobId?: string) => openGenerator(jobId)}
          onDeleteStory={handleDeleteStory}
          onRenameStory={handleRenameStory}
          onGenerateVideos={handleOpenVideoSetup}
          onGenerateImages={handleOpenImageSetup}
          onContinueSeasonPlan={handleContinueSeasonPlan}
          seasonContinuations={seasonContinuations}
          generatedStoryIds={Array.from(fileLoadedStoryIds)}
          onRefreshStories={loadStories}
          onStoryArtifactsChanged={handleStoryArtifactsChanged}
          isRefreshing={isRefreshing}
          videoGeneratingStoryId={videoGeneratingStoryId}
          imageGeneratingStoryId={imageGeneratingStoryId}
        />
      ) : null}

      {route === 'generator' ? (
        <GeneratorScreen
          onBack={() => {
            setResumeJobId(undefined);
            setGeneratorSeasonPlanId(undefined);
            setGeneratorSetupView('story');
            setMediaSetupTarget(undefined);
            setRoute('home');
          }}
          onStoryGenerated={upsertStory}
          onViewLibrary={() => setRoute('home')}
          resumeJobId={resumeJobId}
          initialSeasonPlanId={generatorSeasonPlanId}
          initialSetupView={generatorSetupView}
          mediaSetupTarget={mediaSetupTarget}
          onGenerateTargetImages={handleGenerateImages}
          onGenerateTargetVideos={handleGenerateVideos}
          onCancelExternalPipeline={() => {
            if (videoPipelineRef.current) {
              videoPipelineRef.current.cancel();
              videoPipelineRef.current = null;
            }
          }}
        />
      ) : null}

      {route === 'visualizer' && visualizerStory ? (
        <VisualizerScreen
          story={visualizerStory}
          onBack={() => {
            setVisualizerStory(null);
            setRoute('home');
          }}
        />
      ) : null}
    </View>
  );
}

export default function GeneratorApp() {
  return (
    <GeneratorSettingsProvider>
      <SettingsProvider>
        <GameProvider>
          <GeneratorAppContent />
        </GameProvider>
      </SettingsProvider>
    </GeneratorSettingsProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: TERMINAL.colors.bg },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
