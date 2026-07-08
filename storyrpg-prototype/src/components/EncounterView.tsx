// @ts-nocheck — TODO(tech-debt): Phase 7 data-model consolidation will align
// Beat | EncounterBeat unions with EncounterView and restore whole-file typecheck.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {
  useGameActions,
  useGameEncounterState,
  useGamePlayerState,
  useGameStoryState,
} from '../stores/gameStore';
import { useImageFeedbackStore } from '../stores/imageFeedbackStore';
import {
  Encounter,
  EncounterPhase,
  Beat,
  Choice,
  PlayerState,
  SkillAdvantage,
  EncounterApproach,
  EnvironmentalElement,
  NPCEncounterState,
  PixarStakes,
  EscalationTrigger,
  EncounterBeat,
  EncounterChoice,
  EncounterChoiceOutcome,
  EmbeddedEncounterChoice,
  EncounterOutcome,
  AppliedConsequence,
} from '../types';
import { OutcomeHeader } from './OutcomeHeader';
import { StatCheckOverlay } from './StatCheckOverlay';
import { computeEncounterWeights } from '../engine/resolutionEngine';
import { evaluateCondition } from '../engine/conditionEvaluator';
import {
  processBeat,
  executeChoice,
  findBeat,
  findChoice,
  getChoiceAvailability,
  ProcessedBeat,
  ProcessedChoice,
} from '../engine/storyEngine';
import {
  buildEncounterConsequencePayload,
  type EncounterOutcomeTier,
} from '../engine/encounterConsequences';
import { resolveChoiceSkillDisplay } from '../utils/choiceSkillDisplay';

/**
 * Returns the effective stat bonus from a choice's statBonus field
 * if the condition is met for the given player state.
 */
function resolveStatBonus(
  choice: EncounterChoice | EmbeddedEncounterChoice,
  player: PlayerState
): number {
  if (!choice.statBonus) return 0;
  try {
    const conditionMet = evaluateCondition(choice.statBonus.condition as any, player);
    return conditionMet ? choice.statBonus.difficultyReduction : 0;
  } catch {
    return 0;
  }
}

/**
 * Availability of an encounter choice — thin wrapper over the engine's shared
 * getChoiceAvailability (encounter unification W1: this file previously
 * re-implemented the condition/lock/reason skeleton by hand).
 */
function getEncounterChoiceAvailability(
  choice: EncounterChoice | EmbeddedEncounterChoice,
  player: PlayerState,
  currentStory?: { [key: string]: any } | null
): { visible: boolean; isLocked: boolean; lockedReason?: string } {
  return getChoiceAvailability(choice as any, player, currentStory as any);
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
import { NarrativeText } from './NarrativeText';
import { ChoiceButton } from './ChoiceButton';
import { haptics } from '../utils/haptics';
import { TERMINAL, RADIUS, TIMING, SPACING, sharedStyles, withAlpha } from '../theme';
import { useSettingsStore } from '../stores/settingsStore';
import { useClickDebounce } from '../utils/useDebounce';
import { processTemplate } from '../engine/templateProcessor';
import { FileText, X } from 'lucide-react-native';
import { useImagePromptOverlay } from '../hooks/useImagePromptOverlay';
import { formatSceneBeatLabelFromImageUrl, getImagePanelNumberFromStory } from '../utils/imagePromptDebug';
import { resolvePromptUrlFromImageUrl } from '../utils/imagePromptPaths';
import { ReadingShell } from './ReadingShell';
import { ContinueButton } from './ContinueButton';
import { CONTINUE_COPY } from '../theme/copy';

// ========================================
// BRANCHING TREE ENCOUNTER STATE
// ========================================

// A "Situation" is either an initial beat or an outcome's embedded nextSituation
interface CurrentSituation {
  // Display content
  setupText: string;
  situationImage?: string;
  
  // Choices available in this situation
  choices: (EncounterChoice | EmbeddedEncounterChoice)[];
  
  // If this is showing after an outcome, include the outcome info
  previousOutcome?: {
    tier: 'success' | 'complicated' | 'failure';
    narrativeText: string;
    outcomeImage?: string;
    choiceText?: string;
    outcomeSummary?: string;
  };
}

// Convert an EncounterBeat to a CurrentSituation.
// Evaluates setupTextVariants against player state so pre-encounter choices
// can shade the encounter's opening situation text.
function beatToSituation(beat: EncounterBeat, player: PlayerState): CurrentSituation {
  let setupText = beat.setupText;
  if (beat.setupTextVariants?.length) {
    for (const variant of beat.setupTextVariants) {
      try {
        if (evaluateCondition(variant.condition as any, player)) {
          setupText = variant.text;
          break;
        }
      } catch {
        // Ignore evaluation errors — fall back to base setupText
      }
    }
  }
  return {
    setupText,
    situationImage: beat.situationImage,
    choices: beat.choices || [],
  };
}

// Convert an outcome's nextSituation to a CurrentSituation
function outcomeSituationToCurrentSituation(
  outcome: EncounterChoiceOutcome,
): CurrentSituation | null {
  if (!outcome.nextSituation) return null;
  
  return {
    setupText: outcome.nextSituation.setupText,
    situationImage: outcome.nextSituation.situationImage,
    choices: outcome.nextSituation.choices || [],
    previousOutcome: {
      tier: outcome.tier,
      narrativeText: outcome.narrativeText,
      outcomeImage: outcome.outcomeImage,
    },
  };
}

function buildEncounterStateNarration(
  encounter: Encounter,
  encounterState: ReturnType<typeof useGameEncounterState>['encounterState']
): string[] {
  if (!encounterState) return [];

  const lines: string[] = [];
  for (const npc of encounter.npcStates || []) {
    const currentDisposition = encounterState.npcDispositions?.[npc.npcId];
    if (currentDisposition && currentDisposition !== npc.currentDisposition) {
      lines.push(`${npc.name} now seems ${currentDisposition}.`);
    }

    npc.tells?.forEach((tell, index) => {
      const tellId = `${npc.npcId}:${index}`;
      if (encounterState.revealedTells?.has(tellId)) {
        lines.push(`You catch a tell from ${npc.name}: ${tell.tellDescription}`);
      }
    });
  }

  return Array.from(new Set(lines));
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Clock component inspired by Blades in the Dark
// Supports fog of war (hidden threat clock) per GDD 6.8.8
interface ClockProps {
  name: string;
  filled: number;
  total: number;
  type: 'goal' | 'threat';
  hidden?: boolean;  // Fog of war - show approximate level instead of exact
  approximateLevel?: 'manageable' | 'growing' | 'dangerous' | 'critical';
}

const Clock: React.FC<ClockProps> = ({ name, filled, total, type, hidden, approximateLevel }) => {
  const color = type === 'goal' ? TERMINAL.colors.success : TERMINAL.colors.error;
  const bgColor = type === 'goal' ? withAlpha(TERMINAL.colors.success, 0.2) : withAlpha(TERMINAL.colors.error, 0.2);
  const hiddenColor = 'rgba(255, 255, 255, 0.1)';
  const prevFilledRef = useRef(filled);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const segmentAnims = useRef<Animated.Value[]>(
    Array.from({ length: total }, () => new Animated.Value(1))
  ).current;

  useEffect(() => {
    const prev = prevFilledRef.current;
    if (filled > prev) {
      const newSegments = [];
      for (let i = prev; i < filled && i < segmentAnims.length; i++) {
        segmentAnims[i].setValue(0);
        newSegments.push(
          Animated.spring(segmentAnims[i], { toValue: 1, friction: 4, tension: 120, useNativeDriver: Platform.OS !== 'web' })
        );
      }
      Animated.sequence([
        Animated.stagger(80, newSegments),
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 150, useNativeDriver: Platform.OS !== 'web' }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: Platform.OS !== 'web' }),
        ]),
      ]).start();
    }
    prevFilledRef.current = filled;
  }, [filled]);

  const getApproximateFill = () => {
    if (!hidden) return filled;
    switch (approximateLevel) {
      case 'manageable': return Math.floor(total * 0.25);
      case 'growing': return Math.floor(total * 0.5);
      case 'dangerous': return Math.floor(total * 0.75);
      case 'critical': return total - 1;
      default: return Math.floor(total * 0.5);
    }
  };
  
  const displayFilled = hidden ? getApproximateFill() : filled;

  const segments = [];
  for (let i = 0; i < total; i++) {
    const isFilled = hidden ? i < displayFilled : i < filled;
    segments.push(
      <Animated.View 
        key={i} 
        style={[
          clockStyles.segment,
          { 
            backgroundColor: hidden 
              ? (isFilled ? hiddenColor : 'transparent') 
              : (isFilled ? color : bgColor),
            transform: [{ scale: segmentAnims[i] || new Animated.Value(1) }],
          },
          hidden && { borderColor: 'rgba(255,255,255,0.1)' }
        ]} 
      />
    );
  }
  
  const getApproximateLabel = () => {
    switch (approximateLevel) {
      case 'manageable': return 'LOW';
      case 'growing': return 'RISING';
      case 'dangerous': return 'HIGH';
      case 'critical': return 'CRITICAL';
      default: return '???';
    }
  };
  
  return (
    <Animated.View style={[clockStyles.container, { transform: [{ scale: pulseAnim }] }]}>
      <Text style={[clockStyles.label, { color: hidden ? '#888' : color }]}>
        {(name || '').toUpperCase()}
      </Text>
      <View style={clockStyles.segments}>{segments}</View>
      <Text style={clockStyles.count}>
        {hidden ? getApproximateLabel() : `${filled}/${total}`}
      </Text>
    </Animated.View>
  );
};

// Skill Advantage Badge (GDD 6.8.3)
interface SkillAdvantageBadgeProps {
  advantage: SkillAdvantage;
}

const SkillAdvantageBadge: React.FC<SkillAdvantageBadgeProps> = ({ advantage }) => {
  const colors = {
    slight: { bg: withAlpha(TERMINAL.colors.success, 0.2), text: TERMINAL.colors.success },
    significant: { bg: withAlpha(TERMINAL.colors.success, 0.4), text: TERMINAL.colors.success },
    mastery: { bg: 'rgba(250, 204, 21, 0.4)', text: '#facc15' },
  };
  const style = colors[advantage.advantageLevel] || colors.slight;
  
  return (
    <View style={[skillBadgeStyles.container, { backgroundColor: style.bg }]}>
      <Text style={[skillBadgeStyles.text, { color: style.text }]}>
        {advantage.advantageLevel === 'mastery' ? '★ ' : '+ '}
        {advantage.skill.toUpperCase()}
      </Text>
    </View>
  );
};

const skillBadgeStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 4,
  },
  text: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

const clockStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
  },
  label: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  segments: {
    flexDirection: 'row',
    gap: 3,
  },
  segment: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  count: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    marginTop: 2,
  },
});

interface EncounterViewProps {
  encounter: Encounter;
  onComplete: (outcome: EncounterOutcome, feedback?: AppliedConsequence[], lastImage?: string) => void;
  /** Scene-seam transition line (scene.timeline.transitionIn) shown above the
   * encounter's opening situation so entering an encounter never plays as a
   * location/time teleport. */
  transitionIn?: string;
}

