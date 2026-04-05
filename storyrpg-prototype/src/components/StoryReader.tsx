import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Pressable,
  Text,
  Dimensions,
  Animated,
  Platform,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { ArrowLeft, ArrowRight, ChevronRight, User, ThumbsUp, ThumbsDown, RefreshCw, X, MessageSquare, FileText } from 'lucide-react-native';
import {
  useGameActions,
  useGamePlayerState,
  useGameProgressState,
  useGameStoryState,
} from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useImageFeedbackStore, FeedbackReason, FEEDBACK_CATEGORIES, FEEDBACK_REASON_LABELS } from '../stores/imageFeedbackStore';
import {
  processBeat,
  executeChoice,
  findBeat,
  findChoice,
  getNextScene,
  ProcessedBeat,
} from '../engine/storyEngine';
import { processTemplate } from '../engine/templateProcessor';
import { NarrativeText } from './NarrativeText';
import { ChoiceButton } from './ChoiceButton';
import { EncounterView } from './EncounterView';
import { TERMINAL, RADIUS, TIMING, SPACING, sharedStyles, withAlpha } from '../theme';
import { EncounterCost, GeneratedStorylet, Scene, StoryletBeat, AppliedConsequence, EncounterOutcome, Relationship, Consequence } from '../types';
import type { PlayerState } from '../types';
import { ConsequenceToast } from './ConsequenceToast';
import { ConsequenceBadgeList } from './ConsequenceBadgeList';
import { ButterflyBanner } from './ButterflyBanner';
import { OutcomeHeader } from './OutcomeHeader';
import { StatCheckOverlay } from './StatCheckOverlay';
import { ReadingShell } from './ReadingShell';
import { haptics } from '../utils/haptics';
import { useClickDebounce } from '../utils/useDebounce';
import { PROXY_CONFIG } from '../config/endpoints';
import { useImagePromptOverlay } from '../hooks/useImagePromptOverlay';
import { formatSceneBeatLabelFromImageUrl } from '../utils/imagePromptDebug';
import {
  cloneRelationshipMap,
  applyRelationshipConsequencesToSnapshot,
  summarizeRelationshipChanges,
  formatNpcName,
  type EpisodeChoiceRecapItem,
  type EpisodeRelationshipRecapItem,
  type EpisodeRecapData,
} from '../utils/episodeRecap';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORYREADER_BUILD_ID = '2026-02-18b';
const STORY_READER_DEBUG = false;

function debugLog(...args: unknown[]): void {
  if (STORY_READER_DEBUG) {
    console.log(...args);
  }
}

const REFLECTION_PROSE: Record<string, string[]> = {
  victory: [
    'You take a breath. The dust settles, and you feel the weight of what you\'ve done.',
    'The moment passes, but its mark on you remains.',
    'You carry more than you arrived with.',
  ],
  defeat: [
    'The sting of it lingers, but something has shifted within you.',
    'Not every battle is won. But every battle leaves its mark.',
    'You pick yourself up. The cost was real, but so is what you learned.',
  ],
  escape: [
    'You got away, but not unscathed. You carry more than you arrived with.',
    'Your heart still races. The escape left its own kind of scar.',
    'Distance from danger doesn\'t erase what happened.',
  ],
  partialVictory: [
    'You won something real, but the cost is already changing what comes next.',
    'Relief lands beside regret. Success and consequence arrived together.',
    'You got through, but not cleanly. The story has shifted around that price.',
  ],
};

function getReflectionText(outcome: string): string {
  const pool = REFLECTION_PROSE[outcome] || REFLECTION_PROSE.victory;
  return pool[Math.floor(Math.random() * pool.length)];
}

function applyStoryletFlags(
  setFlagAction: (flag: string, value: boolean) => void,
  flags?: { flag: string; value: boolean }[]
): void {
  for (const flagState of flags || []) {
    setFlagAction(flagState.flag, flagState.value);
  }
}

interface StoryReaderProps {
  onEpisodeComplete?: () => void;
  onStoryComplete?: () => void;
}

