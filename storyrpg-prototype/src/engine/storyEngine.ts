import {
  Story,
  Episode,
  Scene,
  Beat,
  Choice,
  PlayerState,
  ResolutionResult,
  Consequence,
  EncounterBeat,
  EncounterChoice,
} from '../types';
import { evaluateCondition } from './conditionEvaluator';
import { resolveStatCheck } from './resolutionEngine';
import { processText, processTemplate } from './templateProcessor';

// Observability counter for unresolved template tokens
let _unresolvedTokenCount = 0;
export function getUnresolvedTokenCount(): number { return _unresolvedTokenCount; }
export function resetUnresolvedTokenCount(): void { _unresolvedTokenCount = 0; }
const STORY_ENGINE_DEBUG = false;

function debugLog(message: string): void {
  if (STORY_ENGINE_DEBUG) {
    console.log(message);
  }
}

/**
 * Type guard to check if a beat is an EncounterBeat
 * EncounterBeat has 'setupText' and 'phase', while regular Beat has 'text'
 */
export function isEncounterBeat(beat: Beat | EncounterBeat): beat is EncounterBeat {
  return 'setupText' in beat && 'phase' in beat;
}

/**
 * Story Engine
 *
 * The main orchestrator for story playback. Handles:
 * - Scene and beat navigation
 * - Choice filtering and processing
 * - Resolution mechanics
 * - Text processing
 */

export interface ProcessedBeat {
  id: string;
  text: string;
  speaker?: string;
  speakerMood?: string;
  image?: string;
  video?: string;
  choices: ProcessedChoice[];
  hasChoices: boolean;
  autoAdvance: boolean;
  nextBeatId?: string;
  nextSceneId?: string;
  
  // Branch/reconvergence context
  isAtConvergencePoint?: boolean;
  branchContext?: {
    previousPath: string[];  // Scene IDs the player came through
    branchTone?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
  };
}

export interface ProcessedChoice {
  id: string;
  text: string;
  isLocked: boolean;
  lockedReason?: string;
  hasStatCheck: boolean;
  statCheckInfo?: {
    attribute?: string;
    skill?: string;
  };
  primarySkillLabel?: string;
  hasAdvantage?: boolean;
  advantageText?: string;
  echoSummary?: string;
  progressSummary?: string;
  checkClass?: 'dramatic' | 'retryable';
}

export interface ChoiceResult {
  success: boolean;
  resolution?: ResolutionResult;
  consequences: Consequence[];
  delayedConsequences?: Array<{
    consequence: Consequence;
    description: string;
    delay?: { type: 'scenes' | 'episodes'; count: number };
    triggerCondition?: import('../types').ConditionExpression;
  }>;
  nextSceneId?: string;
  nextBeatId?: string;
}

