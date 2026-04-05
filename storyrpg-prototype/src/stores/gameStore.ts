import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PlayerState,
  PlayerAttributes,
  PlayerSkills,
  Relationship,
  InventoryItem,
  Story,
  Episode,
  Scene,
  Beat,
  Consequence,
  AppliedConsequence,
  DelayedConsequence,
  DEFAULT_IDENTITY_PROFILE,
  IdentityProfile,
} from '../types';
import { applyIdentityShifts } from '../engine/identityEngine';
import { evaluateCondition } from '../engine/conditionEvaluator';
import { getRelationshipDescription } from '../engine/storyEngine';
import {
  createInitialPlayerState,
  DEFAULT_ATTRIBUTES,
  deserializePlayerState,
  serializePlayerState,
} from './playerStatePersistence';
import {
  deserializeEncounterState,
  serializeEncounterState,
  type EncounterApproach,
  type EncounterState,
  type NPCDisposition,
} from './encounterStatePersistence';

// Storage keys
const STORAGE_KEYS = {
  PLAYER_STATE: 'gameStore_playerState',
  CURRENT_STORY_ID: 'gameStore_currentStoryId',
  CURRENT_EPISODE_ID: 'gameStore_currentEpisodeId',
  CURRENT_SCENE_ID: 'gameStore_currentSceneId',
  CURRENT_BEAT_ID: 'gameStore_currentBeatId',
  SCENE_HISTORY: 'gameStore_sceneHistory',
  BRANCH_HISTORY: 'gameStore_branchHistory',
  CURRENT_BRANCH_TONE: 'gameStore_currentBranchTone',
  ENCOUNTER_STATE: 'gameStore_encounterState',
};

// Branch tracking for reconvergence acknowledgment
interface BranchPathEntry {
  fromSceneId: string;
  toSceneId: string;
  choiceId?: string;  // Which choice led here
  branchTone?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
  timestamp: number;
}

interface GameActions {
  initializeStory: (story: Story, characterName: string, pronouns: PlayerState['characterPronouns']) => void;
  loadEpisode: (episodeId: string) => void;
  loadScene: (sceneId: string, episodeOverride?: Episode) => void;
  setBeat: (beatId: string) => void;
  applyConsequences: (consequences: Consequence[]) => AppliedConsequence[];

  // Relationship helpers
  updateRelationship: (npcId: string, dimension: 'trust' | 'affection' | 'respect' | 'fear', change: number) => void;
  getRelationship: (npcId: string) => Relationship | undefined;

  // Inventory helpers
  addItem: (item: Omit<InventoryItem, 'quantity'>, quantity: number) => void;
  removeItem: (itemId: string, quantity: number) => void;
  hasItem: (itemId: string, minQuantity?: number) => boolean;

  // Flag/Score/Tag helpers
  setFlag: (flag: string, value: boolean) => void;
  getFlag: (flag: string) => boolean;
  setScore: (score: string, value: number) => void;
  changeScore: (score: string, change: number) => void;
  getScore: (score: string) => number;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  hasTag: (tag: string) => boolean;

  // Encounter
  startEncounter: (encounterId: string, startingPhaseId: string, goalMax?: number, threatMax?: number) => void;
  updateEncounterPhase: (phaseId: string) => void;
  addGoalProgress: (ticks: number) => void;
  addThreatProgress: (ticks: number) => void;
  addEncounterScore: (points: number) => void;
  advanceEncounterBeat: () => void;
  endEncounter: () => void;
  
  // GDD/TDD Encounter Features
  setEncounterApproach: (approach: EncounterApproach) => void;
  recordOutcome: (outcome: 'success' | 'complicated' | 'failure') => void;
  activateEnvironmentalElement: (elementId: string) => void;
  useEnvironmentalElement: (elementId: string) => void;
  updateNPCDisposition: (npcId: string, disposition: NPCDisposition) => void;
  revealNPCTell: (tellId: string) => void;
  triggerEscalation: (triggerId: string, effects: { escapeUnlocked?: boolean; pointOfNoReturn?: boolean }) => void;
  revealThreatClock: () => void;
  checkEscalationTriggers: () => { triggered: string[]; shouldUnlockEscape: boolean; hitPointOfNoReturn: boolean };
  getEncounterProgress: () => number;  // Returns 0-100 percentage

  // Delayed consequences
  queueDelayedConsequence: (delayed: DelayedConsequence) => void;
  getPendingConsequences: () => DelayedConsequence[];

  // Butterfly effect feedback (fired delayed consequences visible to UI)
  butterflyFeedback: { description: string; consequence: Consequence }[];
  clearButterflyFeedback: () => void;

  // Progress
  completeEpisode: (episodeId: string) => void;

  // Branch tracking
  recordBranchChoice: (fromSceneId: string, toSceneId: string, choiceId?: string) => void;
  getBranchHistory: () => BranchPathEntry[];
  wasSceneVisited: (sceneId: string) => boolean;
  getBranchToneForScene: (sceneId: string) => 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption' | null;
  getPathToScene: (sceneId: string) => string[];  // Returns scene IDs leading to this scene

  // Reset
  resetGame: () => void;
}

interface GamePlayerStateValue {
  player: PlayerState;
}

interface GameStoryStateValue {
  currentStory: Story | null;
  currentEpisode: Episode | null;
  currentScene: Scene | null;
  currentBeatId: string | null;
}

interface GameProgressStateValue {
  sceneHistory: string[];
  branchHistory: BranchPathEntry[];
  currentBranchTone: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption' | null;
  butterflyFeedback: { description: string; consequence: Consequence }[];
}

interface GameEncounterStateValue {
  encounterState: EncounterState | null;
}

type GameContextValue = GamePlayerStateValue &
  GameStoryStateValue &
  GameProgressStateValue &
  GameEncounterStateValue &
  GameActions;