// New simplified state for branching tree encounters
type EncounterScreenState =
  // Active encounter - showing situation with choices
  | { 
      type: 'active'; 
      situation: CurrentSituation;
      phaseId?: string;  // For legacy compatibility
    }
  // Results beat - showing outcome of a choice before advancing to next situation
  | {
      type: 'outcome_result';
      tier: 'success' | 'complicated' | 'failure';
      narrativeText: string;
      outcomeImage?: string;
      choiceText?: string;
      outcomeSummary?: string;
      consequences: AppliedConsequence[];
      pendingNextSituation: CurrentSituation;
      pendingPhaseId?: string;
    }
  // Terminal outcome - encounter is ending
  | { 
      type: 'terminal'; 
      outcome: EncounterOutcome;
      tier: 'success' | 'complicated' | 'failure';
      finalNarrative: string;
      finalImage?: string;
      choiceText?: string;
      outcomeSummary?: string;
    }
  // Legacy: phase-based (for backward compatibility with old encounter format)
  | { type: 'phase'; phaseId: string; beatId: string }
  | { type: 'beat_outcome'; phaseId: string; beatId: string; choiceId: string; outcome: 'success' | 'complicated' | 'failure'; nextBeatId?: string; choiceText?: string; outcomeSummary?: string }
  | { type: 'phase_outcome'; phaseId: string; outcome: 'success' | 'failure'; imageIndex: number }
  | { type: 'encounter_outcome'; outcome: EncounterOutcome; tier: 'success' | 'complicated' | 'failure'; narrativeText: string; choiceText?: string; outcomeSummary?: string };

/**
 * Resolve encounter outcome tier. When window.__QA_FORCE_TIER is set
 * (by Playwright E2E tests), that tier is used deterministically instead
 * of the random roll. This lets automated QA test all outcome paths.
 */
function resolveOutcomeTier(
  weights: { success: number; complicated: number; failure: number },
): 'success' | 'complicated' | 'failure' {
  // Dev/E2E builds only: a player could otherwise set this from the console to
  // force outcomes in the shipping reader.
  if (__DEV__ && typeof window !== 'undefined') {
    const forced = (window as any).__QA_FORCE_TIER as string | undefined;
    if (forced === 'success' || forced === 'complicated' || forced === 'failure') {
      return forced;
    }
  }
  const rand = Math.random();
  if (rand < weights.success) return 'success';
  if (rand < weights.success + weights.complicated) return 'complicated';
  return 'failure';
}

// Helper to detect if encounter uses new branching tree format
function isTreeBasedEncounter(encounter: Encounter): boolean {
  const firstPhase = encounter.phases?.[0];
  if (!firstPhase?.beats?.[0]) return false;
  
  const firstBeat = firstPhase.beats[0] as EncounterBeat;
  if (!firstBeat.choices?.[0]) return false;
  
  // Check if first choice has embedded nextSituation (new format)
  const firstChoice = firstBeat.choices[0];
  const outcomes = firstChoice.outcomes;
  if (!outcomes) return false;
  
  // If any outcome has nextSituation instead of just nextBeatId, it's tree-based
  return !!(outcomes.success?.nextSituation || outcomes.complicated?.nextSituation || outcomes.failure?.nextSituation);
}

const ENCOUNTER_TIER_SUMMARIES: Record<EncounterOutcomeTier, string> = {
  success: 'The moment bends your way.',
  complicated: 'You get through, but not cleanly.',
  failure: 'The situation turns against you.',
};

const ENCOUNTER_TIER_FALLBACKS: Record<EncounterOutcomeTier, string> = {
  success: 'The opening holds, and the moment bends your way.',
  complicated: 'You get through, but the moment leaves a mark.',
  failure: 'The move collapses, and danger closes in.',
};

function getEncounterBeatNumber(encounter?: Encounter | null, phaseId?: string | null, beatId?: string | null): number | null {
  if (!encounter?.phases || !beatId) return null;

  let beatNumber = 0;
  for (const phase of encounter.phases) {
    for (const beat of phase.beats ?? []) {
      beatNumber += 1;
      if (beat.id === beatId && (!phaseId || phase.id === phaseId)) {
        return beatNumber;
      }
    }
  }

  return null;
}

function formatDevBeatLabel(beatId?: string | null, beatNumber?: number | null): string | null {
  if (beatNumber) return `B${beatNumber}`;
  if (!beatId) return null;
  const beatNum =
    beatId.match(/beat-([0-9]+[a-z]?)/i)?.[1] ||
    beatId.match(/\bb([0-9]+[a-z]?)\b/i)?.[1];
  return beatNum ? `B${beatNum}` : beatId;
}

function formatDevSceneLabel(sceneId?: string | null): string | null {
  if (!sceneId) return null;
  const sceneNum =
    sceneId.match(/scene-([0-9]+[a-z]?)/i)?.[1] ||
    sceneId.match(/\bs([0-9]+-[0-9]+[a-z]?)\b/i)?.[1];
  return sceneNum ? `Scene ${sceneNum}` : null;
}

function tierFromEncounterOutcome(outcome: EncounterOutcome): EncounterOutcomeTier {
  if (outcome === 'victory') return 'success';
  if (outcome === 'defeat') return 'failure';
  return 'complicated';
}

function lowercaseFirst(value: string): string {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
}