function formatSkillLabel(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

function buildLockedReason(choice: Choice, player: PlayerState, story: Story): string {
  if (choice.lockedText) {
    return processTemplate(choice.lockedText, player, story);
  }

  const cue = choice.feedbackCue;
  if (cue?.checkClass === 'retryable') {
    return 'Not yet. A different approach, ally, or hard-won lesson could change this.';
  }

  return 'This option is not available.';
}

/**
 * Process a beat for display.
 * Handles both regular Beat and EncounterBeat types.
 */
export function processBeat(
  beat: Beat | EncounterBeat,
  player: PlayerState,
  story: Story
): ProcessedBeat {
  // Debug logging
  debugLog(`[StoryEngine] Processing beat "${beat.id}"`);
  
  // Handle EncounterBeat vs regular Beat
  const isEncounter = isEncounterBeat(beat);
  
  if (isEncounter) {
    debugLog(`[StoryEngine]   - EncounterBeat (phase: ${beat.phase})`);
  }
  
  // Get raw text - EncounterBeat uses 'setupText', Beat uses 'text'
  let rawText: string;
  if (isEncounter) {
    rawText = beat.setupText || '';
  } else {
    rawText = beat.text;
    debugLog(`[StoryEngine]   - beat.choices: ${beat.choices ? `${beat.choices.length} choices` : 'undefined/null'}`);
    debugLog(`[StoryEngine]   - beat.nextBeatId: ${beat.nextBeatId || 'none'}`);
  }
  
  // ROBUST TEXT RECOVERY: If text is the placeholder, try to find original content in the beat object
  if (!rawText || rawText === '[Scene continues...]') {
    const anyBeat = beat as any;
    // Strategy 1: Check "content" field
    if (anyBeat.content) {
      if (typeof anyBeat.content === 'string') {
        rawText = anyBeat.content;
      } else if (typeof anyBeat.content === 'object') {
        // Strategy 2: Check "content.narrative" or "content.text"
        rawText = anyBeat.content.narrative || anyBeat.content.text || anyBeat.content.dialogue?.[0]?.text || JSON.stringify(anyBeat.content);
      }
    } 
    // Strategy 3: Check "narrative" field
    else if (anyBeat.narrative) {
      rawText = anyBeat.narrative;
    }
    
    if (rawText !== (isEncounter ? beat.setupText : (beat as Beat).text)) {
      debugLog(`[StoryEngine]   - RECOVERED text for beat ${beat.id}`);
    }
  }

  // Process text with variants and templates (regular Beat only has textVariants)
  const textVariants = !isEncounter ? (beat as Beat).textVariants : undefined;
  let text = processText(rawText, textVariants, player, story);

  // POST-PROCESSING GUARD: Strip any unresolved template tokens ({{...}})
  // This catches edge cases where the LLM invented a token the resolver doesn't know.
  const unresolvedTokenRegex = /\{\{[^}]+\}\}/g;
  const unresolvedTokens = text.match(unresolvedTokenRegex);
  if (unresolvedTokens && unresolvedTokens.length > 0) {
    console.warn(`[StoryEngine] Beat ${beat.id} has ${unresolvedTokens.length} unresolved template token(s): ${unresolvedTokens.join(', ')}. Replacing with character name.`);
    text = text.replace(unresolvedTokenRegex, player.characterName);
    _unresolvedTokenCount += unresolvedTokens.length;
  }

  // FINAL FALLBACK: If text is STILL empty after all processing, use a descriptive placeholder
  if (!text || text.trim().length === 0) {
    console.warn(`[StoryEngine] Beat ${beat.id} resulted in empty text. Using emergency fallback.`);
    text = `You continue through the ${story.genre.toLowerCase()} journey, facing new challenges and making important decisions.`;
  }

  // Process speaker name if present (regular Beat only)
  const speaker = !isEncounter && (beat as Beat).speaker
    ? processTemplate((beat as Beat).speaker!, player, story)
    : undefined;

  // Filter and process choices
  // EncounterBeat has EncounterChoice[], Beat has Choice[]
  let choices: ProcessedChoice[];
  if (isEncounter) {
    choices = processEncounterChoices(beat.choices ?? [], player, story);
  } else {
    choices = processChoices((beat as Beat).choices ?? [], player, story);
  }
  
  const hasChoices = choices.length > 0;
  // AUTO-ADVANCE FAILSAFE: If a beat has no visible choices (either none were defined or all were filtered out),
  // we must enable auto-advance so the player isn't stuck.
  const autoAdvance = !hasChoices;
  
  debugLog(`[StoryEngine]   - processed choices: ${choices.length}`);
  debugLog(`[StoryEngine]   - hasChoices: ${hasChoices}, autoAdvance: ${autoAdvance}`);

  // Get image - EncounterBeat uses situationImage, Beat uses image
  const image = isEncounter ? beat.situationImage : (beat as Beat).image;
  const video = !isEncounter ? (beat as Beat).video : undefined;

  return {
    id: beat.id,
    text,
    speaker,
    speakerMood: !isEncounter ? (beat as Beat).speakerMood : undefined,
    image,
    video,
    choices,
    hasChoices,
    autoAdvance,
    nextBeatId: !isEncounter ? (beat as Beat).nextBeatId : undefined,
    nextSceneId: !isEncounter ? (beat as Beat).nextSceneId : undefined,
  };
}

/**
 * Process EncounterChoice[] for display.
 * Evaluates conditions so pre-encounter choices can unlock or lock options.
 */
