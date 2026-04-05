import {
  DEFAULT_IDENTITY_PROFILE,
  PlayerAttributes,
  PlayerState,
} from '../types';

export const DEFAULT_ATTRIBUTES: PlayerAttributes = {
  charm: 50,
  wit: 50,
  courage: 50,
  empathy: 50,
  resolve: 50,
  resourcefulness: 50,
};

export function serializePlayerState(player: PlayerState): string {
  return JSON.stringify({
    ...player,
    tags: Array.from(player.tags),
  });
}

export function deserializePlayerState(json: string): PlayerState | null {
  try {
    const parsed = JSON.parse(json);
    return {
      ...parsed,
      tags: new Set(parsed.tags || []),
      identityProfile: parsed.identityProfile ?? { ...DEFAULT_IDENTITY_PROFILE },
      pendingConsequences: parsed.pendingConsequences ?? [],
    };
  } catch (e) {
    console.error('[GameStore] Failed to deserialize player state:', e);
    return null;
  }
}

export function createInitialPlayerState(): PlayerState {
  return {
    characterName: 'Player',
    characterPronouns: 'he/him',
    attributes: { ...DEFAULT_ATTRIBUTES },
    skills: {},
    relationships: {},
    flags: {},
    scores: {},
    tags: new Set(),
    identityProfile: { ...DEFAULT_IDENTITY_PROFILE },
    pendingConsequences: [],
    inventory: [],
    currentStoryId: null,
    currentEpisodeId: null,
    currentSceneId: null,
    completedEpisodes: [],
  };
}
