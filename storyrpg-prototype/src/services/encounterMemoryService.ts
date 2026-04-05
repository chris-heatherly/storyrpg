/**
 * Encounter Memory Service
 * 
 * Tracks past encounters for callbacks in future encounters.
 * Enables:
 * - Confidence boosts from past victories
 * - Trauma penalties from past defeats
 * - Nemesis taunts from recurring adversaries
 * - Learned weaknesses from experience
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface EncounterMemory {
  encounterId: string;
  encounterType: string;
  outcome: 'victory' | 'partialVictory' | 'defeat' | 'escape';
  partialVictoryCost?: {
    domain: string;
    severity: string;
    visibleComplication: string;
    lingeringEffect?: string;
  };
  approachUsed: string;
  timestamp: string;
  // Key moments for callbacks
  keyMoments: Array<{
    type: 'signature_move' | 'critical_failure' | 'clutch_success' | 'clever_trick';
    description: string;
  }>;
  // NPCs involved (for recurring encounters)
  npcsDefeated: string[];
  npcsEscapedFrom: string[];
  // Stats
  finalGoalProgress: number;
  finalThreatProgress: number;
  totalChoices: number;
}

export interface EncounterCallback {
  memoryId: string;
  callbackType: 'confidence_boost' | 'trauma_penalty' | 'nemesis_taunt' | 'learned_weakness';
  narrativeText: string;
  mechanicalEffect?: {
    type: 'success_bonus' | 'failure_penalty' | 'reveal_tell';
    value: number | string;
  };
}

const MEMORY_STORAGE_KEY = '@encounter_memories';
const MAX_MEMORIES = 50; // Keep last 50 encounters

class EncounterMemoryService {
  private memories: EncounterMemory[] = [];
  private initialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const stored = await AsyncStorage.getItem(MEMORY_STORAGE_KEY);
      if (stored) {
        this.memories = JSON.parse(stored);
      }
      this.initialized = true;
    } catch (error) {
      console.error('[EncounterMemory] Failed to load memories:', error);
      this.memories = [];
      this.initialized = true;
    }
  }

  async saveMemory(memory: EncounterMemory): Promise<void> {
    await this.initialize();
    
    // Add to beginning (most recent first)
    this.memories.unshift(memory);
    
    // Trim to max size
    if (this.memories.length > MAX_MEMORIES) {
      this.memories = this.memories.slice(0, MAX_MEMORIES);
    }
    
    // Persist
    try {
      await AsyncStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(this.memories));
    } catch (error) {
      console.error('[EncounterMemory] Failed to save memories:', error);
    }
  }

  async getMemories(): Promise<EncounterMemory[]> {
    await this.initialize();
    return this.memories;
  }

  /**
   * Get callbacks relevant to a new encounter
   */
  async getCallbacksForEncounter(
    encounterType: string,
    npcIds: string[]
  ): Promise<EncounterCallback[]> {
    await this.initialize();
    
    const callbacks: EncounterCallback[] = [];
    
    // Check for encounters of the same type
    const sameTypeMemories = this.memories.filter(m => m.encounterType === encounterType);
    
    if (sameTypeMemories.length > 0) {
      const lastSameType = sameTypeMemories[0];
      
      if (lastSameType.outcome === 'victory') {
        callbacks.push({
          memoryId: lastSameType.encounterId,
          callbackType: 'confidence_boost',
          narrativeText: `You've faced this kind of challenge before and emerged victorious. The memory steadies your nerves.`,
          mechanicalEffect: {
            type: 'success_bonus',
            value: 0.05, // +5% success chance
          },
        });
      } else if (lastSameType.outcome === 'defeat') {
        // Check if there's also a victory (learning from failure)
        const hasVictory = sameTypeMemories.some(m => m.outcome === 'victory');
        
        if (hasVictory) {
          callbacks.push({
            memoryId: lastSameType.encounterId,
            callbackType: 'learned_weakness',
            narrativeText: `You've learned from past failures. You know what to watch for now.`,
            mechanicalEffect: {
              type: 'reveal_tell',
              value: 'early', // Reveal NPC tells earlier
            },
          });
        } else {
          callbacks.push({
            memoryId: lastSameType.encounterId,
            callbackType: 'trauma_penalty',
            narrativeText: `Memories of your last defeat here weigh on you. Don't let history repeat itself.`,
            mechanicalEffect: {
              type: 'failure_penalty',
              value: 0.05, // +5% failure chance initially
            },
          });
        }
      }
    }
    
    // Check for recurring NPCs
    for (const npcId of npcIds) {
      const defeatedThisNpc = this.memories.filter(m => m.npcsDefeated.includes(npcId));
      const escapedFromNpc = this.memories.filter(m => m.npcsEscapedFrom.includes(npcId));
      
      if (defeatedThisNpc.length > 0) {
        callbacks.push({
          memoryId: defeatedThisNpc[0].encounterId,
          callbackType: 'confidence_boost',
          narrativeText: `You've beaten this foe before. They know it too.`,
          mechanicalEffect: {
            type: 'success_bonus',
            value: 0.08,
          },
        });
      } else if (escapedFromNpc.length > 0) {
        callbacks.push({
          memoryId: escapedFromNpc[0].encounterId,
          callbackType: 'nemesis_taunt',
          narrativeText: `They remember when you ran. Their confidence is palpable.`,
          mechanicalEffect: {
            type: 'failure_penalty',
            value: 0.05,
          },
        });
      }
    }
    
    return callbacks;
  }

  /**
   * Detect key moments from encounter history
   */
  detectKeyMoments(
    choiceHistory: Array<{
      outcome: 'success' | 'complicated' | 'failure';
      approach: string;
    }>,
    finalOutcome: 'victory' | 'defeat' | 'escape'
  ): Array<{
    type: 'signature_move' | 'critical_failure' | 'clutch_success' | 'clever_trick';
    description: string;
  }> {
    const moments: Array<{
      type: 'signature_move' | 'critical_failure' | 'clutch_success' | 'clever_trick';
      description: string;
    }> = [];
    
    // Check for signature moves (3+ successes with same approach)
    const approachCounts: Record<string, number> = {};
    for (const choice of choiceHistory) {
      if (choice.outcome === 'success') {
        approachCounts[choice.approach] = (approachCounts[choice.approach] || 0) + 1;
      }
    }
    
    for (const [approach, count] of Object.entries(approachCounts)) {
      if (count >= 3) {
        moments.push({
          type: 'signature_move',
          description: `Dominated with ${approach} approach`,
        });
      }
    }
    
    // Check for clutch success (success after 2+ failures)
    let consecutiveFailures = 0;
    for (const choice of choiceHistory) {
      if (choice.outcome === 'failure') {
        consecutiveFailures++;
      } else if (choice.outcome === 'success' && consecutiveFailures >= 2) {
        moments.push({
          type: 'clutch_success',
          description: `Recovered from a dire situation`,
        });
        consecutiveFailures = 0;
      } else {
        consecutiveFailures = 0;
      }
    }
    
    // Check for clever tricks
    const cleverSuccesses = choiceHistory.filter(
      c => c.outcome === 'success' && ['clever', 'trick', 'bluff', 'distract'].some(k => c.approach.toLowerCase().includes(k))
    );
    if (cleverSuccesses.length >= 2) {
      moments.push({
        type: 'clever_trick',
        description: `Outwitted the opposition`,
      });
    }
    
    // Check for critical failures
    const failureCount = choiceHistory.filter(c => c.outcome === 'failure').length;
    if (finalOutcome === 'defeat' && failureCount >= 3) {
      moments.push({
        type: 'critical_failure',
        description: `Everything went wrong`,
      });
    }
    
    return moments;
  }

  async clearMemories(): Promise<void> {
    this.memories = [];
    try {
      await AsyncStorage.removeItem(MEMORY_STORAGE_KEY);
    } catch (error) {
      console.error('[EncounterMemory] Failed to clear memories:', error);
    }
  }
}

export const encounterMemoryService = new EncounterMemoryService();