function processEncounterChoices(
  choices: EncounterChoice[],
  player: PlayerState,
  story: Story
): ProcessedChoice[] {
  const processed: ProcessedChoice[] = [];

  for (const choice of choices) {
    const meetsConditions = choice.conditions
      ? evaluateCondition(choice.conditions, player)
      : true;

    // If conditions not met and the choice is not configured to show locked, skip it
    if (!meetsConditions && !choice.showWhenLocked) {
      continue;
    }

    processed.push({
      id: choice.id,
      text: processTemplate(choice.text, player, story),
      isLocked: !meetsConditions,
      lockedReason: !meetsConditions
        ? buildLockedReason(choice as unknown as Choice, player, story)
        : undefined,
      hasStatCheck: !!choice.primarySkill,
      statCheckInfo: choice.primarySkill
        ? { skill: choice.primarySkill }
        : undefined,
      primarySkillLabel: formatSkillLabel(choice.primarySkill),
      hasAdvantage: !!(choice.statBonus && choice.statBonus.flavorText),
      advantageText: choice.statBonus?.flavorText,
      echoSummary: choice.feedbackCue?.echoSummary ?? choice.reminderPlan?.immediate,
      progressSummary: choice.feedbackCue?.progressSummary ?? choice.reminderPlan?.shortTerm,
      checkClass: choice.feedbackCue?.checkClass,
    });
  }

  return processed;
}

/**
 * Process and filter choices for display.
 */
function processChoices(
  choices: Choice[],
  player: PlayerState,
  story: Story
): ProcessedChoice[] {
  const processed: ProcessedChoice[] = [];

  for (const choice of choices) {
    const meetsConditions = choice.conditions
      ? evaluateCondition(choice.conditions, player)
      : true;

    // If conditions not met and not configured to show locked, skip
    if (!meetsConditions && !choice.showWhenLocked) {
      continue;
    }

    processed.push({
      id: choice.id,
      text: processTemplate(choice.text, player, story),
      isLocked: !meetsConditions,
      lockedReason: !meetsConditions
        ? buildLockedReason(choice, player, story)
        : undefined,
      hasStatCheck: !!choice.statCheck,
      statCheckInfo: choice.statCheck
        ? {
            attribute: choice.statCheck.attribute,
            skill: choice.statCheck.skill,
          }
        : undefined,
      primarySkillLabel: formatSkillLabel(choice.statCheck?.skill || choice.statCheck?.attribute),
      echoSummary: choice.feedbackCue?.echoSummary ?? choice.reminderPlan?.immediate,
      progressSummary: choice.feedbackCue?.progressSummary ?? choice.reminderPlan?.shortTerm,
      checkClass: choice.feedbackCue?.checkClass ?? (choice.statCheck?.retryableAfterChange ? 'retryable' : undefined),
    });
  }

  return processed;
}

/**
 * Execute a choice and return the result.
 */
export function executeChoice(
  choice: Choice,
  player: PlayerState
): ChoiceResult {
  // Check conditions first
  if (choice.conditions && !evaluateCondition(choice.conditions, player)) {
    return {
      success: false,
      consequences: [],
    };
  }

  let resolution: ResolutionResult | undefined;
  let consequences = [...(choice.consequences ?? [])];

  // Perform stat check if required
  if (choice.statCheck) {
    resolution = resolveStatCheck(player, choice.statCheck);

    // Inject outcome-tier flags so the payoff beat's textVariants can select
    // the right outcome text at render time. Flags are mutually exclusive.
    const tier = resolution.tier;
    consequences.push({ type: 'setFlag', flag: '_outcome_success', value: tier === 'success' } as Consequence);
    consequences.push({ type: 'setFlag', flag: '_outcome_partial', value: tier === 'complicated' } as Consequence);
    consequences.push({ type: 'setFlag', flag: '_outcome_failure', value: tier === 'failure' } as Consequence);

    // Use authored outcome text when available; fall back to generic resolution text.
    if (choice.outcomeTexts) {
      const outcomeText =
        tier === 'success' ? choice.outcomeTexts.success :
        tier === 'complicated' ? choice.outcomeTexts.partial :
        choice.outcomeTexts.failure;
      resolution = { ...resolution, narrativeText: outcomeText };
    }
  }

  return {
    success: true,
    resolution,
    consequences,
    delayedConsequences: choice.delayedConsequences,
    nextSceneId: choice.nextSceneId,
    nextBeatId: choice.nextBeatId,
  };
}

/**
 * Find a scene by ID in an episode.
 */
export function findScene(episode: Episode, sceneId: string): Scene | undefined {
  return episode.scenes.find((s) => s.id === sceneId);
}