const GamePlayerContext = createContext<GamePlayerStateValue | null>(null);
const GameStoryContext = createContext<GameStoryStateValue | null>(null);
const GameProgressContext = createContext<GameProgressStateValue | null>(null);
const GameEncounterContext = createContext<GameEncounterStateValue | null>(null);
const GameActionsContext = createContext<GameActions | null>(null);

type StoryIndexes = {
  episodesById: Map<string, Episode>;
  scenesByEpisodeId: Map<string, Map<string, Scene>>;
};

function buildStoryIndexes(story: Story): StoryIndexes {
  const episodesById = new Map<string, Episode>();
  const scenesByEpisodeId = new Map<string, Map<string, Scene>>();

  for (const episode of story.episodes) {
    episodesById.set(episode.id, episode);
    const sceneMap = new Map<string, Scene>();
    for (const scene of episode.scenes) {
      sceneMap.set(scene.id, scene);
    }
    scenesByEpisodeId.set(episode.id, sceneMap);
  }

  return {
    episodesById,
    scenesByEpisodeId,
  };
}

export const GameProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [player, setPlayer] = useState<PlayerState>(createInitialPlayerState());
  const [currentStory, setCurrentStory] = useState<Story | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [currentScene, setCurrentScene] = useState<Scene | null>(null);
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null);
  const [sceneHistory, setSceneHistory] = useState<string[]>([]);
  const [branchHistory, setBranchHistory] = useState<BranchPathEntry[]>([]);
  const [currentBranchTone, setCurrentBranchTone] = useState<'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption' | null>(null);
  const [encounterState, setEncounterState] = useState<EncounterState | null>(null);
  const [butterflyFeedback, setButterflyFeedback] = useState<{ description: string; consequence: Consequence }[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const storyIndexesRef = useRef<StoryIndexes>({
    episodesById: new Map(),
    scenesByEpisodeId: new Map(),
  });
  
  // Track if we should persist (don't persist during initial load)
  const shouldPersist = useRef(false);
  
  // Load persisted state on mount
  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        const [
          playerJson,
          storyId,
          episodeId,
          sceneId,
          beatId,
          sceneHistoryJson,
          branchHistoryJson,
          branchTone,
          encounterJson,
        ] = await AsyncStorage.multiGet([
          STORAGE_KEYS.PLAYER_STATE,
          STORAGE_KEYS.CURRENT_STORY_ID,
          STORAGE_KEYS.CURRENT_EPISODE_ID,
          STORAGE_KEYS.CURRENT_SCENE_ID,
          STORAGE_KEYS.CURRENT_BEAT_ID,
          STORAGE_KEYS.SCENE_HISTORY,
          STORAGE_KEYS.BRANCH_HISTORY,
          STORAGE_KEYS.CURRENT_BRANCH_TONE,
          STORAGE_KEYS.ENCOUNTER_STATE,
        ]);
        
        // Load player state
        if (playerJson[1]) {
          const loadedPlayer = deserializePlayerState(playerJson[1]);
          if (loadedPlayer) {
            setPlayer(loadedPlayer);
          }
        }
        
        // Load IDs (note: we can't load actual Story/Episode/Scene objects from storage,
        // only the IDs - the actual data must be re-loaded from the story file)
        if (beatId[1]) {
          setCurrentBeatId(beatId[1]);
        }
        
        // Load scene history
        if (sceneHistoryJson[1]) {
          try {
            setSceneHistory(JSON.parse(sceneHistoryJson[1]));
          } catch (e) {
            console.warn('[GameStore] Failed to parse scene history');
          }
        }
        
        // Load branch history
        if (branchHistoryJson[1]) {
          try {
            setBranchHistory(JSON.parse(branchHistoryJson[1]));
          } catch (e) {
            console.warn('[GameStore] Failed to parse branch history');
          }
        }
        
        // Load branch tone
        if (branchTone[1]) {
          setCurrentBranchTone(branchTone[1] as any);
        }
        
        // Load encounter state
        if (encounterJson[1]) {
          const loadedEncounter = deserializeEncounterState(encounterJson[1]);
          if (loadedEncounter) {
            setEncounterState(loadedEncounter);
          }
        }
        
        console.log('[GameStore] Loaded persisted state');
      } catch (e) {
        console.warn('[GameStore] Failed to load persisted state:', e);
      } finally {
        setIsLoaded(true);
        // Enable persistence after initial load
        setTimeout(() => {
          shouldPersist.current = true;
        }, 100);
      }
    };
    
    loadPersistedState();
  }, []);

  const clearButterflyFeedback = useCallback(() => {
    setButterflyFeedback([]);
  }, []);
  
  // Persist player state changes
  useEffect(() => {
    if (!shouldPersist.current) return;
    
    const persistPlayerState = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.PLAYER_STATE, serializePlayerState(player));
      } catch (e) {
        console.warn('[GameStore] Failed to persist player state:', e);
      }
    };
    
    persistPlayerState();
  }, [player]);
  
  // Persist navigation state changes
  useEffect(() => {
    if (!shouldPersist.current) return;
    
    const persistNavigationState = async () => {
      try {
        await AsyncStorage.multiSet([
          [STORAGE_KEYS.CURRENT_BEAT_ID, currentBeatId || ''],
          [STORAGE_KEYS.SCENE_HISTORY, JSON.stringify(sceneHistory)],
          [STORAGE_KEYS.BRANCH_HISTORY, JSON.stringify(branchHistory)],
          [STORAGE_KEYS.CURRENT_BRANCH_TONE, currentBranchTone || ''],
        ]);
      } catch (e) {
        console.warn('[GameStore] Failed to persist navigation state:', e);
      }
    };
    
    persistNavigationState();
  }, [currentBeatId, sceneHistory, branchHistory, currentBranchTone]);
  
  // Persist encounter state changes
  useEffect(() => {
    if (!shouldPersist.current) return;
    
    const persistEncounterState = async () => {
      try {
        const serialized = serializeEncounterState(encounterState);
        if (serialized) {
          try {
            await AsyncStorage.setItem(STORAGE_KEYS.ENCOUNTER_STATE, serialized);
          } catch (storageErr: any) {
            const isQuota = storageErr?.name === 'QuotaExceededError' 
              || storageErr?.message?.includes('quota') 
              || storageErr?.message?.includes('QuotaExceeded');
            
            if (isQuota) {
              console.warn(`[GameStore] Encounter state quota exceeded (${serialized.length} chars). Freeing storage space...`);
              
              // Step 1: Clear expendable storage from other stores to free space
              try {
                await AsyncStorage.multiRemove([
                  '@storyrpg_generation_jobs',
                  '@storyrpg_image_feedback',
                ]);
                console.log('[GameStore] Cleared expendable storage (jobs, feedback)');
              } catch (_) { /* best effort */ }
              
              // Step 2: Retry original save
              try {
                await AsyncStorage.setItem(STORAGE_KEYS.ENCOUNTER_STATE, serialized);
                console.log(`[GameStore] Encounter state saved after freeing space (${serialized.length} chars)`);
                return;
              } catch (_) { /* continue to pruning */ }
              
              // Step 3: Prune encounter state itself
              if (encounterState) {
                const prunedState: EncounterState = {
                  ...encounterState,
                  activeElements: new Set<string>(),
                  usedElements: new Set<string>(),
                  revealedTells: new Set<string>(),
                  triggeredEscalations: new Set<string>(),
                  npcDispositions: {},
                };
                
                const prunedSerialized = serializeEncounterState(prunedState);
                if (prunedSerialized) {
                  try {
                    await AsyncStorage.setItem(STORAGE_KEYS.ENCOUNTER_STATE, prunedSerialized);
                    console.log(`[GameStore] Pruned encounter state saved (${prunedSerialized.length} chars, was ${serialized.length})`);
                  } catch (retryErr) {
                    console.warn('[GameStore] Encounter state still too large after pruning. Keeping in memory only.');
                  }
                }
              }
            } else {
              console.warn('[GameStore] Failed to persist encounter state (non-quota error):', storageErr);
            }
          }
        } else {
          await AsyncStorage.removeItem(STORAGE_KEYS.ENCOUNTER_STATE);
        }
      } catch (e) {
        console.warn('[GameStore] Failed to persist encounter state:', e);
      }
    };
    
    persistEncounterState();
  }, [encounterState]);

  const initializeStory = useCallback((story: Story, characterName: string, pronouns: PlayerState['characterPronouns']) => {
    const initialState = createInitialPlayerState();

    initialState.characterName = characterName;
    initialState.characterPronouns = pronouns;
    initialState.attributes = { ...DEFAULT_ATTRIBUTES, ...story.initialState.attributes };
    initialState.skills = { ...story.initialState.skills };
    initialState.tags = new Set(story.initialState.tags);
    initialState.inventory = [...story.initialState.inventory];
    initialState.currentStoryId = story.id;

    const relationships: Record<string, Relationship> = {};
    for (const npc of story.npcs) {
      relationships[npc.id] = {
        npcId: npc.id,
        trust: npc.initialRelationship?.trust ?? 0,
        affection: npc.initialRelationship?.affection ?? 0,
        respect: npc.initialRelationship?.respect ?? 0,
        fear: npc.initialRelationship?.fear ?? 0,
      };
    }
    initialState.relationships = relationships;

    setPlayer(initialState);
    storyIndexesRef.current = buildStoryIndexes(story);
    setCurrentStory(story);
    setCurrentEpisode(null);
    setCurrentScene(null);
    setCurrentBeatId(null);
    setSceneHistory([]);
    setEncounterState(null);
  }, []);

  const loadEpisode = useCallback((episodeId: string) => {
    if (!currentStory) return;

    const episode = storyIndexesRef.current.episodesById.get(episodeId);
    if (!episode) return;

    setCurrentEpisode(episode);
    setPlayer(prev => ({ ...prev, currentEpisodeId: episodeId }));
  }, [currentStory]);

  const loadScene = useCallback((sceneId: string, episodeOverride?: Episode) => {
    const episode = episodeOverride || currentEpisode;
    if (!episode) return;

    const scene = storyIndexesRef.current.scenesByEpisodeId.get(episode.id)?.get(sceneId);
    if (!scene) return;

    // Debug: Check if beats have choices (skip warning for encounter scenes)
    const beatsWithChoices = scene.beats.filter(b => b.choices && b.choices.length > 0);
    if (beatsWithChoices.length === 0 && !scene.encounter) {
      console.warn(`[GameStore] WARNING: Scene "${sceneId}" has NO beats with choices and no encounter!`);
    }

    setCurrentScene(scene);
    setCurrentBeatId(scene.startingBeatId);

    // Process pending delayed consequences on scene transition
    const firedButterflies: { description: string; consequence: Consequence }[] = [];
    setPlayer(prev => {
      const updatedPlayer = { ...prev, currentSceneId: sceneId };
      const pending = updatedPlayer.pendingConsequences ?? [];
      const stillPending: DelayedConsequence[] = [];
      const toFire: Consequence[] = [];

      for (const dc of pending) {
        if (dc.fired) continue;

        dc.scenesElapsed = (dc.scenesElapsed ?? 0) + 1;

        let shouldFire = false;
        if (dc.delay?.type === 'scenes' && dc.scenesElapsed >= dc.delay.count) {
          shouldFire = true;
        }

        if (dc.triggerCondition && evaluateCondition(dc.triggerCondition, updatedPlayer)) {
          shouldFire = true;
        }

        if (shouldFire) {
          toFire.push(dc.consequence);
          firedButterflies.push({ description: dc.description, consequence: dc.consequence });
          dc.fired = true;
          console.log(
            `[GameStore] Delayed consequence fired: "${dc.description}" ` +
            `(from scene ${dc.sourceSceneId}, ${dc.scenesElapsed} scenes ago)`
          );
        }

        stillPending.push(dc);
      }

      updatedPlayer.pendingConsequences = stillPending.filter(dc => !dc.fired);

      // Apply fired consequences
      if (toFire.length > 0) {
        // Apply them inline (without recursing into setPlayer)
        for (const consequence of toFire) {
          switch (consequence.type) {
            case 'setFlag':
              updatedPlayer.flags = { ...updatedPlayer.flags, [consequence.flag]: consequence.value };
              break;
            case 'changeScore':
              updatedPlayer.scores = {
                ...updatedPlayer.scores,
                [consequence.score]: (updatedPlayer.scores[consequence.score] ?? 0) + consequence.change,
              };
              break;
            case 'addTag':
              updatedPlayer.tags = new Set(updatedPlayer.tags).add(consequence.tag);
              break;
            case 'relationship':
              const rel = updatedPlayer.relationships[consequence.npcId];
              if (rel) {
                const maxV = 100;
                const minV = consequence.dimension === 'fear' ? 0 : -100;
                updatedPlayer.relationships = {
                  ...updatedPlayer.relationships,
                  [consequence.npcId]: {
                    ...rel,
                    [consequence.dimension]: Math.max(minV, Math.min(maxV, rel[consequence.dimension] + consequence.change)),
                  },
                };
              }
              break;
            // Other types applied as-is
            default:
              console.log(`[GameStore] Delayed consequence of type "${consequence.type}" fired (generic apply)`);
              break;
          }
        }

        // Also apply identity shifts from fired consequences
        updatedPlayer.identityProfile = applyIdentityShifts(
          updatedPlayer.identityProfile ?? DEFAULT_IDENTITY_PROFILE,
          toFire
        );
      }

      return updatedPlayer;
    });

    if (firedButterflies.length > 0) {
      setButterflyFeedback(firedButterflies);
    }

    setSceneHistory(prev => [...prev, sceneId]);
  }, [currentEpisode]);

  const setBeat = useCallback((beatId: string) => {
    setCurrentBeatId(beatId);
  }, []);

  const applyConsequences = useCallback((consequences: Consequence[]): AppliedConsequence[] => {
    const applied: AppliedConsequence[] = [];

    const classifyMagnitude = (change: number): 'minor' | 'moderate' | 'major' => {
      const abs = Math.abs(change);
      if (abs >= 8) return 'major';
      if (abs >= 4) return 'moderate';
      return 'minor';
    };

    const ATTRIBUTE_HINTS_UP: Record<string, string> = {
      charm: 'Your presence carries more weight.',
      wit: 'Your mind feels sharper.',
      courage: 'Something inside you steadies.',
      empathy: 'You understand others a little better.',
      resolve: 'Your determination hardens.',
      resourcefulness: 'You see possibilities where there were none.',
    };
    const ATTRIBUTE_HINTS_DOWN: Record<string, string> = {
      charm: 'Your confidence wavers.',
      wit: 'Doubt clouds your thinking.',
      courage: 'Fear leaves its mark.',
      empathy: 'You feel more distant.',
      resolve: 'Your certainty cracks.',
      resourcefulness: 'Options seem to narrow.',
    };

    const RELATIONSHIP_DIM_UP: Record<string, string> = {
      trust: 'trusts you more',
      affection: 'warms toward you',
      respect: 'sees you differently',
      fear: 'fears you more',
    };
    const RELATIONSHIP_DIM_DOWN: Record<string, string> = {
      trust: 'trusts you less',
      affection: 'grows colder',
      respect: 'questions your judgment',
      fear: 'fears you less',
    };

    setPlayer(prevPlayer => {
      let newPlayer = { ...prevPlayer };

      for (const consequence of consequences) {
        switch (consequence.type) {
          case 'attribute': {
            const dir = consequence.change >= 0 ? 'up' : 'down';
            const hints = dir === 'up' ? ATTRIBUTE_HINTS_UP : ATTRIBUTE_HINTS_DOWN;
            applied.push({
              type: 'attribute',
              label: consequence.attribute.charAt(0).toUpperCase() + consequence.attribute.slice(1),
              direction: dir,
              magnitude: classifyMagnitude(consequence.change),
              narrativeHint: hints[consequence.attribute],
              scope: 'self',
              linger: true,
            });
            newPlayer.attributes = {
              ...newPlayer.attributes,
              [consequence.attribute]: Math.max(
                0,
                Math.min(100, newPlayer.attributes[consequence.attribute] + consequence.change)
              ),
            };
            break;
          }

          case 'skill': {
            const dir = consequence.change >= 0 ? 'up' : 'down';
            applied.push({
              type: 'skill',
              label: consequence.skill.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              direction: dir,
              magnitude: classifyMagnitude(consequence.change),
              narrativeHint: dir === 'up'
                ? `You feel more practiced in ${consequence.skill.replace(/_/g, ' ')}.`
                : `That stumble leaves your ${consequence.skill.replace(/_/g, ' ')} shaken.`,
              scope: 'self',
              linger: true,
            });
            newPlayer.skills = {
              ...newPlayer.skills,
              [consequence.skill]: Math.max(
                0,
                (newPlayer.skills[consequence.skill] ?? 0) + consequence.change
              ),
            };
            break;
          }

          case 'relationship': {
            const rel = newPlayer.relationships[consequence.npcId];
            if (rel) {
              const dir = consequence.change >= 0 ? 'up' : 'down';
              const npcName = consequence.npcId
                .replace(/^char[-_]/i, '')
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
              const maxVal = 100;
              const minVal = consequence.dimension === 'fear' ? 0 : -100;
              const nextValue = Math.max(
                minVal,
                Math.min(maxVal, rel[consequence.dimension] + consequence.change)
              );
              applied.push({
                type: 'relationship',
                label: `${npcName} · ${consequence.dimension.charAt(0).toUpperCase() + consequence.dimension.slice(1)}`,
                direction: dir,
                magnitude: classifyMagnitude(consequence.change),
                narrativeHint: `${npcName} ${getRelationshipDescription(consequence.dimension, nextValue)}.`,
                scope: 'other',
                linger: true,
              });
              newPlayer.relationships = {
                ...newPlayer.relationships,
                [consequence.npcId]: {
                  ...rel,
                  [consequence.dimension]: nextValue,
                },
              };
            }
            break;
          }

          case 'setFlag':
            newPlayer.flags = { ...newPlayer.flags, [consequence.flag]: consequence.value };
            break;

          case 'changeScore': {
            const scoreKey = consequence.score || (consequence as any).target || (consequence as any).stat;
            const delta =
              typeof consequence.change === 'number'
                ? consequence.change
                : typeof (consequence as any).value === 'number'
                  ? (consequence as any).value
                  : undefined;
            if (!scoreKey || typeof delta !== 'number') {
              console.warn('[GameStore] changeScore consequence missing score field:', consequence);
              break;
            }
            newPlayer.scores = {
              ...newPlayer.scores,
              [scoreKey]: (newPlayer.scores[scoreKey] ?? 0) + delta,
            };
            const scoreDir = delta >= 0 ? 'up' : 'down';
            const scoreLabel = scoreKey.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
            applied.push({
              type: 'score',
              label: scoreLabel,
              direction: scoreDir,
              magnitude: Math.abs(delta) >= 10 ? 'major' : Math.abs(delta) >= 5 ? 'moderate' : 'minor',
              narrativeHint: scoreDir === 'up'
                ? `Your ${scoreLabel.toLowerCase()} grows.`
                : `Your ${scoreLabel.toLowerCase()} falters.`,
              scope: 'future',
              linger: true,
            });
            break;
          }

          case 'setScore': {
            const setScoreKey = consequence.score || (consequence as any).target || (consequence as any).stat;
            const value =
              typeof consequence.value === 'number'
                ? consequence.value
                : typeof (consequence as any).change === 'number'
                  ? (newPlayer.scores[setScoreKey] ?? 0) + (consequence as any).change
                  : undefined;
            if (!setScoreKey || typeof value !== 'number') {
              console.warn('[GameStore] setScore consequence missing score field:', consequence);
              break;
            }
            newPlayer.scores = { ...newPlayer.scores, [setScoreKey]: value };
            break;
          }

          case 'addTag': {
            newPlayer.tags = new Set(newPlayer.tags).add(consequence.tag);
            const tagLower = consequence.tag.toLowerCase();
            let identityHint: string | undefined;
            if (tagLower.includes('brave') || tagLower.includes('bold')) identityHint = "You're becoming bolder.";
            else if (tagLower.includes('kind') || tagLower.includes('compassionate')) identityHint = "Your compassion defines you.";
            else if (tagLower.includes('cunning') || tagLower.includes('clever')) identityHint = "Your cleverness sharpens.";
            else if (tagLower.includes('leader')) identityHint = "Others are starting to follow your lead.";
            if (identityHint) {
              applied.push({
                type: 'identity',
                label: consequence.tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                direction: 'up',
                magnitude: 'minor',
                narrativeHint: identityHint,
                scope: 'self',
                linger: true,
              });
            }
            break;
          }

          case 'removeTag': {
            const newTags = new Set(newPlayer.tags);
            newTags.delete(consequence.tag);
            newPlayer.tags = newTags;
            break;
          }

          case 'addItem': {
            const itemToAdd = consequence.item ?? {
              itemId: consequence.itemId!,
              name: consequence.name!,
              description: consequence.description!,
            };
            const quantityToAdd = consequence.quantity ?? 1;
            applied.push({
              type: 'item',
              label: itemToAdd.name,
              direction: 'up',
              magnitude: 'minor',
              narrativeHint: `You acquired ${itemToAdd.name}.`,
              scope: 'future',
              linger: true,
            });
            const existingItem = newPlayer.inventory.find((i) => i.itemId === itemToAdd.itemId);
            if (existingItem) {
              newPlayer.inventory = newPlayer.inventory.map((i) =>
                i.itemId === itemToAdd.itemId
                  ? { ...i, quantity: i.quantity + quantityToAdd }
                  : i
              );
            } else {
              newPlayer.inventory = [
                ...newPlayer.inventory,
                { ...itemToAdd, quantity: quantityToAdd },
              ];
            }
            break;
          }

          case 'removeItem': {
            applied.push({
              type: 'item',
              label: consequence.itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              direction: 'down',
              magnitude: 'minor',
              scope: 'future',
              linger: true,
            });
            newPlayer.inventory = newPlayer.inventory
              .map((i) =>
                i.itemId === consequence.itemId
                  ? { ...i, quantity: i.quantity - consequence.quantity }
                  : i
              )
              .filter((i) => i.quantity > 0);
            break;
          }
        }
      }

      // Apply identity shifts from tint flags and tags
      const prevProfile = newPlayer.identityProfile ?? DEFAULT_IDENTITY_PROFILE;
      newPlayer.identityProfile = applyIdentityShifts(prevProfile, consequences);

      const IDENTITY_LABELS: Record<keyof IdentityProfile, [string, string]> = {
        mercy_justice: ['More merciful', 'More just'],
        idealism_pragmatism: ['More idealistic', 'More pragmatic'],
        cautious_bold: ['More cautious', 'Bolder'],
        loner_leader: ['More independent', 'More of a leader'],
        heart_head: ['Led by heart', 'Led by reason'],
        honest_deceptive: ['More honest', 'More deceptive'],
      };
      for (const dim of Object.keys(IDENTITY_LABELS) as Array<keyof IdentityProfile>) {
        const shift = (newPlayer.identityProfile[dim] ?? 0) - (prevProfile[dim] ?? 0);
        if (Math.abs(shift) >= 3) {
          const [negLabel, posLabel] = IDENTITY_LABELS[dim];
          applied.push({
            type: 'identity',
            label: shift > 0 ? posLabel : negLabel,
            direction: shift > 0 ? 'up' : 'down',
            magnitude: Math.abs(shift) >= 10 ? 'major' : 'moderate',
            narrativeHint: `${shift > 0 ? posLabel : negLabel} — your choices are shaping who you become.`,
            scope: 'self',
            linger: true,
          });
        }
      }

      return newPlayer;
    });

    return applied;
  }, []);

  const queueDelayedConsequence = useCallback((delayed: DelayedConsequence) => {
    setPlayer(prev => ({
      ...prev,
      pendingConsequences: [...(prev.pendingConsequences ?? []), delayed],
    }));
    console.log(
      `[GameStore] Queued delayed consequence: "${delayed.description}" ` +
      `(fires ${delayed.delay ? `after ${delayed.delay.count} ${delayed.delay.type}` : 'on condition'})`
    );
  }, []);

  const getPendingConsequences = useCallback(() => {
    return player.pendingConsequences ?? [];
  }, [player.pendingConsequences]);

  const updateRelationship = useCallback((npcId: string, dimension: 'trust' | 'affection' | 'respect' | 'fear', change: number) => {
    applyConsequences([{ type: 'relationship', npcId, dimension, change }]);
  }, [applyConsequences]);

  const getRelationship = useCallback((npcId: string) => {
    return player.relationships[npcId];
  }, [player.relationships]);

  const addItem = useCallback((item: Omit<InventoryItem, 'quantity'>, quantity: number) => {
    applyConsequences([{ type: 'addItem', item, quantity }]);
  }, [applyConsequences]);

  const removeItem = useCallback((itemId: string, quantity: number) => {
    applyConsequences([{ type: 'removeItem', itemId, quantity }]);
  }, [applyConsequences]);

  const hasItem = useCallback((itemId: string, minQuantity = 1) => {
    const item = player.inventory.find((i) => i.itemId === itemId);
    return item ? item.quantity >= minQuantity : false;
  }, [player.inventory]);

  const setFlag = useCallback((flag: string, value: boolean) => {
    applyConsequences([{ type: 'setFlag', flag, value }]);
  }, [applyConsequences]);

  const getFlag = useCallback((flag: string) => {
    return player.flags[flag] ?? false;
  }, [player.flags]);

  const setScore = useCallback((score: string, value: number) => {
    applyConsequences([{ type: 'setScore', score, value }]);
  }, [applyConsequences]);

  const changeScore = useCallback((score: string, change: number) => {
    applyConsequences([{ type: 'changeScore', score, change }]);
  }, [applyConsequences]);

  const getScore = useCallback((score: string) => {
    return player.scores[score] ?? 0;
  }, [player.scores]);

  const addTag = useCallback((tag: string) => {
    applyConsequences([{ type: 'addTag', tag }]);
  }, [applyConsequences]);

  const removeTag = useCallback((tag: string) => {
    applyConsequences([{ type: 'removeTag', tag }]);
  }, [applyConsequences]);

  const hasTag = useCallback((tag: string) => {
    return player.tags.has(tag);
  }, [player.tags]);

  const startEncounter = useCallback((
    encounterId: string, 
    startingPhaseId: string,
    goalMax: number = 6,
    threatMax: number = 4
  ) => {
    setEncounterState({
      encounterId,
      currentPhaseId: startingPhaseId,
      currentBeatIndex: 0,
      goalProgress: 0,
      goalMax,
      threatProgress: 0,
      threatMax,
      phaseScore: 0,
      totalScore: 0,
      // GDD/TDD features initialized
      currentApproach: undefined,
      consecutiveFailures: 0,
      beatNumber: 1,
      activeElements: new Set(),
      usedElements: new Set(),
      npcDispositions: {},
      revealedTells: new Set(),
      triggeredEscalations: new Set(),
      escapeUnlocked: false,
      pointOfNoReturn: false,
      threatClockRevealed: false,
    });
  }, []);

  const updateEncounterPhase = useCallback((phaseId: string) => {
    setEncounterState(prev => prev ? {
      ...prev,
      currentPhaseId: phaseId,
      currentBeatIndex: 0,
      phaseScore: 0,
    } : null);
  }, []);

  // Add ticks to goal clock
  const addGoalProgress = useCallback((ticks: number) => {
    setEncounterState(prev => prev ? {
      ...prev,
      goalProgress: Math.min(prev.goalProgress + ticks, prev.goalMax),
    } : null);
  }, []);

  // Add ticks to threat clock
  const addThreatProgress = useCallback((ticks: number) => {
    setEncounterState(prev => prev ? {
      ...prev,
      threatProgress: Math.min(prev.threatProgress + ticks, prev.threatMax),
    } : null);
  }, []);

  // Legacy score function (for backward compatibility)
  const addEncounterScore = useCallback((points: number) => {
    setEncounterState(prev => prev ? {
      ...prev,
      phaseScore: prev.phaseScore + points,
      totalScore: prev.totalScore + points,
      // Also update goal/threat based on score sign
      goalProgress: points > 0 ? Math.min(prev.goalProgress + 1, prev.goalMax) : prev.goalProgress,
      threatProgress: points < 0 ? Math.min(prev.threatProgress + 1, prev.threatMax) : prev.threatProgress,
    } : null);
  }, []);

  const advanceEncounterBeat = useCallback(() => {
    setEncounterState(prev => prev ? {
      ...prev,
      currentBeatIndex: prev.currentBeatIndex + 1,
    } : null);
  }, []);

  const endEncounter = useCallback(() => {
    setEncounterState(null);
  }, []);

  // GDD/TDD Encounter Feature Implementations
  
  const setEncounterApproach = useCallback((approach: EncounterApproach) => {
    setEncounterState(prev => prev ? {
      ...prev,
      currentApproach: approach,
    } : null);
  }, []);

  const recordOutcome = useCallback((outcome: 'success' | 'complicated' | 'failure') => {
    setEncounterState(prev => {
      if (!prev) return null;
      return {
        ...prev,
        consecutiveFailures: outcome === 'failure' ? prev.consecutiveFailures + 1 : 0,
        beatNumber: prev.beatNumber + 1,
      };
    });
  }, []);

  const activateEnvironmentalElement = useCallback((elementId: string) => {
    setEncounterState(prev => {
      if (!prev) return null;
      const newActive = new Set(prev.activeElements);
      newActive.add(elementId);
      return { ...prev, activeElements: newActive };
    });
  }, []);

  const useEnvironmentalElement = useCallback((elementId: string) => {
    setEncounterState(prev => {
      if (!prev) return null;
      const newUsed = new Set(prev.usedElements);
      newUsed.add(elementId);
      return { ...prev, usedElements: newUsed };
    });
  }, []);

  const updateNPCDisposition = useCallback((npcId: string, disposition: NPCDisposition) => {
    setEncounterState(prev => {
      if (!prev) return null;
      return {
        ...prev,
        npcDispositions: { ...prev.npcDispositions, [npcId]: disposition },
      };
    });
  }, []);

  const revealNPCTell = useCallback((tellId: string) => {
    setEncounterState(prev => {
      if (!prev) return null;
      const newTells = new Set(prev.revealedTells);
      newTells.add(tellId);
      return { ...prev, revealedTells: newTells };
    });
  }, []);

  const triggerEscalation = useCallback((triggerId: string, effects: { escapeUnlocked?: boolean; pointOfNoReturn?: boolean }) => {
    setEncounterState(prev => {
      if (!prev) return null;
      const newTriggered = new Set(prev.triggeredEscalations);
      newTriggered.add(triggerId);
      return {
        ...prev,
        triggeredEscalations: newTriggered,
        escapeUnlocked: effects.escapeUnlocked ?? prev.escapeUnlocked,
        pointOfNoReturn: effects.pointOfNoReturn ?? prev.pointOfNoReturn,
      };
    });
  }, []);

  const revealThreatClock = useCallback(() => {
    setEncounterState(prev => prev ? {
      ...prev,
      threatClockRevealed: true,
    } : null);
  }, []);

  const checkEscalationTriggers = useCallback(() => {
    if (!encounterState) return { triggered: [], shouldUnlockEscape: false, hitPointOfNoReturn: false };
    
    const threatPercent = (encounterState.threatProgress / encounterState.threatMax) * 100;
    const triggered: string[] = [];
    let shouldUnlockEscape = false;
    let hitPointOfNoReturn = false;
    
    // Check for 75% threat threshold
    if (threatPercent >= 75 && !encounterState.triggeredEscalations.has('threat-75')) {
      triggered.push('threat-75');
    }
    
    // Check for consecutive failures (unlock escape)
    if (encounterState.consecutiveFailures >= 2 && !encounterState.escapeUnlocked) {
      shouldUnlockEscape = true;
      triggered.push('consecutive-failures');
    }
    
    // Check for point of no return (beat 3+)
    if (encounterState.beatNumber >= 3 && !encounterState.pointOfNoReturn) {
      hitPointOfNoReturn = true;
      triggered.push('point-of-no-return');
    }
    
    return { triggered, shouldUnlockEscape, hitPointOfNoReturn };
  }, [encounterState]);

  const getEncounterProgress = useCallback(() => {
    if (!encounterState) return 0;
    const goalPercent = (encounterState.goalProgress / encounterState.goalMax) * 100;
    const threatPercent = (encounterState.threatProgress / encounterState.threatMax) * 100;
    // Average of both clocks as overall progress
    return Math.round((goalPercent + threatPercent) / 2);
  }, [encounterState]);

  // Branch tracking methods
  const recordBranchChoice = useCallback((fromSceneId: string, toSceneId: string, choiceId?: string) => {
    // Get the tone of the target scene if available
    const targetScene = currentEpisode?.scenes.find(s => s.id === toSceneId);
    const branchTone = targetScene?.branchType;
    
    setBranchHistory(prev => [...prev, {
      fromSceneId,
      toSceneId,
      choiceId,
      branchTone,
      timestamp: Date.now(),
    }]);
    
    // Update current branch tone if the scene has one
    if (branchTone) {
      setCurrentBranchTone(branchTone);
    }
  }, [currentEpisode]);

  const getBranchHistory = useCallback(() => branchHistory, [branchHistory]);

  const wasSceneVisited = useCallback((sceneId: string) => {
    return sceneHistory.includes(sceneId) || 
           branchHistory.some(b => b.toSceneId === sceneId || b.fromSceneId === sceneId);
  }, [sceneHistory, branchHistory]);

  const getBranchToneForScene = useCallback((sceneId: string) => {
    // Find the branch entry that led to this scene
    const entry = branchHistory.find(b => b.toSceneId === sceneId);
    return entry?.branchTone || null;
  }, [branchHistory]);

  const getPathToScene = useCallback((sceneId: string): string[] => {
    const path: string[] = [];
    let currentId = sceneId;
    
    // Walk backwards through branch history to build path
    const reversedHistory = [...branchHistory].reverse();
    for (const entry of reversedHistory) {
      if (entry.toSceneId === currentId) {
        path.unshift(entry.fromSceneId);
        currentId = entry.fromSceneId;
      }
    }
    
    return path;
  }, [branchHistory]);

  const completeEpisode = useCallback((episodeId: string) => {
    setPlayer(prev => {
      if (prev.completedEpisodes.includes(episodeId)) return prev;
      return {
        ...prev,
        completedEpisodes: [...prev.completedEpisodes, episodeId],
      };
    });
  }, []);

  const resetGame = useCallback(async () => {
    setPlayer(createInitialPlayerState());
    setCurrentStory(null);
    setCurrentEpisode(null);
    setCurrentScene(null);
    setCurrentBeatId(null);
    setSceneHistory([]);
    setBranchHistory([]);
    setCurrentBranchTone(null);
    setEncounterState(null);
    
    // Clear persisted state
    try {
      await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
      console.log('[GameStore] Cleared persisted state');
    } catch (e) {
      console.warn('[GameStore] Failed to clear persisted state:', e);
    }
  }, []);

  const playerValue = useMemo<GamePlayerStateValue>(() => ({
    player,
  }), [player]);

  const storyValue = useMemo<GameStoryStateValue>(() => ({
    currentStory,
    currentEpisode,
    currentScene,
    currentBeatId,
  }), [currentStory, currentEpisode, currentScene, currentBeatId]);

  const progressValue = useMemo<GameProgressStateValue>(() => ({
    sceneHistory,
    branchHistory,
    currentBranchTone,
    butterflyFeedback,
  }), [sceneHistory, branchHistory, currentBranchTone, butterflyFeedback]);

  const encounterValue = useMemo<GameEncounterStateValue>(() => ({
    encounterState,
  }), [encounterState]);

  const actionsValue = useMemo<GameActions>(() => ({
    initializeStory,
    loadEpisode,
    loadScene,
    setBeat,
    applyConsequences,
    updateRelationship,
    getRelationship,
    addItem,
    removeItem,
    hasItem,
    setFlag,
    getFlag,
    setScore,
    changeScore,
    getScore,
    addTag,
    removeTag,
    hasTag,
    startEncounter,
    updateEncounterPhase,
    addGoalProgress,
    addThreatProgress,
    addEncounterScore,
    advanceEncounterBeat,
    endEncounter,
    // GDD/TDD Encounter Features
    setEncounterApproach,
    recordOutcome,
    activateEnvironmentalElement,
    useEnvironmentalElement,
    updateNPCDisposition,
    revealNPCTell,
    triggerEscalation,
    revealThreatClock,
    checkEscalationTriggers,
    getEncounterProgress,
    queueDelayedConsequence,
    getPendingConsequences,
    clearButterflyFeedback,
    completeEpisode,
    recordBranchChoice,
    getBranchHistory,
    wasSceneVisited,
    getBranchToneForScene,
    getPathToScene,
    resetGame,
  }), [
    initializeStory,
    loadEpisode,
    loadScene,
    setBeat,
    applyConsequences,
    updateRelationship,
    getRelationship,
    addItem,
    removeItem,
    hasItem,
    setFlag,
    getFlag,
    setScore,
    changeScore,
    getScore,
    addTag,
    removeTag,
    hasTag,
    startEncounter,
    updateEncounterPhase,
    addGoalProgress,
    addThreatProgress,
    addEncounterScore,
    advanceEncounterBeat,
    endEncounter,
    setEncounterApproach,
    recordOutcome,
    activateEnvironmentalElement,
    useEnvironmentalElement,
    updateNPCDisposition,
    revealNPCTell,
    triggerEscalation,
    revealThreatClock,
    checkEscalationTriggers,
    getEncounterProgress,
    queueDelayedConsequence,
    getPendingConsequences,
    clearButterflyFeedback,
    completeEpisode,
    recordBranchChoice,
    getBranchHistory,
    wasSceneVisited,
    getBranchToneForScene,
    getPathToScene,
    resetGame,
  ]);

  return React.createElement(
    GamePlayerContext.Provider,
    { value: playerValue },
    React.createElement(
      GameStoryContext.Provider,
      { value: storyValue },
      React.createElement(
        GameProgressContext.Provider,
        { value: progressValue },
        React.createElement(
          GameEncounterContext.Provider,
          { value: encounterValue },
          React.createElement(GameActionsContext.Provider, { value: actionsValue }, children),
        ),
      ),
    ),
  );
};

export const useGamePlayerState = (): GamePlayerStateValue => {
  const context = useContext(GamePlayerContext);
  if (!context) {
    throw new Error('Game player state must be used within a GameProvider');
  }
  return context;
};

export const useGameStoryState = (): GameStoryStateValue => {
  const context = useContext(GameStoryContext);
  if (!context) {
    throw new Error('Game story state must be used within a GameProvider');
  }
  return context;
};

export const useGameProgressState = (): GameProgressStateValue => {
  const context = useContext(GameProgressContext);
  if (!context) {
    throw new Error('Game progress state must be used within a GameProvider');
  }
  return context;
};

export const useGameEncounterState = (): GameEncounterStateValue => {
  const context = useContext(GameEncounterContext);
  if (!context) {
    throw new Error('Game encounter state must be used within a GameProvider');
  }
  return context;
};

export const useGameActions = (): GameActions => {
  const context = useContext(GameActionsContext);
  if (!context) {
    throw new Error('Game actions must be used within a GameProvider');
  }
  return context;
};

export const useGameStore = (): GameContextValue => ({
  ...useGamePlayerState(),
  ...useGameStoryState(),
  ...useGameProgressState(),
  ...useGameEncounterState(),
  ...useGameActions(),
});