export const StoryReader: React.FC<StoryReaderProps> = ({
  onEpisodeComplete,
  onStoryComplete,
}) => {
  const { player } = useGamePlayerState();
  const { currentStory, currentEpisode, currentScene, currentBeatId } = useGameStoryState();
  const { currentBranchTone, butterflyFeedback } = useGameProgressState();
  const {
    setBeat,
    loadScene,
    applyConsequences,
    setFlag,
    queueDelayedConsequence,
    completeEpisode,
    recordBranchChoice,
    getPathToScene,
    clearButterflyFeedback,
  } = useGameActions();

  const developerMode = useSettingsStore((state) => state.developerMode);
  const preferVideo = useSettingsStore((state) => state.preferVideo);
  const fonts = useSettingsStore((state) => state.getFontSizes());
  
  // Image feedback store
  const { addFeedback, getFeedbackForImage, updateFeedback, loadFeedback, isLoaded: feedbackLoaded } = useImageFeedbackStore();

  const [processedBeat, setProcessedBeat] = useState<ProcessedBeat | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showChoices, setShowChoices] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [choiceFeedback, setChoiceFeedback] = useState<{
    consequences: AppliedConsequence[];
    targetSceneId?: string;
    targetBeatId?: string;
    hasBeenShown?: boolean;
  } | null>(null);
  const [statCheckSkill, setStatCheckSkill] = useState<string | null>(null);
  const [statCheckTier, setStatCheckTier] = useState<'success' | 'complicated' | 'failure' | null>(null);
  const proceedAfterStatCheckRef = useRef<(() => void) | null>(null);
  const [resolutionText, setResolutionText] = useState<string | null>(null);
  const [choiceOutcomeHeader, setChoiceOutcomeHeader] = useState<{ text: string; tier: 'success' | 'complicated' | 'failure' } | null>(null);
  const [recentChoiceEcho, setRecentChoiceEcho] = useState<{
    summary: string;
    progress?: string;
    feedback: AppliedConsequence[];
    targetSceneId?: string;
    targetBeatId?: string;
    hasBeenShown?: boolean;
  } | null>(null);
  const [showingEncounter, setShowingEncounter] = useState(false);
  const [completedEncounters, setCompletedEncounters] = useState<Set<string>>(new Set());
  const [imageErrorId, setImageErrorId] = useState<string | null>(null);
  const [allowVideoPlayback, setAllowVideoPlayback] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const imageOpacity = useRef(new Animated.Value(1)).current;
  const lastKnownImageRef = useRef<string | null>(null);
  
  // Storylet state (GDD 6.7 - aftermath sequences)
  const [activeStorylet, setActiveStorylet] = useState<GeneratedStorylet | null>(null);
  const [storyletBeatId, setStoryletBeatId] = useState<string | null>(null);
  const [storyletNextSceneId, setStoryletNextSceneId] = useState<string | null>(null);
  const [isStoryletAnimating, setIsStoryletAnimating] = useState(false);
  const [showStoryletChoices, setShowStoryletChoices] = useState(false);

  // Post-encounter reflection beat (rendered through normal beat layout)
  const [showGrowthSummary, setShowGrowthSummary] = useState(false);
  const [growthFeedback, setGrowthFeedback] = useState<AppliedConsequence[]>([]);
  const [growthReflectionText, setGrowthReflectionText] = useState<string>('');
  const [growthCost, setGrowthCost] = useState<EncounterCost | null>(null);
  const [growthBadgesVisible, setGrowthBadgesVisible] = useState(false);
  const [episodeChoiceRecap, setEpisodeChoiceRecap] = useState<EpisodeChoiceRecapItem[]>([]);
  const [episodeRecap, setEpisodeRecap] = useState<EpisodeRecapData | null>(null);
  const [pendingStoryletActivation, setPendingStoryletActivation] = useState<{
    storylet: GeneratedStorylet;
    startBeatId: string;
    nextSceneId: string | null;
  } | null>(null);
  const [pendingDirectNavigation, setPendingDirectNavigation] = useState<{
    outcome: EncounterOutcome;
  } | null>(null);
  const episodeRelationshipBaselineRef = useRef<PlayerState['relationships']>(cloneRelationshipMap(player.relationships));

  // Safety: if storylet is active but beat can't be resolved, clear it and move on
  useEffect(() => {
    if (!activeStorylet || !storyletBeatId) return;
    const beatExists = activeStorylet.beats.some(b => b.id === storyletBeatId);
    if (!beatExists && activeStorylet.beats.length === 0) {
      console.error('[StoryReader] Active storylet has no beats — clearing and advancing');
      const nextScene = storyletNextSceneId;
      setActiveStorylet(null);
      setStoryletBeatId(null);
      setStoryletNextSceneId(null);
      if (nextScene) {
        loadScene(nextScene);
      } else {
        advanceToNextScene();
      }
    }
  }, [activeStorylet, storyletBeatId]);

  // Dev mode: Image feedback state
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [selectedReasons, setSelectedReasons] = useState<FeedbackReason[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('basic');

  const [devSkipAnimationsOnce, setDevSkipAnimationsOnce] = useState(false);

  // Dev mode navigation history — tracks actual visited beats so "back" works correctly
  const devHistoryRef = useRef<Array<{ sceneId: string; beatId: string }>>([]);

  const getSceneBeatLabelFromImageUrl = useCallback((url?: string): string | null => {
    return formatSceneBeatLabelFromImageUrl(url, currentScene?.id, currentBeatId);
  }, [currentBeatId, currentScene?.id]);

  // Dev mode: prompt panel should stay in sync with the currently displayed beat image.
  const promptImageUrl = (() => {
    const raw = processedBeat?.image || currentScene?.backgroundImage;
    if (!raw) return undefined;

    // If the beat image failed, we display the scene background — keep prompt in sync.
    if (
      processedBeat &&
      currentScene &&
      imageErrorId === processedBeat.id &&
      processedBeat.image &&
      processedBeat.image !== currentScene.backgroundImage
    ) {
      return currentScene.backgroundImage;
    }

    if (raw.endsWith('.prompt.txt') || raw.endsWith('.txt')) return undefined;
    return raw;
  })();

  // Debug: ensure we're running the expected bundle (CI mode can serve stale JS)
  useEffect(() => {
    debugLog(`[StoryReader] BUILD ${STORYREADER_BUILD_ID}`);
  }, []);

  useEffect(() => {
    setAllowVideoPlayback(false);
    if (!processedBeat?.video || Platform.OS !== 'web' || !preferVideo) {
      return;
    }
    const timer = setTimeout(() => {
      setAllowVideoPlayback(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [processedBeat?.id, processedBeat?.video, preferVideo]);

  useEffect(() => {
    episodeRelationshipBaselineRef.current = cloneRelationshipMap(player.relationships);
    setEpisodeChoiceRecap([]);
    setEpisodeRecap(null);
  }, [currentEpisode?.id]);

  const {
    showPromptOverlay,
    setShowPromptOverlay,
    promptText,
    isLoadingPrompt,
    promptContextLabel,
    fetchPrompt: fetchPromptForImageUrl,
  } = useImagePromptOverlay({
    getContextLabel: getSceneBeatLabelFromImageUrl,
    syncImageUrl: promptImageUrl,
    resolvePromptUrl: ({ imageUrl }) => {
      if (imageUrl.startsWith('data:')) {
        const outputDir = currentStory?.outputDir;
        const sceneId = currentScene?.id;
        const beatId = currentBeatId;
        if (!outputDir || !sceneId || !beatId) {
          return null;
        }
        const baseUrl = PROXY_CONFIG.getProxyUrl();
        const dir = outputDir.replace(/^\/app\//, '').replace(/\/$/, '');
        return `${baseUrl}/${dir}/images/prompts/beat-${sceneId}-${beatId}.json`;
      }
      return imageUrl
        .replace(/\/images\//, '/images/prompts/')
        .replace(/\.(png|jpg|jpeg|webp)$/i, '.json');
    },
  });

  // Load feedback on mount
  useEffect(() => {
    if (developerMode && !feedbackLoaded) {
      loadFeedback();
    }
  }, [developerMode, feedbackLoaded, loadFeedback]);

  // Check if scene has an encounter that hasn't been completed
  const sceneEncounter = currentScene?.encounter;
  const shouldShowEncounter = sceneEncounter && 
    !completedEncounters.has(sceneEncounter.id) && 
    (showingEncounter || currentBeatId === currentScene?.startingBeatId);

  // Auto-trigger encounter when entering a scene with one
  useEffect(() => {
    if (currentScene?.encounter && 
        !completedEncounters.has(currentScene.encounter.id) && 
        currentBeatId === currentScene.startingBeatId) {
      console.log('[StoryReader] Scene has encounter, showing it:', currentScene.encounter.id);
      setShowingEncounter(true);
    }
  }, [currentScene?.id, currentBeatId]);

  // Handle encounter completion (GDD 6.7 - now with storylet support)
  const handleEncounterComplete = (outcome: EncounterOutcome, encounterFeedback?: AppliedConsequence[]) => {
    if (!sceneEncounter) return;
    
    console.log('[StoryReader] Encounter completed with outcome:', outcome);
    setCompletedEncounters(prev => new Set([...prev, sceneEncounter.id]));
    setShowingEncounter(false);
    
    imageOpacity.setValue(1);
    fadeAnim.setValue(1);
    
    const storylet = sceneEncounter.storylets?.[outcome] || 
                     (outcome === 'escape' ? sceneEncounter.storylets?.victory : undefined);
    const outcomeCost = outcome === 'partialVictory'
      ? storylet?.cost || sceneEncounter.outcomes?.partialVictory?.cost || null
      : null;

    // Collect all feedback: encounter + storylet consequences
    let allFeedback = encounterFeedback ? [...encounterFeedback] : [];

    if (storylet && storylet.beats && storylet.beats.length > 0) {
      const resolvedStartBeatId = storylet.beats.some(b => b.id === storylet.startingBeatId)
        ? storylet.startingBeatId
        : storylet.beats[0].id;
      
      if (resolvedStartBeatId !== storylet.startingBeatId) {
        console.warn(`[StoryReader] Storylet "${storylet.name}" startingBeatId "${storylet.startingBeatId}" not found. Using first beat "${resolvedStartBeatId}".`);
      }
      
      console.log('[StoryReader] Playing storylet:', storylet.name, 'with', storylet.beats.length, 'beats, starting at:', resolvedStartBeatId);

      applyStoryletFlags(setFlag, storylet.setsFlags);
      
      if (storylet.consequences && storylet.consequences.length > 0) {
        const storyletApplied = applyConsequences(storylet.consequences as any);
        allFeedback = [...allFeedback, ...storyletApplied.filter(a => a.type !== 'flag')];
      }

      if (allFeedback.length > 0 || outcomeCost) {
        setGrowthFeedback(allFeedback);
        setGrowthReflectionText(getReflectionText(outcome));
        setGrowthCost(outcomeCost);
        setGrowthBadgesVisible(false);
        setPendingStoryletActivation({
          storylet,
          startBeatId: resolvedStartBeatId,
          nextSceneId: storylet.nextSceneId || sceneEncounter.outcomes?.[outcome]?.nextSceneId || null,
        });
        setPendingDirectNavigation(null);
        setShowGrowthSummary(true);
        return;
      }
      
      // No meaningful feedback — skip interstitial
      setActiveStorylet(storylet);
      setStoryletBeatId(resolvedStartBeatId);
      setStoryletNextSceneId(storylet.nextSceneId || sceneEncounter.outcomes?.[outcome]?.nextSceneId || null);
      setIsStoryletAnimating(true);
      setShowStoryletChoices(false);
      return;
    }

    if (allFeedback.length > 0 || outcomeCost) {
      setGrowthFeedback(allFeedback);
      setGrowthReflectionText(getReflectionText(outcome));
      setGrowthCost(outcomeCost);
      setGrowthBadgesVisible(false);
      setPendingStoryletActivation(null);
      setPendingDirectNavigation({ outcome });
      setShowGrowthSummary(true);
      return;
    }
    
    // No storylet, no feedback - proceed directly to next scene
    navigateAfterEncounter(outcome);
  };

  const finishEpisode = useCallback(() => {
    if (!currentEpisode) return;

    completeEpisode(currentEpisode.id);
    const episodeEndConsequences = currentEpisode.onComplete || [];
    if (episodeEndConsequences.length > 0) {
      applyConsequences(episodeEndConsequences);
    }

    const finalRelationships = applyRelationshipConsequencesToSnapshot(
      player.relationships,
      episodeEndConsequences
    );
    const relationshipChanges = summarizeRelationshipChanges(
      episodeRelationshipBaselineRef.current,
      finalRelationships,
      currentStory
    );
    const youChose = episodeChoiceRecap.slice(-3);
    const otherPaths = Array.from(new Set(youChose.flatMap((item) => item.otherPaths))).slice(0, 4);

    if (youChose.length > 0 || relationshipChanges.length > 0) {
      setEpisodeRecap({
        episodeTitle: currentEpisode.title,
        youChose,
        otherPaths,
        relationshipChanges,
      });
      return;
    }

    onEpisodeComplete?.();
  }, [
    currentEpisode,
    completeEpisode,
    applyConsequences,
    player.relationships,
    currentStory,
    episodeChoiceRecap,
    onEpisodeComplete,
  ]);
  
  // Navigate after encounter/storylet
  const navigateAfterEncounter = (outcome: EncounterOutcome) => {
    if (!sceneEncounter) return;
    
    let nextSceneId: string | undefined;
    if (outcome === 'victory') {
      nextSceneId = sceneEncounter.outcomes?.victory?.nextSceneId;
    } else if (outcome === 'partialVictory') {
      nextSceneId = sceneEncounter.outcomes?.partialVictory?.nextSceneId;
    } else if (outcome === 'defeat') {
      nextSceneId = sceneEncounter.outcomes?.defeat?.nextSceneId;
    } else if (outcome === 'escape') {
      nextSceneId = sceneEncounter.outcomes?.escape?.nextSceneId;
    }
    
    if (nextSceneId) {
      console.log('[StoryReader] Navigating to:', nextSceneId);
      if (nextSceneId === 'episode-end' || nextSceneId.startsWith('episode-')) {
        finishEpisode();
      } else {
        loadScene(nextSceneId);
      }
    } else {
      console.warn('[StoryReader] No nextSceneId for encounter outcome — auto-advancing to next scene');
      advanceToNextScene();
    }
  };
  
  const handleGrowthReflectionAnimComplete = useCallback(() => {
    setGrowthBadgesVisible(true);
  }, []);

  const dismissGrowthSummary = useCallback(() => {
    transitionTo(() => {
      setShowGrowthSummary(false);
      setGrowthFeedback([]);
      setGrowthCost(null);
      setGrowthBadgesVisible(false);

      if (pendingStoryletActivation) {
        const { storylet, startBeatId, nextSceneId } = pendingStoryletActivation;
        setActiveStorylet(storylet);
        setStoryletBeatId(startBeatId);
        setStoryletNextSceneId(nextSceneId);
        setIsStoryletAnimating(true);
        setShowStoryletChoices(false);
        setPendingStoryletActivation(null);
      } else if (pendingDirectNavigation) {
        navigateAfterEncounter(pendingDirectNavigation.outcome);
        setPendingDirectNavigation(null);
      }
    });
  }, [pendingStoryletActivation, pendingDirectNavigation]);

  // Handle storylet continuation
  const handleStoryletContinue = () => {
    if (!activeStorylet || !storyletBeatId) return;
    
    const currentBeat = activeStorylet.beats.find(b => b.id === storyletBeatId);
    if (!currentBeat) {
      console.warn('[StoryReader] handleStoryletContinue: beat not found, clearing storylet');
      setActiveStorylet(null);
      setStoryletBeatId(null);
      const nextScene = storyletNextSceneId;
      setStoryletNextSceneId(null);
      if (nextScene) loadScene(nextScene);
      else advanceToNextScene();
      return;
    }
    
    if (currentBeat.nextBeatId) {
      setStoryletBeatId(currentBeat.nextBeatId);
      setIsStoryletAnimating(true);
      setShowStoryletChoices(false);
    } else if (!currentBeat.isTerminal && (!currentBeat.choices || currentBeat.choices.length === 0)) {
      // No nextBeatId, not terminal, no choices — try advancing to the next beat in array order
      const currentIndex = activeStorylet.beats.findIndex(b => b.id === currentBeat.id);
      const nextInSequence = activeStorylet.beats[currentIndex + 1];
      if (nextInSequence) {
        console.log(`[StoryReader] Storylet auto-chaining: "${currentBeat.id}" → "${nextInSequence.id}" (index ${currentIndex} → ${currentIndex + 1})`);
        setStoryletBeatId(nextInSequence.id);
        setIsStoryletAnimating(true);
        setShowStoryletChoices(false);
        return;
      }
      // Fall through to storylet completion below
    }

    // Storylet complete (isTerminal, or last beat in sequence, or no choices)
    if (!currentBeat.nextBeatId) {
      const nextScene = storyletNextSceneId;
      console.log('[StoryReader] Storylet complete. Next scene:', nextScene);
      setActiveStorylet(null);
      setStoryletBeatId(null);
      setStoryletNextSceneId(null);
      
      if (nextScene) {
        if (nextScene === 'episode-end' || nextScene.startsWith('episode-')) {
          finishEpisode();
        } else {
          loadScene(nextScene);
        }
      } else {
        console.warn('[StoryReader] Storylet completed with no nextSceneId — advancing to next scene');
        advanceToNextScene();
      }
    }
  };
  
  // Handle storylet choice
  const handleStoryletChoice = (choiceId: string) => {
    if (!activeStorylet || !storyletBeatId) return;
    
    const currentBeat = activeStorylet.beats.find(b => b.id === storyletBeatId);
    const choice = currentBeat?.choices?.find(c => c.id === choiceId);
    if (!choice) return;
    
    if (choice.consequences) {
      applyConsequences(choice.consequences as any);
    }
    
    if (choice.nextBeatId) {
      setStoryletBeatId(choice.nextBeatId);
      setIsStoryletAnimating(true);
      setShowStoryletChoices(false);
    } else {
      handleStoryletContinue();
    }
  };
  
  const handleStoryletAnimationComplete = () => {
    setIsStoryletAnimating(false);
    const currentBeat = activeStorylet?.beats.find(b => b.id === storyletBeatId);
    if (currentBeat?.choices && currentBeat.choices.length > 0) {
      setShowStoryletChoices(true);
    }
  };

  // Track previous scene for transition detection
  const prevSceneRef = useRef<string | null>(null);
  const prevBeatIdRef = useRef<string | null>(null);
  
  // Pre-choice indicator state
  const [isApproachingChoice, setIsApproachingChoice] = useState(false);
  const choiceIndicatorAnim = useRef(new Animated.Value(0)).current;

  // Guard: if the scene has no renderable beats and any encounter is already
  // completed, auto-advance rather than showing a blank screen.
  useEffect(() => {
    if (!currentScene || !currentEpisode) return;

    const encounterDone = !currentScene.encounter || completedEncounters.has(currentScene.encounter.id);
    const hasNarrativeBeats = currentScene.beats && currentScene.beats.length > 0;

    if (encounterDone && !hasNarrativeBeats) {
      console.warn(`[StoryReader] Scene "${currentScene.id}" has no renderable content — auto-advancing.`);
      const nextScene = getNextScene(currentEpisode, currentScene.id, player);
      if (nextScene) {
        loadScene(nextScene.id);
      } else {
        finishEpisode();
      }
    }
  }, [currentScene?.id, completedEncounters, finishEpisode]);

  // Process current beat when it changes
  useEffect(() => {
    if (!currentScene || !currentBeatId || !currentStory) return;

    const beat = findBeat(currentScene, currentBeatId);
    if (!beat) return;

    if (beat.onShow && beat.onShow.length > 0) {
      applyConsequences(beat.onShow);
    }

    const processed = processBeat(beat, player, currentStory);
    
    // Add convergence context for branch-aware rendering
    processed.isAtConvergencePoint = currentScene.isConvergencePoint;
    processed.branchContext = {
      previousPath: getPathToScene(currentScene.id),
      branchTone: currentBranchTone || undefined,
    };
    
    setProcessedBeat(processed);
    setIsAnimating(true);
    setShowChoices(false);
    setResolutionText(null);
    setImageErrorId(null); // Reset error on new beat

    // Track beat in dev navigation history for reliable back-button
    const history = devHistoryRef.current;
    const lastEntry = history.length > 0 ? history[history.length - 1] : null;
    if (!lastEntry || lastEntry.sceneId !== currentScene.id || lastEntry.beatId !== currentBeatId) {
      history.push({ sceneId: currentScene.id, beatId: currentBeatId });
      if (history.length > 200) history.splice(0, history.length - 200);
    }

    // === TRANSITION VARIETY BASED ON VISUAL STORYTELLING PRINCIPLES ===
    // Determine transition type based on context
    const isSceneChange = prevSceneRef.current !== null && prevSceneRef.current !== currentScene.id;
    const isChoicePoint = processed.hasChoices;
    const isActionBeat = processed.speakerMood?.toLowerCase().includes('action') || 
                         processed.speakerMood?.toLowerCase().includes('tense') ||
                         processed.text.toLowerCase().includes('!');
    
    // Transition durations based on type:
    // - scene_to_scene: longer fade (800ms) - new location, needs orientation
    // - moment_to_moment (pre-choice): slower (700ms) - build anticipation  
    // - action_to_action: quick cut (300ms) - maintain momentum
    // - default: moderate (500ms)
    let transitionDuration = 500;
    let fadeOutDuration = 200;
    
    if (isSceneChange) {
      // Scene-to-scene: fade to black briefly, then fade in
      transitionDuration = 800;
      fadeOutDuration = 400;
    } else if (isChoicePoint) {
      // Pre-choice: slower, more deliberate
      transitionDuration = 700;
    } else if (isActionBeat) {
      // Action: quick cut
      transitionDuration = 300;
      fadeOutDuration = 100;
    }
    
    // Update refs for next transition
    prevSceneRef.current = currentScene.id;
    prevBeatIdRef.current = currentBeatId;

    // ENSURE VISIBILITY: Force fadeAnim back to 1 in case transitionTo was interrupted
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: Math.min(fadeOutDuration, 400),
      useNativeDriver: Platform.OS !== 'web',
    }).start();

    // Apply transition
    imageOpacity.setValue(0);
    Animated.timing(imageOpacity, {
      toValue: 1,
      duration: transitionDuration,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
    
    // === PRE-CHOICE VISUAL CUE ===
    // Check if next beat has choices (look-ahead for anticipation)
    const nextBeatId = beat.nextBeatId;
    if (nextBeatId) {
      const nextBeat = findBeat(currentScene, nextBeatId);
      if (nextBeat?.choices && nextBeat.choices.length > 0) {
        // Next beat has choices - show subtle anticipation indicator
        setIsApproachingChoice(true);
        Animated.loop(
          Animated.sequence([
            Animated.timing(choiceIndicatorAnim, { toValue: 1, duration: 1500, useNativeDriver: Platform.OS !== 'web' }),
            Animated.timing(choiceIndicatorAnim, { toValue: 0.3, duration: 1500, useNativeDriver: Platform.OS !== 'web' }),
          ])
        ).start();
      } else {
        setIsApproachingChoice(false);
        choiceIndicatorAnim.setValue(0);
      }
    } else {
      setIsApproachingChoice(false);
      choiceIndicatorAnim.setValue(0);
    }
    
    // SAFETY: Ensure isAnimating never gets permanently stuck
    // This handles edge cases where onAnimationComplete doesn't fire
    const safetyTimeout = setTimeout(() => {
      setIsAnimating(false);
    }, 3000); // 3 seconds max for any animation
    
    return () => clearTimeout(safetyTimeout);
  }, [currentScene, currentBeatId, currentStory]);

  const handleAnimationComplete = () => {
    setIsAnimating(false);
    if (processedBeat?.hasChoices) {
      setShowChoices(true);
    }
  };

  useEffect(() => {
    if (!recentChoiceEcho || !currentScene || !currentBeatId) return;

    const onTargetBeat =
      recentChoiceEcho.targetSceneId === currentScene.id &&
      recentChoiceEcho.targetBeatId === currentBeatId;

    if (onTargetBeat && !recentChoiceEcho.hasBeenShown) {
      setRecentChoiceEcho(prev => (prev ? { ...prev, hasBeenShown: true } : null));
      return;
    }

    if (!onTargetBeat && recentChoiceEcho.hasBeenShown) {
      setRecentChoiceEcho(null);
    }
  }, [recentChoiceEcho, currentScene, currentBeatId]);

  const choiceFeedbackRef = useRef(choiceFeedback);
  choiceFeedbackRef.current = choiceFeedback;
  useEffect(() => {
    if (choiceFeedbackRef.current) {
      setChoiceFeedback(null);
    }
  }, [currentBeatId]);

  // Execute the choice after the selection ceremony finishes
  const executeChoiceAfterCeremony = useCallback((choiceId: string) => {
    if (!currentScene || !currentBeatId || !processedBeat) return;

    const beat = findBeat(currentScene, currentBeatId);
    if (!beat) return;

    const choice = findChoice(beat, choiceId);
    if (!choice) return;

    const result = executeChoice(choice, player);

    if (!result.success) {
      setSelectedChoiceId(null);
      return;
    }

    // Queue any delayed consequences (butterfly effect)
    if (result.delayedConsequences && result.delayedConsequences.length > 0) {
      for (const dc of result.delayedConsequences) {
        queueDelayedConsequence({
          id: `dc-${choiceId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          consequence: dc.consequence,
          description: dc.description,
          delay: dc.delay,
          triggerCondition: dc.triggerCondition,
          sourceSceneId: currentScene?.id ?? 'unknown',
          sourceChoiceId: choiceId,
          scenesElapsed: 0,
          episodesElapsed: 0,
          fired: false,
        });
      }
    }

    const resolveEchoTarget = (explicitNextBeatId?: string, explicitNextSceneId?: string) => {
      if (explicitNextBeatId && currentScene) {
        return { sceneId: currentScene.id, beatId: explicitNextBeatId };
      }

      if (explicitNextSceneId && currentEpisode) {
        const targetScene = currentEpisode.scenes.find(scene => scene.id === explicitNextSceneId);
        const targetBeatId = targetScene?.beats?.[0]?.id;
        if (targetScene && targetBeatId) {
          return { sceneId: targetScene.id, beatId: targetBeatId };
        }
      }

      if (processedBeat?.nextBeatId && currentScene) {
        return { sceneId: currentScene.id, beatId: processedBeat.nextBeatId };
      }

      if (currentEpisode && currentScene) {
        const nextScene = getNextScene(currentEpisode, currentScene.id);
        const nextBeatId = nextScene?.beats?.[0]?.id;
        if (nextScene && nextBeatId) {
          return { sceneId: nextScene.id, beatId: nextBeatId };
        }
      }

      return null;
    };

    const showFeedback = (applied: AppliedConsequence[]) => {
      const visible = applied.filter(a => a.type !== 'flag');
      const echoTarget = resolveEchoTarget(result.nextBeatId, result.nextSceneId);
      setEpisodeChoiceRecap((prev) => [
        ...prev,
        {
          id: `${currentScene.id}:${currentBeatId}:${choice.id}:${prev.length}`,
          chosenText: processTemplate(choice.text, player, currentStory),
          summary: choice.feedbackCue?.echoSummary || choice.reminderPlan?.immediate || 'The choice changed the shape of the story.',
          otherPaths: (beat.choices || [])
            .filter((candidate) => candidate.id !== choice.id)
            .map((candidate) => processTemplate(candidate.text, player, currentStory))
            .slice(0, 2),
          relationshipNotes: visible
            .filter((item) => item.type === 'relationship')
            .map((item) => item.narrativeHint || item.label)
            .slice(0, 2),
          consequences: visible.slice(0, 3),
        },
      ]);
      if (visible.length > 0) {
        setChoiceFeedback({
          consequences: visible,
          targetSceneId: echoTarget?.sceneId,
          targetBeatId: echoTarget?.beatId,
          hasBeenShown: false,
        });
      }
      setRecentChoiceEcho({
        summary: choice.feedbackCue?.echoSummary || choice.reminderPlan?.immediate || 'The moment leaves a mark.',
        progress: choice.feedbackCue?.progressSummary || choice.reminderPlan?.shortTerm,
        feedback: visible.slice(0, 3),
        targetSceneId: echoTarget?.sceneId,
        targetBeatId: echoTarget?.beatId,
        hasBeenShown: false,
      });
    };

    const badgeViewingDelay = (applied: AppliedConsequence[]): number => {
      const visibleCount = Math.min(applied.filter(a => a.type !== 'flag').length, 5);
      if (visibleCount === 0) return 0;
      // stagger-in (80ms/badge) + animate-in (300ms) + reading time (1200ms)
      return (visibleCount * 80) + TIMING.normal + 1200;
    };

    const navigateWithBadgeDelay = (applied: AppliedConsequence[]) => {
      const delay = badgeViewingDelay(applied);
      if (delay > 0) {
        setTimeout(() => {
          navigateAfterChoice(result.nextBeatId, result.nextSceneId, choiceId);
        }, delay);
      } else {
        navigateAfterChoice(result.nextBeatId, result.nextSceneId, choiceId);
      }
    };

    const CHOICE_OUTCOME_HEADERS = {
      success: 'Well Played',
      complicated: 'Not Without Cost',
      failure: 'A Costly Misstep',
    } as const;

    const proceedAfterStatCheck = () => {
      if (result.resolution) {
        const tier = result.resolution.tier as 'success' | 'complicated' | 'failure';
        setChoiceOutcomeHeader({ text: CHOICE_OUTCOME_HEADERS[tier], tier });
      }

      if (result.resolution && choice.outcomeTexts) {
        const applied = applyConsequences(result.consequences);
        showFeedback(applied);
        navigateWithBadgeDelay(applied);
      } else if (result.resolution) {
        setResolutionText(result.resolution.narrativeText);
        setTimeout(() => {
          const applied = applyConsequences(result.consequences);
          showFeedback(applied);
          setResolutionText(null);
          navigateWithBadgeDelay(applied);
        }, 2000);
      } else {
        const applied = applyConsequences(result.consequences);
        showFeedback(applied);
        navigateWithBadgeDelay(applied);
      }
    };

    setShowChoices(false);
    setSelectedChoiceId(null);

    // Stat check tension moment: skill flash -> color pulse -> proceed
    if (result.resolution && choice.statCheck) {
      const skillLabel = choice.statCheck.skill || choice.statCheck.attribute || '';
      const tier = result.resolution.tier as 'success' | 'complicated' | 'failure';

      proceedAfterStatCheckRef.current = proceedAfterStatCheck;
      setStatCheckSkill(skillLabel.replace(/_/g, ' ').toUpperCase());
      setStatCheckTier(tier);
    } else {
      proceedAfterStatCheck();
    }
  }, [currentScene, currentBeatId, currentEpisode, currentStory, processedBeat, player, applyConsequences, queueDelayedConsequence]);

  // Base choice handler -- triggers selection ceremony, then executes after delay
  const handleChoicePressBase = useCallback((choiceId: string) => {
    if (!currentScene || !currentBeatId || !processedBeat || selectedChoiceId) return;
    haptics.selection();
    setChoiceOutcomeHeader(null);
    setRecentChoiceEcho(null);
    setSelectedChoiceId(choiceId);
    setTimeout(() => executeChoiceAfterCeremony(choiceId), TIMING.slow);
  }, [currentScene, currentBeatId, processedBeat, selectedChoiceId, executeChoiceAfterCeremony]);
  
  // Debounced choice handler - prevents double-clicks
  const handleChoicePress = useClickDebounce(handleChoicePressBase, 500);

  const navigateAfterChoice = (nextBeatId?: string, nextSceneId?: string, choiceId?: string) => {
    setChoiceFeedback(null);
    if (nextBeatId) {
      transitionTo(() => setBeat(nextBeatId), 'crossfade');
    } else if (nextSceneId) {
      if (currentEpisode) {
        const targetScene = currentEpisode.scenes.find(s => s.id === nextSceneId);
        const targetHasBeats = targetScene && targetScene.beats && targetScene.beats.length > 0;
        const targetEncounterDone = targetScene?.encounter && completedEncounters.has(targetScene.encounter.id);
        if (targetScene && !targetHasBeats && targetEncounterDone) {
          console.warn(`[StoryReader] Choice navigates to "${nextSceneId}" which has no renderable content — skipping to next scene.`);
          advanceToNextScene();
          return;
        }
      }
      if (currentScene) {
        recordBranchChoice(currentScene.id, nextSceneId, choiceId);
      }
      const targetScene = currentEpisode?.scenes.find(s => s.id === nextSceneId);
      const isEncounterEntry = !!targetScene?.encounter;
      transitionTo(
        () => loadScene(nextSceneId),
        isEncounterEntry ? 'dramatic' : 'slide'
      );
    } else {
      const nextBeatId = processedBeat?.nextBeatId;
      if (nextBeatId) {
        transitionTo(() => setBeat(nextBeatId), 'crossfade');
      } else {
        advanceToNextScene();
      }
    }
  };

  type TransitionStyle = 'crossfade' | 'slide' | 'dramatic';

  const transitionTo = (callback: () => void, style: TransitionStyle = 'crossfade') => {
    const useNative = Platform.OS !== 'web';

    if (style === 'slide') {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: TIMING.normal, useNativeDriver: useNative }),
        Animated.timing(slideAnim, { toValue: -30, duration: TIMING.normal, useNativeDriver: useNative }),
      ]).start(() => {
        callback();
        slideAnim.setValue(30);
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: TIMING.slow, useNativeDriver: useNative }),
          Animated.timing(slideAnim, { toValue: 0, duration: TIMING.slow, useNativeDriver: useNative }),
        ]).start();
      });
    } else if (style === 'dramatic') {
      Animated.timing(fadeAnim, {
        toValue: 0, duration: TIMING.dramatic, useNativeDriver: useNative,
      }).start(() => {
        callback();
        Animated.timing(fadeAnim, {
          toValue: 1, duration: TIMING.dramatic, useNativeDriver: useNative,
        }).start();
      });
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0, duration: TIMING.fast, useNativeDriver: useNative,
      }).start(() => {
        callback();
        Animated.timing(fadeAnim, {
          toValue: 1, duration: TIMING.normal, useNativeDriver: useNative,
        }).start();
      });
    }
  };

  const devFastTransitionTo = useCallback((callback: () => void) => {
    // Stop any in-flight animations and render next beat immediately.
    // Also disable NarrativeText animation for exactly one render after a dev jump.
    setDevSkipAnimationsOnce(true);
    fadeAnim.stopAnimation();
    imageOpacity.stopAnimation();
    fadeAnim.setValue(1);
    imageOpacity.setValue(1);
    callback();
  }, [fadeAnim, imageOpacity]);

  // Base continue handler (wrapped with debounce below)
  const handleContinueBase = useCallback(() => {
    if (!processedBeat) return;
    setChoiceOutcomeHeader(null);

    // Capture values to avoid non-null assertions
    const nextBeatId = processedBeat.nextBeatId;
    const nextSceneId = processedBeat.nextSceneId;
    
    if (nextBeatId) {
      transitionTo(() => setBeat(nextBeatId));
    } else if (nextSceneId) {
      transitionTo(() => loadScene(nextSceneId));
    } else {
      advanceToNextScene();
    }
  }, [processedBeat, setBeat, loadScene]);
  
  // Debounced continue handler - prevents double-clicks
  const handleContinue = useClickDebounce(handleContinueBase, 500);

  const advanceToNextScene = () => {
    if (!currentEpisode || !currentScene) return;

    const nextScene = getNextScene(currentEpisode, currentScene.id, player);

    if (nextScene) {
      // Record branch transition for reconvergence tracking
      recordBranchChoice(currentScene.id, nextScene.id);
      transitionTo(() => loadScene(nextScene.id));
    } else {
      finishEpisode();
    }
  };

  // Dev Mode: beat/scene shortcut navigation (doesn't apply consequences)
  const getLinearBeatSequenceForScene = useCallback((scene: Scene): string[] => {
    const seq: string[] = [];
    const beatById = new Map(scene.beats.map(b => [b.id, b]));
    let cursor: string | undefined = scene.startingBeatId;

    for (let i = 0; i < scene.beats.length + 5; i++) {
      if (!cursor) break;
      if (seq.includes(cursor)) break; // loop guard
      seq.push(cursor);

      const beat = beatById.get(cursor);
      if (!beat?.nextBeatId) break;
      cursor = beat.nextBeatId;
    }
    return seq;
  }, []);

  const devGoPrev = useCallback(() => {
    const history = devHistoryRef.current;

    // Pop the current entry (the beat we're on now)
    if (history.length > 0) {
      const current = history[history.length - 1];
      if (current && currentScene && current.sceneId === currentScene.id && current.beatId === currentBeatId) {
        history.pop();
      }
    }

    // Now navigate to the previous entry
    if (history.length === 0) return;

    const prev = history[history.length - 1];
    if (!prev) return;

    if (prev.sceneId === currentScene?.id) {
      devFastTransitionTo(() => setBeat(prev.beatId));
    } else {
      devFastTransitionTo(() => {
        loadScene(prev.sceneId);
        setBeat(prev.beatId);
      });
    }
  }, [currentBeatId, currentScene, devFastTransitionTo, loadScene, setBeat]);

  const devGoNext = useCallback(() => {
    if (!currentScene || !processedBeat) return;

    const seq = getLinearBeatSequenceForScene(currentScene);
    const idx = currentBeatId ? seq.indexOf(currentBeatId) : -1;

    if (idx >= 0 && idx < seq.length - 1) {
      devFastTransitionTo(() => setBeat(seq[idx + 1]));
      return;
    }

    if (processedBeat.nextBeatId) {
      const id = processedBeat.nextBeatId;
      devFastTransitionTo(() => setBeat(id));
    } else if (processedBeat.nextSceneId) {
      const id = processedBeat.nextSceneId;
      devFastTransitionTo(() => loadScene(id));
    } else {
      advanceToNextScene();
    }
  }, [advanceToNextScene, currentBeatId, currentScene, devFastTransitionTo, getLinearBeatSequenceForScene, loadScene, processedBeat, setBeat]);

  useEffect(() => {
    if (!devSkipAnimationsOnce) return;
    // Reset on the next tick so only the immediate render is non-animated.
    const t = setTimeout(() => setDevSkipAnimationsOnce(false), 0);
    return () => clearTimeout(t);
  }, [devSkipAnimationsOnce]);

  // Dev Mode: keyboard shortcuts on web (Alt/Option + arrows)
  useEffect(() => {
    if (!developerMode || Platform.OS !== 'web') return;
    const onKeyDown = (e: any) => {
      if (!e?.altKey) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault?.();
        devGoPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault?.();
        devGoNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [developerMode, devGoNext, devGoPrev]);

  // Dev overlay: compute contextual label and render helpers shared by every beat type
  const devLabel = (() => {
    if (!developerMode || !currentScene) return null;
    const sn = currentScene.id?.match(/scene-([0-9]+[a-z]?)/i)?.[1];
    if (episodeRecap) return 'RECAP';
    if (shouldShowEncounter && sceneEncounter) return sn ? `S${sn}  ENC` : 'ENC';
    if (showGrowthSummary) return sn ? `S${sn}  GROWTH` : 'GROWTH';
    if (activeStorylet && storyletBeatId) {
      const idx = activeStorylet.beats.findIndex(b => b.id === storyletBeatId);
      const sl = idx >= 0 ? `SL·B${idx + 1}` : 'SL';
      return sn ? `S${sn}  ${sl}` : sl;
    }
    const bn = currentBeatId?.match(/beat-([0-9]+)/i)?.[1];
    return sn && bn ? `S${sn}  B${bn}` : sn ? `S${sn}` : null;
  })();

  const renderDevBadgeOverlay = () => devLabel ? (
    <View style={[styles.devSceneBeatBadge, { pointerEvents: 'none' as const }]}>
      <Text style={styles.devSceneBeatText}>{devLabel}</Text>
    </View>
  ) : null;

  const renderDevNavOverlay = () => !developerMode ? null : (
    <View style={styles.feedbackToolbar}>
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [styles.feedbackButton, styles.navButton, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Previous beat"
        onPress={devGoPrev}
        {...(Platform.OS === 'web' ? ({ onClick: devGoPrev } as any) : {})}
      >
        <ArrowLeft size={18} color={TERMINAL.colors.muted} />
      </Pressable>
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [styles.feedbackButton, styles.navButton, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Next beat"
        onPress={devGoNext}
        {...(Platform.OS === 'web' ? ({ onClick: devGoNext } as any) : {})}
      >
        <ArrowRight size={18} color={TERMINAL.colors.muted} />
      </Pressable>
    </View>
  );

  if (!currentScene || !processedBeat) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>INITIALIZING...</Text>
      </View>
    );
  }

  if (episodeRecap) {
    const recapImageUrl = lastKnownImageRef.current || processedBeat.image || currentScene.backgroundImage;
    return (
      <View style={{ flex: 1 }}>
      <ReadingShell imageUrl={recapImageUrl} fadeAnim={fadeAnim} imageOpacity={imageOpacity}>
            <View style={styles.textPanel}>
              <Text style={styles.recapEyebrow}>EPISODE RECAP</Text>
              <Text style={styles.recapTitle}>{episodeRecap.episodeTitle}</Text>

              {episodeRecap.youChose.length > 0 && (
                <View style={styles.recapSection}>
                  <Text style={styles.recapSectionTitle}>YOU CHOSE</Text>
                  {episodeRecap.youChose.map((item) => (
                    <View key={item.id} style={styles.recapCard}>
                      <Text style={styles.recapChoiceText}>{item.chosenText}</Text>
                      <Text style={styles.recapBodyText}>{item.summary}</Text>
                      {item.consequences && item.consequences.length > 0 && (
                        <ConsequenceBadgeList consequences={item.consequences} animated={false} maxVisible={3} />
                      )}
                    </View>
                  ))}
                </View>
              )}

              {episodeRecap.otherPaths.length > 0 && (
                <View style={styles.recapSection}>
                  <Text style={styles.recapSectionTitle}>OTHER PATHS</Text>
                  {episodeRecap.otherPaths.map((path, index) => (
                    <View key={`${path}-${index}`} style={styles.recapAltRow}>
                      <Text style={styles.recapAltBullet}>◆</Text>
                      <Text style={styles.recapAltText}>{path}</Text>
                    </View>
                  ))}
                </View>
              )}

              {episodeRecap.relationshipChanges.length > 0 && (
                <View style={styles.recapSection}>
                  <Text style={styles.recapSectionTitle}>RELATIONSHIPS CHANGED</Text>
                  {episodeRecap.relationshipChanges.map((item) => {
                    const badges: AppliedConsequence[] = item.summary
                      .split(/[.;]/)
                      .filter(Boolean)
                      .map((part) => {
                        const lower = part.trim().toLowerCase();
                        const isUp = lower.includes('rose');
                        return {
                          type: 'relationship' as const,
                          label: item.npcName,
                          direction: isUp ? 'up' as const : 'down' as const,
                          narrativeHint: part.trim(),
                        };
                      })
                      .filter(b => b.narrativeHint.length > 0);
                    return (
                      <View key={item.npcId} style={styles.recapCard}>
                        <Text style={styles.recapChoiceText}>{item.npcName}</Text>
                        {badges.length > 0 ? (
                          <ConsequenceBadgeList consequences={badges} animated={false} maxVisible={4} />
                        ) : (
                          <Text style={styles.recapBodyText}>{item.summary}</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.continueButton}
              onPress={() => {
                setEpisodeRecap(null);
                onEpisodeComplete?.();
              }}
            >
              <Text style={styles.continueText}>CONTINUE</Text>
              <ChevronRight size={16} color="white" />
            </TouchableOpacity>
      </ReadingShell>
      {renderDevBadgeOverlay()}
      {renderDevNavOverlay()}
      </View>
    );
  }

  // Show encounter if scene has one and it hasn't been completed
  if (shouldShowEncounter && sceneEncounter) {
    return (
      <View style={{ flex: 1 }}>
        <EncounterView
          encounter={sceneEncounter}
          onComplete={handleEncounterComplete}
        />
        {renderDevBadgeOverlay()}
        {renderDevNavOverlay()}
      </View>
    );
  }

  // Post-encounter reflection -- rendered as a normal beat
  if (showGrowthSummary) {
    const reflectionImageUrl = lastKnownImageRef.current;
    return (
      <View style={{ flex: 1 }}>
      <ReadingShell imageUrl={reflectionImageUrl} fadeAnim={fadeAnim} imageOpacity={imageOpacity}>
            <View style={styles.textPanel}>
              <NarrativeText
                text={growthReflectionText}
                animate={true}
                onAnimationComplete={handleGrowthReflectionAnimComplete}
              />
              {growthCost && (
                <View style={styles.costPanel}>
                  <Text style={styles.costPanelLabel}>THE PRICE OF SUCCESS</Text>
                  <Text style={styles.costPanelTitle}>{growthCost.visibleComplication}</Text>
                  <Text style={styles.costPanelMeta}>{`${growthCost.severity.toUpperCase()} ${growthCost.domain.toUpperCase()} COST`}</Text>
                  <Text style={styles.costPanelBody}>{growthCost.immediateEffect}</Text>
                  {!!growthCost.lingeringEffect && (
                    <Text style={styles.costPanelLingering}>{growthCost.lingeringEffect}</Text>
                  )}
                </View>
              )}
              {growthBadgesVisible && (
                <ConsequenceBadgeList consequences={growthFeedback} />
              )}
            </View>

            {growthBadgesVisible && (
              <TouchableOpacity style={styles.continueButton} onPress={dismissGrowthSummary}>
                <Text style={styles.continueText}>CONTINUE</Text>
                <ChevronRight size={16} color="white" />
              </TouchableOpacity>
            )}
      </ReadingShell>
      {renderDevBadgeOverlay()}
      {renderDevNavOverlay()}
      </View>
    );
  }

  // Render storylet if active (GDD 6.7 - aftermath sequences)
  if (activeStorylet && storyletBeatId) {
    let currentStoryletBeat = activeStorylet.beats.find(b => b.id === storyletBeatId);

    // Fallback: if startingBeatId doesn't match any beat, use the first beat
    if (!currentStoryletBeat && activeStorylet.beats.length > 0) {
      console.warn(`[StoryReader] Storylet beat ID "${storyletBeatId}" not found in ${activeStorylet.beats.length} beats. IDs: ${activeStorylet.beats.map(b => b.id).join(', ')}. Falling back to first beat.`);
      currentStoryletBeat = activeStorylet.beats[0];
    }

    if (currentStoryletBeat) {
      console.log(`[StoryReader] Rendering storylet beat: id="${currentStoryletBeat.id}", text="${(currentStoryletBeat.text || '').substring(0, 60)}...", hasImage=${!!currentStoryletBeat.image}, isTerminal=${!!currentStoryletBeat.isTerminal}, hasChoices=${!!(currentStoryletBeat.choices?.length)}`);
      // Tone badge appearance
      const toneStyles: Record<string, { labelColor: string; labelText: string; borderColor: string }> = {
        triumphant:  { labelColor: TERMINAL.colors.success,  borderColor: withAlpha(TERMINAL.colors.success, 0.4),  labelText: 'VICTORY'      },
        bittersweet: { labelColor: TERMINAL.colors.amber,    borderColor: withAlpha(TERMINAL.colors.amber, 0.4),    labelText: 'AFTERMATH'    },
        tense:       { labelColor: TERMINAL.colors.error,    borderColor: withAlpha(TERMINAL.colors.error, 0.4),    labelText: 'CONSEQUENCES' },
        desperate:   { labelColor: '#dc2626',                borderColor: 'rgba(220,38,38,0.4)',                     labelText: 'DESPERATE'    },
        relieved:    { labelColor: TERMINAL.colors.primary,  borderColor: withAlpha(TERMINAL.colors.primary, 0.4),  labelText: 'ESCAPE'       },
        somber:      { labelColor: '#6b7280',                borderColor: 'rgba(107,114,128,0.4)',                   labelText: 'DEFEAT'       },
      };
      const toneStyle = toneStyles[activeStorylet.tone] || toneStyles.bittersweet;

      // Fall back to current scene's background image when the beat has no dedicated image
      const storyletImageUrl = currentStoryletBeat.image
        || (currentScene?.backgroundImage && !currentScene.backgroundImage.endsWith('.txt')
            ? currentScene.backgroundImage
            : undefined);

      return (
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
          {/* Background image — same structure as regular beats */}
          <View style={styles.imageContainer}>
            {storyletImageUrl ? (
              <Image
                source={{ uri: storyletImageUrl }}
                style={styles.fullBleedImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.placeholderBackground} />
            )}
            <View style={styles.gradientOverlay} />
          </View>

          {/* Overlay content — matches regular beat layout */}
          <View style={styles.uiOverlay}>
            <ScrollView
              style={styles.contentScrollView}
              contentContainerStyle={styles.contentContainer}
              showsVerticalScrollIndicator={false}
            >
              {/* Text panel — same dark rounded card as regular beats */}
              <View style={styles.textPanel}>
                {/* Tone badge inside the panel */}
                <View style={[styles.storyletToneBadge, { borderColor: toneStyle.borderColor }]}>
                  <Text style={[styles.storyletToneLabel, { color: toneStyle.labelColor }]}>
                    {toneStyle.labelText}
                  </Text>
                </View>

                <NarrativeText
                  text={processTemplate(currentStoryletBeat.text, player, currentStory)}
                  speaker={currentStoryletBeat.speaker}
                  speakerMood={currentStoryletBeat.speakerMood}
                  animate={isStoryletAnimating}
                  onAnimationComplete={handleStoryletAnimationComplete}
                />
              </View>

              {/* Storylet choices */}
              {showStoryletChoices && currentStoryletBeat.choices && currentStoryletBeat.choices.length > 0 && (
                <View style={styles.choicesList}>
                  {currentStoryletBeat.choices.map((choice, idx) => (
                    <ChoiceButton
                      key={choice.id}
                      variant="minimal"
                      choice={{
                        id: choice.id,
                        text: processTemplate(choice.text, player, currentStory),
                        isLocked: false,
                        hasStatCheck: false,
                      }}
                      index={idx}
                      onPress={() => handleStoryletChoice(choice.id)}
                    />
                  ))}
                </View>
              )}

              {/* Continue button */}
              {!isStoryletAnimating && (!currentStoryletBeat.choices || currentStoryletBeat.choices.length === 0) && (
                <TouchableOpacity
                  style={styles.storyletContinueButton}
                  onPress={handleStoryletContinue}
                >
                  <Text style={styles.storyletContinueText}>CONTINUE</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>

          {renderDevBadgeOverlay()}
          {renderDevNavOverlay()}
        </Animated.View>
      );
    }
  }

  // For normal beats, only render beat- or scene-scoped art.
  // Reusing the last image or story cover here smears one fallback across the whole story.
  const rawImageUrl =
    processedBeat.image
    || currentScene.backgroundImage;
  
  // Logic to handle missing beat images by falling back to scene background
  let finalImageUrl = rawImageUrl;
  if (imageErrorId === processedBeat.id && processedBeat.image && processedBeat.image !== currentScene.backgroundImage) {
    debugLog(`[StoryReader] Falling back to scene background for beat ${processedBeat.id}`);
    finalImageUrl = currentScene.backgroundImage;
  }

  const originalImageUrl = finalImageUrl;
  const regeneratedImageUrl = originalImageUrl
    ? getFeedbackForImage(originalImageUrl)?.regeneratedImageUrl
    : undefined;
  if (regeneratedImageUrl) {
    finalImageUrl = regeneratedImageUrl;
  }

  const imageUrl = finalImageUrl && !finalImageUrl.endsWith('.prompt.txt') && !finalImageUrl.endsWith('.txt') 
    ? finalImageUrl 
    : undefined;
  if (imageUrl && (processedBeat.image || currentScene.backgroundImage)) {
    lastKnownImageRef.current = imageUrl;
  }

  const videoUrl = processedBeat.video || undefined;
  const progress = currentEpisode ? (currentEpisode.scenes.findIndex(s => s.id === currentScene.id) + 1) / currentEpisode.scenes.length : 0;

  // Developer mode: Check if current image has feedback
  const currentImageFeedback = (originalImageUrl && getFeedbackForImage(originalImageUrl))
    || (imageUrl ? getFeedbackForImage(imageUrl) : undefined);

  // Developer mode: Feedback handlers
  const handleThumbsUp = async () => {
    if (!imageUrl || !currentStory) return;
    
    await addFeedback({
      storyId: currentStory.id,
      episodeId: currentEpisode?.id,
      sceneId: currentScene?.id,
      beatId: currentBeatId || undefined,
      imageUrl,
      rating: 'positive',
    });
    setFeedbackSubmitted(true);
    setTimeout(() => setFeedbackSubmitted(false), 2000);
  };

  const handleThumbsDown = () => {
    setShowFeedbackModal(true);
    setFeedbackNotes('');
    setSelectedReasons([]);
  };

  const toggleReason = (reason: FeedbackReason) => {
    setSelectedReasons(prev => 
      prev.includes(reason) 
        ? prev.filter(r => r !== reason)
        : [...prev, reason]
    );
  };

  const submitNegativeFeedback = async (shouldRegenerate: boolean = false) => {
    if (!imageUrl || !currentStory) return;
    
    const feedback = await addFeedback({
      storyId: currentStory.id,
      episodeId: currentEpisode?.id,
      sceneId: currentScene?.id,
      beatId: currentBeatId || undefined,
      imageUrl,
      rating: 'negative',
      reasons: selectedReasons.length > 0 ? selectedReasons : undefined,
      notes: feedbackNotes.trim() || undefined,
    });
    
    setShowFeedbackModal(false);
    
    if (shouldRegenerate) {
      setIsRegenerating(true);
      try {
        // Call the regenerate endpoint
        const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/regenerate-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl,
            storyId: currentStory.id,
            sceneId: currentScene?.id,
            beatId: currentBeatId,
            feedback: {
              reasons: selectedReasons,
              notes: feedbackNotes.trim(),
            },
          }),
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.newImageUrl) {
            // Update feedback with regenerated image URL
            await updateFeedback(feedback.id, {
              regenerated: true,
              regeneratedImageUrl: result.newImageUrl,
            });
            // Force refresh the beat to show new image
            // This will trigger a re-render with the new image
            setImageErrorId(null);
          }
        }
      } catch (error) {
        console.error('[StoryReader] Failed to regenerate image:', error);
      } finally {
        setIsRegenerating(false);
      }
    }
    
    setFeedbackSubmitted(true);
    setTimeout(() => setFeedbackSubmitted(false), 2000);
  };
  
  // Toggle category expansion
  const toggleCategory = (categoryKey: string) => {
    setExpandedCategory(prev => prev === categoryKey ? null : categoryKey);
  };

  // Dev mode: Fetch image prompt from server (open/toggle panel)
  const fetchImagePrompt = async () => {
    if (!promptImageUrl) return;
    setShowPromptOverlay(true);
    await fetchPromptForImageUrl(promptImageUrl);
  };

  // Get all feedback categories for the UI
  const feedbackCategoryEntries = Object.entries(FEEDBACK_CATEGORIES) as [string, { label: string; reasons: FeedbackReason[] }][];

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }]}>
      {/* Stat Check Overlay (skill flash + tier tint) */}
      {statCheckSkill && statCheckTier && (
        <StatCheckOverlay
          skillName={statCheckSkill}
          tier={statCheckTier}
          onComplete={() => {
            setStatCheckSkill(null);
            setStatCheckTier(null);
            proceedAfterStatCheckRef.current?.();
          }}
        />
      )}

      {/* Butterfly Effect Banner */}
      {butterflyFeedback.length > 0 && (
        <ButterflyBanner
          items={butterflyFeedback}
          onDismiss={clearButterflyFeedback}
        />
      )}

      {/* Progress Bar */}
      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
      </View>
      
      {/* Pre-Choice Indicator - subtle glow when approaching a decision point */}
      {isApproachingChoice && (
        <Animated.View 
          style={[
            styles.preChoiceIndicator,
            { opacity: choiceIndicatorAnim },
            { pointerEvents: 'none' as const },
          ]} 
        />
      )}

      {/* Background Image / Video */}
      <Animated.View style={[styles.imageContainer, { opacity: imageOpacity }]}>
        {videoUrl && Platform.OS === 'web' && preferVideo && allowVideoPlayback ? (
          <video
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              position: 'absolute' as any,
              top: 0,
              left: 0,
            }}
            onLoadedData={() => debugLog(`[StoryReader] Video loaded: ${videoUrl}`)}
            onError={() => console.warn(`[StoryReader] Video failed to load: ${videoUrl}`)}
          />
        ) : imageUrl ? (
          <Image
            source={{ 
              uri: imageUrl,
              headers: { 'Accept': 'image/*' }
            }} 
            style={styles.fullBleedImage}
            resizeMode="cover"
            crossOrigin="anonymous"
            onLoad={() => debugLog(`[StoryReader] Image loaded: ${imageUrl}`)}
            onError={(e) => {
              console.warn(`[StoryReader] Image failed to load: ${imageUrl}`, e.nativeEvent);
              if (processedBeat && imageUrl === processedBeat.image) {
                setImageErrorId(processedBeat.id);
              }
            }}
          />
        ) : (
          <View style={styles.placeholderBackground}>
             <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
               <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 24, fontWeight: '900' }}>STORYRPG</Text>
             </View>
          </View>
        )}
        <View style={styles.gradientOverlay} />
      </Animated.View>

      {/* Content */}
      <View style={styles.uiOverlay}>
        <ScrollView
          style={styles.contentScrollView}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Consequence feedback -- badge toast shown immediately on the choice beat */}
          {choiceFeedback && (
            <ConsequenceToast
              consequences={choiceFeedback.consequences}
              onDismiss={() => setChoiceFeedback(null)}
            />
          )}

          {recentChoiceEcho &&
            recentChoiceEcho.targetSceneId === currentScene?.id &&
            recentChoiceEcho.targetBeatId === currentBeatId && (
            <View style={styles.echoPanel}>
              <Text style={styles.echoSummaryText}>{recentChoiceEcho.summary}</Text>
              {recentChoiceEcho.progress && (
                <Text style={styles.echoProgressText}>{recentChoiceEcho.progress}</Text>
              )}
              {recentChoiceEcho.feedback.length > 0 && (
                <ConsequenceBadgeList consequences={recentChoiceEcho.feedback} staggerDelay={60} />
              )}
            </View>
          )}

          {/* Narrative/Dialogue */}
          <View style={styles.textPanel}>
            {choiceOutcomeHeader && (
              <OutcomeHeader tier={choiceOutcomeHeader.tier} context="story" text={choiceOutcomeHeader.text} />
            )}
            <NarrativeText
              text={processedBeat.text}
              speaker={processedBeat.speaker}
              speakerMood={processedBeat.speakerMood}
              animate={!devSkipAnimationsOnce}
              onAnimationComplete={handleAnimationComplete}
            />
          </View>

          {/* Resolution */}
          {resolutionText && (
            <View style={styles.resolutionPanel}>
              {choiceOutcomeHeader && (
                <OutcomeHeader tier={choiceOutcomeHeader.tier} context="story" text={choiceOutcomeHeader.text} />
              )}
              <Text style={styles.resolutionText}>{resolutionText}</Text>
            </View>
          )}

          {/* Choices */}
          {showChoices && processedBeat.hasChoices && (
            <View style={styles.choicesList}>
              {processedBeat.choices.map((choice, index) => (
                <ChoiceButton
                  key={choice.id}
                  choice={choice}
                  index={index}
                  onPress={handleChoicePress}
                  isSelected={selectedChoiceId === choice.id}
                  isDeselected={selectedChoiceId !== null && selectedChoiceId !== choice.id}
                />
              ))}
            </View>
          )}

          {/* Continue Button */}
          {!isAnimating && !processedBeat.hasChoices && !resolutionText && (
            <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
              <Text style={styles.continueText}>CONTINUE</Text>
              <ChevronRight size={16} color="white" />
            </TouchableOpacity>
          )}
        </ScrollView>

        {renderDevBadgeOverlay()}

        {/* Dev Mode: Toolbar (rendered inside uiOverlay, after ScrollView, so it wins stacking on web) */}
        {developerMode && imageUrl && (
          <View style={styles.feedbackToolbar}>
            {isRegenerating ? (
              <View style={styles.regeneratingIndicator}>
                <ActivityIndicator size="small" color={TERMINAL.colors.cyan} />
                <Text style={styles.regeneratingText}>REGENERATING...</Text>
              </View>
            ) : feedbackSubmitted ? (
              <View style={styles.feedbackSubmittedIndicator}>
                <Text style={styles.feedbackSubmittedText}>FEEDBACK SAVED</Text>
              </View>
            ) : (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.feedbackButton,
                    styles.navButton,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Previous beat"
                  onPress={devGoPrev}
                  {...(Platform.OS === 'web' ? ({ onClick: devGoPrev } as any) : {})}
                >
                  <ArrowLeft size={18} color={TERMINAL.colors.muted} />
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.feedbackButton,
                    styles.navButton,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Next beat"
                  onPress={devGoNext}
                  {...(Platform.OS === 'web' ? ({ onClick: devGoNext } as any) : {})}
                >
                  <ArrowRight size={18} color={TERMINAL.colors.muted} />
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.feedbackButton,
                    styles.promptButton,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="View image prompt"
                  onPress={() => {
                    if (showPromptOverlay) {
                      setShowPromptOverlay(false);
                    } else {
                      fetchImagePrompt();
                    }
                  }}
                  {...(Platform.OS === 'web'
                    ? ({
                        onClick: () => {
                          if (showPromptOverlay) {
                            setShowPromptOverlay(false);
                          } else {
                            fetchImagePrompt();
                          }
                        },
                      } as any)
                    : {})}
                >
                  <FileText size={18} color={TERMINAL.colors.cyan} />
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.feedbackButton,
                    styles.thumbsUpButton,
                    currentImageFeedback?.rating === 'positive' && styles.feedbackButtonActive,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Thumbs up"
                  onPress={handleThumbsUp}
                  {...(Platform.OS === 'web'
                    ? ({ onClick: handleThumbsUp } as any)
                    : {})}
                >
                  <ThumbsUp size={18} color={currentImageFeedback?.rating === 'positive' ? '#fff' : TERMINAL.colors.primary} />
                </Pressable>
                
                <Pressable
                  style={({ pressed }) => [
                    styles.feedbackButton,
                    styles.thumbsDownButton,
                    currentImageFeedback?.rating === 'negative' && styles.feedbackButtonActiveNegative,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Thumbs down"
                  onPress={handleThumbsDown}
                  {...(Platform.OS === 'web'
                    ? ({ onClick: handleThumbsDown } as any)
                    : {})}
                >
                  <ThumbsDown size={18} color={currentImageFeedback?.rating === 'negative' ? '#fff' : TERMINAL.colors.error} />
                </Pressable>
                
                {currentImageFeedback?.rating === 'negative' && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.feedbackButton,
                      styles.regenerateButton,
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Regenerate image"
                    onPress={() => submitNegativeFeedback(true)}
                    {...(Platform.OS === 'web'
                      ? ({
                          onClick: () => submitNegativeFeedback(true),
                        } as any)
                      : {})}
                  >
                    <RefreshCw size={18} color={TERMINAL.colors.cyan} />
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}
      </View>

      {/* Dev Mode: Prompt overlay panel over the image (scrollable) */}
      {showPromptOverlay && (
        <View style={[styles.promptPanel, { pointerEvents: 'auto' as const }]}>
          <View style={styles.promptPanelHeader}>
            <View style={styles.promptPanelHeaderText}>
              <Text style={styles.promptPanelTitle}>IMAGE PROMPT</Text>
              {!!promptContextLabel && (
                <Text style={styles.promptPanelSubtitle}>{promptContextLabel}</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setShowPromptOverlay(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={20} color={TERMINAL.colors.textBody} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.promptPanelScroll} contentContainerStyle={styles.promptPanelScrollContent}>
            {isLoadingPrompt ? (
              <ActivityIndicator size="small" color={TERMINAL.colors.cyan} />
            ) : (
              <Text style={styles.promptPanelText} selectable>{promptText || 'No prompt available.'}</Text>
            )}
          </ScrollView>
        </View>
      )}

      {/* Dev Mode: Feedback Modal */}
      <Modal
        visible={showFeedbackModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFeedbackModal(false)}
      >
        <View style={styles.feedbackModalOverlay}>
          <View style={styles.feedbackModal}>
            <View style={styles.feedbackModalHeader}>
              <View style={styles.feedbackModalHeaderIcon}>
                <ThumbsDown size={24} color={TERMINAL.colors.error} />
              </View>
              <Text style={styles.feedbackModalTitle}>IMAGE FEEDBACK</Text>
              <TouchableOpacity
                style={styles.feedbackModalClose}
                onPress={() => setShowFeedbackModal(false)}
              >
                <X size={20} color={TERMINAL.colors.muted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.feedbackModalSubtitle}>
              WHAT'S WRONG WITH THIS IMAGE?
            </Text>

            <ScrollView style={styles.feedbackCategoriesScroll} showsVerticalScrollIndicator={false}>
              {feedbackCategoryEntries.map(([categoryKey, category]) => (
                <View key={categoryKey} style={styles.feedbackCategoryContainer}>
                  <TouchableOpacity 
                    style={[
                      styles.feedbackCategoryHeader,
                      expandedCategory === categoryKey && styles.feedbackCategoryHeaderExpanded,
                      category.reasons.some(r => selectedReasons.includes(r)) && styles.feedbackCategoryHeaderActive
                    ]}
                    onPress={() => toggleCategory(categoryKey)}
                  >
                    <Text style={[
                      styles.feedbackCategoryLabel,
                      expandedCategory === categoryKey && styles.feedbackCategoryLabelExpanded
                    ]}>
                      {category.label}
                    </Text>
                    {category.reasons.some(r => selectedReasons.includes(r)) && (
                      <View style={styles.feedbackCategoryBadge}>
                        <Text style={styles.feedbackCategoryBadgeText}>
                          {category.reasons.filter(r => selectedReasons.includes(r)).length}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.feedbackCategoryExpandIcon}>
                      {expandedCategory === categoryKey ? '−' : '+'}
                    </Text>
                  </TouchableOpacity>
                  
                  {expandedCategory === categoryKey && (
                    <View style={styles.feedbackReasonGrid}>
                      {category.reasons.map((reasonKey) => (
                        <TouchableOpacity
                          key={reasonKey}
                          style={[
                            styles.feedbackReasonButton,
                            selectedReasons.includes(reasonKey) && styles.feedbackReasonButtonActive,
                          ]}
                          onPress={() => toggleReason(reasonKey)}
                        >
                          <Text style={[
                            styles.feedbackReasonText,
                            selectedReasons.includes(reasonKey) && styles.feedbackReasonTextActive,
                          ]}>
                            {FEEDBACK_REASON_LABELS[reasonKey].toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>

            <View style={styles.feedbackNotesContainer}>
              <View style={styles.feedbackNotesHeader}>
                <MessageSquare size={14} color={TERMINAL.colors.muted} />
                <Text style={styles.feedbackNotesLabel}>ADDITIONAL NOTES (OPTIONAL)</Text>
              </View>
              <TextInput
                style={styles.feedbackNotesInput}
                value={feedbackNotes}
                onChangeText={setFeedbackNotes}
                placeholder="Describe what should be different..."
                placeholderTextColor={TERMINAL.colors.muted}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.feedbackModalActions}>
              <TouchableOpacity
                style={styles.feedbackSubmitButton}
                onPress={() => submitNegativeFeedback(false)}
              >
                <Text style={styles.feedbackSubmitButtonText}>SAVE FEEDBACK</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.feedbackRegenerateButton}
                onPress={() => submitNegativeFeedback(true)}
              >
                <RefreshCw size={16} color={TERMINAL.colors.cyan} />
                <Text style={styles.feedbackRegenerateButtonText}>SAVE & REGENERATE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: TERMINAL.colors.primary,
    fontWeight: '900',
    letterSpacing: 2,
  },
  progressBarContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    zIndex: 100,
  },
  progressBar: {
    height: '100%',
    backgroundColor: TERMINAL.colors.primary,
  },
  // Pre-choice indicator - subtle border glow indicating an upcoming decision
  preChoiceIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: withAlpha(TERMINAL.colors.primary, 0.4),
    zIndex: 10,
    shadowColor: TERMINAL.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  imageContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  fullBleedImage: {
    width: '100%',
    height: '100%',
  },
  placeholderBackground: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bgHighlight,
  },
  gradientOverlay: sharedStyles.gradientOverlay,
  uiOverlay: sharedStyles.uiOverlay,
  contentScrollView: sharedStyles.contentScrollView,
  contentContainer: sharedStyles.contentContainer,
  textPanel: sharedStyles.textPanel,
  resolutionPanel: sharedStyles.resolutionPanel,
  resolutionText: sharedStyles.resolutionText,
  echoPanel: {
    backgroundColor: 'rgba(10, 10, 12, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: RADIUS.choice,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  echoSummaryText: {
    color: TERMINAL.colors.textLight,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  echoProgressText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
    marginTop: 4,
  },
  choicesList: {
    gap: 12,
  },
  costPanel: {
    ...sharedStyles.sectionCard,
    marginTop: 16,
    borderColor: withAlpha(TERMINAL.colors.amber, 0.35),
    backgroundColor: withAlpha(TERMINAL.colors.amber, 0.08),
  },
  costPanelLabel: { ...sharedStyles.sectionEyebrow, color: TERMINAL.colors.amber, marginBottom: 6 },
  costPanelTitle: { ...sharedStyles.sectionCardTitle, marginBottom: 6 },
  costPanelMeta: {
    color: TERMINAL.colors.textLight,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  costPanelBody: sharedStyles.sectionCardBody,
  costPanelLingering: { ...sharedStyles.sectionCardMeta, marginTop: 8 },
  recapEyebrow: { ...sharedStyles.sectionEyebrow, color: TERMINAL.colors.primary },
  recapTitle: sharedStyles.sectionTitle,
  recapSection: sharedStyles.sectionGroup,
  recapSectionTitle: sharedStyles.sectionGroupTitle,
  recapCard: sharedStyles.sectionCard,
  recapChoiceText: sharedStyles.sectionCardTitle,
  recapBodyText: sharedStyles.sectionCardBody,
  recapMetaText: sharedStyles.sectionCardMeta,
  recapAltRow: sharedStyles.sectionAltRow,
  recapAltBullet: sharedStyles.sectionAltBullet,
  recapAltText: sharedStyles.sectionAltText,
  continueButton: sharedStyles.continueButton,
  continueText: sharedStyles.continueText,
  // Dev Mode: Scene/Beat badge
  devSceneBeatBadge: {
    position: (Platform.OS === 'web' ? ('fixed' as any) : 'absolute') as any,
    top: Platform.OS === 'ios' ? 56 : 26,
    left: 68,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.35)',
    zIndex: 999999,
    elevation: 999999,
  },
  devSceneBeatText: {
    color: TERMINAL.colors.cyan,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  // Dev Mode: Toolbar styles
  feedbackToolbar: {
    // On web, ScrollView/overflow can create stacking contexts that swallow clicks.
    // Using fixed positioning avoids that and makes the toolbar reliably clickable.
    position: (Platform.OS === 'web' ? ('fixed' as any) : 'absolute') as any,
    top: 50,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    zIndex: 999999,
    elevation: 999999,
  },
  feedbackButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
  },
  promptButton: {
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  navButton: {
    borderColor: 'rgba(148, 163, 184, 0.25)',
  },
  thumbsUpButton: {
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  thumbsDownButton: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  regenerateButton: {
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  // Dev Mode: Prompt panel (overlay over image area)
  promptPanel: {
    position: (Platform.OS === 'web' ? ('fixed' as any) : 'absolute') as any,
    top: 110,
    left: 16,
    right: 16,
    maxHeight: SCREEN_HEIGHT * 0.45,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.25)',
    zIndex: 999999,
    elevation: 999999,
  },
  promptPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  promptPanelHeaderText: {
    flex: 1,
    paddingRight: 12,
  },
  promptPanelTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 2,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  promptPanelSubtitle: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: TERMINAL.colors.mutedLight,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  promptPanelScroll: {
    flexGrow: 0,
  },
  promptPanelScrollContent: {
    paddingBottom: 6,
  },
  promptPanelText: {
    fontSize: 12,
    lineHeight: 18,
    color: TERMINAL.colors.textBody,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  feedbackButtonActive: {
    backgroundColor: TERMINAL.colors.primary,
    borderColor: TERMINAL.colors.primary,
  },
  feedbackButtonActiveNegative: {
    backgroundColor: TERMINAL.colors.error,
    borderColor: TERMINAL.colors.error,
  },
  regeneratingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  regeneratingText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 1,
  },
  feedbackSubmittedIndicator: {
    backgroundColor: withAlpha(TERMINAL.colors.primary, 0.2),
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.primary, 0.3),
  },
  feedbackSubmittedText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 1,
  },
  // Feedback Modal styles
  feedbackModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-end',
  },
  feedbackModal: {
    backgroundColor: TERMINAL.colors.bgHighlight,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 40,
  },
  feedbackModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  feedbackModalHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  feedbackModalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  feedbackModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackModalSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
    marginBottom: 16,
  },
  feedbackReasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  feedbackReasonButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  feedbackReasonButtonActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: TERMINAL.colors.error,
  },
  feedbackReasonText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },
  feedbackReasonTextActive: {
    color: TERMINAL.colors.error,
  },
  // Categorized feedback styles
  feedbackCategoriesScroll: {
    maxHeight: 300,
    marginBottom: 16,
  },
  feedbackCategoryContainer: {
    marginBottom: 8,
  },
  feedbackCategoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  feedbackCategoryHeaderExpanded: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  feedbackCategoryHeaderActive: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  feedbackCategoryLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  feedbackCategoryLabelExpanded: {
    color: 'white',
  },
  feedbackCategoryBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
  feedbackCategoryBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.error,
  },
  feedbackCategoryExpandIcon: {
    fontSize: 16,
    fontWeight: '300',
    color: TERMINAL.colors.muted,
    width: 20,
    textAlign: 'center',
  },
  feedbackNotesContainer: {
    marginBottom: 24,
  },
  feedbackNotesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  feedbackNotesLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  feedbackNotesInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 16,
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  feedbackModalActions: {
    gap: 12,
  },
  feedbackSubmitButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  feedbackSubmitButtonText: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  feedbackRegenerateButton: {
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  feedbackRegenerateButtonText: {
    fontSize: 12,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 1,
  },
  // Storylet styles (GDD 6.7 - aftermath sequences)
  // Tone badge that sits inside the textPanel above the narrative text
  storyletToneBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  storyletToneLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
  },
  storyletContinueButton: {
    ...sharedStyles.continueButton,
    marginTop: 20,
  },
  storyletContinueText: sharedStyles.continueText,
});