function sentenceFromChoiceText(choiceText?: string): string | undefined {
  const text = choiceText?.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (!text) return undefined;

  const withoutYou = text.match(/^you\s+(.+)$/i)?.[1];
  const action = withoutYou || text;
  const dont = action.match(/^don['’]?t\s+(.+)$/i)?.[1];
  if (dont) {
    return `You chose not to ${lowercaseFirst(dont)}.`;
  }
  return `You chose to ${lowercaseFirst(action)}.`;
}

function summarizeEncounterOutcome(text?: string): string | undefined {
  const normalized = text?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  const sentenceMatch = normalized.match(/^(.+?[.!?])(?:\s|$)/);
  const firstSentence = sentenceMatch?.[1] || normalized;
  if (firstSentence.length <= 150) return firstSentence;

  const trimmed = firstSentence.slice(0, 147);
  const lastBreak = Math.max(trimmed.lastIndexOf(','), trimmed.lastIndexOf(';'), trimmed.lastIndexOf(' '));
  return `${trimmed.slice(0, lastBreak > 80 ? lastBreak : 147).trim()}...`;
}

export const EncounterView: React.FC<EncounterViewProps> = ({
  encounter,
  onComplete,
  transitionIn,
}) => {
  const { player } = useGamePlayerState();
  const { currentStory } = useGameStoryState();
  const { encounterState } = useGameEncounterState();
  const {
    startEncounter,
    updateEncounterPhase,
    addGoalProgress,
    addThreatProgress,
    addEncounterScore,
    advanceEncounterBeat,
    applyConsequences,
    queueDelayedConsequence,
    endEncounter,
    setEncounterApproach,
    recordOutcome,
    activateEnvironmentalElement,
    checkEscalationTriggers,
    triggerEscalation,
    revealThreatClock,
    revealNPCTell,
    updateNPCDisposition,
    useEnvironmentalElement,
    getEncounterProgress,
  } = useGameActions();

  const developerMode = useSettingsStore((state) => state.developerMode);
  const fonts = useSettingsStore((state) => state.getFontSizes());
  const { getFeedbackForImage, loadFeedback, isLoaded: feedbackLoaded } = useImageFeedbackStore();

  useEffect(() => {
    if (!feedbackLoaded) {
      loadFeedback();
    }
  }, [feedbackLoaded, loadFeedback]);

  const resolveImageUrl = useCallback((url?: string): string | undefined => {
    if (!url) return undefined;
    return getFeedbackForImage(url)?.regeneratedImageUrl || url;
  }, [getFeedbackForImage]);

  const applyResolvedEncounterOutcome = useCallback((
    choiceId: string,
    tier: EncounterOutcomeTier,
    outcome?: EncounterChoiceOutcome,
  ): AppliedConsequence[] => {
    const payload = buildEncounterConsequencePayload({
      encounterId: encounter.id,
      choiceId,
      tier,
      outcome,
    });

    for (const delayed of payload.delayedConsequences) {
      queueDelayedConsequence({
        id: `enc-dc-${encounter.id}-${choiceId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        consequence: delayed.consequence,
        description: delayed.description,
        delay: delayed.delay,
        triggerCondition: delayed.triggerCondition,
        sourceSceneId: encounter.id,
        sourceChoiceId: choiceId,
        scenesElapsed: 0,
        episodesElapsed: 0,
        fired: false,
      });
    }

    return payload.consequences.length > 0
      ? applyConsequences(payload.consequences as any)
      : [];
  }, [applyConsequences, encounter.id, queueDelayedConsequence]);

  const getSceneBeatLabelFromImageUrl = useCallback((url?: string): string | null => {
    return formatSceneBeatLabelFromImageUrl(url, encounter?.id);
  }, [encounter?.id]);

  // Helper: process encounter text through template processor (resolves {{player.name}} etc.)
  const tpl = useCallback((text: string): string => {
    if (!text) return text;
    return processTemplate(text, player, currentStory);
  }, [player, currentStory]);

  const encounterSceneId = encounter.id?.replace(/-encounter$/, '') || '';
  const encounterSceneLabel = useMemo(() => {
    const sceneLabel = formatDevSceneLabel(encounter.id);
    return sceneLabel ? `${sceneLabel} • Encounter` : 'Encounter';
  }, [encounter.id]);

  // Detect if this encounter uses the new branching tree format
  const isTreeBased = isTreeBasedEncounter(encounter);

  const [screenState, setScreenState] = useState<EncounterScreenState>({
    type: 'phase',
    phaseId: encounter.startingPhaseId,
    beatId: '',
  });

  const {
    showPromptOverlay,
    setShowPromptOverlay,
    promptText,
    isLoadingPrompt,
    promptContextLabel,
    fetchPrompt: fetchImagePrompt,
  } = useImagePromptOverlay({
    getContextLabel: getSceneBeatLabelFromImageUrl,
    resolvePromptUrl: ({ imageUrl }) => {
      if (imageUrl.startsWith('data:')) {
        const outputDir = currentStory?.outputDir;
        if (!outputDir || !encounterSceneId) {
          return null;
        }
        const hostname = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
        const baseUrl = `http://${hostname}:3001`;
        const dir = outputDir.replace(/^\/app\//, '').replace(/\/$/, '');
        const beatId = ('beatId' in screenState ? screenState.beatId : undefined) || 'beat-1';
        return `${baseUrl}/${dir}/images/prompts/encounter-${encounterSceneId}-${beatId}-setup.json`;
      }
      return resolvePromptUrlFromImageUrl(imageUrl);
    },
  });
  const [processedBeat, setProcessedBeat] = useState<ProcessedBeat | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showChoices, setShowChoices] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState<string | null>(null);
  const [outcomeText, setOutcomeText] = useState<string>('');
  const [imageErrorId, setImageErrorId] = useState<string | null>(null);

  // --- Cinematic reveal state ---
  const lastKnownImageRef = useRef<string | undefined>(undefined);
  const allEncounterFeedbackRef = useRef<AppliedConsequence[]>([]);
  const entrySituationTextRef = useRef<string | null>(null);
  const [showNextSituation, setShowNextSituation] = useState(false);
  const [vignetteColor, setVignetteColor] = useState<string | null>(null);
  const [encounterStatCheck, setEncounterStatCheck] = useState<{ skillName: string; tier: 'success' | 'complicated' | 'failure' } | null>(null);
  const encounterStatCheckProceedRef = useRef<(() => void) | null>(null);

  // Animated values for cinematic effects
  const vignetteAnim = useRef(new Animated.Value(0)).current;
  const screenShakeAnim = useRef(new Animated.Value(0)).current;
  const dividerAnim = useRef(new Animated.Value(0)).current;
  const choiceEntryAnims = useRef<Animated.Value[]>([]).current;

  const TIER_COLORS = useMemo(() => ({
    success: TERMINAL.colors.success,
    complicated: TERMINAL.colors.amber,
    failure: TERMINAL.colors.error,
  }), []);

  const buildEncounterChoiceEcho = useCallback((
    choice: EncounterChoice | EmbeddedEncounterChoice | undefined,
    tier: EncounterOutcomeTier,
    narrativeText?: string,
  ) => ({
    choiceText: choice?.feedbackCue?.echoSummary
      || sentenceFromChoiceText(
        choice?.text ? processTemplate(choice.text, player, currentStory) : undefined
      ),
    outcomeSummary: choice?.feedbackCue?.progressSummary
      || choice?.reminderPlan?.shortTerm
      || summarizeEncounterOutcome(narrativeText)
      || ENCOUNTER_TIER_SUMMARIES[tier],
  }), [player, currentStory]);

  // Fire vignette + screen shake based on outcome tier
  const playOutcomeEffects = useCallback((tier: 'success' | 'complicated' | 'failure') => {
    setVignetteColor(TIER_COLORS[tier]);
    vignetteAnim.setValue(0);
    Animated.sequence([
      Animated.timing(vignetteAnim, { toValue: 1, duration: TIMING.fast, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(vignetteAnim, { toValue: 0, duration: TIMING.slow, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();

    if (tier === 'failure') {
      screenShakeAnim.setValue(0);
      Animated.sequence([
        Animated.timing(screenShakeAnim, { toValue: 3, duration: 50, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(screenShakeAnim, { toValue: -3, duration: 50, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(screenShakeAnim, { toValue: 2, duration: 50, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(screenShakeAnim, { toValue: -2, duration: 50, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(screenShakeAnim, { toValue: 0, duration: 50, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
      ]).start();
    }
  }, [TIER_COLORS, vignetteAnim, screenShakeAnim]);

  // Stagger choice button entrance
  const animateChoiceEntrance = useCallback((count: number) => {
    choiceEntryAnims.length = 0;
    for (let i = 0; i < count; i++) {
      choiceEntryAnims.push(new Animated.Value(0));
    }
    Animated.stagger(100,
      choiceEntryAnims.map(a =>
        Animated.timing(a, { toValue: 1, duration: TIMING.fast, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' })
      )
    ).start();
  }, [choiceEntryAnims]);

  const animateDivider = useCallback(() => {
    dividerAnim.setValue(0);
    Animated.timing(dividerAnim, { toValue: 1, duration: TIMING.normal, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [dividerAnim]);

  // If the prompt panel is open and the encounter image changes, refresh prompt automatically.
  useEffect(() => {
    if (!showPromptOverlay) return;
    let currentImage: string | undefined;
    if (screenState.type === 'active') {
      const sit = screenState.situation;
      currentImage = resolveImageUrl(sit.previousOutcome?.outcomeImage || sit.situationImage);
    }
    if (!currentImage) return;
    fetchImagePrompt(currentImage);
  }, [screenState, fetchImagePrompt, showPromptOverlay, resolveImageUrl]);

  const syncEncounterStateSystems = useCallback((
    tier: 'success' | 'complicated' | 'failure',
    goalTicks: number,
    threatTicks: number,
    choiceApproach?: string
  ) => {
    recordOutcome(tier);

    const currentGoal = encounterState?.goalProgress || 0;
    const currentThreat = encounterState?.threatProgress || 0;
    const currentBeatNumber = encounterState?.beatNumber || 1;
    const nextGoal = Math.min(currentGoal + goalTicks, encounterState?.goalMax || encounter.goalClock.segments || 6);
    const nextThreat = Math.min(currentThreat + threatTicks, encounterState?.threatMax || encounter.threatClock.segments || 4);
    const nextBeatNumber = currentBeatNumber + 1;
    const goalPercent = (nextGoal / Math.max(1, encounterState?.goalMax || encounter.goalClock.segments || 6)) * 100;
    const threatPercent = (nextThreat / Math.max(1, encounterState?.threatMax || encounter.threatClock.segments || 4)) * 100;

    if (encounter.informationVisibility?.threatClockVisible === false && threatPercent > 0) {
      revealThreatClock();
    }

    for (const element of encounter.environmentalElements || []) {
      if (encounterState?.activeElements?.has(element.id)) continue;
      const condition = element.activationCondition;
      const meetsThreshold =
        (condition.type === 'goal_threshold' && goalPercent >= Number(condition.value)) ||
        (condition.type === 'threat_threshold' && threatPercent >= Number(condition.value)) ||
        (condition.type === 'beat_number' && nextBeatNumber >= Number(condition.value)) ||
        (condition.type === 'approach' && !!choiceApproach && String(condition.value).toLowerCase() === choiceApproach.toLowerCase());
      if (meetsThreshold) {
        activateEnvironmentalElement(element.id);
      }
    }

    for (const npc of encounter.npcStates || []) {
      const shift = npc.dispositionShifts?.find((candidate) => {
        switch (candidate.trigger) {
          case 'player_success':
            return tier === 'success';
          case 'player_failure':
            return tier === 'failure';
          case 'goal_high':
            return goalPercent >= 75;
          case 'threat_high':
            return threatPercent >= 75;
          default:
            return false;
        }
      });
      if (shift) {
        updateNPCDisposition(npc.npcId, shift.newDisposition);
      }

      npc.tells?.forEach((tell, index) => {
        const tellId = `${npc.npcId}:${index}`;
        if (encounterState?.revealedTells?.has(tellId)) return;
        const shouldReveal =
          (tell.revealCondition === 'player_success' && tier === 'success') ||
          (tell.revealCondition === 'player_failure' && tier === 'failure') ||
          (tell.revealCondition === 'high_threat' && threatPercent >= 75) ||
          (tell.revealCondition === 'encounter_50_percent' && ((goalPercent + threatPercent) / 2) >= 50);
        if (shouldReveal) {
          revealNPCTell(tellId);
        }
      });
    }

    for (const trigger of encounter.escalationTriggers || []) {
      if (encounterState?.triggeredEscalations?.has(trigger.id)) continue;
      const shouldTrigger =
        (trigger.condition.type === 'goal_threshold' && goalPercent >= Number(trigger.condition.value)) ||
        (trigger.condition.type === 'threat_threshold' && threatPercent >= Number(trigger.condition.value)) ||
        (trigger.condition.type === 'beat_number' && nextBeatNumber >= Number(trigger.condition.value)) ||
        (trigger.condition.type === 'consecutive_failures' &&
          ((tier === 'failure' ? (encounterState?.consecutiveFailures || 0) + 1 : 0) >= Number(trigger.condition.value)));
      if (shouldTrigger) {
        triggerEscalation(trigger.id, {
          escapeUnlocked: trigger.effect.unlockEscapeOption,
          pointOfNoReturn: trigger.effect.pointOfNoReturn,
        });
      }
    }
  }, [
    activateEnvironmentalElement,
    encounter,
    encounterState,
    recordOutcome,
    revealNPCTell,
    revealThreatClock,
    triggerEscalation,
    updateNPCDisposition,
  ]);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const imageOpacity = useRef(new Animated.Value(1)).current;
  const scrollViewRef = useRef<ScrollView>(null);

  // On web, RN Web's <Image> uses CSS transitions for a fade-in effect:
  // it sets opacity:0 on the <img> then transitions to 1 on load. But when
  // the image loads inside a container that has opacity:0 (from transitionTo's
  // animation), browsers skip/suppress the CSS transition. The <img> stays at
  // opacity:0 even after the parent becomes visible. Track whether we need to
  // force-disable the Image fade on web for certain screens.
  const webDisableImageFade = Platform.OS === 'web';

  // Get current phase - handle all screen states that have phaseId
  const getPhaseId = (): string => {
    switch (screenState.type) {
      case 'phase':
      case 'beat_outcome':
      case 'phase_outcome':
        return screenState.phaseId;
      case 'active':
        return screenState.phaseId || '';
      default:
        return '';
    }
  };
  const currentPhase = encounter.phases.find((p) => p.id === getPhaseId());

  const encounterDevLabel = useMemo(() => {
    const phaseId = getPhaseId();
    const screenBeatId = 'beatId' in screenState ? screenState.beatId : undefined;
    const screenNextBeatId = 'nextBeatId' in screenState ? screenState.nextBeatId : undefined;
    const screenBeatLabel = formatDevBeatLabel(
      screenBeatId,
      getEncounterBeatNumber(encounter, phaseId, screenBeatId)
    );
    const resultBeatLabel = formatDevBeatLabel(
      screenNextBeatId || screenBeatId,
      getEncounterBeatNumber(encounter, phaseId, screenNextBeatId || screenBeatId)
    );
    const numberedBeat = encounterState?.beatNumber ? `B${encounterState.beatNumber}` : null;
    switch (screenState.type) {
      case 'phase':
        return [encounterSceneLabel, screenBeatLabel].filter(Boolean).join(' • ');
      case 'beat_outcome':
        return [encounterSceneLabel, resultBeatLabel, 'Result'].filter(Boolean).join(' • ');
      case 'phase_outcome':
      case 'encounter_outcome':
      case 'terminal':
        return [encounterSceneLabel, 'Result'].filter(Boolean).join(' • ');
      case 'outcome_result':
        return [encounterSceneLabel, numberedBeat, 'Result'].filter(Boolean).join(' • ');
      case 'active':
        return [encounterSceneLabel, numberedBeat].filter(Boolean).join(' • ');
      default:
        return encounterSceneLabel;
    }
  }, [encounter, encounterSceneLabel, encounterState?.beatNumber, screenState]);

  // Initialize encounter on mount
  useEffect(() => {
    // Initialize with clock parameters from encounter or defaults
    const goalMax = encounter.goalClock?.segments || 6;
    const threatMax = encounter.threatClock?.segments || 4;
    startEncounter(encounter.id, encounter.startingPhaseId, goalMax, threatMax);

    const startPhase = encounter.phases.find((p) => p.id === encounter.startingPhaseId);
    if (startPhase && startPhase.beats.length > 0) {
      const firstBeat = startPhase.beats[0] as EncounterBeat;
      
      // If this is a tree-based encounter, use the new state format
      if (isTreeBased && 'setupText' in firstBeat) {
        const initialSituation = beatToSituation(firstBeat, player);
        setScreenState({
          type: 'active',
          situation: initialSituation,
          phaseId: encounter.startingPhaseId,
        });
      } else {
        // Legacy encounter format
        setScreenState({
          type: 'phase',
          phaseId: encounter.startingPhaseId,
          beatId: startPhase.beats[0].id,
        });
      }
    }
  }, [encounter.id, isTreeBased]);

  // Process beat when it changes
  useEffect(() => {
    if (screenState.type !== 'phase' || !currentPhase || !currentStory) return;

    const beat = currentPhase.beats.find((b) => b.id === screenState.beatId);
    if (!beat) return;

    // Apply onShow consequences
    if (beat.onShow && beat.onShow.length > 0) {
      applyConsequences(beat.onShow);
    }

    const processed = processBeat(beat, player, currentStory);
    setProcessedBeat(processed);
    setIsAnimating(true);
    setShowChoices(false);
    setResolutionText(null);

    // ENSURE VISIBILITY: Force fadeAnim back to 1 in case of interruption
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: Platform.OS !== 'web',
    }).start();

    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    
    // SAFETY: Ensure isAnimating never gets permanently stuck
    const safetyTimeout = setTimeout(() => {
      setIsAnimating(false);
    }, 3000);
    
    return () => clearTimeout(safetyTimeout);
  }, [screenState, currentPhase, currentStory]);

  const handleAnimationComplete = () => {
    setIsAnimating(false);
    if (processedBeat?.hasChoices) {
      setShowChoices(true);
    }
  };

  // ========================================
  // TREE-BASED ENCOUNTER CHOICE HANDLER
  // ========================================
  
  const handleTreeChoicePress = useCallback((choiceId: string) => {
    if (screenState.type !== 'active') return;
    haptics.selection();
    
    const { situation } = screenState;
    const choice = situation.choices.find(c => c.id === choiceId);
    if (!choice || !choice.outcomes) {
      console.error('[EncounterView] Choice or outcomes not found:', choiceId);
      return;
    }
    const availability = getEncounterChoiceAvailability(choice, player, currentStory);
    if (!availability.visible || availability.isLocked) {
      console.warn('[EncounterView] Ignoring locked tree choice press:', choiceId);
      return;
    }
    
    console.log('[EncounterView] Tree choice pressed:', choiceId);
    
    // Determine outcome tier based on player stats (fiction-first - weighted by relevant skills)
    const statBonus = resolveStatBonus(choice, player);
    const weights = computeEncounterWeights(player, choice.primarySkill, statBonus);
    const tier = resolveOutcomeTier(weights);
    
    console.log('[EncounterView] Outcome tier:', tier, statBonus > 0 ? `(+${statBonus} stat bonus applied)` : '');
    
    const outcome = choice.outcomes[tier];
    if (!outcome) {
      console.error('[EncounterView] No outcome for tier:', tier);
      return;
    }

    const unlockedElement = encounter.environmentalElements?.find(
      (element) => element.effect.unlockChoiceId === choice.id
    );
    if (unlockedElement) {
      useEnvironmentalElement(unlockedElement.id);
    }

    const proceedWithOutcome = () => {
      // Update clocks
      const goalTicks = outcome.goalTicks || 0;
      const threatTicks = outcome.threatTicks || 0;
      
      if (goalTicks > 0) addGoalProgress(goalTicks);
      if (threatTicks > 0) addThreatProgress(threatTicks);
      
      // Legacy score for backward compatibility
      const scoreChange = tier === 'success' ? 3 : tier === 'complicated' ? 1 : -1;
      addEncounterScore(scoreChange);
      syncEncounterStateSystems(tier, goalTicks, threatTicks, choice.approach);
      
      // Apply outcome, cost, memory flags, and delayed aftermath.
      const applied = applyResolvedEncounterOutcome(choice.id, tier, outcome);
      const playerFacing = applied.filter(a => a.type !== 'flag');
      allEncounterFeedbackRef.current = [...allEncounterFeedbackRef.current, ...playerFacing];
      setShowNextSituation(false);
      const choiceEcho = buildEncounterChoiceEcho(choice, tier, outcome.narrativeText);

      // Fire cinematic outcome effects
      playOutcomeEffects(tier);
    
    // Check if this is a terminal outcome
    if (outcome.isTerminal || !outcome.nextSituation) {
      // Check clock states to determine final outcome
      const newGoalProgress = (encounterState?.goalProgress || 0) + goalTicks;
      const newThreatProgress = (encounterState?.threatProgress || 0) + threatTicks;
      const goalMax = encounterState?.goalMax || 6;
      const threatMax = encounterState?.threatMax || 4;
      
      let finalOutcome: EncounterOutcome;
      if (outcome.encounterOutcome) {
        finalOutcome = outcome.encounterOutcome;
      } else if (newGoalProgress >= goalMax && newThreatProgress < threatMax) {
        finalOutcome = 'victory';
      } else if (newThreatProgress >= threatMax) {
        finalOutcome = newGoalProgress >= goalMax ? 'partialVictory' : 'defeat';
      } else {
        // No explicit outcome and no nextSituation - default based on clock state
        finalOutcome = newGoalProgress > newThreatProgress ? 'victory' : 'defeat';
      }
      
      console.log('[EncounterView] Terminal outcome:', finalOutcome);
      console.log('[EncounterView] Terminal image candidates:', {
        outcomeImage: outcome.outcomeImage || '(none)',
        situationImage: (screenState.type === 'active' ? screenState.situation?.situationImage : undefined) || '(none)',
        encounterOutcomeImage: encounter.outcomes?.[finalOutcome]?.image || '(none)',
        lastPhaseSituationImage: encounter.phases?.[encounter.phases.length - 1]?.situationImage || '(none)',
        lastKnownImage: lastKnownImageRef.current || '(none)',
      });
      
      // Fallback chain: outcome image → situation image → encounter outcome image → last phase image → last known
      const terminalFinalImage = resolveImageUrl(
        outcome.outcomeImage
          || (screenState.type === 'active' ? screenState.situation?.situationImage : undefined)
          || encounter.outcomes?.[finalOutcome]?.image
          || encounter.phases?.[encounter.phases.length - 1]?.situationImage
          || lastKnownImageRef.current
      );
      console.log('[EncounterView] Terminal final image resolved:', terminalFinalImage || '(none)');
      
      transitionTo(() => {
        setScreenState({
          type: 'terminal',
          outcome: finalOutcome,
          tier,
          finalNarrative: outcome.narrativeText,
          finalImage: terminalFinalImage,
          ...choiceEcho,
        });
      });
      return;
    }
    
    // Non-terminal: show results beat before advancing to next situation
    if (!outcome.nextSituation) {
      console.error('[EncounterView] Non-terminal outcome missing nextSituation');
      return;
    }

    const nextSituation: CurrentSituation = {
      setupText: outcome.nextSituation.setupText,
      situationImage: outcome.nextSituation.situationImage,
      choices: outcome.nextSituation.choices || [],
    };
    
    console.log('[EncounterView] Showing results beat, then advancing to situation with', nextSituation.choices.length, 'choices');
    
    transitionTo(() => {
      setScreenState({
        type: 'outcome_result',
        tier,
        narrativeText: outcome.narrativeText,
        outcomeImage: outcome.outcomeImage || situation.situationImage || lastKnownImageRef.current,
        ...choiceEcho,
        consequences: playerFacing,
        pendingNextSituation: nextSituation,
        pendingPhaseId: screenState.phaseId,
      });
      setIsAnimating(true);
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    });
    };

    // Show stat check overlay when there's a skill involved, then proceed
    if (choice.primarySkill) {
      const skillLabel = (choice.primarySkill || '').replace(/_/g, ' ').toUpperCase();
      encounterStatCheckProceedRef.current = proceedWithOutcome;
      setEncounterStatCheck({ skillName: skillLabel, tier });
    } else {
      proceedWithOutcome();
    }
  }, [screenState, player, currentStory, encounterState, addGoalProgress, addThreatProgress, addEncounterScore, applyResolvedEncounterOutcome, syncEncounterStateSystems, buildEncounterChoiceEcho]);
  
  // Debounced tree choice handler
  const handleTreeChoice = useClickDebounce(handleTreeChoicePress, 500);

  // Execute encounter choice after selection ceremony
  const executeEncounterChoice = useCallback((choiceId: string) => {
    if (screenState.type !== 'phase' || !currentPhase || !processedBeat) return;

    const beat = currentPhase.beats.find((b) => b.id === screenState.beatId);
    if (!beat) {
      console.error('[EncounterView] Beat not found:', screenState.beatId);
      return;
    }

    const choice = beat.choices?.find((c) => c.id === choiceId);
    if (!choice) {
      console.error('[EncounterView] Choice not found:', choiceId);
      return;
    }

    console.log('[EncounterView] Choice pressed:', choiceId);

    const result = executeChoice(choice, player);
    if (!result.success) return;

    // Determine outcome tier based on player stats (fiction-first - weighted by relevant skills)
    const statBonus = resolveStatBonus(choice as EncounterChoice, player);
    const weights = computeEncounterWeights(player, choice.primarySkill, statBonus);
    const outcome = resolveOutcomeTier(weights);

    console.log('[EncounterView] Outcome tier:', outcome, statBonus > 0 ? `(+${statBonus} stat bonus applied)` : '');

    // Update clocks - use outcome-specific values if available, else defaults
    let goalTicks = 0;
    let threatTicks = 0;
    
    if ('outcomes' in choice && choice.outcomes && choice.outcomes[outcome]) {
      goalTicks = choice.outcomes[outcome].goalTicks ?? 0;
      threatTicks = choice.outcomes[outcome].threatTicks ?? 0;
    } else {
      // Fallback defaults (Blades in the Dark style)
      switch (outcome) {
        case 'success':
          goalTicks = 2;
          break;
        case 'complicated':
          goalTicks = 1;
          threatTicks = 1;
          break;
        case 'failure':
          threatTicks = 2;
          break;
      }
    }
    
    if (goalTicks > 0) addGoalProgress(goalTicks);
    if (threatTicks > 0) addThreatProgress(threatTicks);

    const unlockedElement = encounter.environmentalElements?.find(
      (element) => element.effect.unlockChoiceId === choice.id
    );
    if (unlockedElement) {
      useEnvironmentalElement(unlockedElement.id);
    }
    
    // Legacy score for backward compatibility
    const scoreChange = outcome === 'success' ? 3 : outcome === 'complicated' ? 1 : -1;
    addEncounterScore(scoreChange);
    syncEncounterStateSystems(outcome, goalTicks, threatTicks, choice.approach);

    const outcomeData = 'outcomes' in choice ? choice.outcomes?.[outcome] : undefined;
    const applied = applyResolvedEncounterOutcome(choice.id, outcome, outcomeData);
    const playerFacing = applied.filter(a => a.type !== 'flag');
    allEncounterFeedbackRef.current = [...allEncounterFeedbackRef.current, ...playerFacing];

    // Try to get narrative text from choice outcomes (EncounterChoice type)
    let narrativeText = '';
    if (outcomeData) {
      narrativeText = outcomeData.narrativeText || '';
    }
    
    // Fallback to generic text if no narrative provided
    if (!narrativeText) {
      narrativeText = ENCOUNTER_TIER_FALLBACKS[outcome];
    }
    
    // Determine next beat - prefer outcome's nextBeatId, then choice's, then result's
    let nextBeatId: string | undefined;
    if ('outcomes' in choice && choice.outcomes && choice.outcomes[outcome]?.nextBeatId) {
      nextBeatId = choice.outcomes[outcome].nextBeatId;
    } else {
      nextBeatId = choice.nextBeatId || result.nextBeatId;
    }
    
    // Show beat outcome screen (with choiceId for outcome-specific images)
    setScreenState({
      type: 'beat_outcome',
      phaseId: screenState.phaseId,
      beatId: beat.id,
      choiceId: choice.id,
      outcome,
      nextBeatId,
      ...buildEncounterChoiceEcho(choice as EncounterChoice, outcome, narrativeText),
    });
    
    setOutcomeText(narrativeText);
  }, [screenState, currentPhase, processedBeat, player, encounter, addGoalProgress, addThreatProgress, addEncounterScore, applyResolvedEncounterOutcome, buildEncounterChoiceEcho]);
  
  const handleChoicePressBase = useCallback((choiceId: string) => {
    if (screenState.type !== 'phase' || !currentPhase || !processedBeat || selectedChoiceId) return;
    haptics.selection();
    setSelectedChoiceId(choiceId);
    setTimeout(() => {
      executeEncounterChoice(choiceId);
      setSelectedChoiceId(null);
    }, 400);
  }, [screenState, currentPhase, processedBeat, selectedChoiceId, executeEncounterChoice]);

  // Debounced choice handler - prevents double-clicks
  const handleChoicePress = useClickDebounce(handleChoicePressBase, 500);

  const navigateAfterChoice = (nextBeatId?: string) => {
    if (screenState.type !== 'phase' || !currentPhase) return;

    if (nextBeatId) {
      // Go to next beat
      transitionTo(() => {
        setScreenState({
          type: 'phase',
          phaseId: screenState.phaseId,
          beatId: nextBeatId,
        });
      });
    } else {
      // Capture next beat ID to avoid non-null assertion
      const autoAdvanceNextBeatId = processedBeat?.nextBeatId;
      if (autoAdvanceNextBeatId) {
        // Auto-advance
        transitionTo(() => {
          setScreenState({
            type: 'phase',
            phaseId: screenState.phaseId,
            beatId: autoAdvanceNextBeatId,
          });
        });
      } else {
        // End of phase - check thresholds
        checkPhaseOutcome();
      }
    }
  };

  const checkPhaseOutcome = () => {
    if (!currentPhase || !encounterState) return;

    const { phaseScore } = encounterState;
    const successThreshold = currentPhase.successThreshold ?? 5;
    const failureThreshold = currentPhase.failureThreshold ?? -2;

    let outcome: 'success' | 'failure';
    if (phaseScore >= successThreshold) {
      outcome = 'success';
    } else if (phaseScore <= failureThreshold) {
      outcome = 'failure';
    } else {
      // Default to success if in the middle
      outcome = phaseScore >= 0 ? 'success' : 'failure';
    }

    const phaseOutcome = outcome === 'success' ? currentPhase.onSuccess : currentPhase.onFailure;

    if (phaseOutcome) {
      // Apply phase outcome consequences
      if (phaseOutcome.consequences) {
        applyConsequences(phaseOutcome.consequences);
      }

      // Show outcome sequence
      if (phaseOutcome.outcomeImages && phaseOutcome.outcomeImages.length > 0) {
        setOutcomeText(phaseOutcome.outcomeText);
        setScreenState({
          type: 'phase_outcome',
          phaseId: currentPhase.id,
          outcome,
          imageIndex: 0,
        });
      } else {
        // No images, just show text and move on
        setOutcomeText(phaseOutcome.outcomeText);

        if (phaseOutcome.nextPhaseId) {
          // Move to next phase
          const nextPhase = encounter.phases.find((p) => p.id === phaseOutcome.nextPhaseId);
          if (nextPhase) {
            setTimeout(() => {
              updateEncounterPhase(nextPhase.id);
              setScreenState({
                type: 'phase',
                phaseId: nextPhase.id,
                beatId: nextPhase.beats[0]?.id ?? '',
              });
            }, 2000);
          }
        } else {
          // Encounter ends
          const encounterOutcome = outcome === 'success' ? 'victory' : 'defeat';
          setTimeout(() => {
            handleEncounterEnd(encounterOutcome);
          }, 2000);
        }
      }
    } else {
      // No outcome defined, end encounter
      handleEncounterEnd(phaseScore >= 0 ? 'victory' : 'defeat');
    }
  };

  const handleContinue = () => {
    if (screenState.type === 'phase') {
      // Capture next beat ID to avoid non-null assertion
      const phaseNextBeatId = processedBeat?.nextBeatId;
      if (phaseNextBeatId) {
        transitionTo(() => {
          setScreenState({
            type: 'phase',
            phaseId: screenState.phaseId,
            beatId: phaseNextBeatId,
          });
        });
      } else {
        checkPhaseOutcome();
      }
    } else if (screenState.type === 'beat_outcome') {
      // Check if either clock is filled - determines encounter resolution
      const goalFilled = encounterState && encounterState.goalProgress >= encounterState.goalMax;
      const threatFilled = encounterState && encounterState.threatProgress >= encounterState.threatMax;
      
      console.log('[EncounterView] Clock status - Goal:', encounterState?.goalProgress, '/', encounterState?.goalMax,
                  'Threat:', encounterState?.threatProgress, '/', encounterState?.threatMax);
      
      if (goalFilled && !threatFilled) {
        // VICTORY - Goal achieved before threat overwhelmed
        handleEncounterEnd('victory');
      } else if (threatFilled) {
        // DEFEAT - Threat filled unless the player also filled the goal clock.
        handleEncounterEnd(goalFilled ? 'partialVictory' : 'defeat');
      } else {
        // Capture next beat ID to avoid non-null assertion
        const outcomeNextBeatId = screenState.nextBeatId;
        if (outcomeNextBeatId) {
          // Continue to next beat
          transitionTo(() => {
            setScreenState({
              type: 'phase',
              phaseId: screenState.phaseId,
              beatId: outcomeNextBeatId,
            });
          });
        } else {
          // No next beat - check phase outcome based on clock states
          const outcome = (encounterState?.goalProgress || 0) > (encounterState?.threatProgress || 0) ? 'victory' : 'defeat';
          handleEncounterEnd(outcome);
        }
      }
    } else if (screenState.type === 'phase_outcome') {
      const phaseOutcome = screenState.outcome === 'success'
        ? currentPhase?.onSuccess
        : currentPhase?.onFailure;

      if (phaseOutcome?.outcomeImages && screenState.imageIndex < phaseOutcome.outcomeImages.length - 1) {
        // Show next image
        setScreenState({
          ...screenState,
          imageIndex: screenState.imageIndex + 1,
        });
      } else if (phaseOutcome?.nextPhaseId) {
        // Move to next phase
        const nextPhase = encounter.phases.find((p) => p.id === phaseOutcome.nextPhaseId);
        if (nextPhase) {
          updateEncounterPhase(nextPhase.id);
          setScreenState({
            type: 'phase',
            phaseId: nextPhase.id,
            beatId: nextPhase.beats[0]?.id ?? '',
          });
        }
      } else {
        // Encounter ends
        handleEncounterEnd(screenState.outcome === 'success' ? 'victory' : 'defeat');
      }
    } else if (screenState.type === 'encounter_outcome') {
      onComplete(screenState.outcome, allEncounterFeedbackRef.current, lastKnownImageRef.current || undefined);
    }
  };

  const handleEncounterEnd = (outcome: EncounterOutcome) => {
    // Optional-chained like every other outcomes access in this file — the
    // generator has shipped encounters with missing/empty outcomes (G10 class),
    // and a throw here at encounter end loses the whole session to the error
    // boundary.
    const outcomeData = encounter.outcomes?.[outcome];
    const endTier: EncounterOutcomeTier =
      screenState.type === 'terminal' ? screenState.tier :
      screenState.type === 'beat_outcome' ? screenState.outcome :
      screenState.type === 'phase_outcome' ? (screenState.outcome === 'success' ? 'success' : 'failure') :
      tierFromEncounterOutcome(outcome);
    const echoState = ('choiceText' in screenState || 'outcomeSummary' in screenState)
      ? {
          choiceText: (screenState as any).choiceText,
          outcomeSummary: (screenState as any).outcomeSummary
            || summarizeEncounterOutcome(outcomeData?.outcomeText),
        }
      : {};
    const endConsequences = [
      { type: 'setFlag', flag: `encounter.${encounter.id}.outcome.${outcome}`, value: true },
      ...(outcomeData?.consequences ?? []),
      ...((outcomeData as any)?.cost?.consequences ?? []),
    ];
    if (endConsequences.length > 0) {
      const endApplied = applyConsequences(endConsequences as any);
      allEncounterFeedbackRef.current = [...allEncounterFeedbackRef.current, ...endApplied.filter(a => a.type !== 'flag')];
    }

    setScreenState({
      type: 'encounter_outcome',
      outcome,
      tier: endTier,
      narrativeText: outcomeData?.outcomeText || ENCOUNTER_TIER_FALLBACKS[endTier],
      ...echoState,
    });
    endEncounter();
  };

  const transitionTo = (callback: () => void) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: TIMING.normal,
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      callback();
      imageOpacity.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: TIMING.slow,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
      Animated.timing(imageOpacity, {
        toValue: 1,
        duration: TIMING.slow,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    });
  };

  // Handler for choices made while showing outcome (from next beat)
  const handleOutcomeChoicePress = (choiceId: string) => {
    if (screenState.type !== 'beat_outcome' || !screenState.nextBeatId || !currentPhase) return;
    haptics.selection();
    
    // Find the next beat and its choice
    const nextBeat = currentPhase.beats.find(b => b.id === screenState.nextBeatId);
    if (!nextBeat) {
      console.error('[EncounterView] Next beat not found:', screenState.nextBeatId);
      return;
    }
    
    const choice = nextBeat.choices?.find(c => c.id === choiceId);
    if (!choice) {
      console.error('[EncounterView] Choice not found in next beat:', choiceId);
      return;
    }
    const availability = getEncounterChoiceAvailability(choice as EncounterChoice | EmbeddedEncounterChoice, player, currentStory);
    if (!availability.visible || availability.isLocked) {
      console.warn('[EncounterView] Ignoring locked follow-up encounter choice:', choiceId);
      return;
    }
    
    console.log('[EncounterView] Choice pressed from outcome screen:', choiceId);
    
    const result = executeChoice(choice, player);
    if (!result.success) return;
    
    // Determine outcome tier based on player stats
    const statBonus = resolveStatBonus(choice as EmbeddedEncounterChoice, player);
    const weights = computeEncounterWeights(player, choice.primarySkill, statBonus);
    const outcome = resolveOutcomeTier(weights);
    
    console.log('[EncounterView] Outcome tier:', outcome, statBonus > 0 ? `(+${statBonus} stat bonus applied)` : '');
    
    // Update clocks - use outcome-specific values if available, else defaults
    let goalTicks = 0;
    let threatTicks = 0;
    
    if ('outcomes' in choice && choice.outcomes && choice.outcomes[outcome]) {
      goalTicks = choice.outcomes[outcome].goalTicks ?? 0;
      threatTicks = choice.outcomes[outcome].threatTicks ?? 0;
    } else {
      // Fallback defaults (Blades in the Dark style)
      switch (outcome) {
        case 'success':
          goalTicks = 2;
          break;
        case 'complicated':
          goalTicks = 1;
          threatTicks = 1;
          break;
        case 'failure':
          threatTicks = 2;
          break;
      }
    }
    
    if (goalTicks > 0) addGoalProgress(goalTicks);
    if (threatTicks > 0) addThreatProgress(threatTicks);
    
    const scoreChange = outcome === 'success' ? 3 : outcome === 'complicated' ? 1 : -1;
    addEncounterScore(scoreChange);

    const outcomeData = 'outcomes' in choice ? choice.outcomes?.[outcome] : undefined;
    const applied = applyResolvedEncounterOutcome(choice.id, outcome, outcomeData);
    const playerFacing = applied.filter(a => a.type !== 'flag');
    allEncounterFeedbackRef.current = [...allEncounterFeedbackRef.current, ...playerFacing];
    
    // Try to get narrative text from choice outcomes
    let narrativeText = '';
    if (outcomeData) {
      narrativeText = outcomeData.narrativeText || '';
    }
    
    // Fallback to generic text if no narrative provided
    if (!narrativeText) {
      narrativeText = ENCOUNTER_TIER_FALLBACKS[outcome];
    }
    
    // Determine next beat - prefer outcome's nextBeatId, then choice's, then result's
    let nextNextBeatId: string | undefined;
    if ('outcomes' in choice && choice.outcomes && choice.outcomes[outcome]?.nextBeatId) {
      nextNextBeatId = choice.outcomes[outcome].nextBeatId;
    } else {
      nextNextBeatId = choice.nextBeatId || result.nextBeatId;
    }
    
    // Transition to new beat_outcome state with the new beat (include choiceId for images)
    transitionTo(() => {
      setScreenState({
        type: 'beat_outcome',
        phaseId: screenState.phaseId,
        beatId: screenState.nextBeatId!, // Current beat is now the next beat
        choiceId: choice.id,
        outcome,
        nextBeatId: nextNextBeatId,
        ...buildEncounterChoiceEcho(choice as EmbeddedEncounterChoice, outcome, narrativeText),
      });
      
      setOutcomeText(narrativeText);
    });
  };

  // Stat check overlay (shared with stories)
  const statCheckOverlayElement = encounterStatCheck ? (
    <StatCheckOverlay
      skillName={encounterStatCheck.skillName}
      tier={encounterStatCheck.tier}
      onComplete={() => {
        setEncounterStatCheck(null);
        encounterStatCheckProceedRef.current?.();
      }}
    />
  ) : null;

  // ========================================
  // SHELL CHROME HELPERS
  // ========================================

  const renderEncounterVignetteFlash = () => vignetteColor ? (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        { pointerEvents: 'none' as const },
        {
          zIndex: 50,
          borderWidth: 4,
          borderColor: vignetteColor,
          borderRadius: 0,
          opacity: vignetteAnim,
          shadowColor: vignetteColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 40,
        },
      ]}
    />
  ) : null;

  const renderEncounterClockChrome = (options?: { hiddenThreat?: boolean; approximateThreat?: boolean }) => (
    <View style={styles.clockContainer}>
      <Clock
        name={encounter.goalClock?.name || 'OBJECTIVE'}
        filled={encounterState?.goalProgress || 0}
        total={encounterState?.goalMax || 6}
        type="goal"
      />
      <View style={styles.clockDivider} />
      <Clock
        name={encounter.threatClock?.name || 'THREAT'}
        filled={encounterState?.threatProgress || 0}
        total={encounterState?.threatMax || 4}
        type="threat"
        hidden={options?.hiddenThreat}
        approximateLevel={options?.approximateThreat ? encounter.informationVisibility?.threatClockApproximate : undefined}
      />
    </View>
  );

  const renderEncounterDevPromptButton = (image?: string | null) => (developerMode && image) ? (
    <TouchableOpacity
      style={styles.devPromptButton}
      onPress={() => fetchImagePrompt(image)}
    >
      <FileText size={18} color={TERMINAL.colors.cyan} />
    </TouchableOpacity>
  ) : null;

  const renderEncounterDevPromptPanel = () => showPromptOverlay ? (
    <View style={[styles.devPromptPanel, { pointerEvents: 'auto' as const }]}>
      <View style={styles.devPromptPanelHeader}>
        <View style={styles.devPromptPanelHeaderText}>
          <Text style={styles.devPromptPanelTitle}>IMAGE PROMPT</Text>
          {!!promptContextLabel && (
            <Text style={styles.devPromptPanelSubtitle}>{promptContextLabel}</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => setShowPromptOverlay(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <X size={20} color={TERMINAL.colors.textBody} />
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.devPromptPanelScroll} contentContainerStyle={styles.devPromptPanelScrollContent}>
        {isLoadingPrompt ? (
          <ActivityIndicator size="small" color={TERMINAL.colors.cyan} />
        ) : (
          <Text style={styles.devPromptPanelText} selectable>{promptText || 'No prompt available.'}</Text>
        )}
      </ScrollView>
    </View>
  ) : null;

  const renderEncounterTerminalBand = (color: string) => (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        { pointerEvents: 'none' as const },
        {
          zIndex: 5,
          borderTopWidth: 3,
          borderBottomWidth: 3,
          borderColor: color,
          opacity: 0.6,
        },
      ]}
    />
  );

  const renderEncounterDevBadge = (label: string, image?: string | null) => {
    if (!developerMode || !label) return null;
    const panelNumber = getImagePanelNumberFromStory(currentStory, image);
    const devLabel = panelNumber ? `${label} • IMG ${panelNumber}` : label;
    return (
      <View style={[styles.devBadge, { pointerEvents: 'none' as const }]}>
        <Text style={styles.devBadgeText}>{devLabel}</Text>
      </View>
    );
  };

  const renderEncounterConsequenceBeat = (params: {
    tier: EncounterOutcomeTier;
    narrativeText?: string;
    choiceText?: string;
    outcomeSummary?: string;
    animate?: boolean;
    onAnimationComplete?: () => void;
  }) => {
    const tierColor = TIER_COLORS[params.tier];
    const summary = params.outcomeSummary || ENCOUNTER_TIER_SUMMARIES[params.tier];
    const narrative = params.narrativeText || ENCOUNTER_TIER_FALLBACKS[params.tier];

    return (
      <>
        <View style={[
          styles.encounterEchoPanel,
          {
            borderColor: withAlpha(tierColor, 0.35),
            backgroundColor: withAlpha(tierColor, 0.08),
          },
        ]}>
          <Text style={styles.encounterEchoSummaryText}>
            {params.choiceText || summary}
          </Text>
          {!!params.choiceText && !!summary && (
            <Text style={styles.encounterEchoProgressText}>{summary}</Text>
          )}
        </View>

        <View style={styles.textPanel}>
          <NarrativeText
            text={tpl(narrative)}
            animate={params.animate ?? false}
            onAnimationComplete={params.onAnimationComplete || (() => {})}
          />
        </View>
      </>
    );
  };

  // ========================================
  // RENDER: TREE-BASED ENCOUNTER (Action/Reaction Flow)
  // ========================================
  
  if (screenState.type === 'active') {
    const { situation } = screenState;
    const hasOutcome = !!situation.previousOutcome;
    // Capture the encounter's opening situation so the scene-seam transition
    // line renders exactly once, at entry.
    if (entrySituationTextRef.current === null) {
      entrySituationTextRef.current = situation.setupText;
    }
    const isEntrySituation = entrySituationTextRef.current === situation.setupText;

    const displayImage = resolveImageUrl(
      hasOutcome && situation.previousOutcome?.outcomeImage
        ? situation.previousOutcome.outcomeImage
        : situation.situationImage
    );
    if (displayImage) lastKnownImageRef.current = displayImage;
    
    const processedChoices: ProcessedChoice[] = situation.choices
      .map(c => {
        const availability = getEncounterChoiceAvailability(c, player, currentStory);
        if (!availability.visible) return null;
        const skillBonusValue = resolveStatBonus(c, player);
        const skillDisplay = resolveChoiceSkillDisplay({
          skillKey: c.primarySkill,
          player,
          bonus: skillBonusValue,
        });
        return {
          id: c.id,
          text: processTemplate(c.text, player, currentStory),
          isLocked: availability.isLocked,
          lockedReason: availability.lockedReason,
          hasStatCheck: !!c.primarySkill,
          statCheckInfo: c.primarySkill ? { skill: c.primarySkill } : undefined,
          primarySkillKey: skillDisplay.skillKey,
          primarySkillLabel: skillDisplay.skillLabel,
          effectiveSkillValue: skillDisplay.effectiveSkillValue,
          skillBonusValue: skillDisplay.skillBonusValue,
          hasAdvantage: !!(c.statBonus && skillBonusValue > 0),
          advantageText: c.statBonus?.flavorText,
          echoSummary: c.feedbackCue?.echoSummary ?? c.reminderPlan?.immediate,
          progressSummary: c.feedbackCue?.progressSummary ?? c.reminderPlan?.shortTerm,
          checkClass: c.feedbackCue?.checkClass,
        } as ProcessedChoice;
      })
      .filter((choice): choice is ProcessedChoice => Boolean(choice));
    
    const goalFilled = encounterState && encounterState.goalProgress >= encounterState.goalMax;
    const threatFilled = encounterState && encounterState.threatProgress >= encounterState.threatMax;
    const encounterEnding = goalFilled || threatFilled;

    const situationStateNarration = buildEncounterStateNarration(encounter, encounterState);
    const activeSituationText = situationStateNarration.length > 0
      ? `${situation.setupText}\n\n${situationStateNarration.join(' ')}`
      : situation.setupText;
    
    return (
      <ReadingShell
        imageUrl={displayImage}
        fadeAnim={fadeAnim}
        shakeAnim={screenShakeAnim}
        imageOpacity={imageOpacity}
        placeholderWatermark
        scrollViewRef={scrollViewRef as any}
        vignette={
          <>
            {statCheckOverlayElement}
            {renderEncounterVignetteFlash()}
          </>
        }
        chromeTop={renderEncounterClockChrome({
          hiddenThreat: encounter.informationVisibility?.threatClockVisible === false && !encounterState?.threatClockRevealed,
          approximateThreat: true,
        })}
        imageExtras={renderEncounterDevPromptButton(displayImage)}
        overlays={
          <>
            {renderEncounterDevPromptPanel()}
            {renderEncounterDevBadge(encounterDevLabel, displayImage)}
          </>
        }
      >
        {/* Action Result (if coming from a choice) */}
            {hasOutcome && situation.previousOutcome && (
              renderEncounterConsequenceBeat({
                tier: situation.previousOutcome.tier,
                narrativeText: situation.previousOutcome.narrativeText,
                choiceText: situation.previousOutcome.choiceText,
                outcomeSummary: situation.previousOutcome.outcomeSummary,
                animate: isAnimating,
                onAnimationComplete: () => {
                  setIsAnimating(false);
                  setShowNextSituation(true);
                  animateDivider();
                  setTimeout(() => {
                    setShowChoices(true);
                    animateChoiceEntrance(processedChoices.length);
                  }, 400);
                },
              })
            )}

            {/* New Situation Setup - staggered reveal after outcome */}
            {(!hasOutcome || showNextSituation) && (
              <Animated.View style={[
                styles.textPanel,
                hasOutcome && styles.nextSituationPanel,
                hasOutcome && {
                  opacity: dividerAnim,
                  transform: [{ translateY: dividerAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
                },
              ]}>
                {hasOutcome && (
                  <View style={styles.situationDivider}>
                    <Text style={styles.situationDividerText}>THEN...</Text>
                  </View>
                )}
                {!!transitionIn && !hasOutcome && isEntrySituation && (
                  <Text style={styles.encounterTransitionInText}>{transitionIn}</Text>
                )}
                <NarrativeText
                  text={tpl(activeSituationText)}
                  animate={!hasOutcome && isAnimating}
                  onAnimationComplete={() => {
                    if (!hasOutcome) {
                      setIsAnimating(false);
                      setShowChoices(true);
                      animateChoiceEntrance(processedChoices.length);
                    }
                  }}
                />
              </Animated.View>
            )}

            {/* Choices - staggered entrance */}
            {(showChoices || (!hasOutcome && !isAnimating)) && !encounterEnding && processedChoices.length > 0 && (
              <View style={styles.choicesList}>
                {processedChoices.map((choice, index) => {
                  const entryAnim = choiceEntryAnims[index];
                  return (
                    <Animated.View
                      key={choice.id}
                      style={entryAnim ? {
                        opacity: entryAnim,
                        transform: [{ translateX: entryAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
                      } : undefined}
                    >
                      <ChoiceButton
                        choice={choice}
                        index={index}
                        onPress={handleTreeChoice}
                      />
                    </Animated.View>
                  );
                })}
              </View>
            )}

        {encounterEnding && (
          <ContinueButton
            label="SEE AFTERMATH"
            onPress={() => {
              const finalOutcome = goalFilled && !threatFilled ? 'victory' :
                                   threatFilled && !goalFilled ? 'defeat' :
                                   goalFilled && threatFilled ? 'partialVictory' : 'escape';
              handleEncounterEnd(finalOutcome);
            }}
          />
        )}
      </ReadingShell>
    );
  }

  // ========================================
  // RENDER: OUTCOME RESULTS BEAT
  // ========================================

  if (screenState.type === 'outcome_result') {
    const { tier, narrativeText, outcomeImage, choiceText, outcomeSummary, pendingNextSituation, pendingPhaseId } = screenState;
    const resolvedOutcomeImage = resolveImageUrl(outcomeImage);
    if (resolvedOutcomeImage) lastKnownImageRef.current = resolvedOutcomeImage;

    return (
      <ReadingShell
        imageUrl={resolvedOutcomeImage}
        fadeAnim={fadeAnim}
        shakeAnim={screenShakeAnim}
        imageOpacity={imageOpacity}
        scrollViewRef={scrollViewRef as any}
        vignette={
          <>
            {statCheckOverlayElement}
            {renderEncounterVignetteFlash()}
          </>
        }
        chromeTop={renderEncounterClockChrome()}
        imageExtras={renderEncounterDevPromptButton(resolvedOutcomeImage)}
        overlays={
          <>
            {renderEncounterDevPromptPanel()}
            {renderEncounterDevBadge(encounterDevLabel, resolvedOutcomeImage)}
          </>
        }
      >
        {renderEncounterConsequenceBeat({
          tier,
          narrativeText,
          choiceText,
          outcomeSummary,
          animate: isAnimating,
          onAnimationComplete: () => setIsAnimating(false),
        })}

        <ContinueButton
          copyKey="default"
          disabled={isAnimating}
          testID="encounter-outcome-continue"
          onPress={() => {
            if (isAnimating) return;
            transitionTo(() => {
              setScreenState({
                type: 'active',
                situation: pendingNextSituation,
                phaseId: pendingPhaseId,
              });
              setIsAnimating(true);
              setShowChoices(false);
              scrollViewRef.current?.scrollTo({ y: 0, animated: true });
            });
          }}
        />
      </ReadingShell>
    );
  }

  // ========================================
  // RENDER: TERMINAL OUTCOME
  // ========================================
  
  if (screenState.type === 'terminal') {
    const { outcome, tier, finalNarrative, finalImage, choiceText, outcomeSummary } = screenState;

    // Image fallback chain: explicit outcomeImage → last image shown during encounter → phase situationImage
    const terminalImage = resolveImageUrl(
      finalImage
        || lastKnownImageRef.current
        || encounter.phases?.[encounter.phases.length - 1]?.situationImage
        || undefined
    );
    
    return (
      <ReadingShell
        imageUrl={terminalImage}
        imageOpacity={imageOpacity}
        placeholderWatermark
        vignette={renderEncounterTerminalBand(TIER_COLORS[tier])}
        imageExtras={renderEncounterDevPromptButton(terminalImage)}
        overlays={
          <>
            {renderEncounterDevPromptPanel()}
            {renderEncounterDevBadge(encounterDevLabel, terminalImage)}
          </>
        }
      >
        {renderEncounterConsequenceBeat({
          tier,
          narrativeText: finalNarrative,
          choiceText,
          outcomeSummary,
          animate: true,
        })}

        <ContinueButton
          copyKey="encounterConclude"
          onPress={() => onComplete(outcome, allEncounterFeedbackRef.current, lastKnownImageRef.current || undefined)}
        />
      </ReadingShell>
    );
  }

  // ========================================
  // LEGACY RENDER: Beat Outcome (for backward compatibility)
  // ========================================

  // Render beat outcome screen (after making a choice) - shows reaction + next choices
  if (screenState.type === 'beat_outcome') {
    const currentBeat = currentPhase?.beats.find(b => b.id === screenState.beatId);
    
    // Get outcome-specific image from the choice's outcomes (GDD cinematic system)
    const selectedChoice = currentBeat?.choices?.find(c => c.id === screenState.choiceId);
    const outcomeData = selectedChoice?.outcomes?.[screenState.outcome];
    
    // Prefer outcome-specific image, fallback to legacy outcomeSequences
    const outcomeSpecificImage = outcomeData?.outcomeImage;
    const legacyImages = currentBeat?.outcomeSequences?.[screenState.outcome] || currentBeat?.outcomeSequences?.success || [];
    const currentImage = resolveImageUrl(outcomeSpecificImage || legacyImages[0]);
    if (currentImage) lastKnownImageRef.current = currentImage;
    
    // Get the NEXT beat to show its choices
    const nextBeat = screenState.nextBeatId 
      ? currentPhase?.beats.find(b => b.id === screenState.nextBeatId)
      : null;
    
    // Type guard: Check if this is an EncounterBeat (has setupText) vs regular Beat
    const isEncounterBeat = nextBeat && 'setupText' in nextBeat;
    
    // Transform encounter choices to ProcessedChoice format for ChoiceButton
    // Only use choices if it's an EncounterBeat with choices, or a Beat with defined choices
    const rawNextChoices = nextBeat?.choices && Array.isArray(nextBeat.choices) && nextBeat.choices.length > 0
      ? nextBeat.choices 
      : [];
    const nextBeatChoices: ProcessedChoice[] = rawNextChoices
      .map(c => {
        const availability = getEncounterChoiceAvailability(c as EncounterChoice | EmbeddedEncounterChoice, player, currentStory);
        if (!availability.visible) return null;
        const skillBonusValue = resolveStatBonus(c as EncounterChoice | EmbeddedEncounterChoice, player);
        const primarySkill = 'primarySkill' in c ? c.primarySkill : undefined;
        const skillDisplay = resolveChoiceSkillDisplay({
          skillKey: primarySkill,
          player,
          bonus: skillBonusValue,
        });
        return {
          id: c.id,
          text: processTemplate(c.text, player, currentStory),
          isLocked: availability.isLocked,
          lockedReason: availability.lockedReason,
          hasStatCheck: !!primarySkill,
          statCheckInfo: primarySkill ? { skill: primarySkill } : undefined,
          primarySkillKey: skillDisplay.skillKey,
          primarySkillLabel: skillDisplay.skillLabel,
          effectiveSkillValue: skillDisplay.effectiveSkillValue,
          skillBonusValue: skillDisplay.skillBonusValue,
          hasAdvantage: !!(c.statBonus && skillBonusValue > 0),
          advantageText: c.statBonus?.flavorText,
          echoSummary: c.feedbackCue?.echoSummary ?? c.reminderPlan?.immediate,
          progressSummary: c.feedbackCue?.progressSummary ?? c.reminderPlan?.shortTerm,
          checkClass: c.feedbackCue?.checkClass,
        } as ProcessedChoice;
      })
      .filter((choice): choice is ProcessedChoice => Boolean(choice));
    
    // Check if encounter should end (clocks filled)
    const goalFilled = encounterState && encounterState.goalProgress >= encounterState.goalMax;
    const threatFilled = encounterState && encounterState.threatProgress >= encounterState.threatMax;
    const encounterEnding = goalFilled || threatFilled;
    
    const phaseOutcomeTier = screenState.outcome as 'success' | 'complicated' | 'failure';

    return (
      <ReadingShell
        imageUrl={currentImage}
        imageOpacity={imageOpacity}
        chromeTop={renderEncounterClockChrome()}
      >
        {renderEncounterConsequenceBeat({
          tier: phaseOutcomeTier,
          narrativeText: outcomeText,
          choiceText: screenState.choiceText,
          outcomeSummary: screenState.outcomeSummary,
        })}

        {nextBeat && 'setupText' in nextBeat && nextBeat.setupText && !encounterEnding && (() => {
          const nb = nextBeat as EncounterBeat;
          let displayText = nb.setupText;
          if (nb.setupTextVariants?.length) {
            for (const v of nb.setupTextVariants) {
              try { if (evaluateCondition(v.condition as any, player)) { displayText = v.text; break; } } catch { /* ignore */ }
            }
          }
          const encounterStateNarration = buildEncounterStateNarration(encounter, encounterState);
          if (encounterStateNarration.length > 0) {
            displayText = `${displayText}\n\n${encounterStateNarration.join(' ')}`;
          }
          return (
            <View style={[styles.textPanel, styles.nextSituationPanel]}>
              <NarrativeText text={tpl(displayText)} animate={false} />
            </View>
          );
        })()}

        {!encounterEnding && nextBeatChoices.length > 0 && (
          <View style={styles.choicesList}>
            {nextBeatChoices.map((choice, index) => (
              <ChoiceButton
                key={choice.id}
                choice={choice}
                index={index}
                onPress={handleOutcomeChoicePress}
              />
            ))}
          </View>
        )}

        {(encounterEnding || nextBeatChoices.length === 0) && (
          <ContinueButton
            label={encounterEnding
              ? 'SEE AFTERMATH'
              : CONTINUE_COPY.default}
            onPress={handleContinue}
          />
        )}
      </ReadingShell>
    );
  }

  // Render phase outcome screen
  if (screenState.type === 'phase_outcome') {
    const phaseOutcome = screenState.outcome === 'success'
      ? currentPhase?.onSuccess
      : currentPhase?.onFailure;
    const currentImage = resolveImageUrl(phaseOutcome?.outcomeImages?.[screenState.imageIndex]);

    return (
      <ReadingShell
        imageUrl={currentImage}
        imageOpacity={imageOpacity}
        chromeTop={renderEncounterClockChrome()}
      >
        <View style={styles.textPanel}>
          <OutcomeHeader
            tier={screenState.outcome === 'success' ? 'success' : 'failure'}
            context="encounter"
            text={screenState.outcome === 'success' ? 'Breakthrough' : 'Overwhelmed'}
          />
          <NarrativeText text={tpl(outcomeText)} animate={false} />
        </View>

        <ContinueButton copyKey="default" onPress={handleContinue} />
      </ReadingShell>
    );
  }

  // Render encounter outcome screen (legacy non-tree path)
  if (screenState.type === 'encounter_outcome') {
    console.log('[EncounterView] Rendering encounter_outcome screen for:', screenState.outcome);
    // Image fallback chain: outcome-specific sequence → complicated sequence → last image → phase image
    const lastPhase = encounter.phases[encounter.phases.length - 1];
    const lastBeat = lastPhase?.beats[lastPhase.beats.length - 1];
    const outcomeSeqKey = screenState.outcome === 'victory' ? 'success'
      : screenState.outcome === 'partialVictory' ? 'success'
      : 'failure';
    const finalImage = lastBeat?.outcomeSequences?.[outcomeSeqKey]?.[0]
                       || lastBeat?.outcomeSequences?.['complicated']?.[0]
                       || lastBeat?.image
                       || lastKnownImageRef.current
                       || lastPhase?.situationImage;

    const legacyTier = screenState.tier;

    return (
      <ReadingShell
        imageUrl={finalImage}
        imageOpacity={imageOpacity}
        placeholderWatermark
        vignette={renderEncounterTerminalBand(TIER_COLORS[legacyTier])}
        imageExtras={renderEncounterDevPromptButton(finalImage)}
        overlays={
          <>
            {renderEncounterDevPromptPanel()}
            {renderEncounterDevBadge(encounterDevLabel, finalImage)}
          </>
        }
      >
        {renderEncounterConsequenceBeat({
          tier: legacyTier,
          narrativeText: screenState.narrativeText,
          choiceText: screenState.choiceText,
          outcomeSummary: screenState.outcomeSummary,
          animate: true,
        })}

        <ContinueButton copyKey="encounterConclude" onPress={handleContinue} />
      </ReadingShell>
    );
  }

  // Render phase screen
  if (!currentPhase || !processedBeat) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={[styles.loadingText, { fontSize: fonts.medium }]}>LOADING ENCOUNTER...</Text>
      </View>
    );
  }

  // Get the current image - prefer beat image, fallback to situation image
  const rawImageUrl = processedBeat.image || currentPhase?.situationImage;
  let finalImageUrl = rawImageUrl;
  if (imageErrorId === processedBeat.id && processedBeat.image && processedBeat.image !== currentPhase?.situationImage) {
    finalImageUrl = currentPhase?.situationImage;
  }
  const currentImage = resolveImageUrl(finalImageUrl);
  if (currentImage) lastKnownImageRef.current = currentImage;

  const activeElements = encounter.environmentalElements?.filter(
    e => (encounterState?.activeElements?.has(e.id) || e.isActive) && !(encounterState?.usedElements?.has(e.id) || e.wasUsed)
  ) ?? [];

  const legacyChromeTop = (
    <>
      {renderEncounterClockChrome({
        hiddenThreat: encounter.informationVisibility?.threatClockVisible === false && !encounterState?.threatClockRevealed,
        approximateThreat: true,
      })}

      {encounter.pixarStakes && (
        <View style={styles.stakesContainer}>
          {encounter.pixarStakes.physical && (
            <View style={styles.stakesBadge}>
              <Text style={styles.stakesIcon}>⚔️</Text>
              <Text style={styles.stakesText} numberOfLines={1}>{encounter.pixarStakes.physical}</Text>
            </View>
          )}
          {encounter.pixarStakes.emotional && (
            <View style={styles.stakesBadge}>
              <Text style={styles.stakesIcon}>💔</Text>
              <Text style={styles.stakesText} numberOfLines={1}>{encounter.pixarStakes.emotional}</Text>
            </View>
          )}
          {encounter.pixarStakes.philosophical && (
            <View style={styles.stakesBadge}>
              <Text style={styles.stakesIcon}>⚖️</Text>
              <Text style={styles.stakesText} numberOfLines={1}>{encounter.pixarStakes.philosophical}</Text>
            </View>
          )}
        </View>
      )}

      {activeElements.length > 0 && (
        <View style={styles.environmentContainer}>
          {activeElements.map(element => (
            <View key={element.id} style={[
              styles.environmentBadge,
              element.type === 'hazard' ? styles.hazardBadge :
              element.type === 'opportunity' ? styles.opportunityBadge : styles.neutralBadge
            ]}>
              <Text style={styles.environmentIcon}>
                {element.type === 'hazard' ? '⚠️' : element.type === 'opportunity' ? '✨' : '📍'}
              </Text>
              <Text style={styles.environmentText} numberOfLines={1}>{element.name}</Text>
            </View>
          ))}
        </View>
      )}
    </>
  );

  return (
    <ReadingShell
      imageUrl={currentImage}
      fadeAnim={fadeAnim}
      imageOpacity={imageOpacity}
      scrollViewRef={scrollViewRef as any}
      chromeTop={legacyChromeTop}
      imageExtras={renderEncounterDevPromptButton(currentImage)}
      overlays={
        <>
          {renderEncounterDevPromptPanel()}
          {renderEncounterDevBadge(encounterDevLabel, currentImage)}
        </>
      }
      onImageError={(e) => {
        console.warn(`[EncounterView] Image failed to load: ${currentImage}`, e?.nativeEvent);
        if (processedBeat && currentImage === processedBeat.image) {
          setImageErrorId(processedBeat.id);
        }
      }}
    >
      <View style={styles.textPanel}>
        <NarrativeText
          text={tpl([
            processedBeat.text,
            ...(processedBeat.skillInsights ?? []),
          ].filter(Boolean).join('\n\n'))}
          speaker={processedBeat.speaker}
          speakerMood={processedBeat.speakerMood}
          animate={true}
          onAnimationComplete={handleAnimationComplete}
        />
      </View>

      {resolutionText && (
        <View style={styles.resolutionPanel}>
          <Text style={styles.resolutionText}>{tpl(resolutionText)}</Text>
        </View>
      )}

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

      {!isAnimating && processedBeat.autoAdvance && !resolutionText && (
        <ContinueButton copyKey="default" onPress={handleContinue} />
      )}
    </ReadingShell>
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
  clockContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 100,
  },
  clockDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
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
  // Dev Mode styles
  devBadge: {
    position: (Platform.OS === 'web' ? ('fixed' as any) : 'absolute') as any,
    top: 14,
    left: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.35)',
    zIndex: 999999,
    elevation: 999999,
  },
  devBadgeText: {
    color: TERMINAL.colors.cyan,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  devPromptButton: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
    zIndex: 110,
  },
  devPromptPanel: {
    position: (Platform.OS === 'web' ? ('fixed' as any) : 'absolute') as any,
    top: 120,
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
  devPromptPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  devPromptPanelHeaderText: {
    flex: 1,
    paddingRight: 12,
  },
  devPromptPanelTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 2,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  devPromptPanelSubtitle: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: TERMINAL.colors.mutedLight,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  devPromptPanelScroll: {
    flexGrow: 0,
  },
  devPromptPanelScrollContent: {
    paddingBottom: 6,
  },
  devPromptPanelText: {
    fontSize: 12,
    lineHeight: 18,
    color: TERMINAL.colors.textBody,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  contentScrollView: sharedStyles.contentScrollView,
  contentContainer: sharedStyles.contentContainer,
  textPanel: sharedStyles.textPanel,
  encounterTransitionInText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  resolutionPanel: sharedStyles.resolutionPanel,
  resolutionText: sharedStyles.resolutionText,
  choicesList: {
    gap: 12,
    marginBottom: 8,
  },
  continueButton: sharedStyles.continueButton,
  continueText: sharedStyles.continueText,
  outcomeText: {
    color: TERMINAL.colors.textBody,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '500',
    textAlign: 'left',
  },
  encounterEchoPanel: {
    borderWidth: 1,
    borderRadius: RADIUS.choice,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  encounterEchoSummaryText: {
    color: TERMINAL.colors.textLight,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  encounterEchoProgressText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
    marginTop: 4,
  },
  nextBeatSetup: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    fontStyle: 'italic',
    color: TERMINAL.colors.textLight,
  },
  nextBeatSetupWrap: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  nextSituationPanel: {
    marginTop: 8,
    borderTopWidth: 0,
  },
  situationDivider: {
    alignItems: 'center',
    marginBottom: 12,
  },
  situationDividerText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  imageCounter: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  // Stakes display styles
  stakesContainer: {
    position: 'absolute',
    top: 70,
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    zIndex: 100,
  },
  stakesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  stakesIcon: {
    fontSize: 12,
  },
  stakesText: {
    color: TERMINAL.colors.textLight,
    fontSize: 10,
    fontWeight: '600',
    maxWidth: 100,
  },
  // Environmental elements styles
  environmentContainer: {
    position: 'absolute',
    top: 100,
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    zIndex: 100,
  },
  environmentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  hazardBadge: {
    backgroundColor: withAlpha(TERMINAL.colors.error, 0.3),
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.error, 0.5),
  },
  opportunityBadge: {
    backgroundColor: withAlpha(TERMINAL.colors.success, 0.3),
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.success, 0.5),
  },
  neutralBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  environmentIcon: {
    fontSize: 12,
  },
  environmentText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    maxWidth: 80,
  },
  // Skill check pill on choice buttons
  skillPill: {
    backgroundColor: withAlpha(TERMINAL.colors.primary, 0.15),
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.primary, 0.3),
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  skillPillText: {
    color: TERMINAL.colors.primaryLight,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  advantagePill: {
    backgroundColor: withAlpha(TERMINAL.colors.success, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.success, 0.3),
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    alignSelf: 'flex-start',
    marginTop: 3,
  },
  advantagePillText: {
    color: TERMINAL.colors.successLight,
    fontSize: 9,
    fontWeight: '600',
    fontStyle: 'italic',
  },
});