/**
 * Find a scene by ID, throwing an error if not found.
 * Use when the scene MUST exist.
 */
export function findSceneOrThrow(episode: Episode, sceneId: string): Scene {
  const scene = findScene(episode, sceneId);
  if (!scene) {
    throw new Error(`Scene "${sceneId}" not found in episode "${episode.id}". Available scenes: ${episode.scenes.map(s => s.id).join(', ')}`);
  }
  return scene;
}

/**
 * Find a beat by ID in a scene.
 */
export function findBeat(scene: Scene, beatId: string): Beat | undefined {
  return scene.beats.find((b) => b.id === beatId);
}

/**
 * Find a beat by ID, throwing an error if not found.
 * Use when the beat MUST exist.
 */
export function findBeatOrThrow(scene: Scene, beatId: string): Beat {
  const beat = findBeat(scene, beatId);
  if (!beat) {
    throw new Error(`Beat "${beatId}" not found in scene "${scene.id}". Available beats: ${scene.beats.map(b => b.id).join(', ')}`);
  }
  return beat;
}

/**
 * Find a choice by ID in a beat.
 */
export function findChoice(beat: Beat, choiceId: string): Choice | undefined {
  return beat.choices?.find((c) => c.id === choiceId);
}

/**
 * Find a choice by ID, throwing an error if not found.
 * Use when the choice MUST exist.
 */
export function findChoiceOrThrow(beat: Beat, choiceId: string): Choice {
  const choice = findChoice(beat, choiceId);
  if (!choice) {
    const availableChoices = beat.choices?.map(c => c.id).join(', ') || 'none';
    throw new Error(`Choice "${choiceId}" not found in beat "${beat.id}". Available choices: ${availableChoices}`);
  }
  return choice;
}

/**
 * Get the next episode in a story.
 */
export function getNextEpisode(
  story: Story,
  currentEpisodeId: string
): Episode | undefined {
  const currentIndex = story.episodes.findIndex((e) => e.id === currentEpisodeId);
  if (currentIndex === -1 || currentIndex >= story.episodes.length - 1) {
    return undefined;
  }
  return story.episodes[currentIndex + 1];
}

/**
 * Check if an episode is unlocked for the player.
 */
export function isEpisodeUnlocked(
  episode: Episode,
  player: PlayerState
): boolean {
  if (!episode.unlockConditions) {
    return true;
  }
  return evaluateCondition(episode.unlockConditions, player);
}

/**
 * Check if a scene should be skipped based on conditions.
 */
export function shouldSkipScene(
  scene: Scene,
  player: PlayerState
): boolean {
  if (!scene.conditions) {
    return false;
  }
  return !evaluateCondition(scene.conditions, player);
}

/**
 * Get a fallback scene, tracking visited scenes to prevent infinite recursion.
 */
function getFallbackScene(
  episode: Episode,
  sceneId: string,
  player: PlayerState,
  visited: Set<string>
): Scene | undefined {
  // Prevent infinite recursion
  if (visited.has(sceneId)) {
    console.warn(`[StoryEngine] Circular fallback detected for scene ${sceneId}`);
    return undefined;
  }
  visited.add(sceneId);

  const scene = findScene(episode, sceneId);
  if (!scene) {
    return undefined;
  }

  if (!shouldSkipScene(scene, player)) {
    return scene;
  }

  // Scene should be skipped, try its fallback
  if (scene.fallbackSceneId) {
    return getFallbackScene(episode, scene.fallbackSceneId, player, visited);
  }

  return undefined;
}

/**
 * Get the next scene via conditional auto-routing.
 * 
 * This is NOT player-driven branching. Player-driven branching happens via
 * Choice.nextSceneId (on any non-expression choice), which bypasses this function.
 * This function handles the default "what's next" when no explicit routing exists.
 * 
 * Priority:
 * 1. If current scene has leadsTo, use the first valid target (condition-based)
 * 2. Otherwise, fall back to sequential advancement
 * 
 * Tracks visited scenes to prevent infinite recursion from circular references.
 */
