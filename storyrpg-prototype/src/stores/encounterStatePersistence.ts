export type EncounterApproach = 'aggressive' | 'cautious' | 'clever' | 'desperate' | 'adaptive';

export type NPCDisposition = 'confident' | 'wary' | 'desperate' | 'enraged' | 'calculating';

export interface EncounterState {
  encounterId: string;
  currentPhaseId: string;
  currentBeatIndex: number;
  goalProgress: number;
  goalMax: number;
  threatProgress: number;
  threatMax: number;
  currentApproach?: EncounterApproach;
  consecutiveFailures: number;
  beatNumber: number;
  activeElements: Set<string>;
  usedElements: Set<string>;
  npcDispositions: Record<string, NPCDisposition>;
  revealedTells: Set<string>;
  triggeredEscalations: Set<string>;
  escapeUnlocked: boolean;
  pointOfNoReturn: boolean;
  threatClockRevealed: boolean;
  phaseScore: number;
  totalScore: number;
}

export function serializeEncounterState(state: EncounterState | null): string | null {
  if (!state) return null;
  return JSON.stringify({
    ...state,
    activeElements: Array.from(state.activeElements),
    usedElements: Array.from(state.usedElements),
    revealedTells: Array.from(state.revealedTells),
    triggeredEscalations: Array.from(state.triggeredEscalations),
  });
}

export function deserializeEncounterState(json: string | null): EncounterState | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return {
      ...parsed,
      activeElements: new Set(parsed.activeElements || []),
      usedElements: new Set(parsed.usedElements || []),
      revealedTells: new Set(parsed.revealedTells || []),
      triggeredEscalations: new Set(parsed.triggeredEscalations || []),
    };
  } catch (error) {
    console.error('[GameStore] Failed to deserialize encounter state:', error);
    return null;
  }
}
