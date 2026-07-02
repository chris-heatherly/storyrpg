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

/**
 * Save-format version. Bump when PlayerState's persisted shape changes in a
 * way deserializePlayerState can't default its way through; add a migration
 * branch below keyed on the loaded version. v1 = first stamped version (all
 * earlier saves are unversioned and treated as v0).
 */
export const PLAYER_SAVE_VERSION = 1;

export function serializePlayerState(player: PlayerState): string {
  return JSON.stringify({
    ...player,
    tags: Array.from(player.tags),
    saveVersion: PLAYER_SAVE_VERSION,
  });
}

export function deserializePlayerState(json: string): PlayerState | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    // Default EVERY map/collection, not just the newest fields: this codebase
    // is heavily refactored and old (v0) saves can miss whole maps — an
    // undefined `attributes` crashed the condition evaluator and NaN-poisoned
    // attribute consequences.
    return {
      ...parsed,
      characterName: typeof parsed.characterName === 'string' ? parsed.characterName : 'Player',
      characterPronouns: typeof parsed.characterPronouns === 'string' ? parsed.characterPronouns : 'he/him',
      attributes: { ...DEFAULT_ATTRIBUTES, ...(parsed.attributes ?? {}) },
      skills: parsed.skills ?? {},
      relationships: parsed.relationships ?? {},
      flags: parsed.flags ?? {},
      scores: parsed.scores ?? {},
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
      completedEpisodes: Array.isArray(parsed.completedEpisodes) ? parsed.completedEpisodes : [],
      tags: new Set(parsed.tags || []),
      identityProfile: parsed.identityProfile ?? { ...DEFAULT_IDENTITY_PROFILE },
      relationshipValueStates: parsed.relationshipValueStates ?? {},
      pendingConsequences: Array.isArray(parsed.pendingConsequences) ? parsed.pendingConsequences : [],
      visitLog: Array.isArray(parsed.visitLog) ? parsed.visitLog : [],
      episodeCompletions: Array.isArray(parsed.episodeCompletions) ? parsed.episodeCompletions : [],
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
    relationshipValueStates: {},
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
    visitLog: [],
    episodeCompletions: [],
  };
}