export function getNextScene(
  episode: Episode,
  currentSceneId: string,
  player: PlayerState
): Scene | undefined {
  const currentScene = findScene(episode, currentSceneId);
  if (!currentScene) {
    return undefined;
  }

  // Track visited scenes to prevent infinite loops
  const visited = new Set<string>([currentSceneId]);

  // Priority 1: Follow explicit branch connections
  if (currentScene.leadsTo && currentScene.leadsTo.length > 0) {
    for (const targetId of currentScene.leadsTo) {
      if (visited.has(targetId)) {
        console.warn(`[StoryEngine] Circular leadsTo reference detected: ${currentSceneId} -> ${targetId}`);
        continue;
      }
      
      const targetScene = findScene(episode, targetId);
      if (targetScene && !shouldSkipScene(targetScene, player)) {
        return targetScene;
      }
      // If target is skipped, check its fallback chain
      if (targetScene?.fallbackSceneId) {
        visited.add(targetId);
        const fallback = getFallbackScene(episode, targetScene.fallbackSceneId, player, visited);
        if (fallback) {
          return fallback;
        }
      }
    }
  }

  // Priority 2: Fall back to sequential advancement (for backwards compatibility)
  const currentIndex = episode.scenes.findIndex((s) => s.id === currentSceneId);
  if (currentIndex === -1) {
    return undefined;
  }

  // Find next non-skipped scene
  for (let i = currentIndex + 1; i < episode.scenes.length; i++) {
    const scene = episode.scenes[i];
    if (visited.has(scene.id)) {
      continue;
    }
    
    if (!shouldSkipScene(scene, player)) {
      return scene;
    }
    // If skipped, check for fallback chain
    if (scene.fallbackSceneId) {
      visited.add(scene.id);
      const fallback = getFallbackScene(episode, scene.fallbackSceneId, player, visited);
      if (fallback) {
        return fallback;
      }
    }
  }

  return undefined;
}

/**
 * Get a specific next scene by ID, with condition checking.
 * Use this when a choice explicitly specifies a nextSceneId.
 * 
 * Tracks visited scenes to prevent infinite recursion from circular fallbacks.
 */
export function getSceneById(
  episode: Episode,
  sceneId: string,
  player: PlayerState,
  visited: Set<string> = new Set()
): Scene | undefined {
  // Prevent infinite recursion
  if (visited.has(sceneId)) {
    console.warn(`[StoryEngine] Circular fallback detected in getSceneById for scene ${sceneId}`);
    return undefined;
  }
  visited.add(sceneId);
  
  const scene = findScene(episode, sceneId);
  if (!scene) {
    return undefined;
  }
  
  // Check if scene should be skipped due to conditions
  if (shouldSkipScene(scene, player)) {
    // Try fallback
    if (scene.fallbackSceneId) {
      return getSceneById(episode, scene.fallbackSceneId, player, visited);
    }
    return undefined;
  }
  
  return scene;
}

/**
 * Calculate relationship description (fiction-first, no numbers).
 */
export function getRelationshipDescription(
  dimension: 'trust' | 'affection' | 'respect' | 'fear',
  value: number
): string {
  const descriptions: Record<typeof dimension, Record<string, string>> = {
    trust: {
      veryLow: 'deeply distrusts you',
      low: 'is wary of you',
      neutral: 'is uncertain about you',
      high: 'trusts you',
      veryHigh: 'trusts you completely',
    },
    affection: {
      veryLow: 'despises you',
      low: 'dislikes you',
      neutral: 'is indifferent toward you',
      high: 'likes you',
      veryHigh: 'adores you',
    },
    respect: {
      veryLow: 'has no respect for you',
      low: 'looks down on you',
      neutral: 'neither respects nor disrespects you',
      high: 'respects you',
      veryHigh: 'holds you in highest regard',
    },
    fear: {
      veryLow: 'is not at all afraid of you',
      low: 'is slightly intimidated by you',
      neutral: 'is cautious around you',
      high: 'fears you',
      veryHigh: 'is terrified of you',
    },
  };

  let level: string;
  if (dimension === 'fear') {
    // Fear is 0-100
    if (value < 20) level = 'veryLow';
    else if (value < 40) level = 'low';
    else if (value < 60) level = 'neutral';
    else if (value < 80) level = 'high';
    else level = 'veryHigh';
  } else {
    // Others are -100 to 100
    if (value < -50) level = 'veryLow';
    else if (value < -10) level = 'low';
    else if (value < 10) level = 'neutral';
    else if (value < 50) level = 'high';
    else level = 'veryHigh';
  }

  return descriptions[dimension][level];
}
